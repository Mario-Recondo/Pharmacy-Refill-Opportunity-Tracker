-- Refill Tracker v1 schema (Design_docs/refill-tracker-design.md §4)

CREATE TABLE drugs (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL, -- exactly as in PioneerRX, vendor suffixes included
  ndc  TEXT,          -- NULL for compounded meds (TRIMIX, tirzepatide, ...)
  UNIQUE (name, ndc)
);

-- Master-brand groups (design doc §4.3): a plan belongs to at most one group;
-- the group's logo (bundled asset key) renders next to the plan name. Groups
-- are data; the logo set is fixed at build time. NULL logo = plain cells.
CREATE TABLE insurance_groups (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  logo       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE insurances (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  group_id    INTEGER REFERENCES insurance_groups (id), -- NULL = ungrouped (renders plain)
  is_medicare INTEGER NOT NULL DEFAULT 0, -- designation flags, not groups: "(Medicare)"/"(Medicaid)"
  is_medicaid INTEGER NOT NULL DEFAULT 0, -- name suffix; a plan can carry both
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1  -- deactivated: stays on historical rows, leaves dropdowns
);

CREATE TABLE refill_notes (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  color            TEXT NOT NULL,
  meaning          TEXT NOT NULL DEFAULT '', -- tooltip text
  allows_call_note INTEGER NOT NULL DEFAULT 0, -- behavior flags, not name matching (§4.3):
  shows_age_counter INTEGER NOT NULL DEFAULT 0, -- renaming an option must never break rules
  sort_order       INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE call_notes (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL,
  meaning    TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE refills (
  id             INTEGER PRIMARY KEY,
  rx_number      TEXT NOT NULL,
  drug_id        INTEGER NOT NULL REFERENCES drugs (id),
  due_date       TEXT NOT NULL, -- ISO yyyy-mm-dd; drives month/day views and alerts
  insurance_id   INTEGER REFERENCES insurances (id),
  old_copay      REAL,
  new_copay      REAL,
  old_profit     REAL,    -- last verified profit; the value the Opportunities panel surfaces
  new_profit     REAL,    -- manual only, entered after insurance runs in Pioneer
  refills_filled INTEGER, -- informational, from import
  refill_note_id INTEGER REFERENCES refill_notes (id),
  call_note_id   INTEGER REFERENCES call_notes (id), -- only meaningful when the refill note's allows_call_note flag is set
  status         TEXT NOT NULL DEFAULT 'Pending'
                 CHECK (status IN ('Pending', 'Checked Out', 'MISSED')),
  notes          TEXT,
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- natural key for import upsert; prevents duplicate rows
CREATE UNIQUE INDEX idx_refills_rx_due ON refills (rx_number, due_date);
CREATE INDEX idx_refills_due_date ON refills (due_date);
CREATE INDEX idx_refills_status ON refills (status);
CREATE INDEX idx_refills_drug ON refills (drug_id);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
