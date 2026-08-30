# QueryMind Cloudflare D1 + OpenAI 重構追蹤表

## 2026-08-30: P2-E human approval & publication governance

| ID | Status | Delivered | Verification / current state |
|---|---|---|---|
| GAP-032 | Fixed - test-only | Namespaced the human-reviewed P2-D suggestion fixture with its generation run ID. Production semantic uniqueness and governance paths remain unchanged. Forensic evidence: `docs/releases/gap-032-root-cause.md`. | Retained-D1 P2-D API rerun 2/2 PASS; fresh isolated clone `npm ci`, APP 0001-0011/DATA 0001 init, full 117/117, Worker dry-run, and GitHub Actions run `33291766401` (both jobs) PASS. |
| P2-D-CLOSEOUT | Pending manual session | Public production `/` and `/health` smoke PASS; anonymous protected requests fail closed. No production semantic mutation was performed. | Worker `0adc14e9-6e86-4bbf-93bf-fe476c8f20e4`, rollback `5c55b16b-4a02-4fb4-8906-687f1b6387ab`; authenticated Owner/DBA smoke is `NOT EXECUTED / HUMAN SESSION REQUIRED`; manual closeout remains PENDING. |
| P2-E | In progress — local release gates green | Additive APP migration `0012`; explicit human RACI and separate policy configuration; fail-closed approval readiness; deterministic schema/catalog/dependency/alias/relationship checks after EffectiveScope; SoD/quorum and idempotency; atomic D1 normal and emergency publication; immutable audit/history; runtime suspension/resume and post-review; capability-gated Semantic Registry approval UI. No P2-F runtime semantic injection and no production semantic data were created. | Fresh local APP 0001–0012/DATA 0001 init PASS; typecheck, frontend syntax, migration immutability and P2-E API 2/2 PASS; complete P0–P2-E suite 119/119 PASS. GitHub/fresh-clone/CI and remote migration/deploy/smoke remain pending. |

## 2026-08-28: P1.2 Feedback & Trust Experience

| ID | Status | Delivered | Verification / current state |
|---|---|---|---|
| P1.2 | Complete — deployed | Structured query-run-linked feedback capture is implemented as additive APP migration `0011`; P1 compatibility, deterministic evidence target validation, bounded correction text, retry-safe progressive disclosure, inline evidence actions, and audit metadata boundaries are covered in code/tests. No AI, SQL execution, semantic mutation, or P2-D suggestion mutation is introduced. | Worker `0adc14e9-6e86-4bbf-93bf-fe476c8f20e4`; rollback `5c55b16b-4a02-4fb4-8906-687f1b6387ab`; remote APP 0011 applied and no migrations remain. `/` and `/health` 200 (production/AI ready/D1/P0 policy 72); anonymous schema/semantics/feedback 401. Unit 97/97, product/RBAC E2E 20/20, and repaired integrated `test:all` 117/117 PASS. Authenticated production UX remains `NOT_EXECUTED_BY_DESIGN`; P2-D manual closeout remains PENDING. |

## 2026-08-27: R14 Post-P2-D source-of-truth and reproducibility hardening

| ID | Status | Delivered | Verification / current state |
|---|---|---|---|
| R14 | Complete | Reconciled the production-aligned P0–P2-D source into Git, synchronized GitHub `main`, and created immutable baseline tag `querymind-p2d-baseline-2026-08`; the post-deployment closeout is recorded by follow-up tag `querymind-p2d-baseline-2026-08-r1`. Release hardening includes checkout-independent immutable migration validation, machine-readable manifest, fail-closed production preflight/deploy/smoke helpers, clean-room CI alignment, architecture/handover/runbook/observability/RACI docs, explicit legacy marking, and cross-platform LF contracts for release-critical artifacts. | Current Worker `5c55b16b-4a02-4fb4-8906-687f1b6387ab`; immediate rollback `31693496-e2b8-4110-92d6-40f61035f182`; APP `0001`–`0010`, DATA `0001`, schema snapshot `9fc08cbf8ee017c5f6041f7eaa6b7a0b0411b185f4d7e503e0ca47ecdc3b49d3`, P0 policy `p0-governed-query-safety-core-v1`/72. Latest clean-clone proof: `npm ci` (0 vulnerabilities), check PASS, migrations/manifest PASS, disposable D1 init PASS, full 113/113 PASS, clean worktree; local unit 94/94 and product/RBAC E2E 19/19 PASS; GitHub Actions run `33149826255` PASS; production bundle 292.54 KiB/gzip 63.58 KiB, deploy and public smoke PASS. No remote D1 write, migration, secret read/change, or production semantic mutation occurred. P0, P1, P1.1, P2-A, P2-B and P2-C remain protected; P2-D code/deployment is COMPLETE while its authenticated manual production mutation closeout remains PENDING and continues to block P2-E. |

## 2026-08-24: P2-D AI Schema Intelligence Draft Suggestions

