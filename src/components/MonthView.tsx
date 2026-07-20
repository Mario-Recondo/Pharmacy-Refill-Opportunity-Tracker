import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  themeQuartz,
  type CellClickedEvent,
  type CellContextMenuEvent,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type RowClassParams,
} from "ag-grid-community";
import { loadMonth, loadMonthCounts } from "../data/refills";
import { STATUSES, type Lookups, type RefillRow, type RefillStatus } from "../data/types";
import { confirmDeleteRefill, DROPDOWN_FIELDS, dueLabel, refillCols, useDueDateSort, useRefillCellEdit } from "./refillGrid";
import { RowCtxMenu, type CtxMenuState, type GridCtx } from "./gridParts";
import OpportunitiesPanel from "./OpportunitiesPanel";
import RefillDrawer from "./RefillDrawer";
import { insuranceDisplayName } from "../lib/rules";
import ImportWizard from "./ImportWizard";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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

interface Filters {
  day: string | null; // ISO date within the month
  insuranceId: number | null;
  status: RefillStatus | null;
  unresolvedOnly: boolean;
}

const NO_FILTERS: Filters = { day: null, insuranceId: null, status: null, unresolvedOnly: false };

/** Cross-tab jump into the month grid (Overdue drawer history click). `seq` distinguishes repeat requests. */
export interface MonthNavRequest {
  id: number;
  dueDate: string;
  seq: number;
}

interface MonthViewProps {
  lookups: Lookups;
  /** false while another tab is shown — reload on re-activation, edits elsewhere may have changed this month */
  active: boolean;
  navRequest: MonthNavRequest | null;
  /** any persisted change (edit/create/delete) — App refreshes the Overdue badge */
  onDataChanged: () => void;
  onLookupsChanged: () => void;
}

