import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BOOTSTRAP_COMMIT = "9e48dd793b37e44d3d92f56960c7dfce65e34b2a";
export const MANIFEST_RELATIVE_PATH = "src-tauri/migrations/migration-lock.json";
export const MIGRATIONS_RELATIVE_PATH = "src-tauri/migrations";

const MANIFEST_KEYS = ["migrations", "schemaVersion"];
const ENTRY_KEYS = ["filename", "sha256", "version"];
const MIGRATION_FILENAME = /^(\d{3})_[a-z0-9][a-z0-9_]*\.sql$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FULL_COMMIT_OID = /^[0-9a-fA-F]{40}$/;

export class PolicyError extends Error {}
export class UsageError extends Error {}
export class EnvironmentError extends Error {}

function exactKeys(value, expected) {
  return Object.keys(value).sort().join("\0") === expected.join("\0");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function parseManifest(text, source = "migration manifest") {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new PolicyError(`${source} is not valid JSON: ${error.message}`);
  }
  return validateManifest(value, source);
}

export function validateManifest(value, source = "migration manifest") {
  if (!isRecord(value) || !exactKeys(value, MANIFEST_KEYS)) {
    throw new PolicyError(
      `${source} must contain exactly "schemaVersion" and "migrations".`,
    );
  }
  if (value.schemaVersion !== 1) {
    throw new PolicyError(`${source} schemaVersion must be exactly 1.`);
  }
  if (!Array.isArray(value.migrations) || value.migrations.length === 0) {
    throw new PolicyError(`${source} migrations must be a non-empty array.`);
  }

  const versions = new Set();
  const filenames = new Set();
  const entries = value.migrations.map((entry, index) => {
    const label = `${source} entry ${index + 1}`;
    if (!isRecord(entry) || !exactKeys(entry, ENTRY_KEYS)) {
      throw new PolicyError(
        `${label} must contain exactly "version", "filename", and "sha256".`,
      );
    }
    if (!Number.isInteger(entry.version) || entry.version < 1 || entry.version > 999) {
      throw new PolicyError(`${label} version must be an integer from 1 through 999.`);
    }
    if (versions.has(entry.version)) {
      throw new PolicyError(`${source} contains duplicate migration version ${entry.version}.`);
    }
    versions.add(entry.version);

    if (typeof entry.filename !== "string" || !MIGRATION_FILENAME.test(entry.filename)) {
      throw new PolicyError(
        `${label} filename must use the three-digit NNN_description.sql convention.`,
      );
    }
    if (filenames.has(entry.filename)) {
      throw new PolicyError(`${source} contains duplicate filename ${entry.filename}.`);
    }
    filenames.add(entry.filename);

    const filenameVersion = Number.parseInt(MIGRATION_FILENAME.exec(entry.filename)[1], 10);
    if (filenameVersion !== entry.version) {
      throw new PolicyError(
        `${entry.filename} encodes version ${filenameVersion}, not manifest version ${entry.version}.`,
      );
    }
    if (typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) {
      throw new PolicyError(`${label} sha256 must be 64 lowercase hexadecimal characters.`);
    }
    const expectedVersion = index + 1;
    if (entry.version !== expectedVersion) {
      throw new PolicyError(
        `${source} versions must be ordered and contiguous from 1; expected ${expectedVersion}, found ${entry.version}.`,
      );
    }
    return {
      version: entry.version,
      filename: entry.filename,
      sha256: entry.sha256,
    };
  });

  return { schemaVersion: 1, migrations: entries };
}

function validateSqlFilename(filename, source) {
  const match = MIGRATION_FILENAME.exec(filename);
  if (!match) {
    throw new PolicyError(
      `${source} contains ${filename}; migration SQL filenames must use NNN_description.sql.`,
    );
  }
  return Number.parseInt(match[1], 10);
}

