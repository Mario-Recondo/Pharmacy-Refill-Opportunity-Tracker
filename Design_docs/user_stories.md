# Refill Tracker — User Stories

Companion to `refill-tracker-design.md`. The primary (and for v1, only) user is **the pharmacy technician** working the refill queue. Stories are grouped by epic and tagged with the version they belong to. Acceptance criteria are written to be directly testable.

---

## Epic 1: Working the Monthly Queue (v1)

**1.1 — View the month's refills**
As a technician, I want to open the app and see the current month's refill queue as a grid, so that I can start working without any setup.

Acceptance criteria:
- On launch, the grid shows refills whose due date falls in the current calendar month, sorted by due date ascending.
- A month picker lets me switch to any past or future month; months containing rows are visually distinguished (with a row count) from empty months.
- Day boundaries within the month are visually separated (matching the divider lines the current sheet uses between dates); the separators appear only while the grid is sorted by due date, and hide under any other sort.
- Navigating to an empty month shows an empty state with "Add refill" (and, in v2, "Import CSV") — never a bare blank grid.
- Columns sort on header click; a one-click "Reset sort" control restores the default due-date order.
- A Secondary (coverage) column exists but is hidden by default; a show/hide toggle displays it when I want to see secondary coverage.

**1.2 — Filter to what needs attention**
As a technician, I want quick filters for day, status, insurance, and "unresolved only," so that I can focus on today's work or find what's slipping.

Acceptance criteria:
- One-click "unresolved only" filter shows rows with status `Pending`.
- A day filter narrows the month view to a single date.
- Filters combine (e.g., today + Pending + a specific insurance).
- Active filters are clearly visible and clearable in one click.

**1.3 — Edit directly in the grid**
As a technician, I want to edit any field inline in the grid, so that logging my work is as fast as it was in Google Sheets.

Acceptance criteria:
- Insurance, Refill Note, Call Note, and Status cells edit via dropdowns showing each option in its designated color.
- When no dropdown is open, one click starts editing an editable cell. Enter or typing also starts editing a selected cell; typing in a selected dropdown highlights the first case-insensitive prefix match.
- Clicking outside a text/number editor commits a valid value or silently restores the original value when invalid, then opens the clicked editable cell or activates the clicked control in the same click.
- Clicking outside an open dropdown commits/restores and closes it, but consumes that first click. The underlying cell, toolbar control, tab, drawer action, header, or other target requires a second click.
- Escape restores the original value and keeps the cell selected. Enter and Tab commit/restore and move selection without entering edit mode in the destination cell.
- Copay and profit cells accept numeric entry; cell colors update immediately per the tier rules.
- Edits persist to the database immediately (no Save button, no data loss on crash or close).
- Invalid entry never blocks navigation or shows an error; it silently restores the original value. A real database-save failure remains visible and restores the value.
- A refill-note change that would clear an existing call note still requires its centered destructive confirmation.
- Tab/arrow-key navigation between cells works, so the keyboard-heavy Sheets workflow carries over.
- Ctrl+Z undoes a mis-clicked field edit (added 2026-07-24). It undoes without asking on the row currently focused; reaching an edit on a different row warns first and needs a second press to cross, and holding the key never walks the stack. Each undo scrolls to the row, flashes the changed cells, and says what it restored. A refill-note change that cleared a call note undoes both together. Deletion is not undoable (story 2.4).

**1.4 — Copy an Rx number instantly**
As a technician, I want to click any Rx # to copy it, so that I can paste it into PioneerRX search without retyping.

Acceptance criteria:
- Single click on the Rx # copies it to the clipboard with a brief visual confirmation.
- The Rx # column (and drug name) stays pinned to the left edge during horizontal scroll, remaining visible and copyable no matter which columns I'm viewing.

**1.5 — Call-note gating**
As a technician, I want the Call Note field to be disabled unless the Refill Note is "Nimble Link" or "Call Pt," so that the data stays consistent with how call notes are actually used.

