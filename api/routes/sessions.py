from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.auth import require_admin, require_user
from core.rbac import UserContext
from api.schemas import (
    MessageItem,
    SessionDetail,
    SessionInfo,
    SessionListResponse,
    SessionRenameRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/sessions", tags=["sessions"])


def _can_see_all(user: UserContext) -> bool:
    """Owner/admin roles may opt-in to cross-tenant session views."""
    return (user.role_name or "").lower() in {"owner", "admin"}


def _assert_session_access(user: UserContext, owner_user_id: Optional[int]) -> None:
    """Raise 403 unless user owns the session, it is orphan, or user is owner/admin.

    Orphan sessions (``owner_user_id IS NULL``) are visible to anyone authenticated
    so legacy data isn't suddenly hidden after the migration; the first user to
    open one becomes the owner via chat.add_turn().
    """
    if owner_user_id is None:
        return
    if str(owner_user_id) == str(user.user_id):
        return
    if _can_see_all(user):
        return
    raise HTTPException(status_code=403, detail="無權存取此會話。")


@router.get("", response_model=SessionListResponse)
async def list_sessions(
    user: UserContext = Depends(require_user),
    q: Optional[str] = Query(default=None, description="搜尋標題或摘要"),
    include_archived: bool = Query(default=False),
    archived_only: bool = Query(default=False),
    all_users: bool = Query(default=False, description="僅 owner/admin 可用：跨租戶檢視"),
    limit: int = Query(default=200, ge=1, le=500),
) -> SessionListResponse:
    """List the caller's conversation sessions (or all when admin + all_users)."""
    from api.main import app_state

    mgr = app_state["session_manager"]
    owner_filter: Optional[int]
    if all_users and _can_see_all(user):
        owner_filter = None
    else:
        try:
            owner_filter = int(user.user_id)
        except (TypeError, ValueError):
            # Anonymous (AUTH_ENABLED=false) — fall back to "see all" so single-user
            # local mode still works.
            owner_filter = None

    sessions = mgr.list_sessions(
        owner_user_id=owner_filter,
        include_archived=include_archived or archived_only,
        archived_only=archived_only,
        search=q,
        limit=limit,
        # Admin/owner viewing all_users also sees legacy orphan sessions.
        include_orphans=(all_users and _can_see_all(user)) or (owner_filter is None),
    )
    return SessionListResponse(
        sessions=[
            SessionInfo(
                session_id=s.session_id,
                message_count=s.message_count,
                turn_count=s.turn_count,
                last_active=s.last_active,
                title=s.title,
                summary=s.summary,
                owner_user_id=s.owner_user_id,
                pinned=s.pinned,
                archived=s.archived,
            )
            for s in sessions
        ]
    )


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(
    session_id: str,
    user: UserContext = Depends(require_user),
) -> SessionDetail:
    """Return the full message history of a session (owner-scoped)."""
    from api.main import app_state

    mgr = app_state["session_manager"]
    if not mgr.session_exists(session_id):
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    meta = mgr.get_session_meta(session_id)
    _assert_session_access(user, meta.owner_user_id)

    messages = mgr.get_session_messages(session_id)
    return SessionDetail(
        session_id=session_id,
        message_count=len(messages),
        turn_count=len(messages) // 2,
        title=meta.title,
        summary=meta.summary,
        entities=meta.entities,
        messages=[MessageItem(role=m.role, content=m.content) for m in messages],
        owner_user_id=meta.owner_user_id,
        pinned=meta.pinned,
        archived=meta.archived,
    )


@router.patch("/{session_id}")
async def update_session(
    session_id: str,
    body: SessionRenameRequest,
    user: UserContext = Depends(require_user),
) -> dict:
    """Rename / pin / archive a session.  All three fields are optional."""
    from api.main import app_state

    mgr = app_state["session_manager"]
    if not mgr.session_exists(session_id):
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    meta = mgr.get_session_meta(session_id)
    _assert_session_access(user, meta.owner_user_id)

    mgr.upsert_session_meta(
        session_id,
        title=body.title,
        pinned=body.pinned,
        archived=body.archived,
    )
    logger.info(
        "Session updated via API",
        extra={"session_id": session_id, "title": body.title,
               "pinned": body.pinned, "archived": body.archived},
    )
    new_meta = mgr.get_session_meta(session_id)
    return {
        "status": "ok",
        "session_id": session_id,
        "title": new_meta.title,
        "pinned": new_meta.pinned,
        "archived": new_meta.archived,
    }


@router.delete("/{session_id}")
async def clear_session(
    session_id: str,
    user: UserContext = Depends(require_user),
) -> dict:
    """Delete all messages for a session (owner-scoped)."""
    from api.main import app_state

    mgr = app_state["session_manager"]
    meta = mgr.get_session_meta(session_id)
    _assert_session_access(user, meta.owner_user_id)
    mgr.clear_session(session_id)
    logger.info("Session cleared via API", extra={"session_id": session_id})
    return {"status": "cleared", "session_id": session_id}


@router.delete("")
async def prune_sessions(role: str = Depends(require_admin)) -> dict:
    """
    Delete sessions whose meta updated_at is older than
    ``session_retention_days`` (admin-only).  Pinned sessions are spared.
    """
    from api.main import app_state

    from config.settings import settings

    mgr = app_state["session_manager"]
    deleted = mgr.prune_old_sessions(settings.session_retention_days)
    logger.info("Session prune triggered via API", extra={"deleted_rows": deleted})
    return {"status": "pruned", "deleted_rows": deleted, "retention_days": settings.session_retention_days}
