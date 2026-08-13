"""
Data Dictionary API — per-connection business glossary.

GET /v1/dictionary/{conn_name}  — returns merged schema + stored descriptions
PUT /v1/dictionary/{conn_name}  — persist descriptions (analyst+ required)
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import require_user
from core.rbac import PermissionDeniedError, UserContext, assert_conn_allowed

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/dictionary", tags=["dictionary"])

_DICT_DIR = Path("data/dictionary")


def _load_dict(conn_name: str) -> dict:
    path = _DICT_DIR / f"{conn_name}.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"tables": {}}


def _save_dict(conn_name: str, data: dict) -> None:
    _DICT_DIR.mkdir(parents=True, exist_ok=True)
    path = _DICT_DIR / f"{conn_name}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ── Pydantic models ──────────────────────────────────────────────────────────

class TableDictEntry(BaseModel):
    description: str = ""
    category: str = ""
    columns: dict[str, str] = {}


class DictionarySaveRequest(BaseModel):
    tables: dict[str, TableDictEntry]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{conn_name}")
async def get_dictionary(
    conn_name: str,
    user: UserContext = Depends(require_user),
) -> dict[str, Any]:
    """
    Return merged dictionary: live column types from schema + stored descriptions.
    """
    from api.main import app_state
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
        available = registry.list_connections()
        raise HTTPException(
            status_code=404,
            detail=f"Connection '{conn_name}' not found. Available: {available}",
        )

    stored = _load_dict(conn_name)
    tbl_overrides: dict = stored.get("tables", {}) or {}

    # Merge with live schema
    try:
        insp = sa_inspect(connector.engine)
        table_names: list[str] = insp.get_table_names()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Schema introspection failed: {exc}") from exc

    tables_out: list[dict] = []
    for tname in sorted(table_names):
        tbl_meta = tbl_overrides.get(tname, {}) or {}
        col_overrides: dict = tbl_meta.get("columns", {}) or {}

        try:
            raw_cols = insp.get_columns(tname)
        except Exception:
            raw_cols = []

        columns_out = [
            {
                "name": c["name"],
                "type": str(c["type"]),
                "nullable": c.get("nullable", True),
                "description": col_overrides.get(c["name"], ""),
            }
            for c in raw_cols
        ]

        tables_out.append({
            "name": tname,
            "description": tbl_meta.get("description", ""),
            "category": tbl_meta.get("category", ""),
            "columns": columns_out,
        })

    # Inject any extra tables present only in the stored dict (e.g., views)
    live_names = {t["name"] for t in tables_out}
    for tname, tbl_meta in tbl_overrides.items():
        if tname not in live_names:
            col_overrides = (tbl_meta.get("columns", {}) or {})
            tables_out.append({
                "name": tname,
                "description": tbl_meta.get("description", ""),
                "category": tbl_meta.get("category", ""),
                "columns": [
                    {"name": cn, "type": "", "nullable": True, "description": cd}
                    for cn, cd in col_overrides.items()
                ],
            })

    return {
        "conn_name": conn_name,
        "tables": tables_out,
        "table_count": len(tables_out),
        "can_edit": user.role.can_export,  # analyst+ can edit descriptions
    }


@router.put("/{conn_name}", status_code=200)
async def save_dictionary(
    conn_name: str,
    body: DictionarySaveRequest,
    user: UserContext = Depends(require_user),
) -> dict[str, Any]:
    """
    Persist table/column descriptions.  Requires analyst+ (can_export=True).
    """
    try:
        assert_conn_allowed(user, conn_name)
    except PermissionDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    if not user.role.can_export:
        raise HTTPException(status_code=403, detail="需要 analyst 以上權限才能編輯資料字典")

    # Load existing and merge (preserve unknown keys)
    existing = _load_dict(conn_name)
    existing_tables = existing.get("tables", {}) or {}

    for tname, entry in body.tables.items():
        existing_tables[tname] = {
            "description": entry.description,
            "category": entry.category,
            "columns": entry.columns,
        }

    _save_dict(conn_name, {"tables": existing_tables})

    logger.info(
        "Dictionary saved",
        extra={"conn_name": conn_name, "tables": len(body.tables), "user": user.user_id},
    )
    return {"saved": len(body.tables), "conn_name": conn_name}
