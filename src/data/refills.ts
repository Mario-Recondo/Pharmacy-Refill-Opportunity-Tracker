import { getDb } from "../db";
import { EDITABLE_FIELDS, type Drug, type EditableField, type RefillRow, type RefillStatus } from "./types";

const ROW_SELECT = `SELECT r.id, r.rx_number, r.drug_id, d.name AS drug_name, d.ndc, r.due_date,
        r.insurance_id, r.secondary_id, r.old_copay, r.new_copay, r.old_profit, r.new_profit,
        r.refills_filled, r.refill_note_id, r.call_note_id, r.refill_note_set_at, r.status, r.notes
 FROM refills r JOIN drugs d ON d.id = r.drug_id`;

/** First day of the month after `ym` ("2026-07" → "2026-08-01"), for half-open date ranges. */
function nextMonthStart(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export async function loadMonth(ym: string): Promise<RefillRow[]> {
  const db = await getDb();
  return db.select<RefillRow[]>(
    `${ROW_SELECT} WHERE r.due_date >= $1 AND r.due_date < $2 ORDER BY r.due_date, r.id`,
    [`${ym}-01`, nextMonthStart(ym)],
  );
}

/** All rows sharing an Rx number, newest first — the drawer's history (story 2.3: strictly per rx_number). */
export async function loadRxHistory(rxNumber: string): Promise<RefillRow[]> {
  const db = await getDb();
  return db.select<RefillRow[]>(
    `${ROW_SELECT} WHERE r.rx_number = $1 ORDER BY r.due_date DESC, r.id DESC`,
    [rxNumber],
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

/**
 * Identity fields — rx_number, due_date, drug — change only via the drawer.
 * Callers must run the (rx_number, due_date) duplicate check first; the unique
 * index rejects violations regardless.
 */
export async function updateRefillCore(
  id: number,
  changes: Partial<Pick<RefillRow, "rx_number" | "due_date" | "drug_id">>,
): Promise<void> {
  const fields = Object.keys(changes) as (keyof typeof changes)[];
  if (fields.length === 0) return;
  const db = await getDb();
  const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
  await db.execute(
    `UPDATE refills SET ${sets}, updated_at = datetime('now') WHERE id = $${fields.length + 1}`,
    [...fields.map((f) => changes[f]), id],
  );
}

/** The medication an Rx number already refers to, if any rows exist (one Rx # = one medication, design doc §5). */
export async function loadRxDrug(rxNumber: string): Promise<{ drug_id: number; drug_name: string; ndc: string | null } | null> {
  const db = await getDb();
  const rows = await db.select<{ drug_id: number; drug_name: string; ndc: string | null }[]>(
    `SELECT r.drug_id, d.name AS drug_name, d.ndc FROM refills r JOIN drugs d ON d.id = r.drug_id
     WHERE r.rx_number = $1 ORDER BY r.due_date DESC LIMIT 1`,
    [rxNumber],
  );
  return rows[0] ?? null;
}

/** Correct the medication on every row of an Rx number, keeping the one-Rx-one-drug invariant. */
export async function updateRxDrug(rxNumber: string, drugId: number): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE refills SET drug_id = $1, updated_at = datetime('now') WHERE rx_number = $2", [
    drugId,
    rxNumber,
  ]);
}

/** The existing row occupying an (rx_number, due_date) slot, if any — duplicate protection (story 2.1). */
export async function findRefillByRxDue(rxNumber: string, dueDate: string): Promise<{ id: number } | null> {
  const db = await getDb();
  const rows = await db.select<{ id: number }[]>(
    "SELECT id FROM refills WHERE rx_number = $1 AND due_date = $2",
    [rxNumber, dueDate],
  );
  return rows[0] ?? null;
}

/** All drugs, for the drawer's autocomplete. Small table; loaded whole. */
export async function loadDrugs(): Promise<Drug[]> {
  const db = await getDb();
  return db.select<Drug[]>("SELECT id, name, ndc FROM drugs ORDER BY name");
}

/** Link the named drug, creating it if unknown (NDC optional — compounds have none). */
export async function findOrCreateDrug(name: string, ndc: string | null): Promise<number> {
  const db = await getDb();
  const existing = await db.select<{ id: number }[]>(
    "SELECT id FROM drugs WHERE name = $1 AND ndc IS $2",
    [name, ndc],
  );
  if (existing[0]) return existing[0].id;
  const res = await db.execute("INSERT INTO drugs (name, ndc) VALUES ($1, $2)", [name, ndc]);
  return res.lastInsertId as number;
}

export interface NewRefill {
  rx_number: string;
  drug_id: number;
  due_date: string;
  insurance_id: number | null;
  secondary_id: number | null;
  old_copay: number | null;
  new_copay: number | null;
  old_profit: number | null;
  new_profit: number | null;
  refills_filled: number | null;
  refill_note_id: number | null;
  call_note_id: number | null;
  status: RefillStatus;
  notes: string | null;
}

/** Manual add (flow 4): source = 'manual'; a set refill note is stamped now for the aging counter. */
export async function createRefill(input: NewRefill): Promise<number> {
  const db = await getDb();
  const setAt = input.refill_note_id != null ? new Date().toISOString() : null;
  const res = await db.execute(
    `INSERT INTO refills (rx_number, drug_id, due_date, insurance_id, secondary_id,
       old_copay, new_copay, old_profit, new_profit, refills_filled,
       refill_note_id, call_note_id, refill_note_set_at, status, notes, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'manual')`,
    [
      input.rx_number, input.drug_id, input.due_date, input.insurance_id, input.secondary_id,
      input.old_copay, input.new_copay, input.old_profit, input.new_profit, input.refills_filled,
      input.refill_note_id, input.call_note_id, setAt, input.status, input.notes,
    ],
  );
  return res.lastInsertId as number;
}
