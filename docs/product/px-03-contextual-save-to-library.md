# QueryMind PX-03 — Contextual Save to Library

**Status:** DEPLOYED to Cloudflare Production on 2026-10-07 in Worker `5c222254-6f18-4c71-8db7-0588a926946e` (100% traffic).
**Date:** 2026-10-07
**Scope:** Save a successful governed analysis into the user's existing Library without introducing another persistence model or granting future execution authority.

## Product flow

```text
Ask → Answer → Verify if needed → Save to Library → Find later → Re-run under current authorization
```

The result action appears next to the successful result's existing actions. It is capability-filtered by `manage_own_insights`. A compact modal takes an editable title and optional bounded note; the original question is the deterministic default title. Success changes the result action to “已儲存” and “查看 Library” without navigating away. A failure remains inline, does not claim success, exposes only bounded retry guidance, and allows retry. Escape closes the dialog and focus returns to the Save trigger.

Library now presents:

1. **已儲存的分析** — personal, owner-scoped analyses, with title, original question, save time, optional note, rerun, rename and delete.
2. **查詢範本** — separate reusable question starters; not merged with saved analyses.
3. **商業詞彙字典** — retained as a legacy/secondary compatibility entry and explicitly not represented as approved Semantic truth.

Ask, History and Library remain the Business primary navigation; no “Saved” navigation item was added.

## Repository contracts audited

- `insights` is already persisted in APP migration 0004 with owner (`user_id`), title, description, prompt, optional historical SQL, visualization type, favorite and timestamps. It has no result-row snapshot or explicit `queryRunId` column.
- `query_runs` records the execution ID, owner, prompt and outcome. Contextual creation requires a successful query run owned by the authenticated user. Its UUID is reused as the Insight ID, giving one stable contextual-save identity without a new table, migration or idempotency table.
- `/api/v1/insights` and its item routes continue to require `manage_own_insights`; list is filtered to the current owner. Update and delete retain existing owner checks. The Worker is authoritative even when controls are hidden.
- Templates use their existing independent shared/owner contract. Dictionary remains a separate API/model.
- `renderLibrary` does not display SQL. The existing Insights API only returns stored SQL when the user has `view_schema`; without it the SQL field is omitted. This is not a new disclosure grant.
- Existing Insights created before PX-03 may retain SQL. PX-03 does not remove it or copy it into new contextual saves.

## Persistence decision: REUSE

`insights` is reused as the canonical personal saved-analysis object. The contextual `POST /api/v1/insights` branch accepts `queryRunId`, title and optional note, reads the original question and outcome from the owner-scoped run, and writes `sql_text = NULL`. It never copies result rows, DLP output, policy predicates, EffectiveScope keys, provider prompts, credentials or semantic authorization state. Repeating a save for the same run returns the existing Insight with `alreadySaved` instead of creating a second item; an incompatible ID collision fails closed. Audit records the existing `insight.created` event with bounded source/run identity metadata only.

No migration was added. No QueryPolicyEngine, EffectiveScope, DLP, authentication, semantic runtime or export policy was changed.

## Re-run authorization and freshness

Saved content is intent and provenance, never authorization:

- Contextual saves have no stored SQL. “重新執行” sends their stored question to the existing `/api/v1/chat` flow, which produces a fresh governed run.
- Legacy SQL-backed Insights rerun through the existing `/api/v1/query` route. That route resolves the current identity and EffectiveScope, uses the central QueryPolicyEngine, executes under current row/column rules, and applies current DLP/result limits.
- Both paths create a new execution/query-run record; a historical run or result cannot authorize or substitute for it.
- The UI distinguishes “儲存於” from execution. The current Insight schema does not store last-run metadata; the Library therefore makes no “last run” or “current result” claim.

Saved analyses remain private to their owner under current API behavior. Sharing, team folders and permission inheritance are out of scope. HTML-derived values are escaped before rendering.

## Verification

Disposable APP/DATA D1 only; no Production D1, Worker deployment or GitHub operation was used. The full result is recorded after the final regression pass:

| Gate | Result |
|---|---|
| `npm run check` | PASS — Wrangler types + TypeScript `tsc --noEmit` |
| Migration immutability | PASS — protected migrations 0006–0013 unchanged |
| Disposable D1 migrations + schema verification | PASS — APP 0001–0013 and DATA 0001; expected schema/index/trigger checks passed |
| Unit/security/semantic | PASS — 114/114 |
| Product/RBAC/E2E | PASS — 37/37 |
| Complete Playwright suite | PASS — 151/151, single Chromium worker |
| Worker dry-run | PASS — Wrangler deploy `--dry-run`; no publish |
| PX-03 targeted tests | PASS — 5/5 |

The full suite used only the disposable localhost Worker/D1. The local Worker and test expectation both enabled `SEMANTIC_RUNTIME_CONTEXT_ENABLED` solely for the existing P2-E activation rehearsal; the local login-limit override was also test-only. No deployment configuration, Production Worker, Production D1, or GitHub state was changed.

PX-03 test coverage exercises owned successful saves, duplicate idempotency, failed query rejection, SQL rejection for contextual saves, cross-owner denial, capability-hidden actions and API rejection, current-scope rerun, prompt rerun with a new query run, save failure/retry, dialog Escape/focus return, title/note escaping, SQL-free Library presentation, rename/delete, empty state and mobile overflow/accessibility.

## Visual evidence

All screenshots use disposable demo data:

- [Save action](evidence/px-03/px-03-save-action.png)
- [Save dialog](evidence/px-03/px-03-save-dialog.png)
- [Saved confirmation](evidence/px-03/px-03-saved-state.png)
- [Library desktop](evidence/px-03/px-03-library.png)
- [Library mobile](evidence/px-03/px-03-library-mobile.png)

## Known UX debt

- The SPA still loads legacy Insight records for authorized users and keeps the older `#/insights` management route as “進階管理”; a later information-architecture slice can remove duplicate management entry points after confirming user needs.
- No last-run timestamp/status is available in the existing schema, so it is intentionally not displayed.
- Historical SQL remains in legacy rows for compatibility. It is hidden in Library presentation and every rerun is newly authorized; no result-preview retention was added.
- Frontend logic remains in the existing large `app.js`; modularization stays a separate backlog item.

## Release boundary

PX-03 was implemented and verified locally, then deployed with PX-01 and PX-02 on 2026-10-07. The release preserved existing Worker variables, applied no D1 migrations, and did not change `SEMANTIC_RUNTIME_CONTEXT_ENABLED` or mutate Semantic data. Immediate rollback is Worker `2b3d78f6-3758-4c3b-8b4f-92d086203e6e`. Production verification and test caveats are in [the deployment record](../releases/px-product-simplification-production-release.md).
