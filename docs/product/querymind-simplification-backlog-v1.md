# QueryMind Simplification Backlog V1

**Status:** PX-01 navigation, PX-02 explainable-answer experience, and PX-03 contextual Save to Library are implemented, verified, and deployed to Cloudflare Production on 2026-10-07. See [release record](../releases/px-product-simplification-production-release.md).
**Source:** [Product Simplification Audit V1](querymind-product-simplification-audit-v1.md).

**Phase mapping:** The delivered product phase named PX-02 in the closeout report is the explainable-answer change in legacy backlog row PX-03. Legacy row PX-02 (Dashboard/Ask consolidation) was absorbed by PX-01's Ask-first route. PX-03 delivered the contextual-Save slice from legacy row PX-07. This mapping preserves the original audit IDs while keeping the current delivery sequence clear.

Priority is based on confusion reduction, workflow continuity, navigation reduction, risk, and implementation effort. Product P0 means the first simplification priority; it is not a P0 security incident classification.

## 1. Prioritized backlog

### Product P0 — remove the first navigation decision

| ID | Problem | Proposed change | Persona / value | Complexity / risk | Dependencies | Acceptance criteria |
|---|---|---|---|---|---|---|
| PX-01 | Owner sees 17 flat first-level links; Business and Governance jobs mix together. | Introduce capability-filtered Business and Governance workspace groups; default authenticated Business entry to Ask. Keep legacy hash routes as aliases during transition. | All; very high confusion and navigation reduction. | Medium / Medium (deep links and role visibility). | Confirm current route inventory; preserve role/capability contract. | Viewer sees Ask/History/Library only for capabilities; DBA sees permitted governance tasks; governance admin sees settings only with `manage_semantic_governance`; all old links resolve; API denial tests still pass. |
| PX-02 | Dashboard and Chat both present an ask entry, so the product starts with a choice rather than a task. | Remove standalone Dashboard; move quick prompts and recent conversations to Ask. Move admin activity to Audit & System. | Business/System Owner; high decision-latency reduction. | Low / Low. | PX-01 shell. | Login lands on Ask; prompts start a chat; recent audit is not presented as business query content; no dashboard API data loss. |
| PX-03 | Result trust detail competes with answer/result and technical terminology. | Restructure result around answer and table/chart; add progressive “Why this answer?” sections; collapse verified SQL by default. | Business/Analyst; very high trust with lower cognitive load. | Medium / High (must preserve trust evidence and capability gate). | P1 explainability contract; design review with data users. | Deterministic evidence unchanged; SQL absent unless allowed; no scope keys/predicates/secrets; successful result/feedback ownership invariants pass. |

### Product P1 — make governance and reuse coherent

| ID | Problem | Proposed change | Persona / value | Complexity / risk | Dependencies | Acceptance criteria |
|---|---|---|---|---|---|---|
| PX-04 | Registry, AI Suggestions, Draft, Revision, Review, Approval, Publication are separate navigation/workspace concepts. | Rename Registry to Definitions; combine manual and AI-assisted definition creation; add Needs Review queue and lifecycle timeline. | Data Owner/DBA/Reviewer; high workflow continuity. | High / High (governance states must stay distinct). | P2 lifecycle contracts; P2-Ia governance baseline closeout; test matrix. | Suggestions remain advisory; explicit draft save; only reviewer/relevant approver actions appear; approval requires explicit authority/policy/quorum/SoD; publication and runtime eligibility shown separately; no change to registry/runtime flags. |
| PX-05 | Authority and Policy settings are peer top-level pages beside daily definition work. | Move into Governance Settings under Audit & System; present a current/proposed review and auditable lifecycle. | System Owner; medium navigation reduction and high correctness. | Medium / High. | PX-01; independent P2-Ia3/GAP-036 blocker reconciled first. | `manage_semantic_governance` enforced on page and endpoint; browser session and audit remain; atomic Replace/read-back retained; Owner/DBA not implicit approvers. |
| PX-06 | Schema and Source screens both show data source/catalog status; refresh button is duplicated. | Consolidate as Data Sources with catalog detail and explicit DBA refresh action. | DBA/Analyst; medium. | Low / Medium (schema visibility). | Existing `/schema`, `/schema/refresh`, `/admin/connection` contracts. | `view_schema` and EffectiveScope remain required for catalog; `refresh_schema` and browser session for refresh; no full schema exposure. |
| PX-07 | Dictionary, Templates, and Saved Insights are separate entry points for meanings and reuse. | Put saved analysis and team question starters in Library; represent helper vocabulary under Definitions with a trust label; add contextual Save after successful answer. | Business; high workflow continuity. | Medium / Medium (saved SQL reauthorization). | Ownership behavior in insights/templates/dictionary APIs. | Own/shared boundaries remain; saved SQL is reauthorized on rerun; no direct result bypass; dictionary helper terms are never presented as approved semantic truth. |
| PX-08 | Access tasks split among Users, Roles, Invitations, and API Key modals. | Consolidate into Access with Members, Role policies and Invitations; API keys remain per-user advanced detail. | System Owner; medium. | Medium / High (credential lifecycle). | Existing `manage_users` and one-time token/key behaviors. | No key/token persisted in UI after close; one-time secret display, hashed storage, revocation and audit unchanged; role capability allowlist and Owner protections remain. |
| PX-09 | Usage and Profile are primary/sidebar views despite low-frequency account tasks. | Move to account menu; retain usage summary there. | All; moderate navigation reduction. | Low / Low. | Current `view_own_usage` and auth routes. | Account details remain owner-specific; no cross-user usage leakage. |

