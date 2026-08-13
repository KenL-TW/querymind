"""Admin endpoints — user, API key, and role management.

All routes require the caller's role to have `can_manage_users` (i.e. owner).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func

from api.auth import require_capability, require_user
from core.rbac import UserContext, list_roles
from core.token_usage import estimate_cost_usd
from storage.metadata_db import AuditLog, SystemConfig

router = APIRouter(prefix="/v1/admin", tags=["admin"])
me_router = APIRouter(prefix="/v1", tags=["account"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: str = Field(..., min_length=3)
    role: str = "viewer"
    display_name: str = ""
    allowed_conns: list[str] = Field(default_factory=list)
    initial_password: str | None = Field(default=None, min_length=8)


class UserUpdate(BaseModel):
    role: str | None = None
    display_name: str | None = None
    allowed_conns: list[str] | None = None
    is_active: bool | None = None


class KeyCreate(BaseModel):
    label: str = ""


class InvitationCreate(BaseModel):
    email: str = Field(..., min_length=3)
    role: str = "viewer"
    allowed_conns: list[str] = Field(default_factory=list)
    expires_hours: int = Field(default=72, ge=1, le=24 * 30)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _svc(request: Request):
    svc = getattr(request.app.state, "user_service", None)
    if svc is None:
        raise HTTPException(status_code=503, detail="UserService not initialised.")
    return svc


def _session_factory(request: Request):
    svc = _svc(request)
    return getattr(svc, "_sf", None)


# ── Self ─────────────────────────────────────────────────────────────────────

@me_router.get("/me")
async def whoami(user: UserContext = Depends(require_user)):
    """Return the caller's identity, role and effective permissions."""
    return user.to_dict()


@me_router.get("/me/usage")
async def my_usage(
    request: Request,
    days: int = 30,
    user: UserContext = Depends(require_user),
):
    """Return the current user's own token usage and call statistics.

    Accessible to all authenticated users (not admin-only).
    """
    days = max(1, min(int(days or 30), 365))
    cutoff = datetime.utcnow() - timedelta(days=days)

    try:
        uid = int(user.user_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="無法識別使用者 ID。")

    sf = _session_factory(request)
    if sf is None:
        raise HTTPException(status_code=503, detail="DB session not ready.")

    with sf() as s:
        total_row = (
            s.query(
                func.count(AuditLog.id),
                func.coalesce(func.sum(AuditLog.prompt_tokens), 0),
                func.coalesce(func.sum(AuditLog.completion_tokens), 0),
                func.coalesce(func.sum(AuditLog.total_tokens), 0),
            )
            .filter(AuditLog.user_id == uid)
            .filter(AuditLog.created_at >= cutoff)
            .one()
        )
        try:
            day_col = func.date(AuditLog.created_at).label("d")
            daily_rows = (
                s.query(
                    day_col,
                    func.coalesce(func.sum(AuditLog.prompt_tokens), 0),
                    func.coalesce(func.sum(AuditLog.completion_tokens), 0),
                    func.coalesce(func.sum(AuditLog.total_tokens), 0),
                )
                .filter(AuditLog.user_id == uid)
                .filter(AuditLog.created_at >= cutoff)
                .filter(AuditLog.total_tokens.isnot(None))
                .group_by(day_col)
                .order_by(day_col.asc())
                .all()
            )
        except Exception:
            daily_rows = []
        model_rows = (
            s.query(
                AuditLog.model_name,
                func.count(AuditLog.id),
                func.coalesce(func.sum(AuditLog.prompt_tokens), 0),
                func.coalesce(func.sum(AuditLog.completion_tokens), 0),
                func.coalesce(func.sum(AuditLog.total_tokens), 0),
            )
            .filter(AuditLog.user_id == uid)
            .filter(AuditLog.created_at >= cutoff)
            .filter(AuditLog.model_name.isnot(None))
            .group_by(AuditLog.model_name)
            .order_by(func.coalesce(func.sum(AuditLog.total_tokens), 0).desc())
            .limit(10)
            .all()
        )

    calls, p, c, t = total_row
    return {
        "user_id": uid,
        "window_days": days,
        "total_calls": int(calls or 0),
        "prompt_tokens": int(p or 0),
        "completion_tokens": int(c or 0),
        "total_tokens": int(t or 0),
        "daily_series": _token_daily_list(daily_rows),
        "by_model": _token_by_model_list(model_rows),
    }


# ── Roles ────────────────────────────────────────────────────────────────────

