# GAP-034 Root Cause and Regression Record

## Scope

GAP-034 was the authenticated local E2E bootstrap failure observed while
closing P2-F. `POST /api/v1/schema/refresh` returned a D1 error stating that
`schema_catalog_state.schema_snapshot_id` did not exist. This record covers
only the disposable local test path; no remote D1 or production Worker was
changed.

## Root cause

The failing Worker was attached to a retained `.wrangler-test` persistence
directory whose schema pre-dated application migration `0008`. A concurrent
attempt to reinitialize that directory was also blocked by the running
Worker's D1 file lock, so the test process continued against the stale
database. The failure was therefore a retained-local-state/lifecycle issue,
not a missing production migration, missing row, D1 migration-ledger defect,
or binding mismatch.

Physical checks after the supported reset and initialization show:

- `migrations/app/0008_governed_semantic_foundation.sql` contains the sole
  additive `ALTER TABLE ... ADD COLUMN schema_snapshot_id` statement.
- Retained and fresh disposable APP D1 both expose the column as `TEXT NOT
  NULL DEFAULT 'uninitialized'`.
- The initializer verifies the column, registry seed (`registry_version = 0`),
  expected tables, indexes, foreign keys, and guards before it reports success.
- The local direct-file initializer intentionally has no `d1_migrations` ledger;
  it applies the reviewed files in order and is never used against production.
- The Worker bindings resolve to the configured `querymind-app` and
  `querymind-data` IDs in both checks.

## Minimal fix

Stop the local Worker before resetting its disposable persistence directory,
run `npm run test:db:init`, start the Worker with the same `--persist-to`
directory, then run the localhost-only `npm run test:bootstrap` helper. No
historical migration was edited, no `0013` migration was added, no fallback
column/default was manufactured, and no production data was touched.

## Regression evidence

- Clean disposable D1 initialization: PASS (APP `0001`–`0012`, DATA `0001`,
  schema postconditions).
- Normal authenticated bootstrap/login/schema refresh: PASS (`200`).
- Product/RBAC/semantic E2E: PASS, `20/20`.
- Full Playwright regression: PASS, `128/128`.
- Unit/P0/P1/P2-F regression: PASS, `106/106`.
- Type/binding check, migration immutability, release manifests, and Worker
  production dry-run: PASS.
- GitHub Actions run `33352997498` for commit `b84b2e2`: PASS (both jobs).

**GAP-034: CLOSED.**