### Product P2 — reduce long-term maintenance cost and validate with users

| ID | Problem | Proposed change | Persona / value | Complexity / risk | Dependencies | Acceptance criteria |
|---|---|---|---|---|---|---|
| PX-10 | One 1,065-line `app.js` coordinates all state, routing, API, auth, semantic and admin flows. | Extract modules incrementally by stable user job: shell/auth, query/result, library, governance definitions, access/admin. Keep static SPA and Worker assets. | Product engineering; medium maintainability value. | Medium-high / Medium (regression). | PX-01–08 route and component contracts; full regression harness. | One owner per module; no duplicate route/capability definitions where avoidable; no React/Vue/Next rewrite required; test suites remain deterministic. |
| PX-11 | UI priority/frequency is inferred; no evidence shows which secondary features are used. | Define privacy-safe product metrics for task completion and navigation; collect only approved aggregate event data. | All; improves prioritization. | Medium / Medium (privacy/retention). | Explicit product/privacy review; existing audit is not a substitute for analytics consent. | Metrics have bounded purpose/retention, no prompt/result content, no credential data, and are not used as authorization. |
| PX-12 | Business users may not understand answer confidence/caveats or “what can I do next?” | Conduct task-based usability checks on Ask, History, Library and Why this answer; iterate copy/hierarchy. | Business; high decision latency and trust. | Medium / Low. | PX-01 and PX-03 prototype. | Representative users complete ask → verify → follow-up → save without understanding schema/governance internals; no trust claims exceed runtime evidence. |
| PX-13 | Definitions lifecycle labels may expose engineering state rather than user decision. | Validate plain-language status mapping for Draft / Needs review / Approved / Published / Eligible. | Governance; high clarity. | Medium / High (state distinction). | PX-04; P2-E/F/G/H semantics. | Mapping is reversible to deterministic stored states; no merge of approval/publication/eligibility; audit detail remains exact. |

## 2. Implementation waves

| Wave | Scope | Exit condition |
|---|---|---|
| PX-0 — Source and governance baseline | Reconcile documentation against current Worker, migrations and dated Production evidence; separately close P2-Ia3/GAP-036 by its approved governance process. | Handover is current; Production governance truth is independently read back; no UX action changed policy. |
| PX-1 — Persona/JTBD/IA | Review this audit with representative Business and Governance users; approve labels and capability map. | One approved target tree; no role names substituted for capabilities. |
| PX-2 — Navigation shell | PX-01 and PX-02; role/capability grouping and Ask as home while keeping routes. | Navigation and deep-link/security regressions green. |
| PX-3 — Core query experience | PX-03, result footer actions, History and contextual Save/Export. | Query, explanation, feedback, SQL and export security matrix passes. |
| PX-4 — Governance workspace | PX-04 and PX-05, then PX-06. | Full Semantic lifecycle remains deterministic and audit-backed; no asset state created as a side effect of UI work. |
| PX-5 — Library and Access | PX-07–09. | Ownership, saved SQL reauthorization, API key/invite handling and feature capability checks pass. |
| PX-6 — Frontend modularization | PX-10 only after IA stabilizes. | Incremental extraction without changing runtime boundary or framework. |
| PX-7 — Validation and instrumentation | PX-11–13; usability tests and privacy review. | Measured friction improvement with no content/credential telemetry and all security gates green. |

