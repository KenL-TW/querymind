"""
Schema introspection endpoint — returns table list, column details, DDL, and ER info.
Used by the frontend to render the DB Overview, AI Summary, and ER Diagram pages.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from api.auth import require_user
from core.rbac import PermissionDeniedError, UserContext, assert_conn_allowed

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/schema", tags=["schema"])


@router.get("/{conn_name}")
async def get_schema(
    conn_name: str,
    user: UserContext = Depends(require_user),
) -> dict[str, Any]:
    """
    Return schema overview for a given connection:
    - table list with column definitions and row counts
    - DDL for each table
    """
    from api.main import app_state
    from db.introspect import SchemaInspector
    from sqlalchemy import inspect as sa_inspect

    # RBAC: even though introspection is read-only, treat the schema itself as
    # sensitive (column names can leak business intent) and gate on access.
    try:
        assert_conn_allowed(user, conn_name)
    except PermissionDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    registry = app_state.get("registry")
    if registry is None:
        raise HTTPException(status_code=503, detail="Registry not initialized")

    try:
        connector = registry.get(conn_name)
    except KeyError:
        available = registry.list_connections()
        raise HTTPException(
            status_code=404,
            detail=f"Connection '{conn_name}' not found. Available: {available}",
        )

    inspector = SchemaInspector(connector)
    tables = inspector.list_tables()
    views = inspector.list_views()

    # Load optional column/table descriptions from dictionary JSON (best-effort)
    try:
        import json as _json
        from pathlib import Path
        _dict_path = Path("data/dictionary") / f"{conn_name}.json"
        _tbl_overrides: dict = {}
        if _dict_path.exists():
            _tbl_overrides = (_json.loads(_dict_path.read_text(encoding="utf-8"))
                              .get("tables", {}) or {})
    except Exception:
        _tbl_overrides = {}

    table_infos: list[dict[str, Any]] = []
    for table in tables:
        try:
            # Column metadata
            insp = sa_inspect(connector.engine)
            raw_cols = insp.get_columns(table)
            _col_ov: dict = (_tbl_overrides.get(table, {}) or {}).get("columns", {}) or {}
            columns = [
                {
                    "name": c["name"],
                    "type": str(c["type"]),
                    "nullable": c.get("nullable", True),
                    "default": str(c["default"]) if c.get("default") is not None else None,
                    "description": _col_ov.get(c["name"], ""),
                }
                for c in raw_cols
            ]

            # Row count (safe — read-only)
            try:
                rows = connector.execute(f"SELECT COUNT(*) AS cnt FROM \"{table}\"")  # noqa: S608
                row_count = int(rows[0]["cnt"]) if rows else 0
            except Exception:
                row_count = -1  # unknown

            # DDL
            try:
                ddl = inspector.get_ddl(table)
            except Exception:
                ddl = ""

            # Sample rows (up to 3)
            try:
                sample = connector.execute(f"SELECT * FROM \"{table}\" LIMIT 3")  # noqa: S608
            except Exception:
                sample = []

            # Foreign keys
            try:
                raw_fks = insp.get_foreign_keys(table)
                foreign_keys = [
                    {
                        "constrained_columns": fk.get("constrained_columns", []),
                        "referred_table": fk.get("referred_table", ""),
                        "referred_columns": fk.get("referred_columns", []),
                    }
                    for fk in raw_fks
                ]
            except Exception:
                foreign_keys = []

            table_infos.append(
                {
                    "name": table,
                    "description": (_tbl_overrides.get(table, {}) or {}).get("description", ""),
                    "row_count": row_count,
                    "columns": columns,
                    "ddl": ddl,
                    "sample_rows": sample,
                    "foreign_keys": foreign_keys,
                }
            )
        except Exception as exc:
            logger.warning("Failed to inspect table", extra={"table": table, "error": str(exc)})
            table_infos.append({"name": table, "row_count": -1, "columns": [], "ddl": "", "sample_rows": [], "foreign_keys": []})

    return {
        "conn_name": conn_name,
        "tables": table_infos,
        "views": views,
        "table_count": len(tables),
        "view_count": len(views),
    }


@router.get("/{conn_name}/autocomplete")
async def schema_autocomplete(
    conn_name: str,
    user: UserContext = Depends(require_user),
    prefix: str = "",
    limit: int = 20,
) -> dict[str, Any]:
    """Return table + column name suggestions matching ``prefix``.

    Uses :class:`SchemaInspector` (which is in-process cached) so repeated
    calls don't hammer the database.  ``prefix`` is matched case-insensitively
    against table names, qualified ``table.column`` strings, and bare column
    names.  ``limit`` is clamped to 100.
    """
    from api.main import app_state
    from db.introspect import SchemaInspector
    from sqlalchemy import inspect as sa_inspect

    try:
        assert_conn_allowed(user, conn_name)
    except PermissionDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    registry = app_state.get("registry")
    if registry is None:
        raise HTTPException(status_code=503, detail="Registry not initialized")
    try:
        connector = registry.get(conn_name)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Connection '{conn_name}' not found.")

    limit = max(1, min(int(limit or 20), 100))
    pref = (prefix or "").strip().lower()
    inspector = SchemaInspector(connector)

    try:
        tables = inspector.list_tables()
    except Exception as exc:
        logger.warning("autocomplete list_tables failed for %s: %s", conn_name, exc)
        tables = []

    # If the user typed "table." → narrow to that table's columns only.
    table_scope: str | None = None
    col_pref = pref
    if "." in pref:
        head, _, tail = pref.partition(".")
        # case-insensitive match against known tables
        match = next((t for t in tables if t.lower() == head), None)
        if match:
            table_scope = match
            col_pref = tail

    suggestions: list[dict[str, str]] = []

    if not table_scope:
        for t in tables:
            if not pref or t.lower().startswith(pref):
                suggestions.append({"kind": "table", "value": t, "detail": ""})
                if len(suggestions) >= limit:
                    break

    if len(suggestions) < limit:
        # Column suggestions — bounded by `limit` so we don't introspect every table.
        sa_insp = sa_inspect(connector.engine)
        target_tables = [table_scope] if table_scope else tables
        for t in target_tables:
            if len(suggestions) >= limit:
                break
            try:
                cols = sa_insp.get_columns(t)
            except Exception:
                continue
            for c in cols:
                name = str(c.get("name", ""))
                if not name:
                    continue
                if col_pref and not name.lower().startswith(col_pref):
                    continue
                qualified = f"{t}.{name}"
                suggestions.append({
                    "kind": "column",
                    "value": qualified,
                    "detail": str(c.get("type", "")),
                })
                if len(suggestions) >= limit:
                    break

    return {"prefix": prefix, "suggestions": suggestions}


@router.get("/{conn_name}/ai-summary")
async def get_schema_ai_summary(
    conn_name: str,
    user: UserContext = Depends(require_user),
) -> StreamingResponse:
    """
    Stream an AI-generated summary of the database schema.
    Returns SSE events: `data: {"token": "..."}` and `data: {"done": true}`.
    """
    from api.main import app_state
    from db.introspect import SchemaInspector
    from sqlalchemy import inspect as sa_inspect

    try:
        assert_conn_allowed(user, conn_name)
    except PermissionDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    registry = app_state.get("registry")
    if registry is None:
        raise HTTPException(status_code=503, detail="Registry not initialized")

    try:
        connector = registry.get(conn_name)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Connection '{conn_name}' not found.")

    # Build a compact schema description for the LLM
    inspector = SchemaInspector(connector)
    sa_insp = sa_inspect(connector.engine)
    tables = inspector.list_tables()

    schema_lines: list[str] = []
    for table in tables:
        try:
            cols = sa_insp.get_columns(table)
            col_str = ", ".join(f"{c['name']}({str(c['type']).split('(')[0].lower()})" for c in cols)
            try:
                row = connector.execute(f'SELECT COUNT(*) AS cnt FROM "{table}"')  # noqa: S608
                count = int(row[0]["cnt"]) if row else 0
            except Exception:
                count = -1
            count_str = f", {count:,} rows" if count >= 0 else ""
            schema_lines.append(f"- {table}({col_str}{count_str})")
        except Exception:
            schema_lines.append(f"- {table}")

    schema_text = "\n".join(schema_lines)
    prompt = (
        f"以下是資料庫 `{conn_name}` 的 Schema：\n\n"
        f"{schema_text}\n\n"
        f"請用繁體中文撰寫一份簡明的 Schema 摘要，包含：\n"
        f"1. 資料庫的主要業務領域與用途\n"
        f"2. 主要資料表的功能說明（分類整理）\n"
        f"3. 表與表之間的關聯描述\n"
        f"4. 資料規模概覽（如各表筆數）\n"
        f"5. 適合用來回答哪類業務問題\n\n"
        f"請直接輸出 Markdown 格式，不需要前言。"
    )

    llm = app_state.get("llm")
    if llm is None:
        raise HTTPException(status_code=503, detail="LLM not initialized")

    async def event_stream():
        try:
            async for chunk in llm.astream(prompt):
                token = chunk.content if hasattr(chunk, "content") else str(chunk)
                if token:
                    yield f"data: {json.dumps({'token': token}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            logger.error("AI summary stream error: %s", exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
