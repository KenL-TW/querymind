"""
Connection discovery endpoint.

GET /v1/connections — authenticated, RBAC-filtered list of DB connections the
caller may use, each annotated with live status and dialect.

Why this exists instead of just reading `/v1/health`:
  * `/v1/health` is intentionally unauthenticated for ops/probe usage and so
    must not leak per-user connection scope.
  * Connection liveness probes are cached (60s TTL) so a frontend that polls
    the page never DoSes the target databases.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.auth import require_capability, require_user
from core.connection_manager import (
    ConnectionDefinition,
    load_workspace_connections,
    merged_connection_definitions,
    now_iso,
    save_workspace_connections,
    validate_connection_name,
    validate_connection_url,
)
from core.b2b_readiness import build_connection_readiness
from core.rbac import UserContext

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["connections"])
admin_router = APIRouter(
    prefix="/v1/admin",
    tags=["admin-connections"],
    dependencies=[Depends(require_capability("can_manage_users"))],
)


class ConnectionPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    url: str = Field(..., min_length=1)
    environment: str = "local"
    description: str = ""
    is_active: bool = True


class ConnectionUpdatePayload(BaseModel):
    url: str | None = None
    environment: str | None = None
    description: str | None = None
    is_active: bool | None = None


class ConnectionTestPayload(BaseModel):
    name: str = "test"
    url: str


@dataclass
class _PingResult:
    alive: bool
    dialect: str
    error: Optional[str]
    ts: float


_PING_TTL_SECONDS = 60.0
_ping_cache: dict[str, _PingResult] = {}
_ping_lock = threading.Lock()


def _probe_connection(conn_name: str, connector) -> _PingResult:
    """Probe a single connection, with TTL cache.

    Failures are cached too so a dead DB doesn't get hit on every page load.
    """
    now = time.time()
    with _ping_lock:
        cached = _ping_cache.get(conn_name)
        if cached and (now - cached.ts) < _PING_TTL_SECONDS:
            return cached

    dialect = ""
    try:
        dialect = connector.engine.dialect.name if connector and connector.engine else ""
    except Exception:
        dialect = ""

    alive = False
    error: Optional[str] = None
    try:
        alive = bool(connector.ping())
    except Exception as exc:
        error = str(exc)[:240]
        logger.warning("Connection probe failed conn=%s err=%s", conn_name, error)

    if not alive and not error:
        error = "ping returned False"

    result = _PingResult(alive=alive, dialect=dialect, error=error if not alive else None, ts=now)
    with _ping_lock:
        _ping_cache[conn_name] = result
    return result


def _invalidate_cache(conn_name: Optional[str] = None) -> None:
    with _ping_lock:
        if conn_name is None:
            _ping_cache.clear()
        else:
            _ping_cache.pop(conn_name, None)


def _conn_meta(name: str) -> dict[str, Any]:
    from api.main import app_state

    definitions: dict[str, ConnectionDefinition] = app_state.get("connection_definitions") or {}
    definition = definitions.get(name)
    if not definition:
        return {"source": "", "environment": "", "description": "", "masked_url": ""}
    return definition.to_public_dict()


def _schema_state(name: str) -> dict[str, Any]:
    from api.main import app_state
    from core.schema_observer import get_schema_observation_state

    return get_schema_observation_state(app_state.get("session_factory"), name)


def _rebuild_connection_state() -> dict[str, ConnectionDefinition]:
    from api.main import app_state
    from config.settings import settings

    sf = app_state.get("session_factory")
    workspace = load_workspace_connections(sf)
    definitions = merged_connection_definitions(settings.db_connections_dict, workspace, settings.environment)
    app_state["workspace_connections"] = workspace
    app_state["connection_definitions"] = definitions
    return definitions


def _refresh_agent_prompt() -> None:
    """Keep the agent's system prompt aligned after runtime connection changes."""
    try:
        from api.main import app_state
        from config.settings import settings
        from core.agent import build_agent
        from core.semantic_layer import build_semantic_brief
        from core.system_prompt import build_schema_brief, build_system_prompt
        from tools import get_all_tools

        registry = app_state.get("registry")
        llm = app_state.get("llm")
        storage = app_state.get("storage")
        archive = app_state.get("archive")
        scheduler = app_state.get("scheduler")
        if not all([registry, llm, storage, archive, scheduler]):
            return
        tools = get_all_tools(registry, storage, archive, scheduler)
        system_prompt = build_system_prompt(
            registry.list_connections(),
            schema_brief=build_schema_brief(registry),
            glossary_brief=build_semantic_brief(),
        )
        app_state["agent"] = build_agent(
            tools,
            llm,
            system_prompt,
            verbose=(settings.environment == "local"),
        )
    except Exception:
        logger.debug("Failed to refresh agent prompt after connection change", exc_info=True)


