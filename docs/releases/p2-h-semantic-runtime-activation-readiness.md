# QueryMind P2-H — Semantic Runtime 啟用準備度發布報告

## 1. Baseline

* Git SHA：`9b454577e1afcc759f37f5109c5a87a275198a41`。
* Worker：`querymind`，網址 `https://querymind.digitalaaronl.workers.dev`；本次 production version 為 `1e9dd6e7-949e-45e0-aa39-d6fc4285e2b6`。
* Migration：APP `0001`–`0012`、DATA `0001`；P2-H 沒有新增 migration。
* Registry：production 基線版本 `0`；semantic assets、revisions、reviews、publications、approvals、authorities 皆為 `0`。
* Feature flag：production `SEMANTIC_RUNTIME_CONTEXT_ENABLED=false`，必須維持關閉。

## 2. SQL Safety Envelope

* 支援：受限唯讀 `SELECT`、非遞迴 `WITH`、明確 JOIN、alias、受限聚合、分組、排序與 row limit。
* 拒絕：寫入／DDL／PRAGMA、註解、分號、遞迴 CTE、逗號來源、CROSS／NATURAL JOIN、未授權來源／欄位、不安全 wildcard，以及無法證明安全或會放大結果的語法。
* 未證明：目前是 bounded tokenizer，不是完整 SQLite parser；不支援的 dialect 與模糊 lineage 一律 fail-closed。
* 新增回歸案例：adversarial alias、CTE／subquery、UNION、quoted identifier／function、comments 均仍通過 P0 policy boundary。

## 3. D1 Runtime Constraints

* 相關限制：prepared D1 read、受限 APP metadata batch、應用層 SQL／token／source 上限、row cap、2 MB API 結果上限、32 KB／25-row 儲存 preview、AI timeout。
* 應用層緩解：QueryPolicyEngine 授權、EffectiveScope／catalog 過濾、DLP、result budget、rate limit 與明確唯讀 statement。
* 不可假設：沒有任意 D1 per-statement cancellation、沒有全域 semantic activation lock，也不宣稱 parser 完整性。

## 4. P2-H Readiness Architecture

* Service／API：唯讀 `GET /api/v1/admin/semantic-runtime/readiness`，由 `view_semantics` capability gate；Semantic Registry UI 顯示相同 bounded 結果。
* Deterministic checks：runtime capability／flag、policy state、registry version、schema snapshot、approved eligible assets、source／catalog 相容性、pinned dependency 完整性與 cycle、APP／DATA 結構、P2-G evidence contract。
* Readiness service 不呼叫 LLM、不讀 business rows、不把 readiness 寫入 D1，也不授予任何授權。

## 5. Platform Readiness

Disposable readiness fixtures、production health／D1 結構核對與本次 Worker deployment 均為 `PASS`。

## 6. Semantic Content Readiness

目前 production registry 的結果為 `NOT_READY — NO APPROVED SEMANTIC`，這是預期的安全結果。Draft、suspended revision、stale snapshot、缺少 source 或 broken dependency 都不得算作 ready。

## 7. Operator Readiness

* Authenticated production readiness smoke：`NOT EXECUTED`；本次沒有提供 production Owner／DBA session。
* Governance access：endpoint 只讀且要求 `view_semantics`，不能 approve、publish、suspend 或 resume semantic content。

## 8. Release Readiness

* Static checks：`npm run check`、`node --check public/app.js`、`git diff --check` 通過。
* Fresh clone：完成 `npm ci`、disposable APP `0001`–`0012`／DATA `0001` 初始化、typecheck、targeted P0／P2-F／P2-G／P2-H `79/79` 與 production dry-run。
* CI：`33461359347` 的 Cloudflare runtime 與 legacy regression jobs 均 `success`；unit `114/114`、E2E `22/22`、full `136/136`。
* Rollback：production 前一版 Worker `2ae1d74d-db8f-4acf-84be-bc863d89ba48`。

## 9. TRUE Semantic Path Test

Disposable environment 的要求已編入 CI fixture：

* flag true；
* 透過 human governance 核准並選取 Semantic；
* Chat 的 SQL 仍經既有 P0 boundary；
* 成功 run 儲存該 asset／revision 的 P2-G `USED` evidence。

CI disposable D1 已完成核准 Semantic → Chat → P0 QueryPolicyEngine → D1 → P2-G `USED` evidence；沒有建立 production semantic content。

## 10. Security

`SEMANTIC ACTIVATION DOES NOT EXPAND AUTHORIZATION = PASS`

`QUERY POLICY ENGINE REMAINS FINAL AUTHORITY = PASS`

`P2-G EVIDENCE REMAINS OBSERVATIONAL = PASS`

## 11. Tests

目前可核對結果：typecheck `PASS`、unit `114/114 PASS`、E2E `22/22 PASS`、full `136/136 PASS`、fresh-clone targeted `79/79 PASS`、dry-run `PASS`、CI `33461359347 PASS`。

`FULL REGRESSION GREEN = YES`

## 12. Production Deployment

* Worker：`1e9dd6e7-949e-45e0-aa39-d6fc4285e2b6`。
* Previous Worker：`2ae1d74d-db8f-4acf-84be-bc863d89ba48`。
* Migration status：沒有執行 migration；production 仍是 APP `0001`–`0012`、DATA `0001`。
* Flag value：`false`；部署使用 `--keep-vars`，沒有變更 vars、secrets、Gateway 設定、D1 binding 或資料。

## 13. Production Readiness Result

```text
Platform Readiness = PASS
Semantic Content Readiness = NOT_READY — NO_APPROVED_SEMANTIC
Operator Readiness = NOT EXECUTED — AUTHENTICATED OPERATOR SMOKE REQUIRED
Activation Status = DISABLED
```

## 14. Semantic Registry Post-State

Production remote D1 只讀結果：`registry_version=0`；`semantic_assets=0`；`semantic_revisions=0`；`semantic_reviews=0`；`semantic_publications=0`；`semantic_approval_decisions=0`；`semantic_authorities=0`；active P0 policies `72`；APP migration `0001`–`0012`；DATA migration `0001`；兩次查詢 `rows_written=0`。

## 15. Rollback

* Worker rollback target：`2ae1d74d-db8f-4acf-84be-bc863d89ba48`。
* 現在是否需要：`NO`。若需回復，使用 Worker-only rollback 至 `2ae1d74d-db8f-4acf-84be-bc863d89ba48`，flag 維持 false；不可回滾已向前套用的 D1 migration。

## 16. Final Gate

`P2-H = COMPLETE / ACTIVATION READINESS BASELINE ESTABLISHED`

## 17. Next Step

Do NOT enable Semantic Runtime。

`NEXT STEP = GOVERNED SEMANTIC ONBOARDING REQUIRED`

維持 Semantic Runtime 關閉；下一步是 `NEXT STEP = GOVERNED SEMANTIC ONBOARDING REQUIRED`。任何啟用前都必須另行完成核准內容、Owner／DBA authenticated smoke、變更審批與 rollback gate。
