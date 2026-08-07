#!/usr/bin/env node
// Proves the dev diagnostics dashboard is absent from a production build.
//
// The claim being tested is not "the dashboard is hidden" but "the dashboard's
// code is not in the shipped bundle at all". Vite replaces `import.meta.env.DEV`
// with the literal `false` when building for release, so the dynamic import in
// src/main.tsx becomes unreachable and Rollup emits no chunk for it. This script
// runs a real release build and searches every emitted asset for a sentinel
// string that only exists inside the dashboard source.
//
// Kept out of `pnpm test` because it runs a full build (~5s). Run it with
// `pnpm check:prod-bundle`, and in CI alongside the migration guard — same
// pattern as scripts/check-migrations.mjs.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(repoRoot, "dist");
// Run Vite through its own JS entry point rather than a package-manager script.
// Spawning `pnpm` fails on Windows (not on PATH inside a spawned process), and
// this way the check works the same under npm, pnpm, CI, or a bare `node` call.
const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

/** Strings that must never appear in a release bundle. Keep in step with the
 *  dev-only modules: each entry should be unique to code we expect excluded. */
const FORBIDDEN = [
  // exported from src/components/dev/DevDashboard.tsx
  "__REFILL_TRACKER_DEV_DASHBOARD__",
  // CSS class only used by the dashboard panel
  "devdash-launcher",
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function fail(message) {
  console.error(`\n  FAIL  ${message}\n`);
  process.exit(1);
}

if (!existsSync(viteBin)) fail(`vite not found at ${viteBin} — run an install first`);

console.log("Building production bundle…");
rmSync(distDir, { recursive: true, force: true });

// `--mode production` is Vite's default for `build`, but stating it makes the
// intent of this check explicit: it is the release configuration being verified.
const build = spawnSync(process.execPath, [viteBin, "build", "--mode", "production"], {
  cwd: repoRoot,
  stdio: "inherit",
});
if (build.status !== 0) fail("production build failed — cannot verify exclusion");

const assets = walk(distDir);
if (assets.length === 0) fail("build produced no files");

const hits = [];
for (const file of assets) {
  // Binary assets (icons, fonts) cannot contain source identifiers meaningfully,
  // but reading them as utf8 is harmless and keeps the check simple.
  const contents = readFileSync(file, "utf8");
  for (const needle of FORBIDDEN) {
    if (contents.includes(needle)) {
      hits.push(`${path.relative(repoRoot, file)} contains "${needle}"`);
    }
  }
}

if (hits.length > 0) {
  fail(
    `dev-only code leaked into the production bundle:\n         ${hits.join("\n         ")}\n\n` +
      `  The dashboard must stay behind an \`import.meta.env.DEV\` guarded dynamic\n` +
      `  import (see src/main.tsx). A static import defeats the exclusion.`,
  );
}

console.log(`\n  PASS  ${assets.length} built files checked, no dev-only code present.`);
console.log(`        Searched for: ${FORBIDDEN.map((f) => `"${f}"`).join(", ")}\n`);