export default function MonthView({ lookups, active, navRequest, onDataChanged, onLookupsChanged }: MonthViewProps) {
  const [ym, setYm] = useState(currentYm);
  const [rows, setRows] = useState<RefillRow[]>([]);
  const [monthCounts, setMonthCounts] = useState<Map<string, number>>(new Map());
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showSecondary, setShowSecondary] = useState(false);
  const [drawer, setDrawer] = useState<{ kind: "edit"; id: number } | { kind: "create"; dueDate: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  // row to focus (and maybe open) once its month's rows are loaded — history jumps, due-date moves, fresh creates
  const pendingFocusRef = useRef<{ id: number; open: boolean } | null>(null);

  const apiRef = useRef<GridApi<RefillRow> | null>(null);
  const { locked, toggleLock, resetSort, onSortChanged, isDayBreak } = useDueDateSort(apiRef);

  useEffect(() => {
    loadMonth(ym).then(setRows).catch((e) => alert(`Failed to load ${ym}: ${e}`));
    setFilters(NO_FILTERS);
  }, [ym]);

  useEffect(() => {
    loadMonthCounts().then(setMonthCounts).catch(console.error);
  }, []);

  // returning from another tab: edits there may have touched this month — reload, keeping filters
  const wasActiveRef = useRef(active);
  useEffect(() => {
    if (active && !wasActiveRef.current) {
      loadMonth(ym).then(setRows).catch((e) => alert(`Failed to reload ${ym}: ${e}`));
      loadMonthCounts().then(setMonthCounts).catch(console.error);
    }
    wasActiveRef.current = active;
  }, [active, ym]);

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

  // ----- detail drawer (M2) --------------------------------------------------

  const editRow = drawer?.kind === "edit" ? rows.find((r) => r.id === drawer.id) : undefined;

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    const row = rows.find((r) => r.id === pending.id);
    if (!row) return;
    if (pending.open) setDrawer({ kind: "edit", id: pending.id });
    setTimeout(() => {
      const node = apiRef.current?.getRowNode(String(pending.id));
      if (node) {
        apiRef.current?.ensureNodeVisible(node, "middle");
        apiRef.current?.flashCells({ rowNodes: [node] });
      }
    }, 60);
  }, [rows, filters]);

  const reloadAfterMove = useCallback(
    (id: number, dueDate: string, open: boolean) => {
      loadMonthCounts().then(setMonthCounts).catch(console.error);
      pendingFocusRef.current = { id, open };
      const newYm = dueDate.slice(0, 7);
      if (newYm !== ym) setYm(newYm);
      else loadMonth(ym).then(setRows).catch((e) => alert(`Failed to reload ${ym}: ${e}`));
    },
    [ym],
  );

  /** drawer persisted a field on `row`; reloadMonth = other rows affected too (due-date move, Rx-wide drug fix) */
  const onRowEdited = useCallback(
    (row: RefillRow, reloadMonth: boolean) => {
      onDataChanged();
      if (reloadMonth) reloadAfterMove(row.id, row.due_date, true);
      else setRows((prev) => [...prev]); // re-derive filters/shading from the mutated row
    },
    [reloadAfterMove, onDataChanged],
  );

  const onCreated = useCallback(
    (id: number, dueDate: string) => {
      setDrawer(null);
      onDataChanged();
      reloadAfterMove(id, dueDate, false);
    },
    [reloadAfterMove, onDataChanged],
  );

  /** jump to a refill anywhere (drawer history click, duplicate-open) */
  const onOpenRefill = useCallback(
    (id: number, dueDate: string) => {
      const newYm = dueDate.slice(0, 7);
      if (newYm !== ym) {
        pendingFocusRef.current = { id, open: true };
        setYm(newYm);
      } else {
        setDrawer({ kind: "edit", id });
        const node = apiRef.current?.getRowNode(String(id));
        if (node) apiRef.current?.ensureNodeVisible(node, "middle");
      }
    },
    [ym],
  );

  // the Overdue tab asked to open a refill here (drawer history click on a non-overdue row)
  const navSeqRef = useRef(0);
  useEffect(() => {
    if (!navRequest || navRequest.seq === navSeqRef.current) return;
    navSeqRef.current = navRequest.seq;
    onOpenRefill(navRequest.id, navRequest.dueDate);
  }, [navRequest, onOpenRefill]);

  const openCreate = useCallback(
    () => setDrawer({ kind: "create", dueDate: filters.day ?? `${ym}-01` }),
    [filters.day, ym],
  );

  /** scroll the grid to a row and flash it, without opening the drawer — switches month / clears filters if needed */
  const goToRow = useCallback(
    (id: number, dueDate: string) => {
      const newYm = dueDate.slice(0, 7);
      if (newYm !== ym) {
        pendingFocusRef.current = { id, open: false };
        setYm(newYm);
        return;
      }
      if (!filteredRows.some((r) => r.id === id)) {
        // in this month but hidden by the quick filters — reveal it
        pendingFocusRef.current = { id, open: false };
        setFilters(NO_FILTERS);
        return;
      }
      const node = apiRef.current?.getRowNode(String(id));
      if (node) {
        apiRef.current?.ensureNodeVisible(node, "middle");
        apiRef.current?.flashCells({ rowNodes: [node] });
      }
    },
    [ym, filteredRows],
  );

  // ----- delete (guarded: right-click menu or drawer button, then a confirm) --

  const deleteRow = useCallback(
    async (row: RefillRow) => {
      setCtxMenu(null);
      if (!(await confirmDeleteRefill(row))) return;
      setDrawer((d) => (d?.kind === "edit" && d.id === row.id ? null : d));
      onDataChanged();
      loadMonthCounts().then(setMonthCounts).catch(console.error);
      loadMonth(ym).then(setRows).catch((e) => alert(`Failed to reload ${ym}: ${e}`));
    },
    [ym, onDataChanged],
  );

  const onCellContextMenu = useCallback((e: CellContextMenuEvent<RefillRow>) => {
    if (!e.data) return;
    const ev = e.event as MouseEvent;
    setCtxMenu({ x: ev.clientX, y: ev.clientY, row: e.data });
  }, []);

  // ----- row classes: day separators (shared hook) + opportunity hover -------

  // hovering an Opportunities card highlights its grid row (checked at draw time)
  const oppHoverIdRef = useRef<number | null>(null);
  // the row whose detail drawer is open stays highlighted until it closes
  const drawerRowIdRef = useRef<number | null>(null);

  const getRowClass = useCallback(
    (params: RowClassParams<RefillRow>): string[] | undefined => {
      const classes: string[] = [];
      if (isDayBreak(params)) classes.push("day-break");
      if (params.data && params.data.id === oppHoverIdRef.current) classes.push("opp-hover");
      if (params.data && params.data.id === drawerRowIdRef.current) classes.push("drawer-open");
      return classes.length ? classes : undefined;
    },
    [isDayBreak],
  );

  // row classes compute at draw time, so redraw the rows entering/leaving the highlight
  const drawerRowId = drawer?.kind === "edit" ? drawer.id : null;
  useEffect(() => {
    const prev = drawerRowIdRef.current;
    if (prev === drawerRowId) return;
    drawerRowIdRef.current = drawerRowId;
    const api = apiRef.current;
    if (!api) return;
    const nodes = [prev, drawerRowId]
      .filter((v): v is number => v != null)
      .map((v) => api.getRowNode(String(v)))
      .filter((n) => n != null);
    if (nodes.length) api.redrawRows({ rowNodes: nodes });
  }, [drawerRowId]);

  const setOppHover = useCallback((id: number | null) => {
    const prev = oppHoverIdRef.current;
    if (prev === id) return;
    oppHoverIdRef.current = id;
    const api = apiRef.current;
    if (!api) return;
    const nodes = [prev, id]
      .filter((v): v is number => v != null)
      .map((v) => api.getRowNode(String(v)))
      .filter((n) => n != null);
    if (nodes.length) api.redrawRows({ rowNodes: nodes });
  }, []);

  // ----- edits: immediate persistence + business rules (shared with Overdue) --

  const onMutated = useCallback(() => {
    setRows((prev) => [...prev]); // re-derive filters/shading from the mutated row
    onDataChanged();
  }, [onDataChanged]);

  const onCellValueChanged = useRefillCellEdit(lookups, onMutated);

  // ----- columns (shared defs, month assembly) --------------------------------

  const columnDefs = useMemo<ColDef<RefillRow>[]>(() => {
    const c = refillCols(lookups, { nimbleCounter: true });
    return [
      c.rx,
      c.drug,
      c.due,
      c.insurance,
      { ...c.secondary, hide: !showSecondary },
      c.refillNote,
      c.callNote,
      c.oldCopay,
      c.newCopay,
      c.oldProfit,
      c.newProfit,
      c.refillsFilled,
      c.status,
      c.notes,
    ];
  }, [lookups, showSecondary]);

  const onGridReady = useCallback((e: GridReadyEvent<RefillRow>) => {
    apiRef.current = e.api;
  }, []);

  const onCellClicked = useCallback((e: CellClickedEvent<RefillRow>) => {
    const field = e.colDef.field ?? "";
    // Drug / Due cells (not editable inline) open the detail drawer (story 2.2)
    if ((field === "drug_name" || field === "due_date") && e.data) {
      setDrawer({ kind: "edit", id: e.data.id });
      return;
    }
    if (!DROPDOWN_FIELDS.has(field) || e.rowIndex == null) return;
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
            {[...lookups.insurances].filter((i) => i.active === 1).sort((a, b) => insuranceDisplayName(a).localeCompare(insuranceDisplayName(b), undefined, { sensitivity: "base" })).map((i) => (
              <option key={i.id} value={i.id}>{insuranceDisplayName(i)}</option>
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
          <button className="add-refill" onClick={openCreate}>
            ＋ Add refill
          </button>
          <button className="add-refill" onClick={() => setImporting(true)}>Import…</button>
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

      <div className="month-body">
      {rows.length === 0 ? (
        <div className="empty-month">
          <h2>No refills for {ymLabel(ym)} yet</h2>
          <p>
            Add refills manually or import a spreadsheet. Imported rows use their own due dates.
          </p>
          <button className="add-refill" onClick={openCreate}>
            ＋ Add refill
          </button>
          <button className="add-refill" onClick={() => setImporting(true)}>Import spreadsheet…</button>
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
            onCellContextMenu={onCellContextMenu}
            preventDefaultOnContextMenu={true}
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
      <OpportunitiesPanel
        lookups={lookups}
        rows={rows}
        onOpenRefill={onOpenRefill}
        onHoverRow={setOppHover}
        onGoToRow={goToRow}
      />
      </div>

      {ctxMenu && <RowCtxMenu menu={ctxMenu} onDelete={deleteRow} onDismiss={() => setCtxMenu(null)} />}
      {importing && <ImportWizard lookups={lookups} visibleMonth={ym} onClose={() => setImporting(false)} onChanged={() => { setImporting(false); onLookupsChanged(); onDataChanged(); loadMonth(ym).then(setRows); loadMonthCounts().then(setMonthCounts); }} />}

      {drawer?.kind === "create" && (
        <RefillDrawer
          mode={{ kind: "create", dueDate: drawer.dueDate }}
          lookups={lookups}
          profitMax={profitMax}
          onClose={() => setDrawer(null)}
          onRowEdited={onRowEdited}
          onCreated={onCreated}
          onOpenRefill={onOpenRefill}
          onDelete={deleteRow}
        />
      )}
      {drawer?.kind === "edit" && editRow && (
        <RefillDrawer
          key={editRow.id}
          mode={{ kind: "edit", row: editRow }}
          lookups={lookups}
          profitMax={profitMax}
          onClose={() => setDrawer(null)}
          onRowEdited={onRowEdited}
          onCreated={onCreated}
          onOpenRefill={onOpenRefill}
          onDelete={deleteRow}
        />
      )}
    </div>
  );
}
