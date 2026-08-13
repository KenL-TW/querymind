"""Quickly hit /login (success+fail), /refresh, /logout to seed auth.* audit rows."""
import os, requests, sys

BASE = os.environ.get("BASE", "http://127.0.0.1:8080")
OWNER_KEY = os.environ.get("OWNER_KEY", "qm_owner_dev_key_change_me")
OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "owner@local")

s = requests.Session()

print(">> login_failed (wrong password)")
r = s.post(f"{BASE}/v1/auth/login", json={"email": OWNER_EMAIL, "password": "WRONG"})
print("  ", r.status_code)

# Owner default has no password (api-key bootstrap), so set one via /me change-password? Skip:
# Instead pick an existing user with password — use last viewer e2e created.
# Fallback: create one quickly via owner key + invite + accept.
hdr = {"X-API-Key": OWNER_KEY}
import secrets
suf = secrets.token_hex(3)
email = f"audit-e2e-{suf}@local"
inv = s.post(f"{BASE}/v1/admin/invitations", headers=hdr,
             json={"email": email, "role": "viewer"}).json()
tok = inv["invite_token"]
pwd = "Aa12345678!"
acc = s.post(f"{BASE}/v1/auth/accept-invite",
             json={"token": tok, "password": pwd, "display_name": "auditE2E"})
print(">> accept-invite", acc.status_code)
access = acc.json()["access_token"]

print(">> login success")
r = s.post(f"{BASE}/v1/auth/login", json={"email": email, "password": pwd})
print("  ", r.status_code)
access2 = r.json()["access_token"]
# refresh cookie was set by Set-Cookie on the session

print(">> refresh")
r = s.post(f"{BASE}/v1/auth/refresh")
print("  ", r.status_code, "new access?" , bool(r.json().get("access_token")))

print(">> logout")
r = s.post(f"{BASE}/v1/auth/logout")
print("  ", r.status_code, r.json())

print(">> refresh after logout (should fail)")
r = s.post(f"{BASE}/v1/auth/refresh")
print("  ", r.status_code)