export function validateSnapshot(manifest, sqlFiles, source = "current migration tree") {
  const normalized = validateManifest(manifest, `${source} manifest`);
  if (!(sqlFiles instanceof Map)) {
    throw new TypeError("sqlFiles must be a Map of filenames to Buffer values");
  }

  const sqlVersions = new Set();
  for (const [filename, contents] of sqlFiles) {
    const version = validateSqlFilename(filename, source);
    if (sqlVersions.has(version)) {
      throw new PolicyError(`${source} contains more than one SQL file for version ${version}.`);
    }
    sqlVersions.add(version);
    if (!Buffer.isBuffer(contents)) {
      throw new TypeError(`SQL contents for ${filename} must be a Buffer`);
    }
  }

  const manifestByFilename = new Map(
    normalized.migrations.map((entry) => [entry.filename, entry]),
  );
  for (const filename of sqlFiles.keys()) {
    if (!manifestByFilename.has(filename)) {
      throw new PolicyError(
        `${filename} has no migration-lock entry. Add its version, exact filename, and raw-byte SHA-256.`,
      );
    }
  }
  for (const entry of normalized.migrations) {
    const contents = sqlFiles.get(entry.filename);
    if (!contents) {
      throw new PolicyError(
        `${entry.filename} is locked but missing or renamed. Restore it and add a new migration instead.`,
      );
    }
    const actualHash = hashBuffer(contents);
    if (actualHash !== entry.sha256) {
      throw new PolicyError(
        `${entry.filename} does not match its migration-lock SHA-256. If it exists on the base branch, restore it and add the next numbered migration; if it is new on this branch, review it and update only its new manifest entry.`,
      );
    }
  }
  return normalized;
}

export function compareWithBaseline(current, baseline) {
  const currentManifest = validateManifest(current, "current migration manifest");
  const baselineManifest = validateManifest(baseline, "baseline migration manifest");
  const currentByVersion = new Map(
    currentManifest.migrations.map((entry) => [entry.version, entry]),
  );

  for (const baselineEntry of baselineManifest.migrations) {
    const currentEntry = currentByVersion.get(baselineEntry.version);
    if (!currentEntry) {
      throw new PolicyError(
        `${baselineEntry.filename} is locked by the baseline but its manifest entry was removed. Restore it and add a new migration instead.`,
      );
    }
    if (
      currentEntry.filename !== baselineEntry.filename ||
      currentEntry.sha256 !== baselineEntry.sha256
    ) {
      throw new PolicyError(
        `${baselineEntry.filename} is locked by the baseline and its filename or checksum changed. Restore the baseline entry and add a new migration instead.`,
      );
    }
  }

  const baselineMaximum = baselineManifest.migrations.at(-1).version;
  for (const currentEntry of currentManifest.migrations.slice(baselineManifest.migrations.length)) {
    if (currentEntry.version <= baselineMaximum) {
      throw new PolicyError(
        `${currentEntry.filename} reuses a locked migration version. Add the next sequential version instead.`,
      );
    }
  }
  return currentManifest;
}

export function parseCliArgs(args) {
  const options = { repoRoot: undefined, baselineCommit: undefined, baselineManifest: undefined };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--") {
      if (index !== args.length - 1) {
        throw new UsageError("Positional arguments after -- are not supported.");
      }
      break;
    }
    const names = {
      "--repo-root": "repoRoot",
      "--baseline-commit": "baselineCommit",
      "--baseline-manifest": "baselineManifest",
    };
    const name = names[option];
    if (!name) {
      throw new UsageError(`Unknown option: ${option}`);
    }
    if (seen.has(name)) {
      throw new UsageError(`${option} may be supplied only once.`);
    }
    const argument = args[index + 1];
    if (argument === undefined || argument === "--" || argument.startsWith("--")) {
      throw new UsageError(`${option} requires a value.`);
    }
    options[name] = argument;
    seen.add(name);
    index += 1;
  }
  if (options.baselineCommit && options.baselineManifest) {
    throw new UsageError("--baseline-commit and --baseline-manifest are mutually exclusive.");
  }
  return options;
}

async function requireRegularFile(filename, label, missingIsPolicy = true) {
  let stats;
  try {
    stats = await lstat(filename);
  } catch (error) {
    const ErrorType = missingIsPolicy && error.code === "ENOENT" ? PolicyError : EnvironmentError;
    throw new ErrorType(`${label} cannot be read at ${filename}: ${error.message}`);
  }
  if (!stats.isFile()) {
    throw new PolicyError(`${label} must be a regular file: ${filename}`);
  }
}

