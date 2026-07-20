-- Call List (v3): manual pin — a row is on today's list when this equals today's
-- local date; rolls off at midnight by simply no longer matching (grill 2026-07-20).
ALTER TABLE refills ADD COLUMN added_to_call_list_on TEXT;
