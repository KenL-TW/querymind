# QueryMind Product Simplification Audit V1

**Status:** COMPLETE — source-backed product and information-architecture audit
**Repository baseline:** `main` at `40f01ac` (`feat: make semantic governance replacement atomic`)
**Audit date:** 2026-10-07
**Scope:** Cloudflare Worker product in `cloudflare/`; legacy Python/Nuxt/AWS assets are not treated as current production UX.

This is an audit and design proposal. It does not change application behavior, APIs, migrations, production governance, feature flags, or deployment configuration.

## 1. Executive diagnosis

QueryMind feels complex because its navigation and page structure expose implementation domains instead of the jobs people came to do. The Business user has to choose between a dashboard, AI conversation, templates, insights, schema, dictionary, usage, and data source even though the principal job is to ask a question, understand the answer, and continue working. Governance users see definition authoring, AI suggestions, revisions, review, approval, publication, and runtime eligibility as separate concepts even though those are stages of one governed definition workflow.

### Top five complexity drivers

1. **One flat, role-filtered sidebar mixes jobs and administrative machinery.** `shell()` renders analysis, data governance, workspace administration, semantic authority, and policy links in the same navigation. The Owner view has 17 first-level links. Hiding links by capability is useful access control feedback, but it is not an information architecture.
2. **The semantic backend lifecycle is translated almost one-for-one into UI surfaces and terms.** The `semantics` route has Assets and AI Suggestions workspaces, a six-tab asset detail (seven with reviewer capability), and separate Admin Authority and Approval Policy pages. The same person must learn “Asset,” “Revision,” “Schema Snapshot,” “Authority,” “Quorum,” “Publication,” and “Runtime Eligibility” to complete one definition task.
3. **Related work is split across pages or duplicated.** Dashboard and Chat both start a question; Schema and Data Source both show schema/source status and refresh concepts; Saved Insights and Templates both help repeat analysis; Business Dictionary and Semantic Definitions both present business meaning but have different trust/lifecycle contracts.
4. **A successful answer has high simultaneous information density.** The result view places understanding, source/governance checks, calculation, semantic evidence, SQL, feedback, and table/chart controls in one response. The SQL disclosure is rendered open by default when the capability permits it. This makes all trust evidence visible, but gives a business user little hierarchy.
5. **The frontend is a large shared state machine with no module boundary.** `cloudflare/public/app.js` is 1,065 lines and contains route metadata, shared mutable state, API/cache behavior, authentication, query/session flows, all admin pages, semantic composer/lifecycle, and event binding. `styles.css` is 3,305 lines. Route and capability checks are hand-maintained in several maps; adding product capability grows coupling.

## 2. Audit method and evidence boundaries

The current source of truth was reconstructed from `cloudflare/public/app.js`, `cloudflare/public/index.html`, `cloudflare/src/index.ts`, `cloudflare/src/routes/*`, `cloudflare/src/lib/*`, `cloudflare/migrations/app/0001–0013`, `cloudflare/migrations/data/0001`, and `cloudflare/tests/*.spec.ts`. Release, handover, SDD, and architecture documents were checked after code.

Navigation and page content below are evidenced by source templates and route bindings, rather than inferred from old roadmaps. Frequency is a product judgment based on the stated jobs and the UI's own default/primary placement; production usage telemetry was not queried for this audit. “High/Medium/Low” therefore means expected task frequency, not measured analytics. The audit reviewed existing tests but did not rerun them; it did not use an authenticated live browser session.

The product currently uses the Cloudflare Worker SPA (`cloudflare/src/index.ts` and `cloudflare/public/`). The 18 authenticated hash views are listed in `PAGE_TITLES`/`VIEWS`; login, first-owner bootstrap, and invitation acceptance add three unauthenticated entry screens. For an Owner with all capabilities, `shell()` renders 16 static links plus the dynamically installed Semantic Registry link: 17 first-level navigation items. Profile is opened from the account control, not the sidebar. The Semantic Registry has sub-workspaces and detail tabs inside one route.

## 3. Current Product Map

