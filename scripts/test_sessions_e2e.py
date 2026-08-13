"""End-to-end check for per-user session isolation, search, pin, archive.

Pre-req: backend running with AUTH_ENABLED=true on :8080
"""
import os
import secrets
import sys
import requests
from sqlalchemy import create_engine, text

from config.settings import settings

BASE = os.environ.get("BASE", "http://127.0.0.1:8080")
OWNER_KEY = os.environ.get("OWNER_KEY", "qm_owner_dev_key_change_me")

owner_h = {"X-API-Key": OWNER_KEY}


def assert_eq(actual, expected, msg):
    if actual != expected:
        print(f"FAIL {msg}: expected={expected} actual={actual}")
        sys.exit(1)
    print(f"  OK   {msg}")


def create_viewer(suffix: str):
    """Invite + accept a viewer; returns (session_obj, user_dict, access_token)."""
    email = f"sess-e2e-{suffix}@local"
    inv = requests.post(
        f"{BASE}/v1/admin/invitations", headers=owner_h,
        json={"email": email, "role": "viewer"},
    ).json()
    s = requests.Session()
    pwd = "Aa12345678!"
    r = s.post(
        f"{BASE}/v1/auth/accept-invite",
        json={"token": inv["invite_token"], "password": pwd, "display_name": f"viewer-{suffix}"},
    ).json()
    return s, r["user"], r["access_token"]


def auth_h(tok):
    return {"Authorization": f"Bearer {tok}"}


def send_chat(s, tok, sid, msg):
    """Use sync /v1/chat/sync to avoid SSE complexity."""
    r = s.post(
        f"{BASE}/v1/chat/sync",
        headers=auth_h(tok),
        json={"message": msg, "session_id": sid, "conn_name": "default"},
        timeout=120,
    )
    r.raise_for_status()
    return r.json()


def list_sessions(s, tok, **params):
    r = s.get(f"{BASE}/v1/sessions", headers=auth_h(tok), params=params)
    r.raise_for_status()
    return r.json()["sessions"]


def patch_session(s, tok, sid, **body):
    r = s.patch(f"{BASE}/v1/sessions/{sid}", headers=auth_h(tok), json=body)
    return r


# ── Run ──────────────────────────────────────────────────────────────────────
print("# 1) Two viewers each create one session")
suf_a = secrets.token_hex(2)
suf_b = secrets.token_hex(2)
sA, userA, tokA = create_viewer(suf_a)
sB, userB, tokB = create_viewer(suf_b)
print(f"  userA={userA['user_id']} userB={userB['user_id']}")

sidA = f"s_e2e_{suf_a}"
sidB = f"s_e2e_{suf_b}"
send_chat(sA, tokA, sidA, "顯示 default 連線上有哪些 schema？")
send_chat(sB, tokB, sidB, "請列出所有 schema 名稱。")

print("\n# 2) A only sees own session, B only sees own")
listA = list_sessions(sA, tokA)
listB = list_sessions(sB, tokB)
idsA = {s["session_id"] for s in listA}
idsB = {s["session_id"] for s in listB}
assert_eq(sidA in idsA, True, "A sees its own")
assert_eq(sidB not in idsA, True, "A does NOT see B's session")
assert_eq(sidB in idsB, True, "B sees its own")
assert_eq(sidA not in idsB, True, "B does NOT see A's session")

print("\n# 3) B tries to GET A's session → 403")
r = sB.get(f"{BASE}/v1/sessions/{sidA}", headers=auth_h(tokB))
assert_eq(r.status_code, 403, "B cannot read A's session")

print("\n# 4) Owner sees all when all_users=true")
ownerListAll = requests.get(
    f"{BASE}/v1/sessions", headers=owner_h,
    params={"all_users": "true"},
).json()["sessions"]
allIds = {s["session_id"] for s in ownerListAll}
assert_eq(sidA in allIds and sidB in allIds, True, "owner sees both with all_users=true")

print("\n# 5) Pin A's session → it floats first")
patch_session(sA, tokA, sidA, pinned=True)
# Create a 2nd, later session for A so we can test ordering
sidA2 = f"s_e2e_{suf_a}_2"
send_chat(sA, tokA, sidA2, "再列一次 schema。")
listA2 = list_sessions(sA, tokA)
assert_eq(listA2[0]["session_id"], sidA, "pinned session is first")
assert_eq(listA2[0]["pinned"], True, "pinned flag = true")

print("\n# 6) Search filters by title/summary")
patch_session(sA, tokA, sidA2, title="SearchableTitleXYZ")
hits = list_sessions(sA, tokA, q="SearchableTitleXYZ")
assert_eq(len(hits), 1, "search 'SearchableTitleXYZ' returns 1")
assert_eq(hits[0]["session_id"], sidA2, "correct session returned")

print("\n# 7) Archive hides from default list, surfaces in archived_only")
patch_session(sA, tokA, sidA2, archived=True)
hidden = list_sessions(sA, tokA)
assert_eq(any(s["session_id"] == sidA2 for s in hidden), False, "archived session hidden")
arch = list_sessions(sA, tokA, archived_only="true")
assert_eq(any(s["session_id"] == sidA2 for s in arch), True, "archived session in archived_only")

print("\n# 8) prune_old_sessions respects retention (manual ageing)")
engine = create_engine(settings.metadata_db_url)
with engine.begin() as conn:
    conn.execute(
        text("UPDATE qm_session_meta SET updated_at=:updated_at WHERE session_id=:sid"),
        {"updated_at": "2020-01-01T00:00:00+00:00", "sid": sidA2},
    )
engine.dispose()
pr = requests.delete(f"{BASE}/v1/sessions", headers=owner_h).json()
assert_eq(pr["status"], "pruned", "prune ran")
print(f"  pruned rows = {pr['deleted_rows']}, retention = {pr['retention_days']}")
# sidA (pinned) MUST survive even though it's recent; sidA2 must be gone
afterAll = requests.get(
    f"{BASE}/v1/sessions", headers=owner_h, params={"all_users": "true", "include_archived": "true"},
).json()["sessions"]
afterIds = {s["session_id"] for s in afterAll}
assert_eq(sidA in afterIds, True, "pinned A session survived prune")
assert_eq(sidA2 in afterIds, False, "aged archived A2 removed by prune")
assert_eq(sidB in afterIds, True, "B's recent session survived prune")

print("\nALL 16 ASSERTIONS PASSED ✅")
