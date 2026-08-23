# QueryMind P1 — Explainable Query Experience Release

**Release state:** Local complete; production pending valid Cloudflare authentication  
**Date:** 2026-08-21  
**Scope:** Cloudflare Worker + D1 + existing SPA + AI Gateway/OpenAI. Legacy runtimes were not changed.

## Summary

P1 adds a bounded, explainable result experience on top of the P0 Governed Query Safety Core. Successful governed chat/direct queries now expose server-derived source and governance metadata, structured understanding, business calculation notes, result caveats, capability-gated SQL and authenticated query feedback. The implementation does not add an AI call or duplicate full schemas/results.

## Delivered files

- `docs/sdd/p1-explainable-query-experience.md`
- `cloudflare/migrations/app/0007_explainable_query_experience.sql`
- `cloudflare/src/lib/explainability.ts`
- `cloudflare/src/routes/feedback.ts`
- Updated `cloudflare/src/routes/agent.ts`, `routes/query.ts`, `src/index.ts`, local D1 bootstrap, SPA assets and tracker.
- `cloudflare/tests/explainability.spec.ts` plus preserved P0 `tests/security.spec.ts`.

## Migration

`0007_explainable_query_experience.sql` is additive and forward-only. It adds `query_runs.explainability_json` with a JSON validity check; creates `query_feedback` with successful ratings, bounded comments, allowed categories, foreign keys, unique owner/run idempotency and supporting indexes. Migration 0006 was not edited.

## API and persistence

- `/api/v1/query` returns `queryRunId` and a `version: "p1"` explainability envelope after successful policy/DLP execution.
- `/api/v1/chat` returns/persists the envelope for the governed tool-call path; no-tool conversational answers remain compatible and do not invent a query run.
- `/api/v1/query-runs/:id/feedback` is authenticated, owner-only, successful-run-only and idempotent. It audits the rating/category without copying free-form comments into audit metadata.
- Full results remain bounded by existing API/stored-preview budgets; only explainability metadata is persisted.

## Frontend and security

The existing SPA now renders Query Understanding, Data Sources / Governance, How calculated, result summary/caveats, optional raw SQL and feedback. All values are escaped. Governance cards do not show row predicates, scope keys, credentials or tokens. SQL is shown only when `view_schema` is present; failed/unauthorized query paths do not produce an explainability card.

## Verification evidence

| Check | Result |
|---|---|
| `node --check cloudflare/public/app.js` | PASS |
| `npm exec tsc -- --noEmit` | PASS |
| `npm run check` | PASS — Wrangler type generation and `tsc --noEmit` completed with an explicit writable local XDG config |
| Existing P0 security suite | PASS — 62/62 |
| P1 explainability/feedback suite | PASS — 4/4 |
| Existing product/RBAC E2E | PASS — 12/12 with local Chromium channel; original menu, module, RBAC and mobile shell flows remain green |
| Disposable local D1 | PASS — migrations 0001–0007 and demo seed; `query_feedback` and `query_runs.explainability_json` verified |
| Local API smoke | PASS — schema refresh, governed direct query returned `queryRunId`/`p1`, feedback returned 200, explainability JSON persisted; `scope:tw` returned only Taipei orders and unauthorized employees returned 403 |
| Desktop SPA smoke | PASS — login → chat → governed result → explainability card and two feedback controls; no console/page errors |
| Mobile SPA smoke | PASS — 390×844 flow, positive feedback recorded, no horizontal overflow, no console/page errors |
| Worker dry-run | PASS — temporary ASCII drive mapping used because Windows Wrangler/esbuild cannot resolve the repository’s non-ASCII parent path directly |

## Remote limitation and operator runbook

No remote D1 write, migration, secret update or deploy was attempted in this turn. Wrangler reported the existing OAuth token is expired and cannot refresh in this non-interactive environment. The previously known URL `https://querymind.digitalaaronl.workers.dev` is therefore not claimed to contain P1 migration 0007 or this Worker bundle.

After a valid scoped `CLOUDFLARE_API_TOKEN` or interactive `wrangler login` is available:

1. Read-only inspect both remote D1 migration states and back up/confirm the current rollback point.
2. Apply app migration 0007 only when the remote app is at 0006; do not edit 0006.
3. Deploy the Worker with production auth, `AI_MOCK_MODE=false`, the allowlisted AI Gateway URL and configured BYOK alias/token.
4. Verify `/health`, anonymous 401, authorized chat/direct query, explainability fields, SQL capability behavior, feedback ownership/idempotency, row-scope restrictions, unauthorized employees, export and saved insights.
5. Record the Worker version, migration result and production smoke responses in this report/tracker before marking remote promotion complete.

## Known limitations

The explanation heuristics are intentionally bounded and deterministic; they describe intent from prompt/validated SQL but do not claim semantic certainty. D1 does not provide a portable per-statement cancellation binding in this Worker runtime, so existing AI timeout, SQL complexity, row/result budgets and rate limits remain the Free-plan controls. Browser-plugin validation was unavailable because the connected browser list was empty; the same flow was verified with a local Playwright Chromium executable.
