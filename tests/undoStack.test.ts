import { describe, expect, it } from "vitest";
import {
  afterUndo,
  armRow,
  decideUndo,
  disarm,
  describeFieldValue,
  emptyUndoState,
  recordEdit,
  UNDO_LIMIT,
  type UndoEntry,
} from "../src/lib/undoStack";
import type { Lookups } from "../src/data/types";

function entry(rowId: number, field = "insurance_id" as const): UndoEntry {
  return {
    rowId,
    rowLabel: `Rx ${400000 + rowId}`,
    fieldLabel: "Insurance",
    restoredLabel: "CVS Caremark",
    steps: [{ field, oldValue: 7 }],
  };
}

describe("undo stack", () => {
  it("has nothing to undo when empty", () => {
    expect(decideUndo(emptyUndoState, 1).kind).toBe("empty");
  });

  it("undoes an edit on the row the technician is on without asking", () => {
    const state = recordEdit(emptyUndoState, entry(1));
    expect(decideUndo(state, 1)).toMatchObject({ kind: "apply" });
  });

  it("stops before undoing an edit that belongs to another row", () => {
    const state = recordEdit(emptyUndoState, entry(1));
    const decision = decideUndo(state, 2);
    expect(decision.kind).toBe("confirm-row");
    expect(decision.kind === "confirm-row" && decision.entry.rowId).toBe(1);
  });

  it("crosses to the other row only after the confirming press", () => {
    let state = recordEdit(emptyUndoState, entry(1));
    state = armRow(state, 1);
    expect(decideUndo(state, 2)).toMatchObject({ kind: "apply" });
  });

  it("keeps walking the same row without re-confirming", () => {
    let state = recordEdit(emptyUndoState, entry(1));
    state = recordEdit(state, entry(1));
    state = afterUndo(state, entry(1));
    // context row is elsewhere, but the run is already on row 1
    expect(decideUndo(state, 99)).toMatchObject({ kind: "apply" });
  });

  it("re-confirms at the next row boundary after finishing a row", () => {
    let state = recordEdit(emptyUndoState, entry(2));
    state = recordEdit(state, entry(1));
    state = afterUndo(state, entry(1));
    expect(decideUndo(state, 1).kind).toBe("confirm-row");
  });

  it("asks again once a stale warning has expired", () => {
    let state = recordEdit(emptyUndoState, entry(1));
    state = armRow(state, 1);
    state = disarm(state);
    expect(decideUndo(state, 2).kind).toBe("confirm-row");
  });

  it("a new edit ends the run, so the next undo is judged fresh", () => {
    let state = recordEdit(emptyUndoState, entry(1));
    state = afterUndo(state, entry(1));
    state = recordEdit(state, entry(5));
    expect(state.armedRowId).toBeNull();
    expect(decideUndo(state, 1).kind).toBe("confirm-row");
  });

  it("drops the undone entry", () => {
    let state = recordEdit(emptyUndoState, entry(1));
    state = recordEdit(state, entry(1));
    state = afterUndo(state, entry(1));
    expect(state.entries).toHaveLength(1);
  });

  it("caps the stack so it never becomes a history of the shift", () => {
    let state = emptyUndoState;
    for (let i = 0; i < UNDO_LIMIT + 10; i += 1) state = recordEdit(state, entry(i));
    expect(state.entries).toHaveLength(UNDO_LIMIT);
    // the oldest entries fell off, the newest survived
    expect(state.entries[state.entries.length - 1].rowId).toBe(UNDO_LIMIT + 9);
  });
});

describe("describeFieldValue", () => {
  const lookups = {
    insurances: [{ id: 7, name: "CVS Caremark" }],
    secondaryCoverages: [],
    refillNotes: [{ id: 3, name: "Nimble Link" }],
    callNotes: [],
  } as unknown as Lookups;

  it("names lookup values the way the grid shows them", () => {
    expect(describeFieldValue("insurance_id", 7, lookups)).toBe("CVS Caremark");
    expect(describeFieldValue("refill_note_id", 3, lookups)).toBe("Nimble Link");
  });

  it("formats money fields", () => {
    expect(describeFieldValue("old_copay", 25, lookups)).toBe("$25.00");
  });

  it("says empty for a cleared value, so the toast reads sensibly", () => {
    expect(describeFieldValue("insurance_id", null, lookups)).toBe("empty");
    expect(describeFieldValue("notes", "", lookups)).toBe("empty");
  });

  it("falls back to the raw value for plain fields", () => {
    expect(describeFieldValue("status", "Pending", lookups)).toBe("Pending");
  });
});
