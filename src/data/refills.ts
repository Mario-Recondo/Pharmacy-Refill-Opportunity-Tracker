import { getDb } from "../db";
import { EDITABLE_FIELDS, type EditableField, type RefillRow } from "./types";

/** First day of the month after `ym` ("2026-07" → "2026-08-01"), for half-open date ranges. */
function nextMonthStart(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export async function loadMonth(ym: string): Promise<RefillRow[]> {
  const db = await getDb();
  return db.select<RefillRow[]>(
    `SELECT r.id, r.rx_number, r.drug_id, d.name AS drug_name, d.ndc, r.due_date,
            r.insurance_id, r.secondary_id, r.old_copay, r.new_copay, r.old_profit, r.new_profit,
            r.refills_filled, r.refill_note_id, r.call_note_id, r.refill_note_set_at, r.status, r.notes
     FROM refills r JOIN drugs d ON d.id = r.drug_id
     WHERE r.due_date >= $1 AND r.due_date < $2
     ORDER BY r.due_date, r.id`,
    [`${ym}-01`, nextMonthStart(ym)],
  );
}

/** Rows per month ("2026-07" → count), for the month picker's data-presence indicators. */
export async function loadMonthCounts(): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.select<{ ym: string; n: number }[]>(
    "SELECT substr(due_date, 1, 7) AS ym, COUNT(*) AS n FROM refills GROUP BY ym ORDER BY ym",
  );
  return new Map(rows.map((r) => [r.ym, r.n]));
}

/**
 * Persist a single field immediately (no Save button anywhere — design rule).
 * Changing the refill note also stamps refill_note_set_at, which drives the
 * Nimble Link aging counter; the new stamp is returned so the caller can keep
 * its in-memory row in sync without a reload.
 */
export async function updateRefillField(
  id: number,
  field: EditableField,
  value: unknown,
): Promise<{ refill_note_set_at?: string | null }> {
  if (!EDITABLE_FIELDS.includes(field)) throw new Error(`Field not editable: ${field}`);
  const db = await getDb();
  if (field === "refill_note_id") {
    const setAt = value == null ? null : new Date().toISOString();
    await db.execute(
      "UPDATE refills SET refill_note_id = $1, refill_note_set_at = $2, updated_at = datetime('now') WHERE id = $3",
      [value, setAt, id],
    );
    return { refill_note_set_at: setAt };
  }
  await db.execute(`UPDATE refills SET ${field} = $1, updated_at = datetime('now') WHERE id = $2`, [value, id]);
  return {};
}
