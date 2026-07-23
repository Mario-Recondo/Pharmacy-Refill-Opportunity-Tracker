import { describe, expect, it } from "vitest";
import {
  gridInteractionTransition,
  nextTypeaheadMatch,
  outsidePointerDecision,
  type GridCellAddress,
  type GridInteractionState,
} from "../src/lib/gridInteractionMachine";

const cell: GridCellAddress = {
  gridId: "month",
  rowId: "42",
  rowIndex: 3,
  colId: "refill_note_id",
};

describe("grid interaction state machine", () => {
  it("selects a cell without entering edit mode", () => {
    expect(
      gridInteractionTransition(
        { kind: "idle" },
        { type: "CELL_SELECTED", cell },
      ),
    ).toEqual({ kind: "selected", cell });
  });

  it("tracks inline and overlay editors distinctly", () => {
    const selected: GridInteractionState = { kind: "selected", cell };
    expect(
      gridInteractionTransition(selected, {
        type: "EDITOR_STARTED",
        editor: "inline",
        cell,
        originalValue: "old",
      }),
    ).toEqual({
      kind: "editing-inline",
      cell,
      originalValue: "old",
    });
    expect(
      gridInteractionTransition(selected, {
        type: "EDITOR_STARTED",
        editor: "overlay",
        cell,
        originalValue: 5,
      }),
    ).toEqual({
      kind: "editing-overlay",
      cell,
      originalValue: 5,
      typeaheadBuffer: "",
    });
  });

  it("allows click-through after an inline editor closes", () => {
    const state: GridInteractionState = {
      kind: "editing-inline",
      cell,
      originalValue: "old",
    };
    expect(outsidePointerDecision(state)).toEqual({
      finishEditing: true,
      consumePointer: false,
    });
    expect(
      gridInteractionTransition(state, { type: "OUTSIDE_POINTER" }),
    ).toEqual({ kind: "selected", cell });
  });

  it("consumes the first outside click from an overlay editor", () => {
    const state: GridInteractionState = {
      kind: "editing-overlay",
      cell,
      originalValue: 5,
      typeaheadBuffer: "",
    };
    expect(outsidePointerDecision(state)).toEqual({
      finishEditing: true,
      consumePointer: true,
    });
    expect(
      gridInteractionTransition(state, { type: "OUTSIDE_POINTER" }),
    ).toEqual({ kind: "selected", cell });
  });

  it("retains type-ahead only while an overlay editor is active", () => {
    const overlay: GridInteractionState = {
      kind: "editing-overlay",
      cell,
      originalValue: 5,
      typeaheadBuffer: "",
    };
    expect(
      gridInteractionTransition(overlay, {
        type: "TYPEAHEAD_CHANGED",
        buffer: "ca",
      }),
    ).toEqual({ ...overlay, typeaheadBuffer: "ca" });
    expect(
      gridInteractionTransition(
        { kind: "selected", cell },
        { type: "TYPEAHEAD_CHANGED", buffer: "ca" },
      ),
    ).toEqual({ kind: "selected", cell });
  });

  it("clears stale state when its grid unregisters", () => {
    const state: GridInteractionState = {
      kind: "editing-inline",
      cell,
      originalValue: "old",
    };
    expect(
      gridInteractionTransition(state, {
        type: "GRID_UNREGISTERED",
        gridId: "month",
      }),
    ).toEqual({ kind: "idle" });
    expect(
      gridInteractionTransition(state, {
        type: "GRID_UNREGISTERED",
        gridId: "overdue",
      }),
    ).toBe(state);
  });

  it("matches dropdown type-ahead by case-insensitive prefix", () => {
    const labels = ["— clear —", "Call Pt", "Cash", "Nimble Link"];
    expect(nextTypeaheadMatch(labels, "", "c")).toEqual({
      buffer: "c",
      index: 1,
    });
    expect(nextTypeaheadMatch(labels, "c", "a")).toEqual({
      buffer: "ca",
      index: 1,
    });
    expect(nextTypeaheadMatch(labels, "ca", "s")).toEqual({
      buffer: "cas",
      index: 2,
    });
    expect(nextTypeaheadMatch(labels, "cas", "n")).toEqual({
      buffer: "n",
      index: 3,
    });
  });
});