async function collectSqlFiles(directory, relativeDirectory = "") {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new EnvironmentError(`Cannot read migrations directory ${directory}: ${error.message}`);
  }
  const files = new Map();
  for (const entry of entries) {
    const relativeName = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectSqlFiles(fullPath, relativeName);
      for (const item of nested) files.set(item[0], item[1]);
    } else if (entry.name.toLowerCase().endsWith(".sql")) {
      if (!entry.isFile()) {
        throw new PolicyError(`Migration SQL must be a regular file: ${relativeName}`);
      }
      try {
        files.set(relativeName, await readFile(fullPath));
      } catch (error) {
        throw new EnvironmentError(`Cannot read migration SQL ${fullPath}: ${error.message}`);
      }
    }
  }
  return files;
}

export async function loadCurrentSnapshot(repoRoot) {
  const migrationsDirectory = path.join(repoRoot, ...MIGRATIONS_RELATIVE_PATH.split("/"));
  const manifestPath = path.join(repoRoot, ...MANIFEST_RELATIVE_PATH.split("/"));
  await requireRegularFile(manifestPath, "Migration lock manifest");
  let text;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch (error) {
    throw new EnvironmentError(`Cannot read migration lock manifest: ${error.message}`);
  }
  const manifest = parseManifest(text, "current migration manifest");
  const sqlFiles = await collectSqlFiles(migrationsDirectory);
  return { manifest: validateSnapshot(manifest, sqlFiles), sqlFiles };
}

export function allowManifestlessBootstrap(commit) {
  if (commit.toLowerCase() !== BOOTSTRAP_COMMIT) {
    throw new PolicyError(
      `Baseline ${commit} has no migration lock manifest. Only bootstrap commit ${BOOTSTRAP_COMMIT} may use the manifestless trust anchor.`,
    );
  }
  return true;
}