@router.get("/roles", dependencies=[Depends(require_capability("can_manage_users"))])
async def get_roles():
    return [
        {
            "name": r.name,
            "description": r.description,
            "allowed_sql_verbs": sorted(r.allowed_sql_verbs),
            "max_rows_per_query": r.max_rows_per_query,
            "can_export": r.can_export,
            "can_schedule": r.can_schedule,
            "can_etl": r.can_etl,
            "can_manage_users": r.can_manage_users,
            "can_modify_schema": r.can_modify_schema,
        }
        for r in list_roles()
    ]


class RoleUpdate(BaseModel):
    max_rows_per_query: int | None = Field(default=None, ge=1, le=10_000_000)
    can_export: bool | None = None
    can_schedule: bool | None = None
    can_etl: bool | None = None
    can_manage_users: bool | None = None
    can_modify_schema: bool | None = None
    allowed_sql_verbs: list[str] | None = None


@router.put("/roles/{role_name}",
            dependencies=[Depends(require_capability("can_manage_users"))])
async def update_role(role_name: str, payload: RoleUpdate, request: Request):
    import json as _json
    from core.rbac import GLOBAL_FORBIDDEN_VERBS, Role, get_role, register_role
    from storage.metadata_db import SystemConfig

    # Protect admin access – owner must always keep can_manage_users
    if role_name == "owner" and payload.can_manage_users is False:
        raise HTTPException(400, "不允許移除 owner 角色的管理員權限。")

    base_role = get_role(role_name)

    if payload.allowed_sql_verbs is not None:
        verbs: frozenset[str] = frozenset(
            v.strip().upper() for v in payload.allowed_sql_verbs if v.strip()
        ) - GLOBAL_FORBIDDEN_VERBS
    else:
        verbs = base_role.allowed_sql_verbs

    updated = Role(
        name=base_role.name,
        description=base_role.description,
        allowed_sql_verbs=verbs,
        allowed_tools=base_role.allowed_tools,
        max_rows_per_query=payload.max_rows_per_query
            if payload.max_rows_per_query is not None else base_role.max_rows_per_query,
        can_export=payload.can_export
            if payload.can_export is not None else base_role.can_export,
        can_schedule=payload.can_schedule
            if payload.can_schedule is not None else base_role.can_schedule,
        can_etl=payload.can_etl
            if payload.can_etl is not None else base_role.can_etl,
        can_manage_users=payload.can_manage_users
            if payload.can_manage_users is not None else base_role.can_manage_users,
        can_modify_schema=payload.can_modify_schema
            if payload.can_modify_schema is not None else base_role.can_modify_schema,
    )
    register_role(updated)

    # Persist to SystemConfig
    sf = _session_factory(request)
    if sf:
        config_key = f"role_config.{role_name}"
        config_value = _json.dumps({
            "max_rows_per_query": updated.max_rows_per_query,
            "can_export": updated.can_export,
            "can_schedule": updated.can_schedule,
            "can_etl": updated.can_etl,
            "can_manage_users": updated.can_manage_users,
            "can_modify_schema": updated.can_modify_schema,
            "allowed_sql_verbs": sorted(updated.allowed_sql_verbs),
        })
        with sf() as s:
            rc = s.query(SystemConfig).filter_by(key=config_key).one_or_none()
            if rc:
                rc.value = config_value
            else:
                s.add(SystemConfig(key=config_key, value=config_value))
            s.commit()

    return {
        "name": updated.name,
        "description": updated.description,
        "allowed_sql_verbs": sorted(updated.allowed_sql_verbs),
        "max_rows_per_query": updated.max_rows_per_query,
        "can_export": updated.can_export,
        "can_schedule": updated.can_schedule,
        "can_etl": updated.can_etl,
        "can_manage_users": updated.can_manage_users,
        "can_modify_schema": updated.can_modify_schema,
    }


# ── Users ────────────────────────────────────────────────────────────────────

@router.get("/users", dependencies=[Depends(require_capability("can_manage_users"))])
async def list_users(request: Request):
    return _svc(request).list_users()