```text
QueryMind — current Cloudflare product
├─ Authentication / onboarding
│  ├─ Login
│  ├─ First-owner bootstrap
│  └─ Invitation preview and acceptance
├─ Analysis Workspace (shared sidebar)
│  ├─ Dashboard / 工作總覽
│  ├─ AI Chat / AI 對話
│  │  ├─ Session list, archive view, pin / rename / archive / delete
│  │  ├─ Answer, table / chart / SQL result tabs
│  │  ├─ Explainability and semantic evidence
│  │  ├─ Query feedback
│  │  └─ CSV export (capability-gated)
│  ├─ Schema
│  ├─ Business Dictionary
│  ├─ Query Templates
│  ├─ Saved Insights
│  └─ Usage
├─ Data Governance
│  └─ Data Source / connection and schema refresh status
├─ Semantic Governance (separate appended sidebar group)
│  └─ Semantic Registry
│     ├─ Semantic Assets
│     ├─ AI Suggestions
│     └─ Asset detail: overview, definition, sources, aliases,
│        revision history, approval; review tab for reviewers
├─ Workspace Administration (Owner/capability-gated)
│  ├─ Admin Overview
│  ├─ Users (role assignment, active state, reset password, API key modal)
│  ├─ Roles & capabilities
│  ├─ Semantic Authorities
│  ├─ Approval Policies
│  ├─ Invitations
│  ├─ Audit
│  └─ System / connection status
└─ Account control
   └─ Profile, change password, logout
```

## 4. Product Surface Inventory and decisions

The table captures each user-facing page, work area, or action family. API-only Direct Query is included because it is a supported product path, although the SPA has no dedicated SQL editor or Direct Query page. Decision counts in section 6 use exactly these 32 rows.

