# QueryMind

QueryMind 是一個本地端可啟動的 AI database agent。後端使用 FastAPI，前端使用 Nuxt 3，主要用途是用自然語言查詢、分析與管理 SQL 資料庫。

本 README 以「本地端啟動」為主，包含後端、前端、PostgreSQL、OpenAI key 與資料庫連線設定。

## 本地端啟動總覽

本地開發建議流程：

1. 啟動 PostgreSQL
2. 建立 `.env.local`
3. 安裝 Python 依賴
4. 初始化 metadata DB 與 demo 資料
5. 啟動 FastAPI 後端
6. 啟動 Nuxt 前端
7. 用瀏覽器開啟系統

## 環境需求

- Python 3.10 以上
- Node.js 18 以上
- Docker Desktop
- OpenAI API key

## 1. 啟動本地 PostgreSQL

專案內建本地開發用的 PostgreSQL Docker Compose。

```powershell
python scripts/qm.py dev-db-up
```

等同於：

```powershell
docker compose -f infra/dev/docker-compose.dev.yml up -d
```

預設會啟動：

| 項目 | 值 |
|---|---|
| Host | `127.0.0.1` |
| Port | `5432` |
| User | `qm_user` |
| Password | `qm_pass` |
| App DB | `querymind` |
| Metadata DB | `querymind_meta` |

停止本地資料庫：

```powershell
python scripts/qm.py dev-db-down
```

## 2. 建立 `.env.local`

從範例檔複製一份本地設定：

```powershell
Copy-Item .env.local.example .env.local
```

打開 `.env.local`，至少確認以下設定。

```env
OPENAI_API_KEY=sk-your-openai-key-here
OPENAI_MODEL=gpt-4o
LLM_PROVIDER=openai
LLM_MAX_TOKENS=2048
OPENAI_MAX_RETRIES=6

DB_CONNECTIONS={"default": "postgresql+psycopg2://qm_user:qm_pass@127.0.0.1:5432/querymind"}
METADATA_DB_URL=postgresql+psycopg2://qm_user:qm_pass@127.0.0.1:5432/querymind_meta

STORAGE_BACKEND=local
LOCAL_STORAGE_PATH=./storage

SCHEDULER_BACKEND=apscheduler

AUTH_ENABLED=false
RBAC_ENABLED=true
DEFAULT_OWNER_EMAIL=owner@local
DEFAULT_OWNER_API_KEY=qm_owner_dev_key_change_me

API_PORT=8101
ENVIRONMENT=local
DLP_ENABLED=true
DLP_ROLE_EXEMPT=owner
SQL_WRITE_EXECUTION_ENABLED=false
```

### 重要 key 說明

| Key | 說明 |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key，後端呼叫 LLM 必填 |
| `OPENAI_MODEL` | 使用的 OpenAI 模型 |
| `LLM_PROVIDER` | 預設為 `openai` |
| `LLM_MAX_TOKENS` | 單次回覆最多輸出 token；本地建議 `2048`，可降低 TPM 429 機率 |
| `OPENAI_MAX_RETRIES` | OpenAI 短暫 429 / timeout 的自動重試次數 |
| `DB_CONNECTIONS` | 可被 QueryMind 查詢的業務資料庫連線，格式是 JSON map |
| `METADATA_DB_URL` | QueryMind 自己使用的 metadata DB，存使用者、權限、session、audit 等資料 |
| `STORAGE_BACKEND` | 本地端使用 `local` |
| `LOCAL_STORAGE_PATH` | 本地儲存路徑 |
| `SCHEDULER_BACKEND` | 本地端使用 `apscheduler` |
| `AUTH_ENABLED` | 本地開發可用 `false` |
| `RBAC_ENABLED` | 是否啟用角色權限資料 |
| `DEFAULT_OWNER_EMAIL` | 初始化 owner 帳號 email |
| `DEFAULT_OWNER_API_KEY` | 初始化 owner API key |
| `API_PORT` | FastAPI 後端 port，預設 `8101` |
| `DLP_ENABLED` | 是否啟用 PII / DLP 遮罩；B2B PoC 建議 `true` |
| `DLP_ROLE_EXEMPT` | 可豁免 DLP 遮罩的角色，預設 `owner` |
| `SQL_WRITE_EXECUTION_ENABLED` | 是否允許 agent 執行寫入/DDL SQL；B2B PoC 建議維持 `false` |

