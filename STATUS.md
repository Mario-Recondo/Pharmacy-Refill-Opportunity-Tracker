# Project Status

Last updated: 2026-07-23

## Current product state

- Current pharmacy release: **v1.2.0**, including spreadsheet import and the
  Call List.
- Current schema: migrations `001` through `008`.
- SQLite data lives at
  `%APPDATA%/com.pharmacy.refill-tracker/refills.db`. Treat that file and any
  real PioneerRX export as sensitive pharmacy data.
- The application is a single-user, offline Windows desktop tool with signed
  updater artifacts published through the separate releases repository.

## Quality baseline

- The quality workflow and immutable-migration guard were completed in PR #20.
- The latest recorded validation passed 138 Vitest tests, 18 migration-guard
  tests, the production build, 3 Rust tests, strict Clippy, rustfmt, and the
  production dependency audit.
- Migrations already present on the base branch are immutable. Schema changes
  require the next sequential migration and a matching lock-manifest entry.

## Active work

- Q1 (CI/migration protection) and Q2 (durable agent guidance/state cleanup)
  are complete.
- Next recommended engineering work is Q3: fix restore validation so it cannot
  close the live database pool, add regression coverage, and then harden atomic
  replacement and backup validation.
- Automatic backup cadence and retention remain a separate Q8 product decision;
  do not implement them until the technician-owned questions are answered.

## Open product decisions

The technician-owned questions remain in the local `QUESTIONS.md`. Do not infer
answers or silently turn them into product behavior.

## History

Detailed release narratives and superseded branch handoffs are archived in
`Design_docs/archive/STATUS_HISTORY_THROUGH_2026-07-21.md`. They are context,
not current instructions.

Repository-wide working rules are in `AGENTS.md`. External actions such as
committing, pushing, merging, publishing, or creating a pull request require
explicit user authorization.
