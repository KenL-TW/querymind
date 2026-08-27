# QueryMind P2-C — Governed Semantic Registry UI

**Status:** Worker/static SPA deployed. P2-C closeout is blocked only on the
required authenticated production Owner/DBA smoke, which cannot be performed
without an existing safe browser session.

## Purpose and Scope

P2-C adds the first enterprise governance interface for the existing semantic
registry. It is an incremental view in the existing QueryMind static SPA—not a
new application or frontend framework. It lets authorized governance users
discover metadata, create and edit bounded drafts, submit them for review, and
request changes or reject a revision.

The phase is design-time only. It does not publish semantic truth, run a metric,
or change the protected P0/P1 execution chain.

## UI Architecture and API Matrix

`public/app.js` keeps the existing page-state/render/modal/request pattern. A
`semantics` page is added only after the current session reports
`view_semantics`; all browser requests use the existing same-origin API helper.
The UI has no D1 connection and no separate backend.

| Method / path | Capability | Browser session | UI use | Transition |
|---|---|---:|---|---|
| `GET /api/v1/semantics` | `view_semantics` | no | bounded list/search/filter/page | none |
| `GET /api/v1/semantics/:assetId` | `view_semantics` | no | asset overview, current definition, sources, aliases | none |
| `GET /api/v1/semantics/:assetId/revisions` | `view_semantics` | no | revision metadata history | none |
| `POST /api/v1/semantics` | `manage_semantic_drafts` | yes | create asset + initial draft | initial `DRAFT` |
| `POST /api/v1/semantics/:assetId/revisions` | `manage_semantic_drafts` | yes | new draft revision | `DRAFT` |
| `PATCH /api/v1/semantics/:assetId/revisions/:revisionId` | `manage_semantic_drafts` | yes | edit draft contract/aliases/reason | remains `DRAFT` |
| `POST …/:revisionId/submit-review` | `manage_semantic_drafts` | yes | submit confirmation | `DRAFT → IN_REVIEW` |
| `GET …/:revisionId/reviews` | `review_semantics` | no | safe review history | none |
| `POST …/:revisionId/request-changes` | `review_semantics` | yes | bounded review comment | `IN_REVIEW → DRAFT` |
| `POST …/:revisionId/reject` | `review_semantics` | yes | confirmed rejection + comment | `IN_REVIEW → REJECTED` |

The P2-B API does not offer a historic revision-content detail endpoint; P2-C
therefore renders history metadata and the full contract for the latest revision
only. This is an explicit UI limitation, not a client-side data reconstruction.

## Implemented Experience

- Registry navigation is visible only with `view_semantics`.
- The list supports API-backed text, type, asset-status, revision-status, and
  domain filters; it honours server pagination.
- The empty registry explains its purpose and shows the Create action only to
  `manage_semantic_drafts` users.
- Detail tabs show Overview, Definition, Sources, Aliases, Revision History,
  and, for reviewers, Review history.
- TERM, DIMENSION, METRIC, and RELATIONSHIP render their actual bounded P2-B
  contracts. Metrics use a structural AST display/editor, not a SQL editor;
  grains, source mappings, aliases, cardinality, and ordered relationship keys
  are bounded form controls.
- DRAFT-only edit/new-revision controls make it clear that saving does not
  replace an approved revision. IN_REVIEW, APPROVED, and REJECTED revisions are
  not editable.
- Submit, Request Changes, and Reject refresh canonical server state; Reject
  requires a confirmation and bounded comment.

## Capability and Lifecycle Boundary

| Capability | Visible product behavior |
|---|---|
| `view_semantics` | browse list, detail, definition, sources, aliases, revision history |
| `manage_semantic_drafts` | create/edit DRAFT, create revision, submit review |
| `review_semantics` | view review history, request changes, reject IN_REVIEW revision |

The UI hides controls for absent capabilities, but P2-B remains authoritative:
every mutation requires an authenticated browser session and its corresponding
capability. API-key semantic mutation remains forbidden.

