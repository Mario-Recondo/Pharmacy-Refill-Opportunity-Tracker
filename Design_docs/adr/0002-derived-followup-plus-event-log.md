# 0002 — Req Follow Up is derived, with an event log instead of an auto-managed status

- **Status:** Accepted
- **Date:** 2026-07-15

## Context

The technician wanted a "Req Follow Up" worklist: rows where she already ran
insurance (new copay + verified profit entered) and made contact (a
"waiting on patient" call note), but the patient stayed quiet past ~5 days.
The original formulation had the app **auto-transitioning** such rows from
`Pending` to `MISSED` after the wait — the first place the app would ever
change technician-entered data on its own. A follow-up idea was a fourth
status, `Req Followup`, auto-set when the conditions were met, largely to
preserve database writes future analytics could count.

Constraints that mattered: status is a human workflow declaration ("unresolved
always means Pending only" is baked into filters, badges and the Overdue tab);
lookup vocabularies are data and rules must key off behavior flags, never
names; analytics need durable timestamps, and history cannot be retrofitted.

## Decision

The tab is a **pure filter** — `Pending` + `new_copay` set + `new_profit > 0`
+ a call note flagged `requires_followup` + more than `followup_wait_days`
quiet days since `call_note_set_at`. No status is ever written by the app.
Analytics are served instead by an append-only **`refill_events`** log:
technician changes to refill note / call note / status (with a `new_profit`
snapshot on `Checked Out`), plus `followup_entered`/`followup_left` span
events reconciled by an idempotent sweep on launch, data change and day
rollover. Same-day changes to the same field collapse to one event, so
accidental edits don't pollute the record.

## Alternatives considered

- **Auto-transition Pending → MISSED after the wait.** Rejected by the
  technician's proxy: the row is still pending — she wants to *see* that it
  needs follow-up, not have the app declare it lost. Also made MISSED
  ambiguous (human judgment vs. timer).
- **A fourth `Req Followup` status, auto-set.** Puts a machine-derived value
  in a human-owned field: every filter keyed on `Pending` grows an exception,
  the app and the tech fight over the same cell, and the sheet's `$ LOSS`
  status was already dropped for exactly this reason (it described a derivable
  condition, not a workflow decision). A status also only knows its *current*
  value — spans and re-entries are invisible.
- **Pure filter with no writes at all.** Loses the analytics the tracker
  exists to enable (profit per month by checkout date, time-in-follow-up,
  re-entry counts). The event log preserves them without touching rows.

## Consequences

- MISSED is 100% manual, always the technician's call, typically made from
  the tab when she gives up on a row.
- The schema gains an append-only table whose rows outlive refill deletion
  (deliberately no FK cascade) — the permanent analytics record.
- An accidental call-note edit still restarts the quiet-days clock (the tab
  shows the row up to 5 days later than it should). Accepted: guarding it
  would mean "did you mean this edit?" friction, against the no-friction rule.
- Follow-up span timestamps are only as fresh as the sweep triggers (launch,
  any data change, day rollover) — good enough for month-grain analytics.
- The Overdue tab is unchanged and temporarily overlaps this tab; what
  "Overdue" should mean now is a deliberately separate, pending decision.
