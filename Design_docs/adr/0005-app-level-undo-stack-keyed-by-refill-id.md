# 0005 — Undo is an app-level stack keyed by refill id, not AG Grid's `undoRedoCellEditing`

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

The technician asked for Ctrl+Z after a mis-clicked dropdown assignment
(2026-07-24), during the session that fixed the single-click edit regression.
The tool persists every edit immediately with no Save button (§5, "All edits
persist immediately"), so an accidental click is already in the database by the
time it is noticed — the usual "discard unsaved changes" escape hatch does not
exist here.

AG Grid Community ships exactly this feature: `undoRedoCellEditing: true` plus
`undoRedoCellEditingLimit`, with the Ctrl+Z / Ctrl+Y bindings already wired and
`UndoRedoEditModule` already registered through `AllCommunityModule`. Turning on
one grid option was the obvious first answer, and inspecting it is what ruled it
out.

Two facts decided it. First, the stack entry
(`ag-grid-community/dist/types/src/interfaces/iUndoRedo.d.ts`) identifies its
target by **position**:

```ts
export interface CellValueChange {
    rowPinned: RowPinnedType;
    rowIndex: number;      // not a row id
    columnId: string;
    oldValue: any;
    newValue: any;
}
```

This app re-sorts constantly — the due-date lock sorts within days, any header
click re-orders, Reset sort restores — and swaps `rowData` wholesale on every
month change. An undo after any of those writes the old value into whichever
refill now occupies that index: silent corruption of an unrelated prescription,
which is worse than the mis-click being undone.

Second, the stack records only the cell the technician edited. A refill-note
change that clears a call note is two writes (story 1.5 gating). AG Grid would
restore the refill note and leave the call note wiped — asymmetric undo on
precisely the field most often mis-clicked.

## Decision

Undo is an app-level stack in `src/lib/undoStack.ts` (pure state and the
row-boundary rule) driven by `src/components/UndoProvider.tsx` (keybinding,
timers, writes, toast). Entries key on **refill id**. Each entry carries one or
more field steps, so cascading writes undo as a unit. Undo replays through
`updateRefillField`, the same serialized atomic path as the original edit
(ADR 0003), so the event log gains a compensating change rather than losing
history.

Ctrl+Z applies without confirmation only to the row the technician is on — the
focused grid cell, or the open drawer's row. Reaching an entry on any other row
stops and warns, and crossing requires a second deliberate press; key
auto-repeat is rejected outright. This answers the technician's own objection to
undo (2026-07-24): that spamming Ctrl+Z would silently revert work on rows they
were not looking at.

Scope is field edits in the grid and the drawer. Deletion stays permanent, as
already decided (§5 "Row deletion", story 2.4) — the confirmation remains its
guard. Redo is deliberately not implemented.

## Alternatives considered

- **`undoRedoCellEditing: true`** — free, already registered, standard
  bindings. Lost on row-index identity under this app's constant re-sorting, and
  on splitting the call-note cascade. Both are unfixable from outside the grid.
- **Keeping AG Grid's stack but disabling sorting** — sorting is a core daily
  affordance (§5, day separators and the due-date lock exist to support it).
  Trading it for undo is backwards.
- **Undo built on the `refill_events` log** rather than an in-memory stack —
  durable across restarts and already written for note/status changes. Rejected
  for now: the log does not cover every editable field, and undo that reaches
  back across sessions invites exactly the "how far back does this go?"
  uncertainty the row-boundary rule is designed to remove. The stack being
  session-scoped is a feature.
- **Single-level undo (last edit only)** — immune to cross-row walking by
  construction, and the simplest thing that answers the original mis-click. Lost
  because a mistake is often noticed two or three edits later, and the boundary
  gate makes multi-level safe enough.
- **Row-scoped undo (never leaves the focused row)** — a hard guarantee rather
  than a gate. Lost narrowly: fixing an earlier row would mean clicking back to
  it with no affordance saying so, and the gate already makes cross-row undo
  deliberate and visible.

## Consequences

- Undo survives sorting, filtering, tab switches, and month changes, because
  nothing about it depends on where a row currently sits on screen.
- It does **not** survive app restart, and it holds at most 25 entries. Both are
  intentional: undo is for the mistake you just made, not an audit trail. The
  `refill_events` log remains the durable history.
- Every recording site must pass the pre-edit value and record only after the
  write succeeds. There are two (`useRefillCellEdit`, the drawer's
  `saveEditable`); a third editing path added later must opt in or its edits
  will silently not be undoable.
- Undo writes bypass the grid's `onCellValueChanged`, so views reload from the
  database through `useUndoRefresh` instead. A new grid view must register or it
  will show stale values after an undo.
- An undo is visible by construction — it scrolls to the row, flashes the
  changed cells, and names what it restored — because it can otherwise touch a
  row on a different tab or month.
- We reimplement something the grid ships, and a future AG Grid upgrade that
  fixes `CellValueChange` to carry a row id would make this worth revisiting.
