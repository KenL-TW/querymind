"""
QueryMind 本地完整測試腳本
執行方式：  python test_local.py
選項：
  --start-server   自動在背景啟動 API server（需要 .env.local 設好 key）
  --url            指定 API base URL（預設 http://localhost:8080）
  --key            指定 API key（預設讀 .env.local 的 dev-key-change-me）
  --with-llm       執行需要真實 LLM 的對話測試（需要有效 OPENAI_API_KEY）
"""
from __future__ import annotations

import argparse
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import requests
from sqlalchemy import create_engine, text

from config.settings import settings

# ── 顏色輸出 ────────────────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

passed = []
failed = []
skipped = []


def ok(name: str, detail: str = "") -> None:
    passed.append(name)
    print(f"  {GREEN}✓{RESET} {name}" + (f"  {CYAN}{detail}{RESET}" if detail else ""))


def fail(name: str, detail: str = "") -> None:
    failed.append(name)
    print(f"  {RED}✗{RESET} {name}" + (f"  {RED}{detail}{RESET}" if detail else ""))


def skip(name: str, reason: str = "") -> None:
    skipped.append(name)
    print(f"  {YELLOW}—{RESET} {name}" + (f"  ({reason})" if reason else ""))


def section(title: str) -> None:
    print(f"\n{BOLD}{CYAN}{'─'*50}{RESET}")
    print(f"{BOLD}{CYAN}  {title}{RESET}")
    print(f"{BOLD}{CYAN}{'─'*50}{RESET}")


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def get(url: str, headers: dict = {}, **kw) -> requests.Response:
    return requests.get(url, headers=headers, timeout=15, **kw)


def post(url: str, body: dict, headers: dict = {}) -> requests.Response:
    return requests.post(url, json=body, headers=headers, timeout=60)


# ── Test groups ──────────────────────────────────────────────────────────────

def test_health(base: str) -> None:
    section("1. Health Check")
    try:
        r = get(f"{base}/health")
        assert r.status_code == 200, f"status={r.status_code}"
        data = r.json()
        assert data["status"] == "ok", f"status field={data['status']}"
        ok("GET /health", f"version={data['version']}  connections={data['connections']}")
    except Exception as e:
        fail("GET /health", str(e))


def test_metrics(base: str) -> None:
    section("2. Prometheus Metrics")
    try:
        r = get(f"{base}/metrics")
        assert r.status_code == 200, f"status={r.status_code}"
        body = r.text
        checks = [
            ("http_requests_total",           "FastAPI HTTP counter"),
            ("querymind_agent_calls_total",    "agent calls counter"),
            ("querymind_tool_calls_total",     "tool calls counter"),
            ("querymind_agent_latency_seconds","agent latency histogram"),
        ]
        for metric, label in checks:
            if metric in body:
                ok(f"  metric: {metric}", label)
            else:
                fail(f"  metric: {metric}", "not found in /metrics output")
    except Exception as e:
        fail("GET /metrics", str(e))


def test_export(base: str, key: str) -> None:
    section("3. Export Endpoints  (CSV / XLSX)")
    headers = {"X-API-Key": key}
    sql = "SELECT 1 AS id, 'hello' AS name"

    # CSV
    try:
        r = get(f"{base}/v1/export/csv", headers=headers, params={"sql": sql, "filename": "test_export"})
        assert r.status_code == 200, f"status={r.status_code}  body={r.text[:200]}"
        assert "text/csv" in r.headers.get("content-type", ""), "wrong content-type"
        assert "id" in r.text and "name" in r.text, "columns missing"
        lines = [l for l in r.text.splitlines() if l.strip()]
        ok("GET /v1/export/csv", f"{len(lines)-1} data rows  ({len(r.content)} bytes)")
    except Exception as e:
        fail("GET /v1/export/csv", str(e))

    # XLSX
    try:
        r = get(f"{base}/v1/export/xlsx", headers=headers, params={"sql": sql, "filename": "test_export"})
        assert r.status_code == 200, f"status={r.status_code}  body={r.text[:200]}"
        ct = r.headers.get("content-type", "")
        assert "spreadsheetml" in ct or "octet-stream" in ct, f"wrong content-type: {ct}"
        assert len(r.content) > 100, "response too small to be valid XLSX"

        # Verify it's a real ZIP/XLSX by checking magic bytes
        assert r.content[:2] == b"PK", "not a valid ZIP/XLSX file"
        ok("GET /v1/export/xlsx", f"{len(r.content)} bytes  (valid XLSX magic ✓)")
    except Exception as e:
        fail("GET /v1/export/xlsx", str(e))