| # / Surface | Current route | Persona / actual job | Frequency / criticality / nav level | Backend capability / security requirement | Cognitive / terminology | Workflow dependency / duplication | Decision → target | Rationale |
|---|---|---|---|---|---|---|---|---|
| 1. Dashboard | `#/dashboard` | Business: decide what to ask next; admin: see summary | High / Core / Primary | `GET /dashboard`; authentication and own/workspace summary rules | Low / Low | Also links to Chat and Templates; duplicates primary ask entry | **REMOVE** → Ask landing content | Its quick prompts and recent activity are useful, but a separate metrics dashboard is not the core job. Move prompts/recent questions into Ask; admin activity belongs in Audit. |
| 2. Ask / Chat | `#/chat` | Business: ask a question and continue analysis | High / Core / Primary | `chat`; server authentication/RBAC, EffectiveScope, Authorized Catalog, QueryPolicyEngine, DLP, limits | Medium / Medium | Creates/uses session, returns governed result | **KEEP** → Business Workspace / Ask | This is the north-star product job and should become default entry. |
| 3. Sessions / History | Chat session pane; `/api/v1/sessions` | Business: resume, find, organize past work | High / Core / Contextual | `manage_own_sessions`; Worker verifies owner per session | Low / Low | History is part of Ask continuity, not a separate task family | **MERGE** → History | Give it a durable destination while keeping the recent conversation list beside Ask. Archive, pin, rename, restore, and delete remain actions on a session. |
| 4. Results: table / chart | Chat result component | Business: inspect answer data | High / Core / Contextual | Governed query result; result row/byte budgets and DLP | Low / Low | Follows a successful query; presentation only | **KEEP** → Ask result | Preserve as the primary result surface with clear next actions. |
| 5. Explainability | Inside successful result | Business: verify why answer is trustworthy | High / Core / Contextual | Deterministic P1 explainability from governed run; no client-generated authority facts | High / Medium | Depends on successful governed execution; semantic evidence is additive | **REDESIGN** → “Why this answer?” disclosure | Keep the evidence but order it: understanding, data used, governance, calculation; reveal advanced detail progressively. |
| 6. Verified SQL | Result tab / open `<details>` | Analyst/DBA: inspect reproducible SQL | Low / Supporting / Advanced | `view_schema`/runtime `rawSqlAvailable`; backend enforces visibility | High / High | Derived from successful governed execution; must not be editable/executable from disclosure | **HIDE** → Why this answer? → Advanced | The inspected code opens the explainability SQL disclosure by default when available. Default-hidden reduces noise without changing capability-gated access. |
| 7. Feedback | Explainability footer | Business: say whether result met need and pinpoint issue | Medium / Supporting / Contextual | `/query-runs/:id/feedback`; successful run, current user ownership, target must exist in explainability | Low / Low | Follows a result; owner-only and idempotent in backend | **MERGE** → Answer footer | Existing placement is good; present compact rating first and expand detail only on “needs adjustment.” Preserve ownership/idempotency. |
| 8. CSV Export | Result action | Analyst: take governed output elsewhere | Medium / Supporting / Contextual | `export`; server reauthorizes SQL, scope, DLP and result limits | Low / Low | Requires result/SQL; direct chat and saved insight reuse | **MERGE** → Result actions | Keep next to result, no export page. UI capability visibility never replaces server authorization. |
| 9. Direct Query | No SPA route; `/api/v1/query`, used by saved-insight rerun | Analyst/automation: execute supplied SQL | Low / Supporting / Hidden API | `chat`/`view_schema` depending path; QueryPolicyEngine, EffectiveScope, DLP, result budgets | High / High | Saved-insight rerun invokes it; there is no standalone UI composer | **HIDE** → Ask / Advanced | Do not invent a separate SQL-first screen. If exposed later, keep it capability-gated and behind the same policy boundary. |
| 10. Saved Insights | `#/insights` | Business/Analyst: save and rerun reusable analysis | Medium / Supporting / Primary | `manage_own_insights`; create/update validates saved SQL; rerun uses governed direct query | Medium / Medium | Overlaps Templates as reuse; current result has no direct “save answer” action | **MERGE** → Library | Retain saved result/prompt/visualization as one Library collection; provide contextual “Save to Library” after answer. |
| 11. Query Templates | `#/templates` | Business: start from a shared question pattern | Medium / Supporting / Primary | `view_templates`; edits require `manage_templates` | Low / Low | Same repeat-analysis job as Insights but prompt-only | **MERGE** → Library and Ask suggestions | Keep prompt starter cards in Ask; manage reusable prompts in Library. |
| 12. Business Dictionary | `#/dictionary` | Business: discover team vocabulary; DBA: maintain helper terms | Medium / Supporting / Primary | `view_dictionary`; edits/deletes require `manage_dictionary` | Medium / Medium | Overlaps “Definitions” in language, but is not the same approval/publish contract | **MERGE** → Definitions / business terms facet | Present vocabulary together conceptually; keep legacy dictionary persistence and formal semantic governance distinct. |
| 13. Schema Catalog | `#/schema` | DBA/Analyst: inspect available data structure | Low / Supporting / Primary | `view_schema`; `/schema` resolves EffectiveScope before returning context | High / High | Source page repeats table count and last scan info | **HIDE** → Data Sources / catalog detail | Useful for troubleshooting and advanced understanding, not a Business first-level destination. |
| 14. Data Source and Schema Refresh | `#/source`; refresh also on Schema | DBA: see source/read-only mode and refresh catalog | Low / Administrative / Primary | `refresh_schema` plus browser session for refresh; source endpoint requires `refresh_schema` | Medium / High | Same schema refresh/status information is shown in two routes | **HIDE** → Governance / Data Sources | Consolidate source status and explicit refresh into one DBA-capability screen/action. |
| 15. Usage | `#/usage` | Business/Owner: inspect personal request/row usage | Low / Administrative / Primary | `view_own_usage` | Low / Medium | Not a frequent query task; system has separate admin overview usage | **HIDE** → Account / Usage | Retain data and endpoint, remove from primary navigation. |
| 16. Profile / Settings | `#/profile`, account controls | All: manage password and account | Low / Administrative / Account contextual | Authenticated session; password change endpoint | Low / Low | No relationship to query workflow | **HIDE** → Account menu | Correctly remains outside primary navigation; consolidate user preferences here only when needed. |
| 17. Semantic Registry / Definitions | `#/semantics` assets workspace and detail | Governance: find and maintain approved enterprise meanings | Medium / Core to governance / Separate primary section | `view_semantics`; mutations require draft capability; source catalog is authorized; governance state in APP D1 | High / High | Contains definition, source, alias, status, owner, revision concepts | **REDESIGN** → Governance / Definitions | “Definitions” maps to the user job better than “Registry.” Keep technical identifiers/details behind advanced panels. |
| 18. AI Suggestions | `#/semantics` second workspace | Governance: draft a definition from authorized schema evidence | Low / Supporting / Nested tab | `manage_semantic_drafts`; selected authorized metadata only; suggestions never authorize or approve | High / High | One step in definition creation; separate workspace creates another product mental model | **MERGE** → Definitions → “Suggest with AI” | Generate only on explicit action, let human inspect/edit, and require explicit save as Draft. |
| 19. Definition Draft Composer | Modal in Semantic route | Data Owner/DBA: author or edit a structured definition | Low / Core governance / Contextual modal | `manage_semantic_drafts`; backend validates bounded contracts/source references | High / High | Manual creation and accepted suggestion lead to same draft form | **REDESIGN** → Definition editor | One editor for manual start and AI-prefilled draft; guide users by definition type and hide AST/schema details unless necessary. |
| 20. Revision History | Semantic detail → History | Governance: see prior changes and provenance | Low / Supporting / Contextual tab | `view_semantics`; immutable revisions and snapshot evidence | Medium / High | Needed for review; a revision is implementation storage, not a user task | **MERGE** → Definition activity/history | Preserve complete history but use human language and show it when opening a definition. |
| 21. Review / Request Changes / Reject | Semantic detail → Review/action | Reviewer: decide whether a draft is ready | Medium / Core governance / Contextual lifecycle | `review_semantics`; backend validates actor, revision status and audit | High / High | Must follow submission; reviewer should find pending items without navigating asset detail | **REDESIGN** → Definitions review queue | Surface “Needs your review” as a filtered work queue in Definitions; keep decisions and comments explicit. |
| 22. Approval, Publication, Runtime Eligibility, Readiness | Semantic detail → Approval; read-only readiness panel | Approver/operator: approve/publish or inspect activation eligibility | Low / Core governance / Contextual lifecycle | `approve_semantics` plus explicit scoped authority and policy; publication triggers enforce scope/quorum/SoD; runtime gates remain separate | High / Very high | Approval → publication → post-review/eligibility/readiness; a single UI label can mislead about separate states | **MERGE** → Definition lifecycle timeline + advanced readiness | Present one lifecycle to humans, retain distinct backend facts and actions. Never imply approval means published/eligible/runtime enabled. |
| 23. Semantic Authorities | `#/admin-semantic-authorities` | System Owner/governance admin: assign explicit scoped authority | Very low / Administrative / Primary | `manage_semantic_governance`, browser session, audit, atomic replace API | Very high / Very high | Configuration, not daily definition work; platform role is not semantic authority | **HIDE** → Governance Settings | Keep explicit authority, domain scope, no implicit Owner/DBA approval. |
| 24. Approval Policies | `#/admin-semantic-policies` | System Owner/governance admin: set quorum/SoD/risk rules | Very low / Administrative / Primary | `manage_semantic_governance`, backend validates policy, audit, atomic replace | Very high / Very high | Configuration prerequisite for approval, not a parallel user workflow | **HIDE** → Governance Settings | Group with authorities under governed configuration; no capability or policy relaxation for UX. |
| 25. Admin Overview | `#/admin-overview` | System Owner: inspect users/activity/requests | Low / Administrative / Primary | `manage_users`; aggregation from APP metadata | Medium / Medium | Duplicates Dashboard metrics and Audit preview; only action links to Users | **REMOVE** → Access/Audit summaries | No unique operational decision is supported by this overview today. Revisit only with a specific operator job and evidence. |
| 26. Users / Access | `#/admin-users` | System Owner: assign roles, disable accounts, reset access | Low / Administrative / Primary | `manage_users`; backend prevents removing last Owner and audits changes | High / Medium | Shares onboarding/role/key tasks currently on separate pages/modals | **KEEP** → Governance / Access | Retain as the primary access-management screen with clear capability changes. |
| 27. Roles & Permissions | `#/admin-roles` | System Owner: configure capability sets and row caps | Very low / Administrative / Primary | `manage_users`; allowlisted capability model; backend protects Owner `*` | Very high / High | Role policy config, closely coupled to Users | **MERGE** → Access → Role policies | Show role capability diffs from user assignment; ensure the interface distinguishes feature RBAC from data scope and semantic authority. |
| 28. Invitations | `#/admin-invitations` | System Owner: onboard/revoke workspace members | Low / Administrative / Primary | `manage_users`; one-time hashed token; audit | Medium / Medium | Same job group as Users; create form is modal | **MERGE** → Access → Invite | Keep invitations as a tab/action in Access; acceptance remains a dedicated external onboarding flow. |
| 29. API Keys | Users row action / modal | System Owner: create/revoke a user's API key | Very low / Administrative / Contextual | `manage_users`; one-time secret display, hashed storage, revoke audit | High / High | Belongs to a specific user; not a navigation destination | **HIDE** → User detail → API access | Preserve one-time display and explicit revoke, expose only for integration operators. |
| 30. Audit | `#/admin-audit` | Governance/System Owner: reconstruct important operations | Low / Administrative / Primary | `manage_users` in current implementation; rows include event/actor/resource; governance metadata has richer detail through APIs | Medium / High | Admin Overview shows recent event subset | **KEEP** → Governance / Audit & System | Audit is an essential traceability task; improve filtering and event grouping without changing retention or evidence. |
| 31. System / Connection Status | `#/admin-system` | System Owner/DBA: diagnose Worker/D1/Gateway readiness | Very low / Administrative / Primary | `manage_users` for system; `refresh_schema` for connection; health endpoint public | High / High | Overlaps Source with connection/database status | **HIDE** → Audit & System → Operations | Keep deep operational diagnostics out of routine workflow; do not expose secrets. |
| 32. Login / bootstrap / invitation acceptance | `/`, `/accept-invite` | All: enter or establish authenticated workspace | Low / Core prerequisite / No authenticated nav | Auth endpoints, one-time bootstrap, invite verification; no anonymous protected data | Medium / Medium | Precedes all protected actions | **KEEP** → Auth entry flow | Necessary product boundary; do not combine bootstrap and ordinary login in a confusing way. |

