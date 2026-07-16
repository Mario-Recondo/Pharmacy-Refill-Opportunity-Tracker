import { getDb } from "../db";
import {
  EDITABLE_FIELDS,
  type Drug,
  type EditableField,
  type RefillEvent,
  type RefillEventKind,
  type RefillRow,
  type RefillStatus,
} from "./types";

const ROW_SELECT = `SELECT r.id, r.rx_number, r.drug_id, d.name AS drug_name, d.ndc, r.due_date,
        r.insurance_id, r.secondary_id, r.old_copay, r.new_copay, r.old_profit, r.new_profit,
        r.refills_filled, r.refill_note_id, r.call_note_id, r.refill_note_set_at, r.call_note_set_at,
        r.status, r.notes
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

export interface OpportunitySet {
  rows: RefillRow[];
  /** latest due_date anywhere in the data — drives the data-horizon hint (story 3.3) */
  maxDue: string | null;
}

/**
 * High-value refills coming due (story 3.3): Pending, no verified new profit yet,
 * last verified profit (old_profit) at or above the alert threshold, due inside
 * [fromIso, toIso]. Highest last profit first.
 */
export async function loadOpportunities(fromIso: string, toIso: string, minProfit: number): Promise<OpportunitySet> {
  const db = await getDb();
  const [rows, mx] = await Promise.all([
    db.select<RefillRow[]>(
      `${ROW_SELECT}
       WHERE r.status = 'Pending' AND r.new_profit IS NULL AND r.old_profit >= $1
         AND r.due_date >= $2 AND r.due_date <= $3
       ORDER BY r.old_profit DESC, r.due_date, r.id`,
      [minProfit, fromIso, toIso],
    ),
    db.select<{ max_due: string | null }[]>("SELECT MAX(due_date) AS max_due FROM refills"),
  ]);
  return { rows, maxDue: mx[0]?.max_due ?? null };
}

/** Local calendar date as ISO yyyy-mm-dd (due dates are date-only; UTC would flip the day near midnight). */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Overdue tab (story 1.7): Pending rows past their due date plus every MISSED row, all months, oldest first. */
export async function loadOverdue(today: string): Promise<RefillRow[]> {
  const db = await getDb();
  return db.select<RefillRow[]>(
    `${ROW_SELECT} WHERE (r.status = 'Pending' AND r.due_date < $1) OR r.status = 'MISSED'
     ORDER BY r.due_date, r.id`,
    [today],
  );
}

/**
 * Actionable overdue count for the tab badge — Pending past-due only. MISSED rows
 * stay in the tab forever as the permanent record, so counting them would grow the
 * badge unboundedly and bury the "work this now" signal.
 */
export async function loadOverduePendingCount(today: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM refills WHERE status = 'Pending' AND due_date < $1",
    [today],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Whole local-calendar days since a call note was last set — the Req Follow Up
 * "quiet days" clock. Shared by the membership filter, the badge and the
 * Days-quiet column so all three always agree.
 */
export function daysQuiet(setAtIso: string): number {
  const set = new Date(setAtIso);
  const now = new Date();
  const a = new Date(set.getFullYear(), set.getMonth(), set.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

/**
 * Req Follow Up membership (grill interview 2026-07-15): the tech already did
 * her part (new copay + verified profit > $0, follow-up call note left) but the
 * patient has stayed quiet past the threshold. Pure filter — status is never
 * mutated; a fresh call note re-stamps the clock and pulls the row back off the
 * tab. new_profit > 0 is deliberate: ≤ $0 rows are money we weren't going to
 * make. Default order: newest arrivals first (user decision).
 */
export async function loadReqFollowUp(waitDays: number): Promise<RefillRow[]> {
  const db = await getDb();
  const rows = await db.select<RefillRow[]>(
    `${ROW_SELECT}
     JOIN call_notes cn ON cn.id = r.call_note_id
     WHERE r.status = 'Pending' AND r.new_copay IS NOT NULL AND r.new_profit > 0
       AND cn.requires_followup = 1 AND r.call_note_set_at IS NOT NULL
     ORDER BY r.call_note_set_at DESC, r.id`,
  );
  return rows.filter((r) => daysQuiet(r.call_note_set_at!) > waitDays);
}

/** Req Follow Up tab badge — every listed row is actionable, so all of them count. */
export async function loadReqFollowUpCount(waitDays: number): Promise<number> {
  return (await loadReqFollowUp(waitDays)).length;
}

/** A row's workflow events, newest first — the drawer's Activity section. */
export async function loadRefillEvents(refillId: number): Promise<RefillEvent[]> {
  const db = await getDb();
  return db.select<RefillEvent[]>(
    "SELECT id, refill_id, at, kind, old_value, new_value, profit FROM refill_events WHERE refill_id = $1 ORDER BY at DESC, id DESC",
    [refillId],
  );
}

/**
 * Reconcile followup_entered/followup_left span events against the current
 * qualifying set (analytics record — how long rows sit in follow-up, how they
 * leave). Idempotent and read-mostly; never mutates refills. Runs on launch,
 * after any data change, and on day rollover. Spans of since-deleted rows
 * close here too (they stop qualifying).
 *
 * Sweeps are serialized: two overlapping runs would both read the open-span
 * set before either writes and double-insert span events (seen live under
 * StrictMode's doubled launch effect; any two rapid mutations could race the
 * same way).
 */
let sweepChain: Promise<void> = Promise.resolve();

export function sweepFollowupSpans(waitDays: number): Promise<void> {
  const run = sweepChain.then(() => doSweepFollowupSpans(waitDays));
  sweepChain = run.catch(() => {}); // a failed sweep must not wedge the chain
  return run;
}

async function doSweepFollowupSpans(waitDays: number): Promise<void> {
  const db = await getDb();
  const qualifying = new Set((await loadReqFollowUp(waitDays)).map((r) => r.id));
  const events = await db.select<{ refill_id: number; kind: string }[]>(
    "SELECT refill_id, kind FROM refill_events WHERE kind IN ('followup_entered', 'followup_left') ORDER BY at, id",
  );
  const open = new Set<number>();
  for (const e of events) {
    if (e.kind === "followup_entered") open.add(e.refill_id);
    else open.delete(e.refill_id);
  }
  const now = new Date().toISOString();
  for (const id of qualifying) {
    if (!open.has(id)) {
      await db.execute("INSERT INTO refill_events (refill_id, at, kind) VALUES ($1, $2, 'followup_entered')", [id, now]);
    }
  }
  for (const id of open) {
    if (!qualifying.has(id)) {
      await db.execute("INSERT INTO refill_events (refill_id, at, kind) VALUES ($1, $2, 'followup_left')", [id, now]);
    }
  }
}

/** Rows per month ("2026-07" → count), for the month picker's data-presence indicators. */
export async function loadMonthCounts(): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.select<{ ym: string; n: number }[]>(
    "SELECT substr(due_date, 1, 7) AS ym, COUNT(*) AS n FROM refills GROUP BY ym ORDER BY ym",
  );
  return new Map(rows.map((r) => [r.ym, r.n]));
}

type Db = Awaited<ReturnType<typeof getDb>>;

/** Display name for a note id, captured at event time — renames must not rewrite history. */
async function noteName(db: Db, table: "refill_notes" | "call_notes", id: number | null): Promise<string | null> {
  if (id == null) return null;
  const rows = await db.select<{ name: string }[]>(`SELECT name FROM ${table} WHERE id = $1`, [id]);
  return rows[0]?.name ?? null;
}

/**
 * Accident-proofing settling window: a change to the same field within this
 * long of the previous one is treated as a correction of that change (merged
 * in place; deleted outright on a full revert), not new history. Anything
 * that survives the window is a real workflow step and stays — "LVM+RSL,
 * then the patient called back and it became P/U" must both show in Activity
 * (user decision 2026-07-15, replacing an earlier same-calendar-day rule that
 * erased exactly that sequence). The window rolls: each merged edit restarts it.
 */
const EVENT_SETTLE_MS = 2 * 60_000;

async function logWorkflowEvent(
  db: Db,
  refillId: number,
  kind: RefillEventKind,
  oldValue: string | null,
  newValue: string | null,
  profit: number | null,
): Promise<void> {
  if (oldValue === newValue) return;
  const now = new Date();
  const windowStart = new Date(now.getTime() - EVENT_SETTLE_MS).toISOString();
  const recent = await db.select<{ id: number; old_value: string | null }[]>(
    `SELECT id, old_value FROM refill_events
     WHERE refill_id = $1 AND kind = $2 AND at >= $3
     ORDER BY at DESC, id DESC LIMIT 1`,
    [refillId, kind, windowStart],
  );
  if (recent[0]) {
    if (recent[0].old_value === newValue) {
      // back where it was before the correction started — the pair cancels out
      await db.execute("DELETE FROM refill_events WHERE id = $1", [recent[0].id]);
    } else {
      await db.execute("UPDATE refill_events SET new_value = $1, at = $2, profit = $3 WHERE id = $4", [
        newValue, now.toISOString(), profit, recent[0].id,
      ]);
    }
    return;
  }
  await db.execute(
    "INSERT INTO refill_events (refill_id, at, kind, old_value, new_value, profit) VALUES ($1, $2, $3, $4, $5, $6)",
    [refillId, now.toISOString(), kind, oldValue, newValue, profit],
  );
}

/**
 * Persist a single field immediately (no Save button anywhere — design rule).
 * Changing the refill note stamps refill_note_set_at (Nimble aging counter);
 * changing the call note stamps call_note_set_at (Req Follow Up quiet-days
 * clock). New stamps are returned so callers keep in-memory rows in sync
 * without a reload. Refill-note, call-note and status changes also append to
 * the event log; a status change to Checked Out snapshots new_profit onto the
 * event ("profit made in <month>" analytics).
 */
export async function updateRefillField(
  id: number,
  field: EditableField,
  value: unknown,
): Promise<{ refill_note_set_at?: string | null; call_note_set_at?: string | null }> {
  if (!EDITABLE_FIELDS.includes(field)) throw new Error(`Field not editable: ${field}`);
  const db = await getDb();

  if (field === "refill_note_id" || field === "call_note_id" || field === "status") {
    const before = (
      await db.select<{ refill_note_id: number | null; call_note_id: number | null; status: RefillStatus; new_profit: number | null }[]>(
        "SELECT refill_note_id, call_note_id, status, new_profit FROM refills WHERE id = $1",
        [id],
      )
    )[0];

    if (field === "refill_note_id") {
      const setAt = value == null ? null : new Date().toISOString();
      await db.execute(
        "UPDATE refills SET refill_note_id = $1, refill_note_set_at = $2, updated_at = datetime('now') WHERE id = $3",
        [value, setAt, id],
      );
      if (before) {
        const oldName = await noteName(db, "refill_notes", before.refill_note_id);
        const newName = await noteName(db, "refill_notes", (value as number | null) ?? null);
        await logWorkflowEvent(db, id, "refill_note", oldName, newName, null);
      }
      return { refill_note_set_at: setAt };
    }

    if (field === "call_note_id") {
      const setAt = value == null ? null : new Date().toISOString();
      await db.execute(
        "UPDATE refills SET call_note_id = $1, call_note_set_at = $2, updated_at = datetime('now') WHERE id = $3",
        [value, setAt, id],
      );
      if (before) {
        const oldName = await noteName(db, "call_notes", before.call_note_id);
        const newName = await noteName(db, "call_notes", (value as number | null) ?? null);
        await logWorkflowEvent(db, id, "call_note", oldName, newName, null);
      }
      return { call_note_set_at: setAt };
    }

    // status
    await db.execute("UPDATE refills SET status = $1, updated_at = datetime('now') WHERE id = $2", [value, id]);
    if (before) {
      const newStatus = value as RefillStatus;
      const profit = newStatus === "Checked Out" ? before.new_profit : null;
      await logWorkflowEvent(db, id, "status", before.status, newStatus, profit);
    }
    return {};
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

/**
 * Link the named drug, creating it if unknown (NDC optional — compounds have
 * none). Atomic get-or-create: ON CONFLICT makes a lost race against a
 * concurrent creator (v2 bulk import) harmless, and the re-read returns the
 * winner's id either way. (UNIQUE treats NULL NDCs as distinct, so the SELECT
 * fast path stays the real guard for compounds.)
 */
export async function findOrCreateDrug(name: string, ndc: string | null): Promise<number> {
  const db = await getDb();
  const find = () =>
    db.select<{ id: number }[]>("SELECT id FROM drugs WHERE name = $1 AND ndc IS $2", [name, ndc]);
  const existing = await find();
  if (existing[0]) return existing[0].id;
  await db.execute("INSERT INTO drugs (name, ndc) VALUES ($1, $2) ON CONFLICT (name, ndc) DO NOTHING", [name, ndc]);
  const created = await find();
  if (!created[0]) throw new Error(`Could not create drug "${name}"`);
  return created[0].id;
}

/** Permanent removal — callers must confirm with the user first (destructive action, design rule). */
export async function deleteRefill(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM refills WHERE id = $1", [id]);
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

/** Manual add (flow 4): source = 'manual'; set notes are stamped now (aging counter / quiet-days clock). */
export async function createRefill(input: NewRefill): Promise<number> {
  const db = await getDb();
  const nowIso = new Date().toISOString();
  const refillNoteSetAt = input.refill_note_id != null ? nowIso : null;
  const callNoteSetAt = input.call_note_id != null ? nowIso : null;
  const res = await db.execute(
    `INSERT INTO refills (rx_number, drug_id, due_date, insurance_id, secondary_id,
       old_copay, new_copay, old_profit, new_profit, refills_filled,
       refill_note_id, call_note_id, refill_note_set_at, call_note_set_at, status, notes, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'manual')`,
    [
      input.rx_number, input.drug_id, input.due_date, input.insurance_id, input.secondary_id,
      input.old_copay, input.new_copay, input.old_profit, input.new_profit, input.refills_filled,
      input.refill_note_id, input.call_note_id, refillNoteSetAt, callNoteSetAt, input.status, input.notes,
    ],
  );
  return res.lastInsertId as number;
}