### 連線到自己的資料庫

如果要讓 QueryMind 查詢其他 PostgreSQL 資料庫，修改 `.env.local` 的 `DB_CONNECTIONS`：

```env
DB_CONNECTIONS={"default": "postgresql+psycopg2://user:password@host:5432/database"}
```

也可以設定多組連線：

```env
DB_CONNECTIONS={"default": "postgresql+psycopg2://qm_user:qm_pass@127.0.0.1:5432/querymind", "sales": "postgresql+psycopg2://user:password@host:5432/sales_db"}
```

`METADATA_DB_URL` 建議保留給 QueryMind 自己使用，不要和正式業務資料混在一起。

## 3. 安裝後端依賴

建議使用虛擬環境。

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

如果已經有 `.venv`，直接啟用後安裝即可：

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 4. 初始化本地資料

初始化 metadata DB、使用者、demo session 與測試資料：

```powershell
python scripts/qm.py dev-init
```

這個命令會依序執行：

```powershell
python infra/scripts/init_meta_db.py
python infra/scripts/seed_metadata.py
python seed_full_schema.py
python scripts/seed_recent_sales.py
```

`scripts/seed_recent_sales.py` 會補上以執行當天為基準的近 30 天 demo 訂單，方便測試銷售趨勢、熱銷商品、近 30 天營收等查詢。這支腳本可重複執行；它只會清掉自己建立的近期 demo 訂單，標記為 `orders.shipping_city = 'RecentDemo'`。

如果只想補近期銷售資料，不想重建整個 schema：

```powershell
python scripts/seed_recent_sales.py
```

預設登入帳號：

| Email | Role | Password |
|---|---|---|
| `owner@local` | owner | `Owner123!` |
| `analyst@local` | analyst | `Analyst123!` |
| `viewer@local` | viewer | `Viewer123!` |

邀請新使用者：

1. 以 owner 或具備管理權限的帳號進入 `管理 / 邀請`。
2. 建立邀請後，系統會顯示完整連結，例如 `/accept-invite?token=inv_...`，該連結僅顯示一次。
3. 收到者開啟連結後會看到受邀 email、角色與可用 connection，設定密碼後會直接進入工作區。
4. 進階串接仍可使用 `POST /v1/auth/accept-invite`，但一般 onboarding 請優先分享完整邀請連結。

## 5. 啟動後端 API

```powershell
python main.py
```

後端預設會在：

```text
http://localhost:8101
```

API 文件：

```text
http://localhost:8101/docs
```

健康檢查：

```text
http://localhost:8101/health
```

## 6. 啟動前端

開另一個終端機：

```powershell
cd frontend
npm install
npm run dev
```

前端預設會在：

```text
http://localhost:3000
```

本地開發建議讓前端以同源 `/v1/...` 呼叫 API，並由 Nuxt dev server proxy 到 FastAPI。於 `frontend/.env` 建立：

```env
NUXT_PUBLIC_API_BASE=
NUXT_DEV_API_PROXY_TARGET=http://localhost:8101/v1
```

## 7. 開啟瀏覽器

| 服務 | URL |
|---|---|
| Nuxt 前端 | `http://localhost:3000` |
| FastAPI 後端 | `http://localhost:8101` |
| Swagger API 文件 | `http://localhost:8101/docs` |
| Health check | `http://localhost:8101/health` |

## 8. 本地前後端整合驗證

本地端啟動後，請確認專案根目錄的 `.env.local`：

```env
API_PORT=8101
CORS_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]
ADMIN_PORTAL_URL=http://localhost:3000
```

並確認 `frontend/.env`：

```env
NUXT_PUBLIC_API_BASE=
NUXT_DEV_API_PROXY_TARGET=http://localhost:8101/v1
```

`NUXT_PUBLIC_API_BASE` 留空代表前端用同源 `/v1/...` 呼叫 API；Nuxt dev server 會把 `/v1` proxy 到本機後端 `http://localhost:8101`。

