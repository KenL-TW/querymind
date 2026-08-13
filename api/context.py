"""Request-scoped context — the authenticated UserContext for the current request.

Used by tools (e.g. `tools/db_tools.py`) to enforce RBAC without having to
plumb the user object through every call site.
"""
from __future__ import annotations

from contextvars import ContextVar
from typing import Optional

from core.rbac import ANONYMOUS_USER, UserContext

_current_user: ContextVar[Optional[UserContext]] = ContextVar("qm_current_user", default=None)


def set_current_user(user: UserContext) -> None:
    _current_user.set(user)


def get_current_user() -> UserContext:
    """Return the active user, or ANONYMOUS_USER if none is bound."""
    return _current_user.get() or ANONYMOUS_USER


def clear_current_user() -> None:
    _current_user.set(None)
