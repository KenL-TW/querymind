# QueryMind Post-P2-D Source-of-Truth Reconciliation

**Audit date:** 2026-08-27  
**Scope:** P0 through P2-D production baseline, before R14 hardening changes  
**Evidence:** local checkout, `origin/main` (`c1b42fe085fe1f6d9c41e7e12a52c23f770f3cda`), release reports, migration files, and the recorded production baseline.

## Result

The active Cloudflare production runtime is represented by the local working tree and release evidence, not yet by GitHub `main`. The local baseline contains the deployed P2-A through P2-D code and migrations; `origin/main` is at the same commit as the local `HEAD` but lacks those uncommitted files and modifications. No local production source was overwritten during this audit.

| Component | Local | GitHub/Main | Production | Action |
|---|---|---|---|---|
| APP migrations | `0001`–`0010`, including immutable `0008`–`0010` | Through `0007` only | `0001`–`0010` applied | Commit and push released migrations without editing historical SQL. |
| Worker source | P0/P1/P1.1 modifications plus P2 route wiring | Pre-P2 worker source | Worker `31693496-e2b8-4110-92d6-40f61035f182` | Reconcile local released source to `main`. |
| Semantic source | registry/types/validation/repository/routes present | Absent | P2-A/B/C present | Reconcile to `main`. |
| Suggestion source | intelligence/candidates/repository/types/routes present | Absent | P2-D present; no generated truth | Reconcile to `main`; preserve design-time-only boundary. |
| Static SPA | registry and suggestion workspace changes in `public/app.js` and CSS | Pre-P2 UI | P2-C/P2-D UI loaded | Reconcile to `main`; do not redesign product behavior. |
| Tests | P0/P1 regressions and semantic/suggestion suites present | P0/P1-era suite only | P2-D evidence: 94 unit, 19 E2E, 113 full | Reconcile source and make CI discover current suites. |
| Release/SDD docs | P1.1, P2-A/B/C/D reports and P2 SDD present | Missing | Production evidence recorded locally | Commit documentation and add a reproducible manifest. |
| Scripts | local D1 initializer applies `0001`–`0010` | Through `0007` | Disposable verification passed at P2-D | Commit and protect with migration checks. |
| CI | existing Cloudflare CI runs separate unit/E2E commands | Same as local `HEAD`, pre-P2 additions | N/A | Update CI after reconciliation so a clean checkout proves current baseline. |
| Runbook/tracker | runbook exists but is pre-hardening; tracker records P2 history | Tracker does not include local P2 release record | P2-D Worker and migration state recorded | Update as R14 hardening artifacts. |

## Verified Local Release Inventory

- `cloudflare/migrations/app/0008_governed_semantic_foundation.sql`
- `cloudflare/migrations/app/0009_semantic_governance_capabilities.sql`
- `cloudflare/migrations/app/0010_semantic_schema_intelligence_suggestions.sql`
- `cloudflare/src/routes/semantics.ts` and `cloudflare/src/routes/semantic-suggestions.ts`
- semantic type, validation, repository, intelligence, candidate, and suggestion repository modules
- `semantic.spec.ts`, `semantic-api.spec.ts`, `semantic-suggestions.spec.ts`, `semantic-suggestions-api.spec.ts`, and `semantic-suggestions-ui.spec.ts`
- P2-A/B/C/D release reports and the P2 semantic SDD

## Production Alignment Basis

The authoritative recorded production baseline is Worker `31693496-e2b8-4110-92d6-40f61035f182`, with rollback Worker `5e4ca4b6-8ba1-4259-b2ea-25e6dc9bbfaa`, QUERYMIND_APP `0001`–`0010`, QUERYMIND_DATA `0001`, schema snapshot `9fc08cbf8ee017c5f6041f7eaa6b7a0b0411b185f4d7e503e0ca47ecdc3b49d3`, policy version `p0-governed-query-safety-core-v1`, and policy count `72`.

The production baseline records `registry_version = 0`, zero semantic assets/revisions/reviews, and zero P2-D suggestion runs. The P2-D manual generation gate therefore remains `PENDING`; synchronization does not imply that manual mutation gate passed.

## Reconciliation Plan

1. Preserve the current local released source intact.
2. Add deterministic release hardening, validation, and handover artifacts without product or schema changes.
3. Run the complete disposable local regression suite and a production-safe Worker dry-run.
4. Create normal, reviewable commits and a baseline tag; push only through the configured remote without history rewrite or force push.

## Remote Verification

`git ls-remote --heads origin main` on 2026-08-27 returned `c1b42fe085fe1f6d9c41e7e12a52c23f770f3cda`, matching local `origin/main`. This establishes that GitHub `main` has not yet received the local P0–P2-D release source listed above.
