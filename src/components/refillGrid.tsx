// Shared building blocks for the refill grids (month tab + overdue tab):
// column definitions, the immediate-persistence cell-edit handler, and the
// guarded delete. Extracted from MonthView in M4 so the Overdue tab edits
// through the exact same rules instead of a copy.

import { useCallback, useRef, useState } from "react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellClassParams,
  type CellValueChangedEvent,
  type ColDef,
  type GridApi,
  type RowClassParams,
  type SortChangedEvent,
  type ValueFormatterParams,
  type ValueParserParams,
} from "ag-grid-community";
import { deleteRefill, updateRefillField } from "../data/refills";
import { STATUSES, type EditableField, type Lookup, type Lookups, type RefillRow } from "../data/types";
import { copayColor, formatMoney, profitStyle, textColorFor } from "../lib/colors";
import { confirmDestructive } from "../lib/confirmDialog";
import { insuranceDisplayName, noteQualifiesForCallNote } from "../lib/rules";
import {
  InsuranceRenderer,
  PillSelectEditor,
  RefillNoteRenderer,
  RxCopyRenderer,
  SecondaryRenderer,
  type GridCtx,
  type PillItem,
} from "./gridParts";

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

/** Insurance dropdown choices: text-only (logos stay in cell display, §6.1) but with the designation suffix. */
export function toInsuranceItems(rows: Lookup[], currentId?: number | null): PillItem[] {
  return rows
    .filter((r) => r.active === 1 || r.id === currentId)
    .map((r) => ({ value: r.id, label: insuranceDisplayName(r) }));
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
    return item?.color ? { backgroundColor: item.color, color: textColorFor(item.color) } : undefined;
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
      width: 190,
      editable: true,
      cellEditor: PillSelectEditor,
      cellEditorPopup: true,
      cellEditorParams: { items: toInsuranceItems(lookups.insurances), allowClear: true },
      cellRenderer: InsuranceRenderer, // logo-or-plain + designation suffix (story 4.5)
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
      cellRenderer: SecondaryRenderer,
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
        if (res.call_note_set_at !== undefined) row.call_note_set_at = res.call_note_set_at;
      };
      try {
        // call-note gating: never silently wipe a call note (story 1.5)
        if (field === "refill_note_id" && !noteQualifiesForCallNote(e.newValue, lookups) && row.call_note_id != null) {
          const cn = lookups.callNotes.find((c) => c.id === row.call_note_id)?.name ?? "";
          const ok = await confirmDestructive(
            `This refill note doesn't use call notes — the call note "${cn}" will be cleared. Continue?`,
            { title: "Clear call note", action: "Clear it" },
          );
          if (!ok) {
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

/**
 * Due-date-first sorting, shared by both grids: tracks whether the grid is in
 * due-date order (day separators draw only then — story 1.1), enforces the
 * date-order lock (story 1.8: due date stays the primary key, other columns
 * sort within each day) and provides Reset sort. An unsorted grid displays
 * query order, which is due-date order.
 */
export function useDueDateSort(apiRef: { current: GridApi<RefillRow> | null }) {
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const lockedDirRef = useRef<"asc" | "desc">("asc");
  const applyingSortRef = useRef(false);
  const dateOrderRef = useRef(true);

  const recomputeDateOrder = useCallback((api: GridApi<RefillRow>) => {
    const sorted = api
      .getColumnState()
      .filter((s) => s.sort)
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
    dateOrderRef.current = sorted.length === 0 || sorted[0].colId === "due_date";
  }, []);

  const enforceLock = useCallback((api: GridApi<RefillRow>) => {
    const sorted = api
      .getColumnState()
      .filter((s) => s.sort)
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
    const due = sorted.find((s) => s.colId === "due_date");
    if (due?.sort === "asc" || due?.sort === "desc") lockedDirRef.current = due.sort;
    const secondary = sorted.find((s) => s.colId !== "due_date");
    applyingSortRef.current = true;
    api.applyColumnState({
      state: [
        { colId: "due_date", sort: lockedDirRef.current, sortIndex: 0 },
        ...(secondary ? [{ colId: secondary.colId, sort: secondary.sort, sortIndex: 1 }] : []),
      ],
      defaultState: { sort: null },
    });
    applyingSortRef.current = false;
  }, []);

  const onSortChanged = useCallback(
    (e: SortChangedEvent<RefillRow>) => {
      if (applyingSortRef.current) return;
      if (lockedRef.current) enforceLock(e.api);
      recomputeDateOrder(e.api);
      e.api.redrawRows(); // spike learning: row classes only compute on draw
    },
    [enforceLock, recomputeDateOrder],
  );

  const toggleLock = useCallback(() => {
    const next = !lockedRef.current;
    setLocked(next);
    lockedRef.current = next;
    const api = apiRef.current;
    if (!api) return;
    if (next) enforceLock(api);
    recomputeDateOrder(api);
    api.redrawRows();
  }, [apiRef, enforceLock, recomputeDateOrder]);

  const resetSort = useCallback(() => {
    setLocked(false);
    lockedRef.current = false;
    lockedDirRef.current = "asc";
    const api = apiRef.current;
    if (!api) return;
    applyingSortRef.current = true;
    api.applyColumnState({ state: [{ colId: "due_date", sort: "asc", sortIndex: 0 }], defaultState: { sort: null } });
    applyingSortRef.current = false;
    recomputeDateOrder(api);
    api.redrawRows();
  }, [apiRef, recomputeDateOrder]);

  /** true when a day-separator line belongs above this row (previous displayed row is a different due date) */
  const isDayBreak = useCallback((params: RowClassParams<RefillRow>): boolean => {
    if (!dateOrderRef.current || params.node.rowIndex == null || params.node.rowIndex === 0) return false;
    const prev = params.api.getDisplayedRowAtIndex(params.node.rowIndex - 1);
    return !!(prev?.data && params.data && prev.data.due_date !== params.data.due_date);
  }, []);

  return { locked, toggleLock, resetSort, onSortChanged, isDayBreak };
}

/** Guarded permanent delete (story 2.4): confirm with identifying details, alert on failure. */
export async function confirmDeleteRefill(row: RefillRow): Promise<boolean> {
  const ok = await confirmDestructive(
    `Delete Rx ${row.rx_number} — ${row.drug_name}, due ${dueLabel(row.due_date)}?\n\nThis permanently removes the row.`,
    { title: "Delete refill", action: "Delete" },
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
