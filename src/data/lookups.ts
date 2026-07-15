import { getDb } from "../db";
import type { AppSettings, InsuranceGroup, Lookup, Lookups } from "./types";

// Vocabularies are data (design doc §4.3): loaded from SQLite, never hardcoded.
// All rows are loaded (deactivated options must still render on historical rows);
// dropdown editors filter to active === 1 themselves.

async function loadTable(table: string, cols: string): Promise<Lookup[]> {
  const db = await getDb();
  return db.select<Lookup[]>(
    `SELECT id, name, sort_order, active${cols} FROM ${table} ORDER BY sort_order, name`,
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
    followupWaitDays: Number(map.get("followup_wait_days") ?? 5),
    backupFolder: map.get("backup_folder") ?? null,
  };
}

export async function loadLookups(): Promise<Lookups> {
  const db = await getDb();
  const [insurances, insuranceGroups, secondaryCoverages, refillNotes, callNotes, settingRows] =
    await Promise.all([
      loadTable("insurances", ", group_id, is_medicare, is_medicaid"),
      db.select<InsuranceGroup[]>(
        "SELECT id, name, logo, sort_order, active FROM insurance_groups ORDER BY sort_order, name",
      ),
      loadTable("secondary_coverages", ", logo"),
      loadTable("refill_notes", ", color, meaning, allows_call_note, shows_age_counter"),
      loadTable("call_notes", ", color, meaning, requires_followup"),
      db.select<{ key: string; value: string }[]>("SELECT key, value FROM settings"),
    ]);
  return { insurances, insuranceGroups, secondaryCoverages, refillNotes, callNotes, settings: parseSettings(settingRows) };
}
