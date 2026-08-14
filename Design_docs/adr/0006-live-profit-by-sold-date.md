# 0006 — Monthly profit uses live New Profit bucketed by sold date

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

The Month view needs to show profit made in the displayed calendar month. The
existing `refill_events.profit` value is a snapshot taken when a status changes
to Checked Out, and remains useful as historical Activity, but it can become
stale if a technician later corrects the row's verified `new_profit`. Due dates
also describe work scheduling, not when money was made. The Analytics wayfinder
reserved this choice because changing it later would alter both the data model
and every reported total.

## Decision

The monthly total sums the live `new_profit` of rows currently Checked Out and
uses `checked_out_at` as the sold timestamp, converted to the computer's local
calendar month. Rows with NULL New Profit are excluded. The timestamp is stamped
on real transitions into Checked Out and on Checked Out creates; migration 009
backfills it from the latest checkout event or the due-date-noon fallback.

## Alternatives considered

- **Use `refill_events.profit`:** preserves the original checkout snapshot, but
  ignores later verified corrections to the live row and makes the toolbar
  disagree with the current refill record.
- **Bucket by due date:** simple and stable, but reports scheduled work rather
  than the month in which the sale occurred.
- **Predict or infer missing New Profit:** rejected because profit is verified
  data only; NULL must remain visibly uncounted.

## Consequences

The total reflects current verified data and follows sales across due-month
boundaries. It is sensitive to local timezone changes for historical UTC
timestamps, and old rows without an event use an explicitly documented noon-UTC
fallback. The Activity event snapshot remains available for historical audit,
but is not the source of the live toolbar total.
