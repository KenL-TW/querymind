# QueryMind Minimum Operational Observability

## Available signals

- `/health`: Worker environment, AI availability, both D1 bindings, and P0 policy state.
- Cloudflare Workers Logs/Traces: Worker errors, route errors, D1 binding calls, and outbound AI Gateway fetches. Production config enables logs and traces.
- Cloudflare AI Gateway: provider authentication, usage, rate-limit/spend controls, and provider errors.
- Worker audit/query records: governed query failures, policy denials, feedback, and P2-D suggestion run outcomes.

Never place raw secrets, provider tokens, scope keys, row predicates, or customer data in logs or alerts.

## Minimum alert candidates

| Signal | Candidate action |
|---|---|
| `/health` not `ok` | Investigate Worker, policy, and D1 state; stop releases. |
| AI unavailable or provider authentication error | Check Gateway authentication/alias; do not expose keys. |
| APP/DATA unavailable | Check Cloudflare status and bindings; do not run a migration/restore as diagnosis. |
| policy unhealthy | Treat as governed-query outage; do not bypass P0. |
| unexpected `AI_MOCK_MODE` | Stop release and validate production configuration. |
| high query error/denial rate | Inspect structured Worker/audit signals and release change. |
| repeated suggestion generation failure | Preserve run/audit evidence; disable or roll back suggestion generation if needed. |

Full SLOs, external alert destinations, and recovery rehearsal automation remain later engineering work.