@router.post("/users", status_code=201)
async def create_user(
    payload: UserCreate,
    request: Request,
    admin: UserContext = Depends(require_user),
):
    if not getattr(admin.role, "can_manage_users", False):
        raise HTTPException(status_code=403, detail="insufficient capability: can_manage_users")
    try:
        return _svc(request).create_user(
            email=payload.email,
            role=payload.role,
            display_name=payload.display_name,
            allowed_conns=payload.allowed_conns,
            initial_password=payload.initial_password,
            invited_by_id=int(admin.user_id) if not payload.initial_password and admin.user_id else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.patch("/users/{user_id}",
              dependencies=[Depends(require_capability("can_manage_users"))])
async def update_user(user_id: int, payload: UserUpdate, request: Request):
    updated = _svc(request).update_user(
        user_id,
        role=payload.role,
        display_name=payload.display_name,
        allowed_conns=payload.allowed_conns,
        is_active=payload.is_active,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return updated


@router.delete("/users/{user_id}", status_code=204,
               dependencies=[Depends(require_capability("can_manage_users"))])
async def delete_user(user_id: int, request: Request,
                      caller: UserContext = Depends(require_user)):
    if str(user_id) == caller.user_id:
        raise HTTPException(status_code=400, detail="不能刪除自己。")
    if not _svc(request).delete_user(user_id):
        raise HTTPException(status_code=404, detail="User not found.")
    return None


# ── API keys ─────────────────────────────────────────────────────────────────

@router.get("/users/{user_id}/keys",
            dependencies=[Depends(require_capability("can_manage_users"))])
async def list_keys(user_id: int, request: Request):
    return _svc(request).list_keys(user_id)


@router.post("/users/{user_id}/keys", status_code=201,
             dependencies=[Depends(require_capability("can_manage_users"))])
async def issue_key(user_id: int, payload: KeyCreate, request: Request):
    try:
        raw, key = _svc(request).issue_key(user_id, label=payload.label)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    # The raw key is returned only once.
    return {"api_key": raw, "key": key, "warning": "請立即妥善保存，此金鑰僅顯示這一次。"}


@router.delete("/keys/{key_id}", status_code=204,
               dependencies=[Depends(require_capability("can_manage_users"))])
async def revoke_key(key_id: int, request: Request):
    if not _svc(request).revoke_key(key_id):
        raise HTTPException(status_code=404, detail="API key not found.")
    return None


# ── Invitations ──────────────────────────────────────────────────────────────

@router.get("/invitations", dependencies=[Depends(require_capability("can_manage_users"))])
async def list_invitations(request: Request):
    return _svc(request).list_invitations()


@router.post("/invitations", status_code=201,
             dependencies=[Depends(require_capability("can_manage_users"))])
async def create_invitation(
    payload: InvitationCreate,
    request: Request,
    caller: UserContext = Depends(require_user),
):
    try:
        token, invitation = _svc(request).create_invitation(
            email=payload.email,
            role=payload.role,
            invited_by_id=int(caller.user_id),
            allowed_conns=payload.allowed_conns,
            expires_hours=payload.expires_hours,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "invitation": invitation,
        "invite_token": token,
        "warning": "邀請 token 僅顯示一次，請立即送達使用者。",
    }


@router.delete("/invitations/{invitation_id}", status_code=204,
               dependencies=[Depends(require_capability("can_manage_users"))])
async def revoke_invitation(invitation_id: int, request: Request):
    if not _svc(request).revoke_invitation(invitation_id):
        raise HTTPException(status_code=404, detail="Invitation not found.")
    return None


# ── Audit / Usage ────────────────────────────────────────────────────────────


def _token_totals_dict(row) -> dict:
    p, c, t = (int(x or 0) for x in row)
    return {
        "prompt_tokens": p,
        "completion_tokens": c,
        "total_tokens": t,
    }


def _token_daily_list(rows) -> list[dict]:
    return [
        {
            "date": str(d),
            "prompt_tokens": int(p or 0),
            "completion_tokens": int(c or 0),
            "total_tokens": int(t or 0),
        }
        for d, p, c, t in rows
    ]


def _token_by_model_list(rows) -> list[dict]:
    out: list[dict] = []
    for model, calls, p, c, t in rows:
        prompt_t = int(p or 0)
        comp_t = int(c or 0)
        # Cost uses first model when multiple are concatenated by the accumulator.
        primary = (model or "").split(",")[0].strip() if model else None
        out.append({
            "model_name": model or "unknown",
            "calls": int(calls or 0),
            "prompt_tokens": prompt_t,
            "completion_tokens": comp_t,
            "total_tokens": int(t or 0),
            "cost_usd": estimate_cost_usd(primary, prompt_t, comp_t),
        })
    return out


def _token_by_user_list(rows) -> list[dict]:
    """Per-user token breakdown for admin dashboard."""
    out: list[dict] = []
    for uid, calls, p, c, t in rows:
        out.append({
            "user_id": uid,
            "calls": int(calls or 0),
            "prompt_tokens": int(p or 0),
            "completion_tokens": int(c or 0),
            "total_tokens": int(t or 0),
        })
    return out


@router.get("/audit-logs", dependencies=[Depends(require_capability("can_manage_users"))])
async def get_audit_logs(
    request: Request,
    page: int = 1,
    size: int = 50,
    event_type: str | None = None,
    api_key_prefix: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
):
    sf = _session_factory(request)
    if sf is None:
        raise HTTPException(status_code=503, detail="DB session not ready.")
    page = max(1, page)
    size = min(200, max(1, size))

    with sf() as s:
        q = s.query(AuditLog)
        if event_type:
            q = q.filter(AuditLog.event_type == event_type)
        if api_key_prefix:
            q = q.filter(AuditLog.api_key_prefix == api_key_prefix)
        if date_from:
            q = q.filter(AuditLog.created_at >= datetime.fromisoformat(date_from))
        if date_to:
            q = q.filter(AuditLog.created_at <= datetime.fromisoformat(date_to))

        total = q.count()
        rows = q.order_by(AuditLog.created_at.desc()).offset((page - 1) * size).limit(size).all()

    items = [
        {
            "id": r.id,
            "session_id": r.session_id,
            "user_id": r.user_id,
            "api_key_prefix": r.api_key_prefix,
            "event_type": r.event_type,
            "tool_name": r.tool_name,
            "conn_name": r.conn_name,
            "status": r.status,
            "duration_ms": r.duration_ms,
            "detail": r.detail,
            "prompt_tokens": r.prompt_tokens,
            "completion_tokens": r.completion_tokens,
            "total_tokens": r.total_tokens,
            "model_name": r.model_name,
            "error_msg": r.error_msg,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
    return {"page": page, "size": size, "total": total, "items": items}


@router.get("/usage-stats", dependencies=[Depends(require_capability("can_manage_users"))])
async def usage_stats(request: Request, days: int = 7):
    """Aggregated usage analytics for the admin dashboard.

    Args:
        days: lookback window for the daily time-series + per-conn/per-tool
              breakdowns.  Totals/error_rate remain all-time so the dashboard
              can show both at-a-glance and trend views.

    Token-cost estimate: not computed here — token counts aren't persisted in
    the audit table.  Frontend can multiply ``total_calls`` by an average if
    desired.  Estimating per-call from `detail` string lengths would be too
    inaccurate to surface as a number.
    """
    days = max(1, min(int(days or 7), 90))
    cutoff = datetime.utcnow() - timedelta(days=days)

    sf = _session_factory(request)
    if sf is None:
        raise HTTPException(status_code=503, detail="DB session not ready.")
    with sf() as s:
        total_calls = s.query(func.count(AuditLog.id)).scalar() or 0
        total_errors = s.query(func.count(AuditLog.id)).filter(AuditLog.status == "error").scalar() or 0
        per_event_rows = s.query(
            AuditLog.event_type,
            func.count(AuditLog.id),
        ).group_by(AuditLog.event_type).all()
        per_prefix_rows = s.query(
            AuditLog.api_key_prefix,
            func.count(AuditLog.id),
        ).group_by(AuditLog.api_key_prefix).order_by(func.count(AuditLog.id).desc()).limit(20).all()

        # ── Window-scoped breakdowns ──────────────────────────────────────
        windowed = s.query(AuditLog).filter(AuditLog.created_at >= cutoff)

        # ``date()`` truncates a timestamp to YYYY-MM-DD on PostgreSQL.
        # For unexpected dialect differences, fall back to grouping in Python.
        try:
            day_col = func.date(AuditLog.created_at).label("d")
            daily_rows = (
                s.query(
                    day_col,
                    func.count(AuditLog.id),
                    func.sum(case((AuditLog.status == "error", 1), else_=0)),
                    func.avg(AuditLog.duration_ms),
                )
                .filter(AuditLog.created_at >= cutoff)
                .group_by(day_col)
                .order_by(day_col.asc())
                .all()
            )
        except Exception:
            # Fallback for dialects without `date()`.
            daily_rows = []

        per_conn_rows = (
            windowed.with_entities(
                AuditLog.conn_name,
                func.count(AuditLog.id),
                func.sum(case((AuditLog.status == "error", 1), else_=0)),
                func.avg(AuditLog.duration_ms),
            )
            .group_by(AuditLog.conn_name)
            .order_by(func.count(AuditLog.id).desc())
            .limit(20)
            .all()
        )

        per_tool_rows = (
            windowed.with_entities(
                AuditLog.tool_name,
                func.count(AuditLog.id),
                func.avg(AuditLog.duration_ms),
            )
            .filter(AuditLog.tool_name.isnot(None))
            .group_by(AuditLog.tool_name)
            .order_by(func.count(AuditLog.id).desc())
            .limit(20)
            .all()
        )

        # ── Token usage (windowed + per-day + per-model) ──────────────────
        token_total_row = (
            s.query(
                func.coalesce(func.sum(AuditLog.prompt_tokens), 0),
                func.coalesce(func.sum(AuditLog.completion_tokens), 0),
                func.coalesce(func.sum(AuditLog.total_tokens), 0),
            )
            .filter(AuditLog.created_at >= cutoff)
            .filter(AuditLog.total_tokens.isnot(None))
            .one()
        )
        try:
            day_col2 = func.date(AuditLog.created_at).label("d")
            token_daily_rows = (
                s.query(
                    day_col2,
                    func.coalesce(func.sum(AuditLog.prompt_tokens), 0),
                    func.coalesce(func.sum(AuditLog.completion_tokens), 0),
                    func.coalesce(func.sum(AuditLog.total_tokens), 0),
                )
                .filter(AuditLog.created_at >= cutoff)
                .filter(AuditLog.total_tokens.isnot(None))
                .group_by(day_col2)
                .order_by(day_col2.asc())
                .all()
            )
        except Exception:
            token_daily_rows = []
        per_model_rows = (
            s.query(
                AuditLog.model_name,
                func.count(AuditLog.id),
                func.coalesce(func.sum(AuditLog.prompt_tokens), 0),
                func.coalesce(func.sum(AuditLog.completion_tokens), 0),
                func.coalesce(func.sum(AuditLog.total_tokens), 0),
            )
            .filter(AuditLog.created_at >= cutoff)
            .filter(AuditLog.model_name.isnot(None))
            .group_by(AuditLog.model_name)
            .order_by(func.coalesce(func.sum(AuditLog.total_tokens), 0).desc())
            .limit(20)
            .all()
        )
        per_user_rows = (
            s.query(
                AuditLog.user_id,
                func.count(AuditLog.id),
                func.coalesce(func.sum(AuditLog.prompt_tokens), 0),
                func.coalesce(func.sum(AuditLog.completion_tokens), 0),
                func.coalesce(func.sum(AuditLog.total_tokens), 0),
            )
            .filter(AuditLog.created_at >= cutoff)
            .filter(AuditLog.total_tokens.isnot(None))
            .group_by(AuditLog.user_id)
            .order_by(func.coalesce(func.sum(AuditLog.total_tokens), 0).desc())
            .limit(50)
            .all()
        )
        window_total_calls = windowed.count()
        window_errors = windowed.filter(AuditLog.status == "error").count()
        chat_questions = windowed.filter(AuditLog.event_type == "agent_invoke").count()
        rbac_denies = windowed.filter(
            (AuditLog.status == "denied") | (AuditLog.event_type == "rbac.denied")
        ).count()
        write_blocks = windowed.filter(AuditLog.event_type == "sql.write_blocked").count()
        export_events = windowed.filter(AuditLog.event_type.in_(["export_csv", "export_xlsx"])).count()
        distinct_users = (
            s.query(AuditLog.user_id)
            .filter(AuditLog.created_at >= cutoff)
            .filter(AuditLog.user_id.isnot(None))
            .distinct()
            .count()
        )
        distinct_api_prefixes = (
            s.query(AuditLog.api_key_prefix)
            .filter(AuditLog.created_at >= cutoff)
            .filter(AuditLog.api_key_prefix.isnot(None))
            .distinct()
            .count()
        )
        dlp_rows = (
            windowed.with_entities(AuditLog.detail)
            .filter(AuditLog.detail.like("%dlp_redactions=%"))
            .limit(500)
            .all()
        )

    per_event = [{"event_type": k or "unknown", "count": int(v)} for k, v in per_event_rows]
    per_prefix = [{"api_key_prefix": k or "unknown", "count": int(v)} for k, v in per_prefix_rows]
    error_rate = (float(total_errors) / float(total_calls)) if total_calls else 0.0
    daily_series = [
        {
            "date": str(d),
            "calls": int(c or 0),
            "errors": int(e or 0),
            "avg_duration_ms": round(float(avg_ms or 0), 1),
        }
        for d, c, e, avg_ms in daily_rows
    ]
    by_conn = [
        {
            "conn_name": conn or "unknown",
            "calls": int(c or 0),
            "errors": int(e or 0),
            "avg_duration_ms": round(float(avg_ms or 0), 1),
        }
        for conn, c, e, avg_ms in per_conn_rows
    ]
    by_tool = [
        {
            "tool_name": tool or "unknown",
            "calls": int(c or 0),
            "avg_duration_ms": round(float(avg_ms or 0), 1),
        }
        for tool, c, avg_ms in per_tool_rows
    ]
    token_by_model = _token_by_model_list(per_model_rows)
    total_estimated_cost = round(sum(float(r.get("cost_usd") or 0) for r in token_by_model), 6)
    dlp_redactions = 0
    dlp_events = 0
    for (detail,) in dlp_rows:
        text = detail or ""
        marker = "dlp_redactions="
        if marker not in text:
            continue
        dlp_events += 1
        try:
            tail = text.split(marker, 1)[1].split(" ", 1)[0]
            dlp_redactions += int(tail)
        except Exception:
            pass
    window_success_rate = (
        1.0 - (float(window_errors) / float(window_total_calls))
        if window_total_calls else 0.0
    )
    poc_summary = {
        "active_users": int(max(distinct_users or 0, distinct_api_prefixes or 0)),
        "questions": int(chat_questions or 0),
        "success_rate": round(window_success_rate, 4),
        "error_rate": round(1.0 - window_success_rate, 4) if window_total_calls else 0.0,
        "token_cost_usd": total_estimated_cost,
        "rbac_denies": int(rbac_denies or 0),
        "write_blocks": int(write_blocks or 0),
        "export_events": int(export_events or 0),
        "dlp_events": int(dlp_events or 0),
        "dlp_redactions": int(dlp_redactions or 0),
        "top_connections": by_conn[:5],
        "top_tools": by_tool[:5],
    }
    return {
        "total_calls": int(total_calls),
        "total_errors": int(total_errors),
        "error_rate": round(error_rate, 4),
        "calls_by_event": per_event,
        "calls_by_api_key_prefix": per_prefix,
        "window_days": days,
        "daily_series": daily_series,
        "calls_by_conn": by_conn,
        "calls_by_tool": by_tool,
        "token_totals": _token_totals_dict(token_total_row),
        "token_daily_series": _token_daily_list(token_daily_rows),
        "token_by_model": token_by_model,
        "token_by_user": _token_by_user_list(per_user_rows),
        "poc_summary": poc_summary,
    }


@router.get("/system-info", dependencies=[Depends(require_capability("can_manage_users"))])
async def system_info(request: Request):
    from api.routes.health import VERSION
    from config.settings import settings

    svc = _svc(request)
    return {
        "version": VERSION,
        "environment": settings.environment,
        "auth_enabled": settings.auth_enabled,
        "rbac_enabled": settings.rbac_enabled,
        "first_run_pending": svc.is_first_run_pending(),
    }


# ── Cache management ──────────────────────────────────────────────────────────

@router.get("/cache/stats", dependencies=[Depends(require_capability("can_manage_users"))])
async def cache_stats():
    """Return current in-process cache statistics (query cache + schema cache)."""
    from core.query_cache import stats as qc_stats
    from db.introspect import _cache as schema_cache, _cache_lock as schema_lock
    import time

    with schema_lock:
        total_schema = len(schema_cache)
        now = time.monotonic()
        active_schema = sum(1 for exp, _ in schema_cache.values() if exp > now)

    return {
        "query_cache": qc_stats(),
        "schema_cache": {
            "total_entries": total_schema,
            "active_entries": active_schema,
            "expired_entries": total_schema - active_schema,
        },
    }


@router.post("/cache/invalidate", dependencies=[Depends(require_capability("can_manage_users"))])
async def invalidate_caches(conn_name: str | None = None):
    """Evict all in-process caches (query result cache + schema cache).

    Pass ``?conn_name=<name>`` to scope schema cache invalidation to a specific
    connection (query cache is always fully cleared).
    """
    from core.query_cache import invalidate as qc_invalidate
    from db.introspect import invalidate_schema_cache

    qc_cleared = qc_invalidate(conn_name)
    invalidate_schema_cache(conn_name)

    return {
        "ok": True,
        "query_cache_cleared": qc_cleared,
        "schema_cache_cleared": True,
        "scope": conn_name or "all",
    }