def _role_access_summary(connections: list[str]) -> dict[str, dict[str, Any]]:
    from api.main import app_state
    from storage.metadata_db import User

    sf = app_state.get("session_factory")
    summary = {
        name: {"roles": {}, "users": [], "open_to_unrestricted_users": False}
        for name in connections
    }
    if sf is None:
        return summary

    with sf() as session:
        users = session.query(User).filter(User.is_active.is_(True)).all()
        for row in users:
            allowed = [c for c in (row.allowed_conns or "").split(",") if c]
            accessible = connections if not allowed else [c for c in allowed if c in summary]
            for conn_name in accessible:
                item = summary[conn_name]
                role = row.role or "viewer"
                item["roles"][role] = int(item["roles"].get(role, 0)) + 1
                item["users"].append({
                    "id": row.id,
                    "email": row.email,
                    "role": role,
                    "explicit": bool(allowed),
                })
                if not allowed:
                    item["open_to_unrestricted_users"] = True
    return summary


@router.get("/connections")
async def list_user_connections(
    user: UserContext = Depends(require_user),
    refresh: bool = False,
) -> dict:
    """List connections this user is allowed to use, with live status.

    Args:
        refresh: if True, force re-probe (skip cache).  Use sparingly.

    Returns:
        ``{"connections": [{name, dialect, alive, error}], "default": name|null}``
        ``default`` is the first alive allowed connection, suitable for the
        frontend's initial dropdown value.
    """
    from api.main import app_state

    registry = app_state.get("registry")
    if registry is None:
        raise HTTPException(status_code=503, detail="Registry not initialized")

    all_conns = registry.list_connections()
    # Filter by RBAC: empty allowed_conns means "all" (admin convention).
    if user.allowed_conns:
        allowed = [c for c in all_conns if c in user.allowed_conns]
    else:
        allowed = all_conns

    if refresh:
        _invalidate_cache()

    items: list[dict] = []
    default_name: Optional[str] = None
    for name in allowed:
        try:
            connector = registry.get(name)
        except KeyError:
            continue
        probe = _probe_connection(name, connector)
        item = {
            "name": name,
            "dialect": probe.dialect,
            "alive": probe.alive,
            "error": probe.error,
        }
        item.update(_conn_meta(name))
        items.append(item)
        if probe.alive and default_name is None:
            default_name = name

    # Fall back to first listed connection even if dead, so the UI has
    # *something* selected (the user can see the error state).
    if default_name is None and items:
        default_name = items[0]["name"]

    return {"connections": items, "default": default_name}


