-- Req Follow Up tab + refill event log (grill interview 2026-07-15)

-- Behavior flag, not name matching (§4.3): marks call notes that mean "contact
-- made, waiting on the patient" — the Req Follow Up tab keys off this flag.
ALTER TABLE call_notes ADD COLUMN requires_followup INTEGER NOT NULL DEFAULT 0;

-- Seed the six notes the technician designated. Name matching is safe here
-- only because this runs once against the seeded vocabulary.
UPDATE call_notes SET requires_followup = 1
WHERE name IN ('LVM+RSL', 'D/S+RSL', 'P/U', 'VMB FULL+RSL', 'VMB NOT SET UP+RSL', 'PT WCB+RSL');

-- Tracks when call_note_id last changed — the "quiet days" clock the Req Follow
-- Up tab gates on (same pattern as refill_note_set_at / the Nimble counter).
ALTER TABLE refills ADD COLUMN call_note_set_at TEXT;

-- Backfill: stamp existing call notes with the migration date, not the due
-- date — nothing qualifies on day one, the clock starts fresh for everyone.
UPDATE refills SET call_note_set_at = datetime('now') WHERE call_note_id IS NOT NULL;

-- Append-only event log: workflow changes only (refill note, call note,
-- status), plus followup_entered/followup_left span events written by the
-- sweep. Values are display names captured at event time — renaming a lookup
-- later must not rewrite history. profit snapshots new_profit on
-- status → Checked Out events ("profit made in <month>" analytics).
-- Deliberately NO foreign key / cascade: events outlive row deletion as the
-- permanent analytics record.
CREATE TABLE refill_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  refill_id INTEGER NOT NULL,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  kind      TEXT NOT NULL CHECK (kind IN ('refill_note', 'call_note', 'status', 'followup_entered', 'followup_left')),
  old_value TEXT,
  new_value TEXT,
  profit    REAL
);

CREATE INDEX idx_refill_events_refill_at ON refill_events (refill_id, at);

-- Quiet days before a qualifying row surfaces on the Req Follow Up tab
-- (Settings → Thresholds; separate from nimble_link_alert_days even though
-- they coincidentally both seed to 5).
INSERT INTO settings (key, value) VALUES
  ('followup_wait_days', '5');
