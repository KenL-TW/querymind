# QueryMind P2-Ia Governance Bootstrap UI

## Scope

P2-Ia exposes the existing P2-E semantic governance contracts in the authenticated
Owner administration shell. It does not create Production governance records,
Semantic assets, revisions, publications, or runtime activation.

## Delivered

- Capability-gated **Authorities** and **Approval Policies** pages under Admin.
- Browser-session mutations only; no direct D1 or token/API-key flow.
- Existing active users are selectable for explicit authority assignment.
- Existing P2-E fields are exposed without adding new governance semantics.
- Bounded activation/deactivation endpoints for authority and policy state, with
  the existing semantic audit boundary.
- Role capabilities remain separate from `semantic_authorities` approval rights.

## Verification

- TypeScript typecheck: PASS.
- Browser JavaScript syntax and diff checks: PASS.
- P2-Ia UI/RBAC lifecycle tests: 3/3 PASS on disposable local D1.
- Full Playwright regression: 139/139 PASS with the existing semantic true-path
  contract enabled locally; no Production D1 was used.
- Disposable migrations: APP `0001`–`0012`, DATA `0001` PASS.

## Production safety

The deployment contains UI/backend integration only. The operator must create any
legitimate authority and policy through the Production UI. `SEMANTIC_RUNTIME_CONTEXT_ENABLED`
remains `false`; Production semantic registry and governance tables are not mutated.
