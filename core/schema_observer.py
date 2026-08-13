from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import sessionmaker

from db.introspect import invalidate_schema_cache
from db.registry import ConnectionRegistry
from storage.metadata_db import SystemConfig


def ensure_schema_observed(
    registry: ConnectionRegistry,
    conn_name: str,
    session_factory: sessionmaker | None,
    *,
    force: bool = False,
    ttl_seconds: int = 180,
) -> dict[str, Any]:
    """Scan schema drift when the stored snapshot is stale.

    The resolver calls this before ranking tables so DB changes from application
    development are picked up without a server restart. It stores only metadata
    fingerprints and column signatures in the metadata DB.
    """
    if session_factory is None:
        return {"status": "skipped", "reason": "metadata DB unavailable"}

    key = _config_key(conn_name)
    now = _now()
    with session_factory() as session:
        row = session.query(SystemConfig).filter(SystemConfig.key == key).one_or_none()
        current_record = _decode_record(row.value if row else "")
        last_checked = _parse_ts(current_record.get("last_checked_at"))
        if not force and last_checked and (now - last_checked).total_seconds() < ttl_seconds:
            return _observation_summary(current_record, status="cached")

    try:
        connector = registry.get(conn_name)
        new_snapshot = build_schema_snapshot(connector)
    except Exception as exc:
        return {"status": "error", "error": str(exc)[:500], "conn_name": conn_name}

    with session_factory() as session:
        row = session.query(SystemConfig).filter(SystemConfig.key == key).one_or_none()
        old_record = _decode_record(row.value if row else "")
        old_snapshot = old_record.get("snapshot") if isinstance(old_record.get("snapshot"), dict) else {}
        diff = diff_schema_snapshots(old_snapshot, new_snapshot)
        changed = bool(diff.get("changed"))
        status = "baseline" if not old_snapshot else "changed" if changed else "unchanged"
        record = {
            "conn_name": conn_name,
            "last_checked_at": now.isoformat(),
            "last_changed_at": now.isoformat() if changed or not old_snapshot else old_record.get("last_changed_at"),
            "snapshot": new_snapshot,
            "last_diff": diff,
        }
        if row is None:
            session.add(SystemConfig(key=key, value=json.dumps(record, ensure_ascii=False, default=str)))
        else:
            row.value = json.dumps(record, ensure_ascii=False, default=str)
        session.commit()

    if changed:
        invalidate_schema_cache(conn_name)

    return _observation_summary(record, status=status)


def get_schema_observation_state(session_factory: sessionmaker | None, conn_name: str) -> dict[str, Any]:
    if session_factory is None:
        return {"status": "unknown", "conn_name": conn_name}
    with session_factory() as session:
        row = session.query(SystemConfig).filter(SystemConfig.key == _config_key(conn_name)).one_or_none()
        record = _decode_record(row.value if row else "")
    if not record:
        return {"status": "not_scanned", "conn_name": conn_name}
    return _observation_summary(record, status="stored")


def build_schema_snapshot(connector) -> dict[str, Any]:
    inspector = sa_inspect(connector.engine)
    tables = sorted(inspector.get_table_names())
    views = sorted(inspector.get_view_names())
    table_items: dict[str, Any] = {}
    for table in tables:
        columns = []
        try:
            raw_columns = inspector.get_columns(table)
        except Exception:
            raw_columns = []
        for col in raw_columns:
            columns.append({
                "name": str(col.get("name", "")),
                "type": str(col.get("type", "")),
                "nullable": bool(col.get("nullable", True)),
                "default": str(col.get("default")) if col.get("default") is not None else None,
            })
        columns.sort(key=lambda item: item["name"])
        try:
            foreign_keys = [
                {
                    "columns": list(fk.get("constrained_columns") or []),
                    "referred_table": str(fk.get("referred_table") or ""),
                    "referred_columns": list(fk.get("referred_columns") or []),
                }
                for fk in inspector.get_foreign_keys(table)
            ]
        except Exception:
            foreign_keys = []
        table_items[table] = {
            "columns": columns,
            "foreign_keys": foreign_keys,
            "column_count": len(columns),
            "foreign_key_count": len(foreign_keys),
        }

    payload = {
        "conn_name": connector.conn_name,
        "captured_at": _now().isoformat(),
        "tables": table_items,
        "views": views,
        "table_count": len(tables),
        "view_count": len(views),
    }
    payload["fingerprint"] = _fingerprint(payload)
    return payload


def diff_schema_snapshots(old: dict[str, Any] | None, new: dict[str, Any]) -> dict[str, Any]:
    old = old or {}
    old_tables = set((old.get("tables") or {}).keys())
    new_tables = set((new.get("tables") or {}).keys())
    tables_added = sorted(new_tables - old_tables)
    tables_removed = sorted(old_tables - new_tables)
    columns_added: dict[str, list[str]] = {}
    columns_removed: dict[str, list[str]] = {}
    columns_type_changed: dict[str, list[dict[str, str]]] = {}

    for table in sorted(old_tables & new_tables):
        old_cols = {c.get("name"): c for c in ((old.get("tables") or {}).get(table, {}).get("columns") or [])}
        new_cols = {c.get("name"): c for c in ((new.get("tables") or {}).get(table, {}).get("columns") or [])}
        old_names = set(old_cols)
        new_names = set(new_cols)
        added = sorted(str(c) for c in new_names - old_names if c)
        removed = sorted(str(c) for c in old_names - new_names if c)
        if added:
            columns_added[table] = added
        if removed:
            columns_removed[table] = removed
        for col in sorted(old_names & new_names):
            old_type = str(old_cols[col].get("type", ""))
            new_type = str(new_cols[col].get("type", ""))
            if old_type != new_type:
                columns_type_changed.setdefault(table, []).append({
                    "column": str(col),
                    "from": old_type,
                    "to": new_type,
                })

    views_added = sorted(set(new.get("views") or []) - set(old.get("views") or []))
    views_removed = sorted(set(old.get("views") or []) - set(new.get("views") or []))
    changed = any([tables_added, tables_removed, columns_added, columns_removed, columns_type_changed, views_added, views_removed])
    return {
        "changed": changed,
        "tables_added": tables_added,
        "tables_removed": tables_removed,
        "columns_added": columns_added,
        "columns_removed": columns_removed,
        "columns_type_changed": columns_type_changed,
        "views_added": views_added,
        "views_removed": views_removed,
    }


def _observation_summary(record: dict[str, Any], *, status: str) -> dict[str, Any]:
    snapshot = record.get("snapshot") or {}
    return {
        "status": status,
        "conn_name": record.get("conn_name") or snapshot.get("conn_name"),
        "last_checked_at": record.get("last_checked_at"),
        "last_changed_at": record.get("last_changed_at"),
        "fingerprint": snapshot.get("fingerprint"),
        "table_count": snapshot.get("table_count", 0),
        "view_count": snapshot.get("view_count", 0),
        "last_diff": record.get("last_diff") or {},
    }


def _fingerprint(payload: dict[str, Any]) -> str:
    clone = dict(payload)
    clone.pop("captured_at", None)
    raw = json.dumps(clone, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _decode_record(raw: str) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _config_key(conn_name: str) -> str:
    safe = conn_name.replace("/", "_").replace("\\", "_")
    return f"schema.observer.{safe}"
