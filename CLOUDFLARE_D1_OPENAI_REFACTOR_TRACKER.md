# QueryMind Cloudflare D1 + OpenAI 重構追蹤表

> 2026-08-13 更新：已完成產品化 UI、權限與安全邊界、Free-plan 防耗盡、68 項回歸測試與可重現 CI，並部署 Version `41b9e718-69e6-41d6-86a4-8a4e763e65e7`。依本輪指示明確排除遠端 D1 備份／migration（第 6 項）；AI Gateway BYOK 帳戶設定因 Wrangler OAuth 對 Gateway API 回 `10000 Authentication error`，維持為唯一外部 gate。

## 2026-08-13：產品上線 hardening

| ID | 階段 | 狀態 | 本次已完成的內容 | 驗證／狀況 |
|---|---|---|---|---|
| P10 | 產品化 UI/UX 與功能一致性 | Done | 重構桌面／手機視覺系統；所有實際前端 class 完整覆蓋；MENU 改由 capability 決定；回補 Owner 帳號復原、首次 bootstrap、邀請 fragment-only 流程；修正單一 `main` landmark 與行動版 overflow。 | Playwright 桌面／390px 手機檢查通過，無 console/page error；session 操作改為持續可見，避免 hover-only 控制。 |
| P11 | Security 與 Free-plan hardening | Done | DLP 在執行前拒絕敏感 predicate/group/order/nested/compound/NATURAL/positional/wildcard 推論；禁止 recursive CTE 與高風險結果放大函式；API key 禁止 browser/admin；peppered PBKDF2 與密碼版本 JWT；邀請原子 claim；雙 Owner 競態保護；query/export/session/global/login 限流；CSV 公式注入防護；2 MB response cap、25-row/32 KB preview、AI 30 秒 timeout/800 token cap；每日 CAS、小批次 90/180 天 retention；schema 批次與 FK context。 | `npm run typecheck` 通過；security unit 56/56；產品／RBAC E2E 12/12，共 68 項。新 KDF 本機 median 3.75 ms；舊 100k 帳號應由 Owner 重設。 |
| P12 | 可重現 release gate | Done | 新增 disposable local D1 初始化（只套 0001–0004）、統一 port、完整 E2E CI、Wrangler required secrets、穩定 env types、deploy dry-run 與 production runbook。 | Fresh-clone gate 已納入 bootstrap、browser cookie login、schema refresh、E2E；不含任何 remote D1 命令。 |
| P13 | AI Gateway BYOK 帳戶設定 | Blocked | 程式端 Gateway host/path allowlist、BYOK alias header、Gateway auth token、模型 allowlist、Worker rate limits均已就緒；既有 OpenAI key 只被確認存在，未輸出／入版。 | Wrangler OAuth 可讀帳戶且有 `ai:write`，但 Gateway REST API 實測 403/code 10000。需 Dashboard 或最小權限 Cloudflare API Token 才能建立 authenticated Gateway、provider alias、spend/rate limit。 |
| P14 | Hardened preview 發版 | Done | 已部署 `preview + AI mock` 供完整前端/RBAC驗收；待 P13 完成後才切 `production + real OpenAI`。 | 2026-08-13 Version `41b9e718-69e6-41d6-86a4-8a4e763e65e7`；遠端 health 200，D1 data/app=`ok`，CSP/HSTS/frame deny 正常，anonymous admin=401，URL invitation token=404；未執行遠端 D1 write/migration。最後僅做 password algorithm 彙總唯讀檢查：1 個 `hmac-sha256-v1` 帳號、`rows_written=0`、`changed_db=false`，登入時可安全漸進升級。 |

> 2026-08-12 更新：P8「產品模組與 RBAC 回補」與 P9「遠端部署與復原點」已完成。線上版本：`bea2a78a-0711-4792-85c3-8ffa56030354`。

## 2026-08-12：產品模組與 RBAC 回補

| ID | 階段 | 狀態 | 本次已完成的內容 | 驗證 |
|---|---|---|---|---|
| P8 | 產品模組與 RBAC 回補 | Done | 新增 Viewer、Analyst、Editor、DBA、Owner 五個角色，還原首頁、AI 對話、資料綱要、資料字典、查詢範本、我的洞察、我的用量、使用者、角色、邀請、資料來源、稽核與系統設定。使用者、邀請、角色、API Key、字典、範本與洞察均具 Worker 端權限檢查與 audit。 | 本機 D1 migration、TypeScript typecheck、15 項 Playwright（Owner 完整流程、Viewer 拒絕管理/匯出、SQL/Gateway 安全）均通過；桌面與行動版畫面已檢視。 |
| P9 | 遠端部署與復原點 | Done | 遠端 `querymind-app` 已套用 `0004_restore_product_modules.sql`；部署前已匯出 `querymind-app` 與 `querymind-data` 至本機 `backups/cloudflare-pre-rbac-20260812-2132/`。Worker 已部署為 Version `bea2a78a-0711-4792-85c3-8ffa56030354`。 | 線上 `/health` 回傳 200、兩個 D1 為 `ok`、靜態前端已回傳新版資產，並保有 CSP/HSTS。 |

