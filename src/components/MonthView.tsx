import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellClassParams,
  type CellClickedEvent,
  type CellValueChangedEvent,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type RowClassParams,
  type SortChangedEvent,
  type ValueFormatterParams,
  type ValueParserParams,
} from "ag-grid-community";
import { loadMonth, loadMonthCounts, updateRefillField } from "../data/refills";
import { STATUSES, type EditableField, type Lookup, type Lookups, type RefillRow, type RefillStatus } from "../data/types";
import { copayColor, formatMoney, profitStyle, textColorFor } from "../lib/colors";
import { PillSelectEditor, RefillNoteRenderer, RxCopyRenderer, type GridCtx, type PillItem } from "./gridParts";

ModuleRegistry.registerModules([AllCommunityModule]);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ymLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function dueLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${m}/${d}`;
}

/** Call notes only apply when the refill note is Nimble Link / Call Pt (design doc §5). */
function noteQualifiesForCallNote(refillNoteId: number | null | undefined, lookups: Lookups): boolean {
  if (refillNoteId == null) return false;
  const name = lookups.refillNotes.find((n) => n.id === refillNoteId)?.name;
  return name === "Nimble Link" || name === "Call Pt";
}

function toItems(rows: Lookup[], currentId?: number | null): PillItem[] {
  // Deactivated options leave the dropdown but must stay selectable-looking on the row holding them
  return rows
    .filter((r) => r.active === 1 || r.id === currentId)
    .map((r) => ({ value: r.id, label: r.name, color: r.color, meaning: r.meaning }));
}

interface Filters {
  day: string | null; // ISO date within the month
  insuranceId: number | null;
  status: RefillStatus | null;
  unresolvedOnly: boolean;
}

const NO_FILTERS: Filters = { day: null, insuranceId: null, status: null, unresolvedOnly: false };

// dropdown cells open on a single click (technician feedback, 2026-07-11);
// text/numeric cells keep double-click so a stray click doesn't start an edit
const DROPDOWN_FIELDS = new Set(["insurance_id", "secondary_id", "refill_note_id", "call_note_id", "status"]);

export default function MonthView({ lookups }: { lookups: Lookups }) {
  const [ym, setYm] = useState(currentYm);
  const [rows, setRows] = useState<RefillRow[]>([]);
  const [monthCounts, setMonthCounts] = useState<Map<string, number>>(new Map());
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showSecondary, setShowSecondary] = useState(false);
  const [locked, setLocked] = useState(false);

  const apiRef = useRef<GridApi<RefillRow> | null>(null);
  const lockedRef = useRef(false);
  const lockedDirRef = useRef<"asc" | "desc">("asc");
  const applyingSortRef = useRef(false);
  const dateOrderRef = useRef(true);
  const revertingRef = useRef(false);

  useEffect(() => {
    loadMonth(ym).then(setRows).catch((e) => alert(`Failed to load ${ym}: ${e}`));
    setFilters(NO_FILTERS);
  }, [ym]);

  useEffect(() => {
    loadMonthCounts().then(setMonthCounts).catch(console.error);
  }, []);

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (filters.day === null || r.due_date === filters.day) &&
          (filters.insuranceId === null || r.insurance_id === filters.insuranceId) &&
          (filters.status === null || r.status === filters.status) &&
          (!filters.unresolvedOnly || r.status === "Pending"),
      ),
    [rows, filters],
  );

  // Relative profit shading (story 3.2): brightest green = max among visible rows
  const profitMax = useMemo(() => {
    let max = 0;
    for (const r of filteredRows) {
      if (r.old_profit != null && r.old_profit > max) max = r.old_profit;
      if (r.new_profit != null && r.new_profit > max) max = r.new_profit;
    }
    return max;
  }, [filteredRows]);

  const ctxRef = useRef<GridCtx>({ lookups, profitMax: 0 });
  ctxRef.current.lookups = lookups;
  ctxRef.current.profitMax = profitMax;

  useEffect(() => {
    // shading is relative to the visible set; day separators depend on neighbors —
    // both are computed at draw time, so redraw when the visible set changes
    apiRef.current?.refreshCells({ force: true });
    apiRef.current?.redrawRows();
  }, [filteredRows, profitMax]);

  // ----- sorting: day separators + due-date lock ---------------------------

  const recomputeDateOrder = useCallback((api: GridApi<RefillRow>) => {
    const sorted = api
      .getColumnState()
      .filter((s) => s.sort)
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
    // unsorted grid displays query order, which is due-date order
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

  const toggleLock = () => {
    const next = !locked;
    setLocked(next);
    lockedRef.current = next;
    const api = apiRef.current;
    if (!api) return;
    if (next) enforceLock(api);
    recomputeDateOrder(api);
    api.redrawRows();
  };

  const resetSort = () => {
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
  };

  // day separators only while the grid is in due-date order (story 1.1)
  const getRowClass = useCallback((params: RowClassParams<RefillRow>): string | undefined => {
    if (!dateOrderRef.current || params.node.rowIndex == null || params.node.rowIndex === 0) return undefined;
    const prev = params.api.getDisplayedRowAtIndex(params.node.rowIndex - 1);
    return prev?.data && params.data && prev.data.due_date !== params.data.due_date ? "day-break" : undefined;
  }, []);

  // ----- edits: immediate persistence + business rules ---------------------

  const persist = useCallback(async (row: RefillRow, field: EditableField, value: unknown) => {
    const res = await updateRefillField(row.id, field, value ?? null);
    if (res.refill_note_set_at !== undefined) row.refill_note_set_at = res.refill_note_set_at;
  }, []);

  const onCellValueChanged = useCallback(
    async (e: CellValueChangedEvent<RefillRow>) => {
      if (revertingRef.current) return;
      const field = e.colDef.field as EditableField;
      const row = e.data;
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
          await persist(row, "call_note_id", null);
        }
        await persist(row, field, e.newValue);
      } catch (err) {
        alert(`Save failed — the change was undone.\n${err}`);
        revertingRef.current = true;
        e.node.setDataValue(field, e.oldValue);
        revertingRef.current = false;
        return;
      }
      setRows((prev) => [...prev]); // re-derive filters/shading from the mutated row
    },
    [lookups, persist],
  );

  // ----- columns ------------------------------------------------------------

  const columnDefs = useMemo<ColDef<RefillRow>[]>(() => {
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

    return [
      {
        field: "rx_number",
        headerName: "Rx #",
        pinned: "left",
        width: 118,
        cellRenderer: RxCopyRenderer,
        sortable: false,
      },
      {
        field: "drug_name",
        headerName: "Drug",
        pinned: "left",
        width: 210,
        tooltipField: "drug_name",
      },
      {
        field: "due_date",
        headerName: "Due",
        width: 105,
        valueFormatter: (p) => (p.value ? dueLabel(p.value) : ""),
      },
      {
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
      },
      {
        field: "secondary_id",
        headerName: "Secondary",
        width: 130,
        hide: !showSecondary,
        editable: true,
        cellEditor: PillSelectEditor,
        cellEditorPopup: true,
        cellEditorParams: { items: toItems(lookups.secondaryCoverages), allowClear: true },
        valueFormatter: lookupName(lookups.secondaryCoverages),
        cellStyle: lookupCell(lookups.secondaryCoverages),
      },
      {
        field: "refill_note_id",
        headerName: "Refill Note",
        width: 160,
        editable: true,
        cellEditor: PillSelectEditor,
        cellEditorPopup: true,
        cellEditorParams: { items: toItems(lookups.refillNotes), allowClear: true },
        cellRenderer: RefillNoteRenderer,
        cellStyle: lookupCell(lookups.refillNotes),
        comparator: (a, b) => {
          const order = (id: number | null) => lookups.refillNotes.find((n) => n.id === id)?.sort_order ?? 9999;
          return order(a) - order(b);
        },
      },
      {
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
      },
      {
        field: "old_copay",
        headerName: "Old Copay",
        width: 110,
        editable: true,
        valueParser: moneyParser,
        valueFormatter: (p) => formatMoney(p.value),
        cellStyle: (p) => {
          const bg = copayColor(p.value, lookups.settings.copayTiers);
          return bg ? { backgroundColor: bg, color: textColorFor(bg) } : undefined;
        },
        type: "rightAligned",
      },
      {
        field: "new_copay",
        headerName: "New Copay",
        width: 110,
        editable: true,
        valueParser: moneyParser,
        valueFormatter: (p) => formatMoney(p.value),
        cellStyle: (p) => {
          const bg = copayColor(p.value, lookups.settings.copayTiers);
          return bg ? { backgroundColor: bg, color: textColorFor(bg) } : undefined;
        },
        type: "rightAligned",
      },
      {
        field: "old_profit",
        headerName: "Old Profit",
        width: 110,
        editable: true,
        valueParser: moneyParser,
        valueFormatter: (p) => formatMoney(p.value),
        cellStyle: (p) => profitStyle(p.value, (p.context as GridCtx).profitMax),
        type: "rightAligned",
      },
      {
        field: "new_profit",
        headerName: "New Profit",
        width: 110,
        editable: true,
        valueParser: moneyParser,
        valueFormatter: (p) => formatMoney(p.value),
        cellStyle: (p) => profitStyle(p.value, (p.context as GridCtx).profitMax),
        type: "rightAligned",
      },
      {
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
      },
      {
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
      },
      {
        field: "notes",
        headerName: "Notes",
        flex: 1,
        minWidth: 180,
        editable: true,
        tooltipField: "notes",
      },
    ];
  }, [lookups, showSecondary]);

  const onGridReady = useCallback((e: GridReadyEvent<RefillRow>) => {
    apiRef.current = e.api;
  }, []);

  const onCellClicked = useCallback((e: CellClickedEvent<RefillRow>) => {
    if (!DROPDOWN_FIELDS.has(e.colDef.field ?? "") || e.rowIndex == null) return;
    e.api.startEditingCell({ rowIndex: e.rowIndex, colKey: e.column.getColId() });
  }, []);

  // ----- toolbar data --------------------------------------------------------

  const monthOptions = useMemo(() => {
    const yms = new Set(monthCounts.keys());
    yms.add(ym);
    return [...yms].sort();
  }, [monthCounts, ym]);

  const daysInMonth = useMemo(() => [...new Set(rows.map((r) => r.due_date))].sort(), [rows]);
  const filtersActive = filters.day !== null || filters.insuranceId !== null || filters.status !== null || filters.unresolvedOnly;

  return (
    <div className="month-view">
      <div className="toolbar">
        <div className="toolbar-group">
          <button onClick={() => setYm(shiftYm(ym, -1))} title="Previous month">‹</button>
          <select className="month-select" value={ym} onChange={(e) => setYm(e.target.value)}>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {ymLabel(m)}
                {monthCounts.has(m) ? ` — ${monthCounts.get(m)} rows` : " — empty"}
              </option>
            ))}
          </select>
          <button onClick={() => setYm(shiftYm(ym, 1))} title="Next month">›</button>
          <button onClick={() => setYm(currentYm())}>Today</button>
        </div>

        <div className="toolbar-group filters">
          <select
            value={filters.day ?? ""}
            onChange={(e) => setFilters({ ...filters, day: e.target.value || null })}
          >
            <option value="">All days</option>
            {daysInMonth.map((d) => (
              <option key={d} value={d}>{dueLabel(d)}</option>
            ))}
          </select>
          <select
            value={filters.insuranceId ?? ""}
            onChange={(e) => setFilters({ ...filters, insuranceId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">All insurances</option>
            {lookups.insurances.filter((i) => i.active === 1).map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          <select
            value={filters.status ?? ""}
            onChange={(e) => setFilters({ ...filters, status: (e.target.value || null) as RefillStatus | null })}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <label className="check">
            <input
              type="checkbox"
              checked={filters.unresolvedOnly}
              onChange={(e) => setFilters({ ...filters, unresolvedOnly: e.target.checked })}
            />
            Unresolved only
          </label>
          {filtersActive && (
            <button className="clear-filters" onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
            </button>
          )}
        </div>

        <div className="toolbar-group">
          <span className="row-count">
            {filteredRows.length === rows.length ? `${rows.length} rows` : `${filteredRows.length} of ${rows.length} rows`}
          </span>
          <label className="check">
            <input type="checkbox" checked={showSecondary} onChange={(e) => setShowSecondary(e.target.checked)} />
            Secondary
          </label>
          <button className={locked ? "lock on" : "lock"} onClick={toggleLock} title="Keep due-date order while sorting other columns within each day">
            {locked ? "🔒 Date order locked" : "🔓 Lock date order"}
          </button>
          <button onClick={resetSort}>Reset sort</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-month">
          <h2>No refills for {ymLabel(ym)} yet</h2>
          <p>
            Add refills manually (coming with the detail drawer) or import the month's
            PioneerRX report (v2). The grid fills in as data arrives.
          </p>
        </div>
      ) : (
        <div className="grid-wrap">
          <AgGridReact<RefillRow>
            theme={themeQuartz}
            rowData={filteredRows}
            columnDefs={columnDefs}
            context={ctxRef.current}
            getRowId={(p) => String(p.data.id)}
            defaultColDef={{ sortable: true, resizable: true }}
            onGridReady={onGridReady}
            onSortChanged={onSortChanged}
            onCellClicked={onCellClicked}
            onCellValueChanged={onCellValueChanged}
            getRowClass={getRowClass}
            stopEditingWhenCellsLoseFocus={true}
            enterNavigatesVertically={true}
            enterNavigatesVerticallyAfterEdit={true}
            tooltipShowDelay={400}
            overlayNoRowsTemplate="No rows match the active filters"
          />
        </div>
      )}
    </div>
  );
}
