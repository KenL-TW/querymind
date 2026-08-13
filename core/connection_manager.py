from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy.orm import sessionmaker

from storage.metadata_db import SystemConfig

WORKSPACE_CONNECTIONS_KEY = "workspace.connections"
CONN_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")


@dataclass
class ConnectionDefinition:
    name: str
    url: str
    environment: str = "local"
    description: str = ""
    is_active: bool = True
    source: str = "workspace"
    created_at: str = ""
    updated_at: str = ""

    def to_public_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data.pop("url", None)
        data["masked_url"] = mask_connection_url(self.url)
        return data


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_connection_name(name: str) -> str:
    value = (name or "").strip()
    if not CONN_NAME_RE.match(value):
        raise ValueError("連線名稱只能使用英文字母開頭，並包含英數字、底線或連字號，長度最多 64。")
    return value


def validate_connection_url(url: str) -> str:
    value = (url or "").strip()
    if not value.startswith("postgresql"):
        raise ValueError("目前僅支援 PostgreSQL SQLAlchemy URL。")
    return value


def mask_connection_url(url: str) -> str:
    """Mask password in SQLAlchemy URL before returning it to UI."""
    try:
        parts = urlsplit(url)
        if not parts.netloc:
            return url
        netloc = parts.netloc
        if "@" in netloc and ":" in netloc.split("@", 1)[0]:
            userinfo, hostinfo = netloc.rsplit("@", 1)
            username, _, _password = userinfo.partition(":")
            netloc = f"{username}:****@{hostinfo}"
        return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    except Exception:
        return url


def _decode_workspace_connections(raw: str) -> dict[str, ConnectionDefinition]:
    if not raw:
        return {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {}

    items = payload.get("connections", payload) if isinstance(payload, dict) else {}
    if not isinstance(items, dict):
        return {}

    out: dict[str, ConnectionDefinition] = {}
    for name, item in items.items():
        if not isinstance(item, dict):
            continue
        try:
            conn_name = validate_connection_name(str(item.get("name") or name))
            url = validate_connection_url(str(item.get("url") or ""))
        except ValueError:
            continue
        out[conn_name] = ConnectionDefinition(
            name=conn_name,
            url=url,
            environment=str(item.get("environment") or "local"),
            description=str(item.get("description") or ""),
            is_active=bool(item.get("is_active", True)),
            source="workspace",
            created_at=str(item.get("created_at") or ""),
            updated_at=str(item.get("updated_at") or ""),
        )
    return out


def load_workspace_connections(session_factory: sessionmaker | None) -> dict[str, ConnectionDefinition]:
    if session_factory is None:
        return {}
    with session_factory() as session:
        row = session.query(SystemConfig).filter(SystemConfig.key == WORKSPACE_CONNECTIONS_KEY).one_or_none()
        return _decode_workspace_connections(row.value if row else "")


def save_workspace_connections(
    session_factory: sessionmaker,
    connections: dict[str, ConnectionDefinition],
) -> None:
    payload = {
        "connections": {
            name: asdict(conn)
            for name, conn in sorted(connections.items(), key=lambda kv: kv[0])
        }
    }
    with session_factory() as session:
        row = session.query(SystemConfig).filter(SystemConfig.key == WORKSPACE_CONNECTIONS_KEY).one_or_none()
        value = json.dumps(payload, ensure_ascii=False)
        if row:
            row.value = value
        else:
            session.add(SystemConfig(key=WORKSPACE_CONNECTIONS_KEY, value=value))
        session.commit()


def config_connection_definitions(
    config_connections: dict[str, str],
    environment: str,
) -> dict[str, ConnectionDefinition]:
    out: dict[str, ConnectionDefinition] = {}
    for name, url in config_connections.items():
        out[name] = ConnectionDefinition(
            name=name,
            url=url,
            environment=environment or "local",
            description="Defined by DB_CONNECTIONS",
            is_active=True,
            source="config",
        )
    return out


def merged_connection_definitions(
    config_connections: dict[str, str],
    workspace_connections: dict[str, ConnectionDefinition],
    environment: str,
) -> dict[str, ConnectionDefinition]:
    merged = config_connection_definitions(config_connections, environment)
    for name, definition in workspace_connections.items():
        if name in merged:
            continue
        merged[name] = definition
    return merged


def active_connection_urls(definitions: dict[str, ConnectionDefinition]) -> dict[str, str]:
    return {
        name: definition.url
        for name, definition in definitions.items()
        if definition.is_active
    }
