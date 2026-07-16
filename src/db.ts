import Database from "@tauri-apps/plugin-sql";

// Single shared connection. The path is relative to the app's config dir
// (%APPDATA%/com.pharmacy.refill-tracker/). Migrations in src-tauri/migrations
// run automatically the first time the database is loaded.
let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:refills.db");
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