## 5. Persona × Job findings

| Persona | Top jobs in order | Current friction | Target experience |
|---|---|---|---|
| Business / Operations | Ask; continue/review history; save/reuse | Must choose between Dashboard, Chat, Templates, Insights and sometimes Dictionary/Schema before starting. Answers show many evidence elements at once. | Default to Ask; keep recent/history adjacent; result supports follow-up, “Why this answer?”, and Save/Export in context. |
| Data Owner / DBA / Reviewer | Define; review; approve; govern access; audit | Formal Semantic lifecycle is spread across a Registry route, a separate Suggestions workspace, detail tabs and separate governance configuration. DBA role defaults include semantic view/draft/review but do not by themselves grant approval or governance-admin authority. | Shared Governance workspace with capability-based queue/actions; preserve explicit authority and policy gates; show work state as a lifecycle. |
| System Owner | Manage access; maintain governance configuration; diagnose; audit | Workspace Admin has separate top-level overview, users, roles, authorities, policies, invitations, audit, and system links. Admin “owner” helper routes enforce `manage_users`; semantic settings enforce `manage_semantic_governance`. | Same Governance workspace; navigation follows capabilities. Put configuration and diagnostics under settings; keep Access and Audit findable. |

Role is not a reliable UI persona by itself. The inspected code resolves a finite capability set from role definitions. Default migration values show Viewer/Analyst/Editor/DBA/Owner differences; P2-B adds `view_semantics`, `manage_semantic_drafts`, and `review_semantics` to DBA; Owner has `*`. Approval, emergency publication, runtime eligibility, and governance administration have separate capabilities/authority checks. Target navigation should key off those capabilities, not names such as “DBA” or “Owner.”

