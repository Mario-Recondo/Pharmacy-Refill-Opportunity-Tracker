# Releasing an update

The release flow publishes a signed NSIS installer and `latest.json` to the
public releases-only repository. Run it from PowerShell in a clean working
copy after merging the intended changes to `main`.

Prerequisites:

- The private key exists at `$env:USERPROFILE\.tauri\refill-tracker.key`, its
  password file at `$env:USERPROFILE\.tauri\refill-tracker.key.password`, and
  both are backed up securely.
- `gh auth status` succeeds for the GitHub account that can publish
  `Mario-Recondo/mr-refill-tracker-releases`.
- PowerShell is being used; the script is intentionally a PowerShell runbook.

Steps:

1. Run the migration preflight before reading or changing release versions:
   `pnpm check:migrations`. The release script performs this same check as its
   first preflight, before it reads versions or signing credentials, builds,
   stages, or publishes anything.
2. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, and
   `src-tauri/Cargo.toml`. Run any Cargo command afterward so `Cargo.lock`
   records the same application version.
3. Merge the release to `main`.
4. Run `scripts/release.ps1 -Notes "Describe the update"`.

The script checks the three versions, configures the signing key and its
password (read from the sidecar password file — the key is password-protected
because Windows cannot pass an empty password through the environment),
runs `pnpm tauri build`, stages the NSIS installer and signature under
space-free names, creates a BOM-free signed `latest.json`, and runs `gh release
create` for tag `v<version>`.

To verify the release, open the releases page, then launch the installed app and
use **Settings → About → Check for updates**. Launch checks are also automatic.

Migration locking is raw-byte and append-only. Never edit, delete, rename, or
re-hash a migration that exists on the base branch. Add the next sequential SQL
file and a matching `src-tauri/migrations/migration-lock.json` entry instead;
while that new migration exists only on its feature branch, its SQL and new hash
entry may be revised together. Review against the exact base commit with:

```powershell
node scripts/check-migrations.mjs --baseline-commit <exact-40-character-commit-oid>
```

Test every new migration against a copy of a real database before release. Never
use the live development or pharmacy database for migration testing.

Never lose the private signing key or its password file: without them, updates
cannot be signed. Keep a secure backup of both, separate from the development
machine.
