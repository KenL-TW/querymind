-- Restore QueryMind product modules on the simplified Cloudflare architecture.
-- The business D1 remains strictly read-only: these tables only store product metadata.

ALTER TABLE users ADD COLUMN role_name TEXT NOT NULL DEFAULT 'viewer';
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
ALTER TABLE users ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

-- The first bootstrap account predates roles and must retain owner access.
UPDATE users
SET role_name = 'owner', updated_at = COALESCE(NULLIF(updated_at, ''), created_at)
WHERE id = (SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1);

CREATE TABLE IF NOT EXISTS role_definitions (
  role_name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  max_rows_per_query INTEGER NOT NULL CHECK (max_rows_per_query BETWEEN 1 AND 50000),
  is_system INTEGER NOT NULL DEFAULT 1 CHECK (is_system IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO role_definitions (role_name, display_name, description, capabilities_json, max_rows_per_query) VALUES
  ('viewer',  'Viewer',  '可瀏覽資料、使用 AI 對話與管理自己的工作內容。', '["chat","view_schema","view_dictionary","view_templates","manage_own_sessions","manage_own_insights","view_own_usage"]', 1000),
  ('analyst', 'Analyst', '可執行唯讀分析與匯出結果。', '["chat","view_schema","view_dictionary","view_templates","manage_own_sessions","manage_own_insights","view_own_usage","export"]', 10000),
  ('editor',  'Editor',  '保留原產品角色；Cloudflare D1 版本仍只允許唯讀分析。', '["chat","view_schema","view_dictionary","view_templates","manage_own_sessions","manage_own_insights","view_own_usage","export","manage_templates"]', 10000),
  ('dba',     'DBA',     '保留原產品角色；可維護 Schema 說明，但不能寫入商業資料。', '["chat","view_schema","view_dictionary","view_templates","manage_own_sessions","manage_own_insights","view_own_usage","export","manage_templates","manage_dictionary","refresh_schema"]', 10000),
  ('owner',   'Owner',   '管理工作區、使用者、角色與系統設定；商業資料仍為唯讀。', '["*"]', 50000);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role_name TEXT NOT NULL REFERENCES role_definitions(role_name),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  sql_text TEXT,
  chart_type TEXT NOT NULL DEFAULT 'table' CHECK (chart_type IN ('table', 'bar', 'line', 'area')),
  is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dictionary_entries (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL UNIQUE,
  definition TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'business',
  examples TEXT NOT NULL DEFAULT '',
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE query_templates ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE query_templates ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 1 CHECK (is_shared IN (0, 1));

INSERT OR IGNORE INTO query_templates (id, title, prompt, category, description, is_pinned, is_shared, created_at, updated_at) VALUES
  ('template-sales-overview', '營收與訂單總覽', '請整理目前各商品的營收與未取消訂單數量。', '營運', '快速掌握商品銷售表現。', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('template-customer-orders', '客戶訂單概況', '請彙整每位客戶的訂單數與消費金額。', '客戶', '檢視客戶交易分布。', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('template-product-ranking', '熱門商品排行', '請列出銷售額最高的商品及其數量。', '商品', '找出主要營收來源。', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO dictionary_entries (id, term, definition, category, examples, created_at, updated_at) VALUES
  ('dictionary-revenue', '營收', '訂單明細 subtotal 的加總，且不包含 cancelled 訂單。', '指標', 'SUM(order_items.subtotal)；排除 orders.status = cancelled。', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dictionary-order', '有效訂單', '狀態不是 cancelled 的訂單。', '指標', '可用於營收、訂單數與客戶分析。', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dictionary-customer', '客戶', '可於 customers 表中識別的交易主體。', '維度', '以 customers 與 orders 關聯。', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role_name, is_active);
CREATE INDEX IF NOT EXISTS idx_invitations_email_created ON invitations(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_active ON api_keys(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_insights_user_updated ON insights(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC);
