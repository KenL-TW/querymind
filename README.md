# QueryMind

> Governed enterprise AI data query platform for secure natural-language access to business data with policy enforcement, semantic context, and explainable results.

QueryMind is an AI-powered data query platform designed to help business users ask questions in natural language and retrieve answers from enterprise data without bypassing existing governance controls.

Rather than treating NL2SQL as the final product, QueryMind is evolving toward a **Governed Enterprise Data Query Layer** — a controlled runtime between enterprise identity, business semantics, AI reasoning, SQL execution, and trusted answers.

---

## Overview

Traditional enterprise data access often requires business users to:

1. Define a question.
2. Ask IT or data teams for support.
3. Wait for SQL, reports, or dashboards to be created.
4. Validate whether the result actually matches the intended business definition.

QueryMind reduces this decision latency by allowing authorized business users to interact directly with governed enterprise data through natural language.

The design principle is:

```text
Natural Language
        ↓
Enterprise Identity
        ↓
Effective Data Scope
        ↓
Authorized Schema / Context
        ↓
AI Reasoning
        ↓
Deterministic Query Policy
        ↓
Read-only Data Execution
        ↓
Explainable Result
```text

## Architecture 

The current primary runtime is based on Cloudflare.
flowchart TD

    U[Business User]

    U --> SPA[Web Application]

    SPA --> W[Cloudflare Worker]

    W --> AUTH[Authentication + Feature RBAC]

    AUTH --> SCOPE[EffectiveScope]

    SCOPE --> CAT[Authorized Catalog / Context]

    CAT --> AI[Cloudflare AI Gateway / OpenAI]

    AI --> SQL[Generated SQL]

    SQL --> POLICY[QueryPolicyEngine]

    POLICY --> DLP[DLP + Result Guardrails]

    DLP --> DATA[(Cloudflare D1 Business Data)]

    DATA --> RESULT[Governed Result]

    RESULT --> EXPLAIN[Explainability]

    EXPLAIN --> SPA

    W --> APP[(Cloudflare D1 Application Metadata)]