Acceptance criteria:
- Call Note cell is greyed out and uneditable for non-qualifying refill notes.
- If I change a refill note away from a qualifying value while a call note exists, I'm prompted before the call note is cleared (no silent wipe).

**1.6 — Mark a row's outcome**
As a technician, I want to set a status (Pending, Checked Out, MISSED) on each refill, so that I can tell finished work from open work at a glance.

Acceptance criteria:
- Status is editable in the grid and the detail drawer.
- New rows default to `Pending`.
- A fill completed at a loss is `Checked Out` with a negative New Profit — the red profit cell flags it; there is no separate loss status (`$ LOSS` removed per technician feedback, 2026-07-11).
- Only `Pending` rows count as unresolved.

**1.7 — Keep overdue work visible**
As a technician, I want an Overdue tab showing the past-due refills I still have to process, plus MISSED refills, across every month, so that slipped prescriptions stay visible without cluttering the day or month I'm working.

Acceptance criteria:
- The tab lists every row whose due date has passed while status is `Pending` **and whose insurance hasn't been run** — New Copay or New Profit still empty (narrowed 2026-07-17, design doc §6.1 item 5) — plus all `MISSED` rows, regardless of which month they belong to.
- Rows open, edit, and resolve exactly like grid rows; a Pending row leaves the tab the moment both New Copay and New Profit are filled (whatever the profit's value), or when resolved.
- The tab shows the full month-grid column set with identical editors, gating and colors (Secondary behind the same toggle; no Nimble Link counter, story 1.9), plus a sortable "Days over" column and a pinned-right action column. Quick filters cover insurance, status, and unresolved-only; day separators and the date-order lock work as in the month grid.
- `MISSED` rows stay listed indefinitely (no auto-hide) — the tab is also the permanent record of slipped refills — but render dimmed (opacity only; the business colors underneath are never recolored).
- The month/day grid views are unaffected — overdue rows from other months never bleed into them.
- The Overdue tab's count badge (and the banner above the list) counts unprocessed Pending past-due rows only — MISSED rows are the permanent record, not a to-do, and would grow the count forever.
- A processed past-due row inside Req Follow Up's wait window (or without a follow-up call note) appears on neither tab — a deliberate gap; it still shows in its month grid (§6.1 item 5).
- (v3, with the Call List) Each row offers an "add to today's call list" action to pull it into the current queue; until v3 it appears greyed with a "ships with the Call List" hint.

**1.8 — Keep day sections while sorting other columns**
As a technician, I want to lock the due-date order and then sort by another column, so that rows re-rank within each day without the day sections falling apart.

Acceptance criteria:
- A due-date lock toggle sits with the sort controls; engaging it fixes due date (ascending or descending, whichever is active) as the primary sort key.
- While locked, clicking any other column header sorts rows within each day by that column (with the usual ascending/descending toggle); the day separator lines remain visible throughout.
- Unlocking restores normal single-column sorting; "Reset sort" clears the lock and returns to the default due-date ascending order.

**1.9 — See how long a Nimble link has been waiting**
As a technician, I want a day counter next to "Nimble Link" refill notes that turns red after 5 days, so that unpaid links never sit forgotten.

Acceptance criteria:
- When a row's Refill Note is `Nimble Link`, the cell shows — to the right of the label, within the cell — the number of days since the note was set to Nimble Link.
- Once the counter reaches 5 days (threshold editable in Settings), it highlights red.
- The counter appears only in the month grid — not in the drawer, Opportunities cards, or the Overdue tab.
- Setting the refill note away from and later back to Nimble Link restarts the count (the count reflects the most recent link sent).

---

## Epic 2: Adding & Inspecting Refills (v1)

**2.1 — Add a refill manually**
As a technician, I want to add a refill by hand, so that prescriptions missing from any import still make it into the queue.

Acceptance criteria:
- "Add refill" opens a form (the detail drawer in create mode) with due date defaulting to the viewed day/month.
- The drug field autocompletes against existing drugs; entering an unknown name creates a new drug (NDC optional, since compounds have none).
- Duplicate protection: entering an Rx # + due date pair that already exists warns me and offers to open the existing row instead.
- Rx-drug consistency (one Rx # = one medication, design doc §5): entering an Rx # that already exists under a different medication warns me and offers to use the existing medication or fix the Rx # — never saves the mismatch.
- Probable-duplicate guard (design doc §6.1): if the Rx already has a row due within 21 days of the new one, saving warns me (same refill cycle, drifted date) and offers to open the existing row or explicitly create anyway.

**2.2 — See everything about one refill**
As a technician, I want to click a row and see all its details in a side drawer, so that I can work one prescription without losing my place in the grid.

Acceptance criteria:
- The drawer shows every field in an editable form layout.
- If the free-text note is longer than the Notes field shows, hovering over the Notes section pops up a bubble with the full note text; the bubble disappears when the cursor moves away.
- Closing the drawer returns me to the grid with scroll position and filters intact.

**2.3 — See a prescription's history**
As a technician, I want the drawer to show previous refills of the same Rx number across all months, so that I can see what it paid before and how contact attempts went.

Acceptance criteria:
- History lists prior rows for the same rx_number with date, copays, profits, notes, and status.
- History is strictly per Rx number. It must NOT group by drug name or NDC — the data contains no patient identity, so drug-level grouping would mix different patients' prescriptions together and present it as one prescription's history. (Drug-level aggregation is reserved for v3 analytics, where cross-patient averages are the intent.)
- Known limitation, accepted: when a prescription is renewed under a new Rx number, its history starts fresh. This is correct behavior given the data available.
- History is read-only from the drawer; clicking an entry navigates to that row.

**2.4 — Delete a refill**
As a technician, I want to delete a row that shouldn't exist (wrong entry, test data), but not so easily that a stray click can destroy real work.

Acceptance criteria:
- No one-click delete anywhere. The delete action lives behind a right-click on the row (context menu) and at the bottom of the detail drawer.
- Either path asks for confirmation naming the exact row (Rx #, drug, due date) before anything is removed.
- Deletion is permanent (no undo in v1); the row disappears from the grid, month counts, history, and — once built — Opportunities/Overdue immediately.

---

## Epic 3: Profit Visibility & Opportunities (v1)

**3.1 — Color-coded copays**
As a technician, I want copay cells colored by amount tier ($0 / under $30 / $30–99.99 / $100–300 / $300+), so that expensive copays jump out while I'm scanning.

Acceptance criteria:
- Old and New Copay cells auto-color on entry per the thresholds in Settings.
- Changing thresholds in Settings recolors existing data immediately.

**3.2 — Profit shading that highlights the big ones**
As a technician, I want profit cells shaded greener the higher the profit relative to what's on my screen, so that the most lucrative fills are obvious.

Acceptance criteria:
- Shade intensity scales relative to the maximum profit among the rows currently visible (the active day/month filter), with a floor so small positive profits still read as green.
- Changing the visible set recomputes the shades: filtered to July 3rd, shading is relative to that day; the full month view shades relative to the whole month.
- Zero/negative profits use a distinct non-green treatment.

**3.3 — Get alerted to high-value refills coming due**
As a technician, I want a panel listing refills due soon whose last verified profit was high, so that I work the most valuable prescriptions first and never let one slip to MISSED.

Acceptance criteria:
- The panel is a collapsible right-hand sidebar next to the grid (collapses to a thin rail).
- The panel lists rows where due date is within X days, last verified profit ≥ $Y, status is `Pending`, and New Profit is still empty, sorted by last profit descending. X and Y are editable in Settings.
- "Last verified profit" is the row's `old_profit` — what the pharmacy earned the last time this prescription was sold.
- Each card shows drug, Rx # (copyable), due date, last profit clearly labeled as "last fill / unverified," and the current refill note.
- Clicking a card opens that row's detail drawer.
- Hovering a card highlights the corresponding grid row; a "Go to row" action on the card scrolls the grid to the row (switching month / clearing filters if it's out of view) without opening the drawer.
- A card leaves the panel when its row gains a verified New Profit or leaves `Pending`.
- When the look-ahead window extends past the last populated date, the panel says so (e.g., "No data beyond Jul 31") instead of appearing silently empty.

---

## Epic 4: Configuration & Data Safety (v1)

**4.1 — Manage dropdown vocabularies**
As a technician, I want to add/edit/retire insurances, secondary coverages, refill notes, and call notes (with their colors) in Settings, so that a new payer or workflow term never requires a code change.

Acceptance criteria (revised 2026-07-14 alongside story 4.5 — design doc §6.6):
- Each lookup list supports add, inline rename, reorder (up/down buttons), and deactivate via a per-row kebab menu (deactivated options stay on historical rows but leave the dropdowns; greyed section at the bottom with Reactivate).
- Delete exists only for options nothing references (live check + confirmation); referenced options can only be deactivated.
- Recolor applies to refill/call notes only — insurance and secondary colors are retired by the logo feature (4.5).
- Insurances carry independent Medicare and Medicaid designation flags (kebab checkmarks) that append "(Medicare)" / "(Medicaid)" to the displayed name. (Supersedes the original single flag + uniform group color.)
- Refill notes expose their behavior flags ("prompts for a call note", "shows the days-since-sent counter") as checkboxes, so rules never depend on an option's name and renames are always safe.
- Secondary coverages get the same CRUD affordances; the list ships with a single seeded option, `Coupon` (with the coupon logo).

**4.2 — Tune thresholds**
As a technician, I want to edit copay tier boundaries and alert thresholds (X days, $Y, Nimble Link aging days), so that the tool matches how our pharmacy actually prioritizes.

Acceptance criteria (2026-07-14):
- Copay tiers are fully editable: add/remove tiers, boundary + color per tier, unbounded top tier; boundaries enforced strictly ascending.
- Alert look-ahead days, alert minimum profit, and Nimble Link aging days are editable numbers.
- Changes take effect app-wide without restart (grid recolors, Opportunities recomputes on next view).
- Status colors are not exposed in v1.

**4.3 — Back up and restore my data**
As a technician, I want one-click backup and restore of the database, so that a computer failure can't erase months of tracking.

Acceptance criteria:
- Settings shows the database file location.
- "Back up" writes a timestamped copy of the database to a chosen folder; "Restore" replaces current data from a chosen backup after an explicit confirmation.
- Backups are consistent snapshots taken safely while the app is running (SQLite backup API or `VACUUM INTO`), never a raw copy of the live file.
- Everything I enter is saved as I type; force-closing the app loses at most the cell currently being edited.

**4.4 — Just open it**
As a technician, I want the tool to be a single .exe I double-click, so that I don't need to install anything or run commands.

**4.5 — Insurance master-brand logos** *(assets arrived 2026-07-14; folded into M5 — design doc §4.3, §6.1, §6.6)*
As a technician, I want each insurance to show its master brand's official logo next to its name, so that plans group visually by insurer without memorizing colors.

Acceptance criteria (finalized 2026-07-14):
- Grid Insurance cells show the plan name with the master-brand logo to its right, replacing the color fill. The rule is logo or nothing: plans in a logo-less group (Independent PBMs, until its logo arrives) and ungrouped plans render as plain name — no color fallback.
- A plan belongs to at most one brand group (`group_id`, nullable); Medicare/Medicaid are independent designation flags, not groups. Ungrouped plans sit in an "Ungrouped" section in Settings and can be filed via "Move to group…".
- Settings organizes insurances under master-brand groups; groups are data (add/rename/reorder/move plans), logos are a bundled fixed set a group picks from — new artwork requires a new build.
- Designated plans show "(Medicare)" / "(Medicaid)" after the name everywhere the name renders; dropdowns stay text-only (logos in cell display and Settings).
- Secondary coverages carry a direct per-row logo (no groups); Coupon ships with the coupon logo.
- Logo images are bundled into the exe (offline, single-exe constraint).

**4.6 — Reduce glare with dark mode**
As a technician, I want an optional dark appearance, so that the app is easier on my eyes without changing the visual language I use to scan refill data.

Acceptance criteria (decided 2026-07-23):
- Settings → About contains one Dark mode toggle; there is no automatic system-theme mode.
- Existing users default to the current light appearance, while an explicit choice is remembered after closing and reopening the app.
- Dark mode uses charcoal and dark-grey chrome across every app-owned surface, including grids, drawers, menus, forms, the import wizard, and loading/error states.
- Copay tiers, refill/call-note colors, status colors, and profit shading keep their established colors in both modes.
- Insurance and secondary-coverage logos are unchanged. Operating-system dialogs continue to follow Windows.
- The appearance changes immediately without a Save button.

---

## Epic 5: CSV Import (v2)

**5.1 — Import the Pioneer report**
As a technician, I want to import the monthly PioneerRX CSV export, so that the month's queue builds itself with due dates, old copays, and old profits pre-filled.

Acceptance criteria:
- I choose a file and see a column-mapping step; known Pioneer headers (Rx Number, Dispensed Item Name, Dispensed Item NDC, Days Supply Ends On, Patient Paid Amount, Net Profit, Number Of Refills Filled, Primary, Secondary) are pre-mapped, and the mapping is remembered for next time.
- Exports contain whichever columns I selected in Pioneer; the import works with any subset (only Rx Number is required). A file with no due-date column sends all its rows through the blank-due-date bulk-assignment step instead of failing.
- When a Primary column is present, it fills the Insurance field on rows where it's blank, matched case-insensitively against my insurances list; unmatched names are surfaced for me to map to an existing insurance, create as new, or leave blank — never guessed.
- When a Secondary column is present, it fills the Secondary coverage field the same way (case-insensitive match against my secondary coverages list; unmatched values surfaced to map, create, or leave blank).
- A preview shows each row's disposition — new, update, or skip — before anything is written.
- Rows with a missing Rx # or unparseable date land in a reviewable error list; nothing is silently dropped.
- In the error list, I can multi-select rows with a blank due date and apply one due date to all of them at once, or skip them individually or in bulk.
- Rows land in months according to their own due dates, even if the file spans a month boundary.

**5.2 — Re-import without fear**
As a technician, I want re-importing an overlapping file to be safe, so that I never create duplicates or lose work I've already done.

Acceptance criteria:
- Matching is by Rx # + due date; imports fill only empty fields and never overwrite values I entered (refill/call notes, new copay/profit, status, notes are untouchable by import).
- Importing the same file twice produces zero changes the second time.
- A row whose Rx # matches an existing `Pending` row with a nearby-but-different due date is flagged as a probable duplicate (due dates drift between exports); I choose per row whether to update the existing row or override and create a new one — it is never inserted silently.

---

## Epic 6: Call List (v3 — deferred)

**6.1 — Work today's list**
As a technician, I want a focused view of just the refills I should be calling today where I set outcomes, so that daily calling is a checklist rather than a spreadsheet hunt.

Note: shipped as a dedicated tab (resolved 2026-07-20). "Today's list" means refills that came due **the previous business day** — she calls the day after a refill comes due (corrected 2026-07-26) — so Monday's list holds Friday's dues and Tuesday's holds Sat+Sun+Mon. Full window map and auto-membership predicate in §6 v3 of the design doc.

**6.2 — Quick-add an associated Rx from a row**
As a technician, I want to right-click a row and add an associated refillable Rx through a short form, so that a sibling prescription discovered mid-call gets tracked without filling out the whole drawer.

Acceptance criteria:
- Right-clicking an existing row offers "Add associated Rx," which opens a simplified create form.
- Required fields: Rx #, medication name (autocomplete as in story 2.1), insurance, refill note.
- The due date is pre-set to the selected row's due date (not entered manually).
- Optional fields: old/new copay, old/new profit, refills filled, status, and the remaining drawer fields.
- Saving applies the same duplicate protection (Rx # + due date) as manual add.

---

## Out of Scope (all versions)

- No prediction or estimation of new profits — verified values only.
- No patient names or PHI beyond what the current sheet holds.
- No multi-user features, accounts, or sync.
