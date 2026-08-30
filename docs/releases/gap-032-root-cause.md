# GAP-032 Root Cause and Regression Record

**Status:** Fixed in test fixtures; production runtime unchanged

**Baseline:** `4396c6dbc1f0e5517d9f1cd73755ae2aaa7a703d` (main), P2-D/P1.2 production baseline

## Symptom

The complete Playwright suite previously reported **116/117**. The failing case was:

* File: `cloudflare/tests/semantic-suggestions-api.spec.ts`
* Case: `generates local mock suggestions, accepts only a human-reviewed Draft, and supports dismiss`
* Failing operation: `POST /api/v1/semantics/suggestions/:suggestionId/accept-as-draft`
* Response: HTTP `409 SUGGESTION_DUPLICATE` (`A semantic asset with this type, canonical name, and domain already exists.`)

The failing candidate was the deterministic P2-D mock metric `products_price` (type `METRIC`, empty domain). The retained disposable D1 contained the earlier accepted asset `e48ecc82-d027-44da-95c9-9abd539cfa8e`; the earlier accepted suggestion was `45deef41-981b-4275-9a9f-941f2792ae03`. A later rerun produced open suggestion `a2089eda-7651-4a68-bfd0-dd3566e36934` and collided with the existing asset.

## Reproduction and root cause

1. A fresh disposable D1 initialized with APP migrations `0001`-`0011` and DATA migration `0001` passed `npm run test:all` at **117/117**.
2. The same suite was then run against a retained local D1 that already contained P2-D semantic fixtures. The test generated the same stable candidate name and attempted to accept it unchanged, reproducing the HTTP 409.
3. The production uniqueness rule is correct: semantic type, canonical name, and domain must remain unique. The failure was not caused by a migration, transaction leak, global runtime state, authorization bypass, or policy defect.
4. The fixture accepted a stable generated name but did not remove the accepted Draft/asset. Because the local D1 persistence directory survives a rerun, suite order and prior test execution exposed the lifecycle defect. An isolated suite passed because its database had no prior semantic asset.

## Minimal fix

`cloudflare/tests/semantic-suggestions-api.spec.ts` now namespaces the human-reviewed fixture with the current suggestion run ID:

`<generated canonical name>_run_<first 12 hex characters of runId>`

The namespaced value is supplied consistently in the request body and the reviewed contract. The test still exercises real suggestion generation, human-modified contract validation, semantic uniqueness, Draft creation, acceptance/dismissal state transitions, audit redaction, and Viewer denial. No production uniqueness constraint or Semantic Registry behavior was changed.

## Regression evidence

Against the same retained disposable D1, the patched P2-D API test passed twice consecutively. A fresh disposable D1 then passed the complete 117-test suite, and a D1 already mutated by the 20-test product E2E suite also passed the complete 117-test suite. This proves the fixture no longer depends on an empty registry and preserves the real duplicate guard.

## Production impact

None. No production Worker, D1 database, semantic asset, revision, review, policy, user, role, or secret was changed. The fix is test-only; a new Worker deployment is not required.