### 上線後狀態

- 網址：<https://querymind.digitalaaronl.workers.dev>
- 目前仍為 `preview + AI mock`，因此可完整驗證 UI、RBAC、D1 與對話流程，但尚未消耗 OpenAI 額度。
- 正式 OpenAI 啟用前，仍需設定 AI Gateway BYOK 的 Gateway URL、alias/token 與 spend limit；之後將 `ENVIRONMENT=production`、`AI_MOCK_MODE=false` 後進行一次真實模型驗收。

## 已確認的目標

- Cloudflare Workers Free：單一同源網站與 API。
- Cloudflare D1：重構後的業務資料與 QueryMind application metadata。
- OpenAI API：保留 Chat Completions、streaming 與 tool-calling 的整合概念。
- Cloudflare AI Gateway BYOK：保存 OpenAI key，並套用 rate limit 與 spend limit。
- 單一資料庫、全表可讀、只允許 `SELECT` / `WITH`；不保留表級權限、多 connection、ETL 或排程。

## 進度規則

| 狀態 | 定義 |
|---|---|
| Not started | 尚未開始 |
| In progress | 正在開發或驗證 |
| Blocked | 需要決策、帳號權限或外部資源 |
| Done | 已完成且符合驗收條件 |

每次開發完成一個可驗證成果時，更新下表的狀態、日期與備註；不要把未驗證的工作標記為 Done。

## 工作切割與追蹤

| ID | 階段 | 主要交付物 | 驗收條件 | 狀態 | 備註 |
|---|---|---|---|---|---|
| P0 | 架構定案 | 範圍、免費額度邊界、移除功能清單 | 本文件「已確認的目標」獲確認 | Done | 2026-08-10 已確認 Cloudflare Free + D1 + OpenAI API + AI Gateway BYOK |
| P1 | Cloudflare 專案骨架 | Worker、靜態資產入口、Wrangler 設定、local dev 流程 | 可在本機啟動，並回傳 `/health` | Done | 2026-08-11：`npm run check` 通過；Wrangler 本機 D1 載入成功，`GET /health` 實測為 200。Windows 中文父目錄下 Wrangler/esbuild 需以 ASCII 磁碟映射啟動，正式 Cloudflare 不受影響。 |
| P2 | D1 資料重構與遷移 | SQLite/D1 schema、PostgreSQL-to-SQLite 資料轉換、migration 與 seed | demo 資料可完整匯入；關鍵查詢結果與舊版一致 | In progress | 2026-08-12：兩個 APAC D1 已建立，所有 migration 與 demo seed 已遠端套用；驗證值為客戶 3、有效訂單 3、銷售額 48,740。CSV 匯出／轉換工具已完成；尚待 PostgreSQL 正式匯出檔做實際資料比對。 |
| P3 | 核心 API 與資料安全 | 唯讀 SQL validator、row cap、DLP、簡化登入/JWT、session 與 audit | 不可執行寫入 SQL；登入後可查詢並保留歷史 | Done | 2026-08-11：登入、JWT 驗證、session 建立、帶 session 唯讀查詢、訊息歷程均已本機端對端驗證。SQL 僅允許 SELECT/WITH，結果限制 500 列並套用 column policy 遮罩；query/audit 已留存。 |
| P4 | Schema-aware OpenAI Agent | schema catalog refresh、SQLite schema context、OpenAI tool-call loop、SSE 回覆 | AI 能從自然語言生成正確 SQLite SELECT 並回傳可讀答案 | In progress | 2026-08-12：完整雙階段 tool-call loop、SSE、SQL 再驗證、遮罩、usage/audit 已完成；遠端預覽以 AI mock 提供前端全流程驗收。尚待 AI Gateway BYOK 後做真實 OpenAI 驗收。 |
| P5 | AI Gateway BYOK 與成本防護 | BYOK key、模型 allowlist、全域/每使用者 rate 與 spend limits、request trace | 金鑰不在 repo/瀏覽器；超額請求被拒絕且可追查 | In progress | 2026-08-12：Worker 已有模型 allowlist、每使用者每小時 20 次、全域每日 200 次、prompt 上限、usage/audit 與 Gateway host/path allowlist；production secrets 已隔離。尚待建立 Gateway、BYOK alias/token 與 Dashboard spend limit。 |
| P6 | 前端功能遷移 | 聊天、schema 狀態、session history、表格/圖表、CSV export、error UX | 使用者可在單一網址完成完整唯讀分析流程 | Done | 2026-08-12：登入／首次建立管理者、session、SSE chat、Schema drawer、表格／圖表、CSV、用量與 error UX 完成；Playwright 桌面 1440×1000、手機 390×844 全流程通過且 console 無錯誤。 |
| P7 | 測試、上線與維運 | migration rehearsal、Agent SQL eval、security test、usage alert、production deploy runbook | 自訂網域或 `workers.dev` URL 可 24/7 使用；監控與回復流程完成 | In progress | 2026-08-12：`querymind.digitalaaronl.workers.dev` 已部署（Version `0a15c0ab-86fe-455a-9244-36359822a5a8`）；health、CSP/HSTS、D1 遠端值與正式登入頁均通過。現為 `preview + AI mock` 供前端驗收，尚待真實 AI、正式資料與 production 切換。 |

