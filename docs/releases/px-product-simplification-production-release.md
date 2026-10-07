# PX-01 / PX-02 / PX-03 Cloudflare Production Release

**Release date:** 2026-10-07 (UTC)
**Source commit:** `d8f7a05` — `feat: simplify QueryMind ask and library experience` (local `main`; not pushed to GitHub)
**Production Worker:** `querymind` — `5c222254-6f18-4c71-8db7-0588a926946e` (100% traffic)
**Immediate rollback Worker:** `2b3d78f6-3758-4c3b-8b4f-92d086203e6e`

## Scope

The release includes capability-filtered Ask-first navigation (PX-01), the answer-first explainability presentation (PX-02), and contextual owner-scoped Save to Library (PX-03). It reuses existing APP insights/query-run contracts and does not add a D1 migration.

The Worker was deployed through `npm run deploy:production`, which passed the production preflight and dry-run, preserved existing Production variables with `keep_vars`, and did not apply migrations or read secrets. No GitHub push was made. No Semantic authority, policy, asset, revision, publication, or runtime-activation setting was created or changed by this release.

## Production state

- Worker `5c222254-6f18-4c71-8db7-0588a926946e` is live at 100% traffic.
- Prior Worker `2b3d78f6-3758-4c3b-8b4f-92d086203e6e` is the immediate rollback target.
- Remote APP and DATA migration checks both reported no pending migrations. Repository baseline is APP `0001`–`0013`, DATA `0001`; this release applied none.
- Production variables were preserved. `SEMANTIC_RUNTIME_CONTEXT_ENABLED` was not changed; no Semantic activation was attempted.
- Production Semantic D1 state was not re-read during this product deployment.

## Verification

| Gate | Result |
|---|---|
| TypeScript `npm run typecheck` | PASS |
| P0/P1/P2 unit, security and semantic tests | PASS — 114/114 in this release check |
| Latest complete regression for this same source tree before deployment | PASS — 151/151; PX-03 targeted E2E 5/5 |
| Migration immutability | PASS — protected migrations `0006`–`0013` unchanged |
| Release manifest check | PASS |
| Production release preflight | PASS |
| Production-config Worker dry-run | PASS — 392.28 KiB (82.72 KiB gzip); two static assets updated |
| Production public smoke | PASS — `/`, `/health`, and anonymous protected endpoint behavior |
| Authenticated Production smoke | NOT RUN — no operator session/token was supplied |
| APP / DATA migrations applied by this release | NONE |

During this release attempt, a second full Worker-backed E2E rerun could not start because the local Windows Workerd process terminated with `std::terminate()`. The disposable migration initialization and 114-test unit/security/semantic suite passed; the earlier same-source complete 151/151 and PX-03 targeted 5/5 results remain the latest full E2E evidence. The blocked rerun is not counted as a pass.

Wrangler type generation also encountered local filesystem permission errors when writing its ignored generated declaration and default log path; the independent TypeScript typecheck passed. Production preflight and deployment completed successfully.

## Follow-up

This record and the handover/runbook synchronization are documentation-only local changes made after the Worker deployment. They do not change the Worker bundle and do not require another Production deployment. Future runtime releases remain Cloudflare-only; no GitHub push is required.