Only these lifecycle transitions are exposed: `DRAFT → IN_REVIEW`,
`IN_REVIEW → DRAFT`, and `IN_REVIEW → REJECTED`. There is no approval control,
approval endpoint, deprecation control, or AI-suggestion control in P2-C.

## Security and Protected Runtime

- The registry sends no request to Chat, Direct Query, Export, OpenAI, or the
  AI Gateway. It does not directly access either D1 binding.
- P2-C does not change authentication, RBAC enforcement, EffectiveScope,
  authorized catalog retrieval, model egress, QueryPolicyEngine, DLP,
  `validated.executionSql`, explainability, feedback, or business-data
  execution.
- UI rendering escapes text and ignores undeclared sensitive fields. It never
  displays result rows, credentials, tokens, scope keys, raw row predicates,
  or raw SQL.
- Draft/create/edit/submit/request-changes/reject keep
  `semantic_registry_state.registry_version` unchanged. Registry publication
  remains a future P2-E responsibility.

## Minimal P2-B Compatibility Fix

`src/routes/semantics.ts` contained a revision-list query that selected
`semantic_revisions.asset_type`, although that column belongs to
`semantic_assets`. This caused revision history to fail for newly created
assets. P2-C removes only that invalid select item and adds API coverage. No
data model, migration, authorization, lifecycle transition, or audit behavior
changed.

## Verification

Local disposable D1 applies app migrations `0001`–`0009` and data migration
`0001`; P2-C adds no migration.

| Check | Result |
|---|---|
| `npm run check` | PASS |
| `npm run test:unit` | PASS — 87/87 |
| `npm run test:e2e` | PASS — 17/17 |
| `npm run test:db:init` | PASS — app 0001–0009, data 0001 |
| `npm run test:all` | PASS — 104/104 |
| `node --check public/app.js` | PASS |
| `git diff --check` | PASS (line-ending warnings only) |
| production-safe Worker dry-run | PASS — 226.68 KiB / gzip 49.85 KiB, D1 bindings only |
| Desktop/mobile governance visual QA | PASS via the repository Playwright suite; Browser MCP was unavailable in this environment |

The automated governance flow creates local-only TERM, DIMENSION, METRIC, and
RELATIONSHIP fixtures and proves create/list/detail/history/submit/request-
changes/re-submit/reject. It also asserts no Chat, Direct Query, or Export call
is emitted by the workflow; XSS-safe output; sensitive field omission;
browser-session enforcement; API authorization; and unchanged registry version.

## Pre-deploy Architecture Review

All P2-C deployment gates passed:

- P0/P1 runtime paths were not changed; static inspection confirms Chat and
  Direct Query still resolve `EffectiveScope`, call `authorizeQuery`, and only
  then execute `validated.executionSql` on `QUERYMIND_DATA`.
- The registry view does not call an LLM, OpenAI, AI Gateway, Chat, Direct
  Query, Export, or D1 directly.
- Draft/review/reject tests prove registry version remains unchanged.
- No UI approval or deprecation mutation is present; no new migration exists.
- The `view_semantics`-only local fixture can enter the Registry but sees no
  mutation control, and a forced browser-session POST is denied with HTTP 403.
- The manager/reviewer workflow, browser-session restriction, XSS escaping,
  sensitive-field omission, and P0/P1 regression all pass.

## Production Rollout

P2-C deploys static SPA/Worker code only. It must use the established
production-safe process with production variables and secrets retained,
including `ENVIRONMENT=production`, `AUTH_REQUIRED=true`,
`AI_MOCK_MODE=false`, the existing AI Gateway configuration, and both D1
bindings. No D1 migration or production semantic asset is part of this phase.

After deployment, production checks are intentionally non-mutating: `/` and
`/health`, anonymous semantic access denial, the existing Owner/DBA empty
registry view and `GET /api/v1/semantics`, existing authenticated chat with P1
explainability, and a read-only check that schema snapshot and semantic counts
remain unchanged.

### Deployment evidence — 2026-08-24