## 6. Simplification decision counts

| Decision | Count | Interpretation |
|---|---:|---|
| KEEP | 5 | Core question flow, results, Access, Audit, authentication entry |
| MERGE | 11 | Useful capabilities become contextual actions, tabs, or one workflow |
| HIDE | 10 | Advanced or infrequent capabilities remain available under appropriate capability-gated workspaces |
| REDESIGN | 4 | Explainability, definitions, draft editing, review interaction keep their job but change presentation |
| REMOVE | 2 | Separate Dashboard and Admin Overview page surfaces; their useful blocks move to Ask / Access / Audit |
| **Total** | **32** | Decisions are for user-facing surfaces. REMOVE does not mean deleting backend capability or stored data. |

## 7. Core flow AS-IS → TO-BE

```text
AS-IS — Business
Dashboard → AI Chat → inspect dense explanation/result → switch to Insights or Export
                              ↘ SQL tab / Templates / History are separate concepts

TO-BE — Business
Ask → Answer → (Why this answer? / Advanced SQL if allowed) → Follow-up
                 ↘ Save to Library / Export (if allowed) / Feedback
History remains adjacent to Ask; re-opening a past conversation restores this flow.

AS-IS — Governance
Semantic Registry → AI Suggestions workspace OR create Asset → Draft → Revision tab
  → submit → find asset → Review tab → Approval tab → publication / eligibility
  → separate Admin Authorities and Approval Policies

TO-BE — Governance
Definitions → Create manually OR Suggest with AI → Edit & explicitly Save Draft
  → Review queue → Human approval/publication → lifecycle status and audit evidence
  → advanced Governance Settings only when an authorized operator needs configuration.
```

