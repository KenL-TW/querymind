-- Governed Query Safety Core.  Missing policy rows are intentionally deny-by-default.
ALTER TABLE users ADD COLUMN data_scope_key TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS data_scope_policies (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  table_name TEXT NOT NULL,
  allowed_columns_json TEXT NOT NULL CHECK (json_valid(allowed_columns_json)),
  row_filter_sql TEXT NOT NULL DEFAULT '',
  can_view_raw INTEGER NOT NULL DEFAULT 0 CHECK (can_view_raw IN (0, 1)),
  can_export INTEGER NOT NULL DEFAULT 1 CHECK (can_export IN (0, 1)),
  can_bulk_export INTEGER NOT NULL DEFAULT 0 CHECK (can_bulk_export IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (scope_key, table_name)
);

CREATE TABLE IF NOT EXISTS policy_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  policy_version TEXT NOT NULL,
  expected_migration TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO policy_state (id, policy_version, expected_migration)
VALUES (1, 'p0-governed-query-safety-core-v1', '0006');

-- Explicit allowlist for every table known by the bundled business schema.
-- Role scopes are deliberately materialized so a newly discovered table is not
-- implicitly authorized by a wildcard or by schema refresh.
WITH policy_templates(table_name, normal_columns, raw_columns) AS (
  VALUES
    ('departments', '["id","name","manager_id","budget","location"]', '["id","name","manager_id","budget","location"]'),
    ('employees', '["id","name","dept_id","title","hire_date","is_active"]', '["id","name","dept_id","title","salary","hire_date","email","is_active"]'),
    ('categories', '["id","name","parent_id","description"]', '["id","name","parent_id","description"]'),
    ('suppliers', '["id","name","contact_name","country","rating","is_active"]', '["id","name","contact_name","phone","email","country","rating","is_active"]'),
    ('customers', '["id","name","gender","city","tier","total_spent","created_at"]', '["id","name","email","phone","gender","birth_date","city","tier","total_spent","created_at"]'),
    ('customer_addresses', '["id","customer_id","label","city","district","is_default"]', '["id","customer_id","label","city","district","address","is_default"]'),
    ('products', '["id","sku","name","category_id","supplier_id","price","cost","stock","reorder_point","is_active","created_at"]', '["id","sku","name","category_id","supplier_id","price","cost","stock","reorder_point","is_active","created_at"]'),
    ('promotions', '["id","code","description","discount_type","discount_value","min_order_amt","max_uses","used_count","start_date","end_date","is_active"]', '["id","code","description","discount_type","discount_value","min_order_amt","max_uses","used_count","start_date","end_date","is_active"]'),
    ('orders', '["id","customer_id","status","payment_method","shipping_city","promotion_id","subtotal","discount_amt","total","ordered_at","shipped_at","delivered_at"]', '["id","customer_id","status","payment_method","shipping_city","promotion_id","subtotal","discount_amt","total","ordered_at","shipped_at","delivered_at"]'),
    ('order_items', '["id","order_id","product_id","quantity","unit_price","subtotal"]', '["id","order_id","product_id","quantity","unit_price","subtotal"]'),
    ('inventory_transactions', '["id","product_id","txn_type","qty_change","note","created_by","created_at"]', '["id","product_id","txn_type","qty_change","note","created_by","created_at"]'),
    ('product_reviews', '["id","product_id","customer_id","rating","title","body","is_verified","created_at"]', '["id","product_id","customer_id","rating","title","body","is_verified","created_at"]'),
    ('sales_targets', '["id","dept_id","year","quarter","target_amt","actual_amt","target_orders","actual_orders"]', '["id","dept_id","year","quarter","target_amt","actual_amt","target_orders","actual_orders"]'),
    ('support_tickets', '["id","customer_id","order_id","category","priority","status","subject","assigned_to","created_at","resolved_at"]', '["id","customer_id","order_id","category","priority","status","subject","assigned_to","created_at","resolved_at"]')
)
INSERT OR IGNORE INTO data_scope_policies
  (id, scope_key, table_name, allowed_columns_json, can_view_raw, can_export, can_bulk_export)
SELECT
  'policy-' || r.role_name || '-' || p.table_name,
  'role:' || r.role_name,
  p.table_name,
  CASE WHEN r.role_name = 'owner' THEN p.raw_columns ELSE p.normal_columns END,
  CASE WHEN r.role_name = 'owner' THEN 1 ELSE 0 END,
  CASE WHEN r.role_name IN ('analyst', 'editor', 'dba', 'owner') THEN 1 ELSE 0 END,
  0
FROM role_definitions r CROSS JOIN policy_templates p;

-- Deterministic row-policy fixtures used by regression tests and safe operator
-- provisioning. They are not assigned to any existing account by default.
INSERT OR IGNORE INTO data_scope_policies
  (id, scope_key, table_name, allowed_columns_json, row_filter_sql, can_view_raw, can_export, can_bulk_export)
SELECT 'policy-scope-tw-orders', 'scope:tw', 'orders', allowed_columns_json, 'shipping_city = ''Taipei''', 0, 1, 0
FROM data_scope_policies WHERE scope_key = 'role:viewer' AND table_name = 'orders';

INSERT OR IGNORE INTO data_scope_policies
  (id, scope_key, table_name, allowed_columns_json, row_filter_sql, can_view_raw, can_export, can_bulk_export)
SELECT 'policy-scope-jp-orders', 'scope:jp', 'orders', allowed_columns_json, 'shipping_city = ''Tokyo''', 0, 1, 0
FROM data_scope_policies WHERE scope_key = 'role:viewer' AND table_name = 'orders';

CREATE INDEX IF NOT EXISTS idx_data_scope_policies_scope_active
  ON data_scope_policies(scope_key, is_active, table_name);