function runGit(repoRoot, args, allowFailure = false) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: null,
    shell: false,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw new EnvironmentError(`Unable to run git ${args[0]}: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    const detail = result.stderr?.toString("utf8").trim();
    throw new EnvironmentError(
      `git ${args[0]} failed with exit code ${result.status}${detail ? `: ${detail}` : "."}`,
    );
  }
  return result;
}

function parseGitTree(output) {
  const records = output.toString("utf8").split("\0").filter(Boolean);
  return records.map((record) => {
    const tab = record.indexOf("\t");
    const metadata = record.slice(0, tab).split(" ");
    if (tab < 0 || metadata.length !== 3) {
      throw new EnvironmentError("Git returned an unexpected tree listing.");
    }
    return { mode: metadata[0], type: metadata[1], oid: metadata[2], path: record.slice(tab + 1) };
  });
}

function readGitBlob(repoRoot, commit, filename) {
  return runGit(repoRoot, ["show", `${commit}:${filename}`]).stdout;
}

export function synthesizeManifest(sqlFiles, source = "bootstrap baseline") {
  const migrations = [...sqlFiles.entries()]
    .map(([filename, contents]) => ({
      version: validateSqlFilename(filename, source),
      filename,
      sha256: hashBuffer(contents),
    }))
    .sort((left, right) => left.version - right.version);
  return validateSnapshot({ schemaVersion: 1, migrations }, sqlFiles, source);
}

export function validateGitBaselineSnapshot(commit, sqlFiles, manifestText) {
  if (manifestText === undefined) {
    allowManifestlessBootstrap(commit);
    return synthesizeManifest(sqlFiles, `bootstrap baseline ${commit}`);
  }
  const manifest = parseManifest(manifestText, `baseline manifest at ${commit}`);
  return validateSnapshot(manifest, sqlFiles, `baseline ${commit}`);
}

export function loadGitBaseline(repoRoot, suppliedCommit) {
  if (!FULL_COMMIT_OID.test(suppliedCommit)) {
    throw new UsageError("--baseline-commit must be an exact 40-character hexadecimal commit OID.");
  }
  const commit = suppliedCommit.toLowerCase();
  const resolved = runGit(repoRoot, ["rev-parse", "--verify", `${commit}^{commit}`])
    .stdout.toString("utf8").trim().toLowerCase();
  if (resolved !== commit) {
    throw new EnvironmentError(
      `Baseline OID ${suppliedCommit} did not resolve to that exact commit (resolved ${resolved || "nothing"}).`,
    );
  }

  const tree = parseGitTree(
    runGit(repoRoot, ["ls-tree", "-r", "-z", commit, "--", MIGRATIONS_RELATIVE_PATH]).stdout,
  );
  const prefix = `${MIGRATIONS_RELATIVE_PATH}/`;
  const migrationItems = tree.filter((item) => item.path.toLowerCase().endsWith(".sql"));
  const sqlFiles = new Map();
  for (const item of migrationItems) {
    if (item.type !== "blob" || !/^100(?:644|755)$/.test(item.mode)) {
      throw new PolicyError(`Baseline migration must be a regular Git file: ${item.path}`);
    }
    const filename = item.path.startsWith(prefix) ? item.path.slice(prefix.length) : item.path;
    sqlFiles.set(filename, readGitBlob(repoRoot, commit, item.path));
  }

  const manifestItem = tree.find((item) => item.path === MANIFEST_RELATIVE_PATH);
  if (!manifestItem) {
    return validateGitBaselineSnapshot(commit, sqlFiles, undefined);
  }
  if (manifestItem.type !== "blob" || !/^100(?:644|755)$/.test(manifestItem.mode)) {
    throw new PolicyError(`Baseline migration manifest is not a regular Git file at ${commit}.`);
  }
  return validateGitBaselineSnapshot(
    commit,
    sqlFiles,
    readGitBlob(repoRoot, commit, MANIFEST_RELATIVE_PATH).toString("utf8"),
  );
}

async function loadBaselineManifest(filename, repoRoot) {
  const resolved = path.resolve(repoRoot, filename);
  await requireRegularFile(resolved, "Baseline manifest", false);
  try {
    return parseManifest(await readFile(resolved, "utf8"), `baseline manifest ${resolved}`);
  } catch (error) {
    if (error instanceof PolicyError) throw error;
    throw new EnvironmentError(`Cannot read baseline manifest ${resolved}: ${error.message}`);
  }
}

export async function run(options) {
  const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const { manifest: current } = await loadCurrentSnapshot(repoRoot);
  let baseline;
  if (options.baselineCommit) {
    baseline = loadGitBaseline(repoRoot, options.baselineCommit);
  } else if (options.baselineManifest) {
    baseline = await loadBaselineManifest(options.baselineManifest, repoRoot);
  }
  if (baseline) compareWithBaseline(current, baseline);
  const baselineLabel = options.baselineCommit
    ? `Git commit ${options.baselineCommit.toLowerCase()}`
    : options.baselineManifest
      ? `manifest ${path.resolve(repoRoot, options.baselineManifest)}`
      : undefined;
  return { current, baseline, baselineLabel };
}

function printUsage() {
  console.error(
    "Usage: node scripts/check-migrations.mjs [--repo-root <path>] [--baseline-commit <exact-full-oid> | --baseline-manifest <path>] [--]",
  );
}

async function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const result = await run(options);
    const suffix = result.baseline
      ? ` The current manifest is append-only relative to ${result.baselineLabel}.`
      : "";
    console.log(
      `Verified ${result.current.migrations.length} migrations in the current tree.${suffix}`,
    );
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Migration check usage error: ${error.message}`);
      printUsage();
      process.exitCode = 2;
    } else if (error instanceof PolicyError) {
      console.error(`Migration policy violation: ${error.message}`);
      process.exitCode = 1;
    } else if (error instanceof EnvironmentError) {
      console.error(`Migration check environment error: ${error.message}`);
      process.exitCode = 2;
    } else {
      console.error(`Migration check failed unexpectedly: ${error.stack ?? error}`);
      process.exitCode = 2;
    }
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  await main();
}