## 目前線上驗證環境

- 網址：<https://querymind.digitalaaronl.workers.dev>
- 模式：Cloudflare Worker preview + 遠端 D1 + AI mock（不消耗 OpenAI 額度）。
- D1：`querymind-data` 與 `querymind-app`，均位於 APAC。
- 安全：HTTPS cookie、CSP、HSTS、frame deny、唯讀 SQL validator、row cap、DLP、登入與 AI rate limit。
- 驗收後切換：補 AI Gateway URL／BYOK alias／Gateway token，將 `ENVIRONMENT` 改為 `production`、`AI_MOCK_MODE` 改為 `false` 後重新部署。

## 必要的外部設定

| 項目 | 用途 | 負責時點 |
|---|---|---|
| Cloudflare 帳號 | Workers、D1、AI Gateway、網址 | P1 前 |
| OpenAI Project API key | QueryMind 的模型調用 | P5 前 |
| AI Gateway BYOK 權限 | 將 OpenAI key 存入 Secrets Store | P5 |
| 網域（可選） | 品牌網址；否則使用 `*.workers.dev` | P7 前 |

## 不在本次重構範圍

- Python ETL、任意程式執行與排程。
- PostgreSQL runtime、SQLAlchemy、FastAPI、LangChain runtime。
- 多資料庫 connection 管理與資料表/欄位級存取控制。
- 大型 XLSX 伺服器端匯入與匯出。

## 2026-08-21: P0 governed query safety core

| ID | Status | Delivered | Verification / blocker |
|---|---|---|---|
| P0-GQSC | Preview deployed — production AI gate pending | SDD; forward-only app migration `0006_governed_query_safety.sql`; EffectiveScope and deny-by-default table/column/row policies; centralized QueryPolicyEngine for chat/direct/saved insight/export/schema; model egress credential redaction; production fail-closed runtime gate; DLP migration included in local test bootstrap; regression tests. | Local quality gates passed; remote app `0005–0007` applied; policy state `0006` healthy with 72 active policies; Worker version `2ff7a151-b9a7-4656-9c76-6621b8903c56` deployed and preview smoke passed. Production remains gated until AI Gateway BYOK URL/alias/token is configured and `AI_MOCK_MODE=false`. See `docs/releases/p0-governed-query-safety-core-release.md`. |
## 2026-08-21: P1 explainable query experience

| ID | Status | Delivered | Verification / blocker |
|---|---|---|---|
| P1-EQE | Preview deployed — production AI gate pending | Added P1 SDD/release report; additive app migration `0007_explainable_query_experience.sql`; deterministic QueryExplainability for chat/direct query; capability-gated SQL disclosure; authenticated owner-only idempotent feedback with audit; compact SPA cards and mobile-safe feedback UI; P1 tests. | TypeScript/check PASS; P0 security 62/62; P1 tests 4/4; local D1 0001–0007 and desktop/mobile UI smoke PASS without console errors. Remote `0007` applied and the current bundle is deployed in preview mode; production AI activation remains gated on AI Gateway BYOK. |
Additional P1 verification: existing product/RBAC E2E passed 12/12 with local Chromium channel; original menu, module, RBAC and mobile shell flows remain green.
