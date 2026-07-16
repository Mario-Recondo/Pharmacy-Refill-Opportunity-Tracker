# 0003 — Multi-statement writes commit through a custom Rust batch command, not JS-side BEGIN/COMMIT

- **Status:** Accepted
- **Date:** 2026-07-16

## Context

The SQL review (2026-07-15, findings M1/M2) required two things before v2 CSV
import raises the stakes on bulk writes: a row update and its event-log write
must commit atomically, and read-then-write sequences (the settle-window merge,
the followup sweep) must not interleave.

The planned fix — serialize writes in JS, then wrap them in `BEGIN`/`COMMIT`
through `tauri-plugin-sql` — turned out to be unimplementable safely.
Inspecting the plugin (v2.4.0) and sqlx (0.8.6) sources showed:

- The plugin holds a **pool of up to 10 SQLite connections**
  (`Pool::connect` with sqlx defaults), and every `execute()`/`select()` call
  grabs whichever connection is free. `BEGIN` and `COMMIT` sent as separate
  calls can land on different connections: no atomicity, plus a stranded open
  transaction.
- sqlx does **not roll back** a raw open transaction when a connection returns
  to the pool (SQLite's on-release `ping()` is only a worker liveness check).
  A stranded transaction sits on the pooled connection holding a write lock,
  and a later unrelated `COMMIT` on that connection would commit the partial
  writes. This also rules out a single multi-statement
  `BEGIN; …; COMMIT` string: the happy path works (one call = one
  connection), but a mid-batch failure strands the transaction the same way.

## Decision

Two layers, each solving what it actually can:

1. **Isolation in JS**: one global write chain (`serializeWrite` in
   `src/db.ts`, generalizing the sweep's proven pattern) through which every
   data-layer write runs. Reads stay concurrent.
2. **Atomicity in Rust**: a generic `execute_batch` Tauri command that borrows
   a connection from the plugin's own pool (`DbInstances`/`DbPool` are public)
   and runs a statement list inside a real sqlx transaction — any failure
   rolls the whole batch back on drop. `executeAtomicBatch` in `src/db.ts` is
   the JS bridge; decision-making reads happen before the batch, which is safe
   because the write chain guarantees nothing writes in between.

## Alternatives considered

- **JS-side `BEGIN`/`COMMIT` via plugin `execute()`** — broken by pooling, as
  above.
- **Single multi-statement SQL string per batch** — atomic on the happy path
  only; a mid-batch failure strands an open transaction on a pooled
  connection with no way to target it for `ROLLBACK` from JS.
- **Move whole flows (edit + event logic) into Rust commands** — sound, but
  duplicates business logic across languages; the generic batch keeps all
  business logic in TypeScript and gives v2 import the same primitive.
- **Compensation (undo the row update if the event write fails)** — no new
  Rust surface, but compensating writes can themselves fail, and it leaves
  the audit trail momentarily wrong instead of never wrong.
- **A second, single-connection database handle just for transactions** —
  `Database.load` offers no pool-size control; same pooling underneath.

## Consequences

- The app now has a direct `sqlx` dependency that must stay version-compatible
  with `tauri-plugin-sql`'s (both resolve through the same lockfile, so drift
  shows up as a compile error, not silent breakage).
- `execute_batch` mirrors the plugin's JSON→SQL bind mapping; if the plugin
  ever changes that mapping, the mirror must follow (values written through
  the two paths must compare equal).
- The write chain is cooperative: a serialized function must never call
  another serialized function (deadlock); composition happens through
  unwrapped helpers. Documented at the definition.
- v2 CSV import gets its transaction primitive for free: build the statement
  list, submit one batch.
