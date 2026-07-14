// Overdue tab (story 1.7, flow 8): every Pending row past its due date plus
// every MISSED row, across all months, oldest first. Pending rows leave when
// resolved; MISSED rows stay forever — the tab doubles as the permanent record
// of slipped refills. A filter over the refills table; no schema impact.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  themeQuartz,
  type CellClickedEvent,
  type CellContextMenuEvent,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
} from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import { loadOverdue, todayIso } from "../data/refills";
import type { Lookups, RefillRow } from "../data/types";
import { confirmDeleteRefill, DROPDOWN_FIELDS, dueLabel, refillCols, useRefillCellEdit } from "./refillGrid";
import { RowCtxMenu, type CtxMenuState, type GridCtx } from "./gridParts";
import RefillDrawer from "./RefillDrawer";

function daysOverdue(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today.getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000));
}

/** "Wed 6/24 · 19d" — original due date plus age at a glance (sketch screen 3); year shown once it differs */
function wasDueText(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const label = y === new Date().getFullYear() ? dueLabel(iso) : `${m}/${d}/${String(y).slice(2)}`;
  return `${label} · ${daysOverdue(iso)}d`;
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
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const apiRef = useRef<GridApi<RefillRow> | null>(null);

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

  // Relative profit shading (story 3.2), same rule as the month grid
  const profitMax = useMemo(() => {
    let max = 0;
    for (const r of rows) {
      if (r.old_profit != null && r.old_profit > max) max = r.old_profit;
      if (r.new_profit != null && r.new_profit > max) max = r.new_profit;
    }
    return max;
  }, [rows]);

  const ctxRef = useRef<GridCtx>({ lookups, profitMax: 0 });
  ctxRef.current.lookups = lookups;
  ctxRef.current.profitMax = profitMax;

  useEffect(() => {
    apiRef.current?.refreshCells({ force: true });
  }, [rows, profitMax]);

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
      {
        field: "due_date",
        headerName: "Was due",
        width: 150,
        cellClass: "open-drawer overdue-date",
        valueFormatter: (p) => (p.value ? wasDueText(p.value) : ""),
      },
      c.insurance,
      c.refillNote,
      c.oldProfit,
      c.status,
      { colId: "action", headerName: "", width: 140, sortable: false, cellRenderer: OverdueActionRenderer },
    ];
  }, [lookups]);

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

  // rows arrive oldest-first, so the first Pending row is the oldest unresolved
  const pending = useMemo(() => rows.filter((r) => r.status === "Pending"), [rows]);

  return (
    <div className="overdue-view">
      {pending.length > 0 && (
        <div className="overdue-banner">
          ⚠ {pending.length} refill{pending.length === 1 ? "" : "s"} past due and unresolved (oldest:{" "}
          {dueLabel(pending[0].due_date)}) — work them or mark MISSED
        </div>
      )}

      {loaded && rows.length === 0 ? (
        <div className="empty-month">
          <h2>Nothing overdue</h2>
          <p>
            Pending refills whose due date passes appear here automatically, along with rows marked
            MISSED — those stay listed as the permanent record of slipped refills.
          </p>
        </div>
      ) : (
        <div className="grid-wrap">
          <AgGridReact<RefillRow>
            theme={themeQuartz}
            rowData={rows}
            columnDefs={columnDefs}
            context={ctxRef.current}
            getRowId={(p) => String(p.data.id)}
            defaultColDef={{ sortable: true, resizable: true }}
            onGridReady={onGridReady}
            onCellClicked={onCellClicked}
            onCellContextMenu={onCellContextMenu}
            preventDefaultOnContextMenu={true}
            onCellValueChanged={onCellValueChanged}
            stopEditingWhenCellsLoseFocus={true}
            enterNavigatesVertically={true}
            enterNavigatesVerticallyAfterEdit={true}
            tooltipShowDelay={400}
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
