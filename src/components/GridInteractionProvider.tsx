import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type {
  CellEditingStartedEvent,
  CellEditingStoppedEvent,
  CellFocusedEvent,
  GridApi,
  GridPreDestroyedEvent,
  GridReadyEvent,
} from "ag-grid-community";
import type { RefillRow } from "../data/types";
import {
  gridInteractionTransition,
  GRID_OVERLAY_FIELDS,
  isEditingState,
  outsidePointerDecision,
  type GridCellAddress,
  type GridEditorKind,
  type GridInteractionEvent,
  type GridInteractionState,
} from "../lib/gridInteractionMachine";

type EditExit =
  | { kind: "commit"; move: "none" }
  | {
      kind: "commit";
      move: "enter" | "tab";
      backwards: boolean;
      keyboardEvent: KeyboardEvent;
    }
  | { kind: "revert"; move: "none" };

interface GridInteractionController {
  registerGrid(gridId: string, api: GridApi<RefillRow>): void;
  unregisterGrid(gridId: string): void;
  selectCell(cell: GridCellAddress): void;
  editorStarted(
    editor: GridEditorKind,
    cell: GridCellAddress,
    originalValue: unknown,
  ): void;
  editorStopped(): void;
  setTypeaheadBuffer(buffer: string): void;
  finishCurrentEdit(exit: EditExit): void;
  /** True while an editor is open, so global shortcuts can leave editing keys
   *  (Ctrl+Z inside a text editor stays native text-undo) alone. */
  isEditing(): boolean;
  /** The row the technician is on, for the undo row-boundary rule. */
  focusedRowId(): number | null;
  /** Scrolls to a row, flashes the given fields, and focuses the first of them
   *  so an undo is something the technician watches happen. Returns whether the
   *  row was found in any live grid. */
  revealCells(rowId: number, fields: string[]): boolean;
}

const GridInteractionContext =
  createContext<GridInteractionController | null>(null);

function consumeEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function eventPathHas(
  event: Event,
  predicate: (element: HTMLElement) => boolean,
): boolean {
  return event
    .composedPath()
    .some(
      (item) => item instanceof HTMLElement && predicate(item),
    );
}

function isInsideOverlayEditor(event: Event): boolean {
  return eventPathHas(
    event,
    (element) =>
      element.dataset.gridEditorOverlay === "true" ||
      element.classList.contains("ag-popup-editor") ||
      element.classList.contains("ag-custom-component-popup"),
  );
}

function isInsideInlineEditor(event: Event): boolean {
  return eventPathHas(
    event,
    (element) =>
      element.classList.contains("ag-cell-inline-editing") ||
      element.classList.contains("ag-cell-edit-wrapper"),
  );
}

function cellAddress(
  gridId: string,
  event:
    | CellFocusedEvent<RefillRow>
    | CellEditingStartedEvent<RefillRow>
    | CellEditingStoppedEvent<RefillRow>,
): GridCellAddress | null {
  if (event.rowIndex == null || !event.column) return null;
  const node = event.api.getDisplayedRowAtIndex(event.rowIndex);
  const rowId = node?.id ?? (node?.data ? String(node.data.id) : null);
  if (rowId == null) return null;
  const colId =
    typeof event.column === "string"
      ? event.column
      : event.column.getColId();
  return {
    gridId,
    rowId,
    rowIndex: event.rowIndex,
    colId,
  };
}

