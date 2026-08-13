# QueryMind — Web Architecture 技術架構說明文件

> 版本：1.0 | 撰寫日期：2026-06-08
> 用途：雲端部署架構評估、資安審查、元件拆分與擴展規劃

---

## 目錄

1. [系統全貌](#1-系統全貌)
2. [前端（Frontend Layer）](#2-前端-frontend-layer)
3. [後端 API 層（Backend API Layer）](#3-後端-api-層-backend-api-layer)
4. [AI Agent 核心引擎](#4-ai-agent-核心引擎)
5. [工具層（Tools Layer）](#5-工具層-tools-layer)
6. [資料庫連線層（Database Layer）](#6-資料庫連線層-database-layer)
7. [持久化儲存層（Persistence Layer）](#7-持久化儲存層-persistence-layer)
8. [認證與授權體系（Auth & RBAC）](#8-認證與授權體系-auth--rbac)
9. [資安防護機制（Security Controls）](#9-資安防護機制-security-controls)
10. [排程與背景作業（Scheduler）](#10-排程與背景作業-scheduler)
11. [外部系統串接](#11-外部系統串接)
12. [設定管理（Configuration）](#12-設定管理-configuration)
13. [資料流總覽（End-to-End Data Flow）](#13-資料流總覽-end-to-end-data-flow)
14. [元件相依關係圖](#14-元件相依關係圖)
15. [已知限制與生產上線建議](#15-已知限制與生產上線建議)

---

## 1. 系統全貌

QueryMind 是一套 **AI 驅動的資料庫自然語言查詢平台**，核心能力是讓非技術背景的業務人員透過繁體中文對話介面向企業資料庫提問，由 LLM 驅動的 Agent 自動產生並執行 SQL，再以結構化報告回覆。

### 1.1 部署拓撲（邏輯層）

```
┌─────────────────────────────────────────────────────────────────────┐
│  使用者瀏覽器                                                         │
│  Nuxt 3 SPA (port 3001)  ←── HTTPS / SSE streaming ──►             │
│                                                                     │
│  FastAPI Backend (port 8080)                                        │
│  ├── API Routes (REST + SSE)                                        │
│  ├── AI Agent Engine (LangChain AgentExecutor)                      │
│  ├── Tools Layer (15+ tools)                                        │
│  ├── RBAC / Auth / Audit                                            │
│  └── Scheduler (APScheduler)                                        │
│            │                                                        │
│            ▼                                                        │
│  PostgreSQL (metadata + 業務資料)                                    │
│  ├── System Tables (qm_*)   — 15 個 ORM 管理的 metadata 表          │
│  └── Business Tables        — 14 個 demo/用戶業務資料表              │
│            │                                                        │
│            ▼                                                        │
│  Local Filesystem / Object Storage                                  │
│  └── ETL scripts / export files / code archive                     │
└─────────────────────────────────────────────────────────────────────┘
            │
            ▼ (外部 HTTPS 呼叫)
    LLM Provider API
    (OpenAI / Anthropic / AWS Bedrock)
```

### 1.2 技術棧

| 層級 | 技術 | 版本 |
|------|------|------|
| 前端框架 | Nuxt 3 + Vue 3 | SPA 模式，TypeScript |
| UI 元件庫 | Naive UI + Tailwind CSS | — |
| 狀態管理 | Pinia | — |
| 圖表渲染 | ECharts + vue-echarts | — |
| Markdown 渲染 | 自訂 `useMarkdown` composable | — |
| 後端框架 | FastAPI (Python) | asyncio |
| LLM 框架 | LangChain 0.3.x | AgentExecutor |
| ORM | SQLAlchemy 2.x | psycopg2 驅動 |
| 資料庫 | PostgreSQL | 唯一支援的 SQL dialect |
| JWT | python-jose | HS256 簽名 |
| 排程 | APScheduler (BackgroundScheduler) | in-process |
| 速率限制 | SlowAPI (slowapi) | — |
| 設定 | pydantic-settings | .env 驅動 |

---

## 2. 前端（Frontend Layer）

### 2.1 架構模式

Nuxt 3 設定為 **SPA（Client-Side Rendering）模式**（`ssr: false`），所有頁面邏輯在瀏覽器端執行。此設計迴避了 Naive UI 的 SSR hydration 問題，並使部署簡化為靜態站點 + API。

```
frontend/
├── pages/           ← Nuxt 自動路由（file-based routing）
│   ├── index.vue    ← 重定向至 /chat
│   ├── login.vue    ← 登入頁（JWT email/password + API key）
│   ├── chat.vue     ← 主對話介面（最複雜，含 SSE 串流消費）
│   ├── sessions.vue ← 歷史對話管理
│   ├── templates.vue← 問題模板 CRUD
│   ├── dictionary.vue← 資料字典（欄位描述編輯）
│   ├── schema.vue   ← 資料庫 Schema 瀏覽
│   ├── admin/       ← 使用者管理（需 manage_users 能力）
│   └── accept-invite.vue ← 邀請接受 / 密碼設定
│
├── composables/     ← 可重用 Vue 邏輯（hooks 模式）
│   ├── useChatStream.ts  ← SSE 串流處理核心
│   ├── useApi.ts         ← 統一 API 呼叫 (fetch wrapper + token 注入)
│   └── useMarkdown.ts    ← Markdown → HTML，含 ECharts JSON 解析
│
├── stores/          ← Pinia 全域狀態
│   ├── auth.ts      ← access token / refresh token / me / 能力檢查
│   ├── chat.ts      ← 對話訊息列表 / 思考步驟 / warnings / insights
│   └── sessions.ts  ← 歷史 session 列表
│
├── middleware/
│   └── auth.global.ts ← 全域路由守衛（未驗證導向 /login）
│
├── components/
│   ├── MarkdownWithCharts.vue ← 渲染含 ECharts 區塊的 Markdown
│   └── AdminTabs.vue          ← 管理頁面 Tab 容器
│
└── layouts/
    └── default.vue  ← 主 Layout：側邊欄導航 + 使用者資訊
```

### 2.2 認證流程（前端側）

```
使用者輸入 email + password
        │
        ▼
POST /v1/auth/login
        │
        ▼
收到 { access_token, refresh_token (HttpOnly cookie) }
        │
        ├── access_token → Pinia auth.store (記憶體)
        │                  所有後續請求 Header: Authorization: Bearer <token>
        │
        └── refresh_token → HttpOnly Cookie (自動隨請求送出)
                            token 過期時 auth.refresh() 自動呼叫
                            POST /v1/auth/refresh 換取新 access_token
```

### 2.3 SSE 串流消費（`useChatStream.ts`）

`EventSource` 原生 API 不支援 POST 請求，因此使用 `fetch() + ReadableStream` 手動解析 SSE：

```typescript
// 手動 SSE 解析核心
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  // 按 \n\n 分割事件塊，再按 event: / data: 解析
}
```

**支援的 SSE 事件類型：**

| 事件名稱 | 資料結構 | 用途 |
|----------|----------|------|
| `intent` | `{intent, dimensions, time_hint, suggested_tools, ...}` | 意圖識別結果（透明化 Agent 推理） |
| `token` | `{token}` | LLM 逐 token 輸出 |
| `thought` | `{action, action_input}` | Agent 工具呼叫決策 |
| `observation` | `{observation}` | 工具執行結果 |
| `finish` | `{answer, tokens_used, followup_questions, warnings, insights}` | 完整答案 + 元資訊 |
| `suggestions` | `{suggestions, title, summary, entities}` | 後續問題建議 + session 摘要更新 |
| `error` | `{error}` | 錯誤訊息 |

**Token 刷新重試邏輯：**  
收到 HTTP 401 時，自動呼叫 `auth.refresh()` 換 token 後重送一次原始請求，再次失敗才導向登入頁。

### 2.4 API 安全標頭傳遞

```typescript
// useApi.ts — 所有 API 呼叫統一處理
const headers: Record<string, string> = {
  'Content-Type': 'application/json',
}
if (auth.accessToken) {
  headers.Authorization = `Bearer ${auth.accessToken}`
}
// credentials: 'include' → 讓 refresh_token cookie 自動帶上
```

---

## 3. 後端 API 層（Backend API Layer）

### 3.1 FastAPI 應用結構

```
api/
├── main.py          ← FastAPI 應用入口、Lifespan 初始化、Middleware 掛載
├── auth.py          ← 認證依賴（require_user、require_admin）
├── context.py       ← contextvars 儲存當前 UserContext（thread-safe）
├── audit.py         ← AuditLogger（寫入 qm_audit_log）
├── rate_limit.py    ← SlowAPI limiter 單例（按 API key 或 IP 計費）
├── metrics.py       ← 效能指標收集
├── schemas.py       ← Pydantic 請求/回應 schema
└── routes/
    ├── chat.py           POST /v1/chat  — 主對話端點（SSE 串流）
    ├── auth_route.py     POST /v1/auth/login|refresh|logout|invite|accept-invite
    ├── sessions.py       GET/DELETE/PATCH /v1/sessions/*
    ├── admin.py          GET/POST /v1/admin/* （使用者 CRUD / cache）
    ├── connections.py    GET /v1/connections
    ├── schema.py         GET /v1/schema/*
    ├── templates.py      CRUD /v1/templates
    ├── dictionary.py     GET/PUT /v1/dictionary/{conn_name}
    ├── insights.py       GET /v1/insights
    ├── export.py         GET /v1/export/{format}
    ├── import_route.py   POST /v1/import
    └── health.py         GET /health
```

### 3.2 Lifespan 初始化順序（啟動時）

```
1. configure_logging(env)           — 設定結構化 log 格式
2. ConnectionRegistry.from_config() — 建立所有 DB 連線池
3. LocalStorageAdapter / S3StorageAdapter — 依設定選擇儲存後端
4. init_metadata_db()               — ORM DDL 自動建表（如未存在）
5. CodeArchive(storage, session_factory) — ETL 腳本存檔層
6. UserService(session_factory)     — 確保 owner 帳戶存在
7. AuditLogger(session_factory)     — 掛載稽核日誌器
8. APSchedulerAdapter()             — 啟動背景排程器
9. LLMFactory.create(settings)      — 初始化 LLM 連線
10. get_all_tools(registry, ...)    — 組裝 15+ 工具清單
11. build_system_prompt(conns)      — 產生 Agent System Prompt
12. build_agent(tools, llm, prompt) — 建立 LangChain AgentExecutor
13. SessionMemoryManager()          — 建立 session 記憶管理器
```

### 3.3 中介層（Middleware）堆疊

請求依下列順序通過各 middleware：

```
請求進入
    │
    ├── [1] SlowAPIMiddleware     — 速率限制（按 API key / IP）
    │         rate_limit_chat: 30/minute（/v1/chat）
    │         rate_limit_api:  120/minute（其他 /v1/*）
    │
    ├── [2] CORSMiddleware        — 跨域控制
    │         allow_origins: 從 settings.cors_origins 讀取（可設定）
    │         allow_credentials: True（支援 cookie）
    │         X-API-Key header 明確允許
    │
    ├── [3] require_user()        — FastAPI Security 依賴注入
    │         解析 Bearer token 或 X-API-Key
    │         設定 contextvars（get_current_user() 全域可用）
    │
    └── Route Handler             — 業務邏輯
```

### 3.4 主要 API 端點規格

#### POST /v1/chat（核心）

```
Request Body:
  {
    "message":    "string",      # 使用者問題
    "session_id": "string",      # 對話 session UUID
    "conn_name":  "default"      # 目標資料庫連線名稱
  }

Response: text/event-stream（SSE）
  Content-Type: text/event-stream
  Cache-Control: no-cache
  X-Accel-Buffering: no          # 關閉 nginx buffering

RBAC 保護: require_user()
Rate Limit: 30/minute（按 API key 或 IP）
```

#### POST /v1/auth/login

```
Request Body:
  {
    "email":    "string",
    "password": "string"
  }

Response:
  {
    "access_token":  "JWT string",
    "token_type":    "bearer",
    "expires_in":    3600,        # 秒
    "user": { id, email, role }
  }
  Set-Cookie: qm_refresh=<jwt>; HttpOnly; SameSite=Lax; Path=/v1/auth/refresh
```

---

## 4. AI Agent 核心引擎

### 4.1 Agent 架構

```
core/
├── agent.py        ← build_agent() — LangChain AgentExecutor 組裝
├── system_prompt.py← 動態 System Prompt 產生（含 persona + RBAC 附言）
├── router.py       ← LLM 路由（cheap / strong tier 分流）
├── memory.py       ← SessionMemoryManager — 滑動窗口 + PostgreSQL 持久化
├── summarizer.py   ← 非同步 session 摘要 + 後續問題建議 + 實體提取
├── intent.py       ← 意圖識別器（純啟發式，無 LLM 呼叫）
├── insights.py     ← 結果集自動洞察（純 Python，無 DB/LLM 呼叫）
├── validator.py    ← SQL 結果品質警告（空值率 / 異常值 / 空結果）
├── query_cache.py  ← SELECT 結果 TTL 快取（in-process, SHA-256 key）
├── llm_factory.py  ← LLM provider 抽象工廠
├── token_usage.py  ← Token 使用量累加器（LangChain callback）
├── rbac.py         ← 角色模型與 SQL verb 權限檢查
├── jwt_utils.py    ← JWT 建立與驗證（python-jose）
├── dlp.py          ← PII 脫敏（正規表達式遮罩）
├── templates.py    ← 內建問題模板（built-in）
└── user_service.py ← UserService（使用者 CRUD + API key 哈希驗證）
```

### 4.2 Agent 請求處理流程

```
使用者輸入
    │
    ▼
[1] Intent Detection（core/intent.py）
    ├── 正規表達式比對 11 種意圖類型（ranking / trend / ratio / ...）
    ├── 提取維度詞（產品 / 客戶 / 地區 ...）
    ├── 提取時間範圍提示（本月 / 近 30 天 ...）
    ├── 偵測模糊詞（最近 / 一些 / 最好）
    └── 輸出 IntentPlan（含建議工具 + 步驟）
    │
    ▼
[2] SSE emit: event: intent（前端顯示）
    │
    ▼
[3] 意圖計畫注入 System Prompt（_build_stream_input）
    ├── 將 format_plan_for_prompt() 輸出附加到使用者訊息尾端
    └── Agent 看到問題 + 計畫，減少探索回合
    │
    ▼
[4] LLM Tier Routing（core/router.py）
    ├── llm_routing_enabled = False → 直接用 strong 模型
    ├── SQL keywords → strong
    ├── 問題長度 > threshold → strong
    └── 否則 → cheap（省成本）
    │
    ▼
[5] History 載入（SessionMemoryManager）
    ├── 從 PostgreSQL qm_chat_messages 讀取
    ├── 滑動窗口：最新 10 個回合（memory_window_turns）
    └── 舊 messages 留 DB 但不進 prompt
    │
    ▼
[6] AgentExecutor.astream_events()（LangChain）
    ├── System Prompt 含 persona + RBAC 附言 + 資料探索原則 + 工具指引
    ├── ReAct 迴圈：思考 → 選工具 → 執行工具 → 觀察 → 再思考
    ├── 每個 token 串流 → SSE event: token
    ├── 每個工具呼叫 → SSE event: thought
    └── 每個工具結果 → SSE event: observation
    │
    ▼
[7] 每次 execute_query 工具執行時：
    ├── RBAC 驗證 → assert_sql_allowed()（SQL verb 白名單）
    ├── Query Cache 查詢（SHA-256 key, TTL 120s）
    ├── 若 cache miss → 執行 SQL（statement_timeout = 60s）
    ├── 若 cache miss → cache put（僅 SELECT/WITH）
    ├── DLP 脫敏（如 dlp_enabled = True）
    └── RBAC row cap（max_rows_per_query）
    │
    ▼
[8] Agent 最終回答生成
    │
    ▼
[9] 結果後處理
    ├── validate_sql_result()  → warnings（品質警告）
    ├── generate_insights()    → insights（自動洞察）
    └── SSE emit: event: finish
    │
    ▼
[10] 非同步後台
    ├── session_mgr.add_turn()       — 寫入 qm_chat_messages
    ├── audit_logger.log()           — 寫入 qm_audit_log
    ├── generate_followups()         — LLM 生成後續問題建議
    ├── summarize_overflow()         — 逾期 messages 壓縮摘要
    └── SSE emit: event: suggestions
```

### 4.3 System Prompt 架構

System Prompt 由 `build_system_prompt()` 動態產生，包含以下段落：

1. **Persona 區段**：載入 `data/persona.json`（預設嵌入於 `core/system_prompt.py`）
   - 角色定義（senior Data Engineer / Data Analyst）
   - 語言、語氣、禁止開場白、輸出結構順序
   - Agentic rules（最多 12 次工具呼叫、最多 2 次 SQL 重試）

2. **資料庫 schema 快照**：列出所有可用連線名稱

3. **SQL 撰寫紀律**：欄位必須帶 alias、GROUP BY 完整性、錯誤自動重試規則

4. **資料探索原則**（本次強化新增）：9 種情境對應最佳工具選擇表 + 6 條精準分析判斷標準

5. **回覆前自檢**：送出答案前的邏輯驗證 checklist

6. **RBAC 附言**（`role_prompt_addendum()`）：根據使用者角色動態追加限制說明

### 4.4 Session 記憶管理

```
SessionMemoryManager
│
├── get_messages_for_agent(session_id)
│   ├── 從 PostgreSQL 讀取 qm_chat_messages
│   ├── 取最新 N*2 條（滑動窗口，N = memory_window_turns = 10）
│   └── 轉換為 LangChain BaseMessage 列表
│
├── add_turn(session_id, human_msg, ai_msg, ...)
│   └── 寫入 qm_chat_messages（永久保留，完整稽核）
│
├── get_history_for_prompt(session_id)
│   └── 返回格式化字串供 ReAct prompt 使用
│
└── upsert_session_meta(session_id, title, summary, ...)
    └── 更新 qm_session_meta（標題 / 摘要 / 實體 / pin / archive）
```

### 4.5 意圖識別器（core/intent.py）

**11 種意圖類型**（依比對優先序）：

| 意圖 | 觸發關鍵詞（範例） | 建議工具 |
|------|-------------------|---------|
| `ranking` | TOP N / 前 N / 排名 / 最高 / 最低 | `find_relations`, `execute_query` |
| `trend` | 趨勢 / 每月 / 逐日 / 走勢 | `time_range`, `execute_query` |
| `ratio` | 佔比 / 比例 / % | `execute_query`（CTE 分子/分母） |
| `comparison` | 同比 / 環比 / 比較 / YoY | `compare_periods` |
| `distribution` | 分佈 / 直方圖 / 區間 | `column_stats`, `execute_query` |
| `anomaly` | 異常 / 離群 / 突增 | `detect_outliers` |
| `correlation` | 相關 / 影響 / 因果 | `execute_query` |
| `aggregation` | 總和 / 平均 / 數量 / COUNT | `execute_query` |
| `lookup` | 列出 / 查詢 / 找出 | `execute_query` |
| `filter_check` | 是否 / 有沒有 / 存在 | `execute_query` (EXISTS) |
| `unknown` | —（fallback） | `execute_query` |

---

## 5. 工具層（Tools Layer）

Agent 可呼叫的工具完整清單（共 **15 個核心工具**）：

### 5.1 資料庫工具（`tools/db_tools.py`，7 個）

| 工具名稱 | 功能說明 | RBAC 需求 |
|----------|----------|----------|
| `execute_query` | 執行任意 SQL（含快取、DLP、row cap） | 全角色 |
| `list_schemas` | 列出所有 schema | 全角色 |
| `list_tables` | 列出指定 schema 的所有資料表 | 全角色 |
| `get_table_ddl` | 取得資料表 DDL（含欄位、索引、FK） | 全角色 |
| `compare_ddl` | 比較兩個資料表的 schema 差異 | analyst+ |
| `list_connections` | 列出當前角色可存取的連線名稱 | 全角色 |
| `explain_query` | 取得 SQL EXPLAIN 執行計畫（ANALYZE false） | 全角色 |

**`execute_query` 安全管線：**
```
SQL 輸入
 → assert_tool_allowed()          ← RBAC tool 白名單
 → assert_conn_allowed()          ← 連線名稱存取控制
 → assert_sql_allowed()           ← SQL verb 白名單（DROP/TRUNCATE 永久禁止）
 → query_cache.get()              ← TTL 快取查詢（SELECT/WITH only）
 → [cache miss] DBConnector.execute()  ← 帶 statement_timeout = 60s
 → query_cache.put()              ← 寫入快取（只寫 SELECT/WITH）
 → apply_row_cap()                ← max_rows_per_query 截斷
 → mask_rows() if dlp_enabled     ← PII 脫敏
 → 返回 JSON
```

### 5.2 資料分析工具（`tools/analysis_tools.py`，8 個）

| 工具名稱 | 功能說明 | 適用意圖 |
|----------|----------|---------|
| `profile_table` | 資料表概覽：列數 / 欄數 / NULL 率 / 基數 | 探索 |
| `column_stats` | 欄位統計：自動偵測數值/時間/類別型別 | distribution |
| `sample_rows` | 隨機抽樣（`ORDER BY RANDOM() LIMIT n`，上限 50） | 探索 |
| `distinct_values` | 指定欄位所有值 + 計數（降序，上限 30） | filter_check |
| `find_relations` | 偵測 FK 宣告 + 名稱啟發（`_id` 後綴） + 被參照關係 | ranking / lookup |
| `time_range` | 時間欄位 min/max/資料筆數/span_days | trend / comparison |
| `detect_outliers` | IQR 或 z-score 方法偵測離群值 | anomaly |
| `compare_periods` | 兩個時間段的指標比較（絕對差 + 百分比變化） | comparison |

所有分析工具共用：
- `_check(conn_name, tool_name)` — RBAC 驗證
- `_safe_ident(name)` — SQL 識別符安全引號（防 SQL injection via column name）
- `_deny(e)` — 標準錯誤 JSON 回應

### 5.3 視覺化工具（`tools/viz_tools.py`）

| 工具名稱 | 功能說明 |
|----------|----------|
| `query_to_chart` | 執行 SQL + 返回 ECharts JSON config（bar / line / pie / scatter / heatmap / funnel） |

前端的 `MarkdownWithCharts.vue` 解析答案中的 ` ```json ``` ` 區塊，判斷是否為有效 ECharts config，若是則直接渲染為互動圖表。

### 5.4 匯出工具（`tools/export_tools.py`）

| 工具名稱 | 功能說明 | RBAC 需求 |
|----------|----------|----------|
| `export_query_csv` | 驗證 SQL 可匯出，Agent 回覆下載按鈕 | `can_export` |
| `export_query_excel` | 同上，格式 Excel | `can_export` |

實際檔案生成由 `GET /v1/export/{csv|excel}` 端點處理，工具只做 RBAC 預檢 + row count 確認。

### 5.5 ETL 工具（`tools/etl_tools.py`）

提供受限沙箱環境讓 Agent 執行使用者提供的 Python ETL 腳本：

**安全限制（沙箱）：**
- 允許匯入白名單：`pandas, numpy, math, datetime, re, json, csv, io, collections, decimal, itertools`
- 禁用屬性存取黑名單：`__class__, __bases__, __globals__, __import__, ...`（15+ 個）
- 禁用函數呼叫黑名單：`eval, exec, compile, open, __import__, ...`
- 以 `ast.parse()` 靜態分析腳本後再 `exec()`
- `__builtins__` 被剝除

| 工具名稱 | RBAC 需求 |
|----------|----------|
| `run_etl_script` | `can_etl` |
| `archive_etl_script` | `can_etl` |
| `list_etl_archives` | analyst+ |

### 5.6 排程工具（`tools/scheduler_tools.py`）

| 工具名稱 | RBAC 需求 |
|----------|----------|
| `schedule_query` | `can_schedule` |
| `list_schedules` | analyst+ |
| `delete_schedule` | `can_schedule` |

### 5.7 檔案工具（`tools/file_tools.py`）

讀寫 storage 後端（local 或 S3）上的 CSV / JSON 上傳檔案，供 ETL 工具使用。

---

## 6. 資料庫連線層（Database Layer）

### 6.1 連線池架構（`db/connector.py`）

```python
engine = create_engine(
    conn_string,
    pool_pre_ping=True,    # 使用前驗活（heartbeat）
    pool_size=5,           # 常駐連線數
    max_overflow=10,       # 峰值可超過的額外連線數（最多 15 條同時）
    pool_recycle=3600,     # 1 小時強制回收（避免 TCP 陳舊問題）
    pool_timeout=15,       # 等待連線逾時（秒）
)

# PostgreSQL 語句層級逾時（每條連線建立時即設定）
SET statement_timeout = 60000;  -- 60 秒後自動 KILL query
```

**硬性限制：** QueryMind 目前**只支援 PostgreSQL** — 若連線字串非 `postgresql://` 開頭則啟動時拋例外。

### 6.2 多連線支援（`db/registry.py`）

```
ConnectionRegistry（Thread-safe，Lock 保護）
├── register(conn_name, conn_string) → 建立並快取 DBConnector
├── get(conn_name) → 取得 DBConnector
└── list_connections() → 可用連線名稱列表

從 settings.db_connections（JSON 字串）初始化：
{
  "default": "postgresql+psycopg2://qm_user:qm_pass@host:5432/querymind",
  "analytics": "postgresql+psycopg2://...",
  "reporting": "postgresql+psycopg2://..."
}
```

每個 conn_name 對應一個獨立的 SQLAlchemy Engine（獨立連線池），使用者只能存取其 `allowed_conns` 清單內的連線。

### 6.3 Schema 快取（`db/introspect.py`）

`SchemaInspector` 對 `list_schemas / list_tables / get_ddl` 的結果做 **5 分鐘 in-process TTL 快取**，避免 `information_schema` 重複掃描（大型 DB 可能耗 5-10 秒）。

```
_cache: dict[tuple, (expires_at, value)]  ← 全域字典，Lock 保護
```

---

## 7. 持久化儲存層（Persistence Layer）

### 7.1 Metadata Database（PostgreSQL）

所有系統 metadata 儲存於同一個 PostgreSQL 實例，使用 SQLAlchemy ORM 管理：

| 資料表 | 用途 |
|--------|------|
| `qm_users` | 使用者帳戶（email, role, allowed_conns, password_hash） |
| `qm_api_keys` | API Key（SHA-256 哈希存儲，明文僅在建立時回傳一次） |
| `qm_refresh_tokens` | Refresh Token（SHA-256 哈希，revoked 旗標） |
| `qm_invitations` | 邀請連結（SHA-256 token，含過期時間） |
| `qm_audit_log` | 不可變稽核日誌（每次 agent invoke / tool call） |
| `qm_chat_messages` | 完整對話歷史（LangChain SQLChatMessageHistory） |
| `qm_session_meta` | Session 元資料（標題 / 摘要 / pin / archive） |
| `qm_schedule_records` | 排程記錄（cron 表達式 / target SQL） |
| `qm_code_metadata` | ETL 腳本元資料（storage_key 指向儲存後端） |
| `qm_user_templates` | 使用者自建問題模板 |
| `qm_saved_insights` | 已儲存的分析洞察 |
| `qm_system_config` | 系統設定 KV 儲存 |

### 7.2 Object Storage

```
adapters/storage/
├── base.py          ← BaseStorageAdapter 介面（put/get/delete/list）
├── local_adapter.py ← 本機檔案系統（開發 / 小型部署）
└── s3_adapter.py    ← AWS S3（生產部署）

storage_backend 設定決定使用哪個 adapter：
  "local" → LocalStorageAdapter(settings.local_storage_path)
  "s3"    → S3StorageAdapter(bucket, prefix, region)
```

儲存內容：ETL 腳本、上傳的 CSV/JSON 檔案、匯出的報表暫存。

### 7.3 In-Process 快取（`core/query_cache.py`）

```
TTL-based in-process cache
  Key:   SHA-256(conn_name + normalized_sql)[:24]
  Value: (expires_at_monotonic, list[dict])
  TTL:   query_cache_ttl_seconds = 120 秒

只快取 SELECT / WITH / EXPLAIN 語句
DLP 啟用時：快取儲存未脫敏原始資料，每次讀取後才套用 DLP 遮罩
多 Worker 部署注意：此快取不跨進程，需換用 Redis
```

---

## 8. 認證與授權體系（Auth & RBAC）

### 8.1 雙軌認證機制

QueryMind 同時支援兩種認證方式：

**方式一：Bearer JWT（人機互動）**
```
Login: POST /v1/auth/login
  → access_token (JWT, exp: 60 分鐘)
  → refresh_token (JWT in HttpOnly Cookie, exp: 7 天)

Token 刷新: POST /v1/auth/refresh（自動由前端 useChatStream 觸發）
  → 新 access_token + 舊 refresh_token 吊銷 + 新 refresh_token
```

**方式二：X-API-Key（機器對機器 / CI/CD）**
```
Header: X-API-Key: qm_owner_dev_key_xxxxx
  → UserService.authenticate(api_key)
  → 比對 SHA-256(api_key) vs qm_api_keys.key_hash
  → 返回對應 UserContext
```

**Fallback：Legacy JSON Key Map**（向後相容）
```
settings.api_keys_dict: {"dev-key": "admin"}
→ 映射 "admin" → "owner", "readonly" → "viewer"
```

### 8.2 JWT 結構

```json
{
  "sub": "123",              // user_id
  "email": "user@corp.com",
  "role": "analyst",
  "typ": "access",           // 或 "refresh"
  "jti": "random-uuid",      // refresh token 唯一 ID（用於吊銷）
  "exp": 1234567890,
  "iat": 1234567800
}
簽名演算法: HS256（jwt_secret from settings）
```

### 8.3 RBAC 角色模型

五個內建角色（由低到高權限）：

| 角色 | SQL 語法 | 匯出 | 排程 | ETL | 使用者管理 | DDL |
|------|----------|------|------|-----|-----------|-----|
| `viewer` | SELECT only | ✗ | ✗ | ✗ | ✗ | ✗ |
| `analyst` | SELECT + EXPLAIN | ✓ | ✓ | ✗ | ✗ | ✗ |
| `editor` | + INSERT/UPDATE/MERGE | ✓ | ✓ | ✓ | ✗ | ✗ |
| `dba` | + DELETE/CREATE/ALTER | ✓ | ✓ | ✓ | ✗ | ✓ |
| `owner` | 全部 | ✓ | ✓ | ✓ | ✓ | ✓ |

**永久禁止動詞**（所有角色包含 owner）：  
`DROP / TRUNCATE / GRANT / REVOKE / SHUTDOWN`

**viewer 角色工具白名單（顯式）：**  
`execute_query, list_tables, list_schemas, get_table_ddl, list_connections, explain_query, profile_table, column_stats, sample_rows, distinct_values, find_relations, time_range, detect_outliers, compare_periods`

**連線層存取控制：**  
每個使用者的 `allowed_conns` 欄位（逗號分隔），空值 = 允許全部連線。

### 8.4 RBAC 執行點

```
每個工具函數 → _check() / _guard_*() 呼叫以下三個斷言：
  assert_tool_allowed(user, tool_name)   — tool 白名單驗證
  assert_conn_allowed(user, conn_name)   — 連線存取驗證
  assert_sql_allowed(user, sql)          — SQL verb 驗證

違規時：
  PermissionDeniedError 被捕獲
  → 返回 {"error": "...", "denied": true} JSON
  → _audit_rbac_deny() 寫入 qm_audit_log（事件類型: rbac.denied）
  → LLM 不會重試被拒的操作
```

### 8.5 Context Variable 機制

```python
# api/context.py — contextvars（asyncio 和 thread 都安全）
_current_user: ContextVar[UserContext | None] = ContextVar('current_user', default=None)

# 每個請求進入時設定
set_current_user(user)

# 工具函數直接取用（不需傳參數）
get_current_user()
```

此設計讓工具層完全不依賴 FastAPI Request 物件，可在測試中直接設定。

---

## 9. 資安防護機制（Security Controls）

### 9.1 SQL Injection 防護

**多層防護：**

1. **SQL Verb 白名單**（`core/rbac.py`）  
   `extract_sql_verb()` 剝除 SQL 注釋後取首個詞，與角色允許列表比對。`DROP/TRUNCATE` 等永久禁止。

2. **識別符安全引號**（`tools/analysis_tools.py`）  
   `_safe_ident(name)` 驗證識別符（`re.match(r'^[A-Za-z_][A-Za-z0-9_$]*$')`），使用 `"` 包裹，防止 column/table 名稱注入。

3. **compare_periods 防注入**（`tools/analysis_tools.py`）  
   `metric_sql` 參數靜態掃描 `;` 和 `--`，拒絕含危險字符的指標表達式。

4. **SQLAlchemy 參數化**  
   所有需要傳參的內部 SQL 使用 `text(sql).bindparams()`，不做字串拼接。

5. **語句逾時**（`db/connector.py`）  
   `SET statement_timeout = 60000` 防止長時間 cartesian product 佔用連線。

### 9.2 PII / DLP 脫敏（`core/dlp.py`）

```
正規表達式遮罩（預設關閉，dlp_enabled = True 啟用）

內建 Pattern 清單：
  - email:       a***@domain.com（保留首字 + 域名）
  - phone:       <<phone>>
  - tw_id:       <<tw_id>>（台灣身分證 A123456789）
  - credit_card: <<cc>>（PAN 格式）
  - ipv4:        <<ip>>

角色豁免：dlp_role_exempt = "owner"（預設 owner 可看原始資料）

可擴展：DLP_EXTRA_PATTERNS_JSON 環境變數注入自訂 pattern
```

### 9.3 ETL 沙箱（`tools/etl_tools.py`）

```
兩階段防護：
1. 靜態分析（ast.parse）
   - 禁止屬性存取黑名單（15+ 個，防 __subclasses__ 逃逸）
   - 禁止函數呼叫黑名單（eval / exec / compile / open 等）

2. 執行階段限制
   - __builtins__ 剝除
   - 只允許 import 白名單模組（pandas, numpy, math 等）
```

**注意：** 此沙箱為「盡力防護」而非完整隔離，生產環境強烈建議以容器化隔離取代（如 gVisor / seccomp 限制的容器）。

### 9.4 API 安全

| 防護層 | 機制 |
|--------|------|
| 速率限制 | SlowAPI：chat 30/min，API 120/min（按 API key 或 IP） |
| CORS | 明確白名單（不使用 `*`，支援 credentials） |
| API Key 儲存 | SHA-256 哈希存 DB，明文只在建立時回傳一次 |
| Refresh Token 儲存 | SHA-256 哈希存 DB，HttpOnly Cookie 傳遞 |
| 密碼儲存 | bcrypt hash（`core/user_service.py`） |
| JWT 密鑰 | `jwt_secret` 從 `.env` 載入（預設值有警告） |
| 敏感設定 | 從環境變數或 `.env.local` 讀取，不 commit 進 git |

### 9.5 RBAC Deny Audit Trail

每次權限拒絕事件寫入 `qm_audit_log`：
```json
{
  "event_type": "rbac.denied",
  "api_key_prefix": "u123",
  "tool_name": "execute_query",
  "conn_name": "prod_db",
  "detail": "<SQL text>",
  "status": "denied"
}
```

### 9.6 Token 安全最佳實踐狀態評估

| 項目 | 目前狀態 | 生產建議 |
|------|----------|----------|
| `jwt_secret` 預設值 | `"change-me-in-production"` ⚠️ | 必須替換為 32+ 字元隨機字串 |
| `auth_enabled` | `False`（開發預設） ⚠️ | 生產必須設 `True` |
| `refresh_cookie_secure` | `False`（開發） | 生產設 `True`（需 HTTPS） |
| `anonymous_role` | `"owner"` ⚠️ | 生產設 `"viewer"` |
| API Key 明文 | 僅建立時回傳一次 ✓ | — |
| 密碼 | bcrypt ✓ | — |

---

## 10. 排程與背景作業（Scheduler）

### 10.1 排程架構

```
adapters/scheduler/
├── base.py                  ← BaseSchedulerAdapter 介面
├── apscheduler_adapter.py   ← in-process (預設)
└── eventbridge_adapter.py   ← 外部事件橋（可替換）
```

**APSchedulerAdapter：**
- 使用 `BackgroundScheduler`（獨立執行緒，不佔用 asyncio event loop）
- 每個 Job 執行指定的 SQL SELECT 並 INFO 記錄結果
- 排程記錄存入 `qm_schedule_records` 資料表（cron 表達式持久化）

### 10.2 Summarizer（非同步後台）

每個對話回合結束後在背景非同步執行：

```python
asyncio.create_task(
    _background_summarize(
        session_mgr, llm, session_id, body.message, ai_answer
    )
)
```

- **`generate_followups()`** — LLM 產生 3 個後續追問建議
- **`summarize_overflow()`** — 對話超過 window 時壓縮舊訊息為摘要
- **`extract_entities()`** — 提取對話中的關鍵商業實體（資料表名稱、日期、指標）
- 結果透過 `event: suggestions` SSE 推送至前端，不阻塞主回覆

---

## 11. 外部系統串接

### 11.1 LLM Provider（唯一外部服務呼叫）

```
LLMFactory
├── OpenAI API（預設）
│   端點：https://api.openai.com/v1/chat/completions
│   認證：OPENAI_API_KEY（Bearer token）
│   模型：gpt-4o（可設定）
│   stream_usage: True（串流中計算 token）
│
├── Anthropic API（可選）
│   端點：https://api.anthropic.com/v1/messages
│   認證：ANTHROPIC_API_KEY
│   模型：claude-sonnet-4-5
│
└── AWS Bedrock（可選）
    介面：boto3 Session（ap-northeast-1）
    模型：anthropic.claude-3-5-sonnet-20241022-v2:0
    認證：AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
```

**雙模型路由（可選，`llm_routing_enabled = True`）：**
- `llm_model_cheap`（如 gpt-4o-mini）：簡短問題、純查詢
- `llm_model_strong`（如 gpt-4o）：SQL 關鍵詞、複雜分析、長問題

### 11.2 目標業務資料庫（`db_connections`）

透過 `db_connections` JSON 設定，可連線到任意數量的 PostgreSQL 實例：

```json
{
  "default":   "postgresql://user:pw@host1:5432/prod_db",
  "analytics": "postgresql://user:pw@host2:5432/analytics_db",
  "reporting": "postgresql://ro_user:pw@host3:5432/reporting_db"
}
```

每個連線獨立的連線池（pool_size=5），由 `ConnectionRegistry` 統一管理。

### 11.3 Google Fonts（前端）

```html
<!-- 非功能性，僅 CJK 字型載入 -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC..." rel="stylesheet">
```

生產環境可替換為自建 font server 以避免外部依賴。

---

## 12. 設定管理（Configuration）

### 12.1 設定層次

```
優先序（高到低）：
  1. 環境變數（OPENAI_API_KEY=xxx）
  2. .env.local（本機覆寫，不 commit）
  3. .env（共用預設，可 commit）
  4. .env.production（生產設定，需加密保護）
  5. Settings 類別預設值（程式碼內）
```

pydantic-settings 的 `SettingsConfigDict` 自動合併以上來源。

### 12.2 關鍵設定分組

```
[LLM]
  openai_api_key, llm_provider, openai_model, llm_temperature
  llm_routing_enabled, llm_model_cheap, llm_model_strong

[資料庫]
  db_connections (JSON)    — 業務資料庫連線字串
  metadata_db_url          — QueryMind 系統 metadata 資料庫

[認證]
  auth_enabled             — 生產必須 True
  jwt_secret               — 必須替換的密鑰
  jwt_access_expire_minutes (60)
  jwt_refresh_expire_days  (7)
  default_owner_api_key    — 首次啟動的 owner key

[資安]
  dlp_enabled, dlp_role_exempt
  anonymous_role           — 生產設 "viewer"
  cors_origins (JSON list)

[效能]
  query_cache_enabled, query_cache_ttl_seconds (120)
  memory_window_turns (10)
  rate_limit_chat (30/minute), rate_limit_api (120/minute)

[儲存]
  storage_backend (local|s3)
  local_storage_path, aws_s3_bucket
```

---

## 13. 資料流總覽（End-to-End Data Flow）

### 13.1 完整請求生命週期

```
[Browser]
  │ 使用者輸入問題 → useChatStream.send()
  │
  ▼ POST /v1/chat
  │ Headers: Authorization: Bearer <access_token>
  │          Content-Type: application/json
  │          Accept: text/event-stream
  │
[FastAPI - SlowAPIMiddleware]
  │ 速率限制計數 (key:apikey_prefix 或 ip:x.x.x.x)
  │
[FastAPI - CORSMiddleware]
  │ Origin 驗證
  │
[FastAPI - require_user()]
  │ JWT 驗證 → decode_token() → UserContext
  │ set_current_user(user)  ← contextvars
  │
[chat.py route handler]
  │ body 解析 → session_mgr.get_messages_for_agent()
  │ 返回 StreamingResponse(event_generator())
  │
[api/streaming.py - run_agent_streaming()]
  │
  ├── detect_intent(user_message)       [core/intent.py — 純 Python]
  ├── SSE emit: event: intent
  ├── _build_stream_input() + intent plan 注入
  │
  ├── select_tier(settings, user_message) [core/router.py — 無 I/O]
  │
  ├── agent.astream_events()           [LangChain AgentExecutor]
  │   │
  │   ├── System Prompt (build_system_prompt)
  │   ├── History (session_mgr.get_messages_for_agent)
  │   │
  │   ├── [LLM] POST https://api.openai.com/v1/chat/completions
  │   │   └── SSE chunks → event: token
  │   │
  │   ├── [Tool: list_tables]           [db/introspect.py → schema cache]
  │   │   └── event: thought + observation
  │   │
  │   ├── [Tool: find_relations]        [tools/analysis_tools.py]
  │   │   └── event: thought + observation
  │   │
  │   ├── [Tool: execute_query]         [tools/db_tools.py]
  │   │   ├── assert_*() RBAC
  │   │   ├── query_cache.get()
  │   │   ├── [cache miss] DBConnector.execute() → PostgreSQL
  │   │   ├── query_cache.put()
  │   │   ├── apply_row_cap()
  │   │   ├── mask_rows() if dlp_enabled
  │   │   └── event: thought + observation
  │   │
  │   └── [LLM] 最終回答生成
  │       └── event: token (streaming)
  │
  ├── validate_sql_result()             [core/validator.py — 純 Python]
  ├── generate_insights()               [core/insights.py — 純 Python]
  ├── SSE emit: event: finish (answer + tokens + warnings + insights)
  │
  └── asyncio.create_task(_background_summarize)  ← 非阻塞
      ├── session_mgr.add_turn()        → PostgreSQL
      ├── audit_logger.log()            → PostgreSQL
      ├── generate_followups()          → LLM API
      └── SSE emit: event: suggestions

[Browser - useChatStream 消費 SSE]
  ├── intent event   → chat.store.intentPlan
  ├── token events   → 逐字顯示 streaming 答案
  ├── thought events → 顯示 Agent 推理步驟（可展開）
  ├── finish event   → 完整答案 + warnings + insights
  └── suggestions    → 後續問題 + session 標題更新
```

---

## 14. 元件相依關係圖

```
                    ┌─────────────────────────────────┐
                    │        Nuxt 3 SPA (port 3001)   │
                    │  pages/ stores/ composables/    │
                    └────────────────┬────────────────┘
                                     │ HTTPS / SSE
                    ┌────────────────▼────────────────┐
                    │     FastAPI (api/main.py)        │
                    │  Middleware Stack:               │
                    │  [SlowAPI → CORS → require_user] │
                    └────────────────┬────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
    ┌─────────▼──────┐    ┌──────────▼───────┐   ┌─────────▼──────┐
    │  core/agent.py  │    │  api/routes/*    │   │  api/auth.py   │
    │  AgentExecutor  │    │  REST endpoints  │   │  JWT / API Key │
    └─────────┬───────┘    └──────────────────┘   └────────────────┘
              │
    ┌─────────▼────────────────────────────────────────────────┐
    │  Core Modules                                             │
    │  ├── intent.py     (heuristic intent detection)          │
    │  ├── insights.py   (post-query auto insights)            │
    │  ├── validator.py  (result quality warnings)             │
    │  ├── query_cache.py (TTL in-process cache)               │
    │  ├── router.py     (LLM tier routing)                    │
    │  ├── memory.py     (session sliding window)              │
    │  ├── summarizer.py (async session summarization)         │
    │  ├── dlp.py        (PII masking)                         │
    │  ├── rbac.py       (permission model)                    │
    │  └── system_prompt.py (dynamic prompt builder)           │
    └─────────┬────────────────────────────────────────────────┘
              │
    ┌─────────▼───────────────────────────────────────────────────────┐
    │  Tools Layer (tools/)                                            │
    │  db_tools      (7) ← execute_query / explain_query / DDL...     │
    │  analysis_tools(8) ← profile / column_stats / outliers...       │
    │  viz_tools     (1) ← query_to_chart (ECharts JSON)              │
    │  export_tools  (2) ← CSV / Excel 預檢                           │
    │  etl_tools     (3) ← sandboxed Python execution                 │
    │  scheduler_tools(3)← cron schedule management                   │
    │  file_tools    (2) ← storage read/write                         │
    └─────────┬───────────────────────────────────────────────────────┘
              │
    ┌─────────▼────────────────────────────────────┐
    │  Infrastructure                               │
    │  ├── db/registry.py  (ConnectionRegistry)     │
    │  ├── db/connector.py (DBConnector + pool)     │
    │  ├── db/introspect.py (SchemaInspector + TTL) │
    │  ├── storage/metadata_db.py (ORM models)      │
    │  └── adapters/storage/* (local / S3)          │
    └─────────┬────────────────────────────────────┘
              │
    ┌─────────▼─────────────────────────────────────────┐
    │  External Systems                                   │
    │  ├── PostgreSQL (metadata_db + business DBs)       │
    │  ├── OpenAI / Anthropic / Bedrock API              │
    │  └── Filesystem / S3 (ETL archive)                 │
    └────────────────────────────────────────────────────┘
```

---

## 15. 已知限制與生產上線建議

### 15.1 水平擴展限制

| 元件 | 現況 | 生產建議 |
|------|------|----------|
| Query Cache | In-process dict（不跨進程） | 替換為 Redis（同 API）|
| Schema Cache | In-process dict（`db/introspect.py`） | 替換為 Redis |
| APScheduler | BackgroundScheduler（單進程） | 改用 Celery Beat 或外部排程 |
| ETL 沙箱 | exec 在同進程（風險） | 獨立容器 / Subprocess 隔離 |
| Session Memory | 每個 API 進程各自 SQLAlchemy engine | 單資料庫可水平擴展（Pgpool / PgBouncer）|

### 15.2 資安補強優先清單

1. **`jwt_secret` 必須替換**（`change-me-in-production`）— 最高優先
2. **`auth_enabled = True`** — 生產必設
3. **`anonymous_role = "viewer"`** — 防未驗證使用者取 owner 權限
4. **`refresh_cookie_secure = True`** — 需 HTTPS（Nginx/ALB 終止 TLS）
5. **CORS origins 精確設定** — 不應保留 `localhost` 在生產
6. **DLP 評估** — `dlp_enabled = True` 若業務資料含 PII
7. **ETL 工具隔離** — 若開放 `can_etl` 給非信任使用者，需容器化隔離
8. **API Key 輪換機制** — 實作 `POST /v1/admin/api-keys/{id}/rotate`
9. **Audit Log 不可竄改** — PostgreSQL Row-Level Security 或外部 SIEM 導出
10. **`default_owner_api_key` 替換** — `qm_owner_dev_key_change_me` 不能用於生產

### 15.3 效能調優建議

| 項目 | 當前設定 | 建議 |
|------|---------|------|
| DB 連線池 | pool_size=5, max_overflow=10 | 依並行量調整 |
| Statement Timeout | 60s | 依業務 SLA 調整 |
| Query Cache TTL | 120s | 對即時性要求高的資料表設 0 |
| Memory Window | 10 回合 | 長對話可降至 5 減少 token 消耗 |
| Schema Cache TTL | 5 分鐘 | DDL 頻繁變更時可縮短 |
| LLM Routing | 關閉 | 開啟可降低 30-50% LLM 費用 |

### 15.4 監控觀測點

| 指標 | 來源 |
|------|------|
| LLM Token 消耗 / 費用 | `qm_audit_log.total_tokens, model_name` |
| 工具呼叫頻率 / 錯誤率 | `qm_audit_log.tool_name, status` |
| RBAC 拒絕事件 | `qm_audit_log WHERE event_type = 'rbac.denied'` |
| Query Cache 命中率 | `GET /v1/admin/cache/stats` |
| 使用者活躍度 | `qm_chat_messages.created_at GROUP BY user_id` |
| 排程執行結果 | APScheduler 日誌 + `qm_schedule_records` |

---

*文件結束。本文件僅描述現有架構，不含任何雲端服務或基礎建設規格。*