## 8. Terminology audit

| Current term | Classification | Recommended user-facing term | Keep technical term where |
|---|---|---|---|
| Semantic Registry | Governance-only / Advanced | Definitions | Engineering docs, API, audit export |
| Semantic Asset | Internal / Governance-only | Definition | IDs and advanced record details |
| Revision | Governance-only | Version / change | Audit/history record detail |
| AI Suggestion | Governance-only | Suggested draft | Explicitly label “AI suggested; not approved” |
| Draft | User-facing (Governance) | Draft | Keep; clear non-approved state |
| Review / Reviewer | User-facing (Governance) | Needs review / Review | Detailed event name in audit |
| Approval / Approver | Governance-only | Approve definition / Authorized approver | Quorum/authority details in advanced governance |
| Publication | Advanced / internal distinction | Published | Keep “publication” in audit/API; do not imply runtime enabled |
| Runtime Eligibility | Internal / Advanced | Eligible for query use | Explain only to authorized governance/operator users |
| Authority | Governance configuration | Approval access | Keep exact authority record in settings and audit |
| Approval Policy / Quorum / SoD | Governance-only | Approval rules / required approvals / separation of duties | Advanced settings |
| Schema Snapshot | Internal / Advanced | Data structure version | Detail/provenance panel |
| Registry Version | Internal only | Hide | Audit/debug only |
| EffectiveScope | Internal only | Hide | Security explanation may say “your authorized data range” |
| QueryPolicyEngine | Internal only | Hide | Architecture and audit documentation |
| Verified SQL | Advanced (capability-gated) | SQL details | Advanced answer disclosure |
| Direct Query | Advanced / internal path | No separate end-user label by default | API docs and approved analyst surface only if needed |
| Business Dictionary | User-facing supporting | Business terms | Preserve distinction from approved Definitions in admin detail |
| Saved Insight | User-facing | Saved analysis | Library; clarify rerun is reauthorized |
| API Key | Admin-only | API access | User-specific advanced access drawer |

## 9. UI and frontend technical findings

