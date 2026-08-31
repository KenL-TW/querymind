# QueryMind P2-F Approved Runtime Semantic Context

## Code implementation record

P2-F introduces the read-only `ApprovedSemanticContextResolver` in
`cloudflare/src/lib/approved-semantic-context.ts`. The Chat preparation path
now resolves authentication, capability, `EffectiveScope`, and the structured
`AuthorizedSchemaCatalog` before it can invoke the resolver or construct model
context. Direct Query is deterministic SQL execution and does not receive
semantic model context.

The resolver permits only ACTIVE assets whose current revision is APPROVED,
published, ELIGIBLE, schema-snapshot compatible, source-authorized, and whose
exact pinned dependencies pass the same checks. It excludes broken, suspended,
stale, unauthorized, malformed, or cyclic candidates. It never upgrades a
pinned dependency by name or revision. Cross-domain ambiguity returns a
bounded ASK response containing only already-authorized labels.

The model projection is bounded to 128 scanned candidates, 8 selected assets,
8 aliases and dependencies per asset, 4 relationship expansions, 800
definition characters per item, and 12,000 serialized bytes. It carries
structured AST data rather than SQL, escapes delimiter characters, omits
governance administration and EffectiveScope details, and is explicitly marked
as inert untrusted data in the system prompt. Registry version is read before
and after resolution; drift discards the context and falls back to P1. No
cross-request cache is used.

`SEMANTIC_RUNTIME_CONTEXT_ENABLED` defaults to `false`. This preserves the P1
path and makes empty production registry state (`registry_version = 0`) a valid
fallback. Resolver telemetry logs only bounded operational counters; it never
logs prompt text, scope keys, source predicates, or semantic payloads.

## Verification status

- TypeScript binding generation and typecheck: PASS.
- Disposable APP `0001`–`0012` and DATA `0001` initialization: PASS.
- Existing P0/P1/P2 unit suite plus P2-F: 106/106 PASS.
- New P2-F resolver suite: 9/9 PASS.
- Authenticated local bootstrap and schema refresh: PASS (200).
- Product/RBAC/semantic E2E: 20/20 PASS.
- Clean local full suite: 128/128 PASS.
- GAP-034 root cause and physical D1 evidence: [GAP-034 record](gap-034-root-cause.md).
- Migration immutability, release manifests, and production-compatible Worker
  dry-run: PASS.
- GitHub Actions: PASS, run `33352997498` for commit `b84b2e2` (both
  `cloudflare-runtime` and `legacy-regression-only`).

## Production deployment and freeze (2026-08-31)

The P2-E authenticated closeout and GAP-034 are recorded by the release owner
as PASS/CLOSED. P2-F runtime source
`fa697520de324fc503ef86ffeb67251217193e99` was deployed to Worker
`9b2cc079-066f-4df0-b9aa-e2d10a910f2f` at `2026-08-31T10:04:24.538929Z`.
The immediate rollback Worker is
`24622697-5acd-48ef-bbc8-58016589e129`.

No migration was added or applied. Remote APP remains `0001`–`0012`, DATA
remains `0001`, and both ledgers report no pending migration. Public `/` and
`/health` smoke passed: production environment, AI ready, APP/DATA healthy,
and P0 policy count `72`. The schema snapshot remains
`9fc08cbf8ee017c5f6041f7eaa6b7a0b0411b185f4d7e503e0ca47ecdc3b49d3` with
14 catalog tables and 115 columns.

`SEMANTIC_RUNTIME_CONTEXT_ENABLED` is intentionally absent from the preserved
production bindings; the strict runtime check treats any value except literal
`"true"` as `false`. P2-F capability is therefore deployed while semantic
activation remains disabled. The empty registry fallback uses the existing P1
path. Operator-authenticated canonical-query evidence is PASS under the closed
release gate; this release environment did not handle a browser session or any
credential.

Read-only post-deploy verification recorded registry/assets/revisions/reviews/
publications/approvals/authorities as `0/0/0/0/0/0/0`, with
`rows_written=0` and `changed_db=false`. No semantic state, authority, policy,
user, secret, or QUERYMIND_DATA row changed. Bounded public smoke found no
schema bootstrap or resolver 5xx; a passive live-log connection returned no
matching invocation event.

The P2-F production manifest is
[`p2-f-production.json`](manifests/p2-f-production.json). The release is
frozen with P0/P1/P2-E boundaries intact. P2-G semantic evidence is not
implemented.

P2-G semantic evidence and explainability changes are not implemented. P2-F
retains selected asset/revision/domain/type/version only in request-local state.
