// Write layer for the Settings tab (stories 4.1–4.3). Every function persists
// immediately (no Save buttons); the caller triggers reloadLookups afterwards
// so the whole app re-reads the bundle (design doc §6.6).

import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { executeAtomicBatch, getDb, resetDb, serializeWrite } from "../db";
import type { CopayTier, Lookup } from "./types";

export type LookupTable = "insurances" | "secondary_coverages" | "refill_notes" | "call_notes";

/** Which refills column references each lookup table — drives the delete-when-unused check. */
const REFILL_REF: Record<LookupTable, string> = {
  insurances: "insurance_id",
  secondary_coverages: "secondary_id",
  refill_notes: "refill_note_id",
  call_notes: "call_note_id",
};

// ---------------------------------------------------------------------------
// Generic lookup CRUD
// ---------------------------------------------------------------------------

export function addLookup(table: LookupTable, name: string): Promise<void> {
  // MAX+10 read and the insert share the write chain, so two adds can't pick
  // the same sort_order (SQL review L2 — free once every write serializes)
  return serializeWrite(async () => {
    const db = await getDb();
    const [{ next }] = await db.select<{ next: number }[]>(
      `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM ${table}`,
    );
    await db.execute(`INSERT INTO ${table} (name, sort_order) VALUES ($1, $2)`, [name.trim(), next]);
  });
}

export function renameLookup(table: LookupTable | "insurance_groups", id: number, name: string): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.execute(`UPDATE ${table} SET name = $1 WHERE id = $2`, [name.trim(), id]);
  });
}

export function setLookupActive(table: LookupTable | "insurance_groups", id: number, active: boolean): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.execute(`UPDATE ${table} SET active = $1 WHERE id = $2`, [active ? 1 : 0, id]);
  });
}

export function recolorLookup(table: "refill_notes" | "call_notes", id: number, color: string): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.execute(`UPDATE ${table} SET color = $1 WHERE id = $2`, [color, id]);
  });
}

export function setLookupFlag(
  table: LookupTable | "insurance_groups",
  id: number,
  flag: "allows_call_note" | "shows_age_counter" | "requires_followup" | "is_medicare" | "is_medicaid",
  on: boolean,
): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.execute(`UPDATE ${table} SET ${flag} = $1 WHERE id = $2`, [on ? 1 : 0, id]);
  });
}

