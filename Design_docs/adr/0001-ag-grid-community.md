# 0001 — Use AG Grid Community for the month grid

- **Status:** Accepted
- **Date:** 2026-07-11

## Context

The month grid is the heart of the app — an editable, spreadsheet-like view the
technician lives in all day. v1 needs inline editing, keyboard navigation,
pinned columns (floating Rx #), custom colored dropdown editors, per-cell
conditional styling (copay tiers, dynamic profit green), checkbox multi-select,
and day-separator rows. Every column and editor gets built against the grid
library's API, so swapping libraries later means rebuilding the core screen.

## Decision

AG Grid Community (MIT, free tier), validated by a throwaway spike
(2026-07-11) against every v1 risk area before committing.

## Alternatives considered

- **TanStack Table** — headless; we'd hand-build cell editors, pinning, and
  selection UI ourselves. More control, but weeks of grid plumbing for a
  one-user tool.
- **AG Grid Enterprise** — adds drag-fill and range copy/paste, but a paid
  license is unjustifiable for a single-user internal tool.

## Consequences

- All v1 needs confirmed working in the free tier — no license cost.
- Drag-fill and multi-cell range copy/paste are Enterprise-only: bulk edits use
  checkbox selection + apply-to-selected instead (matches the planned v2 import
  error-list pattern).
- AG Grid computes row classes only on draw: `redrawRows()` must be called on
  sort change or day-separator lines stick to stale rows.
