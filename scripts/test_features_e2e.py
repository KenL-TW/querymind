"""E2E smoke test for the 5 productization features.

Covers:
  1. Token cost analytics  — /v1/admin/usage-stats reports token_totals
  2. Saved insights        — /v1/insights CRUD
  3. Schema autocomplete   — /v1/schema/{conn}/autocomplete
  4. Model routing         — /v1/chat/sync with /cheap and /strong tiers
  5. DLP / PII masking     — core.dlp.mask_rows direct unit + execute_query hook

Run after starting the backend on :8080 with AUTH_ENABLED=true.

  python scripts/test_features_e2e.py
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any

import requests

API = os.environ.get("QM_API", "http://127.0.0.1:8080")
OWNER_KEY = os.environ.get("QM_OWNER_KEY", "qm_owner_dev_key_change_me")
H = {"X-API-Key": OWNER_KEY}

failures: list[str] = []
passes: list[str] = []


def ok(name: str, cond: bool, extra: str = "") -> bool:
    tag = "PASS" if cond else "FAIL"
    line = f"  [{tag}] {name}" + (f"  ({extra})" if extra else "")
    print(line)
    (passes if cond else failures).append(name)
    return cond


def section(title: str) -> None:
    print(f"\n=== {title} ===")


def _get(path: str, **kw) -> requests.Response:
    return requests.get(f"{API}{path}", headers=H, timeout=15, **kw)


def _post(path: str, payload: Any, **kw) -> requests.Response:
    return requests.post(f"{API}{path}", headers=H, json=payload, timeout=30, **kw)


def _patch(path: str, payload: Any) -> requests.Response:
    return requests.patch(f"{API}{path}", headers=H, json=payload, timeout=15)


def _delete(path: str) -> requests.Response:
    return requests.delete(f"{API}{path}", headers=H, timeout=15)


# ---------------------------------------------------------------------------
# Feature 5 DLP — unit test (no backend needed)
# ---------------------------------------------------------------------------
def test_dlp_unit() -> None:
    section("Feature 5 — DLP unit (core/dlp.py)")
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from core.dlp import mask_rows  # noqa: WPS433

    rows = [
        {"email": "alice@example.com", "phone": "0912-345-678", "tw_id": "A123456789",
         "cc": "4111 1111 1111 1111", "ip": "10.0.0.5", "note": "ok"},
        {"email": "bob@foo.bar", "ip": "192.168.1.1"},
    ]
    masked, hits = mask_rows(rows, enabled=True, role_exempt=set(), role_name="viewer")
    ok("DLP redactions > 0", hits > 0, f"hits={hits}")
    ok("email partially masked", masked[0]["email"].startswith("a") and "***@" in masked[0]["email"])
    ok("tw_id masked", masked[0]["tw_id"] != "A123456789")
    ok("ip masked", masked[0]["ip"] != "10.0.0.5")

    # exempt role bypass
    masked2, hits2 = mask_rows(rows, enabled=True, role_exempt={"owner"}, role_name="owner")
    ok("DLP exempt bypass", hits2 == 0 and masked2[0]["email"] == "alice@example.com")

    # disabled bypass
    masked3, hits3 = mask_rows(rows, enabled=False, role_name="viewer")
    ok("DLP disabled bypass", hits3 == 0)


# ---------------------------------------------------------------------------
# Feature 2 Saved insights — CRUD
# ---------------------------------------------------------------------------
def test_insights() -> int | None:
    section("Feature 2 — Saved insights CRUD")
    # CREATE
    r = _post("/v1/insights", {
        "title": "E2E demo insight",
        "kind": "sql",
        "sql": "SELECT 1 AS one",
        "description": "smoke",
        "tags": ["e2e", "demo"],
    })
    ok("POST /v1/insights 2xx", r.status_code in (200, 201), f"status={r.status_code} body={r.text[:200]}")
    if r.status_code not in (200, 201):
        return None
    insight = r.json()
    iid = insight["id"]
    ok("created has id", isinstance(iid, int))
    ok("kind=sql echoed", insight.get("kind") == "sql")

    # LIST
    r = _get("/v1/insights", params={"q": "E2E"})
    ok("GET /v1/insights search", r.status_code == 200 and any(i["id"] == iid for i in r.json()))

    # PATCH (pin + title rename)
    r = _patch(f"/v1/insights/{iid}", {"pinned": True, "title": "E2E demo insight (pinned)"})
    ok("PATCH pin+rename 200", r.status_code == 200 and r.json().get("pinned") is True)

    # GET single
    r = _get(f"/v1/insights/{iid}")
    ok("GET /v1/insights/{id} 200", r.status_code == 200)

    # DELETE
    r = _delete(f"/v1/insights/{iid}")
    ok("DELETE /v1/insights/{id}", r.status_code in (200, 204))
    return iid


# ---------------------------------------------------------------------------
# Feature 3 Schema autocomplete
# ---------------------------------------------------------------------------
def test_autocomplete() -> None:
    section("Feature 3 — Schema autocomplete")
    # Find a valid conn name
    r = _get("/v1/admin/connections")
    conn = None
    if r.status_code == 200:
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        if items:
            conn = items[0].get("name") or items[0].get("conn_name")
    if not conn:
        conn = "default"

    r = _get(f"/v1/schema/{conn}/autocomplete", params={"prefix": "", "limit": 20})
    ok(f"GET autocomplete (conn={conn}) 200", r.status_code == 200,
       f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        ok("autocomplete returns suggestions key", "suggestions" in body)
        # try a table.column prefix if we got at least one table
        tables = [s["value"] for s in body.get("suggestions", []) if s.get("kind") == "table"]
        if tables:
            r2 = _get(f"/v1/schema/{conn}/autocomplete",
                      params={"prefix": tables[0] + ".", "limit": 20})
            ok("autocomplete scoped table.col 200", r2.status_code == 200)


# ---------------------------------------------------------------------------
# Feature 1 + 4 Token cost & routing — single sync chat call
# ---------------------------------------------------------------------------
def test_tokens_and_routing() -> None:
    section("Feature 1 + 4 — Token capture & routing (sync chat)")
    import uuid
    sid = f"e2e-{uuid.uuid4().hex[:8]}"

    # ask a trivial question — small enough that cheap tier should be picked
    r = _post("/v1/chat/sync", {"session_id": sid, "message": "請回我一個字：嗨"})
    ok("chat/sync 200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")

    # Inspect audit log via admin usage-stats
    r = _get("/v1/admin/usage-stats")
    ok("usage-stats 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        body = r.json()
        tt = body.get("token_totals") or {}
        ok("token_totals present", isinstance(tt, dict))
        ok("token_daily_series present", "token_daily_series" in body)
        ok("token_by_model present", "token_by_model" in body)
        # token totals may legitimately be 0 if LLM didn't report usage, so just print
        print(f"   token_totals snapshot: {json.dumps(tt, ensure_ascii=False)[:200]}")

    # Try a /cheap prefix and a /strong prefix — should both succeed
    for tag in ("/cheap", "/strong"):
        r = _post("/v1/chat/sync", {"session_id": sid, "message": f"{tag} ping"})
        ok(f"chat/sync with {tag} prefix", r.status_code == 200, f"status={r.status_code}")


def main() -> int:
    print(f"Target API: {API}")
    # cheap-first: DLP unit (no backend dependency)
    test_dlp_unit()
    # backend reachability
    try:
        r = _get("/v1/me")
    except Exception as e:
        print(f"\nERROR: backend unreachable at {API}: {e}")
        return 2
    if r.status_code != 200:
        print(f"\nERROR: /v1/me returned {r.status_code} — backend not authenticated. body={r.text[:200]}")
        return 2
    test_insights()
    test_autocomplete()
    test_tokens_and_routing()

    print("\n" + "=" * 50)
    print(f"PASS: {len(passes)}   FAIL: {len(failures)}")
    if failures:
        for f in failures:
            print(f"  - {f}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
