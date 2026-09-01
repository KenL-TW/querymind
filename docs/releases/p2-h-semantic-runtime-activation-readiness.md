# QueryMind P2-H — Semantic Runtime 啟用準備度發布報告

## 1. Baseline

* Git SHA：`4f3bdae0ef260f24fa696376bc77232531a8f107`（P2-H 程式基線；後續 true-path 測試變更尚未提交，等待 CI／部署閘門）。
* Worker：`querymind`，網址 `https://querymind.digitalaaronl.workers.dev`；目前已驗證的 production 版本仍是 `2ae1d74d-db8f-4acf-84be-bc863d89ba48`。
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

Disposable readiness fixtures 與 production-compatible code path 為 `PASS`；本次 revision 的 production deployment 尚未通過外部 release gate。

## 6. Semantic Content Readiness

目前 production registry 的結果為 `NOT_READY — NO APPROVED SEMANTIC`，這是預期的安全結果。Draft、suspended revision、stale snapshot、缺少 source 或 broken dependency 都不得算作 ready。

## 7. Operator Readiness

* Authenticated production readiness smoke：`NOT EXECUTED`；本次沒有提供 production Owner／DBA session。
* Governance access：endpoint 只讀且要求 `view_semantics`，不能 approve、publish、suspend 或 resume semantic content。

## 8. Release Readiness

* Static checks：`npm run check`、`node --check public/app.js`、`git diff --check` 對目前變更皆通過。
* Fresh clone：先前 clean clone 已完成 `npm ci`、disposable APP `0001`–`0012`／DATA `0001` 初始化、typecheck、P0／P2-F／P2-G／P2-H targeted `79/79` 與 production dry-run。
* CI：前一個 code baseline 的 `33397224899` 兩個 jobs 通過；本次新增 true-path E2E 需要新的 CI run，尚未取得 release authorization。
* Rollback：production 前一版 Worker `2ae1d74d-db8f-4acf-84be-bc863d89ba48` 仍是 rollback target。

## 9. TRUE Semantic Path Test

Disposable environment 的要求已編入 CI fixture：

* flag true；
* 透過 human governance 核准並選取 Semantic；
* Chat 的 SQL 仍經既有 P0 boundary；
* 成功 run 儲存該 asset／revision 的 P2-G `USED` evidence。

測試變更已在本機，但新的 CI 執行尚未完成；沒有建立 production semantic content。

## 10. Security

`SEMANTIC ACTIVATION DOES NOT EXPAND AUTHORIZATION = PASS`

`QUERY POLICY ENGINE REMAINS FINAL AUTHORITY = PASS`

`P2-G EVIDENCE REMAINS OBSERVATIONAL = PASS`

## 11. Tests

目前本機可核對結果：typecheck `PASS`、unit suite `PASS`、fresh-clone targeted P0／P2-F／P2-G／P2-H `79/79 PASS`、dry-run `PASS`。本次 follow-up test change 的完整回歸精確數量仍等待 CI。

`FULL REGRESSION GREEN = NO`

## 12. Production Deployment

* Worker：本次延續未部署 P2-H，因外部 command approval 觸發執行環境用量限制。
* Previous Worker：`2ae1d74d-db8f-4acf-84be-bc863d89ba48`。
* Migration status：沒有執行 migration；production 仍是 APP `0001`–`0012`、DATA `0001`。
* Flag value：仍為 `false`；沒有變更 vars、secrets、Gateway 設定、D1 binding 或資料。

## 13. Production Readiness Result

```text
Platform Readiness = PASS（code/readiness fixtures；production deploy pending）
Semantic Content Readiness = NOT_READY — NO_APPROVED_SEMANTIC
Operator Readiness = NOT EXECUTED — AUTHENTICATED OPERATOR SMOKE REQUIRED
Activation Status = DISABLED
```

## 14. Semantic Registry Post-State

Production 預期／目前數量：`registry_version=0`；`semantic_assets=0`；`semantic_revisions=0`；`semantic_reviews=0`；`semantic_publications=0`；`semantic_approval_decisions=0`；`semantic_authorities=0`。

## 15. Rollback

* Worker rollback target：`2ae1d74d-db8f-4acf-84be-bc863d89ba48`。
* 現在是否需要：`NO`（本次延續沒有部署）。後續若部署 P2-H，只能 Worker-only rollback，flag 仍保持 false；不可回滾已向前套用的 D1 migration。

## 16. Final Gate

`P2-H = CODE COMPLETE / DEPLOYMENT BLOCKED`

## 17. Next Step

Do NOT enable Semantic Runtime。

`NEXT STEP = GOVERNED SEMANTIC ONBOARDING REQUIRED`

待執行環境用量限制解除後：提交並 push true-path test、取得 green CI、執行 production preflight，以 `--keep-vars` 且不帶 migration 部署，完成 public／anonymous／read-only D1 smoke，再回填本報告的新 Worker version 與精確測試數量。
