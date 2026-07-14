# Refill Tracker — Design Document

## 1. Purpose & Context

Refill Tracker is a personal desktop tool for a single pharmacy technician at an independent pharmacy. It replaces a Google Sheets workflow in which the technician clones a "month tab" (e.g., "July Tab") every month to track prescription refills, log contact attempts with patients, record copays and net profits, and identify high-value refills.

The tool's three jobs, in priority order:

1. **Track refills** — a working queue of prescriptions due, with workflow notes on each contact attempt.
2. **Track profit** — old (last fill) and new (current fill) copay and net profit per refill, with the same at-a-glance color coding the technician relies on today.
3. **Surface opportunities** — alert the technician to refills coming due whose last verified profit was high, so high-value refills are worked first and never slip to MISSED.

This is a single-user tool. There is no server, no authentication, no multi-user sync. It must ship as a **single Windows .exe** that the technician double-clicks, with all data **persisted locally** and surviving app restarts and crashes.

### Source system context (PioneerRX)

The pharmacy runs PioneerRX. The technician looks up prescriptions in Pioneer by Rx number (hence the click-to-copy requirement on Rx #). Pioneer can export a CSV report; **the technician selects which columns each export contains, so no two files are guaranteed to look the same** (one real sample omitted `Days Supply Ends On` entirely). The full set of columns known to be available today, per prescription: `Rx Number`, `Dispensed Item Name`, `Dispensed Item NDC`, `Days Supply Ends On`, `Patient Paid Amount`, `Net Profit`, `Number Of Refills Filled`, `Primary` (primary insurance), and `Secondary` (secondary coverage — observed values are mostly coupon/copay-assistance programs, e.g. MAYNE, JOURNEY, Opus Health Coupon Plans). That export maps almost 1:1 onto the queue this tool manages and is the basis of the v2 import feature, which must tolerate any subset of these columns.

**Profit is never computed by this tool.** When the technician runs insurance in Pioneer, an adjudication window shows the patient copay, the pharmacy's drug cost, and the net profit. Insurance reimbursement is unpredictable (payers lower/raise reimbursement or drop coverage without warning), so the tool only stores profit values a human verified in Pioneer. "Expected profit" shown in alerts is always the **last verified** profit, explicitly labeled unverified for the current fill.

## 2. Tech Stack


| Layer             | Choice                                                                                         | Rationale                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Shell / packaging | **Tauri 2.x**                                                                                  | Ships a small (~10 MB) single .exe; native webview; far lighter than Electron for a one-user tool                         |
| UI                | **React + TypeScript**                                                                         | The UI is essentially a smart spreadsheet grid + dashboard panels — web tech's home turf                                  |
| Grid              | **AG Grid Community** (MIT, free tier — decided, validated by spike 2026-07-11)                | Inline editing, keyboard nav, pinned columns, custom colored dropdown editors, per-cell conditional styling, checkbox multi-select — all confirmed working in the free tier against this app's exact requirements |
| Storage           | **SQLite** via Tauri's SQL plugin (or rusqlite on the Rust side)                               | Single local `.db` file; durable; makes month filtering and cross-month analytics trivial queries; easy snapshot backups |
| Charts (later)    | Recharts or similar                                                                            | Only needed for v3 analytics                                                                                              |


The database file lives in the OS app-data directory (e.g., `%APPDATA%/RefillTracker/refills.db`). A Settings screen shows the file path and offers a one-click "Back up database" (to a user-chosen location) and "Restore from backup." Backups are taken via SQLite's backup API or `VACUUM INTO` so they are consistent snapshots even while the app is running — never a raw file copy of the live database, which can capture a mid-write (corrupt or stale) state.

## 3. Core Architectural Decision: Months Are Data, Not Structure

In the spreadsheet, each month is a cloned tab. In this tool, **there is exactly one refills table**, and every row carries a due date. "The July tab" is simply the grid filtered to `due_date` within July. This one decision enables:

- Per-Rx **history across months** (past profits, past call outcomes) shown in the detail drawer. (Strictly per Rx number — the data holds no patient identity, so drug-level grouping would mix patients; see story 2.3. Drug-level aggregation is reserved for v3 analytics.)
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
| secondary_id            | INTEGER FK → secondary_coverages, NULL | Optional secondary coverage (coupon/copay-assistance programs). Grid column hidden by default, toggleable (technician decision 2026-07-11). Not in the initial migration — add via the M1 follow-up migration |
| old_copay               | REAL NULL                       | Copay from the most recent (previous) fill. Import source: `Patient Paid Amount`                                |
| new_copay               | REAL NULL                       | Copay for the current fill, entered after insurance runs                                                        |
| old_profit              | REAL NULL                       | Net profit from previous fill. Import source: `Net Profit`                                                      |
| new_profit              | REAL NULL                       | Verified net profit for current fill; manual only                                                               |
| refills_filled          | INTEGER NULL                    | From import (`Number Of Refills Filled`); informational                                                         |
| refill_note_id          | INTEGER FK → refill_notes, NULL | What happened during the refill attempt                                                                         |
| call_note_id            | INTEGER FK → call_notes, NULL   | Outcome of contact; **only meaningful when the refill note is "Nimble Link" or "Call Pt"** (see business rules) |
| refill_note_set_at      | TIMESTAMP NULL                  | Auto-updated whenever `refill_note_id` changes; drives the Nimble Link aging counter (§5). Not in the initial migration — add via a follow-up migration during M1 |
| status                  | TEXT NOT NULL DEFAULT 'Pending' | Enum: `Pending`, `Checked Out`, `MISSED` (see 4.4)                                                              |
| notes                   | TEXT NULL                       | Free text                                                                                                       |
| source                  | TEXT NOT NULL                   | `manual` or `import`                                                                                            |
| created_at / updated_at | TIMESTAMP                       |                                                                                                                 |


**Row identity for import/upsert:** `(rx_number, due_date)` is the natural key. A unique index on this pair prevents duplicates.

### 4.3 Lookup tables (all editable from Settings — never hardcoded in components)

`**insurances`** — id, name, color, sort_order, active flag. Note: *Cashed Out* is an insurance value, not a status. (*LP*, once thought to be an insurance, is **not used** — technician confirmed 2026-07-11 it can be disregarded entirely; it is not seeded anywhere.) Seed with the following color groups (exact hex values chosen during implementation to match a light-pastel palette; all editable in Settings):


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


The Light Blue group is the uniform Medicare/Medicaid designation; a `is_medicare_medicaid` boolean flag on the row drives that grouping so new Medicare/Medicaid plans automatically inherit the group color. Baby Blue and Light Blue must be visually distinct shades.

`**secondary_coverages**` — same shape as insurances (id, name, color, sort_order, active flag), managed in Settings exactly the same way (technician decision 2026-07-11). Holds the optional secondary coverage vocabulary — in practice coupon/copay-assistance programs. **Seed with a single option: `Coupon`**; the technician adds more manually as they come up.

`**refill_notes*`* — seeded options exactly as in the sheet's dropdown (with their meanings, for tooltips):
`Discontinued` (patient or prescriber ended therapy; the row resolves — this is a refill-level state in the source sheet, not a call outcome); `Nimble Link` (payment link sent to patient); `Call Pt` (phone call, typically 65+ patients not comfortable with links); `Faxed for Script` (fax to MD for new Rx when refills exhausted); `Fax not sent` (suppressed to avoid duplicate fax); `TOO SOON TO FILL`; `INS Issue`; `PA Req` (prior authorization required); `TRY AGAIN LATER` (couldn't reach patient); `NO Per Pt` (patient wants verbal authorization, check patient notes). Each has a display color matching the current sheet's color coding.

`**call_notes**` — seeded options exactly as in the sheet's dropdown:
`N/A`; `D/S` (delivery scheduled by tech via phone); `P/U` (pickup scheduled); `Nimble IC` (paid via link, wants delivery); `Nimble PickUp` (paid via link, will pick up); `LVM+RSL` (voicemail left, link re-sent); `D/S+RSL` (patient will pay via Nimble later, link re-sent); `VMB FULL+RSL` (voicemail box full, link sent); `VMB NOT SET UP+RSL` (no voicemail set up, link sent); `POH PER PT+WCB` (order on hold — patient doesn't want it right now, will call back); `PT WCB+RSL` (patient will call back for payment; Nimble link sent just in case). Each with a display color.

The sheet's dropdowns prefix options with numbers (`0.`, `1.` …) purely to force ordering — that hack is replaced by the `sort_order` column; stored names carry no prefixes.

`**settings**` — key/value store for: copay tier thresholds, alert look-ahead days (X), alert minimum profit (Y), Nimble Link aging alert days (seeded to 5, see §5), last-used CSV column mapping (v2), database backup path.

### 4.4 Status

Explicit workflow status, independent of the notes columns, so "show me everything unresolved" is a one-click filter:

- `Pending` — default; work not finished
- `Checked Out` — completed successfully
- `MISSED` — the refill slipped

Status display colors follow the sheet's legend: `MISSED` dark navy, `Checked Out` yellow.

There is **no separate "filled at a loss" status** (the sheet's `$ LOSS` legend entry was dropped per technician feedback, 2026-07-11 — it described the money, not the workflow). A loss is recorded as `Checked Out` with a negative `new_profit`; the profit cell's red treatment flags it at a glance, and v3 analytics derive loss counts from `new_profit < 0`. "Unresolved" always means `Pending` only.

The status field ships in v1 (schema + a status column in the grid) even though the dedicated Call List workflow for setting statuses is deferred — adding UI later is cheap, retrofitting a status column after months of data is not.

## 5. Business Rules

**Call-note gating.** The Call Notes field is only applicable when Refill Note is `Nimble Link` or `Call Pt`. In the UI, disable/grey the call-note cell otherwise and clear it if the refill note changes to a non-qualifying value (with an undo-friendly prompt, not a silent wipe).

**Nimble Link aging counter** (technician feedback, 2026-07-11). When a row's Refill Note is `Nimble Link`, the month grid shows a small counter inside the cell, to the right of the label: the number of days since the link was sent — i.e., since the refill note was last set to `Nimble Link`, tracked by `refill_note_set_at`. Once it reaches 5 days the counter highlights red: the link has sat unpaid too long and it's time to re-send or call. The threshold is a Settings value (seeded to 5 days). The counter appears **only in the month grid** — not in the drawer, Opportunities cards, or the Overdue tab.

**Copay color tiers** (applies to both Old Copay and New Copay cells; thresholds configurable in Settings, seeded to match the sheet):


| Range             | Color        |
| ----------------- | ------------ |
| $0.00             | yellow-green |
| $0.01 – $29.99    | blue         |
| $30.00 – $99.99   | purple       |
| $100.00 – $300.00 | pink         |
| $300+             | red          |


**Profit color tiers (dynamic).** Old Profit and New Profit cells shade green with intensity **relative to the rows currently visible on screen** — the active filter set, not a fixed scale. The maximum profit among visible rows sets the brightest green; lower values scale to lighter shades. When the visible set changes, shades recompute: filtered to July 3rd, shading is relative to July 3rd's profits; widen to the full month and every cell re-shades relative to the whole month. (In the sheet this was approximated with manual tiers; in code, compute shade from `value / max(visible profits)` with a floor so small positive profits are still visibly green.) Negative or zero profit gets a distinct treatment (e.g., red/grey).

**Profit is verified, never predicted.** `new_profit` and `new_copay` are entered manually by the technician after running insurance in Pioneer. Anywhere the UI shows an expected value (Opportunities panel), it must display the last verified profit and label it "last fill" / "unverified." **"Last verified profit" is the row's `old_profit`** — what the pharmacy actually earned the last time this prescription was sold. `new_profit` stays empty until the technician runs insurance and enters what Pioneer reports; once entered, the row joins the verified rows for its day/month.

**One Rx # = one medication** (technician feedback, 2026-07-12). An Rx number identifies a single prescription, so every row sharing an `rx_number` must reference the same drug (renewals arrive under a new Rx number). Enforced in the app, not the schema: manual add of an existing Rx # under a different drug is blocked with a warning offering to adopt the Rx's existing medication or fix the Rx #; editing a row's drug when other rows share its Rx prompts to apply the correction to **all** rows of that Rx; changing a row's Rx # to one that exists under a different medication is rejected. v2 import: a CSV row whose Rx # matches existing rows under a different drug must surface in the preview as a conflict, never imported silently.

**Import never overwrites human work** (v2 rule, but shapes v1 schema): upsert on `(rx_number, due_date)`; imported values fill NULL fields only; fields the technician already populated are left untouched.

**Rx # click-to-copy.** Clicking the Rx number copies it to clipboard with a brief visual confirmation. This is a daily-workflow feature (paste into Pioneer search), not a nicety.

**Floating Rx # on horizontal scroll.** The grid has enough columns that horizontal scrolling is expected. The Rx # must remain visible and copyable at all times: when the technician scrolls right and the Rx # column would leave the viewport, a floating Rx # element stays on screen for each visible row (implemented as a pinned/frozen column that sticks to the left edge, or an overlay chip per row — pinned column preferred as the simpler, more conventional pattern). The floating Rx # retains click-to-copy behavior. Consider pinning the Drug name alongside it so rows remain identifiable while scrolled.

## 6. Features by Version

### v1 — The Month Tab, done right

1. **Grid view (default screen).** Virtualized, editable data grid of refills for the selected month. Columns: Due date, Insurance (dropdown, colored), Drug, Rx # (click-to-copy), Refill Note (dropdown, colored), Call Note (dropdown, colored, gated), Old Copay, New Copay (tier-colored), Old Profit, New Profit (dynamic green), Status, Notes — plus an optional **Secondary** column (dropdown over `secondary_coverages`), **hidden by default** with a show/hide toggle, since the technician only sometimes wants to see secondary coverage (decided 2026-07-11). Month picker (with data-presence indicators, §3.1); quick filters for day, status, insurance, and "unresolved only." Sortable columns. Rx # (and optionally Drug) pinned so they stay visible and copyable during horizontal scroll (§5, "Floating Rx #") — the current sheet literally duplicates the RX column on the far right as a manual workaround, so this is a proven daily need. Within the month view, day boundaries get a visible separator between date groups (the sheet marks them with colored divider lines — a scanning habit worth preserving); separators show only while the grid is in due-date order and disappear under any other sort until date order returns (decided in UI sketching). Sortable columns include an always-visible **Reset sort** control restoring the default due-date order, so an accidental header click is cheap to undo.

   **Dropdown cells open on a single click** (technician feedback, 2026-07-11); text and numeric cells keep double-click so a stray click doesn't start an edit.

   **Insurance logos (technician feedback 2026-07-11 — pending assets, see open question §8.3).** Insurance cells will show the plan's master-brand official logo to the right of the name, replacing color coding as the visual grouping (the CVS logo for CVS Caremark, the BCBS shield-and-cross for every Blue Cross variant, etc.). Plans combined with Medicare or Medicaid additionally display "(Medicare)" or "(Medicaid)" after the name, next to the group logo. Data model when implemented: an `insurance_groups` table (name, logo image, sort order) with `insurances.group_id`, and a per-plan Medicare/Medicaid designation replacing today's single boolean flag; Settings organizes insurances under their master-brand group, and adding a new insurance files it into a group (§6.6). Logo images are stored locally — the tool stays offline and single-exe. Until the assets and the brand mapping arrive, the color-coded cells remain.

   **Due-date lock** (technician feedback, 2026-07-11): a lock toggle next to the sort controls pins due date (ascending or descending, whichever is active when locked) as the fixed primary sort key. While locked, clicking any other column header sorts rows *within each day* — due date stays the outer order and the clicked column becomes the secondary key (with the usual asc/desc toggling) — so the day sections and their separator lines stay intact while the technician ranks rows inside each day (e.g., by Old Profit to work a day's most valuable refills first). Unlocking returns to normal single-column sorting; **Reset sort** also clears the lock. Refill Note cells showing `Nimble Link` additionally carry the aging counter described in §5.

   Grid spike learnings (2026-07-11), for implementation: (a) AG Grid computes row classes only on draw — call `redrawRows()` on sort change or the day-separator lines stick to stale rows; (b) drag-fill handle and multi-cell range copy/paste are Enterprise-only — bulk edits use checkbox selection + apply-to-selected instead, matching the import error-list pattern; (c) grid height ~75% of the window per technician feedback on the spike.
2. **Detail drawer.** Clicking a row opens a side drawer: all fields editable in form layout, plus **history** — previous refill rows for the same Rx number across all months with their dates, profits, and outcomes (strictly per rx_number, never drug-grouped — story 2.3). Long free-text Notes may not fit the field: hovering over the Notes section shows the full note in a popup bubble, which disappears when the cursor leaves (technician feedback, 2026-07-11).
3. **Manual entry.** "Add refill" opens the same drawer in create mode. Drug field autocompletes against the `drugs` table and creates a new drug if unmatched.

   **Probable-duplicate guard** (technician feedback, 2026-07-12): the v2 import's due-date-drift rule applies to manual add too. Multiple rows per Rx are by design — one per refill cycle — but a new row for an Rx that already has a row due within **21 days** is almost certainly the same cycle with a drifted date, not the next one (cycles run ~28/30/90 days). Saving such a row warns and offers **Open existing row** or an explicit **Create anyway** override; never silently created.

   **Row deletion** (technician feedback, 2026-07-12): deliberately not a one-click affordance. Right-clicking a row opens a small context menu with "Delete refill…", and the drawer's footer carries the same action; both confirm with the row's Rx #, drug, and due date before permanently deleting (story 2.4). No undo in v1 — the confirmation is the guard.
4. **Opportunities panel.** A collapsible **right-hand sidebar** (decided in UI sketching, 2026-07-11; collapses to a thin rail when the technician wants full grid width) listing refills where `due_date` is within X days AND last verified profit (`old_profit`) ≥ $Y AND status is `Pending` AND `new_profit` is still empty — once the technician enters a verified new profit, the card leaves the panel. Sorted by last profit descending. Each card: drug, Rx # (copyable), due date, last profit, current refill note. Clicking a card jumps to/opens that row. X and Y live in Settings (sensible seeds: X = 3 days, Y = $50).

   **Card ↔ grid linking** (technician feedback, 2026-07-12): hovering a card highlights the matching grid row so it can be spotted in place; each card also carries a **"Go to row"** action that scrolls the grid to the row and flashes it *without* opening the drawer — switching month or clearing the quick filters if that's what it takes to bring the row into view.
5. **Overdue view.** A dedicated tab listing, across **all** months, rows whose due date has passed while still `Pending`, plus rows marked `MISSED` — so slipped work stays visible without polluting the day/month view the technician is working. Rows open and edit exactly like grid rows; resolving a row removes it from the tab. `MISSED` rows stay listed indefinitely — the tab doubles as the permanent record of slipped refills (decided in UI sketching; no auto-hide). A per-row "add to today's call list" action ships alongside the Call List (v3); until then it renders greyed so the layout accounts for it. No schema impact — it is a filter over the same refills table.

   **Built in M4** as the app's first navigation: a tab bar (Month | Overdue; Settings joins in M5). Columns follow the UI sketch — Rx # (copyable), Drug, "Was due" showing the original date plus days overdue, Insurance, Refill Note (without the Nimble Link counter, story 1.9), Old Profit, Status, action — sorted oldest first; all other fields edit through the shared drawer. The tab's count badge and the banner above the list count **Pending past-due rows only** (decided 2026-07-13): MISSED rows accumulate forever as the permanent record, so including them would grow the badge unboundedly and bury the "work this now" signal.
6. **Settings.** Manage insurances (with colors and the Medicare/Medicaid flag), secondary coverages (same CRUD as insurances; seeded with just `Coupon`), refill notes, call notes, copay tiers, alert thresholds, database backup/restore. Once the logo feature lands (§6.1), the insurances list is organized under master-brand groups — each group carries the official logo, and new insurances are added into a group (all BC/BS variants under one BCBS group, etc.). In v1, insurance on rows is set manually from the colored dropdown; in v2, imports pre-fill it from the export's `Primary` column when that column is present (fill-blanks-only, like every imported field).

### v2 — CSV Import

- **Exports are column-configurable (§1).** The wizard maps whichever known columns are present in the file and ignores the rest; only `Rx Number` is strictly required. A file with no `Days Supply Ends On` column routes every row through the blank-due-date bulk-assignment path below — the import still works.
- Import wizard: choose file → column-mapping step (tool proposes mappings for the known Pioneer headers; user can adjust; mapping persisted in settings) → preview with per-row disposition (new / update / skip) → commit.
- Mapping targets: `Rx Number → rx_number`, `Dispensed Item Name → drug name`, `Dispensed Item NDC → drug ndc`, `Days Supply Ends On → due_date`, `Patient Paid Amount → old_copay`, `Net Profit → old_profit`, `Number Of Refills Filled → refills_filled`, `Primary → insurance`, `Secondary → secondary coverage` (matched against `secondary_coverages` with the same case-insensitive/surface-unmatched rules as Primary below).
- **Primary → insurance matching is case-insensitive** (exports use `CVS CAREMARK`, `RIGHTWAY`; the insurances list has `CVS Caremark`, `RightWay`). Values that match no existing insurance (e.g. `VILLAGE RX LOCAL`, `Magellan` in real samples) surface in the preview for the technician to map to an existing insurance, create as a new one, or leave blank — never guessed silently.
- Upsert semantics per §5. Rows with unparseable dates or missing Rx numbers go to a reviewable error list, never silently dropped.
- **Probable-duplicate detection (due-date drift).** `Days Supply Ends On` can shift between overlapping exports for the same refill cycle, so exact `(rx_number, due_date)` matching alone would create duplicates. A parsed row whose Rx # matches an existing `Pending` row with a *nearby but different* due date is flagged in the preview as a probable duplicate with a warning; the technician chooses per row: update the existing row (adopting the new due date) or override and insert as a genuinely new row. Never silently inserted.
- **Bulk-fix for blank due dates.** In the error list, the technician can multi-select rows with a blank `Days Supply Ends On` and apply a single due date to all of them at once — or skip them, individually or in bulk.
- Handle quirks observed in real exports: blank NDC (compounds), blank `Days Supply Ends On`, duplicate drug names differing only by NDC (e.g., Ycanth under two NDCs — these are distinct `drugs` rows).

### v3 — Call List & Analytics

- **Call List page**: the refills table filtered to today, presented as a focused worklist where statuses get set. Open UI question (technician preference pending): dedicated page vs. a "Today" filter on the month grid. Either way it is a view over the same table — no schema impact.
- **Quick-add an associated Rx** (technician feedback, 2026-07-11 — documented now, implemented with the Call List): right-clicking an existing row offers **"Add associated Rx"**, a simplified create form for a related refillable prescription (e.g., another Rx for the same patient surfaced during the call). Required fields: Rx #, medication name (autocomplete as in manual add), insurance, refill note; the **due date is pre-set from the selected row** rather than entered. Optional: old/new copay, old/new profit, refills filled, status, and the other drawer fields. Saves like any manual add (`source = manual`, duplicate Rx#+due-date check per Flow 4).
- Analytics: top drugs by total/average profit, month-over-month profit trend, MISSED-rate by insurance, etc.

## 7. Non-Goals

- No multi-user support, accounts, or network sync.
- No integration with PioneerRX beyond CSV import (no API, no scraping).
- No profit prediction or estimation logic — display verified values only.
- No PHI beyond what the current sheet holds (no patient names/DOB in v1 schema; if added later, revisit at-rest encryption).

## 8. Open Questions

1. Call List as separate page vs. day-filter on the month grid — awaiting technician preference (v3 decision).
2. Compound drugs (no NDC) are matched by exact name string, and Pioneer name strings can drift (spacing, vendor suffixes), which would create duplicate `drugs` rows. Accepted for now — fuzzy/normalized name matching is deferred until it proves to be a problem in practice.
3. **Insurance logo feature inputs** (technician feedback 2026-07-11): the master-brand group each seeded insurance belongs to, each plan's Medicare vs Medicaid designation (for the name suffix), and the logo image assets themselves (user offered to source them). Blocks only the logo feature, nothing else in v1.

Resolved 2026-07-11 (decisions folded into the sections above): **LP** is not used by the technician and is disregarded entirely (§4.3); the **Secondary** export column maps to the new `secondary_coverages` lookup / `refills.secondary_id`, displayed as an optional hidden-by-default grid column (§4.2, §4.3, §6, v2 mapping).