修改 `.env.local`、`frontend/.env` 或 `frontend/nuxt.config.ts` 後，需要重啟後端與前端 dev server。完整 Windows 啟動流程如下。

終端機 1：啟動 PostgreSQL。

```powershell
python scripts/qm.py dev-db-up
```

終端機 2：啟動 FastAPI 後端。

```powershell
.\.venv\Scripts\Activate.ps1
python main.py
```

如果 `.venv` 因 Python 路徑失效無法啟動，但 Windows Store Python 3.10 可用，可以改用：

```powershell
& "C:\Program Files\WindowsApps\PythonSoftwareFoundation.Python.3.10_3.10.3056.0_x64__qbz5n2kfra8p0\python3.10.exe" main.py
```

終端機 3：啟動 Nuxt 前端。

```powershell
cd frontend
npm install
npm run dev
```

本機驗證：

```powershell
curl http://localhost:8101/health
curl http://localhost:3000/v1/health
```

兩個都應該回傳 `{"status":"ok", ...}`。

## 常用開發命令

```powershell
# 啟動本地 PostgreSQL
python scripts/qm.py dev-db-up

# 停止本地 PostgreSQL
python scripts/qm.py dev-db-down

# 初始化 metadata 與 demo schema
python scripts/qm.py dev-init

# 後端 Python compile check + 前端 typecheck
python scripts/qm.py check

# 只檢查 Python
python scripts/qm.py check --skip-frontend

# 只檢查前端
python scripts/qm.py check --skip-python
```

## API 使用範例

同步 chat：

```powershell
curl -X POST http://localhost:8101/v1/chat/sync `
  -H "Content-Type: application/json" `
  -d "{\"message\":\"List all tables\", \"conn_name\":\"default\"}"
```

Streaming chat：

```powershell
curl -N -X POST http://localhost:8101/v1/chat `
  -H "Content-Type: application/json" `
  -d "{\"message\":\"List all tables\", \"conn_name\":\"default\"}"
```

近 30 天熱銷商品查詢範例：

```sql
SELECT
    p.name AS product_name,
    c.name AS category_name,
    SUM(oi.subtotal) AS total_sales,
    SUM(oi.quantity) AS total_quantity
FROM order_items oi
JOIN orders o ON oi.order_id = o.id
JOIN products p ON oi.product_id = p.id
JOIN categories c ON p.category_id = c.id
WHERE o.ordered_at >= NOW() - INTERVAL '30 days'
GROUP BY p.name, c.name
ORDER BY total_sales DESC
LIMIT 10;
```

注意：`order_items` 的單價欄位是 `unit_price`，沒有 `price` 欄位。銷售額建議直接使用 `order_items.subtotal`。

## Workspace / Data Connections

QueryMind 提供 Workspace / Data Connections 管理模組，用來集中管理資料庫連線、連線測試、schema 掃描、權限綁定與環境切換。

本地端啟動後可進入：

```text
前端：管理 / 資料連線
API：/v1/admin/connections
```

核心功能：

- 新增 / 編輯 workspace DB connection
- connection health check
- schema introspection / scan
- schema observer / drift detection：保存 connection schema fingerprint，偵測 table、view、field、type 異動
- 顯示每個 connection 的來源、環境、狀態與遮罩後的 DB URL
- 顯示每個角色與使用者可用哪些 connection

連線來源分為兩種：

| Source | 說明 |
|---|---|
| `config` | 由 `.env.local` 的 `DB_CONNECTIONS` 定義，適合本地預設連線或正式環境固定連線 |
| `workspace` | 由管理頁新增，儲存在 `METADATA_DB_URL` 指向的 metadata DB 的 `qm_system_config` |

`.env.local` 仍保留最重要的基礎連線：

```env
DB_CONNECTIONS={"default": "postgresql+psycopg2://qm_user:qm_pass@127.0.0.1:5432/querymind"}
METADATA_DB_URL=postgresql+psycopg2://qm_user:qm_pass@127.0.0.1:5432/querymind
```

管理 API：

