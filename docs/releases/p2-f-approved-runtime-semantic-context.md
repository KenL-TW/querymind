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

## Deployment decision

No migration was added. No production Semantic Registry state was created,
changed, approved, published, suspended, or resumed. Production deployment is
withheld: P2-E authenticated governance closeout remains BLOCKED even though
the P2-F release-quality gate is green. The current production Worker
`24622697-5acd-48ef-bbc8-58016589e129` remains unchanged; its recorded rollback
Worker is `0adc14e9-6e86-4bbf-93bf-fe476c8f20e4`.

P2-G semantic evidence and explainability changes are not implemented. P2-F
retains selected asset/revision/domain/type/version only in request-local state.
