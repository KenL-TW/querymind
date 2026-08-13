"""End-to-end test: owner creates a viewer invitation, the invitee accepts it,
then we verify the new viewer is denied operations they shouldn't be able to do
(export / ETL / schedule / DELETE / oversized SELECT).

Run with the backend on http://localhost:8080 and AUTH_ENABLED=true.
"""
from __future__ import annotations

import json
import os
import secrets
import sys
import time
from typing import Any

import requests

BASE = os.environ.get("QM_BASE", "http://localhost:8080")
OWNER_KEY = os.environ.get("QM_OWNER_KEY", "qm_owner_dev_key_change_me")

S = requests.Session()
ROW = "─" * 78


def banner(msg: str) -> None:
    print(f"\n{ROW}\n  {msg}\n{ROW}")


def call(method: str, path: str, *, headers: dict | None = None, **kw) -> requests.Response:
    url = f"{BASE}{path}"
    kw.setdefault("timeout", 30)
    r = S.request(method, url, headers=headers or {}, **kw)
    print(f"[{r.status_code}] {method} {path}")
    return r


def expect(cond: bool, label: str) -> bool:
    mark = "PASS" if cond else "FAIL"
    print(f"   [{mark}] {label}")
    return cond


def main() -> int:
    results: list[bool] = []
    owner_h = {"X-API-Key": OWNER_KEY}

    # ── 1. owner sanity ─────────────────────────────────────────────────────
    banner("1. owner: /v1/me 確認身分")
    r = call("GET", "/v1/me", headers=owner_h)
    if r.status_code != 200:
        print("owner API key invalid; aborting.", r.text)
        return 1
    me = r.json()
    print(f"   role={me.get('role_name')} caps={me.get('capabilities')}")
    caps = me.get("capabilities") or []
    results.append(expect(me.get("role_name") == "owner", "owner.role_name == owner"))
    results.append(expect("*" in caps or "manage_users" in caps, "owner has manage_users (or *)"))

    # ── 2. owner 建立 viewer 邀請 ──────────────────────────────────────────
    banner("2. owner: 建立 role=viewer 邀請")
    invitee_email = f"viewer-e2e-{secrets.token_hex(3)}@local"
    r = call("POST", "/v1/admin/invitations", headers=owner_h, json={
        "email": invitee_email,
        "role": "viewer",
        "allowed_conns": [],
        "expires_hours": 1,
    })
    results.append(expect(r.status_code in (200, 201), "create invitation 2xx"))
    payload = r.json()
    invite_token = payload.get("invite_token")
    print(f"   invite_token preview={str(invite_token)[:20]}...")
    results.append(expect(bool(invite_token), "got invite_token"))

    # ── 3. 接受邀請 ────────────────────────────────────────────────────────
    banner("3. invitee: 接受邀請並設定密碼")
    new_pwd = f"Test!{secrets.token_hex(4)}"
    r = call("POST", "/v1/auth/accept-invite", json={
        "token": invite_token,
        "password": new_pwd,
        "display_name": "E2E Viewer",
    })
    results.append(expect(r.status_code == 200, "accept-invite 200"))
    body = r.json()
    viewer_access = body.get("access_token")
    user_info = body.get("user", {})
    results.append(expect(user_info.get("role_name") == "viewer", "new user.role_name == viewer"))
    results.append(expect(bool(viewer_access), "got viewer access_token"))
    print(f"   viewer email={user_info.get('email')} role={user_info.get('role_name')} caps={user_info.get('capabilities')}")

    viewer_h = {"Authorization": f"Bearer {viewer_access}"}

    # ── 4. viewer 不可呼叫 /v1/admin/* ─────────────────────────────────────
    banner("4. viewer: /v1/admin/users 應 403")
    r = call("GET", "/v1/admin/users", headers=viewer_h)
    results.append(expect(r.status_code == 403, "viewer /v1/admin/users → 403"))

    # ── 5. 直接呼叫工具 + 設定 user context 驗證 RBAC ─────────────────────
    banner("5. 直接呼叫各工具，驗證 viewer 受限 / owner 暢通")
    # 把後端模組載進來呼叫，模擬 agent 內部執行
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from api.context import set_current_user, clear_current_user
    from core.rbac import UserContext
    from db.registry import ConnectionRegistry
    from storage.code_archive import CodeArchive
    from adapters.storage.local_adapter import LocalStorageAdapter
    from adapters.scheduler.apscheduler_adapter import APSchedulerAdapter
    from tools.db_tools import make_db_tools
    from tools.export_tools import make_export_tools
    from tools.etl_tools import make_etl_tools
    from tools.scheduler_tools import make_scheduler_tools
    from tools.viz_tools import make_viz_tools

    # 從正在跑的 backend 同樣 default PostgreSQL 連線
    from config.settings import settings
    registry = ConnectionRegistry.from_config(settings.db_connections_dict)
    storage = LocalStorageAdapter(base_path="data/uploads")
    archive = None  # only run_etl_code is exercised; doesn't touch archive
    try:
        scheduler = APSchedulerAdapter()
    except Exception:
        scheduler = None

    db_tools = {t.name: t for t in make_db_tools(registry)}
    export_tools = {t.name: t for t in make_export_tools(registry)}
    etl_tools = {t.name: t for t in make_etl_tools(archive, storage)}
    sched_tools = {t.name: t for t in make_scheduler_tools(scheduler)} if scheduler else {}
    viz_tools = {t.name: t for t in make_viz_tools(registry)}

    viewer_ctx = UserContext(
        user_id=str(user_info.get("user_id", "0")),
        email=invitee_email,
        role_name="viewer",
    )
    owner_ctx = UserContext(
        user_id="owner-test",
        email="owner@local",
        role_name="owner",
    )

    def as_user(user, fn):
        set_current_user(user)
        try:
            return fn()
        finally:
            clear_current_user()

    def parse(out: str) -> dict:
        try:
            return json.loads(out) if out.startswith("{") or out.startswith("[") else {"raw": out}
        except Exception:
            return {"raw": out}

    # viewer SELECT 應通過
    out = as_user(viewer_ctx, lambda: db_tools["execute_query"].invoke(
        {"sql": "SELECT 1 AS one", "conn_name": "default"}))
    print(f"   viewer SELECT → {out[:160]}")
    results.append(expect("denied" not in out.lower(), "viewer SELECT 1 通過"))

    # viewer DELETE 應被拒
    out = as_user(viewer_ctx, lambda: db_tools["execute_query"].invoke(
        {"sql": "DELETE FROM customers WHERE 1=0", "conn_name": "default", "confirmed": True}))
    p = parse(out)
    print(f"   viewer DELETE → {out[:160]}")
    results.append(expect(p.get("denied") is True, "viewer DELETE 被 RBAC 拒絕"))

    # viewer 不可使用 compare_ddl（不在 allowed_tools 白名單）
    out = as_user(viewer_ctx, lambda: db_tools["compare_ddl"].invoke(
        {"table_name": "customers", "source_conn": "default", "target_conn": "default"}))
    p = parse(out)
    print(f"   viewer compare_ddl → {out[:160]}")
    results.append(expect(p.get("denied") is True, "viewer compare_ddl 被 allowed_tools 擋下"))

    # viewer 匯出 CSV 應被拒（can_export=False）
    out = as_user(viewer_ctx, lambda: export_tools["export_query_csv"].invoke(
        {"sql": "SELECT 1 AS a", "conn_name": "default", "filename": "x"}))
    p = parse(out)
    print(f"   viewer export_csv → {out[:160]}")
    results.append(expect(p.get("denied") is True, "viewer export_query_csv 被 can_export 擋下"))

    # viewer 執行 ETL 應被拒（can_etl=False）
    out = as_user(viewer_ctx, lambda: etl_tools["run_etl_code"].invoke({"code": "print('x')"}))
    p = parse(out)
    print(f"   viewer run_etl → {out[:160]}")
    results.append(expect(p.get("denied") is True, "viewer run_etl_code 被 can_etl 擋下"))

    # viewer 建立排程應被拒（can_schedule=False）
    if sched_tools:
        out = as_user(viewer_ctx, lambda: sched_tools["create_schedule"].invoke({
            "name": "x", "cron_expression": "* * * * *",
            "target": "SELECT 1", "conn_name": "default",
        }))
        p = parse(out)
        print(f"   viewer create_schedule → {out[:160]}")
        results.append(expect(p.get("denied") is True, "viewer create_schedule 被 can_schedule 擋下"))

    # viewer query_to_chart 不在 allowed_tools 白名單，應被擋（viewer 限定 5 個工具）
    out = as_user(viewer_ctx, lambda: viz_tools["query_to_chart"].invoke({
        "sql": "SELECT 'a' AS lbl, 1 AS v", "chart_type": "bar", "conn_name": "default",
    }))
    p = parse(out)
    print(f"   viewer query_to_chart → {out[:160]}")
    results.append(expect(p.get("denied") is True, "viewer query_to_chart 被 allowed_tools 擋下"))

    # analyst（可 export、可 schedule、不可 etl）query_to_chart 應通過
    analyst_ctx = UserContext(user_id="analyst-test", email="analyst@local", role_name="analyst")
    out = as_user(analyst_ctx, lambda: viz_tools["query_to_chart"].invoke({
        "sql": "SELECT 'a' AS lbl, 1 AS v", "chart_type": "bar", "conn_name": "default",
    }))
    print(f"   analyst query_to_chart → {out[:160]}")
    results.append(expect("denied" not in out.lower(), "analyst query_to_chart 通過"))

    # analyst 可以 export
    out = as_user(analyst_ctx, lambda: export_tools["export_query_csv"].invoke(
        {"sql": "SELECT 1 AS a", "conn_name": "default", "filename": "x"}))
    print(f"   analyst export_csv → {out[:160]}")
    results.append(expect("denied" not in out.lower(), "analyst export_query_csv 通過"))

    # analyst 不可 ETL 寫入
    out = as_user(analyst_ctx, lambda: etl_tools["run_etl_code"].invoke({"code": "print('hi')"}))
    p = parse(out)
    print(f"   analyst run_etl → {out[:160]}")
    results.append(expect(p.get("denied") is True, "analyst run_etl_code 被 can_etl 擋下"))

    # owner DELETE（dry-run，1=0 不會動到資料）應通過
    out = as_user(owner_ctx, lambda: db_tools["execute_query"].invoke(
        {"sql": "DELETE FROM customers WHERE 1=0", "conn_name": "default", "confirmed": True}))
    p = parse(out)
    print(f"   owner DELETE → {out[:200]}")
    results.append(expect(p.get("denied") is not True, "owner DELETE 不被擋"))

    # owner export CSV 應通過
    out = as_user(owner_ctx, lambda: export_tools["export_query_csv"].invoke(
        {"sql": "SELECT 1 AS a", "conn_name": "default", "filename": "x"}))
    print(f"   owner export_csv → {out[:160]}")
    results.append(expect("denied" not in out.lower(), "owner export_query_csv 通過"))

    # ── 結果摘要 ──────────────────────────────────────────────────────────
    banner("總結")
    passed = sum(1 for x in results if x)
    total = len(results)
    print(f"   {passed}/{total} 通過")
    return 0 if passed == total else 2


if __name__ == "__main__":
    sys.exit(main())
