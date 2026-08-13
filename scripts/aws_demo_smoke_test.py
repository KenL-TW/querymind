from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass
class HttpResult:
    status: int
    body: str
    headers: dict[str, str]

    def json(self) -> dict[str, Any]:
        return json.loads(self.body or "{}")


def request(
    method: str,
    url: str,
    *,
    token: str | None = None,
    payload: dict[str, Any] | None = None,
    timeout: int = 20,
) -> HttpResult:
    headers = {"Accept": "application/json"}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return HttpResult(resp.status, body, dict(resp.headers.items()))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return HttpResult(exc.code, body, dict(exc.headers.items()))


def join_url(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + "/" + path.lstrip("/")


def wait_health(base_url: str, timeout_seconds: int) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    last_error = ""
    while time.monotonic() < deadline:
        try:
            result = request("GET", join_url(base_url, "/health"), timeout=10)
            if result.status == 200:
                payload = result.json()
                if payload.get("status") in {"ok", "healthy"}:
                    return payload
                return payload
            last_error = f"HTTP {result.status}: {result.body[:300]}"
        except Exception as exc:
            last_error = str(exc)
        time.sleep(2)
    raise RuntimeError(f"API did not become healthy within {timeout_seconds}s. Last error: {last_error}")


def require_status(result: HttpResult, expected: int, label: str) -> dict[str, Any]:
    if result.status != expected:
        raise RuntimeError(f"{label} failed: expected HTTP {expected}, got {result.status}: {result.body[:500]}")
    try:
        return result.json()
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{label} did not return JSON: {result.body[:500]}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description="Run QueryMind AWS demo smoke tests against a deployed URL.")
    parser.add_argument("--base-url", required=True, help="Public base URL, e.g. http://ec2-hostname")
    parser.add_argument("--email", default="owner@local", help="Login email.")
    parser.add_argument("--password", default="Owner123!", help="Login password.")
    parser.add_argument("--timeout", type=int, default=120, help="Health wait timeout in seconds.")
    parser.add_argument(
        "--include-chat",
        action="store_true",
        help="Also call /v1/chat/sync. This uses the configured LLM provider and may incur cost.",
    )
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")

    print(f"==> health {base_url}/health")
    health = wait_health(base_url, args.timeout)
    print(json.dumps({"health": health}, ensure_ascii=False))

    print("==> frontend root")
    root = request("GET", join_url(base_url, "/"), timeout=20)
    if root.status != 200:
        raise RuntimeError(f"Frontend root failed: HTTP {root.status}: {root.body[:300]}")
    if "text/html" not in root.headers.get("Content-Type", "").lower():
        print(f"WARNING: root content-type is {root.headers.get('Content-Type')!r}")

    print("==> login")
    login = require_status(
        request(
            "POST",
            join_url(base_url, "/v1/auth/login"),
            payload={"email": args.email, "password": args.password},
            timeout=20,
        ),
        200,
        "login",
    )
    token = login.get("access_token")
    if not token:
        raise RuntimeError("login response did not include access_token")

    print("==> /v1/me")
    me = require_status(request("GET", join_url(base_url, "/v1/me"), token=token), 200, "/v1/me")
    print(json.dumps({"me": me}, ensure_ascii=False))

    print("==> /v1/admin/system-info")
    system_info = require_status(
        request("GET", join_url(base_url, "/v1/admin/system-info"), token=token),
        200,
        "/v1/admin/system-info",
    )
    print(json.dumps({"system_info": system_info}, ensure_ascii=False))

    print("==> /v1/connections")
    connections = require_status(
        request("GET", join_url(base_url, "/v1/connections"), token=token),
        200,
        "/v1/connections",
    )
    print(json.dumps({"connections": connections}, ensure_ascii=False))

    if args.include_chat:
        print("==> /v1/chat/sync")
        chat = require_status(
            request(
                "POST",
                join_url(base_url, "/v1/chat/sync"),
                token=token,
                payload={"message": "List the available database connections.", "session_id": "aws-smoke", "conn_name": "default"},
                timeout=90,
            ),
            200,
            "/v1/chat/sync",
        )
        print(json.dumps({"chat_answer": chat.get("answer", "")[:500]}, ensure_ascii=False))

    print("AWS demo smoke test passed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Smoke test failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
