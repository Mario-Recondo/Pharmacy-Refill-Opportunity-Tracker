# Refill Tracker — Design Document

## 1. Purpose & Context

Refill Tracker is a personal desktop tool for a single pharmacy technician at an independent pharmacy. It replaces a Google Sheets workflow in which the technician clones a "month tab" (e.g., "July Tab") every month to track prescription refills, log contact attempts with patients, record copays and net profits, and identify high-value refills.

The tool's three jobs, in priority order:

1. **Track refills** — a working queue of prescriptions due, with workflow notes on each contact attempt.
2. **Track profit** — old (last fill) and new (current fill) copay and net profit per refill, with the same at-a-glance color coding the technician relies on today.
3. **Surface opportunities** — alert the technician to refills coming due whose last verified profit was high, so high-value refills are worked first and never slip to MISSED.

This is a single-user tool. There is no server, no authentication, no multi-user sync. It must ship as a **single Windows .exe** that the technician double-clicks, with all data **persisted locally** and surviving app restarts and crashes.

### Source system context (PioneerRX)

The pharmacy runs PioneerRX. The technician looks up prescriptions in Pioneer by Rx number (hence the click-to-copy requirement on Rx #). Pioneer can export a CSV report containing, per prescription: `Rx Number`, `Dispensed Item Name`, `Number Of Refills Filled`, `Patient Paid Amount`, `Dispensed Item NDC`, `Days Supply Ends On`, `Net Profit`. That export maps almost 1:1 onto the queue this tool manages and is the basis of the v2 import feature.

**Profit is never computed by this tool.** When the technician runs insurance in Pioneer, an adjudication window shows the patient copay, the pharmacy's drug cost, and the net profit. Insurance reimbursement is unpredictable (payers lower/raise reimbursement or drop coverage without warning), so the tool only stores profit values a human verified in Pioneer. "Expected profit" shown in alerts is always the **last verified** profit, explicitly labeled unverified for the current fill.

## 2. Tech Stack


| Layer             | Choice                                                                                         | Rationale                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Shell / packaging | **Tauri 2.x**                                                                                  | Ships a small (~10 MB) single .exe; native webview; far lighter than Electron for a one-user tool                         |
| UI                | **React + TypeScript**                                                                         | The UI is essentially a smart spreadsheet grid + dashboard panels — web tech's home turf                                  |
| Grid              | A capable data-grid library (e.g., TanStack Table with virtualized rows, or AG Grid Community) | Inline editing, dropdown cell editors, conditional cell styling, column filtering                                         |
| Storage           | **SQLite** via Tauri's SQL plugin (or rusqlite on the Rust side)                               | Single local `.db` file; durable; makes month filtering and cross-month analytics trivial queries; backup = copy the file |
| Charts (later)    | Recharts or similar                                                                            | Only needed for v3 analytics                                                                                              |


The database file lives in the OS app-data directory (e.g., `%APPDATA%/RefillTracker/refills.db`). A Settings screen shows the file path and offers a one-click "Back up database" (copy to user-chosen location) and "Restore from backup."

## 3. Core Architectural Decision: Months Are Data, Not Structure

In the spreadsheet, each month is a cloned tab. In this tool, **there is exactly one refills table**, and every row carries a due date. "The July tab" is simply the grid filtered to `due_date` within July. This one decision enables:

- Per-Rx and per-drug **history across months** (past profits, past call outcomes) shown in the detail drawer.
- The **Opportunities/alerts** feature, which needs last-fill profit for an Rx coming due.
- The planned **Call List** page, which the user described as "the month tab filtered to today" — it is literally the same table with `due_date = today`, so it costs nothing architecturally and its UI can be built later (see Roadmap).
- Future analytics (top drugs by profit, trends) as plain SQL queries.

The month view is the default UI, with a month picker; a day filter within it is trivial.

### 3.1 Incremental month population

"Months are data" does **not** mean the tool knows a year of refills in advance. A month exists only implicitly — it has content once at least one refill row carries a due date within it. Data arrives incrementally, one month (or partial month) at a time, via import or manual entry. The design handles this as follows:

- **Month picker signals data presence.** The picker visually distinguishes months that contain rows (with a row count) from months that are empty. The technician can navigate to any month, past or future.
- **Empty months get an empty state, not a blank grid.** Navigating to a month with no rows (e.g., August before its Pioneer export has been imported) shows a clear empty state with two calls to action: "Import CSV for this month" (v2) and "Add refill manually." The list simply ends where the data ends — the tool never fabricates or projects rows.
- **Imports are date-driven, not month-bound.** An imported CSV may contain rows spanning month boundaries (a report pulled mid-July can include early-August due dates). Rows land in whatever month their `due_date` says; the import is not "assigned" to a month. This means importing "the August report" is just importing a file — no month setup step exists or is needed.
- **The Opportunities panel is aware of data horizon.** Alerts only consider rows that exist. If tomorrow's refills haven't been imported yet, there is nothing to alert on — which is correct behavior, but the panel should show a subtle hint when the look-ahead window extends past the last populated date (e.g., "No data beyond Jul 31 — import next month's report"), so an empty panel reads as "not loaded yet" rather than "nothing valuable due."
- **Typical cadence (workflow assumption, not enforced):** near the start of each month, the technician exports the Pioneer report and imports it, populating that month in one step; stragglers are added manually. Nothing prevents multiple imports per month — upsert semantics (§5) make re-imports safe.

## 4. Data Model

Three concerns: drugs (identity), refills (the heart of the tool), lookups/settings (configurable vocabularies).

### 4.1 `drugs`


| Column | Type          | Notes                                                                                                                                                       |
| ------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id     | INTEGER PK    |                                                                                                                                                             |
| name   | TEXT NOT NULL | Exactly as it appears in PioneerRX, e.g. `TRIMIX- T105 5ML V. (OLYMPIA)` — vendor suffixes are part of the Pioneer identity and must not be normalized away |
| ndc    | TEXT NULL     | Nullable: compounded medications (e.g., TRIMIX, tirzepatide compounds) have no NDC                                                                          |


**Drug identity rule:** when matching "the same drug" across rows/months, match on NDC when present; fall back to exact name string when NDC is null. Rx Number identifies the prescription itself regardless.

### 4.2 `refills`

One row per refill attempt (per prescription per cycle).


| Column                  | Type                            | Notes                                                                                                           |
| ----------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| id                      | INTEGER PK                      |                                                                                                                 |
| rx_number               | TEXT NOT NULL                   | Displayed with one-click copy                                                                                   |
| drug_id                 | INTEGER FK → drugs              |                                                                                                                 |
| due_date                | DATE NOT NULL                   | From Pioneer's `Days Supply Ends On` on import, or manual entry. Drives month/day views and alerts              |
| insurance_id            | INTEGER FK → insurances         |                                                                                                                 |
| old_copay               | REAL NULL                       | Copay from the most recent (previous) fill. Import source: `Patient Paid Amount`                                |
| new_copay               | REAL NULL                       | Copay for the current fill, entered after insurance runs                                                        |
| old_profit              | REAL NULL                       | Net profit from previous fill. Import source: `Net Profit`                                                      |
| new_profit              | REAL NULL                       | Verified net profit for current fill; manual only                                                               |
| refills_filled          | INTEGER NULL                    | From import (`Number Of Refills Filled`); informational                                                         |
| refill_note_id          | INTEGER FK → refill_notes, NULL | What happened during the refill attempt                                                                         |
| call_note_id            | INTEGER FK → call_notes, NULL   | Outcome of contact; **only meaningful when the refill note is "Nimble Link" or "Call Pt"** (see business rules) |
| status                  | TEXT NOT NULL DEFAULT 'Pending' | Enum: `Pending`, `Checked Out`, `MISSED`, `$ LOSS` (see 4.4)                                                    |
| notes                   | TEXT NULL                       | Free text                                                                                                       |
| source                  | TEXT NOT NULL                   | `manual` or `import`                                                                                            |
| created_at / updated_at | TIMESTAMP                       |                                                                                                                 |


**Row identity for import/upsert:** `(rx_number, due_date)` is the natural key. A unique index on this pair prevents duplicates.

### 4.3 Lookup tables (all editable from Settings — never hardcoded in components)

`**insurances`** — id, name, color, sort_order, active flag. Note: *Cashed Out* and *LP* are insurance values, not statuses. Seed with the following color groups (exact hex values chosen during implementation to match a light-pastel palette; all editable in Settings):


| Seed color           | Insurances                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baby Blue            | Anthem, BC/BS - Alabama, BC/BS - Federal Employees, BC/BS - Florida, BC/BS - Texas, Horizon BC/BS NJ                                                                                |
| Light Purple         | Cigna, Cigna - Disclosed Rx, Cigna Great West, Express Scripts                                                                                                                      |
| Light Peach          | Aet - St Thomas, Aet - UMIA, CVS Caremark, Oscar                                                                                                                                    |
| Light Orange         | Catalyst Rx, Optum Rx, United Healthcare                                                                                                                                            |
| Light Green          | Capital Rx, Maxorplus Super, Proact, RightWay, PDMI                                                                                                                                 |
| Light Blue           | Nhp Open Access, Amerigroup, Caremore-Rx, Simply FL Medicaid (ignenioRx), Optum Medicaid, Envision Rx Plus, Mcaidadv, United Pt D, Molina, BC/BS - Part D, Amerihealth Caritas Next |
| Light Yellow         | Wausau                                                                                                                                                                              |
| Brown                | Coupon Only                                                                                                                                                                         |
| Green                | Cashed Out                                                                                                                                                                          |
| *(unassigned — TBD)* | LP                                                                                                                                                                                  |


The Light Blue group is the uniform Medicare/Medicaid designation; a `is_medicare_medicaid` boolean flag on the row drives that grouping so new Medicare/Medicaid plans automatically inherit the group color. Baby Blue and Light Blue must be visually distinct shades.

`**refill_notes*`* — seeded options (with their meanings, for tooltips):
`N/A`; `Nimble Link` (payment link sent to patient); `Call Pt` (phone call, typically 65+ patients not comfortable with links); `Faxed for Script` (fax to MD for new Rx when refills exhausted); `Fax not sent` (suppressed to avoid duplicate fax); `TOO SOON TO FILL`; `INS Issue`; `PA Req` (prior authorization required); `TRY AGAIN LATER` (couldn't reach patient); `NO Per Pt` (patient wants verbal authorization, check patient notes). Each has a display color matching the current sheet's color coding.

`**call_notes**` — seeded options:
`N/A`; `Discontinued`; `D/S` (delivery scheduled by tech via phone); `D/S+AutoRefill`; `P/U` (pickup scheduled); `Nimble IC` (paid via link, wants delivery); `Nimble PickUp` (paid via link, will pick up); `POH PER PT+WCB` (order on hold, patient will call back); `LVM+RSL` (voicemail left, link re-sent); `D/S+RSL` (patient will pay via Nimble later, link re-sent); `VMB FULL+RSL` (voicemail box full, link sent); `VMB NOT SET UP+RSL` (no voicemail set up, link sent). Each with a display color.

`**settings**` — key/value store for: copay tier thresholds, alert look-ahead days (X), alert minimum profit (Y), last-used CSV column mapping (v2), database backup path.

### 4.4 Status

Explicit workflow status, independent of the notes columns, so "show me everything unresolved" is a one-click filter:

- `Pending` — default; work not finished
- `Checked Out` — completed successfully
- `MISSED` — the refill slipped
- `$ LOSS` — filled at a loss / negative outcome

The status field ships in v1 (schema + a status column in the grid) even though the dedicated Call List workflow for setting statuses is deferred — adding UI later is cheap, retrofitting a status column after months of data is not.

## 5. Business Rules

**Call-note gating.** The Call Notes field is only applicable when Refill Note is `Nimble Link` or `Call Pt`. In the UI, disable/grey the call-note cell otherwise and clear it if the refill note changes to a non-qualifying value (with an undo-friendly prompt, not a silent wipe).

**Copay color tiers** (applies to both Old Copay and New Copay cells; thresholds configurable in Settings, seeded to match the sheet):


| Range             | Color        |
| ----------------- | ------------ |
| $0.00             | yellow-green |
| $0.01 – $29.99    | blue         |
| $30.00 – $99.99   | purple       |
| $100.00 – $300.00 | pink         |
| $300+             | red          |


**Profit color tiers (dynamic).** Old Profit and New Profit cells shade green with intensity **relative to the current dataset**: the maximum profit in the visible month sets the brightest green; lower values scale to lighter shades. (In the sheet this was approximated with manual tiers; in code, compute shade from `value / max(visible profits)` with a floor so small positive profits are still visibly green.) Negative or zero profit gets a distinct treatment (e.g., red/grey).

**Profit is verified, never predicted.** `new_profit` and `new_copay` are entered manually by the technician after running insurance in Pioneer. Anywhere the UI shows an expected value (Opportunities panel), it must display the last verified profit and label it "last fill" / "unverified."

**Import never overwrites human work** (v2 rule, but shapes v1 schema): upsert on `(rx_number, due_date)`; imported values fill NULL fields only; fields the technician already populated are left untouched.

**Rx # click-to-copy.** Clicking the Rx number copies it to clipboard with a brief visual confirmation. This is a daily-workflow feature (paste into Pioneer search), not a nicety.

**Floating Rx # on horizontal scroll.** The grid has enough columns that horizontal scrolling is expected. The Rx # must remain visible and copyable at all times: when the technician scrolls right and the Rx # column would leave the viewport, a floating Rx # element stays on screen for each visible row (implemented as a pinned/frozen column that sticks to the left edge, or an overlay chip per row — pinned column preferred as the simpler, more conventional pattern). The floating Rx # retains click-to-copy behavior. Consider pinning the Drug name alongside it so rows remain identifiable while scrolled.

## 6. Features by Version

### v1 — The Month Tab, done right

1. **Grid view (default screen).** Virtualized, editable data grid of refills for the selected month. Columns: Due date, Insurance (dropdown, colored), Drug, Rx # (click-to-copy), Refill Note (dropdown, colored), Call Note (dropdown, colored, gated), Old Copay, New Copay (tier-colored), Old Profit, New Profit (dynamic green), Status, Notes. Month picker (with data-presence indicators, §3.1); quick filters for day, status, insurance, and "unresolved only." Sortable columns. Rx # (and optionally Drug) pinned so they stay visible and copyable during horizontal scroll (§5, "Floating Rx #").
2. **Detail drawer.** Clicking a row opens a side drawer: all fields editable in form layout, plus **history** — previous refill rows for the same Rx (and same drug, by NDC/name rule) across all months with their dates, profits, and outcomes.
3. **Manual entry.** "Add refill" opens the same drawer in create mode. Drug field autocompletes against the `drugs` table and creates a new drug if unmatched.
4. **Opportunities panel.** A collapsible panel (see UI sketching phase) listing refills where `due_date` is within X days AND last verified profit ≥ $Y AND status is `Pending`, sorted by last profit descending. Each card: drug, Rx # (copyable), due date, last profit, current refill note. Clicking a card jumps to/opens that row. X and Y live in Settings (sensible seeds: X = 3 days, Y = $50).
5. **Settings.** Manage insurances (with colors and the Medicare/Medicaid flag), refill notes, call notes, copay tiers, alert thresholds, database backup/restore.

### v2 — CSV Import

- Import wizard: choose file → column-mapping step (tool proposes mappings for the known Pioneer headers; user can adjust; mapping persisted in settings) → preview with per-row disposition (new / update / skip) → commit.
- Mapping targets: `Rx Number → rx_number`, `Dispensed Item Name → drug name`, `Dispensed Item NDC → drug ndc`, `Days Supply Ends On → due_date`, `Patient Paid Amount → old_copay`, `Net Profit → old_profit`, `Number Of Refills Filled → refills_filled`.
- Upsert semantics per §5. Rows with unparseable dates or missing Rx numbers go to a reviewable error list, never silently dropped.
- Handle quirks observed in real exports: blank NDC (compounds), blank `Days Supply Ends On`, duplicate drug names differing only by NDC (e.g., Ycanth under two NDCs — these are distinct `drugs` rows).

### v3 — Call List & Analytics

- **Call List page**: the refills table filtered to today, presented as a focused worklist where statuses get set. Open UI question (technician preference pending): dedicated page vs. a "Today" filter on the month grid. Either way it is a view over the same table — no schema impact.
- Analytics: top drugs by total/average profit, month-over-month profit trend, MISSED-rate by insurance, etc.

## 7. Non-Goals

- No multi-user support, accounts, or network sync.
- No integration with PioneerRX beyond CSV import (no API, no scraping).
- No profit prediction or estimation logic — display verified values only.
- No PHI beyond what the current sheet holds (no patient names/DOB in v1 schema; if added later, revisit at-rest encryption).

## 8. Open Questions

1. Call List as separate page vs. day-filter on the month grid — awaiting technician preference (v3 decision).
2. Whether `$ LOSS` should auto-suggest when a negative `new_profit` is entered (proposed: yes, as a prompt, never automatic).
3. Seed color for the **LP** insurance value — not specified in the source sheet's palette; assign during implementation (editable in Settings regardless).

