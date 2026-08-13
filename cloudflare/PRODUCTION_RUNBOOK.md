# QueryMind Cloudflare 上線與回滾手冊

本手冊以單一 Cloudflare Worker、兩個既有 D1 binding 與 OpenAI API 經 AI Gateway BYOK 為準。部署 Worker 不會自動套用 D1 migration；資料庫備份、migration 與資料異動必須另行核准、另行執行。

## 1. 發佈前門檻

- `wrangler.jsonc` 的 D1 ID 必須指向預期環境。
- `compatibility_date` 必須在 30 天內，`nodejs_compat` 與 observability 必須啟用。
- Git working tree 應可說明；`.env*`、`.dev.vars`、Wrangler OAuth、測試輸出與資料備份不可被追蹤。
- AI Gateway 必須為 authenticated gateway；OpenAI key 只存在 Gateway BYOK，不存在 Worker vars、前端或 repository。
- Worker secret 必須包含 `AUTH_JWT_SECRET`、`AUTH_BOOTSTRAP_TOKEN`、`AUTH_PASSWORD_PEPPER` 與 `AI_GATEWAY_TOKEN`。
- Production 切換前，`AI_GATEWAY_URL` 必須通過 host/path allowlist，`AI_GATEWAY_BYOK_ALIAS` 必須對應 Gateway provider key，`AI_MOCK_MODE` 必須為 `false`。
- 完成 `npm run check`、`npm run test:unit`、`npm run test:e2e`、dry-run 與 startup check。

目前自動化帳戶登入若使用 Wrangler OAuth，Cloudflare AI Gateway 管理 API 可能回傳 `10000 Authentication error`；此時需由 Dashboard 完成 Gateway/BYOK，或建立僅具 `AI Gateway Edit`、`Secrets Store Write`（設定）及 `AI Gateway Run`（執行）的最小權限 API Token，再進行 production 切換。不得把該 Token 寫入 repository。

Windows 中文路徑下若 Wrangler 無法啟動，先將 repository 暫時映射到 ASCII 磁碟代號，再於映射路徑執行命令；結束後解除映射。

## 2. 安全檢查

```powershell
npm run check
npm run test:unit
npm run test:e2e
npm run deploy:dry-run
npx wrangler check startup
npx wrangler secret list
```

`secret list` 只核對名稱，不應讀取或輸出 secret 值。不得以 command argument、log 或 commit 傳遞任何金鑰。

## 3. AI Gateway 驗收

1. 確認 Gateway 啟用 authentication、logs、固定／滑動 rate limit 與 spend limit。
2. 確認 OpenAI provider key alias 存在，且 provider key 未出現在 Worker settings。
3. 以最小提示執行一次 provider-native endpoint smoke test；只記錄 HTTP status、provider/model 與 request ID，不記錄 token 或完整 prompt/response。
4. 確認 Gateway Analytics 出現請求、花費估算與 metadata；若涉及正式資料，關閉 prompt/response 內容留存或啟用適合的資料保留政策。

## 4. Worker 發佈

```powershell
npx wrangler deploy --dry-run
npx wrangler check startup
npx wrangler deploy
npx wrangler deployments status
```

記錄 deployment/version ID、時間、操作者、AI 模式與驗證結果到 repository 根目錄的追蹤表。部署步驟不得夾帶 `wrangler d1 migrations apply` 或 `wrangler d1 execute`。

## 5. 發佈後驗收

- `GET /health`：HTTP 200、`status=ok`、兩個 D1 為 `ok`；production 應回報 `ai=ready`。
- 首頁：CSP、HSTS、`X-Content-Type-Options`、`X-Frame-Options` 與 Referrer-Policy 存在。
- 登入與登出、錯誤密碼 rate limit、密碼變更後舊 JWT 失效。
- Owner：使用者、角色、邀請、API key、帳號復原、audit 與 system status。
- Viewer／Analyst／Editor／DBA：menu 與 API capability 一致；無權限操作回傳 403。
- Query：只允許 SELECT/WITH、row cap 生效、敏感欄位與衍生 expression 不洩漏、CSV 與畫面結果一致。
- Chat：session 建立、訊息持久化、rename/pin/archive/restore/delete；真實 AI 回覆與 Gateway log 可對應。
- Desktop 與 mobile：無 overflow、遮擋、空白頁、console error 或不可操作控制項。

## 6. 回滾

若 Worker 程式或靜態資產異常，先取得上一個已驗證 version ID，再執行：

```powershell
npx wrangler deployments status
npx wrangler rollback <KNOWN_GOOD_VERSION_ID>
```

回滾後重跑 `/health`、安全標頭、登入、RBAC 與一筆唯讀查詢。不要為了回滾 Worker 而還原或異動 D1；資料問題必須走獨立的 D1 recovery 程序並取得明確核准。

## 7. 事件處理

- AI 花費異常：先停用 production AI（切回 safe preview/mock 或封鎖 Gateway），再查 Gateway metadata 與 Worker audit。
- 認證異常：輪替 JWT/bootstrap secret，重設受影響帳號密碼，確認舊 token 已失效。
- 資料洩漏疑慮：停用 query/export capability、保存 audit evidence、輪替相關 token，未核准前不修改 D1。
- D1 不可用：確認 binding 與 Cloudflare status；不得在未備份與未核准下直接執行 migration 或 restore。
