# P2-E Human Semantic Approval & Publication Governance

**Status:** implemented in the current release candidate; production deployment remains gated on the documented release checks.

**Baseline:** P2-A/P2-B/P2-C/P2-D and P0/P1/P1.2 protected boundaries. The actual Worker and D1 code remain authoritative.

## 1. Scope and non-goals

P2-E governs human review, approval, publication, emergency publication, and runtime eligibility of Semantic Registry revisions. It does not execute business SQL and does not change the P0 QueryPolicyEngine boundary.

Out of scope: P2-F approved-semantic runtime injection; P2-G semantic evidence hooks; automatic learning; prompt optimization; model training/fine-tuning; business SQL execution from the Semantic Registry; and feedback-driven automatic semantic creation.

## 2. Capabilities and authority

Use explicit capabilities, never a new wildcard privilege:

| Capability | Purpose | Required scope |
|---|---|---|
| `view_semantics` | Read registry/revision/review evidence | existing read scope |
| `manage_semantic_drafts` | Create/edit/submit Draft revisions | existing design-time scope |
| `review_semantics` | Request changes or reject an `IN_REVIEW` revision | domain/asset review scope |
| `approve_semantics` | Complete ordinary approval and publish an eligible revision | domain by default; asset-specific for high risk |
| `emergency_publish_semantics` | Temporary break-glass publication | explicit incident/change scope, reason, deadline, and audit |
| `suspend_semantics_runtime` | Mark a known-critical Approved semantic ineligible for new runtime use | governed domain/asset scope |
| `resume_semantics_runtime` | Remove a suspension after required review | governed domain/asset scope and post-review evidence |
| `manage_semantic_governance` | Configure policy and named human RACI assignments | governance administration only; does not confer approval authority |

System Owner is not automatically a Semantic Owner. DBA is not automatically an approver. Domain Data Owners/Stewards are assigned through RACI configuration. AI is a Review Assistant only and never satisfies an approval slot.

## 3. State machine

```text
DRAFT -> IN_REVIEW -> {DRAFT (request changes), REJECTED}
IN_REVIEW -> deterministic validation -> quorum/SoD validation
           -> APPROVED -> atomic current_approved_revision_id switch
           -> registry_version + 1
APPROVED remains immutable; a later publication only advances the asset's current pointer
APPROVED <-> runtime_eligibility {ELIGIBLE, SUSPENDED} (history is immutable)
IN_REVIEW -> APPROVED through an EMERGENCY publication record (post-review due)
EMERGENCY publication -> post_review {CONFIRMED, REQUIRES_CORRECTION}
```

An Approved revision and its approval evidence are immutable. Corrections create a new revision. Historical QueryRuns are never rewritten. A personal/session alias can resolve a name only; it cannot redefine a formula. Enterprise canonical and domain-approved variants remain distinct, and ambiguous cross-domain meaning must ask rather than silently publish.

## 4. Deterministic approval validator

The Worker must evaluate every check in deterministic code before any mutation:

1. Browser session, active user, explicit capability, domain/asset authority, and current EffectiveScope.
2. Proposer/approver separation of duties, risk-based exceptions for configured low-risk assets, quorum, and duplicate-slot prevention. AI never counts as a Human approver.
3. Revision lifecycle (`IN_REVIEW` only for ordinary approval; rejected/Draft/approved revisions cannot bypass the configured transition).
4. Current schema snapshot and stale-snapshot rejection.
5. Semantic completeness: canonical identity, display/definition, aliases, grain, sources, and dependency exact revision pins.
6. Metric AST size/operator/type bounds, physical grain anchors, authorized sources, FK/relationship/cardinality integrity, alias normalization, duplicate/canonical conflict detection, and cycle detection.
7. Runtime eligibility, high-risk classification (Finance/HR/Executive/Sensitive), and required dual approval for configured high-risk assets.
8. Break-glass reason, incident/change reference, Emergency/Temporary marker, expiration/review deadline, dedicated capability, and mandatory post-review obligation.

AI output may pre-populate advisory review notes, but missing or failed deterministic checks always deny publication.

## 5. Atomic publication transaction

One D1 batch/transaction must guard and atomically update:

* revision status and immutable approval fields;
* `semantic_assets.current_approved_revision_id`;
* `semantic_registry_state.registry_version` (exactly once);
* approval/quorum evidence;
* bounded audit event; and
* a publication manifest/reference containing asset, revision, schema snapshot, validator version, and before/after registry versions.