```powershell
# 列出所有 connection，含健康狀態與權限摘要
curl http://localhost:8101/v1/admin/connections

# 測試尚未儲存的 DB URL
curl -X POST http://localhost:8101/v1/admin/connections/test `
  -H "Content-Type: application/json" `
  -d "{\"name\":\"sales\",\"url\":\"postgresql+psycopg2://user:password@host:5432/sales\"}"

# 掃描 schema
curl -X POST http://localhost:8101/v1/admin/connections/default/scan-schema
```

注意事項：

- `config` 來源的 connection 不可在 UI 編輯或刪除，請修改 `.env.local`。
- `workspace` 來源的 connection 可在 UI 新增、編輯、停用或刪除。
- DB URL 回傳前會遮罩密碼，避免在前端或 audit log 直接暴露 credential。
- 使用者的 `allowed_conns` 留空代表可用全部 connection；有填值則只允許指定 connection。
- 每次 Agent Resolver 使用 connection 前會以短 TTL 自動檢查 schema snapshot；若 schema fingerprint 改變，會清 schema cache 並刷新 agent schema brief。
- 管理頁的 `Scan` 會強制掃描 schema，回傳 drift 摘要，例如新增/刪除 table、欄位增減與欄位型別變更。

## Semantic Layer 與 Query Plan

QueryMind 內建 semantic layer，讓 Agent 使用業務語意而不是猜欄位。

核心語意：

| Metric | 定義 |
|---|---|
| `sales_amount` | `SUM(order_items.subtotal)` |
| `units_sold` | `SUM(order_items.quantity)` |
| `order_count` | `COUNT(DISTINCT orders.id)` |
| `avg_order_value` | `SUM(orders.total) / COUNT(DISTINCT orders.id)` |

重要規則：

- 銷售額使用 `order_items.subtotal`
- 銷售件數使用 `order_items.quantity`
- 銷售時間使用 `orders.ordered_at`
- `order_items` 沒有 `price` 欄位；單價是 `unit_price`

查看 semantic layer：

```powershell
curl http://localhost:8101/v1/semantic-layer
```

從自然語言產生 Query Plan 與 SQL：

```powershell
curl -X POST http://localhost:8101/v1/query-plan `
  -H "Content-Type: application/json" `
  -d "{\"question\":\"列出近 30 天銷售金額最高的 10 項商品，含商品名稱、類別、銷售額與銷售件數。\"}"
```

範例 Query Plan：

```json
{
  "metric": "sales_amount",
  "time_range": "last_30_days",
  "dimensions": ["product", "category"],
  "sort": "sales_amount desc",
  "limit": 10,
  "chart_type": "bar",
  "include_metrics": ["sales_amount", "units_sold"]
}
```

執行 Query Plan：

```powershell
curl -X POST http://localhost:8101/v1/query-plan/execute `
  -H "Content-Type: application/json" `
  -d "{\"conn_name\":\"default\",\"query_plan\":{\"metric\":\"sales_amount\",\"time_range\":\"last_30_days\",\"dimensions\":[\"product\",\"category\"],\"sort\":\"sales_amount desc\",\"limit\":10,\"include_metrics\":[\"sales_amount\",\"units_sold\"]}}"
```

Agent tools 也會使用：

- `describe_semantic_layer`
- `build_query_plan`
- `execute_query_plan`

## Templates 綁定 Metrics

模板現在可以綁定：

- `metric_ids`
- `query_plan`
- `chart_config`

內建的「TOP 10 熱銷商品」已綁定 `sales_amount`、`units_sold`，並使用 `product`、`category` 維度與 bar chart 預設設定。

自訂模板可在前端模板庫中填入 Metrics、Query Plan JSON、Chart Config JSON。

## Tool Observability

Agent 每一步 tool call 會寫入 audit log，包含：

- tool 名稱
- connection
- input
- output
- error
- latency
- session id
- user id

查看：

```text
前端：管理 / 審計
API：GET /v1/admin/audit-logs?event_type=tool_call
```

Token usage 仍記錄在同一輪 `agent_invoke` audit log 中，可用 session id 與時間對應 tool call。

## Agent Flow 強化

QueryMind 的 DB Agent flow 已拆成可觀測的 pipeline，不再只依賴 LLM 直接從自然語言猜 SQL。

目前流程：

```text
User Question
  -> intent_router
  -> schema_resolver
  -> query_plan
  -> sql_validator
  -> execute_query / execute_query_plan
  -> empty_result_diagnosis
  -> final answer
```

