# QueryMind P0 — Governed Query Safety Core

**Release status:** Preview Worker deployed and smoke-tested; production AI activation remains gated on AI Gateway configuration.

**Scope:** Cloudflare Worker + D1 + public SPA + AI Gateway/OpenAI path. Legacy FastAPI/Nuxt/Postgres/AWS code was not modified or reintroduced.

## Delivered

- SDD: `docs/sdd/p0-governed-query-safety-core.md`.
- Forward-only app migration: `cloudflare/migrations/app/0006_governed_query_safety.sql`.
  - Adds `users.data_scope_key`.
  - Adds `data_scope_policies` and singleton `policy_state`.
  - Materializes explicit role allowlists for the bundled business schema.
  - Includes deterministic `scope:tw` and `scope:jp` row-policy fixtures without assigning them to existing users.
- `EffectiveScope` resolution is deny-by-default and fails closed when migration state, policy rows, columns, or row predicates are invalid.
- Central `QueryPolicyEngine` (`cloudflare/src/lib/query-policy.ts`) is called by AI chat, direct query, saved-insight create/update, CSV export, and schema context.
- Authorized catalog filtering prevents unauthorized table/column metadata from entering the model context.
- Owner user administration can provision a validated `dataScopeKey`; blank assignments retain the role-scope fallback.
- Deterministic row-policy rewriting applies predicates before D1 execution, including aliases, joins, aggregates, nested queries, and supported CTEs.
- Existing read-only SQL, result caps, DLP inference blocking, and masking remain in force.
- Model egress redaction removes OpenAI-style keys, AWS access keys, bearer tokens, and secret-like assignments from prompts/history/glossary content before provider egress or persistence.
- Production runtime gate rejects missing D1/auth/Gateway configuration, production auth fallback, and AI mock mode.
- Local D1 bootstrap now applies app migrations 0001–0006, correcting the previous 0005 omission.
- Regression tests cover unauthorized table/column/wildcard access, aliases, joins, aggregates, CTE row enforcement, prompt-injection independence, cross-join rejection, production fail-closed configuration, and model redaction.

## Verification evidence

| Check | Result |
|---|---|
| `npm run check` in `cloudflare` | PASS — Wrangler types + TypeScript typecheck |
| `npm run test:unit` in `cloudflare` | PASS — 66 tests total (62 P0 security assertions and 4 existing P1 explainability assertions) |
| Disposable local D1 initialization | PASS — migrations 0001–0007 and demo seed applied |
| Local D1 policy state | PASS — `policy_state.expected_migration = 0006`, 72 active policy rows |
| Wrangler Worker bundle dry-run | PASS from a temporary ASCII drive mapping (Windows Wrangler/esbuild cannot resolve this repository's non-ASCII parent path directly) |
| `wrangler check startup` | PASS — local bundle 151.17 KiB (35.60 KiB gzip), 3.4 ms sampled active startup CPU |
| Local Worker route smoke | PASS — `/health` 200 with policy `0006`; bootstrap/login/schema refresh/schema read/session/chat completed; `scope:tw` direct orders query returned only Taipei rows and `employees` query returned 403 `TABLE_NOT_ALLOWED` |
| Product/RBAC E2E | PASS — 12/12 after bootstrapping the disposable Owner and refreshing the local schema catalog |
| Remote app migration state | PASS — `0005`, `0006`, `0007` applied to `querymind-app`; `0006` policy state healthy with 72 active policies and 8 DLP policies |
| Preview Worker deployment | PASS — Worker `querymind`, version `2ff7a151-b9a7-4656-9c76-6621b8903c56` |
| Deployed preview smoke | PASS — `/health` 200; policy healthy; anonymous admin/schema/query requests all return 401 |
| No dependency installation or source migration rewrite | PASS |

## Remote deployment result

Cloudflare OAuth was restored for the configured account. Remote D1 state was inspected before writing; only the pending forward-only migrations `0005`, `0006`, and `0007` were applied to `querymind-app`. `querymind-data` was not modified.

The existing Worker URL is `https://querymind.digitalaaronl.workers.dev`. The new bundle is deployed in the repository's existing `preview + AI mock` mode. No secret values were read, rotated, or written.

Production activation remains intentionally blocked until the operator configures the existing AI Gateway BYOK route and then changes the environment to production. The remaining runbook is:

1. Configure the existing AI Gateway URL, alias/token and BYOK provider key without placing the OpenAI key in the repository or browser.
2. Deploy with `ENVIRONMENT=production`, `AUTH_REQUIRED=true`, `AI_MOCK_MODE=false`, valid auth secrets, and the allowlisted Gateway endpoint.
3. Verify `/health` reports `environment=production`, `ai=ready`, policy state `0006`, anonymous 401, authorized query, out-of-scope table/column/row denial, saved insight/export/schema paths, and one bounded real Gateway request.
4. Record the production Worker version and smoke responses here before marking the P0 production release complete.

## Known limitation and safety posture

No maintained SQLite AST parser was available in the existing Worker dependency set, and dependencies were intentionally not installed. The engine therefore uses a bounded tokenizer plus deterministic fail-closed extraction. Unsupported or ambiguous source shapes are rejected; this is safer than lexical-only execution but should be replaced by a maintained Worker-compatible parser in a future milestone if business SQL complexity requires it. P1 exists as a separately documented, additive feature; P0 policy enforcement remains the mandatory boundary for every execution path.

Cloudflare D1 does not expose a portable per-statement cancellation/timeout binding in this Worker runtime. Existing AI fetch timeout, SQL complexity limits, row caps, API byte budgets, and rate limits remain the enforced Free-plan controls; no fake cancellation guarantee is claimed.
