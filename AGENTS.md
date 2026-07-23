# Refill Tracker Repository Guidance

These instructions apply to the entire repository.

## Authoritative project sources

- `Design_docs/refill-tracker-design.md` is the product and data-model spec.
- `Design_docs/user_stories.md` contains acceptance criteria.
- `Design_docs/user_flows.md` describes the technician workflows; Flow 2 is the
  core daily loop.
- Screenshots in `Design_docs/` are ground truth for pharmacy vocabulary and
  established business color meanings.
- `Design_docs/adr/` records accepted, costly trade-offs. Follow
  `Design_docs/adr/README.md` when a new decision genuinely requires an ADR.
- `STATUS.md` is the current snapshot. Files under `Design_docs/archive/` are
  historical context, not active instructions.

## Product constraints

- Months are data, not separate tables. `(rx_number, due_date)` is the refill
  natural key.
- Import upserts may fill only missing fields; never overwrite technician-entered
  values.
- Profit is verified, never predicted: `old_profit` is the last verified profit
  and `new_profit` is manual-only.
- Insurance, secondary-coverage, refill-note, and call-note vocabularies are
  editable data. Do not hardcode them in components.
- Edits persist immediately. Do not add Save buttons; confirm only destructive
  actions.
- Preserve the established meanings of copay-tier colors, note/status colors,
  and profit shading. Chrome may change; business colors may not.

## Data and migration safety

- Never edit, delete, rename, reorder, or re-hash a migration already present on
  the base branch. Add the next sequential migration, register it in
  `src-tauri/src/lib.rs`, and update
  `src-tauri/migrations/migration-lock.json`.
- Never use the normal development or pharmacy database for tests, migration
  trials, automated UI work, seeding, or restore experiments. Use an isolated
  temporary database or a disposable copy of real data.
- Do not delete, replace, restore, seed, or directly edit
  `%APPDATA%/com.pharmacy.refill-tracker/refills.db` without explicit user
  authorization. Treat real exports, database copies, notes, and screenshots as
  sensitive pharmacy data.
- Test every new migration against a copy of a real database before release.
  Never test it against the live file.

## Working-tree and external-action safety

- Inspect the working tree before editing. Preserve all pre-existing changes and
  untracked files unless the user explicitly asks to alter them.
- Do not commit, push, merge, publish, create a pull request, create a release,
  or change remote settings without explicit user authorization for that action.
- When authorized to commit, work on a feature branch and never commit directly
  to `main`. Do not add AI-attribution lines to commits or pull-request text.
- Keep accepted behavior in the design docs; do not use status or finding files
  as a substitute for the product spec.

## Validation

Run checks proportional to the change. Before handing off code or release-related
work, run the applicable full set:

```powershell
pnpm check:migrations
pnpm test:migration-guard
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Use PowerShell for Tauri release builds. `scripts/release.ps1` signs, stages, and
publishes an update; run it only when the user explicitly authorizes a release,
from a clean `main` after the intended changes are merged. Never expose signing
keys or their password file.
