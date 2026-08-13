-- Product hardening for the single-D1 Cloudflare deployment.
-- These are metadata policies only; QUERYMIND_DATA remains business read-only.

-- Remove a D1 platform-internal table from any catalog produced by earlier
-- versions. The next schema refresh also excludes it at the source.
DELETE FROM schema_catalog_tables WHERE table_name LIKE '_cf_%';
UPDATE schema_catalog_state
SET table_count = (SELECT COUNT(*) FROM schema_catalog_tables)
WHERE id = 1;

-- The bundled demo schema contains PII and employee compensation. DLP policy
-- applies to query responses and CSV exports; it is not table-level RBAC.
INSERT INTO column_policies (table_name, column_name, classification, mask_mode) VALUES
  ('employees', 'email', 'sensitive', 'full'),
  ('employees', 'salary', 'sensitive', 'full'),
  ('suppliers', 'email', 'sensitive', 'full'),
  ('suppliers', 'phone', 'sensitive', 'partial'),
  ('customers', 'email', 'sensitive', 'full'),
  ('customers', 'phone', 'sensitive', 'partial'),
  ('customers', 'birth_date', 'sensitive', 'full'),
  ('customer_addresses', 'address', 'sensitive', 'full')
ON CONFLICT(table_name, column_name) DO UPDATE SET
  classification = excluded.classification,
  mask_mode = excluded.mask_mode;

-- Keep D1 result serialization within a Free-plan-safe bound even for Owner.
UPDATE role_definitions
SET max_rows_per_query = MIN(max_rows_per_query, 10000),
    updated_at = CURRENT_TIMESTAMP;
