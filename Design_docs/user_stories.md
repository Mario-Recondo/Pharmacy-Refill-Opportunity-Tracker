# Refill Tracker — User Stories

Companion to `refill-tracker-design.md`. The primary (and for v1, only) user is **the pharmacy technician** working the refill queue. Stories are grouped by epic and tagged with the version they belong to. Acceptance criteria are written to be directly testable.

---

## Epic 1: Working the Monthly Queue (v1)

**1.1 — View the month's refills**
As a technician, I want to open the app and see the current month's refill queue as a grid, so that I can start working without any setup.

Acceptance criteria:
- On launch, the grid shows refills whose due date falls in the current calendar month, sorted by due date ascending.
- A month picker lets me switch to any past or future month; months containing rows are visually distinguished (with a row count) from empty months.
- Navigating to an empty month shows an empty state with "Add refill" (and, in v2, "Import CSV") — never a bare blank grid.

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
- Copay and profit cells accept numeric entry; cell colors update immediately per the tier rules.
- Edits persist to the database immediately (no Save button, no data loss on crash or close).
- Tab/arrow-key navigation between cells works, so the keyboard-heavy Sheets workflow carries over.

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
As a technician, I want to set a status (Pending, Checked Out, MISSED, $ LOSS) on each refill, so that I can tell finished work from open work at a glance.

Acceptance criteria:
- Status is editable in the grid and the detail drawer.
- New rows default to `Pending`.
- Entering a negative New Profit prompts (but never forces) marking the row `$ LOSS`.
- `$ LOSS` counts as completed work (the fill happened); only `Pending` rows count as unresolved.

**1.7 — Keep overdue work visible**
As a technician, I want an Overdue tab showing all overdue and MISSED refills across every month, so that slipped prescriptions stay visible without cluttering the day or month I'm working.

Acceptance criteria:
- The tab lists every row whose due date has passed while status is `Pending`, plus all `MISSED` rows, regardless of which month they belong to.
- Rows open, edit, and resolve exactly like grid rows; resolving a row removes it from the tab.
- The month/day grid views are unaffected — overdue rows from other months never bleed into them.
- (v3, with the Call List) Each row offers an "add to today's call list" action to pull it into the current queue.

---

## Epic 2: Adding & Inspecting Refills (v1)

**2.1 — Add a refill manually**
As a technician, I want to add a refill by hand, so that prescriptions missing from any import still make it into the queue.

Acceptance criteria:
- "Add refill" opens a form (the detail drawer in create mode) with due date defaulting to the viewed day/month.
- The drug field autocompletes against existing drugs; entering an unknown name creates a new drug (NDC optional, since compounds have none).
- Duplicate protection: entering an Rx # + due date pair that already exists warns me and offers to open the existing row instead.

**2.2 — See everything about one refill**
As a technician, I want to click a row and see all its details in a side drawer, so that I can work one prescription without losing my place in the grid.

Acceptance criteria:
- The drawer shows every field in an editable form layout.
- Closing the drawer returns me to the grid with scroll position and filters intact.

**2.3 — See a prescription's history**
As a technician, I want the drawer to show previous refills of the same Rx number across all months, so that I can see what it paid before and how contact attempts went.

Acceptance criteria:
- History lists prior rows for the same rx_number with date, copays, profits, notes, and status.
- History is strictly per Rx number. It must NOT group by drug name or NDC — the data contains no patient identity, so drug-level grouping would mix different patients' prescriptions together and present it as one prescription's history. (Drug-level aggregation is reserved for v3 analytics, where cross-patient averages are the intent.)
- Known limitation, accepted: when a prescription is renewed under a new Rx number, its history starts fresh. This is correct behavior given the data available.
- History is read-only from the drawer; clicking an entry navigates to that row.

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
- The panel lists rows where due date is within X days, last verified profit ≥ $Y, status is `Pending`, and New Profit is still empty, sorted by last profit descending. X and Y are editable in Settings.
- "Last verified profit" is the row's `old_profit` — what the pharmacy earned the last time this prescription was sold.
- Each card shows drug, Rx # (copyable), due date, last profit clearly labeled as "last fill / unverified," and the current refill note.
- Clicking a card opens that row's detail drawer.
- A card leaves the panel when its row gains a verified New Profit or leaves `Pending`.
- When the look-ahead window extends past the last populated date, the panel says so (e.g., "No data beyond Jul 31") instead of appearing silently empty.

---

## Epic 4: Configuration & Data Safety (v1)

**4.1 — Manage dropdown vocabularies**
As a technician, I want to add/edit/retire insurances, refill notes, and call notes (with their colors) in Settings, so that a new payer or workflow term never requires a code change.

Acceptance criteria:
- Each lookup list supports add, rename, recolor, reorder, and deactivate (deactivated options stay on historical rows but leave the dropdowns).
- Insurances have a Medicare/Medicaid flag that applies the uniform group color automatically.

**4.2 — Tune thresholds**
As a technician, I want to edit copay tier boundaries and alert thresholds (X days, $Y), so that the tool matches how our pharmacy actually prioritizes.

**4.3 — Back up and restore my data**
As a technician, I want one-click backup and restore of the database, so that a computer failure can't erase months of tracking.

Acceptance criteria:
- Settings shows the database file location.
- "Back up" writes a timestamped copy of the database to a chosen folder; "Restore" replaces current data from a chosen backup after an explicit confirmation.
- Backups are consistent snapshots taken safely while the app is running (SQLite backup API or `VACUUM INTO`), never a raw copy of the live file.
- Everything I enter is saved as I type; force-closing the app loses at most the cell currently being edited.

**4.4 — Just open it**
As a technician, I want the tool to be a single .exe I double-click, so that I don't need to install anything or run commands.

---

## Epic 5: CSV Import (v2)

**5.1 — Import the Pioneer report**
As a technician, I want to import the monthly PioneerRX CSV export, so that the month's queue builds itself with due dates, old copays, and old profits pre-filled.

Acceptance criteria:
- I choose a file and see a column-mapping step; known Pioneer headers (Rx Number, Dispensed Item Name, Dispensed Item NDC, Days Supply Ends On, Patient Paid Amount, Net Profit, Number Of Refills Filled) are pre-mapped, and the mapping is remembered for next time.
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
As a technician, I want a focused view of just today's due refills where I set outcomes, so that daily calling is a checklist rather than a spreadsheet hunt.

Note: pending technician preference, this ships either as a dedicated page or as a saved "Today" filter on the month grid. Both are views over the same refills table; no schema impact either way.

---

## Out of Scope (all versions)

- No prediction or estimation of new profits — verified values only.
- No patient names or PHI beyond what the current sheet holds.
- No multi-user features, accounts, or sync.
