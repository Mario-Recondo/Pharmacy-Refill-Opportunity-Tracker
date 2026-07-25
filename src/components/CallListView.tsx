// Call List membership is auto-ready rows in today's due window, unioned with today's manual pins (recorded 2026-07-20).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { themeQuartz, type CellClickedEvent, type CellContextMenuEvent, type ColDef, type GridApi, type RowClassParams } from "ag-grid-community";
import { autoQualifiesForCallList, isCalledToday, loadCallList, setCallListPin } from "../data/refills";
import type { Lookups, RefillRow } from "../data/types";
import { confirmDeleteRefill, refillCols, startEditOnClick, useDueDateSort, useRefillCellEdit } from "./refillGrid";
import { useUndoRefresh } from "./UndoProvider";
import { RowCtxMenu, type CtxMenuState, type GridCtx } from "./gridParts";
import { useGridInteraction } from "./GridInteractionProvider";
import RefillDrawer from "./RefillDrawer";
import { insuranceDisplayName } from "../lib/rules";

interface Filters { insuranceId: number | null }
const NO_FILTERS: Filters = { insuranceId: null };

interface Props {
  lookups: Lookups;
  active: boolean;
  today: string;
  onOpenInMonth: (id: number, dueDate: string) => void;
  onDataChanged: () => void;
}

