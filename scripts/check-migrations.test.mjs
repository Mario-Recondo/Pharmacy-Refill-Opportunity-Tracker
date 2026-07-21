import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BOOTSTRAP_COMMIT,
  PolicyError,
  UsageError,
  allowManifestlessBootstrap,
  compareWithBaseline,
  hashBuffer,
  loadCurrentSnapshot,
  parseCliArgs,
  validateGitBaselineSnapshot,
  validateManifest,
  validateSnapshot,
} from "./check-migrations.mjs";

const checkerPath = fileURLToPath(new URL("./check-migrations.mjs", import.meta.url));
const repositoryRoot = path.resolve(path.dirname(checkerPath), "..");

function makeSnapshot(count = 8) {
  const sqlFiles = new Map();
  const migrations = [];
  for (let version = 1; version <= count; version += 1) {
    const filename = `${String(version).padStart(3, "0")}_migration_${version}.sql`;
    const contents = Buffer.from(`-- migration ${version}\nSELECT ${version};\n`, "utf8");
    sqlFiles.set(filename, contents);
    migrations.push({ version, filename, sha256: hashBuffer(contents) });
  }
  return { manifest: { schemaVersion: 1, migrations }, sqlFiles };
}

function cloneManifest(manifest) {
  return structuredClone(manifest);
}

