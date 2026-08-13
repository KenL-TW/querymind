"""
Seed QueryMind metadata DB with demo content for admin / auth / session testing.

Usage:
  python infra/scripts/seed_metadata.py
    python infra/scripts/seed_metadata.py --db-url postgresql+psycopg2://qm_user:qm_pass@127.0.0.1:5432/querymind_meta

This script is idempotent for the seeded records below.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import text

# Ensure project root is in sys.path when run directly
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from config.settings import settings
from core.user_service import UserService
from storage.metadata_db import ApiKey, AuditLog, Invitation, ScheduleRecord, SystemConfig, User, init_metadata_db


SEED_SESSION_ID = "seed-demo-session-001"
SEED_CHAT_MARKER = "seed-demo-chat-history"
SEED_AUDIT_MARKERS = {
    "seed-agent-invoke-001",
    "seed-tool-call-001",
    "seed-error-001",
}


def _upsert_system_config(session, key: str, value: str) -> None:
    row = session.query(SystemConfig).filter(SystemConfig.key == key).one_or_none()
    if row:
        row.value = value
    else:
        session.add(SystemConfig(key=key, value=value))


def _upsert_schedule(session, *, schedule_id: str, name: str, cron_expression: str, target: str, enabled: bool) -> None:
    row = session.query(ScheduleRecord).filter(ScheduleRecord.schedule_id == schedule_id).one_or_none()
    if row:
        row.name = name
        row.cron_expression = cron_expression
        row.target = target
        row.enabled = enabled
    else:
        session.add(
            ScheduleRecord(
                schedule_id=schedule_id,
                name=name,
                cron_expression=cron_expression,
                target=target,
                enabled=enabled,
            )
        )


def _ensure_chat_tables(conn) -> None:
    conn.execute(text(
        "CREATE TABLE IF NOT EXISTS qm_chat_messages ("
        "  id BIGSERIAL PRIMARY KEY,"
        "  session_id TEXT,"
        "  message TEXT"
        ")"
    ))
    conn.execute(text(
        "CREATE TABLE IF NOT EXISTS qm_session_meta ("
        "  session_id TEXT PRIMARY KEY,"
        "  title TEXT DEFAULT '',"
        "  summary TEXT DEFAULT '',"
        "  entities TEXT DEFAULT '[]',"
        "  updated_at TEXT DEFAULT ''"
        ")"
    ))


def _seed_chat_history(conn) -> None:
    exists = conn.execute(
        text("SELECT 1 FROM qm_chat_messages WHERE session_id = :sid LIMIT 1"),
        {"sid": SEED_SESSION_ID},
    ).fetchone()
    if exists:
        return

    messages = [
        (SEED_SESSION_ID, f"{SEED_CHAT_MARKER}: user 問資料庫最近的銷售趨勢。"),
        (SEED_SESSION_ID, "assistant: 近 30 天訂單量穩定，熱銷商品集中在 Electronics 類別。"),
        (SEED_SESSION_ID, "user: 幫我看庫存低於補貨點的商品。"),
        (SEED_SESSION_ID, "assistant: 已找到 6 筆低庫存商品，建議優先補貨 SKU 相關商品。"),
    ]
    conn.execute(
        text("INSERT INTO qm_chat_messages(session_id, message) VALUES (:sid, :message)"),
        [{"sid": sid, "message": message} for sid, message in messages],
    )


def _seed_session_meta(conn) -> None:
    payload = {
        "sid": SEED_SESSION_ID,
        "title": "零售業銷售與庫存分析",
        "summary": "示範會話，包含銷售趨勢、庫存補貨、顧客與訂單分析。",
        "entities": json.dumps(["orders", "order_items", "products", "inventory_transactions", "customers"], ensure_ascii=False),
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    exists = conn.execute(
        text("SELECT 1 FROM qm_session_meta WHERE session_id = :sid LIMIT 1"),
        {"sid": SEED_SESSION_ID},
    ).fetchone()
    if exists:
        conn.execute(
            text(
                "UPDATE qm_session_meta SET title=:title, summary=:summary, entities=:entities, updated_at=:updated_at "
                "WHERE session_id=:sid"
            ),
            payload,
        )
    else:
        conn.execute(
            text(
                "INSERT INTO qm_session_meta(session_id, title, summary, entities, updated_at) "
                "VALUES (:sid, :title, :summary, :entities, :updated_at)"
            ),
            payload,
        )


def _seed_audit_logs(session) -> None:
    existing = {
        row.detail
        for row in session.query(AuditLog).filter(AuditLog.detail.in_(SEED_AUDIT_MARKERS)).all()
    }
    now = datetime.now(timezone.utc)
    rows = [
        AuditLog(
            session_id=SEED_SESSION_ID,
            api_key_prefix="seed-key",
            event_type="agent_invoke",
            tool_name=None,
            conn_name="default",
            detail="seed-agent-invoke-001",
            status="success",
            duration_ms=812,
            created_at=now - timedelta(minutes=30),
        ),
        AuditLog(
            session_id=SEED_SESSION_ID,
            api_key_prefix="seed-key",
            event_type="tool_call",
            tool_name="list_tables",
            conn_name="default",
            detail="seed-tool-call-001",
            status="success",
            duration_ms=143,
            created_at=now - timedelta(minutes=29),
        ),
        AuditLog(
            session_id=SEED_SESSION_ID,
            api_key_prefix="seed-key",
            event_type="error",
            tool_name="get_table_ddl",
            conn_name="default",
            detail="seed-error-001",
            status="error",
            duration_ms=56,
            error_msg="示範錯誤：找不到表 department_summary。",
            created_at=now - timedelta(minutes=28),
        ),
    ]
    for row in rows:
        if row.detail not in existing:
            session.add(row)


def _seed_users_and_keys(svc: UserService) -> None:
    owner_email = settings.default_owner_email or "owner@local"
    owner_key = settings.default_owner_api_key or "qm_owner_dev_key_change_me"
    svc.ensure_owner(owner_email, owner_key)

    with svc._sf() as session:
        owner = session.query(User).filter(User.email == owner_email).one()
        owner.display_name = "Owner"
        owner.role = "owner"
        owner.allowed_conns = ""
        owner.is_active = True

        analyst = session.query(User).filter(User.email == "analyst@local").one_or_none()
        if analyst is None:
            analyst = User(
                email="analyst@local",
                display_name="Analyst",
                role="analyst",
                allowed_conns="default",
                invite_pending=False,
                is_active=True,
            )
            session.add(analyst)
            session.flush()
        else:
            analyst.display_name = "Analyst"
            analyst.role = "analyst"
            analyst.allowed_conns = "default"
            analyst.is_active = True

        viewer = session.query(User).filter(User.email == "viewer@local").one_or_none()
        if viewer is None:
            viewer = User(
                email="viewer@local",
                display_name="Viewer",
                role="viewer",
                allowed_conns="default",
                invite_pending=False,
                is_active=True,
            )
            session.add(viewer)
            session.flush()
        else:
            viewer.display_name = "Viewer"
            viewer.role = "viewer"
            viewer.allowed_conns = "default"
            viewer.is_active = True

        session.commit()
        owner_id = owner.id
        analyst_id = analyst.id
        viewer_id = viewer.id

    svc.set_password(owner_id, "Owner123!")
    svc.set_password(analyst_id, "Analyst123!")
    svc.set_password(viewer_id, "Viewer123!")

    for user_id, label in [(owner_id, "owner-dev"), (analyst_id, "analyst-dev"), (viewer_id, "viewer-dev")]:
        with svc._sf() as session:
            exists = session.query(ApiKey).filter(
                ApiKey.user_id == user_id,
                ApiKey.label == label,
            ).one_or_none()
        if exists is None:
            svc.issue_key(user_id, label=label)


def _seed_invitations(svc: UserService) -> None:
    with svc._sf() as session:
        owner = session.query(User).filter(User.role == "owner").order_by(User.id.asc()).first()
        if owner is None:
            return
        owner_id = owner.id

    def invite_exists(email: str) -> bool:
        with svc._sf() as session:
            return session.query(Invitation).filter(Invitation.email == email).one_or_none() is not None

    if not invite_exists("guest.analyst@local"):
        svc.create_invitation(
            email="guest.analyst@local",
            role="analyst",
            invited_by_id=owner_id,
            allowed_conns=["default"],
            expires_hours=72,
        )

    if not invite_exists("guest.viewer@local"):
        svc.create_invitation(
            email="guest.viewer@local",
            role="viewer",
            invited_by_id=owner_id,
            allowed_conns=["default"],
            expires_hours=24,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed QueryMind metadata DB with demo data.")
    parser.add_argument("--db-url", default=settings.metadata_db_url, help="Metadata DB URL")
    args = parser.parse_args()

    session_factory = init_metadata_db(args.db_url)
    svc = UserService(session_factory)

    with session_factory() as session:
        _upsert_system_config(session, "first_run_complete", "true")
        _upsert_system_config(session, "seed_profile", "demo-metadata")
        _upsert_system_config(session, "branding_title", "QueryMind Demo Admin")
        _upsert_system_config(session, "session_retention_days", str(settings.session_retention_days))

        _upsert_schedule(
            session,
            schedule_id="seed-daily-sales-refresh",
            name="Daily Sales Refresh",
            cron_expression="0 6 * * *",
            target="default:orders,order_items,products",
            enabled=True,
        )
        _upsert_schedule(
            session,
            schedule_id="seed-weekly-inventory-alert",
            name="Weekly Inventory Alert",
            cron_expression="0 9 * * MON",
            target="default:inventory_transactions,products",
            enabled=True,
        )

        _seed_audit_logs(session)
        session.commit()

        bind = session.get_bind()
        if bind is None:
            raise RuntimeError("Metadata session has no DB bind.")
        with bind.begin() as conn:
            _ensure_chat_tables(conn)
            _seed_chat_history(conn)
            _seed_session_meta(conn)

    _seed_users_and_keys(svc)
    _seed_invitations(svc)

    print("Metadata seed completed.")
    print(f"Owner login: {settings.default_owner_email} / Owner123!")
    print("Analyst login: analyst@local / Analyst123!")
    print("Viewer login: viewer@local / Viewer123!")
    print("Seeded invitation emails: guest.analyst@local, guest.viewer@local")


if __name__ == "__main__":
    main()