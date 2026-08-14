-- Monthly profit total (grilled 2026-08-13): the local moment a sale actually closed,
-- so "profit made in <month>" buckets by when money was made, not by due date.
-- Stored UTC ISO (matches app toISOString writes); the app converts to local before bucketing.
ALTER TABLE refills ADD COLUMN checked_out_at TEXT;

-- Backfill accurate where we have it: the most recent status→ Checked Out event's timestamp.
UPDATE refills
SET checked_out_at = (
  SELECT e.at FROM refill_events e
  WHERE e.refill_id = refills.id AND e.kind = 'status' AND e.new_value = 'Checked Out'
  ORDER BY e.at DESC, e.id DESC LIMIT 1
)
WHERE status = 'Checked Out';

-- Fallback for rows checked out before the event log existed (pre-2026-07-15): due date at
-- NOON UTC. This installation is US Eastern (UTC-4/-5): noon UTC converts to 07:00/08:00 local,
-- keeping the local calendar day equal to the due date across month boundaries, so the row
-- buckets into its due month. (Not universally safe: a far-eastern UTC+13/+14 machine would
-- map noon UTC to the next local day. Also note that changing the computer's timezone
-- re-buckets historical UTC timestamps, since bucketing is by local time.)
UPDATE refills
SET checked_out_at = due_date || 'T12:00:00.000Z'
WHERE status = 'Checked Out' AND checked_out_at IS NULL;
