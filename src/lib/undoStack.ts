// Undo for accidental field edits (technician request, 2026-07-24). Pure state
// so the row-boundary rule is unit-testable; the provider owns timers, keys, and
// database writes.
//
// The rule that shapes this: Ctrl+Z applies without asking only to the row the
// technician is already on. Reaching an entry that belongs to any other row
// stops and warns first, so leaning on the key can never walk silently across
// rows undoing work.

import type { EditableField, Lookups } from "../data/types";
import { formatMoney } from "./colors";

/** One field write to reverse. */
export interface UndoStep {
  field: EditableField;
  oldValue: unknown;
}

export interface UndoEntry {
  rowId: number;
  /** Names the row in the toast, e.g. `Rx 428566`. */
  rowLabel: string;
  /** Names the change in the toast, e.g. `Insurance`. */
  fieldLabel: string;
  /** What the undo restores, already formatted for display. */
  restoredLabel: string;
  /**
   * Usually one step. A refill-note change that also cleared a call note
   * records both, so the undo restores the pair together instead of leaving
   * the call note wiped (one of the two reasons AG Grid's own undo stack is
   * unusable here — see ADR 0005).
   */
  steps: UndoStep[];
}

export interface UndoState {
  /** Oldest first; the last entry is the one Ctrl+Z takes next. */
  entries: UndoEntry[];
  /**
   * The row the current undo run belongs to: set after each undo, and set
   * early when a cross-row boundary has been warned about and is awaiting its
   * confirming keypress. Either way it means "this row needs no further
   * confirmation right now".
   */
  armedRowId: number | null;
}

/** Deep enough to fix a mistake noticed a few edits later, shallow enough that
 *  the stack never becomes a history of the shift. */
export const UNDO_LIMIT = 25;

export const emptyUndoState: UndoState = { entries: [], armedRowId: null };

export type UndoDecision =
  | { kind: "empty" }
  | { kind: "confirm-row"; entry: UndoEntry }
  | { kind: "apply"; entry: UndoEntry };

/**
 * What the next Ctrl+Z should do. `contextRowId` is the row the technician is
 * on — the focused grid cell, or the open drawer's row.
 */
export function decideUndo(
  state: UndoState,
  contextRowId: number | null,
): UndoDecision {
  const entry = state.entries[state.entries.length - 1];
  if (!entry) return { kind: "empty" };
  if (entry.rowId === contextRowId || entry.rowId === state.armedRowId) {
    return { kind: "apply", entry };
  }
  return { kind: "confirm-row", entry };
}

/** A new edit ends any undo run, so the next Ctrl+Z is judged fresh. */
export function recordEdit(state: UndoState, entry: UndoEntry): UndoState {
  return {
    entries: [...state.entries, entry].slice(-UNDO_LIMIT),
    armedRowId: null,
  };
}

/** Arms the warned row so the confirming keypress goes through. */
export function armRow(state: UndoState, rowId: number): UndoState {
  return { ...state, armedRowId: rowId };
}

/** Drops the entry that was just undone, keeping its row armed so continuing
 *  down the same row needs no further confirmation. */
export function afterUndo(state: UndoState, entry: UndoEntry): UndoState {
  return { entries: state.entries.slice(0, -1), armedRowId: entry.rowId };
}

/** Lets a stale warning expire, so a much later keypress re-confirms. */
export function disarm(state: UndoState): UndoState {
  return state.armedRowId === null ? state : { ...state, armedRowId: null };
}

const MONEY_FIELDS = new Set<EditableField>([
  "old_copay",
  "new_copay",
  "old_profit",
  "new_profit",
]);

/** Renders a restored value the way the technician sees it in the grid. */
export function describeFieldValue(
  field: EditableField,
  value: unknown,
  lookups: Lookups,
): string {
  if (value == null || value === "") return "empty";
  if (MONEY_FIELDS.has(field)) return formatMoney(value as number);
  const named = (list: { id: number; name: string }[]) =>
    list.find((item) => item.id === value)?.name ?? String(value);
  switch (field) {
    case "insurance_id":
      return named(lookups.insurances);
    case "secondary_id":
      return named(lookups.secondaryCoverages);
    case "refill_note_id":
      return named(lookups.refillNotes);
    case "call_note_id":
      return named(lookups.callNotes);
    default:
      return String(value);
  }
}
