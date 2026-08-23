# QueryMind Cloudflare runtime

This directory is the replacement runtime for QueryMind. It is deliberately isolated from the existing Python service until the migration acceptance tests pass.

## Local start

```powershell
cd cloudflare
npm install
npm run check
npm run test:db:init
npm run dev
```

Open `http://localhost:8787/health`. Wrangler creates local D1 state under `.wrangler/`; it is ignored by Git.

`test:db:init` creates a separate disposable `.wrangler-test/` database for release E2E and applies application migrations `0001`–`0007`. This includes the DLP hardening (`0005`), governed query-policy state (`0006`) and explainability/feedback schema (`0007`); the command never accesses remote D1. To exercise that disposable database, start `npm run dev:test`, bootstrap the first Owner with the token in your local `.dev.vars`, then run `npm run test:e2e`.

The CI workflow performs the same bootstrap and then refreshes the local schema catalog before E2E. Product history is bounded to a 25-row/32 KB masked preview; unpinned conversations older than 90 days and audit/query/usage metadata older than 180 days are pruned opportunistically when a new session is created, so no paid scheduler is required.

The Playwright default URL and `npm run dev` both use port `8787`. Set `QUERYMIND_BROWSER_CHANNEL=chrome` only when the bundled Playwright Chromium is unavailable and a system Chrome installation should be used.

### Windows path note

Wrangler/esbuild can fail to resolve an entry point when its parent path contains non-ASCII characters. If this happens locally on Windows, temporarily map this directory to an unused ASCII drive letter before running `npm run dev`, then remove the mapping after stopping the server:

```powershell
subst Q: $PWD
Set-Location Q:\
npm run dev
# After stopping Wrangler, return to the original path and run: subst Q: /D
```

## D1 bindings

`QUERYMIND_DATA` stores the single business database available to QueryMind. `QUERYMIND_APP` stores sessions, audit events, and application metadata. Both bindings in `wrangler.jsonc` currently point to the deployed APAC D1 databases; use separate IDs if creating another environment.

## Data migration rehearsal

For a deterministic local data set, apply `seeds/demo.sql` after the data migration. Production data uses a CSV handoff so the OpenAI/Worker runtime never receives PostgreSQL credentials:

1. Set standard `PGHOST`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` environment variables in a trusted operator shell.
2. Run `./scripts/export-postgres.ps1 -OutputDirectory ./migration-input`.
3. Run `node ./scripts/csv-to-d1.mjs --input ./migration-input --output ./migration-output/data.sql`.
4. Import the generated SQL into an empty D1 database with Wrangler.
5. Run the statements in `verification/business_queries.sql` against PostgreSQL and D1 and compare the results.

The CSV input and generated production SQL may contain personal data. Keep both outside version control and remove them according to the migration runbook after acceptance.

## Secrets and AI Gateway

No OpenAI or Cloudflare credential belongs in this repository. Production auth secrets are stored with Cloudflare Worker secrets. The preview uses AI mock; the later production switch will store the OpenAI key in AI Gateway BYOK and expose only the Gateway token to the Worker. Put only non-production values in `.dev.vars`.

## Deployment boundary

The current deployment is <https://querymind.digitalaaronl.workers.dev> in `preview + AI mock` mode for frontend acceptance. Do not switch `ENVIRONMENT` to `production` until AI Gateway BYOK, formal data, spend limits, and the production verification checklist are complete.
