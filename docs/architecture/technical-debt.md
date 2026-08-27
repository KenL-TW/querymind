# QueryMind Technical Debt Classification — Post P2-D

## Must fix now

None identified by the post-P2-D hardening audit. This classification depends on the full regression suite remaining green and source synchronization completing.

## Should fix before P2-E

- Complete authenticated P2-D manual production closeout and preserve evidence.
- Perform an isolated D1 export/restore rehearsal; do not restore Production as a test.
- Decide an authenticated smoke-token/session mechanism that remains operator-supplied and does not store credentials.
- Define alert routing/SLO ownership for the documented Worker, D1, AI Gateway, policy, and suggestion signals.

## Later

- Split the large static `public/app.js` only when a bounded, non-regressive module plan is approved.
- Replace or augment the bounded SQL tokenizer/parser only under the existing P0 policy-test envelope.
- Address Cloudflare D1 workload cancellation limitations through query shaping/operational limits; do not add write-enabled AI SQL.
- Add historical schema-snapshot retention/audit only through a forward migration in a future approved phase.
- Reduce legacy code coexistence after an explicit archival decision; no parallel feature development in legacy runtime.
