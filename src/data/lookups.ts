import { getDb } from "../db";
import type { AppSettings, Lookup, Lookups } from "./types";

// Vocabularies are data (design doc §4.3): loaded from SQLite, never hardcoded.
// All rows are loaded (deactivated options must still render on historical rows);
// dropdown editors filter to active === 1 themselves.

async function loadTable(table: string, extraCols = ""): Promise<Lookup[]> {
  const db = await getDb();
  return db.select<Lookup[]>(
    `SELECT id, name, color, sort_order, active${extraCols} FROM ${table} ORDER BY sort_order, name`,
  );
}

function parseSettings(rows: { key: string; value: string }[]): AppSettings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    alertLookaheadDays: Number(map.get("alert_lookahead_days") ?? 3),
    alertMinProfit: Number(map.get("alert_min_profit") ?? 50),
    copayTiers: JSON.parse(map.get("copay_tiers") ?? "[]"),
    statusColors: JSON.parse(map.get("status_colors") ?? "{}"),
    nimbleLinkAlertDays: Number(map.get("nimble_link_alert_days") ?? 5),
  };
}

export async function loadLookups(): Promise<Lookups> {
  const db = await getDb();
  const [insurances, secondaryCoverages, refillNotes, callNotes, settingRows] = await Promise.all([
    loadTable("insurances", ", is_medicare_medicaid"),
    loadTable("secondary_coverages"),
    loadTable("refill_notes", ", meaning"),
    loadTable("call_notes", ", meaning"),
    db.select<{ key: string; value: string }[]>("SELECT key, value FROM settings"),
  ]);
  return { insurances, secondaryCoverages, refillNotes, callNotes, settings: parseSettings(settingRows) };
}
