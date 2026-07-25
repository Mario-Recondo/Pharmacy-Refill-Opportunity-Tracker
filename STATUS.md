# Project Status

Last updated: 2026-07-24

## Current product state

- Current pharmacy release: **v1.2.1**, published 2026-07-24. It carries
  forward spreadsheet import and the Call List, and adds the persistent
  light/dark-mode toggle in Settings > About. Dark mode uses charcoal surfaces
  without changing business colors, and the selected theme survives app
  restarts.
- GitHub and local `main` are synchronized at `2059a94`. The signed installer,
  signature, and `latest.json` updater manifest are published in the separate
  releases repository.
- Current schema: migrations `001` through `008`.
- SQLite data lives at
  `%APPDATA%/com.pharmacy.refill-tracker/refills.db`. Treat that file and any
  real PioneerRX export as sensitive pharmacy data.
- The application is a single-user, offline Windows desktop tool. Existing
  installations discover signed updates on launch.

## Quality baseline

- The quality workflow and immutable-migration guard were completed in PR #20.
- The v1.2.1 release validation passed 142 Vitest tests, 18 migration-guard
  tests, the production build, 3 Rust tests, strict Clippy, and rustfmt.
  GitHub's Quality workflow also passed before the release version PR was
  merged.
- Migrations already present on the base branch are immutable. Schema changes
  require the next sequential migration and a matching lock-manifest entry.

## Active work

- Q1 (CI/migration protection) and Q2 (durable agent guidance/state cleanup)
  are complete.
- The grid click/focus behavior is implemented and committed locally as
  `b9aee19` on `feature/grid-click-behavior`. It uses single-click editing when
  no dropdown is open and consumes the first outside click when a dropdown is
  open. This branch is intentionally **not pushed, merged, or released** while
  it awaits technician review; v1.2.1 does not contain it.
- Four follow-ups to that commit landed as `6fda2fb` and the commit after it on
  the same branch, all verified in the running app on 2026-07-24:
  - *Dead-click fix.* `b9aee19` used AG Grid's `singleClickEdit`, which starts
    an edit only when `event.detail === 1`. Because the browser keeps
    incrementing that counter for rapid clicks in the same spot, the second
    click the overlay outside-click rule requires was always refused — clicking
    a dropdown repeatedly did nothing until the technician paused or moved the
    mouse. Live event tracing over CDP confirmed the mechanism. Edits now start
    via `api.startEditingCell` from `onCellClicked`, which ignores the click
    counter.
  - *Undo.* Ctrl+Z reverses field edits from the grid and drawer, gated so it
    cannot silently walk across rows (ADR 0005, `src/lib/undoStack.ts`,
    `src/components/UndoProvider.tsx`).
  - *Stray-commit fix and guard deletion.* See the two entries below.
  - Validation: `npx tsc --noEmit` clean, 165 Vitest tests passing, no console
    errors in the running app. Design docs, story 1.3, the flows convention,
    and ADR 0005 were updated alongside the code.
- The 750 ms double-click guard in `GridInteractionProvider` was deleted
  (2026-07-24) after live tracing showed it inert: with the guard armed and with
  it idle, a double-click left the editor open either way, and nothing in `src/`
  handles `dblclick`. That removed a magic constant, a `Date.now()` dependency,
  and two `setTimeout(…, 0)` ordering assumptions. The `suppressClickRef` half
  stays — it is what implements the consumed first outside click.
- **Silent stray-commit defect, found and fixed 2026-07-24.** AG Grid's default
  `cellEditorPopupPosition` of `'over'` rendered dropdown popups on top of the
  cell that opened them, directly beneath the cursor, so the next click landed on
  an option and committed it. Reproduced live: one rapid click sequence on row
  32's insurance cell silently wrote Horizon BC/BS NJ, Cigna, BC/BS - Florida,
  and Amerigroup in turn. Fixed by `cellEditorPopupPosition: "under"` on the five
  dropdown colDefs plus a movement requirement in `PillSelectEditor` — an option
  click only selects once the pointer has moved onto the popup, since a
  stationary rapid-click sequence emits no `pointermove` at all. Verified by
  tracing: 21 popup opens all positioned at the cell's bottom edge, twelve
  stationary clicks producing zero option hits, and deliberate picks still
  committing normally. Note the fix leaves rapid stationary clicking toggling the
  dropdown open/closed, which is visible but commits nothing.
- The `suppressClickRef` stranded-guard hazard was fixed 2026-07-24. The guard is
  set when an outside pointer press is consumed so the rest of that gesture is
  swallowed too, but every path that cleared it was another event *in the same
  gesture*. A gesture whose `mouseup` never reached the page — focus lost to
  another window, button released outside the WebView — left it set, and it then
  ate the next real click anywhere in the app. One dead click, self-healing, and
  indistinguishable from the intended two-click dropdown rule, so effectively
  unreportable. Fixed by clearing the guard on `pointerdown`, which starts every
  gesture before its `mousedown`, so the guard can never outlive the gesture that
  armed it. A stale flag is now harmless because it only gates `mouseup`, `click`,
  and `contextmenu`, all of which occur inside a gesture. This made the
  `setTimeout(…, 0)` safety net redundant; **`GridInteractionProvider` now
  contains no timers and no clock reads at all.** Note an earlier session note
  wrongly blamed the native call-note dialog for this: that path is unreachable,
  because an overlay outside-click commits the dropdown's value unchanged (the
  pill editor only changes it inside `pick()`), so no confirmation ever opens.
- Next recommended engineering work is Q3: fix restore validation so it cannot
  close the live database pool, add regression coverage, and then harden atomic
  replacement and backup validation.
- Automatic backup cadence and retention remain a separate Q8 product decision;
  do not implement them until the technician-owned questions are answered.

## Open product decisions

The technician-owned questions remain in the local `QUESTIONS.md`. Do not infer
answers or silently turn them into product behavior.

## History

Detailed release narratives and superseded branch handoffs are archived in
`Design_docs/archive/STATUS_HISTORY_THROUGH_2026-07-21.md`. They are context,
not current instructions.

Repository-wide working rules are in `AGENTS.md`. External actions such as
committing, pushing, merging, publishing, or creating a pull request require
explicit user authorization.
