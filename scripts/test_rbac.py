import json
import requests

API = "http://localhost:8080"
OWNER = "qm_owner_dev_key_change_me"

print("=" * 70)
print("1) /v1/me with owner DB key")
r = requests.get(f"{API}/v1/me", headers={"X-API-Key": OWNER}, timeout=5)
print(json.dumps(r.json(), indent=2, ensure_ascii=False))

print("=" * 70)
print("2) /v1/me with no key (auth disabled → anonymous=owner)")
r = requests.get(f"{API}/v1/me", timeout=5)
print(json.dumps(r.json(), indent=2, ensure_ascii=False))

print("=" * 70)
print("3) /v1/admin/roles")
r = requests.get(f"{API}/v1/admin/roles", headers={"X-API-Key": OWNER}, timeout=5)
for role in r.json():
    print(f"  {role['name']:8s} max_rows={role['max_rows_per_query']:>10,}  verbs={role['allowed_sql_verbs']}")

print("=" * 70)
print("4) Create viewer + issue key")
r = requests.post(
    f"{API}/v1/admin/users",
    headers={"X-API-Key": OWNER},
    json={"email": "viewer-test@local", "role": "viewer"},
    timeout=5,
)
print("create:", r.status_code, r.text[:200])
if r.status_code == 201:
    uid = r.json()["id"]
    rk = requests.post(
        f"{API}/v1/admin/users/{uid}/keys",
        headers={"X-API-Key": OWNER},
        json={"label": "test"},
        timeout=5,
    )
    print("key:", rk.status_code, "prefix=", rk.json().get("api_key", "")[:8])

print("=" * 70)
print("5) List users")
r = requests.get(f"{API}/v1/admin/users", headers={"X-API-Key": OWNER}, timeout=5)
print(json.dumps(r.json(), indent=2, ensure_ascii=False))

print("=" * 70)
print("6) SQL verb extraction & permission unit-test")
from core.rbac import (
    UserContext, assert_sql_allowed, PermissionDeniedError, extract_sql_verb
)
viewer = UserContext(user_id="t", email="t@l", role_name="viewer")
print("verb of '-- c\\nSELECT 1':", extract_sql_verb("-- c\nSELECT 1"))
print("verb of 'DELETE FROM x':", extract_sql_verb("DELETE FROM x"))
try:
    assert_sql_allowed(viewer, "DELETE FROM users")
    print("FAIL: viewer DELETE should have been denied")
except PermissionDeniedError as e:
    print("PASS viewer-deny:", e)
try:
    v = assert_sql_allowed(viewer, "SELECT * FROM users")
    print("PASS viewer-select verb=", v)
except PermissionDeniedError as e:
    print("FAIL viewer-select:", e)
owner = UserContext(user_id="o", email="o@l", role_name="owner")
try:
    assert_sql_allowed(owner, "DROP TABLE users")
    print("FAIL: owner DROP should have been denied (global block)")
except PermissionDeniedError as e:
    print("PASS owner-drop-blocked:", e)
