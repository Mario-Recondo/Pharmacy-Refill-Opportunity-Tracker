// Overdue tab (story 1.7, flow 8): Pending rows past their due date that are
// still unprocessed — insurance not run yet, i.e. New Copay or New Profit empty
// (narrowed 2026-07-17 now that Req Follow Up owns worked-and-waiting rows) —
// plus every MISSED row, across all months, oldest first. Pending rows leave
// the moment both fields are filled; MISSED rows stay forever, greyed and
// uncounted — the tab doubles as the permanent record of slipped refills.
// Full month-grid column set (user decision 2026-07-13) plus a Days-over
// column and a pinned-right action placeholder; a filter over the refills
// table, no schema impact.

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
import type { CustomCellRendererProps } from "ag-grid-react";
import { loadOverdue, todayIso } from "../data/refills";
import { STATUSES, type Lookups, type RefillRow, type RefillStatus } from "../data/types";
import { confirmDeleteRefill, DROPDOWN_FIELDS, dueLabel, refillCols, useDueDateSort, useRefillCellEdit } from "./refillGrid";
import { RowCtxMenu, type CtxMenuState, type GridCtx } from "./gridParts";
import RefillDrawer from "./RefillDrawer";
import { insuranceDisplayName } from "../lib/rules";

function daysOverdue(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today.getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000));
}

// greyed v3 placeholder (the Call List ships in v3 — layout accounts for it now);
// MISSED rows hint at the reopen path instead
function OverdueActionRenderer(props: CustomCellRendererProps<RefillRow>) {
  if (!props.data) return null;
  if (props.data.status === "MISSED") return <span className="overdue-hint">reopen to retry</span>;
  return (
    <button className="call-list-ghost" disabled title="Ships with the Call List (v3)">
      → today's list
    </button>
  );
}

interface Filters {
  insuranceId: number | null;
  status: RefillStatus | null;
  unresolvedOnly: boolean;
}

const NO_FILTERS: Filters = { insuranceId: null, status: null, unresolvedOnly: false };

interface OverdueViewProps {
  lookups: Lookups;
  /** reload on every activation — cross-tab edits and day rollover both change what belongs here */
  active: boolean;
  /** open a refill that isn't in the overdue list (drawer history click) — jump to the month grid */
  onOpenInMonth: (id: number, dueDate: string) => void;
  /** any persisted change (edit/delete) — App refreshes the Overdue badge */
  onDataChanged: () => void;
}