@router.post("/connections/{conn_name}/ping")
async def ping_connection(
    conn_name: str,
    user: UserContext = Depends(require_user),
) -> dict:
    """Force-refresh the status of a single connection (bypasses 60s cache).

    RBAC-checked: returns 403 if the caller isn't allowed to use this conn.
    """
    if user.allowed_conns and conn_name not in user.allowed_conns:
        raise HTTPException(status_code=403, detail=f"未授權使用連線 '{conn_name}'。")

    from api.main import app_state

    registry = app_state.get("registry")
    if registry is None:
        raise HTTPException(status_code=503, detail="Registry not initialized")
    try:
        connector = registry.get(conn_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    _invalidate_cache(conn_name)
    probe = _probe_connection(conn_name, connector)
    return {
        "name": conn_name,
        "dialect": probe.dialect,
        "alive": probe.alive,
        "error": probe.error,
    }


@admin_router.get("/connections")
async def list_admin_connections(refresh: bool = False) -> dict[str, Any]:
    from api.main import app_state

    registry = app_state.get("registry")
    if registry is None:
        raise HTTPException(status_code=503, detail="Registry not initialized")

    definitions = _rebuild_connection_state()
    if refresh:
        _invalidate_cache()
    access = _role_access_summary(list(definitions))
    items: list[dict[str, Any]] = []
    for name, definition in definitions.items():
        probe = None
        if definition.is_active and name in registry.list_connections():
            try:
                probe = _probe_connection(name, registry.get(name))
            except Exception:
                probe = None
        item = definition.to_public_dict()
        item.update({
            "dialect": probe.dialect if probe else "",
            "alive": probe.alive if probe else False,
            "error": probe.error if probe else ("inactive" if not definition.is_active else "not registered"),
            "access": access.get(name, {"roles": {}, "users": [], "open_to_unrestricted_users": False}),
            "schema_state": _schema_state(name),
        })
        item["readiness"] = build_connection_readiness(
            conn_name=name,
            alive=bool(item["alive"]),
            access=item["access"],
            registry=registry,
            session_factory=app_state.get("session_factory"),
        )
        items.append(item)
    return {"connections": items}


@admin_router.post("/connections/test")
async def test_connection(payload: ConnectionTestPayload) -> dict[str, Any]:
    from db.connector import DBConnector

    name = validate_connection_name(payload.name or "test")
    url = validate_connection_url(payload.url)
    try:
        connector = DBConnector.from_conn_string(url, name)
        alive = connector.ping()
        dialect = connector.engine.dialect.name if connector.engine else ""
        connector.engine.dispose()
    except Exception as exc:
        return {"name": name, "alive": False, "dialect": "", "error": str(exc)[:500]}
    return {"name": name, "alive": alive, "dialect": dialect, "error": None if alive else "ping returned False"}


@admin_router.post("/connections", status_code=201)
async def create_connection(payload: ConnectionPayload) -> dict[str, Any]:
    from api.main import app_state

    sf = app_state.get("session_factory")
    registry = app_state.get("registry")
    if sf is None or registry is None:
        raise HTTPException(status_code=503, detail="Connection manager not initialized")

    try:
        name = validate_connection_name(payload.name)
        url = validate_connection_url(payload.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    definitions = _rebuild_connection_state()
    if name in definitions:
        raise HTTPException(status_code=409, detail=f"Connection '{name}' already exists.")

    ts = now_iso()
    definition = ConnectionDefinition(
        name=name,
        url=url,
        environment=(payload.environment or "local").strip(),
        description=payload.description or "",
        is_active=payload.is_active,
        source="workspace",
        created_at=ts,
        updated_at=ts,
    )
    workspace = app_state.get("workspace_connections") or {}
    workspace[name] = definition
    save_workspace_connections(sf, workspace)

    if definition.is_active:
        registry.replace(name, definition.url)
        _invalidate_cache(name)
    definitions = _rebuild_connection_state()
    _refresh_agent_prompt()
    return definitions[name].to_public_dict()


@admin_router.put("/connections/{conn_name}")
async def update_connection(conn_name: str, payload: ConnectionUpdatePayload) -> dict[str, Any]:
    from api.main import app_state

    sf = app_state.get("session_factory")
    registry = app_state.get("registry")
    if sf is None or registry is None:
        raise HTTPException(status_code=503, detail="Connection manager not initialized")

    name = validate_connection_name(conn_name)
    definitions = _rebuild_connection_state()
    existing = definitions.get(name)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Connection '{name}' not found.")
    if existing.source != "workspace":
        raise HTTPException(status_code=400, detail="DB_CONNECTIONS 定義的連線不可由 UI 編輯，請修改 .env。")

    workspace = app_state.get("workspace_connections") or {}
    definition = workspace.get(name)
    if definition is None:
        raise HTTPException(status_code=404, detail=f"Workspace connection '{name}' not found.")

    if payload.url is not None:
        try:
            definition.url = validate_connection_url(payload.url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if payload.environment is not None:
        definition.environment = payload.environment.strip() or "local"
    if payload.description is not None:
        definition.description = payload.description
    if payload.is_active is not None:
        definition.is_active = payload.is_active
    definition.updated_at = now_iso()

    workspace[name] = definition
    save_workspace_connections(sf, workspace)
    if definition.is_active:
        registry.replace(name, definition.url)
    else:
        registry.unregister(name)
    _invalidate_cache(name)
    definitions = _rebuild_connection_state()
    _refresh_agent_prompt()
    return definitions[name].to_public_dict()


@admin_router.delete("/connections/{conn_name}", status_code=204)
async def delete_connection(conn_name: str):
    from api.main import app_state

    sf = app_state.get("session_factory")
    registry = app_state.get("registry")
    if sf is None or registry is None:
        raise HTTPException(status_code=503, detail="Connection manager not initialized")

    name = validate_connection_name(conn_name)
    definitions = _rebuild_connection_state()
    existing = definitions.get(name)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Connection '{name}' not found.")
    if existing.source != "workspace":
        raise HTTPException(status_code=400, detail="DB_CONNECTIONS 定義的連線不可由 UI 刪除，請修改 .env。")

    workspace = app_state.get("workspace_connections") or {}
    workspace.pop(name, None)
    save_workspace_connections(sf, workspace)
    registry.unregister(name)
    _invalidate_cache(name)
    _rebuild_connection_state()
    _refresh_agent_prompt()


@admin_router.post("/connections/{conn_name}/scan-schema")
async def scan_connection_schema(conn_name: str) -> dict[str, Any]:
    from api.main import app_state
    from core.schema_observer import ensure_schema_observed
    from sqlalchemy import inspect as sa_inspect

    registry = app_state.get("registry")
    if registry is None:
        raise HTTPException(status_code=503, detail="Registry not initialized")
    try:
        connector = registry.get(conn_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        inspector = sa_inspect(connector.engine)
        tables = inspector.get_table_names()
        views = inspector.get_view_names()
        table_items = []
        for table in tables:
            columns = inspector.get_columns(table)
            foreign_keys = inspector.get_foreign_keys(table)
            table_items.append({
                "name": table,
                "column_count": len(columns),
                "columns": [{"name": c.get("name"), "type": str(c.get("type"))} for c in columns],
                "foreign_key_count": len(foreign_keys),
            })
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Schema scan failed: {str(exc)[:500]}") from exc

    observation = ensure_schema_observed(
        registry,
        conn_name,
        app_state.get("session_factory"),
        force=True,
    )
    if observation.get("status") in {"baseline", "changed"}:
        _refresh_agent_prompt()

    return {
        "conn_name": conn_name,
        "table_count": len(tables),
        "view_count": len(views),
        "tables": table_items,
        "views": views,
        "observation": observation,
    }