export function GridInteractionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const stateRef = useRef<GridInteractionState>({ kind: "idle" });
  const gridsRef = useRef(new Map<string, GridApi<RefillRow>>());
  const suppressClickRef = useRef(false);
  const clickFallbackRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const dispatch = useCallback((event: GridInteractionEvent) => {
    stateRef.current = gridInteractionTransition(stateRef.current, event);
  }, []);

  const registerGrid = useCallback(
    (gridId: string, api: GridApi<RefillRow>) => {
      gridsRef.current.set(gridId, api);
    },
    [],
  );

  const unregisterGrid = useCallback(
    (gridId: string) => {
      gridsRef.current.delete(gridId);
      dispatch({ type: "GRID_UNREGISTERED", gridId });
    },
    [dispatch],
  );

  const finishCurrentEdit = useCallback(
    (exit: EditExit) => {
      const state = stateRef.current;
      if (!isEditingState(state)) return;
      const api = gridsRef.current.get(state.cell.gridId);
      if (!api) {
        dispatch({ type: "GRID_UNREGISTERED", gridId: state.cell.gridId });
        return;
      }

      const { cell } = state;
      api.stopEditing(exit.kind === "revert");
      dispatch({ type: "EDITOR_STOPPED" });

      if (exit.move === "none") {
        api.setFocusedCell(cell.rowIndex, cell.colId);
        return;
      }

      queueMicrotask(() => {
        if (exit.move === "tab") {
          api.tabToNextCell(exit.keyboardEvent);
          return;
        }
        const delta = exit.backwards ? -1 : 1;
        const nextIndex = Math.max(
          0,
          Math.min(api.getDisplayedRowCount() - 1, cell.rowIndex + delta),
        );
        api.ensureIndexVisible(nextIndex);
        api.setFocusedCell(nextIndex, cell.colId);
      });
    },
    [dispatch],
  );

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const state = stateRef.current;
      if (!isEditingState(state)) return;
      if (
        state.kind === "editing-overlay"
          ? isInsideOverlayEditor(event)
          : isInsideInlineEditor(event)
      ) {
        return;
      }

      const decision = outsidePointerDecision(state);
      if (decision.finishEditing) {
        finishCurrentEdit({ kind: "commit", move: "none" });
      }
      if (!decision.consumePointer) return;

      suppressClickRef.current = true;
      clearTimeout(clickFallbackRef.current);
      consumeEvent(event);
    };

    const onMouseUp = (event: MouseEvent) => {
      if (!suppressClickRef.current) return;
      consumeEvent(event);
      clearTimeout(clickFallbackRef.current);
      // A normal click is dispatched synchronously after mouseup. This only
      // clears the guard when the browser produces no click for the sequence.
      clickFallbackRef.current = setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    const onClick = (event: MouseEvent) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      clearTimeout(clickFallbackRef.current);
      consumeEvent(event);
    };

    const onContextMenu = (event: MouseEvent) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      clearTimeout(clickFallbackRef.current);
      consumeEvent(event);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const state = stateRef.current;
      if (state.kind !== "editing-inline") return;
      if (event.key === "Escape") {
        consumeEvent(event);
        finishCurrentEdit({ kind: "revert", move: "none" });
      } else if (event.key === "Enter") {
        consumeEvent(event);
        finishCurrentEdit({
          kind: "commit",
          move: "enter",
          backwards: event.shiftKey,
          keyboardEvent: event,
        });
      } else if (event.key === "Tab") {
        consumeEvent(event);
        finishCurrentEdit({
          kind: "commit",
          move: "tab",
          backwards: event.shiftKey,
          keyboardEvent: event,
        });
      }
    };

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      clearTimeout(clickFallbackRef.current);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [dispatch, finishCurrentEdit]);

  const value = useMemo<GridInteractionController>(
    () => ({
      registerGrid,
      unregisterGrid,
      selectCell: (cell) => dispatch({ type: "CELL_SELECTED", cell }),
      editorStarted: (editor, cell, originalValue) =>
        dispatch({ type: "EDITOR_STARTED", editor, cell, originalValue }),
      editorStopped: () => dispatch({ type: "EDITOR_STOPPED" }),
      setTypeaheadBuffer: (buffer) =>
        dispatch({ type: "TYPEAHEAD_CHANGED", buffer }),
      finishCurrentEdit,
      isEditing: () => isEditingState(stateRef.current),
      focusedRowId: () => {
        const state = stateRef.current;
        if (!("cell" in state)) return null;
        const rowId = Number(state.cell.rowId);
        return Number.isFinite(rowId) ? rowId : null;
      },
      revealCells: (rowId, fields) => {
        let found = false;
        for (const api of gridsRef.current.values()) {
          const node = api.getRowNode(String(rowId));
          if (!node) continue;
          found = true;
          api.ensureNodeVisible(node, "middle");
          api.flashCells({ rowNodes: [node], columns: fields });
          if (node.rowIndex != null && fields[0]) {
            api.setFocusedCell(node.rowIndex, fields[0]);
          }
        }
        return found;
      },
    }),
    [dispatch, finishCurrentEdit, registerGrid, unregisterGrid],
  );

  return (
    <GridInteractionContext.Provider value={value}>
      {children}
    </GridInteractionContext.Provider>
  );
}

export function useGridInteractionController(): GridInteractionController {
  const controller = useContext(GridInteractionContext);
  if (!controller) {
    throw new Error(
      "Grid interaction hooks must be used inside GridInteractionProvider",
    );
  }
  return controller;
}

export function useGridInteraction(
  gridId: string,
  apiRef: { current: GridApi<RefillRow> | null },
) {
  const controller = useGridInteractionController();

  useEffect(
    () => () => {
      controller.unregisterGrid(gridId);
      apiRef.current = null;
    },
    [apiRef, controller, gridId],
  );

  const onGridReady = useCallback(
    (event: GridReadyEvent<RefillRow>) => {
      apiRef.current = event.api;
      controller.registerGrid(gridId, event.api);
    },
    [apiRef, controller, gridId],
  );

  const onCellFocused = useCallback(
    (event: CellFocusedEvent<RefillRow>) => {
      const cell = cellAddress(gridId, event);
      if (cell) controller.selectCell(cell);
    },
    [controller, gridId],
  );

  const onGridPreDestroyed = useCallback(
    (_event: GridPreDestroyedEvent<RefillRow>) => {
      controller.unregisterGrid(gridId);
      apiRef.current = null;
    },
    [apiRef, controller, gridId],
  );

  const onCellEditingStarted = useCallback(
    (event: CellEditingStartedEvent<RefillRow>) => {
      const cell = cellAddress(gridId, event);
      if (!cell) return;
      const field = event.colDef.field ?? "";
      controller.editorStarted(
        GRID_OVERLAY_FIELDS.has(field) ? "overlay" : "inline",
        cell,
        event.value,
      );
    },
    [controller, gridId],
  );

  const onCellEditingStopped = useCallback(
    (_event: CellEditingStoppedEvent<RefillRow>) => {
      controller.editorStopped();
    },
    [controller],
  );

  return {
    onGridReady,
    onGridPreDestroyed,
    onCellFocused,
    onCellEditingStarted,
    onCellEditingStopped,
  };
}
