# QueryMind Production Runbook

## Release boundary

Production is Worker `querymind` at `https://querymind.digitalaaronl.workers.dev`. The current verified Worker is `31693496-e2b8-4110-92d6-40f61035f182`; the rollback Worker is `5e4ca4b6-8ba1-4259-b2ea-25e6dc9bbfaa`.

The Worker runs a static SPA plus two D1 bindings. Production AI uses Cloudflare AI Gateway `querymind-prod` with OpenAI BYOK alias `production`. Keys remain in Cloudflare; never request, print, commit, or pass one on a command line.

## Before a Worker release

1. Confirm the source is a clean `main` checkout and the release evidence is current.
2. Run in `cloudflare/`:

   ```powershell
   npm ci
   npm run check
   npm run migration:check
   npm run release:manifest:check
   npm run test:db:init
   npm run test:all
   npm run release:preflight
   npm run deploy:dry-run
   ```

3. Review the production contract: `ENVIRONMENT=production`, `AUTH_REQUIRED=true`, `AI_MOCK_MODE=false`, the AI Gateway is `querymind-prod`, BYOK alias is `production`, model allowlist is `gpt-4o,gpt-4o-mini`, and both D1 bindings are present. Validate secret **names** only: `AUTH_JWT_SECRET`, `AUTH_BOOTSTRAP_TOKEN`, `AUTH_PASSWORD_PEPPER`, `AI_GATEWAY_TOKEN`.
4. Do not use Wrangler CLI `--var` input for a comma-separated allowlist in PowerShell. `npm run deploy:production` reads the checked-in production contract and uses `wrangler.production.jsonc` with `keep_vars`, so preview/mock vars cannot overwrite production settings.

## Migration is separate

Migration is never part of `deploy:production`. For a release requiring a reviewed migration, follow the Cloudflare D1 confirmation flow separately and record a backup/checkpoint. Current Production is already APP `0001`–`0010`, DATA `0001`; this hardening release has **no migration**.

Do not roll back a forward D1 migration just because a Worker rollback is needed.

## Deploy and validate

```powershell
npm run deploy:production
npm run smoke:production
```

The helper runs preflight then a dry-run before an explicit Worker deploy. It prints the target and does not access D1 migrations, secrets, or the AI provider during preflight.

The public smoke verifies `/`, `/health`, and anonymous access to `/api/v1/semantics` is `401`. To run optional authenticated checks with an already-authorized operator credential, set it only in the process environment:

```powershell
$env:QUERYMIND_SMOKE_AUTHORIZATION = 'Bearer <existing-operator-token>'
npm run smoke:production
Remove-Item Env:QUERYMIND_SMOKE_AUTHORIZATION
```

The optional checks read `/api/v1/me` and `/api/v1/semantics`, then run the P1 golden query `請依商品列出銷售額`. They require sales amount, product, three rows, and non-empty authorized verified SQL; no model prose is asserted.

## Manual P2-D closeout (mutating; not automated)

Owner/DBA only:

1. Open **Semantic Registry** → **AI Suggestions**.
2. Select `products`; choose TERM and DIMENSION; set maximum to 3; select **Generate**.
3. Confirm only OPEN suggestions appear. Confirm no `semantic_asset`, `semantic_revision`, or `semantic_review` was automatically created and `registry_version` stays 0.
4. Do **not** click **Use as Draft**.
5. Run the P1 golden chat smoke after reviewing results.

This gate is currently **PENDING**. It is separate from engineering hardening.

## Incidents

| Incident | Immediate containment |
|---|---|
| AI suggestion hallucination | Stop suggestion generation or roll back Worker; preserve suggestion run/audit evidence. Do not delete approved truth. |
| Unauthorized metadata suspected at provider | Disable suggestion generation, preserve evidence, inspect EffectiveScope/catalog boundary, rotate credentials only through approved secret process. |
| Metadata prompt injection | Stop affected generation, preserve evidence, verify authorized catalog filtering, then fix/roll back Worker. |
| Validation or stale-suggestion acceptance bug | Disable the path/roll back Worker. Do not mutate semantic tables directly; use governed lifecycle correction. |
| Wrong semantic Draft | Use governed revision/lifecycle process. Draft is not runtime authority. |
| D1 incident | Verify binding/status and preserve evidence. Never restore into Production as a diagnostic step. |

## Rollback and recovery

For a Worker/static-asset regression, roll back only the Worker to a verified version, then rerun health, public smoke, auth/RBAC, and a governed read-only query. Never treat a Worker rollback as a D1 rollback.

Current D1 recovery rehearsal is **NOT EXECUTED**. A future rehearsal must export/restore only into a disposable isolated D1 and verify APP tables, migration state, policy state, semantic tables, and suggestion tables. Production restore is not a test environment.