export default function OverdueView({ lookups, active, onOpenInMonth, onDataChanged }: OverdueViewProps) {
  const [rows, setRows] = useState<RefillRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showSecondary, setShowSecondary] = useState(false);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const apiRef = useRef<GridApi<RefillRow> | null>(null);
  const { locked, toggleLock, resetSort, onSortChanged, isDayBreak } = useDueDateSort(apiRef);

  const load = useCallback(() => {
    loadOverdue(todayIso())
      .then((rs) => {
        setRows(rs);
        setLoaded(true);
      })
      .catch((e) => alert(`Failed to load overdue rows: ${e}`));
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (filters.insuranceId === null || r.insurance_id === filters.insuranceId) &&
          (filters.status === null || r.status === filters.status) &&
          (!filters.unresolvedOnly || r.status === "Pending"),
      ),
    [rows, filters],
  );

  // Relative profit shading (story 3.2), same rule as the month grid: max among visible rows
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

  // any persisted change: refresh the badge and requery — resolved rows leave the tab here
  const onMutated = useCallback(() => {
    onDataChanged();
    load();
  }, [onDataChanged, load]);

  const onCellValueChanged = useRefillCellEdit(lookups, onMutated);

  const editRow = drawerId != null ? rows.find((r) => r.id === drawerId) : undefined;

  const deleteRow = useCallback(
    async (row: RefillRow) => {
      setCtxMenu(null);
      if (!(await confirmDeleteRefill(row))) return;
      setDrawerId((d) => (d === row.id ? null : d));
      onMutated();
    },
    [onMutated],
  );

  const columnDefs = useMemo<ColDef<RefillRow>[]>(() => {
    const c = refillCols(lookups, { nimbleCounter: false }); // counter is month-grid-only (story 1.9)
    return [
      c.rx,
      c.drug,
      c.due,
      {
        colId: "days_over",
        headerName: "Days over",
        width: 95,
        valueGetter: (p) => (p.data ? daysOverdue(p.data.due_date) : null),
        valueFormatter: (p) => (p.value == null ? "" : `${p.value}d`),
        type: "rightAligned",
      },
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
      // pinned so the v3 placeholder / MISSED hint stay in view (user decision 2026-07-13)
      { colId: "action", headerName: "", width: 140, pinned: "right", sortable: false, cellRenderer: OverdueActionRenderer },
    ];
  }, [lookups, showSecondary]);

  const onGridReady = useCallback((e: GridReadyEvent<RefillRow>) => {
    apiRef.current = e.api;
  }, []);

  const onCellClicked = useCallback((e: CellClickedEvent<RefillRow>) => {
    const field = e.colDef.field ?? "";
    if ((field === "drug_name" || field === "due_date") && e.data) {
      setDrawerId(e.data.id);
      return;
    }
    if (!DROPDOWN_FIELDS.has(field) || e.rowIndex == null) return;
    e.api.startEditingCell({ rowIndex: e.rowIndex, colKey: e.column.getColId() });
  }, []);

  const onCellContextMenu = useCallback((e: CellContextMenuEvent<RefillRow>) => {
    if (!e.data) return;
    const ev = e.event as MouseEvent;
    setCtxMenu({ x: ev.clientX, y: ev.clientY, row: e.data });
  }, []);

  // the row whose detail drawer is open stays highlighted until it closes;
  // row classes compute at draw time, so redraw the rows entering/leaving it
  const drawerRowIdRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = drawerRowIdRef.current;
    if (prev === drawerId) return;
    drawerRowIdRef.current = drawerId;
    const api = apiRef.current;
    if (!api) return;
    const nodes = [prev, drawerId]
      .filter((v): v is number => v != null)
      .map((v) => api.getRowNode(String(v)))
      .filter((n) => n != null);
    if (nodes.length) api.redrawRows({ rowNodes: nodes });
  }, [drawerId]);

  const getRowClass = useCallback(
    (params: RowClassParams<RefillRow>): string[] | undefined => {
      const classes: string[] = [];
      if (isDayBreak(params)) classes.push("day-break");
      if (params.data && params.data.id === drawerRowIdRef.current) classes.push("drawer-open");
      // MISSED rows are the permanent record, not work — dimmed (opacity, never
      // recolored: business color coding stays intact underneath)
      if (params.data?.status === "MISSED") classes.push("overdue-missed");
      return classes.length ? classes : undefined;
    },
    [isDayBreak],
  );

  // rows arrive oldest-first, so the first Pending row is the oldest unresolved
  const pending = useMemo(() => rows.filter((r) => r.status === "Pending"), [rows]);
  const filtersActive = filters.insuranceId !== null || filters.status !== null || filters.unresolvedOnly;

  return (
    <div className="overdue-view">
      {pending.length > 0 && (
        <div className="overdue-banner">
          ⚠ {pending.length} refill{pending.length === 1 ? "" : "s"} past due and not yet processed (oldest:{" "}
          {dueLabel(pending[0].due_date)}) — run their insurance or mark MISSED
        </div>
      )}

      <div className="toolbar">
        <div className="toolbar-group filters">
          <select
            value={filters.insuranceId ?? ""}
            onChange={(e) => setFilters({ ...filters, insuranceId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">All insurances</option>
            {lookups.insurances.filter((i) => i.active === 1).map((i) => (
              <option key={i.id} value={i.id}>{insuranceDisplayName(i)}</option>
            ))}
          </select>
          <select
            value={filters.status ?? ""}
            onChange={(e) => setFilters({ ...filters, status: (e.target.value || null) as RefillStatus | null })}
          >
            <option value="">All statuses</option>
            {STATUSES.filter((s) => s !== "Checked Out").map((s) => (
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
            {" · "}
            {pending.length} to process · {rows.length - pending.length} MISSED
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

      {loaded && rows.length === 0 ? (
        <div className="empty-month">
          <h2>Nothing overdue</h2>
          <p>
            Pending refills whose due date passes before their insurance is run (New Copay and New
            Profit entered) appear here automatically, along with rows marked MISSED — those stay
            listed, greyed, as the permanent record of slipped refills.
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

      {ctxMenu && <RowCtxMenu menu={ctxMenu} onDelete={deleteRow} onDismiss={() => setCtxMenu(null)} />}

      {editRow && (
        <RefillDrawer
          key={editRow.id}
          mode={{ kind: "edit", row: editRow }}
          lookups={lookups}
          profitMax={profitMax}
          onClose={() => setDrawerId(null)}
          onRowEdited={() => onMutated()}
          onCreated={() => {}} // create mode never opens from this tab
          onOpenRefill={(id, dueDate) => {
            if (rows.some((r) => r.id === id)) {
              setDrawerId(id);
            } else {
              setDrawerId(null); // don't leave a stale drawer behind the now-hidden tab
              onOpenInMonth(id, dueDate);
            }
          }}
          onDelete={deleteRow}
        />
      )}
    </div>
  );
}
