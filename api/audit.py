"""
Audit logging service.

Writes every agent invocation and tool call to qm_audit_log.
Failures are swallowed with a warning so audit errors never break the main flow.
"""
from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Generator

from sqlalchemy.orm import sessionmaker

from storage.metadata_db import AuditLog

logger = logging.getLogger(__name__)


class AuditLogger:
    """Thread-safe writer for the qm_audit_log table."""

    def __init__(self, session_factory: sessionmaker) -> None:
        self._factory = session_factory

    def log(
        self,
        event_type: str,
        *,
        session_id: str | None = None,
        user_id: int | None = None,
        api_key_prefix: str | None = None,
        tool_name: str | None = None,
        conn_name: str | None = None,
        detail: str | None = None,
        status: str = "success",
        duration_ms: int | None = None,
        error_msg: str | None = None,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        total_tokens: int | None = None,
        model_name: str | None = None,
    ) -> None:
        """Persist one audit entry.  Never raises."""
        try:
            db_session = self._factory()
            try:
                entry = AuditLog(
                    session_id=session_id,
                    user_id=user_id,
                    api_key_prefix=api_key_prefix,
                    event_type=event_type,
                    tool_name=tool_name,
                    conn_name=conn_name,
                    detail=(detail or "")[:8000],
                    status=status,
                    duration_ms=duration_ms,
                    error_msg=(error_msg or "")[:8000] if error_msg else None,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    total_tokens=total_tokens,
                    model_name=(model_name or None) and str(model_name)[:128],
                    created_at=datetime.now(timezone.utc),
                )
                db_session.add(entry)
                db_session.commit()
            except Exception:
                db_session.rollback()
                raise
            finally:
                db_session.close()
        except Exception as exc:
            logger.warning("AuditLogger write failed: %s", exc)

    @contextmanager
    def timed(
        self,
        event_type: str,
        **kwargs,
    ) -> Generator[dict, None, None]:
        """Context manager that auto-records duration and catches errors.

        Usage::

            with audit.timed("agent_invoke", session_id=sid, conn_name=cn) as ctx:
                result = run_agent(...)
                ctx["detail"] = result[:200]

        On exception, status is set to "error" and error_msg is captured.
        """
        ctx: dict = {}
        t0 = time.monotonic()
        try:
            yield ctx
            duration_ms = int((time.monotonic() - t0) * 1000)
            self.log(
                event_type,
                duration_ms=duration_ms,
                status="success",
                **{**kwargs, **ctx},
            )
        except Exception as exc:
            duration_ms = int((time.monotonic() - t0) * 1000)
            self.log(
                event_type,
                duration_ms=duration_ms,
                status="error",
                error_msg=str(exc),
                **{**kwargs, **ctx},
            )
            raise


# ── Helpers ───────────────────────────────────────────────────────────────────

def actor_prefix_for_user(user_id: str | int | None, email: str = "") -> str:
    """Render a uniform audit actor prefix from a UserContext-like pair.

    Used by auth-event audit hooks so login/refresh/logout entries share the
    same identifier format as tool_call/agent_invoke entries written by chat.
    """
    if user_id and str(user_id) not in ("anonymous", "0", ""):
        return f"u{user_id}"[:16]
    if email:
        return email[:16]
    return "anon"


def purge_expired_refresh_tokens(session_factory: sessionmaker, *, grace_days: int = 7) -> int:
    """Delete refresh tokens that expired more than ``grace_days`` ago.

    Called at app startup so ``qm_refresh_tokens`` doesn't grow forever.
    Returns the row count deleted.  Errors are logged and swallowed.
    """
    from datetime import timedelta

    from storage.metadata_db import RefreshToken

    cutoff = datetime.now(timezone.utc) - timedelta(days=grace_days)
    try:
        s = session_factory()
        try:
            n = (
                s.query(RefreshToken)
                .filter(RefreshToken.expires_at < cutoff)
                .delete(synchronize_session=False)
            )
            s.commit()
            if n:
                logger.info("Purged %d expired refresh tokens (cutoff=%s)", n, cutoff.isoformat())
            return int(n or 0)
        finally:
            s.close()
    except Exception as exc:
        logger.warning("purge_expired_refresh_tokens failed: %s", exc)
        return 0
