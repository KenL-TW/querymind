# QueryMind P2-A — Semantic Persistence Foundation

**Status:** Local implementation complete; not a production release.

**Scope:** P2-A only. This report covers the additive semantic persistence/domain foundation and its local verification. It does not include P2-B APIs, UI, AI suggestions, runtime semantic context, P1 semantic evidence, remote migration, production configuration, or deployment.

## Files Changed

- `cloudflare/migrations/app/0008_governed_semantic_foundation.sql`
- `cloudflare/src/lib/semantic-types.ts`
- `cloudflare/src/lib/semantic-validation.ts`
- `cloudflare/src/lib/semantic-repository.ts`
- `cloudflare/src/lib/schema-catalog.ts` (stable snapshot identity only)
- `cloudflare/scripts/init-local-test.mjs`
- `cloudflare/package.json`
- `cloudflare/tests/semantic.spec.ts`
- `docs/sdd/p2-governed-semantic-foundation.md`

Existing P1/P1.1 worktree changes were preserved; no P0/P1 governed execution, policy, DLP, explainability, or feedback behavior was changed by P2-A. The only existing runtime edit is the explicitly authorized schema-catalog snapshot identity update.

## Migration

Migration 0008 is forward-only and additive. Migrations 0001–0007 were not edited. It adds the semantic registry, assets, revisions, normalized sources, aliases, relationship keys, and immutable review events, plus lookup indexes and bounded CHECK/UNIQUE/FK constraints. `current_approved_revision_id` intentionally has no direct FK because it would create a circular creation dependency; repository approval activation validates and switches the pointer atomically.

## Schema

The existing `schema_catalog_state` fields were `id`, `source_schema_version`, `refreshed_at`, and `table_count`; no stable catalog identity existed. Migration 0008 adds `schema_snapshot_id` with the safe initial value `uninitialized`. `refreshSchemaCatalog` computes a SHA-256 hex digest from sorted filtered table names and CREATE TABLE SQL and persists it. No catalog history, schema filtering, or prompt behavior was added.

Semantic dependencies store both `referenced_asset_id` and `referenced_revision_id` and use a composite FK to the exact revision identity. The semantic migration does not rely on a new `PRAGMA foreign_keys` side effect.

## Domain Model

- Assets have only `ACTIVE`/`DEPRECATED` lifecycle and retain a nullable current approved revision pointer.
- Revisions have `DRAFT`/`IN_REVIEW`/`APPROVED`/`REJECTED` lifecycle. Approved payload, source dependencies, aliases, relationship keys, formula, grain, and filters are immutable.
- Relationship keys are normalized as ordered rows; composite keys are bounded and conditional/arbitrary joins are rejected.
- `semantic_sources` contains only `TABLE`, `COLUMN`, and `SEMANTIC_DEPENDENCY`; no executable SQL or row predicate is persisted.
- `semantic_registry_state.global` starts at version 0 and changes only when approved truth is activated or an ACTIVE asset is deprecated.

## Validation

The strict validator bounds payload bytes, names, aliases, AST depth/nodes, literals, filters, sources, dependencies, grain keys, and relationship keys. It rejects unknown fields (including SQL, row policy, scope keys, authorization grants, credential/token fields), unsafe identifiers, unsupported operators, ambiguous COUNT forms, missing divide-by-zero behavior, unanchored grains, duplicate aliases/keys, and unpinned dependencies. It extracts deterministic physical/dependency rows from approved-shape contracts; it does not compile SQL or authorize data.

## Atomicity Strategy

Approval activation is an internal repository primitive, not a public route. A single `D1Database.batch()` conditionally performs: `IN_REVIEW → APPROVED`, current pointer switch, registry version increment, and an `APPROVED` review event. Each statement repeats the relevant status/asset/timestamp preconditions; a stale or double approval returns a conflict and no version is read. Draft updates, submission, and deprecation use guarded operations; approved revisions cannot be updated. D1 batch is the supported atomic primitive—no unsupported interactive transaction is assumed.

## Tests

Added `cloudflare/tests/semantic.spec.ts` covering metric ASTs, explicit COUNT variants, arithmetic/divide semantics, grain anchors, relationships/composite keys, aliases, security shape, dependency pinning, approved immutability, approval atomicity, review events, and deterministic schema snapshots. The local bootstrap now applies and verifies app migrations 0001–0008, all expected semantic tables, registry seed, and `schema_snapshot_id`.

Final local verification results:

- `npm run check` — PASS (Wrangler types + strict TypeScript).
- `npm run test:db:init` — PASS (clean disposable data/app D1; 0001–0008; tables, indexes, FK/CHECK/UNIQUE assertions, registry seed, snapshot column).
- `npm run test:unit` — PASS, 82/82.
- `npm run test:e2e` — PASS, 12/12 against the disposable local Worker (installed Chrome channel; no dependency installation).
- `npm run test:all` — PASS, 94/94.
- `node --check public/app.js` — PASS.
- `git diff --check` — PASS (only normal line-ending warnings).
- Wrangler Worker `deploy --dry-run` — PASS; no upload occurred.

## P0/P1 Regression

The existing security, explainability, and product tests remain in the unit/all suites. P2-A adds no query executor, prompt/context path, QueryPolicyEngine, EffectiveScope, DLP, export, saved-insight, explainability, or feedback behavior.

## Known Limitations

- P2-A validates contract shape and safe physical identifiers; catalog existence/staleness enforcement belongs to the later approval layer.
- No SQL compiler, semantic runtime context, semantic authorization, AI suggestion flow, public API/UI, or P1 semantic evidence exists yet.
- D1 batch atomicity is used for repository primitives, but D1 remains bounded by statement/parameter/runtime limits; source/alias batches are intentionally bounded by validator limits.
- The schema snapshot is an identity of the current filtered DDL catalog, not a history or diff store; the initial row remains `uninitialized` until catalog refresh.

## Next Stage

P2-B may add governed semantic list/detail/draft/review APIs and audit integration after a separate authorization review. P2-B must preserve the frozen P0/P1 boundaries and must not expose this persistence foundation directly to the production model path.

## Deployment

No remote migration, `wrangler d1 migrations apply`, secret/configuration change, or Worker deployment was run for P2-A.
