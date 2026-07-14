// Shared building blocks for the refill grids (month tab + overdue tab):
// column definitions, the immediate-persistence cell-edit handler, and the
// guarded delete. Extracted from MonthView in M4 so the Overdue tab edits
// through the exact same rules instead of a copy.

import { useCallback, useRef } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellClassParams,
  type CellValueChangedEvent,
  type ColDef,
  type ValueFormatterParams,
  type ValueParserParams,
} from "ag-grid-community";
import { deleteRefill, updateRefillField } from "../data/refills";
import { STATUSES, type EditableField, type Lookup, type Lookups, type RefillRow } from "../data/types";
import { copayColor, formatMoney, profitStyle, textColorFor } from "../lib/colors";
import { noteQualifiesForCallNote } from "../lib/rules";
import { PillSelectEditor, RefillNoteRenderer, RxCopyRenderer, type GridCtx, type PillItem } from "./gridParts";

ModuleRegistry.registerModules([AllCommunityModule]);

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dueLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${m}/${d}`;
}

export function toItems(rows: Lookup[], currentId?: number | null): PillItem[] {
  // Deactivated options leave the dropdown but must stay selectable-looking on the row holding them
  return rows
    .filter((r) => r.active === 1 || r.id === currentId)
    .map((r) => ({ value: r.id, label: r.name, color: r.color, meaning: r.meaning }));
}

// dropdown cells open on a single click (technician feedback, 2026-07-11);
// text/numeric cells keep double-click so a stray click doesn't start an edit
export const DROPDOWN_FIELDS = new Set(["insurance_id", "secondary_id", "refill_note_id", "call_note_id", "status"]);

export interface RefillColOpts {
  /** story 1.9: the Nimble Link day counter renders only in the month grid */
  nimbleCounter: boolean;
}

/** Every refill column, keyed by name — each grid assembles its own subset/order. */
export function refillCols(lookups: Lookups, opts: RefillColOpts) {
  const lookupCell = (list: Lookup[]) => (p: CellClassParams<RefillRow>) => {
    const item = list.find((l) => l.id === p.value);
    return item ? { backgroundColor: item.color, color: textColorFor(item.color) } : undefined;
  };
  const lookupName = (list: Lookup[]) => (p: ValueFormatterParams<RefillRow>) =>
    list.find((l) => l.id === p.value)?.name ?? "";
  const moneyParser = (p: ValueParserParams<RefillRow>) => {
    const t = String(p.newValue ?? "").replace(/[$,\s]/g, "");
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : p.oldValue;
  };
  const copayCol = (field: "old_copay" | "new_copay", headerName: string): ColDef<RefillRow> => ({
    field,
    headerName,
    width: 110,
    editable: true,
    valueParser: moneyParser,
    valueFormatter: (p) => formatMoney(p.value),
    cellStyle: (p) => {
      const bg = copayColor(p.value, lookups.settings.copayTiers);
      return bg ? { backgroundColor: bg, color: textColorFor(bg) } : undefined;
    },
    type: "rightAligned",
  });
  const profitCol = (field: "old_profit" | "new_profit", headerName: string): ColDef<RefillRow> => ({
    field,
    headerName,
    width: 110,
    editable: true,
    valueParser: moneyParser,
    valueFormatter: (p) => formatMoney(p.value),
    cellStyle: (p) => profitStyle(p.value, (p.context as GridCtx).profitMax),
    type: "rightAligned",
  });

  return {
    rx: {
      field: "rx_number",
      headerName: "Rx #",
      pinned: "left",
      width: 118,
      cellRenderer: RxCopyRenderer,
      sortable: false,
    } as ColDef<RefillRow>,
    drug: {
      field: "drug_name",
      headerName: "Drug",
      pinned: "left",
      width: 210,
      tooltipField: "drug_name",
      cellClass: "open-drawer",
    } as ColDef<RefillRow>,
    due: {
      field: "due_date",
      headerName: "Due",
      width: 105,
      valueFormatter: (p) => (p.value ? dueLabel(p.value) : ""),
      cellClass: "open-drawer",
    } as ColDef<RefillRow>,
    insurance: {
      field: "insurance_id",
      headerName: "Insurance",
      width: 170,
      editable: true,
      cellEditor: PillSelectEditor,
      cellEditorPopup: true,
      cellEditorParams: { items: toItems(lookups.insurances), allowClear: true },
      valueFormatter: lookupName(lookups.insurances),
      cellStyle: lookupCell(lookups.insurances),
      comparator: (a, b) => {
        const name = (id: number | null) => lookups.insurances.find((i) => i.id === id)?.name ?? "";
        return name(a).localeCompare(name(b));
      },
    } as ColDef<RefillRow>,
    secondary: {
      field: "secondary_id",
      headerName: "Secondary",
      width: 130,
      editable: true,
      cellEditor: PillSelectEditor,
      cellEditorPopup: true,
      cellEditorParams: { items: toItems(lookups.secondaryCoverages), allowClear: true },
      valueFormatter: lookupName(lookups.secondaryCoverages),
      cellStyle: lookupCell(lookups.secondaryCoverages),
    } as ColDef<RefillRow>,
    refillNote: {
      field: "refill_note_id",
      headerName: "Refill Note",
      width: 160,
      editable: true,
      cellEditor: PillSelectEditor,
      cellEditorPopup: true,
      cellEditorParams: { items: toItems(lookups.refillNotes), allowClear: true },
      ...(opts.nimbleCounter
        ? { cellRenderer: RefillNoteRenderer }
        : { valueFormatter: lookupName(lookups.refillNotes) }),
      cellStyle: lookupCell(lookups.refillNotes),
      comparator: (a, b) => {
        const order = (id: number | null) => lookups.refillNotes.find((n) => n.id === id)?.sort_order ?? 9999;
        return order(a) - order(b);
      },
    } as ColDef<RefillRow>,
    callNote: {
      field: "call_note_id",
      headerName: "Call Note",
      width: 170,
      editable: (p) => noteQualifiesForCallNote(p.data?.refill_note_id, lookups),
      cellEditor: PillSelectEditor,
      cellEditorPopup: true,
      cellEditorParams: { items: toItems(lookups.callNotes), allowClear: true },
      valueFormatter: lookupName(lookups.callNotes),
      cellStyle: (p) => {
        if (!noteQualifiesForCallNote(p.data?.refill_note_id, lookups)) {
          return { backgroundColor: "#f2f2f2", color: "#bbb" };
        }
        return lookupCell(lookups.callNotes)(p);
      },
      cellClass: (p) => (noteQualifiesForCallNote(p.data?.refill_note_id, lookups) ? undefined : "gated"),
    } as ColDef<RefillRow>,
    oldCopay: copayCol("old_copay", "Old Copay"),
    newCopay: copayCol("new_copay", "New Copay"),
    oldProfit: profitCol("old_profit", "Old Profit"),
    newProfit: profitCol("new_profit", "New Profit"),
    refillsFilled: {
      field: "refills_filled",
      headerName: "Refills",
      width: 85,
      editable: true,
      valueParser: (p) => {
        const t = String(p.newValue ?? "").trim();
        if (t === "") return null;
        const n = Number(t);
        return Number.isInteger(n) && n >= 0 ? n : p.oldValue;
      },
      type: "rightAligned",
    } as ColDef<RefillRow>,
    status: {
      field: "status",
      headerName: "Status",
      width: 125,
      editable: true,
      cellEditor: PillSelectEditor,
      cellEditorPopup: true,
      cellEditorParams: {
        items: STATUSES.map((s) => ({ value: s, label: s, color: lookups.settings.statusColors[s] ?? "#eeeeee" })),
        allowClear: false,
      },
      cellStyle: (p) => {
        const bg = lookups.settings.statusColors[p.value as string];
        return bg ? { backgroundColor: bg, color: textColorFor(bg) } : undefined;
      },
      comparator: (a, b) => STATUSES.indexOf(a) - STATUSES.indexOf(b),
    } as ColDef<RefillRow>,
    notes: {
      field: "notes",
      headerName: "Notes",
      flex: 1,
      minWidth: 180,
      editable: true,
      tooltipField: "notes",
    } as ColDef<RefillRow>,
  };
}

/**
 * Inline-edit handler: immediate persistence, call-note gating (story 1.5),
 * revert on failure. `onMutated` runs after a successful save so the host view
 * can re-derive shading/filters or reload its query.
 */
export function useRefillCellEdit(lookups: Lookups, onMutated: () => void) {
  const revertingRef = useRef(false);
  return useCallback(
    async (e: CellValueChangedEvent<RefillRow>) => {
      if (revertingRef.current) return;
      const field = e.colDef.field as EditableField;
      const row = e.data;
      const persist = async (f: EditableField, v: unknown) => {
        const res = await updateRefillField(row.id, f, v ?? null);
        if (res.refill_note_set_at !== undefined) row.refill_note_set_at = res.refill_note_set_at;
      };
      try {
        // call-note gating: never silently wipe a call note (story 1.5)
        if (field === "refill_note_id" && !noteQualifiesForCallNote(e.newValue, lookups) && row.call_note_id != null) {
          const cn = lookups.callNotes.find((c) => c.id === row.call_note_id)?.name ?? "";
          if (!window.confirm(`This refill note doesn't use call notes — the call note "${cn}" will be cleared. Continue?`)) {
            revertingRef.current = true;
            e.node.setDataValue(field, e.oldValue);
            revertingRef.current = false;
            return;
          }
          row.call_note_id = null;
          await persist("call_note_id", null);
        }
        await persist(field, e.newValue);
      } catch (err) {
        alert(`Save failed — the change was undone.\n${err}`);
        revertingRef.current = true;
        e.node.setDataValue(field, e.oldValue);
        revertingRef.current = false;
        return;
      }
      onMutated();
    },
    [lookups, onMutated],
  );
}

/** Guarded permanent delete (story 2.4): confirm with identifying details, alert on failure. */
export async function confirmDeleteRefill(row: RefillRow): Promise<boolean> {
  const ok = window.confirm(
    `Delete Rx ${row.rx_number} — ${row.drug_name}, due ${dueLabel(row.due_date)}?\nThis permanently removes the row.`,
  );
  if (!ok) return false;
  try {
    await deleteRefill(row.id);
    return true;
  } catch (err) {
    alert(`Delete failed.\n${err}`);
    return false;
  }
}
