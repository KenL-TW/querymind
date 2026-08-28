# QueryMind — Start Here

## 1. Current Production Architecture

The active product is a **Cloudflare Worker** serving a static SPA from `cloudflare/public`, with `QUERYMIND_APP` and `QUERYMIND_DATA` D1 bindings. It is not the older FastAPI/Nuxt/PostgreSQL stack.

```text
Browser → static SPA → Cloudflare Worker → authentication/RBAC → EffectiveScope
       → authorized catalog → AI Gateway (OpenAI BYOK) → QueryPolicyEngine
       → DLP/result limits → QUERYMIND_DATA → explainability/feedback
```

Current production: `https://querymind.digitalaaronl.workers.dev`
Current Worker: `5c55b16b-4a02-4fb4-8906-687f1b6387ab`
Current release evidence: [P2-D manifest](docs/releases/manifests/p2-d-production.json)

## 2. Repository Active Runtime

Work in [`cloudflare/`](cloudflare/). The Worker entry point is `cloudflare/src/index.ts`; static SPA assets are in `cloudflare/public`; D1 migrations are in `cloudflare/migrations`.

P0 and P1 are frozen security/trust boundaries. P2-D is design-time suggestion generation only: suggestions do not enter runtime query execution, and AI cannot approve semantic truth.

## 3. Local Setup

```powershell
cd cloudflare
npm ci
npm run check
npm run test:db:init
npm run test:all
```

`test:db:init` creates only disposable local D1 state in `.wrangler-test`; it applies APP migrations `0001`–`0010` and DATA migration `0001`. It never accesses Production.

For local interactive work, copy `cloudflare/.dev.vars.example` to an ignored `.dev.vars` and run `npm run dev:test`.

## 4. Test and Release Gates

```powershell
npm run check
npm run migration:check
npm run release:manifest:check
npm run test:unit
npm run test:e2e
npm run test:all
npm run deploy:dry-run
```

Use `npm run release:preflight` only from a clean `main` checkout. It is read-only: it validates the production deployment contract, immutable migrations, manifest, and release state without reading secrets, changing D1, or calling an AI provider.

## 5. Production Configuration Boundary

Production values are deliberately not copied from preview `wrangler.jsonc`. `wrangler.production.jsonc` has no `vars` block and uses `keep_vars`, preventing preview/mock settings from overwriting the current production Worker. The non-secret contract lives in `cloudflare/production-runtime-contract.json`; secrets exist only in Cloudflare.

See [the production runbook](cloudflare/PRODUCTION_RUNBOOK.md) before any migration or deploy. D1 migration and Worker deployment are separate operations.

## 6. Semantic Governance Status

P2-A/B/C provide a governed design-time Semantic Registry. P2-D produces human-reviewable, authorized-catalog-only suggestions. Current production semantic truth is empty (`registry_version = 0`); the manual P2-D generation gate is **PENDING**. Do not use **Use as Draft** in the manual smoke.

## 7. Handover and Architecture

- [Engineering handover](docs/HANDOVER.md)
- [Current production architecture](docs/architecture/current-production.md)
- [P0/P1 baseline](docs/baselines/governed-query-baseline.md)
- [Operational observability](docs/operations/observability.md)
- [Release checklist](docs/releases/release-checklist.md)

## 8. Legacy Architecture

`api/`, `frontend/`, `infra/`, Docker/PostgreSQL, Nuxt, FastAPI, and AWS demo materials are **LEGACY / HISTORICAL REFERENCE**. They may be retained for history and regression checks, but they are not the current production runtime and must not receive parallel feature development.
