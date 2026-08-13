# QueryMind Frontend (Nuxt 3 + Naive UI)

\u9069\u7528 Vue 3 + TypeScript \u91cd\u5beb\u7684 QueryMind \u751f\u7522\u7d1a\u524d\u7aef\u3002

## \u5feb\u901f\u958b\u59cb

```powershell
# 1. \u78ba\u8a8d\u5f8c\u7aef\u5df2\u5728 http://localhost:8080
cd ..
.\.venv\Scripts\python.exe main.py api

# 2. \u88dd\u5957\u4ef6 (\u5efa\u8b70 pnpm\uff0c\u4f7f\u7528 npm/yarn \u4ea6\u53ef)
cd frontend
pnpm install     # or: npm install
pnpm dev         # or: npm run dev

# 3. \u958b\u555f http://localhost:3000
#    \u9810\u8a2d owner \u5e33\u865f\uff1aowner@local / Owner123!
```

## \u72c0\u614b\u8aaa\u660e

\u9019\u662f Phase B \u521d\u59cb scaffold\uff0c\u53ea\u542b\uff1a
- \u767b\u5165\u9801 `/login`
- \u9996\u9801 `/`\uff1a\u986f\u793a\u73fe\u5728\u7684\u4f7f\u7528\u8005 / \u89d2\u8272 / \u80fd\u529b
- API client\uff08`useApi`\uff09\u542b\u81ea\u52d5\u5e36 Bearer + 401 refresh \u91cd\u8a66
- \u8a8d\u8b49\u72c0\u614b\u4ee5 Pinia store \u7ba1\u7406

\u5f8c\u7e8c\u6703\u52a0\u4e0a\uff1a
- Chat with SSE streaming
- Schema explorer / Templates / Dictionary / Audit logs
- Admin (users / invitations / api-keys)

## \u578b\u5225\u5b89\u5168\u7684 API client

```powershell
# 1. \u5728 backend root \u532f\u51fa openapi.json
cd ..
.\.venv\Scripts\python.exe scripts/export_openapi.py

# 2. \u5728 frontend/ \u751f\u6210 TypeScript \u985e\u578b
cd frontend
pnpm openapi:gen
# \u8f38\u51fa\u5728 types/api.d.ts
```

## \u74b0\u5883\u8b8a\u6578

\u5efa\u7acb `.env`\uff1a
```
NUXT_PUBLIC_API_BASE=http://localhost:8080
```