- Previous rollback version: `02d5aecc-48cb-4ab1-8819-484f5f55de8d`.
- Deployed version: `864ea69d-fee6-4f68-8ec6-fefa8c1c4770`.
- URL: <https://querymind.digitalaaronl.workers.dev>.
- Deployment used a temporary configuration with no repository preview `vars`
  and `--keep-vars`; it uploaded the Worker plus `/app.js` and `/styles.css`.
  It did not run a D1 migration or alter secrets, bindings, Gateway settings,
  or production variables.
- `GET /` and `GET /health`: HTTP 200. Health reports `environment=production`,
  `ai=ready`, both D1 bindings `ok`, and P0 policy migration `0006` with 72
  active policies.
- Anonymous `GET /api/v1/semantics`: HTTP 401, as required.
- Read-only remote D1 verification returned snapshot
  `9fc08cbf8ee017c5f6041f7eaa6b7a0b0411b185f4d7e503e0ca47ecdc3b49d3`,
  `registry_version=0`, and zero assets, revisions, and reviews. The D1 command
  reported `rows_written=0` and `changed_db=false`.

### Remaining manual smoke

The deployment environment has no safe Owner/DBA browser session. An authorized
operator must therefore log in and record: Semantic Registry navigation and
empty state; authenticated `GET /api/v1/semantics` returning `items=[]` and
`total=0`; and one existing authorized chat confirming P1 explainability. No
production semantic asset, role, user, policy, or credential should be created
for this smoke.

## P2-C Closeout Regression Hotfix — 2026-08-24

### Finding and bounded correction

Read-only production evidence showed the affected Owner query runs still retain
both `rawSqlAvailable=true` and non-empty verified SQL in their deterministic
P1 explainability envelopes. The Owner role retains `view_schema`; the P0
governed execution path did not regress. The apparent SQL loss was therefore
the native HTML disclosure being closed by default, leaving only its summary
(`檢視已驗證 SQL`) visible.

The static UI now sets `open` only on the existing disclosure that is already
rendered when both `rawSqlAvailable` and a non-empty SQL string are present.
No data reaches any caller that did not already satisfy the P1 SQL capability
check. Whitespace SQL remains hidden, as before.

### Regression and release evidence

- Browser regression now asserts that an authorized Owner’s verified SQL
  disclosure is open, visible, and contains the governed SQL. The existing
  whitespace-SQL regression continues to assert that it renders neither a SQL
  tab nor disclosure.
- `npm run check`: PASS; unit: 87/87; product/RBAC/Semantic E2E: 17/17;
  disposable D1: app 0001–0009 and data 0001; full suite: 104/104;
  JavaScript syntax and diff checks: PASS.
- Production-safe dry run passed at 226.68 KiB / gzip 49.85 KiB. Worker
  `5e4ca4b6-8ba1-4259-b2ea-25e6dc9bbfaa` was then deployed using a temporary
  no-preview-vars configuration and `--keep-vars`; only `/app.js` changed.
- Production `GET /` is 200; health reports `environment=production`,
  `ai=ready`, both D1 bindings `ok`, and P0 policy count 72. Anonymous
  semantics remains HTTP 401. The served bundle contains the open disclosure.
- Post-deploy remote D1 verification was read-only and returned
  `registry_version=0`, zero semantic assets/revisions/reviews,
  `rows_written=0`, and `changed_db=false`.

The remaining operator action is a normal authenticated Owner/DBA chat smoke:
run an existing authorized query and confirm the verified SQL is visible
immediately. Do not create any semantic asset or mutate policy state for it.

## Known Limitations and Future Boundaries

- Revision History has metadata only until P2-B exposes a safe historical
  revision-content endpoint.
- Asset-level identity metadata is not editable in P2-B; P2-C edits only the
  supported draft revision contract, aliases, and change reason.
- P2-D (AI schema intelligence), P2-E (approval/deprecation/publication), and
  P2-F (EffectiveScope-filtered runtime semantic context) are not implemented.
- The P0 SQL tokenizer/parser and Cloudflare D1 execution limitations recorded
  in the frozen baseline are unchanged.

No P2-D, P2-E, or P2-F behavior is introduced by this release.