async function writeSnapshotFixture(t, snapshot) {
  const root = await mkdtemp(path.join(os.tmpdir(), "migration-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "src-tauri", "migrations");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "migration-lock.json"),
    `${JSON.stringify(snapshot.manifest, null, 2)}\n`,
  );
  for (const [filename, contents] of snapshot.sqlFiles) {
    await writeFile(path.join(directory, filename), contents);
  }
  return root;
}

test("1. current manifest and migration files pass", async (t) => {
  const snapshot = await loadCurrentSnapshot(repositoryRoot);
  const root = await writeSnapshotFixture(t, snapshot);
  const loaded = await loadCurrentSnapshot(root);
  assert.deepEqual(loaded.manifest, snapshot.manifest);
});

test("2. changing one byte in locked migration 004 fails", () => {
  const snapshot = makeSnapshot();
  const filename = "004_migration_4.sql";
  const changed = Buffer.from(snapshot.sqlFiles.get(filename));
  changed[0] ^= 1;
  snapshot.sqlFiles.set(filename, changed);
  assert.throws(
    () => validateSnapshot(snapshot.manifest, snapshot.sqlFiles),
    /004_migration_4\.sql does not match its migration-lock SHA-256/,
  );
});

test("3. changing only line endings in a locked migration fails", () => {
  const snapshot = makeSnapshot();
  const filename = "004_migration_4.sql";
  snapshot.sqlFiles.set(
    filename,
    Buffer.from(snapshot.sqlFiles.get(filename).toString("utf8").replaceAll("\n", "\r\n")),
  );
  assert.throws(
    () => validateSnapshot(snapshot.manifest, snapshot.sqlFiles),
    /does not match its migration-lock SHA-256/,
  );
});

test("4. deleting locked migration 006 fails", () => {
  const snapshot = makeSnapshot();
  snapshot.sqlFiles.delete("006_migration_6.sql");
  assert.throws(() => validateSnapshot(snapshot.manifest, snapshot.sqlFiles), /missing or renamed/);
});

test("5. renaming locked migration 008 fails", () => {
  const snapshot = makeSnapshot();
  const contents = snapshot.sqlFiles.get("008_migration_8.sql");
  snapshot.sqlFiles.delete("008_migration_8.sql");
  snapshot.sqlFiles.set("008_renamed.sql", contents);
  assert.throws(() => validateSnapshot(snapshot.manifest, snapshot.sqlFiles), /no migration-lock entry/);
});

test("6. changing locked SQL and its current checksum still fails against baseline", () => {
  const baseline = makeSnapshot();
  const currentManifest = cloneManifest(baseline.manifest);
  const currentSql = new Map(baseline.sqlFiles);
  const changed = Buffer.from("-- changed in SQL and manifest\nSELECT 4;\n");
  currentSql.set("004_migration_4.sql", changed);
  currentManifest.migrations[3].sha256 = hashBuffer(changed);

  const validated = validateSnapshot(currentManifest, currentSql);
  assert.throws(
    () => compareWithBaseline(validated, baseline.manifest),
    /locked by the baseline/,
  );
});

test("7. removing an old manifest entry fails against baseline", () => {
  const baseline = makeSnapshot();
  const current = cloneManifest(baseline.manifest);
  current.migrations.pop();
  assert.throws(
    () => compareWithBaseline(current, baseline.manifest),
    /manifest entry was removed/,
  );
});

test("8. appending migration 009 and its matching entry passes", () => {
  const baseline = makeSnapshot();
  const current = makeSnapshot(9);
  const validated = validateSnapshot(current.manifest, current.sqlFiles);
  assert.doesNotThrow(() => compareWithBaseline(validated, baseline.manifest));
});

test("9. adding migration 009 without a manifest entry fails", () => {
  const current = makeSnapshot();
  current.sqlFiles.set("009_example.sql", Buffer.from("SELECT 9;\n"));
  assert.throws(() => validateSnapshot(current.manifest, current.sqlFiles), /no migration-lock entry/);
});

test("10a. reusing a migration number fails", () => {
  const current = makeSnapshot(1);
  current.sqlFiles.set("001_second_name.sql", Buffer.from("SELECT 2;\n"));
  assert.throws(() => validateSnapshot(current.manifest, current.sqlFiles), /more than one SQL file/);
});

test("10b. skipping a migration number fails", () => {
  const current = makeSnapshot(2);
  current.manifest.migrations[1].version = 3;
  current.manifest.migrations[1].filename = "003_migration_3.sql";
  assert.throws(() => validateManifest(current.manifest), /ordered and contiguous/);
});

test("strict schema rejects extra root and entry properties", () => {
  const rootExtra = makeSnapshot(1).manifest;
  rootExtra.comment = "not allowed";
  assert.throws(() => validateManifest(rootExtra), /exactly/);

  const entryExtra = makeSnapshot(1).manifest;
  entryExtra.migrations[0].comment = "not allowed";
  assert.throws(() => validateManifest(entryExtra), /exactly/);
});

test("strict schema rejects malformed hashes, versions, and filename mappings", () => {
  const wrongSchema = makeSnapshot(1).manifest;
  wrongSchema.schemaVersion = 2;
  assert.throws(() => validateManifest(wrongSchema), /schemaVersion must be exactly 1/);

  const uppercaseHash = makeSnapshot(1).manifest;
  uppercaseHash.migrations[0].sha256 = uppercaseHash.migrations[0].sha256.toUpperCase();
  assert.throws(() => validateManifest(uppercaseHash), /lowercase/);

  const wrongMapping = makeSnapshot(1).manifest;
  wrongMapping.migrations[0].filename = "002_wrong.sql";
  assert.throws(() => validateManifest(wrongMapping), /encodes version/);

  const duplicate = makeSnapshot(2).manifest;
  duplicate.migrations[1].version = 1;
  duplicate.migrations[1].filename = "001_other.sql";
  assert.throws(() => validateManifest(duplicate), /duplicate migration version/);
});

test("only the exact bootstrap commit may lack a baseline manifest", () => {
  assert.equal(allowManifestlessBootstrap(BOOTSTRAP_COMMIT), true);
  assert.throws(
    () => allowManifestlessBootstrap("1111111111111111111111111111111111111111"),
    PolicyError,
  );
});

test("Git baseline selection validates same-commit SQL and fails closed", () => {
  const snapshot = makeSnapshot();
  const ordinaryCommit = "1111111111111111111111111111111111111111";
  const manifestText = JSON.stringify(snapshot.manifest);
  assert.deepEqual(
    validateGitBaselineSnapshot(ordinaryCommit, snapshot.sqlFiles, manifestText),
    snapshot.manifest,
  );

  const changedSql = new Map(snapshot.sqlFiles);
  changedSql.set("004_migration_4.sql", Buffer.from("-- changed\n"));
  assert.throws(
    () => validateGitBaselineSnapshot(ordinaryCommit, changedSql, manifestText),
    /does not match its migration-lock SHA-256/,
  );
  assert.throws(
    () => validateGitBaselineSnapshot(ordinaryCommit, snapshot.sqlFiles, undefined),
    /Only bootstrap commit/,
  );
  assert.deepEqual(
    validateGitBaselineSnapshot(BOOTSTRAP_COMMIT, snapshot.sqlFiles, undefined),
    snapshot.manifest,
  );
  assert.throws(
    () => validateGitBaselineSnapshot(BOOTSTRAP_COMMIT, changedSql, manifestText),
    /does not match its migration-lock SHA-256/,
  );
});

test("CLI accepts supported options and a trailing separator", () => {
  assert.deepEqual(parseCliArgs(["--repo-root", "fixture", "--"]), {
    repoRoot: "fixture",
    baselineCommit: undefined,
    baselineManifest: undefined,
  });
});

test("CLI rejects unknown, repeated, missing, and mutually exclusive options", () => {
  assert.throws(() => parseCliArgs(["--unknown"]), UsageError);
  assert.throws(
    () => parseCliArgs(["--repo-root", "one", "--repo-root", "two"]),
    /only once/,
  );
  assert.throws(() => parseCliArgs(["--repo-root"]), /requires a value/);
  assert.throws(
    () =>
      parseCliArgs([
        "--baseline-commit",
        BOOTSTRAP_COMMIT,
        "--baseline-manifest",
        "baseline.json",
      ]),
    /mutually exclusive/,
  );
  assert.throws(() => parseCliArgs(["--", "unexpected"]), /Positional arguments/);
});

test("CLI exits 0 for success, 1 for policy violations, and 2 for usage errors", async (t) => {
  const snapshot = makeSnapshot();
  const root = await writeSnapshotFixture(t, snapshot);
  const baselinePath = path.join(root, "baseline.json");
  await writeFile(baselinePath, JSON.stringify(snapshot.manifest));

  const success = spawnSync(
    process.execPath,
    [checkerPath, "--repo-root", root, "--baseline-manifest", baselinePath],
    { encoding: "utf8", shell: false },
  );
  assert.equal(success.status, 0, success.stderr);

  await writeFile(
    path.join(root, "src-tauri", "migrations", "004_migration_4.sql"),
    "-- changed\n",
  );
  const policyFailure = spawnSync(process.execPath, [checkerPath, "--repo-root", root], {
    encoding: "utf8",
    shell: false,
  });
  assert.equal(policyFailure.status, 1, policyFailure.stderr);
  assert.match(policyFailure.stderr, /Migration policy violation/);

  const usageFailure = spawnSync(process.execPath, [checkerPath, "--unknown"], {
    encoding: "utf8",
    shell: false,
  });
  assert.equal(usageFailure.status, 2, usageFailure.stderr);
  assert.match(usageFailure.stderr, /Migration check usage error/);
});
