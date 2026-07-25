export interface GridCellAddress {
  gridId: string;
  rowId: string;
  rowIndex: number;
  colId: string;
}

export type GridEditorKind = "inline" | "overlay";

export const GRID_OVERLAY_FIELDS = new Set([
  "insurance_id",
  "secondary_id",
  "refill_note_id",
  "call_note_id",
  "status",
]);

export type GridInteractionState =
  | { kind: "idle" }
  | { kind: "selected"; cell: GridCellAddress }
  | {
      kind: "editing-inline";
      cell: GridCellAddress;
      originalValue: unknown;
    }
  | {
      kind: "editing-overlay";
      cell: GridCellAddress;
      originalValue: unknown;
      typeaheadBuffer: string;
    };

export type GridInteractionEvent =
  | { type: "CELL_SELECTED"; cell: GridCellAddress }
  | {
      type: "EDITOR_STARTED";
      editor: GridEditorKind;
      cell: GridCellAddress;
      originalValue: unknown;
    }
  | { type: "TYPEAHEAD_CHANGED"; buffer: string }
  | { type: "EDITOR_STOPPED" }
  | { type: "OUTSIDE_POINTER" }
  | { type: "GRID_UNREGISTERED"; gridId: string }
  | { type: "CLEAR_SELECTION" };

export interface OutsidePointerDecision {
  finishEditing: boolean;
  consumePointer: boolean;
}

export function outsidePointerDecision(
  state: GridInteractionState,
): OutsidePointerDecision {
  if (state.kind === "editing-overlay") {
    return { finishEditing: true, consumePointer: true };
  }
  if (state.kind === "editing-inline") {
    return { finishEditing: true, consumePointer: false };
  }
  return { finishEditing: false, consumePointer: false };
}

export function gridInteractionTransition(
  state: GridInteractionState,
  event: GridInteractionEvent,
): GridInteractionState {
  switch (event.type) {
    case "CELL_SELECTED":
      return { kind: "selected", cell: event.cell };
    case "EDITOR_STARTED":
      return event.editor === "overlay"
        ? {
            kind: "editing-overlay",
            cell: event.cell,
            originalValue: event.originalValue,
            typeaheadBuffer: "",
          }
        : {
            kind: "editing-inline",
            cell: event.cell,
            originalValue: event.originalValue,
          };
    case "TYPEAHEAD_CHANGED":
      return state.kind === "editing-overlay"
        ? { ...state, typeaheadBuffer: event.buffer }
        : state;
    case "EDITOR_STOPPED":
    case "OUTSIDE_POINTER":
      return state.kind === "editing-inline" ||
        state.kind === "editing-overlay"
        ? { kind: "selected", cell: state.cell }
        : state;
    case "GRID_UNREGISTERED":
      return "cell" in state && state.cell.gridId === event.gridId
        ? { kind: "idle" }
        : state;
    case "CLEAR_SELECTION":
      return { kind: "idle" };
  }
}

export function isEditingState(
  state: GridInteractionState,
): state is Extract<
  GridInteractionState,
  { kind: "editing-inline" | "editing-overlay" }
> {
  return state.kind === "editing-inline" || state.kind === "editing-overlay";
}

export function nextTypeaheadMatch(
  labels: string[],
  currentBuffer: string,
  key: string,
): { buffer: string; index: number } {
  const find = (prefix: string) =>
    labels.findIndex((label) =>
      label.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()),
    );
  const combined = `${currentBuffer}${key}`;
  const combinedMatch = find(combined);
  if (combinedMatch >= 0) {
    return { buffer: combined, index: combinedMatch };
  }
  return { buffer: key, index: find(key) };
}