- **Navigation:** `shell()` constructs one sidebar with Analysis, Data Governance, Workspace Admin, and then `installSemanticNavigation()` appends a separate Semantic group. Capability filtering makes visibility role-sensitive but leaves the hierarchy domain-oriented.
- **Information density:** `explainabilityPanel()` renders three peer columns, governance chips, semantic evidence and feedback in one surface. When the current response makes SQL available, the SQL disclosure has `open` in markup. The P1 trust data is valuable; the hierarchy should change, not the evidence contract.
- **CTA:** Dashboard has two entry CTAs; admin overview offers Manage Users and View All Audit; Semantic list can offer Create Asset, filters, workspace tabs and readiness. The broader “one screen / one primary job” principle is not consistently applied.
- **State and coupling:** one global `state` contains auth, page, query, session, render, cache, user filters, semantic filters/workspace/detail tab/suggestion filters, and invite token. A single `render()` selects from `VIEWS`, replaces `#root`, and binds cross-module actions. Auth, API transport, view markup, modal helpers and event handlers live in the same file.
- **No framework rewrite case:** The source demonstrates coupling and maintenance cost, but not evidence that React/Vue/Next is required. First group navigation and workflows; then extract modules with tests. Preserve the static Worker asset architecture unless a concrete need changes.
- **Backend is not the UI taxonomy:** Routes and tables support security, history and audit boundaries. These do not have to become first-level pages. Keep the backend contracts stable during UI simplification.

## 10. UX debt vs architecture debt

| Class | Evidence-backed issue | What the audit recommends |
|---|---|---|
| UX debt | Explainability displays understanding, sources, governance, calculation, semantic provenance, SQL and feedback together | Progressive disclosure with deterministic evidence intact |
| IA debt | 17 Owner sidebar entries and Semantic Registry appended as a peer group | Separate Business and Governance workspaces; role/capability filtering within them |
| Frontend technical debt | 1,065-line SPA script, 3,305-line stylesheet, global mutable state, one render/bind loop | Incremental module extraction after IA settles; no framework rewrite in first wave |
| Product model debt | Backend objects (asset, revision, suggestion, authority, policy, publication) become named UI locations | Organize around Ask, Library, Definitions, Access, Audit & System |
| Architecture/security constraint | Backend auth/RBAC, EffectiveScope, authorized catalog, policy engine, DLP, approval SoD and audit are deterministic boundaries | UI may reduce exposure but cannot move or replace these checks |

## 11. Security impact and P0 gate

No confirmed P0 security issue was identified in this product-surface audit. The inspected paths keep important decisions server-side: `pageAllowed()` is presentation only; routes call `requireCapability`; `getSchema` resolves EffectiveScope before `schemaContext`; chat/direct query/export call the shared query authorization and DLP paths; SQL visibility uses `rawSqlAvailable`/`view_schema`; semantic review, approval and governance settings have different capability and authority checks; feedback checks successful run ownership and evidence target.

This conclusion is limited to the audited surfaces and does not claim a fresh exhaustive penetration test. Product simplification must preserve the regression mappings in [the target IA](querymind-target-ia-v1.md). Specifically, hiding a button never grants or denies server permission; it only changes discovery. Export authorization, feedback ownership, SQL visibility and semantic authority must continue to be checked by the Worker.

## 12. Repository drift / contradictions

| Evidence | Drift | Resolution for this audit |
|---|---|---|
| `docs/HANDOVER.md` said current Worker `8eba9c55…`, APP migrations `0001–0012`, and no authorities/policies. | The repository HEAD included P2-Ia2 atomic replacement implementation and migration files through `0013`; the 2026-09-09 read-only Production verification in this conversation confirmed Worker `2b3d78f6…` and governance records needing replacement. | Treat code as the design baseline and governance closeout separately. This release reconciled Worker/migration facts in `docs/HANDOVER.md`; it did not re-read governance D1 state, which remains explicitly dated. |
| `docs/architecture/current-production.md` describes semantic UI as P2-D design time, no governance bootstrap UI, and no published Semantic assets. | Code now has authorities/policies admin pages, atomic Replace APIs and UI; Production readback found authority/policy records, so “no policies or authorities” is no longer true. Registry version 0 and no publication for historical `sales_revencue` were observed on 2026-09-09. | Keep registry and governance-record facts separate; reconcile state with a fresh authorized readback before changing the handover. |
| `docs/architecture/current-production.md` says runtime semantics are disabled and registry is 0. | Runtime-off is an expected/current protected setting in supplied release evidence; registry 0 was read in prior Production verification. This audit did not query Cloudflare on 2026-10-07. | Preserve as an invariant, label dated evidence when using it, and never infer activation from a published definition alone. |
| Historical P2-C/P2-D docs describe Semantic Registry / Suggestions as discrete workspaces. | This matches the current SPA implementation, but the product simplification objective proposes collapsing those concepts into one definition job. | Documentation is historical design evidence, not a requirement to preserve current navigation. |
| `docs/HANDOVER.md` and `README.md` contain older product/runtime statements. | Runtime Cloudflare is still clearly identified as production, while individual release IDs/state sections lag later releases. | Source + dated deployment evidence outrank stale handover fields. Reconcile before another production operation. |

