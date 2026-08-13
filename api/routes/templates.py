"""Question template library endpoints.

GET    /v1/templates                  — 列出當前角色可見的所有範本（內建 + 使用者自訂）
GET    /v1/templates?category=銷售    — 依分類過濾
GET    /v1/templates?search=關鍵字    — 標題/描述關鍵字搜尋
GET    /v1/templates/{template_id}    — 取得單一範本
POST   /v1/templates                  — 建立自訂範本（analyst+ 可用）
PUT    /v1/templates/user/{id}        — 更新自訂範本
DELETE /v1/templates/user/{id}        — 刪除自訂範本
"""

from __future__ import annotations

import logging
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from api.auth import require_admin, require_user
from api.schemas import TemplateCreate, TemplateUpdate
from core.rbac import UserContext
from core.templates import get_template, list_categories, list_templates

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/templates", tags=["templates"])

# Roles that may create/edit custom templates
_TEMPLATE_WRITE_ROLES = {"owner", "admin", "analyst", "editor"}


def _session():
    from api.main import app_state
    factory = app_state.get("session_factory")
    if factory is None:
        raise HTTPException(status_code=503, detail="Session factory not ready")
    return factory()


def _user_template_to_dict(tpl) -> dict:
    roles_list = [r.strip() for r in (tpl.roles or "*").split(",") if r.strip()]
    metric_ids = [m.strip() for m in (getattr(tpl, "metric_ids", "") or "").split(",") if m.strip()]
    return {
        "id": f"user_{tpl.id}",
        "db_id": tpl.id,
        "title": tpl.title,
        "icon": tpl.icon or "📌",
        "category": tpl.category,
        "prompt": tpl.prompt,
        "description": tpl.description or "",
        "roles": roles_list,
        "metric_ids": metric_ids,
        "query_plan": _json_loads(getattr(tpl, "query_plan", "") or ""),
        "chart_config": _json_loads(getattr(tpl, "chart_config", "") or ""),
        "is_public": tpl.is_public,
        "is_active": tpl.is_active,
        "owner_user_id": tpl.owner_user_id,
        "source": "user",
        "created_at": tpl.created_at.isoformat() if tpl.created_at else None,
        "updated_at": tpl.updated_at.isoformat() if tpl.updated_at else None,
    }


def _json_loads(value: str) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _json_dumps(value) -> str:
    if not value:
        return ""
    return json.dumps(value, ensure_ascii=False)


def _filter_user_templates(
    user: UserContext,
    *,
    category: Optional[str] = None,
    search: Optional[str] = None,
) -> list[dict]:
    """Return user-defined templates (only is_active=True) for this caller, by category."""
    from storage.metadata_db import UserTemplate

    with _session() as s:
        q = s.query(UserTemplate).filter(UserTemplate.is_active == True)  # noqa: E712
        if category:
            q = q.filter(UserTemplate.category == category)
        rows = q.order_by(UserTemplate.id.asc()).all()

    out: list[dict] = []
    for t in rows:
        # Visibility: public OR owner
        if not t.is_public:
            if str(t.owner_user_id) != str(user.user_id):
                continue
        # Role filter
        allowed_roles = [r.strip() for r in (t.roles or "*").split(",") if r.strip()]
        if "*" not in allowed_roles and (user.role_name or "") not in allowed_roles:
            continue
        data = _user_template_to_dict(t)
        if search:
            kw = search.lower()
            if not (
                kw in data.get("title", "").lower()
                or kw in data.get("description", "").lower()
                or kw in data.get("prompt", "").lower()
            ):
                continue
        out.append(data)
    return out


@router.get("")
async def list_templates_endpoint(
    category: Optional[str] = None,
    search: Optional[str] = None,
    user: UserContext = Depends(require_user),
):
    """Return merged built-in + user-defined templates visible to the caller."""
    built_in = list_templates(role=user.role_name, category=category)
    # Mark built-ins with a source tag
    for t in built_in:
        t.setdefault("source", "builtin")
        if "query_plan" not in t and t.get("default_plan"):
            t["query_plan"] = t.get("default_plan")

    user_templates = _filter_user_templates(user, category=category, search=search)

    all_templates = built_in + user_templates

    # Apply keyword search at the end if provided
    if search:
        kw = search.lower()
        all_templates = [
            t for t in all_templates
            if kw in t.get("title", "").lower()
            or kw in t.get("description", "").lower()
            or kw in t.get("prompt", "").lower()
        ]

    # Collect categories (built-in order first, then any new user-defined ones)
    categories = list_categories()
    for t in user_templates:
        if t["category"] not in categories:
            categories.append(t["category"])

    return {
        "categories": categories,
        "templates": all_templates,
        "total": len(all_templates),
    }


