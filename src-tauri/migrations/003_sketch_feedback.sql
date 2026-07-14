-- Post-sketch-review schema additions (technician feedback + answered questions, 2026-07-11)

-- Tracks when refill_note_id last changed; drives the Nimble Link aging counter (design doc §5)
ALTER TABLE refills ADD COLUMN refill_note_set_at TEXT;

-- Optional secondary coverage (coupon/copay-assistance programs), managed in
-- Settings with the same CRUD as insurances. Direct per-row logo (bundled asset
-- key) — no brand groups to model; NULL logo renders plain (design doc §4.3).
-- Seeded with a single option; the technician adds more as they come up.
CREATE TABLE secondary_coverages (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  logo       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

INSERT INTO secondary_coverages (name, logo, sort_order) VALUES
  ('Coupon', 'coupon', 10);

ALTER TABLE refills ADD COLUMN secondary_id INTEGER REFERENCES secondary_coverages (id);

INSERT INTO settings (key, value) VALUES
  ('nimble_link_alert_days', '5');
