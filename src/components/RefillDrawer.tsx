import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  createRefill,
  findOrCreateDrug,
  findRefillByRxDue,
  loadDrugs,
  loadRxHistory,
  updateRefillCore,
  updateRefillField,
} from "../data/refills";
import { STATUSES, type Drug, type EditableField, type Lookup, type Lookups, type RefillRow, type RefillStatus } from "../data/types";
import { copayColor, formatMoney, profitStyle, textColorFor } from "../lib/colors";
import { noteQualifiesForCallNote } from "../lib/rules";

export type DrawerMode = { kind: "edit"; row: RefillRow } | { kind: "create"; dueDate: string };

interface DrawerProps {
  mode: DrawerMode;
  lookups: Lookups;
  /** max visible profit from the grid, so drawer profit tints match the grid's relative shading */
  profitMax: number;
  onClose: () => void;
  /** a field on the open row was persisted; dateChanged = due date moved, row may have left the month */
  onRowEdited: (row: RefillRow, dateChanged: boolean) => void;
  onCreated: (id: number, dueDate: string) => void;
  /** jump to another refill row (history click, duplicate-open) */
  onOpenRefill: (id: number, dueDate: string) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${m}/${d}/${y}`;
}

// ---------------------------------------------------------------------------
// Small form controls
// ---------------------------------------------------------------------------

interface ColorOption {
  key: string;
  label: string;
  color: string;
}

function toOptions(list: Lookup[], currentId: number | null): ColorOption[] {
  // deactivated options leave the dropdown but stay valid on the row holding them
  return list
    .filter((l) => l.active === 1 || l.id === currentId)
    .map((l) => ({ key: String(l.id), label: l.name, color: l.color }));
}

function ColorSelect({
  options,
  value,
  onChange,
  allowClear = true,
  disabled = false,
}: {
  options: ColorOption[];
  value: string | null;
  onChange: (key: string | null) => void;
  allowClear?: boolean;
  disabled?: boolean;
}) {
  const sel = options.find((o) => o.key === value);
  return (
    <select
      className="color-select"
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      style={sel && !disabled ? { backgroundColor: sel.color, color: textColorFor(sel.color) } : undefined}
    >
      {allowClear && <option value="">—</option>}
      {options.map((o) => (
        <option key={o.key} value={o.key} style={{ backgroundColor: o.color, color: textColorFor(o.color) }}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function MoneyField({
  value,
  onCommit,
  tint,
}: {
  value: number | null;
  /** return false to signal the save was rejected — the field reverts */
  onCommit: (v: number | null) => void | boolean | Promise<void | boolean>;
  tint?: { backgroundColor: string; color: string };
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  const revert = () => setText(value == null ? "" : String(value));

  const commit = async () => {
    const t = text.replace(/[$,\s]/g, "");
    let n: number | null = null;
    if (t !== "") {
      n = Number(t);
      if (!Number.isFinite(n)) return revert();
    }
    if (n === value) return revert();
    if ((await onCommit(n)) === false) revert();
  };

  return (
    <input
      className="money"
      style={tint}
      value={text}
      placeholder="$"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

// ---------------------------------------------------------------------------
// Drug autocomplete (story 2.1): matches existing drugs; an unknown name can be
// created inline with an optional NDC (compounds have none).
// ---------------------------------------------------------------------------

export type DrugPick = { kind: "existing"; drug: Drug } | { kind: "new"; name: string; ndc: string | null };

function DrugField({
  drugs,
  current,
  onPick,
}: {
  drugs: Drug[];
  current: { name: string; ndc: string | null } | null;
  /** return false to signal the save was rejected — the field reverts */
  onPick: (sel: DrugPick) => void | boolean | Promise<void | boolean>;
}) {
  const [text, setText] = useState(current?.name ?? "");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [ndc, setNdc] = useState("");

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return drugs.slice(0, 8);
    return drugs.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 8);
  }, [drugs, text]);
  const exact = drugs.some((d) => d.name.toLowerCase() === text.trim().toLowerCase());

  const pick = async (sel: DrugPick) => {
    const ok = await onPick(sel);
    if (ok === false) {
      setText(current?.name ?? "");
    } else {
      setText(sel.kind === "existing" ? sel.drug.name : sel.name);
    }
    setOpen(false);
    setCreating(false);
    setNdc("");
  };

  return (
    <div
      className="drug-field"
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setOpen(false);
          setCreating(false);
          setText(current?.name ?? "");
        }
      }}
    >
      <input
        value={text}
        placeholder="Start typing a drug name…"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setCreating(false);
        }}
      />
      {current && !open && (
        <div className="drug-ndc">{current.ndc ? `NDC ${current.ndc}` : "no NDC (compound)"}</div>
      )}
      {open && (
        <div className="drug-options">
          {matches.map((d) => (
            <button key={d.id} type="button" className="drug-option" onClick={() => pick({ kind: "existing", drug: d })}>
              <span>{d.name}</span>
              {d.ndc && <span className="drug-ndc">{d.ndc}</span>}
            </button>
          ))}
          {text.trim() !== "" && !exact && !creating && (
            <button type="button" className="drug-option create" onClick={() => setCreating(true)}>
              ＋ Create new drug “{text.trim()}”
            </button>
          )}
          {creating && (
            <div className="drug-create">
              <input value={ndc} placeholder="NDC (optional — compounds have none)" onChange={(e) => setNdc(e.target.value)} />
              <button type="button" onClick={() => pick({ kind: "new", name: text.trim(), ndc: ndc.trim() || null })}>
                Add drug
              </button>
            </div>
          )}
          {matches.length === 0 && text.trim() === "" && <div className="drug-empty">No drugs yet — type a name to create one</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The drawer
// ---------------------------------------------------------------------------

interface Draft {
  rx_number: string;
  drug: DrugPick | null;
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
  notes: string;
}

export default function RefillDrawer({ mode, lookups, profitMax, onClose, onRowEdited, onCreated, onOpenRefill }: DrawerProps) {
  const editRow = mode.kind === "edit" ? mode.row : null;
  const [, bump] = useReducer((x: number) => x + 1, 0); // re-render after an aborted save so controlled selects snap back

  const [drugs, setDrugs] = useState<Drug[]>([]);
  useEffect(() => {
    loadDrugs().then(setDrugs).catch(console.error);
  }, [mode.kind === "edit" ? mode.row.drug_id : null]);

  // Esc closes (create drafts are never persisted; edit-mode fields are already saved)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ----- create-mode draft ---------------------------------------------------

  const [draft, setDraft] = useState<Draft>(() => ({
    rx_number: "",
    drug: null,
    due_date: mode.kind === "create" ? mode.dueDate : "",
    insurance_id: null,
    secondary_id: null,
    old_copay: null,
    new_copay: null,
    old_profit: null,
    new_profit: null,
    refills_filled: null,
    refill_note_id: null,
    call_note_id: null,
    status: "Pending",
    notes: "",
  }));
  const [dup, setDup] = useState<{ id: number; dueDate: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const dueInputRef = useRef<HTMLInputElement>(null);

  // ----- edit-mode persistence (immediate, like the grid) --------------------

  const saveEditable = async (field: EditableField, value: unknown): Promise<boolean> => {
    const row = editRow!;
    try {
      // call-note gating: never silently wipe a call note (story 1.5)
      if (field === "refill_note_id" && !noteQualifiesForCallNote(value as number | null, lookups) && row.call_note_id != null) {
        const cn = lookups.callNotes.find((c) => c.id === row.call_note_id)?.name ?? "";
        if (!window.confirm(`This refill note doesn't use call notes — the call note "${cn}" will be cleared. Continue?`)) {
          bump();
          return false;
        }
        row.call_note_id = null;
        await updateRefillField(row.id, "call_note_id", null);
      }
      const res = await updateRefillField(row.id, field, value ?? null);
      (row as unknown as Record<string, unknown>)[field] = value ?? null;
      if (res.refill_note_set_at !== undefined) row.refill_note_set_at = res.refill_note_set_at;
      onRowEdited(row, false);
      return true;
    } catch (err) {
      alert(`Save failed — the change was undone.\n${err}`);
      bump();
      return false;
    }
  };

  const saveRx = async (raw: string): Promise<boolean> => {
    const row = editRow!;
    const rx = raw.trim();
    if (rx === row.rx_number) return true;
    if (!rx) return false;
    try {
      const existing = await findRefillByRxDue(rx, row.due_date);
      if (existing && existing.id !== row.id) {
        alert(`Rx # ${rx} already has a row due ${longDate(row.due_date)} — not saved.`);
        return false;
      }
      await updateRefillCore(row.id, { rx_number: rx });
      row.rx_number = rx;
      onRowEdited(row, false);
      return true;
    } catch (err) {
      alert(`Save failed — the change was undone.\n${err}`);
      return false;
    }
  };

  const saveDue = async (iso: string): Promise<boolean> => {
    const row = editRow!;
    if (iso === row.due_date) return true;
    if (!iso) return false;
    try {
      const existing = await findRefillByRxDue(row.rx_number, iso);
      if (existing && existing.id !== row.id) {
        alert(`Rx # ${row.rx_number} already has a row due ${longDate(iso)} — not saved.`);
        return false;
      }
      await updateRefillCore(row.id, { due_date: iso });
      row.due_date = iso;
      onRowEdited(row, true);
      return true;
    } catch (err) {
      alert(`Save failed — the change was undone.\n${err}`);
      return false;
    }
  };

  const saveDrug = async (sel: DrugPick): Promise<boolean> => {
    const row = editRow!;
    try {
      const drugId = sel.kind === "existing" ? sel.drug.id : await findOrCreateDrug(sel.name, sel.ndc);
      if (drugId === row.drug_id) return true;
      await updateRefillCore(row.id, { drug_id: drugId });
      row.drug_id = drugId;
      row.drug_name = sel.kind === "existing" ? sel.drug.name : sel.name;
      row.ndc = sel.kind === "existing" ? sel.drug.ndc : sel.ndc;
      onRowEdited(row, false);
      return true;
    } catch (err) {
      alert(`Save failed — the change was undone.\n${err}`);
      return false;
    }
  };

  // ----- create-mode save (flow 4: duplicate check on save) ------------------

  const draftValid = draft.rx_number.trim() !== "" && draft.drug !== null && draft.due_date !== "";

  const saveDraft = async () => {
    if (!draftValid || saving) return;
    setSaving(true);
    try {
      const existing = await findRefillByRxDue(draft.rx_number.trim(), draft.due_date);
      if (existing) {
        setDup({ id: existing.id, dueDate: draft.due_date });
        return;
      }
      setDup(null);
      const drugId = draft.drug!.kind === "existing" ? draft.drug!.drug.id : await findOrCreateDrug(draft.drug!.name, draft.drug!.ndc);
      const id = await createRefill({
        rx_number: draft.rx_number.trim(),
        drug_id: drugId,
        due_date: draft.due_date,
        insurance_id: draft.insurance_id,
        secondary_id: draft.secondary_id,
        old_copay: draft.old_copay,
        new_copay: draft.new_copay,
        old_profit: draft.old_profit,
        new_profit: draft.new_profit,
        refills_filled: draft.refills_filled,
        refill_note_id: draft.refill_note_id,
        call_note_id: draft.call_note_id,
        status: draft.status,
        notes: draft.notes.trim() || null,
      });
      onCreated(id, draft.due_date);
    } catch (err) {
      alert(`Could not add the refill.\n${err}`);
    } finally {
      setSaving(false);
    }
  };

  // ----- history (story 2.3: strictly per rx_number) -------------------------

  const [history, setHistory] = useState<RefillRow[] | null>(null);
  useEffect(() => {
    if (!editRow) return;
    let stale = false;
    setHistory(null);
    loadRxHistory(editRow.rx_number)
      .then((rows) => {
        if (!stale) setHistory(rows.filter((r) => r.id !== editRow.id));
      })
      .catch(console.error);
    return () => {
      stale = true;
    };
  }, [editRow?.id, editRow?.rx_number]);

  // ----- notes hover popup (story 2.2) ---------------------------------------

  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [showNoteBubble, setShowNoteBubble] = useState(false);

  // ----- render ---------------------------------------------------------------

  const values = editRow ?? draft;
  const refillNoteId = editRow ? editRow.refill_note_id : draft.refill_note_id;
  const callNoteQualifies = noteQualifiesForCallNote(refillNoteId, lookups);

  const setRefillNote = (key: string | null) => {
    const id = key == null ? null : Number(key);
    if (editRow) {
      void saveEditable("refill_note_id", id);
    } else {
      // draft only — nothing persisted yet, so clearing the gated call note is silent
      setDraft((d) => ({ ...d, refill_note_id: id, call_note_id: noteQualifiesForCallNote(id, lookups) ? d.call_note_id : null }));
    }
  };

  const numField = (field: "insurance_id" | "secondary_id" | "call_note_id") => (key: string | null) => {
    const id = key == null ? null : Number(key);
    if (editRow) void saveEditable(field, id);
    else setDraft((d) => ({ ...d, [field]: id }));
  };

  const moneyField = (field: "old_copay" | "new_copay" | "old_profit" | "new_profit") => (v: number | null) => {
    if (editRow) return saveEditable(field, v);
    setDraft((d) => ({ ...d, [field]: v }));
  };

  const copayTint = (v: number | null) => {
    const bg = copayColor(v, lookups.settings.copayTiers);
    return bg ? { backgroundColor: bg, color: textColorFor(bg) } : undefined;
  };

  const notesValue = editRow ? editRow.notes ?? "" : draft.notes;

  return (
    <aside className="drawer" aria-label={editRow ? "Refill details" : "Add refill"}>
      <header className="drawer-header">
        <div>
          <h2>{editRow ? "Refill details" : "Add refill"}</h2>
          {editRow && (
            <div className="drawer-subtitle">
              Rx {editRow.rx_number} · {editRow.drug_name}
            </div>
          )}
        </div>
        <button className="drawer-close" onClick={onClose} title="Close (Esc)">
          ×
        </button>
      </header>

      <div className="drawer-body">
        {dup && (
          <div className="dup-warning">
            <p>
              Rx # {draft.rx_number.trim()} already has a row due {longDate(dup.dueDate)}. A duplicate won't be created.
            </p>
            <div className="dup-actions">
              <button onClick={() => onOpenRefill(dup.id, dup.dueDate)}>Open existing row</button>
              <button
                onClick={() => {
                  setDup(null);
                  dueInputRef.current?.focus();
                }}
              >
                Change due date
              </button>
            </div>
          </div>
        )}

        <div className="drawer-fields">
          <label>
            Rx #
            {editRow ? (
              <input
                key={editRow.id}
                defaultValue={editRow.rx_number}
                onBlur={async (e) => {
                  if (!(await saveRx(e.target.value))) e.target.value = editRow.rx_number;
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              <input value={draft.rx_number} onChange={(e) => setDraft((d) => ({ ...d, rx_number: e.target.value }))} placeholder="Required" />
            )}
          </label>

          <label>
            Due date
            {editRow ? (
              <input
                key={editRow.id}
                type="date"
                defaultValue={editRow.due_date}
                onBlur={async (e) => {
                  if (!(await saveDue(e.target.value))) e.target.value = editRow.due_date;
                }}
              />
            ) : (
              <input
                ref={dueInputRef}
                type="date"
                value={draft.due_date}
                onChange={(e) => setDraft((d) => ({ ...d, due_date: e.target.value }))}
              />
            )}
          </label>

          <label>
            Drug
            <DrugField
              drugs={drugs}
              current={
                editRow
                  ? { name: editRow.drug_name, ndc: editRow.ndc }
                  : draft.drug
                    ? draft.drug.kind === "existing"
                      ? { name: draft.drug.drug.name, ndc: draft.drug.drug.ndc }
                      : { name: draft.drug.name, ndc: draft.drug.ndc }
                    : null
              }
              onPick={(sel) => {
                if (editRow) return saveDrug(sel);
                setDraft((d) => ({ ...d, drug: sel }));
              }}
            />
          </label>

          <label>
            Insurance
            <ColorSelect
              options={toOptions(lookups.insurances, values.insurance_id)}
              value={values.insurance_id == null ? null : String(values.insurance_id)}
              onChange={numField("insurance_id")}
            />
          </label>

          <label>
            Secondary
            <ColorSelect
              options={toOptions(lookups.secondaryCoverages, values.secondary_id)}
              value={values.secondary_id == null ? null : String(values.secondary_id)}
              onChange={numField("secondary_id")}
            />
          </label>

          <label>
            Refill note
            <ColorSelect
              options={toOptions(lookups.refillNotes, refillNoteId)}
              value={refillNoteId == null ? null : String(refillNoteId)}
              onChange={setRefillNote}
            />
          </label>

          <label>
            Call note
            <ColorSelect
              options={toOptions(lookups.callNotes, values.call_note_id)}
              value={values.call_note_id == null ? null : String(values.call_note_id)}
              onChange={numField("call_note_id")}
              disabled={!callNoteQualifies}
            />
            {!callNoteQualifies && <span className="field-hint">Only for Nimble Link / Call Pt</span>}
          </label>

          <div className="field-pair">
            <label>
              Old copay
              <MoneyField value={values.old_copay} onCommit={moneyField("old_copay")} tint={copayTint(values.old_copay)} />
            </label>
            <label>
              New copay
              <MoneyField value={values.new_copay} onCommit={moneyField("new_copay")} tint={copayTint(values.new_copay)} />
            </label>
          </div>

          <div className="field-pair">
            <label>
              Old profit
              <MoneyField value={values.old_profit} onCommit={moneyField("old_profit")} tint={profitStyle(values.old_profit, profitMax)} />
            </label>
            <label>
              New profit
              <MoneyField value={values.new_profit} onCommit={moneyField("new_profit")} tint={profitStyle(values.new_profit, profitMax)} />
            </label>
          </div>

          <div className="field-pair">
            <label>
              Refills filled
              <input
                key={editRow?.id ?? "create"}
                defaultValue={values.refills_filled ?? ""}
                onBlur={(e) => {
                  const t = e.target.value.trim();
                  const n = t === "" ? null : Number(t);
                  if (n !== null && (!Number.isInteger(n) || n < 0)) {
                    e.target.value = values.refills_filled == null ? "" : String(values.refills_filled);
                    return;
                  }
                  if (editRow) void saveEditable("refills_filled", n);
                  else setDraft((d) => ({ ...d, refills_filled: n }));
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            </label>
            <label>
              Status
              <ColorSelect
                options={STATUSES.map((s) => ({ key: s, label: s, color: lookups.settings.statusColors[s] ?? "#eeeeee" }))}
                value={values.status}
                onChange={(key) => {
                  const s = (key ?? "Pending") as RefillStatus;
                  if (editRow) void saveEditable("status", s);
                  else setDraft((d) => ({ ...d, status: s }));
                }}
                allowClear={false}
              />
            </label>
          </div>
        </div>

        <div
          className="notes-wrap"
          onMouseEnter={() => {
            const ta = notesRef.current;
            if (ta && notesValue && ta.scrollHeight > ta.clientHeight + 2) setShowNoteBubble(true);
          }}
          onMouseLeave={() => setShowNoteBubble(false)}
        >
          <label>
            Notes
            <textarea
              ref={notesRef}
              key={editRow?.id ?? "create"}
              rows={3}
              defaultValue={notesValue}
              onChange={(e) => {
                if (!editRow) setDraft((d) => ({ ...d, notes: e.target.value }));
              }}
              onBlur={(e) => {
                if (editRow && e.target.value !== (editRow.notes ?? "")) {
                  void saveEditable("notes", e.target.value.trim() || null);
                }
              }}
            />
          </label>
          {showNoteBubble && <div className="notes-bubble">{notesRef.current?.value}</div>}
        </div>

        {editRow && (
          <section className="history">
            <h3>History — Rx {editRow.rx_number}</h3>
            {history === null && <div className="history-empty">Loading…</div>}
            {history?.length === 0 && <div className="history-empty">No other rows for this Rx number.</div>}
            {history?.map((r) => {
              const rn = lookups.refillNotes.find((n) => n.id === r.refill_note_id)?.name;
              const cn = lookups.callNotes.find((n) => n.id === r.call_note_id)?.name;
              const sc = lookups.settings.statusColors[r.status] ?? "#eeeeee";
              return (
                <button key={r.id} type="button" className="history-row" onClick={() => onOpenRefill(r.id, r.due_date)} title="Open this row">
                  <div className="history-top">
                    <span className="history-date">{longDate(r.due_date)}</span>
                    <span className="history-status" style={{ backgroundColor: sc, color: textColorFor(sc) }}>
                      {r.status}
                    </span>
                  </div>
                  <div className="history-line">
                    Copay {formatMoney(r.old_copay) || "—"} → {formatMoney(r.new_copay) || "—"} · Profit {formatMoney(r.old_profit) || "—"} →{" "}
                    {formatMoney(r.new_profit) || "—"}
                  </div>
                  {(rn || cn) && (
                    <div className="history-line">
                      {rn}
                      {cn ? ` · ${cn}` : ""}
                    </div>
                  )}
                  {r.notes && <div className="history-notes">{r.notes}</div>}
                </button>
              );
            })}
          </section>
        )}
      </div>

      {!editRow && (
        <footer className="drawer-footer">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!draftValid || saving} onClick={saveDraft} title={draftValid ? undefined : "Rx #, drug and due date are required"}>
            {saving ? "Adding…" : "Add refill"}
          </button>
        </footer>
      )}
    </aside>
  );
}