All statements must include the expected revision, asset status, snapshot, and current pointer preconditions. If any statement fails, the previous Approved pointer, revision, registry version, and evidence remain usable and consistent. Suspension/resume is an eligibility mutation and must never rewrite approval history.

## 6. Implemented API contract

All mutation endpoints require a browser session, explicit capability, EffectiveScope/domain authorization, bounded JSON, no business-row reads, no SQL execution, and redacted audit metadata.

| Endpoint | Contract |
|---|---|
| `GET/POST /api/v1/semantics/governance/policies` | List/create domain or asset policy; browser session and `manage_semantic_governance` required. |
| `POST /api/v1/semantics/governance/authorities` | Create an explicit, active RACI assignment; browser session and `manage_semantic_governance` required. |
| `POST /api/v1/semantics/:assetId/revisions/:revisionId/approve` | Ordinary approval; bounded idempotency key and optional comment. Runs deterministic validation/quorum and atomically publishes only when complete. |
| `POST /api/v1/semantics/:assetId/revisions/:revisionId/emergency-publish` | Requires `emergency_publish_semantics`; reason, incident/change reference, and future post-review deadline are mandatory. |
| `POST /api/v1/semantics/:assetId/revisions/:revisionId/suspend-runtime` | Requires `suspend_semantics_runtime`; records bounded reason and effective time without changing historical revision. |
| `POST /api/v1/semantics/:assetId/revisions/:revisionId/resume-runtime` | Requires `resume_semantics_runtime`; validates post-review obligations before restoring eligibility. |
| `GET /api/v1/semantics/:assetId/revisions/:revisionId/approval` | Returns readiness, failures, proposer, required roles/domain, SoD, quorum, risk, evidence, and publication reference. |
| `GET /api/v1/semantics/:assetId/revisions/:revisionId/approval-history` | Bounded immutable review/approval/suspension history; no secrets, rows, predicates, or credentials. |
| `GET /api/v1/semantics/:assetId/revisions/:revisionId/approval` | The implemented readiness endpoint is also the deterministic requirement view. |

Idempotency keys are scoped to the actor, asset, revision, and operation. Replay returns the prior result; a concurrent pointer or snapshot change fails closed with a conflict.

## 7. UI contract

The Semantic Registry review view must show approval readiness, deterministic validation failures, proposer, required approver role/domain, SoD status, approval count/quorum, high-risk indicator, source/grain/dependency evidence, schema snapshot, and a revision diff. `Approve` and `Reject/Request Changes` are separate actions. Break-glass is visually separated, permission-gated, and displays temporary expiry and post-review obligations. A suspended runtime warning is persistent. AI notes are explicitly labelled **advisory** and cannot appear as approval evidence.

## 8. Audit model

For every transition, retain bounded evidence sufficient to reconstruct: proposer; reviewers/approvers; capability and scope used; asset/revision; schema snapshot; validator version/result; approval sequence/quorum; publication time; registry version before/after; break-glass reason/reference/deadline; and suspension/resume history.

Never log secrets, business rows, raw row predicates, credentials, provider tokens, or unnecessary sensitive comments. Audit payloads contain identifiers, hashes, enums, and bounded reasons only.

## 9. Pre-implementation test matrix

*Authorization:* unauthorized approval denied; System Owner without semantic authority denied; wrong-domain approver denied.

*Lifecycle:* Draft cannot be approved directly when `IN_REVIEW` is required; rejected revision cannot publish; Approved revision is immutable.

*SoD:* configured low-risk self-approval only; prohibited self-approval denied; incomplete dual approval does not publish; one actor cannot fill two Human slots.

*AI:* recommendation cannot change lifecycle; AI cannot satisfy quorum.

*Publication:* pointer switch is atomic; registry version increments exactly once; failed publication leaves the old current revision intact.

*Break-glass:* dedicated capability, reason, reference, temporary marker, deadline, and post-review obligation are enforced and audited.

*Known-bad semantic:* suspension blocks future runtime eligibility while historical revision/evidence remain unchanged.

*Cross-domain:* canonical/domain variants remain distinct; aliases cannot redefine formulas; ambiguous resolution is not silently published.

*Regression:* P0/P1/P1.2/P2-A/B/C/D results remain unchanged; suggestion generation remains suggestion-only; no production business-data reads are introduced.

## 10. Explicitly forbidden future regressions

No direct `QUERYMIND_DATA` execution outside the governed execution boundary; no full schema before EffectiveScope; no LLM authorization; no independent export authorization; no AI-generated row policy; no write-enabled AI SQL; no feedback-to-production behavior shortcut; and no mutation of historical Approved revisions.