PX-01, PX-02, and PX-03 are complete locally. The next recommended slice is one **PX-04: Definitions workspace consolidation**, with a current governance-baseline preflight before any workflow changes. Keep the human review/approval/publication/runtime states distinct and do not create Semantic assets as a side effect of UI work.

## 5. PX-01 implementation checkpoint — 2026-10-07

The PX-01 UI changes are present in the working tree. Business navigation is limited to Ask, History, and Library; Governance is a separate capability-filtered disclosure; account usage is no longer a primary navigation item. Legacy page destinations remain available, with dashboard/ask/definitions/review routes mapped to their current canonical views. The backend, migrations, and Production were not changed.

PX-01 status: **COMPLETE locally**. A disposable local Worker and D1 passed route, product/RBAC E2E, and full-regression checks; typecheck, migration immutability, and Worker dry-run passed. The initial sandbox ACL restrictions were isolated to local Wrangler/Chromium process permissions and required an elevated local run; no source workaround or remote state change was made. Evidence is recorded in [PX-01 implementation evidence](px-01-navigation-implementation.md) and the [PX-02 closeout](px-02-explainable-answer-experience.md).

## 6. PX-02 explainable answer checkpoint — 2026-10-07

PX-02 status: **COMPLETE locally**. The answer and primary result now lead, evidence is collapsed and grouped, verified SQL is nested under a capability-gated Advanced disclosure, semantic provenance stays observational, and feedback correction stays collapsed until requested. Final clean-D1 regression and screenshot evidence are recorded in [PX-02 Explainable Answer Experience](px-02-explainable-answer-experience.md). No Worker API, migration, Production data or deployment changed.

## 7. PX-03 contextual Save checkpoint — 2026-10-07

PX-03 is **COMPLETE locally**. It reuses the owner-scoped `insights` persistence and API, adds a contextual successful-result action, and brings Saved analyses to the top of Library while keeping Templates distinct and the Dictionary secondary. Contextual saves do not copy SQL or result rows; existing saved SQL reruns continue through the governed query route under current scope. No migration, Production mutation, deployment or fourth primary navigation item was introduced. See [PX-03 closeout and evidence](px-03-contextual-save-to-library.md).

## 3. Do Not Build Yet

- Dashboard widgets or another analytics overview without a proven operator decision.
- Additional AI agents, multi-agent orchestration, vector/RAG, or agent memory.
- More Semantic screens that mirror each new backend table or status.
- A React/Vue/Next/Nuxt rewrite; the current evidence supports modularization, not a framework migration.
- P3/P4 planning or forecasting UX before the query workspace is simplified and validated.
- New direct SQL editor or SQL-writing ability; keep governed Direct Query as an advanced path if users prove the job.
- Automatic creation, approval, publication, runtime eligibility, scope, or policy from AI suggestions.
- Production semantic assets or enabling Semantic Runtime as part of this UX effort.
- Broad removal of technical evidence; hide details progressively and keep authorized audit access.

## 4. Release and safety gates for future slices

Each implementation wave must use the repository’s existing Cloudflare test and release gates appropriate to the changed path. At minimum, map changes against the full [security regression matrix](querymind-target-ia-v1.md#6-security-regression-matrix), then verify:

- Auth and feature RBAC on both UI and API; hidden UI is not considered authorization.
- EffectiveScope is resolved before authorized schema/context retrieval.
- Unauthorized tables/columns/rows cannot reach the LLM or execute.
- Chat, Direct Query, saved-insight rerun and export use the same QueryPolicyEngine boundary.
- DLP and row/byte limits remain active.
- Semantic capabilities, review capability, approval capability, explicit authority, quorum, separation of duties and audit remain distinct.
- Feedback remains successful-run and owner constrained; SQL remains capability-gated; export remains independently authorized.
- Semantic activation does not expand authorization; P2-G evidence stays observational; runtime flag remains unchanged unless separately authorized.
