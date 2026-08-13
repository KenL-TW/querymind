"""Saved Insights — user-curated SQL / chart / answer snippets.

Per-user ownership with the same orphan-friendly visibility rules as sessions:
owner/admin can see all (when ``all_users=true``); others see only their own
and orphan rows (NULL owner_user_id) for backward compatibility.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_

from api.auth import require_user
from core.rbac import UserContext
from storage.metadata_db import SavedInsight

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/insights", tags=["insights"])


# ── Schemas ────────────────────────────────────────────────────────────────

class InsightCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=256)
    description: str = ""
    kind: str = Field("sql", pattern="^(sql|chart|answer)$")
    conn_name: Optional[str] = None
    sql: str = ""
    chart_config: str = ""
    tags: list[str] = Field(default_factory=list)
    pinned: bool = False


class InsightUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    kind: Optional[str] = Field(default=None, pattern="^(sql|chart|answer)$")
    conn_name: Optional[str] = None
    sql: Optional[str] = None
    chart_config: Optional[str] = None
    tags: Optional[list[str]] = None
    pinned: Optional[bool] = None


class InsightOut(BaseModel):
    id: int
    owner_user_id: Optional[int]
    title: str
    description: str
    kind: str
    conn_name: Optional[str]
    sql: str
    chart_config: str
    tags: list[str]
    pinned: bool
    created_at: Optional[str]
    updated_at: Optional[str]


# ── Helpers ────────────────────────────────────────────────────────────────

def _session_factory(request: Request):
    svc = getattr(request.app.state, "user_service", None)
    return getattr(svc, "_sf", None) if svc else None


def _can_see_all(user: UserContext) -> bool:
    return (user.role_name or "").lower() in {"owner", "admin"}


def _to_out(row: SavedInsight) -> InsightOut:
    tags = [t.strip() for t in (row.tags or "").split(",") if t.strip()]
    return InsightOut(
        id=row.id,
        owner_user_id=row.owner_user_id,
        title=row.title or "",
        description=row.description or "",
        kind=row.kind or "sql",
        conn_name=row.conn_name,
        sql=row.sql or "",
        chart_config=row.chart_config or "",
        tags=tags,
        pinned=bool(row.pinned),
        created_at=row.created_at.isoformat() if row.created_at else None,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
    )


def _own_or_admin(row: SavedInsight, user: UserContext) -> None:
    if row.owner_user_id is None:
        return
    if str(row.owner_user_id) == str(user.user_id):
        return
    if _can_see_all(user):
        return
    raise HTTPException(status_code=403, detail="無權存取此收藏。")


def _user_id_int(user: UserContext) -> Optional[int]:
    try:
        return int(user.user_id)
    except (TypeError, ValueError):
        return None


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[InsightOut])
async def list_insights(
    request: Request,
    user: UserContext = Depends(require_user),
    q: Optional[str] = Query(default=None, description="搜尋標題/描述/SQL/標籤"),
    kind: Optional[str] = Query(default=None, pattern="^(sql|chart|answer)$"),
    tag: Optional[str] = Query(default=None),
    all_users: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
):
    sf = _session_factory(request)
    if sf is None:
        raise HTTPException(status_code=503, detail="DB session not ready.")
    uid = _user_id_int(user)
    with sf() as s:
        qry = s.query(SavedInsight)
        if not (all_users and _can_see_all(user)):
            if uid is None:
                pass  # anonymous local mode → see all
            else:
                qry = qry.filter(or_(SavedInsight.owner_user_id == uid,
                                     SavedInsight.owner_user_id.is_(None)))
        if kind:
            qry = qry.filter(SavedInsight.kind == kind)
        if tag:
            qry = qry.filter(SavedInsight.tags.ilike(f"%{tag}%"))
        if q:
            like = f"%{q.lower()}%"
            qry = qry.filter(or_(
                SavedInsight.title.ilike(like),
                SavedInsight.description.ilike(like),
                SavedInsight.sql.ilike(like),
                SavedInsight.tags.ilike(like),
            ))
        rows = (qry
                .order_by(SavedInsight.pinned.desc(), SavedInsight.updated_at.desc())
                .limit(limit)
                .all())
        return [_to_out(r) for r in rows]


@router.post("", response_model=InsightOut, status_code=201)
async def create_insight(
    body: InsightCreate,
    request: Request,
    user: UserContext = Depends(require_user),
):
    sf = _session_factory(request)
    if sf is None:
        raise HTTPException(status_code=503, detail="DB session not ready.")
    with sf() as s:
        row = SavedInsight(
            owner_user_id=_user_id_int(user),
            title=body.title.strip(),
            description=body.description or "",
            kind=body.kind,
            conn_name=body.conn_name,
            sql=body.sql or "",
            chart_config=body.chart_config or "",
            tags=",".join(t.strip() for t in body.tags if t.strip()),
            pinned=bool(body.pinned),
        )
        s.add(row)
        s.commit()
        s.refresh(row)
        return _to_out(row)


@router.get("/{insight_id}", response_model=InsightOut)
async def get_insight(insight_id: int, request: Request, user: UserContext = Depends(require_user)):
    sf = _session_factory(request)
    if sf is None:
        raise HTTPException(status_code=503, detail="DB session not ready.")
    with sf() as s:
        row = s.get(SavedInsight, insight_id)
        if row is None:
            raise HTTPException(status_code=404, detail="收藏不存在。")
        _own_or_admin(row, user)
        return _to_out(row)


@router.patch("/{insight_id}", response_model=InsightOut)
async def update_insight(
    insight_id: int,
    body: InsightUpdate,
    request: Request,
    user: UserContext = Depends(require_user),
):
    sf = _session_factory(request)
    if sf is None:
        raise HTTPException(status_code=503, detail="DB session not ready.")
    with sf() as s:
        row = s.get(SavedInsight, insight_id)
        if row is None:
            raise HTTPException(status_code=404, detail="收藏不存在。")
        _own_or_admin(row, user)
        if body.title is not None:
            row.title = body.title.strip()
        if body.description is not None:
            row.description = body.description
        if body.kind is not None:
            row.kind = body.kind
        if body.conn_name is not None:
            row.conn_name = body.conn_name
        if body.sql is not None:
            row.sql = body.sql
        if body.chart_config is not None:
            row.chart_config = body.chart_config
        if body.tags is not None:
            row.tags = ",".join(t.strip() for t in body.tags if t.strip())
        if body.pinned is not None:
            row.pinned = bool(body.pinned)
        s.commit()
        s.refresh(row)
        return _to_out(row)


@router.delete("/{insight_id}", status_code=204)
async def delete_insight(insight_id: int, request: Request, user: UserContext = Depends(require_user)):
    sf = _session_factory(request)
    if sf is None:
        raise HTTPException(status_code=503, detail="DB session not ready.")
    with sf() as s:
        row = s.get(SavedInsight, insight_id)
        if row is None:
            raise HTTPException(status_code=404, detail="收藏不存在。")
        _own_or_admin(row, user)
        s.delete(row)
        s.commit()
    return None