**Independent governance blocker:** the read-only result from 2026-09-09 showed Authority `can_govern_runtime=1`, Policy self-approval `1` and emergency publication `1`, no inactive history and no correlated replacement audit. This is a governance correctness blocker, not an IA redesign item. The current audit does not retry replacement, change policy, or use it as a reason to alter security rules.

## 13. Recommended first implementation slice

**Choose one slice: replace the flat first-level menu with a role-aware Business / Governance shell and make Ask the default landing route.**

- **Why:** It addresses the strongest source-backed confusion (17 Owner links and duplicated entry points) while exposing no new backend capability. It reduces decision time for Business users and creates a stable home for existing governance tasks.
- **Scope:** Business navigation `Ask`, `History`, `Library`; Governance navigation `Definitions`, `Data Sources`, `Access`, `Audit & System`; capability-filtered sub-items; Ask as default for authenticated users; retain current hash routes/deep links behind the new labels during the transition.
- **Non-scope:** deleting APIs/data, changing RBAC or data scope, changing semantic governance state, changing semantic runtime flags, SQL execution changes, new dashboard analytics, framework rewrite, modifying P2-Ia3 / Production governance records.
- **Acceptance criteria:** Business roles land on Ask and see no governance/admin links without capabilities; governance capabilities reveal only authorized destinations; all existing routes remain deep-linkable; protected endpoints still deny unauthorized calls; chat/direct query/saved insights/export still converge on the same QueryPolicyEngine; feedback remains successful-run/owner constrained; SQL stays capability-gated; semantics cannot be auto-approved or auto-published; desktop/mobile nav remains usable.

## 14. Product North Star

**What is QueryMind?** QueryMind is a governed data agent that turns business questions into answers people can verify and safely use.

Three product promises:

1. Ask in business language and keep the work moving with follow-up questions.
2. See where an answer came from and how it was calculated.
3. Use only data and definitions the organization has authorized.

## Evidence index

- SPA surfaces/navigation: `cloudflare/public/app.js` (`PAGE_TITLES`, `PAGE_CAPABILITIES`, `shell`, `render*`, `VIEWS`, `installSemanticNavigation`, auth screens).
- Worker routes: `cloudflare/src/index.ts`.
- Feature capability allowlist: `cloudflare/src/lib/product.ts`; role resolution: `cloudflare/src/lib/auth.ts`; default roles: `cloudflare/migrations/app/0004_restore_product_modules.sql`; DBA Semantic capabilities: `0009_semantic_governance_capabilities.sql`.
- Schema/security: `cloudflare/src/routes/schema.ts`, `agent.ts`, `query.ts`, `modules.ts`, `semantics.ts`, `semantic-suggestions.ts`, `feedback.ts`, `cloudflare/src/lib/{scope,schema-catalog,query-policy,dlp,explainability,semantic-governance}.ts`.
- Data/lifecycle model: `cloudflare/migrations/app/0006_governed_query_safety.sql`, `0007_explainable_query_experience.sql`, `0008_governed_semantic_foundation.sql`, `0009_semantic_governance_capabilities.sql`, `0010_semantic_schema_intelligence_suggestions.sql`, `0011_feedback_trust_experience.sql`, `0012_semantic_approval_publication.sql`, `0013_governance_lifecycle_persistence.sql`; DATA migration `cloudflare/migrations/data/0001_initial_business_schema.sql`.
- Regression evidence locations reviewed: `cloudflare/tests/app.spec.ts`, `rbac.spec.ts`, `explainability.spec.ts`, `semantic*.spec.ts`, `semantic-governance-ui.spec.ts`.
- Dated prior Production evidence: this conversation’s 2026-09-09 P2-Ia2 Final Production Verification. It is not a live readback for this audit date.
