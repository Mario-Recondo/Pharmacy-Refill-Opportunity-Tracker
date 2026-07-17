// In-memory SQLite standing in for the Tauri stack under vitest. The point is
// fidelity to the real data layer: the ACTUAL migration files from
// src-tauri/migrations build the schema and seed the vocabularies, and the
// data-layer functions run their real SQL against it — the business rules live
// in those SQL strings, so mocking query results would test nothing.
//
// Driver is node:sqlite (built into Node ≥ 22.13; stable enough for tests) —
// no native dependency to compile. Known fidelity limits, accepted: it is not
// byte-for-byte the sqlx-bundled SQLite the app ships, and the Rust
// execute_batch command's transaction handling is emulated here (real one
// verified live, ADR 0003). Everything above the driver — schema, seeds,
// queries, parameter binding — is the real thing.
//
// vitest.config.ts aliases "@tauri-apps/plugin-sql" and "@tauri-apps/api/core"
// to the stubs in ../stubs, which route into this module's current database.

import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resetDb } from "../../src/db";

const MIGRATIONS_DIR = join(process.cwd(), "src-tauri", "migrations");

let current: DatabaseSync | null = null;
let rxCounter = 0;

/** The live in-memory database, for direct seeding/assertions in tests. */
export function rawDb(): DatabaseSync {
  if (!current) throw new Error("call freshDb() in beforeEach first");
  return current;
}

/**
 * Fresh in-memory DB with all real migrations applied, and the app's cached
 * connection dropped so the next getDb() picks this one up. Call in beforeEach.
 */
export function freshDb(): void {
  current?.close();
  current = new DatabaseSync(":memory:");
  current.exec("PRAGMA foreign_keys = ON"); // sqlx enforces FKs; match it
  for (const f of readdirSync(MIGRATIONS_DIR).sort()) {
    if (f.endsWith(".sql")) current.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  }
  rxCounter = 0;
  resetDb();
}

/** The data layer binds positionally as $1..$n; node:sqlite wants named keys.
 *  Params arrive as unknown[] but are always number | string | null in practice. */
function namedParams(params: unknown[]): Record<string, SQLInputValue> {
  const out: Record<string, SQLInputValue> = {};
  params.forEach((v, i) => {
    out[`$${i + 1}`] = (v === undefined ? null : v) as SQLInputValue;
  });
  return out;
}

/** Duck-type of the tauri-plugin-sql Database surface the data layer uses. */
export const fakeDatabase = {
  async select<T>(sql: string, params: unknown[] = []): Promise<T> {
    const stmt = rawDb().prepare(sql);
    return (params.length ? stmt.all(namedParams(params)) : stmt.all()) as T;
  },
  async execute(sql: string, params: unknown[] = []): Promise<{ lastInsertId: number; rowsAffected: number }> {
    const stmt = rawDb().prepare(sql);
    const r = params.length ? stmt.run(namedParams(params)) : stmt.run();
    return { lastInsertId: Number(r.lastInsertRowid), rowsAffected: Number(r.changes) };
  },
  async close(): Promise<boolean> {
    return true;
  },
};

/** Stand-in for the Rust execute_batch command: all-or-nothing transaction. */
export function runBatchInTransaction(statements: { sql: string; params: unknown[] }[]): void {
  const db = rawDb();
  db.exec("BEGIN");
  try {
    for (const s of statements) {
      const stmt = db.prepare(s.sql);
      if (s.params.length) stmt.run(namedParams(s.params));
      else stmt.run();
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Seeding helpers — thin sugar over the migrated schema's real vocabularies
// ---------------------------------------------------------------------------

function one<T>(sql: string, ...params: unknown[]): T {
  const stmt = rawDb().prepare(sql);
  const row = (params.length ? stmt.get(namedParams(params)) : stmt.get()) as T | undefined;
  if (row === undefined) throw new Error(`no row: ${sql}`);
  return row;
}

/** Lookup id by name from the migration-seeded vocabulary tables. */
export function noteId(table: "refill_notes" | "call_notes", name: string): number {
  return one<{ id: number }>(`SELECT id FROM ${table} WHERE name = $1`, name).id;
}

/** Some call note the technician did NOT flag requires_followup (e.g. paid). */
export function unflaggedCallNoteId(): number {
  return one<{ id: number }>("SELECT id FROM call_notes WHERE requires_followup = 0 ORDER BY id LIMIT 1").id;
}

export interface SeedRefill {
  rx?: string;
  drug?: string;
  due: string; // ISO yyyy-mm-dd
  status?: "Pending" | "Checked Out" | "MISSED";
  old_copay?: number | null;
  new_copay?: number | null;
  old_profit?: number | null;
  new_profit?: number | null;
  /** call note by NAME from the seeded vocabulary (e.g. "LVM+RSL") */
  call_note?: string;
  call_note_id?: number;
  call_note_set_at?: string; // ISO timestamp
  refill_note?: string;
}

/** Insert a refill row directly (drug auto-created), returning its id. */
export function seedRefill(o: SeedRefill): number {
  const db = rawDb();
  const drugName = o.drug ?? "Testdrug 10mg";
  db.prepare("INSERT INTO drugs (name, ndc) VALUES ($1, NULL) ON CONFLICT DO NOTHING").run({ $1: drugName });
  const drugId = one<{ id: number }>("SELECT id FROM drugs WHERE name = $1 AND ndc IS NULL", drugName).id;
  const callNoteId = o.call_note_id ?? (o.call_note ? noteId("call_notes", o.call_note) : null);
  const refillNoteId = o.refill_note ? noteId("refill_notes", o.refill_note) : null;
  const r = db
    .prepare(
      `INSERT INTO refills (rx_number, drug_id, due_date, status, old_copay, new_copay, old_profit, new_profit,
         refill_note_id, call_note_id, call_note_set_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual')`,
    )
    .run({
      $1: o.rx ?? `9${String(++rxCounter).padStart(5, "0")}`,
      $2: drugId,
      $3: o.due,
      $4: o.status ?? "Pending",
      $5: o.old_copay ?? null,
      $6: o.new_copay ?? null,
      $7: o.old_profit ?? null,
      $8: o.new_profit ?? null,
      $9: refillNoteId,
      $10: callNoteId,
      $11: o.call_note_set_at ?? null,
    });
  return Number(r.lastInsertRowid);
}

/** ISO timestamp n whole days before now (respects vitest fake time). */
export function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

/** All events for a refill, oldest first, straight from the table. */
export function eventsFor(refillId: number): { id: number; kind: string; old_value: string | null; new_value: string | null; profit: number | null; at: string }[] {
  return rawDb()
    .prepare("SELECT id, kind, old_value, new_value, profit, at FROM refill_events WHERE refill_id = $1 ORDER BY at, id")
    .all({ $1: refillId }) as never;
}
