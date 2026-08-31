# QueryMind Engineering Handover

## What is active

QueryMind is a governed AI data-query application. Production is the Cloudflare Worker runtime in `cloudflare/`, not the legacy Python/Nuxt/AWS implementation. Its entry point is `cloudflare/src/index.ts`; the static application is `cloudflare/public`.

## Where to find key components

| Concern | Location |
|---|---|
| Policy and EffectiveScope | `cloudflare/src/lib/query-policy.ts`, `scope.ts`, `schema-catalog.ts` |
| Worker routes | `cloudflare/src/routes/` |
| APP/DATA migrations | `cloudflare/migrations/app`, `cloudflare/migrations/data` |
| Semantic Registry | `semantic-*.ts`, `routes/semantics.ts` |
| P2-E human approval/publication | `semantic-governance.ts`, `routes/semantics.ts`, APP migration `0012_semantic_approval_publication.sql` |
| P2-F runtime semantic context | `approved-semantic-context.ts`, `routes/agent.ts`, P2-F release and GAP-034 records |
| P2-G semantic evidence hook | `explainability.ts`, `approved-semantic-context.ts`, P2-G SDD/release/manifest |
| P2-D suggestions | `semantic-intelligence*.ts`, `semantic-suggestion-*.ts`, `routes/semantic-suggestions.ts` |
| AI configuration | `ai-config.ts`, `runtime-config.ts`, `production-runtime-contract.json` |
| Tests | `cloudflare/tests/*.spec.ts` |
| Deployment and rollback | `cloudflare/PRODUCTION_RUNBOOK.md` |

## Current release

- Production Worker: `2ae1d74d-db8f-4acf-84be-bc863d89ba48`
- Rollback Worker: `9b2cc079-066f-4df0-b9aa-e2d10a910f2f`
- Production baseline is APP migrations `0001`–`0012`; P2-E additive APP migration `0012` is applied; DATA remains `0001`.
- Current semantic state: registry version 0; no assets, revisions, reviews, or suggestion runs
- P2-G semantic evidence is deployed additively in the existing QueryRun explainability envelope; runtime semantic activation remains disabled and production registry state remains empty.
- Release evidence: [P2-G manifest](releases/manifests/p2-g-production.json) and [P2-G release report](releases/p2-g-semantic-evidence-hook.md)
- Release evidence: [P2-F manifest](releases/manifests/p2-f-production.json)
- P1.2 release evidence: [Feedback & Trust manifest](releases/manifests/p1.2-feedback-trust.json)
- Release-quality closeout: [P2-E production release and authenticated closeout](releases/p2-e-human-semantic-approval-publication.md)
- P2-F production evidence: [Approved runtime semantic context](releases/p2-f-approved-runtime-semantic-context.md)

P1.2 feedback is a query-run-linked capture boundary. It validates evidence
targets against persisted Explainability, preserves owner-only successful-run
and unique upsert rules, and stores bounded untrusted corrections. It never
calls an AI provider, executes business SQL, changes policy, or mutates
Semantic Registry/P2-D state.

## Local and release workflow

```powershell
cd cloudflare
npm ci
npm run check
npm run test:db:init
npm run test:all
npm run release:preflight
```

The D1 initializer is disposable and local. D1 migrations are explicit, reviewed operations; Worker deployment must not execute them. For deployment, run the production runbook, then `npm run deploy:production`. For a rollback, use the recorded Worker version; do not roll back forward D1 migrations.

## What comes next and what is forbidden

P2-E is complete as a design-time governance boundary: human-only RACI, deterministic policy/readiness, quorum and separation-of-duties checks, atomic normal or break-glass publication, immutable evidence, and suspend/resume eligibility. P2-F runtime context and P2-G semantic evidence are deployed and frozen with semantic activation disabled by its release flag; production currently has no semantic assets, policies, or authorities. P2-H is the next handoff phase.

Do not add LLM-based authorization, direct `QUERYMIND_DATA` execution, full-schema exposure before EffectiveScope, runtime semantic consumption, AI semantic approval, AI-generated row policy, or write-enabled AI SQL.

The old FastAPI/Nuxt/PostgreSQL/AWS stack is **LEGACY / HISTORICAL REFERENCE** only.

Current debt classification is maintained in [technical debt](architecture/technical-debt.md).
