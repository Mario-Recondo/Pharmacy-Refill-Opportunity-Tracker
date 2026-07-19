-- v2 import: refills remaining from the technician's export.
ALTER TABLE refills ADD COLUMN refills_left INTEGER;

CREATE TABLE import_aliases (
  id        INTEGER PRIMARY KEY,
  kind      TEXT NOT NULL CHECK (kind IN ('insurance', 'secondary')),
  raw_name  TEXT NOT NULL COLLATE NOCASE,
  target_id INTEGER,
  UNIQUE (kind, raw_name)
);
