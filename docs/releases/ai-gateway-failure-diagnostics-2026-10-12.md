# AI Gateway Failure Diagnostics — 2026-10-12

**Status:** Deployed to Cloudflare Production.

## Release

- Source commit: `3b906d4` (`fix: improve AI Gateway failure diagnostics`)
- Worker: `querymind` — `https://querymind.digitalaaronl.workers.dev`
- Deployed Worker version: `d1092036-ca72-475a-87c9-9afb209c2c8f` (version 33)
- Traffic: 100%
- Immediate rollback version: `5c222254-6f18-4c71-8db7-0588a926946e` (version 32)
- Deployment used the production config and `--keep-vars`; no D1 migration, secret, Gateway, or governance-data change was made.
- No GitHub push was performed.

## Change

Gateway non-2xx/network/timeout failures now return a safe reference ID and emit bounded structured diagnostics without logging the prompt, provider response body, or credentials. Chat retains the submitted prompt and shows an inline error with the failure code/reference ID and a retry action. A successful chat followed by a history reload failure is reported separately.

## Verification

- Unit/security/explainability/semantic regression: **115/115 passed**.
- Targeted browser UI test for retained prompt, error details, and retry: **1/1 passed** using installed Chrome.
- Typecheck, migration immutability check, release manifest check, JavaScript syntax check, and `git diff --check`: **PASS**.
- Production preflight and Worker dry-run: **PASS**; bundle 393.26 KiB (gzip 82.99 KiB), APP and DATA D1 bindings present.
- Public production smoke (`/`, `/health`, anonymous protected API): **PASS**.
- Authenticated production smoke: **not run**; the available browser showed the login page. No credential was entered and no AI query was sent.
- The underlying live AI Gateway failure was not re-triggered; this release adds diagnostics and improves failure UX without incurring a new provider request.

## Scope guard

No D1 migration, production policy/user/role/semantic mutation, secret update, or semantic runtime activation occurred.
