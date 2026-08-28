# QueryMind Cloudflare Runtime

This directory is the active QueryMind production runtime: a Cloudflare Worker, static SPA, two D1 databases, and Cloudflare AI Gateway using OpenAI BYOK. FastAPI/Nuxt/PostgreSQL/AWS materials elsewhere in the repository are legacy references.

## Current baseline

- Worker: `querymind`; released Production version `5c55b16b-4a02-4fb4-8906-687f1b6387ab`
- APP migrations: `0001`–`0010`; DATA migrations: `0001`
- P0: governed SQL safety; P1: explainability and feedback
- P2-A/B/C: design-time Semantic Registry; P2-D: human-reviewable AI schema suggestions
- AI: Cloudflare AI Gateway `querymind-prod`, OpenAI BYOK alias `production`
- Baseline tests: 94 unit, 19 E2E, 113 full

## Local reproducibility

```powershell
npm ci
npm run check
npm run test:db:init
npm run migration:check
npm run release:manifest:check
npm run test:all
```

The disposable D1 initializer always starts from an empty `.wrangler-test` directory. It does not use remote bindings or production credentials.

## Safe deployment process

1. Follow [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md).
2. Apply a reviewed D1 migration separately, when and only when a release contains one.
3. From a clean `main` checkout, run `npm run release:preflight` and `npm run deploy:dry-run`.
4. `npm run deploy:production` runs preflight and dry-run before a Worker deploy. It never invokes D1 migrations and uses `wrangler.production.jsonc`, whose `keep_vars` setting protects existing production vars/secrets from preview/mock config.
5. Run `npm run smoke:production`; authenticated checks are opt-in through an existing operator-supplied authorization header.

On Windows, do not pass a comma-separated model allowlist directly as a Wrangler CLI argument. The production helper reads the version-controlled JSON contract instead, avoiding PowerShell argument splitting.

## Boundaries that must remain true

- EffectiveScope resolves before authorized catalog retrieval.
- LLM requests contain only authorized catalog metadata.
- Chat, direct query, saved insight, and export all use QueryPolicyEngine before `QUERYMIND_DATA` execution.
- P2 semantic assets/suggestions are not runtime query inputs; AI suggestions cannot approve truth.
- Secrets are Cloudflare secrets, never Worker vars, source, manifests, smoke scripts, or logs.