@router.get("/user/{db_id}")
async def get_user_template_endpoint(
    db_id: int,
    user: UserContext = Depends(require_user),
):
    """Return a single user-created template by its numeric DB id."""
    from storage.metadata_db import UserTemplate

    with _session() as s:
        tpl = s.query(UserTemplate).filter(UserTemplate.id == db_id).first()

    if not tpl or not tpl.is_active:
        raise HTTPException(status_code=404, detail="Template not found")
    if not tpl.is_public and str(tpl.owner_user_id) != str(user.user_id):
        if (user.role_name or "") not in {"owner", "admin"}:
            raise HTTPException(status_code=403, detail="無權存取此範本")
    return _user_template_to_dict(tpl)


@router.get("/{template_id}")
async def get_template_endpoint(
    template_id: str,
    user: UserContext = Depends(require_user),  # noqa: ARG001 (auth gate only)
):
    tpl = get_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    tpl.setdefault("source", "builtin")
    if "query_plan" not in tpl and tpl.get("default_plan"):
        tpl["query_plan"] = tpl.get("default_plan")
    return tpl


@router.post("", status_code=201)
async def create_template_endpoint(
    body: TemplateCreate,
    user: UserContext = Depends(require_user),
):
    """Create a new user-defined template."""
    if (user.role_name or "") not in _TEMPLATE_WRITE_ROLES:
        raise HTTPException(status_code=403, detail="您的角色無法建立自訂範本")

    from storage.metadata_db import UserTemplate

    try:
        user_id = int(user.user_id)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        user_id = None

    now = datetime.now(timezone.utc)
    tpl = UserTemplate(
        owner_user_id=user_id,
        title=body.title,
        icon=body.icon,
        category=body.category,
        prompt=body.prompt,
        description=body.description,
        roles=body.roles,
        metric_ids=",".join(body.metric_ids or []),
        query_plan=_json_dumps(body.query_plan),
        chart_config=_json_dumps(body.chart_config),
        is_public=body.is_public,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    with _session() as s:
        s.add(tpl)
        s.commit()
        s.refresh(tpl)
        return _user_template_to_dict(tpl)


@router.put("/user/{db_id}")
async def update_template_endpoint(
    db_id: int,
    body: TemplateUpdate,
    user: UserContext = Depends(require_user),
):
    """Update a user-defined template."""
    from storage.metadata_db import UserTemplate

    with _session() as s:
        tpl = s.query(UserTemplate).filter(UserTemplate.id == db_id).first()
        if not tpl:
            raise HTTPException(status_code=404, detail="Template not found")

        # Only owner/admin or the creator may edit
        is_admin = (user.role_name or "") in {"owner", "admin"}
        is_creator = str(tpl.owner_user_id) == str(user.user_id)
        if not is_admin and not is_creator:
            raise HTTPException(status_code=403, detail="無法編輯他人建立的範本")

        if body.title is not None:
            tpl.title = body.title
        if body.prompt is not None:
            tpl.prompt = body.prompt
        if body.category is not None:
            tpl.category = body.category
        if body.icon is not None:
            tpl.icon = body.icon
        if body.description is not None:
            tpl.description = body.description
        if body.roles is not None:
            tpl.roles = body.roles
        if body.metric_ids is not None:
            tpl.metric_ids = ",".join(body.metric_ids or [])
        if body.query_plan is not None:
            tpl.query_plan = _json_dumps(body.query_plan)
        if body.chart_config is not None:
            tpl.chart_config = _json_dumps(body.chart_config)
        if body.is_public is not None:
            tpl.is_public = body.is_public
        if body.is_active is not None:
            tpl.is_active = body.is_active
        tpl.updated_at = datetime.now(timezone.utc)
        s.commit()
        s.refresh(tpl)
        return _user_template_to_dict(tpl)


@router.delete("/user/{db_id}", status_code=204)
async def delete_template_endpoint(
    db_id: int,
    user: UserContext = Depends(require_user),
):
    """Soft-delete a user-defined template (sets is_active=False)."""
    from storage.metadata_db import UserTemplate

    with _session() as s:
        tpl = s.query(UserTemplate).filter(UserTemplate.id == db_id).first()
        if not tpl:
            raise HTTPException(status_code=404, detail="Template not found")

        is_admin = (user.role_name or "") in {"owner", "admin"}
        is_creator = str(tpl.owner_user_id) == str(user.user_id)
        if not is_admin and not is_creator:
            raise HTTPException(status_code=403, detail="無法刪除他人建立的範本")

        tpl.is_active = False
        tpl.updated_at = datetime.now(timezone.utc)
        s.commit()