新增能力：

- `resolve_schema_for_question`：根據問題、semantic layer、欄位名稱、FK/PK 關係排序候選 tables / fields。
- Schema observer：resolver 會自動比對 schema snapshot 與 fingerprint，偵測異動後刷新 schema cache / agent schema brief，並在 trace 中回傳 observation 狀態。
- `validate_sql_dry_run_tool`：執行前用 `EXPLAIN (ANALYZE false, FORMAT JSON)` 做 dry-run，並對常見錯誤做保守 auto-repair。
- SQL auto-repair 目前支援 sales 欄位誤用、unknown column 近似欄位修復、ambiguous column 保守補 alias、以及常見漏 JOIN 補齊；每次修復後仍會重新 dry-run 驗證。
- `diagnose_empty_sql_result`：查詢 0 筆時分析可能原因，例如時間範圍超出資料、JOIN 條件過嚴、WHERE 條件排除資料。
- `build_agent_flow_trace_tool`：產生完整 trace，包含 intent、候選表、query plan、SQL validation 與 latency。
- 串流聊天會發出 `flow_trace` SSE event，前端思考過程會顯示每個 pipeline step。
- `answer_plan`：查詢後產生回應呈現策略，包含 answer type、建議圖表、摘要重點、warnings、下一步、columns 與 preview rows；前端會直接渲染成表格與 ECharts 圖表，不再只保留在 payload。
- `agent_flow_trace` audit event：每輪 flow trace 會寫入審計日誌，管理頁可依事件類型篩選。
- Schema resolver 會結合 semantic layer、local schema embedding、欄位/表名命中與相似成功 query history scoring，讓 table 判斷更穩定。

這些 trace 是產品可觀測資訊，不是 hidden chain-of-thought；適合用於 debug、產品優化與管理員審查。

## 專案結構

```text
querymind/
├── api/                  FastAPI app、routes、schemas、streaming
├── adapters/             LLM、scheduler、storage adapters
├── config/               pydantic settings 與 logging
├── core/                 agent、semantic layer、query planner、RBAC、auth、memory
├── db/                   SQLAlchemy connector、registry、schema introspection
├── frontend/             Nuxt 3 SPA
├── infra/
│   ├── dev/              本地 PostgreSQL Docker Compose
│   ├── docker/           舊版 all-in-one Docker 設定
│   └── scripts/          metadata 初始化與 seed scripts
├── scripts/              開發與 AWS demo 輔助命令
├── storage/              metadata DB ORM、code archive
├── tools/                agent tools
├── .env.local.example    本地環境變數範例
├── main.py               後端啟動入口
└── requirements.txt      Python 依賴
```

## 本地端疑難排解

### 後端連不上資料庫

先確認 PostgreSQL container 有啟動：

```powershell
docker ps
```

再確認 `.env.local`：

```env
DB_CONNECTIONS={"default": "postgresql+psycopg2://qm_user:qm_pass@127.0.0.1:5432/querymind"}
METADATA_DB_URL=postgresql+psycopg2://qm_user:qm_pass@127.0.0.1:5432/querymind_meta
```

### 前端打不到後端

確認後端已啟動：

```text
http://localhost:8101/health
```

確認 `frontend/.env`：

```env
NUXT_PUBLIC_API_BASE=
NUXT_DEV_API_PROXY_TARGET=http://localhost:8101/v1
```

再確認 Nuxt dev proxy 可打到後端：

```text
http://localhost:3000/v1/health
```

### OpenAI 呼叫失敗

確認 `.env.local` 有正確設定：

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
LLM_PROVIDER=openai
LLM_MAX_TOKENS=2048
OPENAI_MAX_RETRIES=6
```

修改 `.env.local` 後，需要重啟 `python main.py`。

## Docker all-in-one

目前本地開發建議只用 Docker 啟動 PostgreSQL，後端與前端用原生命令啟動。

如果需要舊版 all-in-one Docker：

```powershell
cd infra/docker
docker-compose up --build
```

服務：

| 服務 | URL |
|---|---|
| API | `http://localhost:8101` |
| Frontend | `http://localhost:3000` |