def test_sessions(base: str, key: str) -> None:
    section("4. Session Management")
    headers = {"X-API-Key": key}

    # List sessions
    try:
        r = get(f"{base}/v1/sessions", headers=headers)
        assert r.status_code == 200, f"status={r.status_code}"
        data = r.json()
        assert "sessions" in data
        ok("GET /v1/sessions", f"{len(data['sessions'])} sessions found")
    except Exception as e:
        fail("GET /v1/sessions", str(e))

    # Prune (DELETE /v1/sessions) — should succeed even with 0 rows deleted
    try:
        r = requests.delete(f"{base}/v1/sessions", headers=headers, timeout=15)
        assert r.status_code == 200, f"status={r.status_code}  body={r.text[:200]}"
        data = r.json()
        assert "deleted_rows" in data
        ok("DELETE /v1/sessions (prune)", f"deleted_rows={data['deleted_rows']}  retention_days={data['retention_days']}")
    except Exception as e:
        fail("DELETE /v1/sessions (prune)", str(e))


def test_audit_db(meta_db_url: str) -> None:
    section("5. Audit Log DB  (direct PostgreSQL check)")
    if not meta_db_url.startswith("postgresql"):
        skip("qm_audit_log table check", "METADATA_DB_URL is not PostgreSQL")
        return
    try:
        engine = create_engine(meta_db_url)
        with engine.connect() as conn:
            row = conn.execute(text(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'qm_audit_log'
                LIMIT 1
                """
            )).fetchone()
            if row:
                ok("qm_audit_log table exists")
                count = conn.execute(text("SELECT COUNT(*) FROM qm_audit_log")).scalar_one()
                ok("qm_audit_log row count", f"{count} entries")
            else:
                skip("qm_audit_log table exists", "table not yet created (server not started once)")
        engine.dispose()
    except Exception as e:
        fail("qm_audit_log table check", str(e))


def test_chat_sync(base: str, key: str) -> None:
    """Needs real LLM — only run with --with-llm."""
    section("6. Chat Sync  (LLM required)")
    headers = {"X-API-Key": key}
    body = {
        "message": "執行 SQL: SELECT 1 AS answer",
        "session_id": "test-local-run",
        "conn_name": "default",
    }
    try:
        r = post(f"{base}/v1/chat/sync", body, headers=headers)
        assert r.status_code == 200, f"status={r.status_code}  body={r.text[:400]}"
        data = r.json()
        assert "answer" in data and data["answer"], "empty answer"
        ok("POST /v1/chat/sync", f"answer preview: {data['answer'][:80]!r}")
        if data.get("steps"):
            ok("  tool steps returned", f"{len(data['steps'])} step(s)")
    except Exception as e:
        fail("POST /v1/chat/sync", str(e))


def test_chat_stream(base: str, key: str) -> None:
    """Needs real LLM — only run with --with-llm."""
    section("7. Chat Stream  (LLM required)")
    headers = {"X-API-Key": key, "Accept": "text/event-stream"}
    body = {
        "message": "用中文回答：1+1等於幾？",
        "session_id": "test-stream-run",
        "conn_name": "default",
    }
    try:
        with requests.post(f"{base}/v1/chat", json=body, headers=headers, stream=True, timeout=60) as r:
            assert r.status_code == 200, f"status={r.status_code}"
            events: list[str] = []
            tokens: list[str] = []
            for raw_line in r.iter_lines():
                line = raw_line.decode() if isinstance(raw_line, bytes) else raw_line
                if line.startswith("event:"):
                    events.append(line.split(":", 1)[1].strip())
                elif line.startswith("data:") and '"token"' in line:
                    try:
                        tokens.append(json.loads(line[5:])["token"])
                    except Exception:
                        pass
                if "finish" in events:
                    break

        ok("POST /v1/chat  (SSE stream)", f"events={events}  tokens={len(tokens)}")
        assert "finish" in events, f"no 'finish' event received, got: {events}"
        ok("  'finish' event received")
    except Exception as e:
        fail("POST /v1/chat  (SSE stream)", str(e))


def test_scheduler_api(base: str, key: str) -> None:
    """Test scheduler tool indirectly via sync chat  — only run with --with-llm."""
    section("8. Scheduler  (via agent tool, LLM required)")
    headers = {"X-API-Key": key}
    body = {
        "message": "幫我建立一個排程，名稱 test_sched，每天早上8點執行 SQL: SELECT COUNT(*) FROM information_schema.tables，使用 conn_name=default",
        "session_id": "test-scheduler",
        "conn_name": "default",
    }
    try:
        r = post(f"{base}/v1/chat/sync", body, headers=headers)
        assert r.status_code == 200, f"status={r.status_code}"
        data = r.json()
        answer = data.get("answer", "")
        steps = data.get("steps", [])
        scheduler_tools = [s for s in steps if "schedule" in s.get("action", "").lower()]
        if scheduler_tools:
            ok("Scheduler tool invoked", f"tool={scheduler_tools[0]['action']}")
        else:
            ok("POST /v1/chat/sync (scheduler)", f"answer: {answer[:100]!r}")
    except Exception as e:
        fail("Scheduler via agent", str(e))


# ── Server lifecycle ─────────────────────────────────────────────────────────

def start_server(port: int) -> subprocess.Popen:
    print(f"\n{YELLOW}Starting QueryMind server on port {port}...{RESET}")
    proc = subprocess.Popen(
        [sys.executable, "main.py"],
        cwd=Path(__file__).parent,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    # Wait for server to be ready
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            requests.get(f"http://localhost:{port}/health", timeout=2)
            print(f"{GREEN}Server ready!{RESET}\n")
            return proc
        except Exception:
            time.sleep(1)
    proc.terminate()
    raise RuntimeError(f"Server did not start within 30s on port {port}")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="QueryMind local test suite")
    parser.add_argument("--url",          default="http://localhost:8080", help="API base URL")
    parser.add_argument("--key",          default="dev-key-change-me",     help="API key")
    parser.add_argument("--start-server", action="store_true",             help="Start API server before testing")
    parser.add_argument("--with-llm",     action="store_true",             help="Also run tests that call the real LLM")
    parser.add_argument("--meta-db",      default=settings.metadata_db_url, help="Metadata PostgreSQL URL")
    args = parser.parse_args()

    print(f"\n{BOLD}QueryMind 本地測試{RESET}")
    print(f"  URL : {args.url}")
    print(f"  Key : {args.key[:4]}****")
    print(f"  LLM : {'enabled' if args.with_llm else 'skipped (--with-llm to enable)'}")

    server_proc = None
    if args.start_server:
        port = int(args.url.split(":")[-1].split("/")[0])
        server_proc = start_server(port)

    try:
        # ── Non-LLM tests (always run) ────────────────────────────────────
        test_health(args.url)
        test_metrics(args.url)
        test_export(args.url, args.key)
        test_sessions(args.url, args.key)
        test_audit_db(args.meta_db)

        # ── LLM tests (opt-in) ────────────────────────────────────────────
        if args.with_llm:
            test_chat_sync(args.url, args.key)
            test_chat_stream(args.url, args.key)
            test_scheduler_api(args.url, args.key)
        else:
            section("6-8. Chat / Stream / Scheduler  (skipped)")
            for name in ["POST /v1/chat/sync", "POST /v1/chat (stream)", "Scheduler tool"]:
                skip(name, "pass --with-llm to enable")

    finally:
        if server_proc:
            server_proc.terminate()

    # ── Summary ───────────────────────────────────────────────────────────
    total = len(passed) + len(failed) + len(skipped)
    print(f"\n{BOLD}{'─'*50}{RESET}")
    print(f"{BOLD}結果：{RESET}  "
          f"{GREEN}{len(passed)} passed{RESET}  "
          f"{RED}{len(failed)} failed{RESET}  "
          f"{YELLOW}{len(skipped)} skipped{RESET}  "
          f"(共 {total} 項)")
    if failed:
        print(f"\n{RED}Failed:{RESET}")
        for f in failed:
            print(f"  • {f}")
    print()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