export default function CallListView({ lookups, active, today, onOpenInMonth, onDataChanged }: Props) {
  const [rows, setRows] = useState<RefillRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showSecondary, setShowSecondary] = useState(false);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const apiRef = useRef<GridApi<RefillRow> | null>(null);
  const gridInteraction = useGridInteraction("calllist", apiRef);
  const { locked, toggleLock, resetSort, onSortChanged } = useDueDateSort(apiRef, { unsortedIsDateOrder: false });

  const load = useCallback(() => {
    setLoaded(false);
    loadCallList(today).then((rs) => { setRows(rs); setLoaded(true); }).catch((e) => alert(`Failed to load call list: ${e}`));
  }, [today]);
  useEffect(() => { if (active) load(); }, [active, load]);

  const filteredRows = useMemo(() => rows.filter((r) => filters.insuranceId === null || r.insurance_id === filters.insuranceId), [rows, filters]);
  const profitMax = useMemo(() => Math.max(0, ...filteredRows.flatMap((r) => [r.old_profit ?? 0, r.new_profit ?? 0])), [filteredRows]);
  const ctxRef = useRef<GridCtx>({ lookups, profitMax: 0 });
  ctxRef.current.lookups = lookups;
  ctxRef.current.profitMax = profitMax;
  useEffect(() => { apiRef.current?.refreshCells({ force: true }); apiRef.current?.redrawRows(); }, [filteredRows, profitMax, today]);

  const onMutated = useCallback(() => { onDataChanged(); load(); }, [onDataChanged, load]);
  // an undo writes straight to the database, so pull the row back in
  useUndoRefresh(load);
  const onCellValueChanged = useRefillCellEdit(lookups, onMutated);
  const editRow = drawerId == null ? undefined : rows.find((r) => r.id === drawerId);
  const deleteRow = useCallback(async (row: RefillRow) => {
    setCtxMenu(null);
    if (!(await confirmDeleteRefill(row))) return;
    setDrawerId((id) => id === row.id ? null : id);
    onMutated();
  }, [onMutated]);

  const columnDefs = useMemo<ColDef<RefillRow>[]>(() => {
    const c = refillCols(lookups, { nimbleCounter: false });
    return [c.rx, c.drug, c.due, c.insurance, { ...c.secondary, hide: !showSecondary }, c.refillNote, c.callNote, c.oldCopay, c.newCopay, c.oldProfit, c.newProfit, c.refillsFilled, c.status, c.notes];
  }, [lookups, showSecondary]);
  const onCellClicked = useCallback((e: CellClickedEvent<RefillRow>) => {
    const field = e.colDef.field ?? "";
    if ((field === "drug_name" || field === "due_date") && e.data) { setDrawerId(e.data.id); return; }
    startEditOnClick(e);
  }, []);
  const onCellContextMenu = useCallback((e: CellContextMenuEvent<RefillRow>) => {
    if (!e.data) return;
    const ev = e.event as MouseEvent;
    setCtxMenu({ x: ev.clientX, y: ev.clientY, row: e.data });
  }, []);
  const drawerRowIdRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = drawerRowIdRef.current;
    if (prev === drawerId) return;
    drawerRowIdRef.current = drawerId;
    const nodes = [prev, drawerId].filter((v): v is number => v != null).map((id) => apiRef.current?.getRowNode(String(id))).filter((n) => n != null);
    if (nodes.length) apiRef.current?.redrawRows({ rowNodes: nodes });
  }, [drawerId]);
  const getRowClass = useCallback((p: RowClassParams<RefillRow>): string[] | undefined => {
    if (!p.data) return undefined;
    const classes: string[] = [];
    if (isCalledToday(p.data.call_note_set_at, today)) classes.push("callist-called");
    if (p.data.added_to_call_list_on === today) classes.push("callist-pinned");
    if (p.data.id === drawerRowIdRef.current) classes.push("drawer-open");
    return classes.length ? classes : undefined;
  }, [today]);
  const extraItems = ctxMenu && ctxMenu.row.added_to_call_list_on === today && !autoQualifiesForCallList(ctxMenu.row, today)
    ? [{ label: "Remove from today's call list", onClick: (row: RefillRow) => setCallListPin(row.id, null).then(() => { setCtxMenu(null); onDataChanged(); load(); }).catch((e) => alert(`Failed to update call list pin: ${e}`)) }]
    : undefined;

  return <div className="calllist-view">
    <div className="toolbar">
      <div className="toolbar-group filters">
        <select value={filters.insuranceId ?? ""} onChange={(e) => setFilters({ insuranceId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">All insurances</option>
          {lookups.insurances.filter((i) => i.active === 1).map((i) => <option key={i.id} value={i.id}>{insuranceDisplayName(i)}</option>)}
        </select>
        {filters.insuranceId !== null && <button className="clear-filters" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>}
      </div>
      <div className="toolbar-group">
        <span className="row-count">{filteredRows.length === rows.length ? `${rows.length} rows` : `${filteredRows.length} of ${rows.length} rows`}</span>
        <label className="check"><input type="checkbox" checked={showSecondary} onChange={(e) => setShowSecondary(e.target.checked)} /> Secondary</label>
        <button className={locked ? "lock on" : "lock"} onClick={toggleLock}>{locked ? "🔒 Date order locked" : "🔓 Lock date order"}</button>
        <button onClick={resetSort}>Reset sort</button>
      </div>
    </div>
    {loaded && rows.length === 0 ? <div className="empty-month"><h2>No refills ready to call today</h2><p>Process today's refills in the Month grid, or right-click a row → Add to today's call list.</p></div> : <div className="grid-wrap">
      <AgGridReact<RefillRow> theme={themeQuartz} rowData={filteredRows} columnDefs={columnDefs} context={ctxRef.current} getRowId={(p) => String(p.data.id)} defaultColDef={{ sortable: true, resizable: true }} onGridReady={gridInteraction.onGridReady} onGridPreDestroyed={gridInteraction.onGridPreDestroyed} onCellFocused={gridInteraction.onCellFocused} onCellEditingStarted={gridInteraction.onCellEditingStarted} onCellEditingStopped={gridInteraction.onCellEditingStopped} onSortChanged={onSortChanged} onCellClicked={onCellClicked} onCellContextMenu={onCellContextMenu} preventDefaultOnContextMenu={true} onCellValueChanged={onCellValueChanged} getRowClass={getRowClass} suppressStartEditOnTab={true} invalidEditValueMode="revert" tooltipShowDelay={400} overlayNoRowsTemplate="No rows match the active filters" />
    </div>}
    {ctxMenu && <RowCtxMenu menu={ctxMenu} onDelete={deleteRow} onDismiss={() => setCtxMenu(null)} extraItems={extraItems} />}
    {editRow && <RefillDrawer key={editRow.id} mode={{ kind: "edit", row: editRow }} lookups={lookups} profitMax={profitMax} onClose={() => setDrawerId(null)} onRowEdited={onMutated} onCreated={() => {}} onOpenRefill={(id, dueDate) => rows.some((r) => r.id === id) ? setDrawerId(id) : (setDrawerId(null), onOpenInMonth(id, dueDate))} onDelete={deleteRow} />}
  </div>;
}
