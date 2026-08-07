import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { DIAGNOSTICS_ENABLED, measure, recordDuration } from "./lib/diagnostics";

const DB_URL = "sqlite:refills.db";

// Single shared connection. The path is relative to the app's config dir
// (%APPDATA%/com.pharmacy.refill-tracker/). Migrations in src-tauri/migrations
// run automatically the first time the database is loaded.
let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load(DB_URL);
  }
  return db;
}

/**
 * Drop the cached connection so the next getDb() reloads. Required after the
 * handle is close()d (restore flow): the cache would otherwise keep handing
 * out the dead connection and every later query would fail until an app
 * restart (SQL review 2026-07-15, finding M5).
 */
export function resetDb(): void {
  db = null;
}

/**
 * Global write chain (SQL review 2026-07-15, M1/M2; ADR 0003): every
 * data-layer write runs strictly after the previous one finished, so
 * read-then-write logic (settle-window merge, delete-when-unused checks, the
 * followup sweep) can never interleave with another write. Reads outside the
 * chain stay concurrent — they only race writes, never corrupt them.
 *
 * Never call a serialized function from inside another serialized op — the
 * inner op would queue behind the outer one and deadlock. Compose with
 * unwrapped helpers instead.
 */
let writeChain: Promise<unknown> = Promise.resolve();

export function serializeWrite<T>(op: () => Promise<T>): Promise<T> {
  // How long this write sat behind the ones already queued. Because every write
  // in the app funnels through here, this number IS the app's global write
  // bottleneck — and nothing else surfaces it. A rising queue wait means writes
  // are arriving faster than SQLite is retiring them.
  const queuedAt = DIAGNOSTICS_ENABLED ? performance.now() : 0;
  const run = writeChain.then(() => {
    if (DIAGNOSTICS_ENABLED) {
      recordDuration("db.write-queue-wait", performance.now() - queuedAt);
    }
    return op();
  });
  writeChain = run.catch(() => {}); // a failed write must not wedge the chain
  return run;
}

export interface SqlStatement {
  sql: string;
  params: unknown[];
}

/**
 * Execute several statements as one all-or-nothing transaction. Goes through
 * the Rust execute_batch command because tauri-plugin-sql pools connections:
 * BEGIN/COMMIT issued as separate execute() calls from here can land on
 * different pooled connections (ADR 0003). A single statement is already
 * atomic in SQLite and stays on the plugin's own path.
 */
export async function executeAtomicBatch(statements: SqlStatement[]): Promise<void> {
  if (statements.length === 0) return;
  // Statement count is the useful dimension here: it separates a cheap two-part
  // edit from a thousand-statement import commit, which is the difference
  // between a fast transaction and one worth optimising.
  await measure(
    "db.transaction",
    async () => {
      const conn = await getDb(); // ensure the pool exists (and migrations ran) first
      if (statements.length === 1) {
        await conn.execute(statements[0].sql, statements[0].params);
        return;
      }
      await invoke("execute_batch", { db: DB_URL, statements });
    },
    { statements: statements.length },
  );
}
