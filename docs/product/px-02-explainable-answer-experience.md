# QueryMind PX-02 — Explainable Answer Experience

**Status:** DEPLOYED to Cloudflare Production on 2026-10-07 in Worker `5c222254-6f18-4c71-8db7-0588a926946e` (100% traffic).
**Date:** 2026-10-07
**Protected baseline:** P0 Governed Query Safety Core, P1 Explainability, P1.2 Feedback Trust, P2-F Semantic Runtime, P2-G observational evidence.

## Scope and AS-IS → TO-BE

The pre-change result surface placed Table, Chart, and verified SQL at the same tab level. The trust detail was presented as a peer-sized explanation surface, so business users met technical detail before choosing whether they needed it.

PX-02 keeps the existing answer, result and P1 evidence contracts while changing their visual order:

1. The natural-language answer is first.
2. The governed table/chart and its available actions are the primary result.
3. “為什麼是這個答案？” is collapsed and opened only on demand.
4. Feedback stays visible with the successful answer; its correction form opens only when the user requests an adjustment.

No Worker route, response schema, authorization decision, SQL execution, D1 migration, Semantic policy, or runtime flag changed.

## Answer and evidence hierarchy

| Surface | Content | Evidence rule |
|---|---|---|
| Answer | Existing assistant response | Displayed before the result; no second model request |
| Result | Table or chart, row count, truncation and masking notice, authorized export action | Uses the already-governed result; no extra query or export authorization path |
| Understanding | Metric, grouping dimension, and only actual filters/time range | Omitted if the deterministic explainability payload has no value |
| Data used | Source labels/names; approved Semantic selection when `USED`; concise `NOT_USED` note otherwise | Semantic evidence remains observational and is nested under Data used |
| Governance | Scope, row-policy, column-policy, and DLP statements | Rendered only for boolean `true` facts returned by the runtime |
| Calculation & notes | Existing business explanation, highlights, caveats | Omitted when no corresponding facts exist; no invented filter/time facts |
| Advanced | Verified SQL, collapsed inside “Advanced” | Requires `rawSqlAvailable === true` and non-empty SQL; the old peer SQL tab is removed |
| Feedback | One-click positive feedback; adjustment action with optional target/category/correction | Existing successful-run, owner, evidence-target, retry and idempotency contracts remain authoritative |

The HTML `hidden` state for the adjustment form is explicitly honored by CSS, so it does not expand until requested. On narrow screens, a visible hint explains that the result table can be swiped horizontally; this keeps the document/card within the viewport while preserving all result columns.

## Protected boundaries verified

- SQL visibility remains a frontend rendering choice based on the server's `rawSqlAvailable` capability decision; the frontend cannot grant `view_schema` or export permission.
- Export continues to call its existing independently authorized Worker endpoint. Moving the button did not create a new export path.
- Explainability is rendered only when the existing successful result includes it. Governance statements come from deterministic fields; no scope key, raw row predicate, secret or credential is added.
- Semantic `USED` / `NOT_USED` is shown as provenance only. It does not change EffectiveScope, authorized catalog, QueryPolicyEngine, DLP, result budgets, or execution authority.
- Feedback remains attached to the same successful query run. The UI's evidence shortcut populates only a target already present in explainability; ownership and idempotency remain enforced by the existing API.
- Empty verified SQL, empty filters and empty time ranges do not create blank Advanced sections or phantom facts. Successful no-row results remain distinguishable from errors.
- No source under `cloudflare/src/`, migration, production authority/policy, semantic asset, publication or activation flag changed.

## Verification

| Gate | Result |
|---|---|
| PX-01 route / canonical Worker smoke | PASS; route aliases, browser back/forward, Ask entry, and canonical `請依商品列出銷售額` were exercised locally |
| Standalone product E2E | PASS, 29/29 on disposable local Worker/D1 before the final UI SQL-gate case was added; that added case passed in the final complete suite below |
| Unit/security/explainability suite | PASS, 114/114 |
| Final complete Playwright suite | PASS, 146/146 on a newly initialized disposable local D1 with the final UI, including RBAC, P0 security, P1 explainability/feedback, Semantic `USED`/`NOT_USED`, authorized/unauthorized/empty SQL, desktop and mobile |
| `npm run check` | PASS (Wrangler types + TypeScript typecheck) |
| `npm run migration:check` | PASS; protected migrations 0006–0013 immutable |
| Worker `deploy:dry-run` | PASS; read 3 static assets, 390.23 KiB / 82.26 KiB gzip; exited at `--dry-run` |
| Remote/Production writes | NONE |

The final regression ran from a disposable fresh source clone, with application/dependency files copied from the existing locked local environment. A fresh `npm ci` was not completed because registry access was denied by the local environment; dependencies were not installed during this task. No CI or GitHub workflow was started.

Regression hygiene: reusing a D1 already mutated by a prior semantic lifecycle suite caused two existing tests to observe persisted approved Semantic content. The final 146/146 run used a newly initialized D1. Initialize a fresh disposable D1 before repeating the full mutating suite.

## Visual evidence

- [Answer-first desktop](evidence/px-02/px-02-answer-desktop.png)
- [Expanded explainability and advanced SQL](evidence/px-02/px-02-explanation-desktop.png)
- [Mobile answer, table and horizontal-scroll affordance](evidence/px-02/px-02-answer-mobile.png)

The screenshots contain only the seeded demo commerce data from disposable local D1.

The subsequent combined PX-01/PX-02/PX-03 Production release passed public smoke checks; authenticated visual smoke was not run. See [the deployment record](../releases/px-product-simplification-production-release.md).

## Known UX debt

- Business labels currently localize a bounded set of common metric/dimension names; unknown evidence strings fall back to their source labels. A governed label dictionary would improve consistency without changing authorization.
- The mobile table uses intentional inner horizontal scrolling for wide schemas; the page and result card remain within the viewport.
- Browser E2E and screenshots do not replace task-based review with representative business users or assistive-technology testing.

## Recommended next slice — PX-03

Add one contextual “Save to Library” action after a successful result. Keep it capability-filtered, owner-scoped, and subject to the existing SQL reauthorization on every rerun. Do not combine it with a broad Library redesign or change query/execution policy.
