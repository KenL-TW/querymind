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
| P2-D suggestions | `semantic-intelligence*.ts`, `semantic-suggestion-*.ts`, `routes/semantic-suggestions.ts` |
| AI configuration | `ai-config.ts`, `runtime-config.ts`, `production-runtime-contract.json` |
| Tests | `cloudflare/tests/*.spec.ts` |
| Deployment and rollback | `cloudflare/PRODUCTION_RUNBOOK.md` |

## Current release

- Production Worker: `0adc14e9-6e86-4bbf-93bf-fe476c8f20e4`
- Rollback Worker: `5c55b16b-4a02-4fb4-8906-687f1b6387ab`
- Production baseline currently remains APP migrations `0001`–`0011`; the P2-E release candidate introduces additive APP migration `0012`; DATA remains `0001`.
- Current semantic state: registry version 0; no assets, revisions, reviews, or suggestion runs
- Release evidence: [P2-D manifest](releases/manifests/p2-d-production.json)
- P1.2 release evidence: [Feedback & Trust manifest](releases/manifests/p1.2-feedback-trust.json)
- Release-quality closeout: [P2-D closeout and P2-E readiness](releases/p2-d-production-closeout.md)

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

P2-E is implemented as a design-time governance boundary: human-only RACI, deterministic policy/readiness, quorum and separation-of-duties checks, atomic normal or break-glass publication, immutable evidence, and suspend/resume eligibility. It does not inject semantics into Chat/Direct Query; P2-F is not started. Production still requires the P2-E release gate and a human governance administrator must configure policy and RACI after deployment before any revision can publish.

Do not add LLM-based authorization, direct `QUERYMIND_DATA` execution, full-schema exposure before EffectiveScope, runtime semantic consumption, AI semantic approval, AI-generated row policy, or write-enabled AI SQL.

The old FastAPI/Nuxt/PostgreSQL/AWS stack is **LEGACY / HISTORICAL REFERENCE** only.

Current debt classification is maintained in [technical debt](architecture/technical-debt.md).
