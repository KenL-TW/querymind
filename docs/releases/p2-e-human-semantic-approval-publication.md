# P2-E Human Semantic Approval & Publication Governance

## Release candidate scope

P2-E adds a design-time, human-only governance domain to QUERYMIND_APP through
additive migration `0012_semantic_approval_publication.sql`. It introduces
policy, named RACI authority, immutable approval decision, publication,
runtime-event, and idempotency records. It does not change QUERYMIND_DATA,
Chat, Direct Query, P0 QueryPolicyEngine, or P2-F runtime semantic injection.

## Protected behavior

- Product RBAC and explicit active RACI authority are both required; Owner and
  DBA are never implicit semantic approvers.
- Approval is fail-closed until a human administrator configures policy and
  authority. EffectiveScope is resolved before authorized catalog evidence is
  retrieved.
- Deterministic validation checks lifecycle, current schema snapshot,
  authorized sources, exact dependency pins, relationship direction,
  aliases, dependency cycles, SoD, and quorum. AI has no approval path.
- SQLite command guards and trigger application keep a normal or emergency
  publication atomic with the revision state, current pointer, registry epoch,
  evidence, and bounded audit event. Concurrent final approvals produce one
  publication and one epoch change.
- Break-glass is capability-separated and requires a bounded reason, change
  reference, future post-review deadline, and later human post-review.
- Suspend/resume changes only current runtime eligibility and preserves
  immutable publication/approval history.

## Local verification

| Gate | Result |
|---|---|
| TypeScript typecheck | PASS |
| Frontend syntax | PASS |
| APP/DATA disposable migration rehearsal | PASS; APP `0001`–`0012`, DATA `0001` |
| Migration immutability | PASS; protected `0006`–`0012` hashes |
| P2-E governance API tests | PASS; 2/2 |
| Full product/security/UI regression | PASS; 119/119 |
| Fresh clone | PASS; `npm ci` (0 vulnerabilities), check, migration rehearsal, and 119/119 |

## Production guardrails and next operation

No remote D1 migration, Worker deploy, policy/RACI configuration, secret
change, or semantic asset creation is included in this local record. Before
production release, complete clean-clone and CI gates, apply only APP migration
`0012` to the existing production APP D1, deploy with production variables
preserved, verify public health and anonymous denial, and then perform the
operator-owned authenticated governance smoke using existing human accounts.

Rollback is Worker-only. Do not attempt to roll back or edit the forward-only
APP migration; keep a pre-migration recovery export per the production runbook.
