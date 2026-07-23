# Refill Tracker — Design Document

## 1. Purpose & Context

Refill Tracker is a personal desktop tool for a single pharmacy technician at an independent pharmacy. It replaces a Google Sheets workflow in which the technician clones a "month tab" (e.g., "July Tab") every month to track prescription refills, log contact attempts with patients, record copays and net profits, and identify high-value refills.

The tool's three jobs, in priority order:

1. **Track refills** — a working queue of prescriptions due, with workflow notes on each contact attempt.
2. **Track profit** — old (last fill) and new (current fill) copay and net profit per refill, with the same at-a-glance color coding the technician relies on today.
3. **Surface opportunities** — alert the technician to refills coming due whose last verified profit was high, so high-value refills are worked first and never slip to MISSED.

This is a single-user tool. There is no server, no authentication, no multi-user sync. It must ship as a **single Windows .exe** that the technician double-clicks, with all data **persisted locally** and surviving app restarts and crashes.

### Source system context (PioneerRX)

The pharmacy runs PioneerRX. The technician looks up prescriptions in Pioneer by Rx number (hence the click-to-copy requirement on Rx #). Pioneer exports arrive as an `.xlsx` spreadsheet; CSV remains accepted for saved-as-CSV reports. The fixed contract is `Days Supply Ends On`, `Rx Number`, `Dispensed Item Name`, `Patient Paid Amount`, `Net Profit`, `Refills Left`, `Primary`, and `Secondary`; `Dispensed Item NDC` is explicitly ignored and deferred. The wizard maps these fields and previews every row before import.

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

### Updates

The app self-updates from the public releases-only GitHub repository. It checks
at launch and on demand from **Settings → About**; the technician is always
asked before an installation. Update checks and approved update downloads are
the app's only network activity. All pharmacy data stays local.

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
- **Empty months get an empty state, not a blank grid.** Navigating to a month with no rows (e.g., August before its Pioneer export has been imported) shows a clear empty state with two calls to action: "Import a spreadsheet" (opens the import wizard — the file's own due dates decide where rows land) and "Add refill manually." The list simply ends where the data ends — the tool never fabricates or projects rows.
- **Imports are date-driven, not month-bound.** An imported spreadsheet may contain rows spanning month boundaries (a report pulled mid-July can include early-August due dates). Rows land in whatever month their `due_date` says; the import is not "assigned" to a month. This means importing "the August report" is just importing a file — no month setup step exists or is needed.
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
| refills_left            | INTEGER                         | Refills remaining in the technician export; distinct from dormant `refills_filled` (refills used)              |
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
| call_note_set_at        | TIMESTAMP NULL                  | Auto-updated whenever `call_note_id` changes; the Req Follow Up "quiet days" clock (§5). Added by migration 004 (2026-07-15) |
| status                  | TEXT NOT NULL DEFAULT 'Pending' | Enum: `Pending`, `Checked Out`, `MISSED` (see 4.4)                                                              |
| notes                   | TEXT NULL                       | Free text                                                                                                       |
| source                  | TEXT NOT NULL                   | `manual` or `import`                                                                                            |
| created_at / updated_at | TIMESTAMP                       |                                                                                                                 |


**Row identity for import/upsert:** `(rx_number, due_date)` is the natural key. A unique index on this pair prevents duplicates.

### 4.3 Lookup tables (all editable from Settings — never hardcoded in components)

`**insurances`** — id, name, group_id (nullable FK → `insurance_groups`), is_medicare flag, is_medicaid flag, sort_order, active flag. Note: *Cashed Out* is an insurance value, not a status. (*LP*, once thought to be an insurance, is **not used** — technician confirmed 2026-07-11 it can be disregarded entirely; it is not seeded anywhere.)

**Brand group + designation model** (decided 2026-07-14, replacing the original color-group model): each plan belongs to at most **one** master-brand group, plus independent Medicare/Medicaid designation flags (zero, one, or both). The technician's grouping doc listed "Medicaid" and "Medicare" as groups, but every plan in them also appeared under a brand group — they are the designation lists, not groups. Insurance cells render the plan name with the group's logo to its right, **logo or nothing** (no color-fill fallback — decided 2026-07-14); designated plans append "(Medicare)" / "(Medicaid)" wherever the name renders. Insurance colors (and the old uniform Medicare/Medicaid group color) are retired.

`**insurance_groups**` — id, name, logo (asset key into the bundled logo set, nullable), sort_order, active flag. Groups are data: the technician can add/rename groups and move plans between them in Settings. Logos are a **bundled fixed set** compiled into the exe (offline/single-exe constraint) — a group picks its logo from that set; new artwork requires a new build. Some seeded groups will eventually be designated **non-deletable bundled defaults; which ones is an open question (§8.5)**.

Seed groups and plan assignments (from the technician's `Insurance_grouping.md`, 2026-07-14):

| Group (logo)                               | Plans                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Blue Cross Blue Shield (BCBS shield)       | BC/BS - Alabama, BC/BS - Federal Employees, BC/BS - Florida, BC/BS - Texas, Horizon BC/BS NJ, BC/BS - Part D *(Medicare)* |
| CVS Health                                 | Aet - St Thomas, CVS Caremark                                                                |
| Elevance Health                            | Anthem, Amerigroup *(Medicaid)*, Simply FL Medicaid (ignenioRx) *(Medicaid)*                 |
| UnitedHealth Group                         | Optum Rx, United Healthcare, Optum Medicaid *(Medicaid)*, United Pt D *(Medicare)*, Nhp Open Access |
| The Cigna Group                            | Cigna, Cigna - Disclosed Rx, Cigna Great West, Express Scripts                               |
| Oscar Health                               | Oscar                                                                                        |
| MedImpact Healthcare Systems               | Envision Rx Plus *(Medicare)*                                                                |
| Molina Healthcare                          | Molina *(Medicare + Medicaid)*                                                               |
| AmeriHealth Caritas                        | Amerihealth Caritas Next *(Medicare + Medicaid)*                                             |
| Independent / Stand-Alone PBMs (logo TBD)  | Catalyst Rx, Capital Rx, Maxorplus Super, Proact, RightWay, PDMI, Caremore-Rx                |
| *Ungrouped* (`group_id` NULL — renders plain) | Aet - UMIA, Wausau, Mcaidadv *(Medicare)*, Coupon Only, Cashed Out                        |

Ungrouped is not a group row — `group_id` is simply NULL. It is the honest home for plans the technician hasn't placed (Aet - UMIA, Wausau — open question §8.4) and for the workflow states that aren't payers at all (Coupon Only, Cashed Out). It is also where a newly added insurance lands if the group question is skipped.

`**secondary_coverages**` — id, name, logo (asset key, nullable — **direct per-row logo, no groups**; decided 2026-07-14, there is no brand hierarchy to model), sort_order, active flag. Managed in Settings with the same CRUD affordances as insurances (technician decision 2026-07-11; "same" means the affordances, not the group model). Holds the optional secondary coverage vocabulary — in practice coupon/copay-assistance programs. **Seed with a single option: `Coupon`**, pointing at the bundled coupon logo. Secondary cells follow the same logo-or-plain rule as insurances; secondary colors are retired.

`**refill_notes*`* — seeded options exactly as in the sheet's dropdown (with their meanings, for tooltips):
`Discontinued` (patient or prescriber ended therapy; the row resolves — this is a refill-level state in the source sheet, not a call outcome); `Nimble Link` (payment link sent to patient); `Call Pt` (phone call, typically 65+ patients not comfortable with links); `Faxed for Script` (fax to MD for new Rx when refills exhausted); `Fax not sent` (suppressed to avoid duplicate fax); `TOO SOON TO FILL`; `INS Issue`; `PA Req` (prior authorization required); `TRY AGAIN LATER` (couldn't reach patient); `NO Per Pt` (patient wants verbal authorization, check patient notes). Each has a display color matching the current sheet's color coding.

Refill notes additionally carry two **behavior flags** (decided 2026-07-14) so business rules key off flags, never off names — renaming an option can no longer silently break behavior: `allows_call_note` (row's call-note cell is enabled; seeded true for `Nimble Link` and `Call Pt`) and `shows_age_counter` (month grid shows the days-since-set counter; seeded true for `Nimble Link`). Both surface in Settings as plain-language checkboxes, so a future note can join either behavior without a code change.

`**call_notes**` — seeded options exactly as in the sheet's dropdown:
`N/A`; `D/S` (delivery scheduled by tech via phone); `P/U` (pickup scheduled); `Nimble IC` (paid via link, wants delivery); `Nimble PickUp` (paid via link, will pick up); `LVM+RSL` (voicemail left, link re-sent); `D/S+RSL` (patient will pay via Nimble later, link re-sent); `VMB FULL+RSL` (voicemail box full, link sent); `VMB NOT SET UP+RSL` (no voicemail set up, link sent); `POH PER PT+WCB` (order on hold — patient doesn't want it right now, will call back); `PT WCB+RSL` (patient will call back for payment; Nimble link sent just in case). Each with a display color.

Call notes carry one **behavior flag** (added 2026-07-15, same flags-not-names principle as refill notes): `requires_followup` — the note means "contact made, waiting on the patient", which feeds Req Follow Up membership (§5). Seeded true for `LVM+RSL`, `D/S+RSL`, `P/U`, `VMB FULL+RSL`, `VMB NOT SET UP+RSL`, `PT WCB+RSL`; surfaced as a checkbox in Settings → Call notes, so the technician can add or remove notes from the follow-up set without a code change (note `P/U` is included while `D/S` is not — pickups depend on the patient showing up, deliveries are pharmacy-driven; her checkbox to revisit).

The sheet's dropdowns prefix options with numbers (`0.`, `1.` …) purely to force ordering — that hack is replaced by the `sort_order` column; stored names carry no prefixes.

`**settings**` — key/value store for: copay tier thresholds, alert look-ahead days (X), alert minimum profit (Y), Nimble Link aging alert days (seeded to 5, see §5), Req Follow Up wait days (`followup_wait_days`, seeded to 5 — a separate setting from the Nimble aging days even though they coincidentally match), `import_column_mapping` (v2), database backup path.

`**import_aliases**` — remembered Primary/Secondary export-name resolutions (v2 import):

| column    | type                                                | notes                                                                 |
| --------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| id        | INTEGER PK                                           |                                                                       |
| kind      | TEXT NOT NULL CHECK ('insurance' \| 'secondary')     | the same raw text can resolve differently as Primary vs Secondary     |
| raw_name  | TEXT NOT NULL COLLATE NOCASE                         | UNIQUE with kind; "EXPRESS SCRIPTS" and "Express Scripts" are one row |
| target_id | INTEGER NULL                                         | NULL = remembered "leave blank" decision                              |

Auto-matches and explicit blank choices are persisted alongside manual mappings. Integrity is app-level: deleting an unused insurance/secondary also deletes its aliases (same atomic batch), and aliases whose target no longer exists are filtered out at load and re-surface as unresolved.

### 4.4 Status

Explicit workflow status, independent of the notes columns, so "show me everything unresolved" is a one-click filter:

- `Pending` — default; work not finished
- `Checked Out` — completed successfully
- `MISSED` — the refill slipped

Status display colors follow the sheet's legend: `MISSED` dark navy, `Checked Out` yellow.

There is **no separate "filled at a loss" status** (the sheet's `$ LOSS` legend entry was dropped per technician feedback, 2026-07-11 — it described the money, not the workflow). A loss is recorded as `Checked Out` with a negative `new_profit`; the profit cell's red treatment flags it at a glance, and v3 analytics derive loss counts from `new_profit < 0`. "Unresolved" always means `Pending` only.

The status field ships in v1 (schema + a status column in the grid) even though the dedicated Call List workflow for setting statuses is deferred — adding UI later is cheap, retrofitting a status column after months of data is not.

Status is always the technician's declaration — **the app never writes it**. An earlier "auto-mark MISSED after 5 quiet days" idea was rejected (2026-07-15, ADR 0002): a stale follow-up row is still pending work, and MISSED is a human judgment.

### 4.5 `refill_events`

Append-only workflow log (added by migration 004, 2026-07-15; ADR 0002): `id, refill_id, at, kind, old_value, new_value, profit`. Kinds: `refill_note`, `call_note`, `status` (technician edits) plus `followup_entered` / `followup_left` (span markers written by the Req Follow Up sweep — launch, any data change, day rollover; idempotent, never mutates refills). Values are **display names captured at event time**, so renaming a lookup never rewrites history. `profit` snapshots `new_profit` on `status → Checked Out` events — "profit made in \<month\>" analytics by when the money was actually made, not by due date. Deliberately **no FK cascade**: events outlive row deletion as the permanent analytics record. Changes to the same field within a **2-minute settling window** collapse into one event (a set-then-revert inside the window nets to no event) — accidental clicks corrected on the spot don't pollute the record, but anything that survives 2 minutes is real history: "call note LVM+RSL, patient called back, P/U two minutes later" records both steps (user decision 2026-07-15, replacing an earlier same-calendar-day collapse that erased exactly that sequence). Shown read-only, with date and time, in the drawer's Activity section.

## 5. Business Rules

**Call-note gating.** The Call Notes field is only applicable when the Refill Note's `allows_call_note` flag is set (seeded: `Nimble Link`, `Call Pt` — the rule keys off the flag, not the name, per §4.3). In the UI, disable/grey the call-note cell otherwise and clear it if the refill note changes to a non-qualifying value (with an undo-friendly prompt, not a silent wipe).

**Nimble Link aging counter** (technician feedback, 2026-07-11). When a row's Refill Note has the `shows_age_counter` flag (seeded: `Nimble Link`), the month grid shows a small counter inside the cell, to the right of the label: the number of days since the link was sent — i.e., since the refill note was last set to `Nimble Link`, tracked by `refill_note_set_at`. Once it reaches 5 days the counter highlights red: the link has sat unpaid too long and it's time to re-send or call. The threshold is a Settings value (seeded to 5 days). The counter appears **only in the month grid** — not in the drawer, Opportunities cards, or the Overdue tab.

**Req Follow Up membership** (grill interview 2026-07-15; ADR 0002). A row *requires follow-up* when the technician has already done her part but the patient has gone quiet: `status = Pending` AND `new_copay` entered AND `new_profit > $0` AND the call note carries the `requires_followup` flag AND **more than `followup_wait_days`** (Settings, seeded 5) have passed since the call note was last set (`call_note_set_at`). The threshold is the *doorway*, not a status trigger: for the first N days the row is just being waited on and appears nowhere special; crossing N days quiet surfaces it on the Req Follow Up tab. A fresh call note re-stamps the clock and pulls the row back off the tab; `Checked Out` or `MISSED` resolves it. `new_profit > $0` is deliberate — a refill at $0 or a loss isn't money the pharmacy was counting on, so it never enters the tab (and MISSED, when the technician declares it, means lost *expected* money). The refill-note condition (Nimble Link / Call Pt) is intentionally not checked: call-note gating already guarantees a call note only exists under an `allows_call_note` refill note. Known accepted edge: an accidental call-note edit restarts the clock (the row surfaces up to N days late) — guarding it would mean confirmation friction on ordinary edits.

**Workflow event log.** Changes to refill note, call note and status append to `refill_events` (§4.5), with a 2-minute settling window so accidental set-then-fix edits leave at most one event (a full revert inside the window leaves none) while genuine same-day sequences all record. The Req Follow Up sweep reconciles `followup_entered`/`followup_left` span events against current membership. This log — not any status field — is what future analytics read: profit per month from Checked Out snapshots, time-in-follow-up and re-entry counts from spans, when a row was actually missed from status events.

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

   **Grid selection and editing** (revised 2026-07-23): when no dropdown popup is open, one click starts editing an editable cell. Enter or typing also starts editing a selected cell, and typing into a selected dropdown opens it and highlights the first case-insensitive prefix match. When an inline text/number editor is open, an outside click commits a valid value (or silently restores the original value when invalid) and opens the clicked editable cell or activates the clicked control in that same click. When a dropdown popup is open, its first outside click only commits/restores and closes the popup; that click is consumed, so a second click is required to open or activate the target underneath. Escape restores the original value and keeps the cell selected. Enter and Tab commit/restore and move selection without automatically editing the destination. Destructive call-note clearing still confirms, and real database-save failures still show an error and restore the value.

   **Insurance logos (technician feedback 2026-07-11; assets arrived and feature built in M5, 2026-07-14).** Insurance cells show the plan's master-brand official logo to the right of the name, replacing color coding as the visual grouping (the CVS logo for CVS Caremark, the BCBS shield-and-cross for every Blue Cross variant, etc.). The rule is **logo or nothing**: plans whose group has no logo yet (Independent PBMs) and ungrouped plans render as plain name — no color-fill fallback. Plans designated Medicare/Medicaid display "(Medicare)" / "(Medicaid)" after the name wherever the name renders (grid cells, dropdowns, drawer, Settings); the logo itself appears in cell display and Settings only — dropdown editors stay text-only. Secondary cells follow the same rule via their per-row logo. Data model per §4.3: `insurance_groups` + nullable `insurances.group_id` + per-plan `is_medicare`/`is_medicaid` flags (replacing the original single boolean). Logo images are bundled into the exe — the tool stays offline and single-exe.

   **Due-date lock** (technician feedback, 2026-07-11): a lock toggle next to the sort controls pins due date (ascending or descending, whichever is active when locked) as the fixed primary sort key. While locked, clicking any other column header sorts rows *within each day* — due date stays the outer order and the clicked column becomes the secondary key (with the usual asc/desc toggling) — so the day sections and their separator lines stay intact while the technician ranks rows inside each day (e.g., by Old Profit to work a day's most valuable refills first). Unlocking returns to normal single-column sorting; **Reset sort** also clears the lock. Refill Note cells showing `Nimble Link` additionally carry the aging counter described in §5.

   Grid spike learnings (2026-07-11), for implementation: (a) AG Grid computes row classes only on draw — call `redrawRows()` on sort change or the day-separator lines stick to stale rows; (b) drag-fill handle and multi-cell range copy/paste are Enterprise-only — bulk edits use checkbox selection + apply-to-selected instead, matching the import error-list pattern; (c) grid height ~75% of the window per technician feedback on the spike. The 2026-07-23 click model is coordinated by one app-level interaction state machine (`idle` / `selected` / `editing-inline` / `editing-overlay`) and one capture-phase outside-click listener, not independent per-cell listeners.
2. **Detail drawer.** Clicking a row opens a side drawer: all fields editable in form layout, plus **history** — previous refill rows for the same Rx number across all months with their dates, profits, and outcomes (strictly per rx_number, never drug-grouped — story 2.3). Long free-text Notes may not fit the field: hovering over the Notes section shows the full note in a popup bubble, which disappears when the cursor leaves (technician feedback, 2026-07-11).
3. **Manual entry.** "Add refill" opens the same drawer in create mode. Drug field autocompletes against the `drugs` table and creates a new drug if unmatched.

   **Probable-duplicate guard** (technician feedback, 2026-07-12): the v2 import's due-date-drift rule applies to manual add too. Multiple rows per Rx are by design — one per refill cycle — but a new row for an Rx that already has a row due within **21 days** is almost certainly the same cycle with a drifted date, not the next one (cycles run ~28/30/90 days). Saving such a row warns and offers **Open existing row** or an explicit **Create anyway** override; never silently created.

   **Row deletion** (technician feedback, 2026-07-12): deliberately not a one-click affordance. Right-clicking a row opens a small context menu with "Delete refill…", and the drawer's footer carries the same action; both confirm with the row's Rx #, drug, and due date before permanently deleting (story 2.4). No undo in v1 — the confirmation is the guard.
4. **Opportunities panel.** A collapsible **right-hand sidebar** (decided in UI sketching, 2026-07-11; collapses to a thin rail when the technician wants full grid width) listing refills where `due_date` is within X days AND last verified profit (`old_profit`) ≥ $Y AND status is `Pending` AND `new_profit` is still empty — once the technician enters a verified new profit, the card leaves the panel. Sorted by last profit descending. Each card: drug, Rx # (copyable), due date, last profit, current refill note. Clicking a card jumps to/opens that row. X and Y live in Settings (sensible seeds: X = 3 days, Y = $50).

   **Card ↔ grid linking** (technician feedback, 2026-07-12): hovering a card highlights the matching grid row so it can be spotted in place; each card also carries a **"Go to row"** action that scrolls the grid to the row and flashes it *without* opening the drawer — switching month or clearing the quick filters if that's what it takes to bring the row into view.
5. **Overdue view.** A dedicated tab listing, across **all** months, rows whose due date has passed while still `Pending` **and whose insurance hasn't been run yet** — `new_copay` or `new_profit` still empty (narrowed 2026-07-17, below) — plus rows marked `MISSED`, so slipped work stays visible without polluting the day/month view the technician is working. Rows open and edit exactly like grid rows; a Pending row leaves the moment both `new_copay` and `new_profit` are filled (regardless of the profit's value). `MISSED` rows stay listed indefinitely — the tab doubles as the permanent record of slipped refills (decided in UI sketching; no auto-hide) — but render **dimmed** (opacity only; business color coding underneath is never recolored) and are excluded from the badge, banner and toolbar counts. A per-row "add to today's call list" action ships alongside the Call List (v3); until then it renders greyed so the layout accounts for it. No schema impact — it is a filter over the same refills table.

   **What "Overdue" means now that Req Follow Up exists** (decided 2026-07-17, closing Open Question #6): Overdue = "past due and *not yet processed*", where processed = insurance run and both `new_copay` and `new_profit` entered. Overdue answers "what slipped that I still need to run"; Req Follow Up answers "who has gone quiet on me". Two gaps are **deliberate, not bugs**: (a) a processed past-due row with no follow-up call note yet, or inside the follow-up wait window, appears on *neither* worklist — between processing and the quiet threshold there is genuinely nothing to do, and the month grid still shows it; (b) a row processed at `new_profit ≤ $0` leaves Overdue and never enters Req Follow Up (its `> $0` gate stands, §5) — a known loss isn't chased, and resolving it stays a manual month-grid call. The tab keeps the name "Overdue" (the technician's vocabulary); the banner and empty-state copy spell out the narrowed meaning.

   **Built in M4** as the app's first navigation: a tab bar (Month | Overdue; Settings joins in M5). The tab carries the **full month-grid column set** (widened from the sketch's reduced set after user review, 2026-07-13): Rx #/Drug pinned left, Due plus a dedicated sortable **Days over** column, then every remaining month column with identical editors, gating and colors — Secondary behind the same toggle, the Nimble Link counter still month-grid-only (story 1.9). A pinned-right action column keeps the greyed v3 "add to today's list" placeholder in view ("reopen to retry" on MISSED rows). Toolbar: insurance/status/unresolved-only quick filters (no day filter — days don't translate across months), row count, Secondary toggle, date-order lock and Reset sort; no Add refill (adding belongs to the Month tab). Day separators draw between due dates exactly like the month grid; default sort is oldest first. The tab's count badge and the banner above the list count **unprocessed Pending past-due rows only** (decided 2026-07-13; narrowed with the definition 2026-07-17): MISSED rows accumulate forever as the permanent record, so including them would grow the badge unboundedly and bury the "work this now" signal.
6. **Req Follow Up view** (added 2026-07-15 via grill interview; ADR 0002). Second tab (Month | Req Follow Up | Overdue | Settings): the "waiting on the patient" worklist — every `Pending` row where insurance has been run (`new_copay` set, `new_profit > $0`), a `requires_followup` call note was left, and the patient has stayed quiet for more than the Settings wait threshold (§5 membership rule). A **pure filter**: nothing here mutates rows; the row leaves the instant a fresh call note re-stamps the clock or the technician resolves it (`Checked Out`, or a manual `MISSED` when she gives up — typically decided from this tab). Same full month-grid column set and editors as the Overdue tab, with a **Days quiet** column (days since the call note was set) in place of Days over; **default order is newest arrivals first** (technician decision — the freshly surfaced rows lead, long-ignored ones sink). Toolbar: insurance quick filter, row count, Secondary toggle, date-order lock and Reset sort (no status filter — everything here is Pending by definition). Tab badge counts all listed rows; every one is actionable. Pinned-right greyed "add to today's list" placeholder as on the Overdue tab (v3). The sweep that maintains the tab's analytics span events is described in §4.5.
7. **Settings** (built in M5, layout decided via grill interview 2026-07-14). Third tab; a **left sidebar** selects one of seven sections: Insurances, Secondary coverages, Refill notes, Call notes, Thresholds, Backup & restore, and About. All edits persist immediately; data-backed edits trigger an app-wide lookup reload (below).

   **Lookup CRUD affordances (all four lists):** inline rename (click the name); **up/down arrow buttons** for reorder (drives dropdown order — deliberate simplicity over drag-and-drop); a **kebab (⋯) menu** per row holding the remaining actions: *Move to group…* (single-select; insurance plans only), *Medicare* / *Medicaid* checkmarks (plans only — the designation flags), *Pick logo…* (groups and secondary coverages, from the bundled set), *Deactivate*/*Reactivate*, and *Delete*. **Delete appears only when nothing references the option** (live `COUNT` check) and still confirms; once referenced anywhere, deactivate is the only removal — deactivated options sit greyed at the bottom of their list, stay on historical rows, and leave the dropdowns (story 4.1). Recolor swatches remain for refill/call notes only (insurance and secondary colors are retired per §4.3); refill notes additionally expose their two behavior-flag checkboxes (§4.3). The Insurances section lists plans under their brand groups, with an *Ungrouped* section at the bottom; groups themselves support add/inline-rename/reorder/kebab. Adding a new insurance files it into a chosen group or Ungrouped.

   **Thresholds section:** number inputs for alert look-ahead days, alert minimum profit, and Nimble Link aging days; a full **copay tier editor** — each tier a row ("up to $X" + color), add/remove tiers, top tier pinned as the unbounded "above" tier, boundaries validated strictly ascending on edit. Status colors are deliberately **not** exposed in v1 (no story asks; keeps the surface small).

   **Live refresh (decided 2026-07-14 — deliberately not an ADR; trivially reversible):** `App.tsx` keeps owning the lookups bundle and passes a `reloadLookups` callback down; Settings calls it after every successful write, re-fetching the whole bundle (five small queries — simplicity over surgical invalidation). Mounted views pick up the new prop, and the existing reload-on-tab-activation covers grid data, so by the time the technician can see the grid again it has re-read everything.

   **Backup & restore:** the section shows the database file location with an open-containing-folder action. *Back up*: first use picks a folder (persisted in settings); every later backup is genuinely one click, writing `refills-backup-<timestamp>.db` via **`VACUUM INTO`** (consistent snapshot while running — never a raw file copy). *Restore*: pick a `.db` file → the app sanity-checks it is a refill-tracker database (read-only open, expected tables) → explicit confirmation spelling out what is replaced → an automatic `pre-restore-<timestamp>` safety snapshot of the current DB into the backup folder → file swap → **app relaunch** (the only state trusted after the DB changes under a live connection).

   **Appearance (decided 2026-07-23):** About contains a single Dark mode toggle. Missing or invalid preference data means light mode, so existing users see no visual change until they opt in. The choice applies immediately and is persisted as a local UI preference across restarts; it is not pharmacy data and is not part of database backup/restore. Dark mode uses charcoal/dark-grey app chrome and themes every app-owned surface, including AG Grid. It never changes the established copay, note, status, or profit colors and never modifies insurance or secondary logos. Native file/confirmation dialogs remain Windows-owned.

   In v1, insurance on rows is set manually from the dropdown; in v2, imports pre-fill it from the export's `Primary` column when that column is present (fill-blanks-only, like every imported field).

### v2 — Spreadsheet Import (xlsx/CSV)

- **Exports are column-configurable (§1).** The wizard maps whichever known columns are present in the file and ignores the rest; only `Rx Number` is strictly required. A file with no `Days Supply Ends On` column routes every row through the blank-due-date bulk-assignment path below — the import still works.
- Pioneer exports arrive as `.xlsx` files with Excel date cells; CSV remains accepted. The fixed technician contract is `Days Supply Ends On`, `Rx Number`, `Dispensed Item Name`, `Patient Paid Amount`, `Net Profit`, `Refills Remaining` (older samples said `Refills Left`; both are recognized), `Primary`, and `Secondary`; `Dispensed Item NDC` is deferred. Import is date-driven and never silently imports rows: choose file → map columns → resolve names → preview → one atomic commit.
- Imports remember insurance and secondary resolutions in `import_aliases`, including automatic matches and blanks. Aliases are filtered when their target is stale, and deleting an unused insurance or secondary also deletes its aliases. A Settings UI for clearing aliases is a future option.
- Mapping targets: `Rx Number → rx_number`, `Dispensed Item Name → drug name`, `Dispensed Item NDC → ignored/deferred`, `Days Supply Ends On → due_date`, `Patient Paid Amount → old_copay`, `Net Profit → old_profit`, `Refills Left → refills_left`, optional legacy `Number Of Refills Filled → refills_filled`, `Primary → insurance`, `Secondary → secondary coverage`.
- **Primary → insurance matching is case-insensitive** (exports use `CVS CAREMARK`, `RIGHTWAY`; the insurances list has `CVS Caremark`, `RightWay`). Values that match no existing insurance (e.g. `VILLAGE RX LOCAL`, `Magellan` in real samples) surface in the preview for the technician to map to an existing insurance, create as a new one, or leave blank — never guessed silently.
- Upsert semantics per §5. Rows with unparseable dates or missing Rx numbers go to a reviewable error list, never silently dropped.
- **Probable-duplicate detection (due-date drift).** `Days Supply Ends On` can shift between overlapping exports for the same refill cycle, so exact `(rx_number, due_date)` matching alone would create duplicates. A parsed row whose Rx # matches an existing `Pending` row with a *nearby but different* due date is flagged in the preview as a probable duplicate with a warning; the technician chooses per row: update the existing row (adopting the new due date) or override and insert as a genuinely new row. Never silently inserted.
- **Bulk-fix for blank due dates.** In the error list, the technician can multi-select rows with a blank `Days Supply Ends On` and apply a single due date to all of them at once — or skip them, individually or in bulk.
- Handle quirks observed in real exports: blank NDC (compounds), blank `Days Supply Ends On`, duplicate drug names differing only by NDC (e.g., Ycanth under two NDCs — these are distinct `drugs` rows).

### v3 — Call List & Analytics

- **Call List tab** (grill interview 2026-07-20 — full decision record; resolves Open Question #1 in favor of a **dedicated tab**, nav position second: Month · Call List · Req Follow Up · Overdue · Settings; the month grid's "Today" button stays as grid navigation):
  - **Purpose: the "ready" call worklist** — rows already processed (insurance run, copay + profit known) where the patient must be called to arrange payment/pickup. Provably the inverse of Overdue (which requires `new_copay` OR `new_profit` empty), so the two auto-lists are disjoint.
  - **Auto-membership predicate** (ALL of): `status = 'Pending'` · `new_copay IS NOT NULL` · `new_profit IS NOT NULL` · `new_profit >= 0` (break-even included — patient service; deliberately looser than Req Follow Up's `> 0`; losses never auto-appear) · `refills_left >= 1` (0 needs MD authorization — different workflow; **NULL is excluded** — unknown ≠ ready) · due-date window below.
  - **Due-date window** (pharmacy is fully closed Sat+Sun; hardcoded weekday rule, no calendar config): non-Monday → `due_date = today` (local calendar date via `todayIso()`); **Monday → today ∪ previous Saturday ∪ previous Sunday**. Day rollover re-derives membership via the existing timer; no stored state. **Holidays are handled manually** via pinning — no automatic reach-back.
  - **Manual pin — unconditional override**: Month-grid row context menu gains **"Add to today's call list"** — pins ANY row onto today's list regardless of every criterion (never a no-op; serves the holiday hatch AND §7/Flow 8's promised pull-Overdue-rows-in). Persistence: new nullable `refills.added_to_call_list_on DATE`; pinned iff `= today`; survives restart, falls off at rollover with zero cleanup; re-pin re-stamps. **"Remove from today's call list" only un-pins manual pins** — auto rows cannot be dismissed (no hidden/suppressed state); they leave only via Checked Out or rollover. Pinned rows carry a small **pin indicator** (icon/rail accent) — a pinned-but-unprocessed row reads "here because I put it here"; its empty money cells already signal not-ready.
  - **Stay-all-day + called marker**: rows stay visible all day (list = today's roster, not a shrinking queue). "Called today" = `call_note_set_at` is today (a prior day's note does NOT count) → row renders **dimmed at opacity .45, business colors dimmed never recolored** (the MISSED visual language). Rows leave only via Checked Out, rollover, or un-pin. Pinned rows behave identically.
  - **No badge** on the tab (deliberate exception among worklist tabs — it's a morning destination, not an alert).
  - **Sort**: `new_profit` DESC (money first, matching Opportunities), NULL-profit rows last, stable tie-break; dimmed and pinned rows sort **in place** — no grouping.
  - **Columns: identical to the Month grid** (decided 2026-07-13 and reaffirmed: pulled-in rows keep the month-grid column set; Overdue's *Days over* never carries). Due Date stays visible — meaningful on Mondays.
  - **Empty state**: "No refills ready to call today" + hint teaching the pin gesture ("Process today's refills in the Month grid, or right-click a row → Add to today's call list").
  - **Everything hardcoded** — no Settings knobs (no weekend toggle, no closed-days config).
  - May overlap with Req Follow Up (different questions, different cadences) — **no suppression logic**.
- **Quick-add an associated Rx** (technician feedback, 2026-07-11 — documented now, implemented with the Call List): right-clicking an existing row offers **"Add associated Rx"**, a simplified create form for a related refillable prescription (e.g., another Rx for the same patient surfaced during the call). Required fields: Rx #, medication name (autocomplete as in manual add), insurance, refill note; the **due date is pre-set from the selected row** rather than entered. Optional: old/new copay, old/new profit, refills filled, status, and the other drawer fields. Saves like any manual add (`source = manual`, duplicate Rx#+due-date check per Flow 4).
- Analytics: top drugs by total/average profit, month-over-month profit trend, MISSED-rate by insurance, etc.

## 7. Non-Goals

- No multi-user support, accounts, or network sync. *(Recorded prospect, 2026-07-14: if the pharmacy owner adopts the tool, multiple technicians may eventually use it. That is a data-layer/deployment decision — shared DB vs sync vs server — and will warrant an ADR when it becomes real; nothing in v1 is designed around it beyond the `reloadLookups` seam in §6.6.)*
- No integration with PioneerRX beyond CSV import (no API, no scraping).
- No profit prediction or estimation logic — display verified values only.
- No PHI beyond what the current sheet holds (no patient names/DOB in v1 schema; if added later, revisit at-rest encryption).

## 8. Open Questions

1. ~~Call List as separate page vs. day-filter on the month grid~~ — **resolved 2026-07-20** (grill interview): dedicated **Call List tab**, second in the nav; the month grid's "Today" button stays as navigation. Full decision set folded into the v3 section of §6.
2. Compound drugs (no NDC) are matched by exact name string, and Pioneer name strings can drift (spacing, vendor suffixes), which would create duplicate `drugs` rows. Accepted for now — fuzzy/normalized name matching is deferred until it proves to be a problem in practice.
3. ~~Insurance logo feature inputs~~ — **resolved 2026-07-14**: assets and the brand mapping arrived (`Insurance_grouping.md` + logo SVGs); model and seed mapping folded into §4.3, rendering into §6.1. The Independent PBMs group logo is still TBD (its plans render plain until it arrives).
4. **Where do Aet - UMIA and Wausau belong?** Neither appears in the technician's grouping doc; both sit Ungrouped until she places them (best guess: Aet - UMIA → CVS Health, alongside Aet - St Thomas — but it's her call).
5. **Which seeded insurance groups become the permanent bundled defaults?** Bundled default groups will be non-deletable; deciding *which* groups qualify is deliberately deferred (decided 2026-07-14 that the mechanism will exist; membership TBD).
6. ~~What does "Overdue" mean now that Req Follow Up exists?~~ — **resolved 2026-07-17** (grill interview): Overdue narrows to "past due and *not yet processed*" (insurance not run — `new_copay` or `new_profit` empty); MISSED rows stay as the dimmed, uncounted permanent record. Definition, deliberate gaps and rationale folded into §6.1 item 5.
7. **Does the drawer's Activity list show contact history the way the technician wants?** (2026-07-15) It lists note/status changes with same-day collapse (a link re-sent on a later day shows as a separate line; same-day churn collapses). Whether she wants more (explicit "link sent twice" counts, per-attempt detail) awaits her feedback.
8. **Should `P/U` stay in the follow-up call-note set?** (2026-07-15) It's seeded `requires_followup` (a scheduled pickup still depends on the patient showing up) while `D/S` is not (deliveries are pharmacy-driven). Asymmetric on purpose; the Settings checkbox is her escape hatch either way.

Resolved 2026-07-11 (decisions folded into the sections above): **LP** is not used by the technician and is disregarded entirely (§4.3); the **Secondary** export column maps to the new `secondary_coverages` lookup / `refills.secondary_id`, displayed as an optional hidden-by-default grid column (§4.2, §4.3, §6, v2 mapping).

