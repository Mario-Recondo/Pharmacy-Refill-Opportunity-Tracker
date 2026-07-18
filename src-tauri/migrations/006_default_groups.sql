ALTER TABLE insurance_groups ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
UPDATE insurance_groups SET is_default = 1 WHERE id BETWEEN 1 AND 10;
