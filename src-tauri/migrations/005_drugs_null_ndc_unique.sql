-- Close the NULL-NDC gap in the drugs natural key (SQL review 2026-07-15, M3
-- verification gap; agreed pre-v2 batch). UNIQUE (name, ndc) treats NULL NDCs
-- as distinct, so compounds (TRIMIX, tirzepatide, ...) could be duplicated and
-- the findOrCreateDrug upsert had no conflict target for them.

-- Dedupe before indexing so the index build can never fail: repoint refills of
-- every NULL-NDC name-duplicate at the lowest-id copy, then drop the others.
UPDATE refills SET drug_id = (
  SELECT MIN(d2.id) FROM drugs d2
  WHERE d2.ndc IS NULL AND d2.name = (SELECT name FROM drugs WHERE id = refills.drug_id)
)
WHERE drug_id IN (
  SELECT id FROM drugs WHERE ndc IS NULL AND name IN (
    SELECT name FROM drugs WHERE ndc IS NULL GROUP BY name HAVING COUNT(*) > 1
  )
);

DELETE FROM drugs WHERE ndc IS NULL AND id NOT IN (
  SELECT MIN(id) FROM drugs WHERE ndc IS NULL GROUP BY name
);

CREATE UNIQUE INDEX idx_drugs_name_null_ndc ON drugs (name) WHERE ndc IS NULL;
