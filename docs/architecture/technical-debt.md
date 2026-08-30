# QueryMind Technical Debt Classification — P2-E release candidate

## Must fix now

None identified after the GAP-032 test-fixture fix. The full regression and fresh-clone gates are green; the remaining production item is an operator-owned manual smoke, not a code defect.

## Should fix before P2-E production completion

- Complete authenticated P2-D manual production closeout and preserve evidence.
- Provision the first production semantic governance policy and distinct human RACI assignments only through an authorized operator; P2-E intentionally seeds none.
- Keep the green GitHub Actions release gate (`33291766401`) attached to future changes.
- Perform an isolated D1 export/restore rehearsal; do not restore Production as a test.
- Decide an authenticated smoke-token/session mechanism that remains operator-supplied and does not store credentials.
- Define alert routing/SLO ownership for the documented Worker, D1, AI Gateway, policy, and suggestion signals.

## Later

- Split the large static `public/app.js` only when a bounded, non-regressive module plan is approved.
- Replace or augment the bounded SQL tokenizer/parser only under the existing P0 policy-test envelope.
- Address Cloudflare D1 workload cancellation limitations through query shaping/operational limits; do not add write-enabled AI SQL.
- Add historical schema-snapshot retention/audit only through a forward migration in a future approved phase.
- Add governed policy/authority amendment and deactivation UX before broad governance administration adoption; this candidate intentionally exposes minimal create/list administration and never infers authority from a product role.
- P2-F may consume only the current, `ELIGIBLE`, approved publication record; it must not bypass P0 or make approval state an authorization source.
- Reduce legacy code coexistence after an explicit archival decision; no parallel feature development in legacy runtime.
