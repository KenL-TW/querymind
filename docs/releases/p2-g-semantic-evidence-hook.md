# QueryMind P2-G — Semantic Evidence Hook Release

## Scope

P2-G adds an additive semantic provenance field to the existing P1
`QueryExplainability` envelope. The field is created from the exact P2-F
resolver handoff after successful governed execution and stored in the existing
`query_runs.explainability_json` column. No migration, production Semantic
asset, authorization rule, model prompt, or feedback taxonomy was changed.

## Protected behavior

- `USED` contains only exact P2-F asset/revision selections and the observed
  registry/schema identities.
- `NOT_USED` is explicit for the feature-off, empty/fallback, ambiguous and
  Direct Query paths.
- Historical QueryRuns without the additive field render as unavailable, not as
  guessed `NOT_USED`.
- P0 QueryPolicyEngine remains the final SQL authority; DLP and result budgets
  remain downstream.
- P1.2 Feedback remains owner-only, idempotent, and does not introduce a
  `SEMANTIC` target or Registry mutation.
- `SEMANTIC_RUNTIME_CONTEXT_ENABLED` remains false in Production.

## Database and deployment

The release target is APP migrations 0001–0012 and DATA migration 0001. No
0013 migration exists or is required. Production deployment evidence and exact
test/Worker identifiers are recorded in the P2-G release manifest when the
release gates complete.

## Rollback

With no D1 change, rollback is Worker-only to the prior P2-F Worker. Roll back
for health, Chat, QueryRun persistence, historical evidence, feedback, DLP,
authorization, or evidence-leak regressions.