| ID | Status | Delivered | Verification / current state |
|---|---|---|---|
| P2-D | Deployed — production AI smoke pending | Adds a separate, immutable design-time `semantic_suggestion_runs` / `semantic_suggestions` domain through forward-only app migration `0010`; bounded selected authorized metadata, deterministic candidates, versioned Cloudflare AI Gateway structured output validation, owner-scoped suggestion APIs, audit provenance, and an existing-Semantic-Repository accept-as-Draft flow. The Semantic Registry gains a separate capability-gated AI Suggestions workspace. P2-D cannot approve/publish/authorize/execute SQL or enter runtime semantic context. Current Worker `5c55b16b-4a02-4fb4-8906-687f1b6387ab` re-releases the verified P2-D runtime; original P2-D Worker `31693496-e2b8-4110-92d6-40f61035f182` is the immediate rollback; migration 0010 remains applied exactly once. | All local gates PASS: check; unit 94/94; E2E 19/19; fresh app 0001–0010/data 0001 init; full 113/113; frontend syntax; diff; and 292.54 KiB/gzip 63.58 KiB dry-run. Remote list has no pending app migration. `/` and `/health` are 200; health is production/AI ready/both D1 ok/P0 72; anonymous suggestions is 401. Read-only D1 retains snapshot `9fc08cbf8ee017c5f6041f7eaa6b7a0b0411b185f4d7e503e0ca47ecdc3b49d3`, registry 0, semantic 0/0/0, and suggestion runs/open/accepted/dismissed 0/0/0/0 with `rows_written=0`. A transient preview/mock upload and then an unquoted model-allowlist correction were detected by read-only health/version inspection and immediately replaced before AI or semantic mutation; final quoted production vars match the known-good version and secrets were not read or changed. Owner/DBA must still manually generate ≤3 TERM/DIMENSION suggestions from `products` and run the existing P1 chat regression; no production suggestion or Draft was created automatically. |

## 2026-08-24: P2-C closeout verified-SQL visibility hotfix

| ID | Status | Delivered | Verification / current state |
|---|---|---|---|
| P2-C-R | Deployed — authenticated visual confirmation pending | P1’s authorized, non-empty verified SQL remains capability-gated, but its native disclosure now defaults to open so the query is immediately visible instead of presenting only the closed summary. The Worker/data path, Explainability payload, QueryPolicyEngine, EffectiveScope, DLP, feedback, Semantic Registry APIs/UI and all migrations are unchanged. Worker `5e4ca4b6-8ba1-4259-b2ea-25e6dc9bbfaa` was deployed with the same no-preview-vars process and `--keep-vars`; only `app.js` was uploaded. | Evidence-first production inspection confirmed matching Owner runs have `rawSqlAvailable=true` and a non-empty Explainability SQL value; the issue was display-state only, not data loss or authorization failure. `npm run check`, unit 87/87, E2E 17/17, disposable app 0001–0009/data 0001, full 104/104, `node --check`, diff check and production-safe dry-run all PASS. Production `/` is 200, health is production/AI ready/both D1 ok/P0 72, anonymous semantics is 401, and the served `app.js` contains the open authorized disclosure. Read-only D1 post-check retains registry 0 and semantic assets/revisions/reviews 0 with `rows_written=0`; no migration, semantic asset, role, policy, secret, variable or Gateway setting changed. |

> 2026-08-13 更新：已完成產品化 UI、權限與安全邊界、Free-plan 防耗盡、68 項回歸測試與可重現 CI，並部署 Version `41b9e718-69e6-41d6-86a4-8a4e763e65e7`。依本輪指示明確排除遠端 D1 備份／migration（第 6 項）；AI Gateway BYOK 帳戶設定因 Wrangler OAuth 對 Gateway API 回 `10000 Authentication error`，維持為唯一外部 gate。

## 2026-08-24：P2-B semantic governance API

| ID | 階段 | 狀態 | 主要交付物 | 驗證／狀況 |
|---|---|---|---|---|
| P2-B | Governed Semantic Design-time APIs + Audit | Blocked | 已加入 `view_semantics`、`manage_semantic_drafts`、`review_semantics`；bounded list/detail/create/revision/edit/submit/request-changes/reject/review APIs；browser-session-only mutation；catalog snapshot/source validation；allowlisted audit；remote app migrations `0008`/`0009` 已套用；Worker 尚未上傳。 | Local gate：check PASS、unit 83/83、e2e 13/13、all 96/96、db init 0001–0009、dry-run 226.29 KiB / gzip 49.75 KiB。Remote identity/targets/precheck、0008/0009、semantic tables、registry、capabilities 與 P0 policy 均通過；`schema_snapshot_id` 仍為 `uninitialized`，需既有 Owner/DBA schema refresh，依 runbook 停在 deploy 前。無 QUERYMIND_DATA、secret、Gateway 或 config 變更；P2-C 尚未開始。 |

## 2026-08-24：P2-B dark deployment resume