/** How many refill rows reference this option — 0 means hard delete is allowed. */
export async function lookupUsageCount(table: LookupTable, id: number): Promise<number> {
  const db = await getDb();
  const [{ n }] = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM refills WHERE ${REFILL_REF[table]} = $1`,
    [id],
  );
  return n;
}

/** Delete-when-unused (grill decision): count check and delete share the write chain (SQL review M4). */
export function deleteLookupIfUnused(table: LookupTable, id: number): Promise<boolean> {
  return serializeWrite(async () => {
    if ((await lookupUsageCount(table, id)) > 0) return false;
    const db = await getDb();
    if (table === "insurances" || table === "secondary_coverages") {
      await executeAtomicBatch([
        { sql: `DELETE FROM import_aliases WHERE kind = $1 AND target_id = $2`, params: [table === "insurances" ? "insurance" : "secondary", id] },
        { sql: `DELETE FROM ${table} WHERE id = $1`, params: [id] },
      ]);
    } else await db.execute(`DELETE FROM ${table} WHERE id = $1`, [id]);
    return true;
  });
}

/** Swap sort_order with a neighbor (up/down buttons — order drives the dropdowns). */
export function swapSortOrder(
  table: LookupTable | "insurance_groups",
  a: { id: number; sort_order: number },
  b: { id: number; sort_order: number },
): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.execute(`UPDATE ${table} SET sort_order = CASE id WHEN $1 THEN $2 WHEN $3 THEN $4 END WHERE id IN ($1, $3)`, [
      a.id,
      b.sort_order,
      b.id,
      a.sort_order,
    ]);
  });
}

// ---------------------------------------------------------------------------
// Insurance groups & plan assignment
// ---------------------------------------------------------------------------

export function addInsuranceGroup(name: string): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    const [{ next }] = await db.select<{ next: number }[]>(
      "SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM insurance_groups",
    );
    await db.execute("INSERT INTO insurance_groups (name, sort_order) VALUES ($1, $2)", [name.trim(), next]);
  });
}

export function setGroupLogo(id: number, logo: string | null): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.execute("UPDATE insurance_groups SET logo = $1 WHERE id = $2", [logo, id]);
  });
}

export async function groupPlanCount(id: number): Promise<number> {
  const db = await getDb();
  const [{ n }] = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM insurances WHERE group_id = $1", [id]);
  return n;
}

/** Groups delete only when empty — plans are never silently orphaned. */
export function deleteGroupIfEmpty(id: number): Promise<boolean> {
  return serializeWrite(async () => {
    const db = await getDb();
    const [group] = await db.select<{ is_default: number }[]>(
      "SELECT is_default FROM insurance_groups WHERE id = $1",
      [id],
    );
    if (!group || group.is_default === 1 || (await groupPlanCount(id)) > 0) return false;
    await db.execute("DELETE FROM insurance_groups WHERE id = $1", [id]);
    return true;
  });
}

/** Move a plan to a group (or NULL = Ungrouped) — the kebab's single-select move. */
export function setInsuranceGroup(insuranceId: number, groupId: number | null): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.execute("UPDATE insurances SET group_id = $1 WHERE id = $2", [groupId, insuranceId]);
  });
}

export function setSecondaryLogo(id: number, logo: string | null): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.execute("UPDATE secondary_coverages SET logo = $1 WHERE id = $2", [logo, id]);
  });
}

// ---------------------------------------------------------------------------
// Settings key/value writes (thresholds, copay tiers, backup folder)
// ---------------------------------------------------------------------------

export function saveSetting(key: string, value: string): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.execute("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2", [
      key,
      value,
    ]);
  });
}

export async function saveCopayTiers(tiers: CopayTier[]): Promise<void> {
  await saveSetting("copay_tiers", JSON.stringify(tiers));
}

// ---------------------------------------------------------------------------
// Backup & restore (story 4.3)
// ---------------------------------------------------------------------------

export async function databasePath(): Promise<string> {
  return join(await appConfigDir(), "refills.db");
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Consistent snapshot while running (acceptance criterion): VACUUM INTO, never a raw file copy. */
async function vacuumInto(folder: string, fileName: string): Promise<string> {
  const db = await getDb();
  const target = await join(folder, fileName);
  // VACUUM INTO takes a string literal; escape quotes rather than bind (not all
  // drivers bind inside VACUUM expressions)
  await db.execute(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

export function backupDatabase(folder: string): Promise<string> {
  // on the write chain so the snapshot never overlaps an in-flight write
  return serializeWrite(() => vacuumInto(folder, `refills-backup-${timestamp()}.db`));
}

/** Sanity check: is the chosen file actually a refill-tracker database? */
export async function validateBackupFile(path: string): Promise<boolean> {
  let candidate: Database | null = null;
  try {
    candidate = await Database.load(`sqlite:${path}`);
    const tables = await candidate.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const names = new Set(tables.map((t) => t.name));
    return ["refills", "insurances", "refill_notes", "call_notes", "settings"].every((t) => names.has(t));
  } catch {
    return false;
  } finally {
    await candidate?.close().catch(() => {});
  }
}

/**
 * Restore flow (design doc §6.6): safety snapshot of the current DB first,
 * then close our connection, overwrite the file and relaunch. Never returns
 * on success — the app restarts.
 */
export function restoreDatabase(backupFile: string, safetyFolder: string): Promise<void> {
  // on the write chain: every earlier write has committed before the
  // connection closes and the file is swapped out from under the pool
  return serializeWrite(async () => {
    await vacuumInto(safetyFolder, `pre-restore-${timestamp()}.db`);
    const db = await getDb();
    await db.close();
    // the handle above is dead either way — drop it from the cache so a failed
    // swap (copy error, permissions) doesn't wedge every later query on a
    // closed connection; the next getDb() reloads whichever file is on disk
    resetDb();
    await invoke("replace_database_and_restart", { source: backupFile });
  });
}

/** All lookup rows a Settings section shows, split active/deactivated in display order. */
export function splitActive<T extends Pick<Lookup, "active">>(rows: T[]): { active: T[]; inactive: T[] } {
  return { active: rows.filter((r) => r.active === 1), inactive: rows.filter((r) => r.active !== 1) };
}
