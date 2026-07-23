// Req Follow Up tab (grill interview 2026-07-15): rows where the technician
// already did her part — insurance run (new copay + verified new profit > $0)
// and contact made (a requires_followup call note) — but the patient has gone
// quiet for more than the Settings threshold. Pure filter over refills: status
// is never mutated here; a fresh call note re-stamps the quiet-days clock and
// the row leaves until it goes stale again. MISSED stays a manual, human call.
// Default order: newest arrivals first (user decision) — long-ignored rows sink.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  themeQuartz,
  type CellClickedEvent,
  type CellContextMenuEvent,
  type ColDef,
  type GridApi,
  type RowClassParams,
} from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import { daysQuiet, loadReqFollowUp } from "../data/refills";
import type { Lookups, RefillRow } from "../data/types";
import { confirmDeleteRefill, refillCols, useDueDateSort, useRefillCellEdit } from "./refillGrid";
import { RowCtxMenu, type CtxMenuState, type GridCtx } from "./gridParts";
import { useGridInteraction } from "./GridInteractionProvider";
import RefillDrawer from "./RefillDrawer";
import { insuranceDisplayName } from "../lib/rules";

// greyed v3 placeholder, same as the Overdue tab — this list is even more
// call-list-adjacent, so the layout accounts for the action now
function FollowUpActionRenderer(props: CustomCellRendererProps<RefillRow>) {
  if (!props.data) return null;
  return (
    <button className="call-list-ghost" disabled title="Ships with the Call List (v3)">
      → today's list
    </button>
  );
}

interface Filters {
  insuranceId: number | null;
}

const NO_FILTERS: Filters = { insuranceId: null };

interface ReqFollowUpViewProps {
  lookups: Lookups;
  /** reload on every activation — cross-tab edits and day rollover both change what belongs here */
  active: boolean;
  /** open a refill that isn't in this list (drawer history click) — jump to the month grid */
  onOpenInMonth: (id: number, dueDate: string) => void;
  /** any persisted change (edit/delete) — App re-sweeps span events and refreshes badges */
  onDataChanged: () => void;
}

export default function ReqFollowUpView({ lookups, active, onOpenInMonth, onDataChanged }: ReqFollowUpViewProps) {
  const [rows, setRows] = useState<RefillRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showSecondary, setShowSecondary] = useState(false);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const apiRef = useRef<GridApi<RefillRow> | null>(null);
  const gridInteraction = useGridInteraction("followup", apiRef);
  // unsorted = days-quiet query order here, not due-date order — day separators
  // only make sense once the user explicitly sorts by Due
  const { locked, toggleLock, resetSort, onSortChanged, isDayBreak } = useDueDateSort(apiRef, { unsortedIsDateOrder: false });

  const waitDays = lookups.settings.followupWaitDays;

  const load = useCallback(() => {
    loadReqFollowUp(waitDays)
      .then((rs) => {
        setRows(rs);
        setLoaded(true);
      })
      .catch((e) => alert(`Failed to load follow-up rows: ${e}`));
  }, [waitDays]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const filteredRows = useMemo(
    () => rows.filter((r) => filters.insuranceId === null || r.insurance_id === filters.insuranceId),
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

  // any persisted change: re-sweep/refresh badges upstream and requery — a new
  // call note, Checked Out or MISSED all pull the row off this tab right here
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
        colId: "days_quiet",
        headerName: "Days quiet",
        width: 100,
        valueGetter: (p) => (p.data?.call_note_set_at ? daysQuiet(p.data.call_note_set_at) : null),
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
      // pinned so the v3 placeholder stays in view (matches the Overdue tab)
      { colId: "action", headerName: "", width: 140, pinned: "right", sortable: false, cellRenderer: FollowUpActionRenderer },
    ];
  }, [lookups, showSecondary]);

  const onCellClicked = useCallback((e: CellClickedEvent<RefillRow>) => {
    const field = e.colDef.field ?? "";
    if ((field === "drug_name" || field === "due_date") && e.data) {
      setDrawerId(e.data.id);
      return;
    }
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
      return classes.length ? classes : undefined;
    },
    [isDayBreak],
  );

  return (
    <div className="followup-view">
      <div className="toolbar">
        <div className="toolbar-group filters">
          <select
            value={filters.insuranceId ?? ""}
            onChange={(e) => setFilters({ insuranceId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">All insurances</option>
            {lookups.insurances.filter((i) => i.active === 1).map((i) => (
              <option key={i.id} value={i.id}>{insuranceDisplayName(i)}</option>
            ))}
          </select>
          {filters.insuranceId !== null && (
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

      {loaded && rows.length === 0 ? (
        <div className="empty-month">
          <h2>Nothing needs follow-up</h2>
          <p>
            Pending refills appear here once the insurance is run (new copay and a profit above $0
            entered), a follow-up call note is set, and the patient has stayed quiet for more than{" "}
            {waitDays} day{waitDays === 1 ? "" : "s"}. A fresh call note restarts the clock; checking
            out or marking MISSED resolves the row.
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
            onGridReady={gridInteraction.onGridReady}
            onGridPreDestroyed={gridInteraction.onGridPreDestroyed}
            onCellFocused={gridInteraction.onCellFocused}
            onCellEditingStarted={gridInteraction.onCellEditingStarted}
            onCellEditingStopped={gridInteraction.onCellEditingStopped}
            onSortChanged={onSortChanged}
            onCellClicked={onCellClicked}
            onCellContextMenu={onCellContextMenu}
            preventDefaultOnContextMenu={true}
            onCellValueChanged={onCellValueChanged}
            getRowClass={getRowClass}
            singleClickEdit={true}
            suppressStartEditOnTab={true}
            invalidEditValueMode="revert"
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