| ID | 階段 | 狀態 | 主要交付物 | 驗證／狀況 |
|---|---|---|---|---|
| P2-B-R | Bootstrap Worker → Schema Refresh → Production Smoke | Blocked | 已修補 `uninitialized` snapshot fail-closed guard；部署 Worker version `cb57cd57-98b0-4fc3-a9f8-ad90f26b7500`；以不含 preview vars 的暫存 config + `--keep-vars` 保留 production config；未修改 secrets、Gateway、bindings 或 D1 migration。 | Local check PASS、unit 84/84、e2e 13/13、fresh full 97/97、dry-run PASS。Production `/` 200、`/health` 200（production/AI ready/D1/P0 healthy）、anonymous chat/query/semantics 401、approve/deprecate 404。待 Owner/DBA authenticated schema refresh；目前 snapshot 仍 `uninitialized`，兩次 deterministic refresh、authorized semantic GET、authenticated P0/P1 smoke 為 MANUAL REQUIRED；P2-C 尚未開始。 |

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

## 2026-08-24: P2-C Semantic Registry UI

| ID | Status | Delivered | Verification / current state |
|---|---|---|---|
| P2-C | Deployed — authenticated smoke pending | Existing static SPA gains capability-gated Semantic Registry list/filter/page/detail/history/review views and bounded DRAFT authoring for TERM, DIMENSION, METRIC and RELATIONSHIP. It uses only P2-B APIs, retains browser-session-only mutation, has no approval/deprecation/AI/runtime semantic behavior, and adds no migration. A minimal revision-history query fix removes an invalid selected column from the existing P2-B API. Worker `864ea69d-fee6-4f68-8ec6-fefa8c1c4770` was deployed with a no-preview-vars temporary configuration and `--keep-vars`; only static assets and Worker code were uploaded. | Local gates: check PASS; unit 87/87; E2E 17/17 (including a view-only `view_semantics` fixture with forced POST 403); disposable app migrations 0001–0009/data 0001 PASS; full 104/104; `app.js` syntax and diff checks PASS; production-safe dry-run 226.68 KiB / gzip 49.85 KiB PASS. Production `/`/`health` are 200 (production, AI ready, both D1 ok, P0 72); anonymous semantics is 401. Remote read-only D1: snapshot `9fc08cbf8ee017c5f6041f7eaa6b7a0b0411b185f4d7e503e0ca47ecdc3b49d3`, registry 0, assets/revisions/reviews 0, `rows_written=0`. Existing Owner/DBA UI/GET and P1 chat smoke are manual-required; no production D1 write is planned. |

## 2026-08-24：P2-B final production verification

| ID | 階段 | 狀態 | 主要交付物 | 驗證／狀況 |
|---|---|---|---|---|
| P2-B-F | Final schema snapshot + authenticated smoke + baseline closeout | Blocked | 已完成遠端 `schema_catalog_state` 初始化核對、catalog/policy/dark-state/production health 只讀驗證；目前 Worker `cb57cd57-98b0-4fc3-a9f8-ad90f26b7500` 保持運行，未變更 secrets、vars、Gateway、migration 或 `querymind-data`。 | Snapshot `9fc08cbf8ee017c5f6041f7eaa6b7a0b0411b185f4d7e503e0ca47ecdc3b49d3`、14 tables、115 columns、17 FKs；P0 `0006`/72 policies/7 scopes healthy；registry version 0、semantic assets/revisions/reviews 皆 0；app migrations 0001–0009 applied，data 無 pending；`/` 200、`/health` 200、匿名 semantics/chat/query 401。Owner/DBA 回報已完成兩次不變 Schema Refresh，但 D1 僅保留最後狀態，兩個歷史 ID 無法由本次只讀查詢獨立重建；authenticated semantic GET 與 chat/query/EffectiveScope/unauthorized/prompt-injection/P1 explainability/feedback production smoke 為 MANUAL REQUIRED。Local check PASS、unit 84/84、db init 0001–0009 PASS、fresh full 97/97；P2-C 未開始。 |

## 2026-08-24：P1.1 production regression hotfix

| ID | 階段 | 狀態 | 主要交付物 | 驗證／狀況 |
|---|---|---|---|---|
| P1.1-R | Explainability provenance + empty SQL rendering | Deployed; P2-B closeout blocked only by authenticated manual smoke | 修正 display-only relation alias extractor 不得將 `JOIN` 視為隱含 alias，讓 `GROUP BY products.name` 正確產出 `product`；維持後端/前端空白 SQL 不揭露；確認 `NameTotal Revenue` 為相鄰 `<th>` 文字擷取，非視覺 bug。Worker-only 發布 `02d5aecc-48cb-4ab1-8819-484f5f55de8d`，以 no-preview-vars 暫存設定與 `--keep-vars` 保留 production Gateway、vars、4 個 secrets、D1 bindings；無 migration。 | Local check PASS、unit 86/86、e2e 14/14、app/data D1 0001–0009、full 100/100、frontend syntax/diff/dry-run PASS。Production `/`/`health` 200、anonymous chat/query/semantics 401；snapshot `9fc08…b49d3`、catalog 14/115/17、P0 72/7、registry 0、semantic 0/0/0，兩 D1 migration streams 無 pending。仍需 Owner/DBA 重跑 grouped chat、direct-query、policy denial/injection、feedback 與 authenticated empty semantics 才可關閉 P2-B；P2-C 未開始。 |
