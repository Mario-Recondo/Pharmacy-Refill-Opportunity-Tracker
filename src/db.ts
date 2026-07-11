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
