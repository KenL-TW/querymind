from __future__ import annotations

import logging

from fastapi import HTTPException, Request, Security, status
from fastapi.security import APIKeyHeader

from api.context import set_current_user
from core.jwt_utils import TokenError, decode_token
from core.rbac import UserContext, get_role

logger = logging.getLogger(__name__)

_API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)


def _get_user_service(request: Request):
    """Pull the UserService from the FastAPI app state set in main.py lifespan."""
    return getattr(request.app.state, "user_service", None)


async def require_user(
    request: Request,
    api_key: str | None = Security(_API_KEY_HEADER),
) -> UserContext:
    """
    FastAPI dependency — authenticates the X-API-Key header and returns the
    full UserContext (role + allowed connections).

    Behaviour:
      * AUTH_ENABLED=false   → returns an anonymous user with role=settings.anonymous_role
      * Valid key            → returns the DB-backed UserContext
      * Missing / invalid    → HTTP 401 / 403
    """
    from config.settings import settings

    if not settings.auth_enabled:
        anon = UserContext(
            user_id="anonymous",
            email="anonymous@local",
            role_name=settings.anonymous_role,
            api_key_prefix="anon",
        )
        set_current_user(anon)
        return anon

    authz = request.headers.get("Authorization", "")
    if authz.lower().startswith("bearer "):
        token = authz.split(" ", 1)[1].strip()
        try:
            payload = decode_token(token, expected_type="access")
            user_id = int(str(payload.get("sub", "")))
        except (TokenError, ValueError):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid access token.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        svc = _get_user_service(request)
        user = svc.get_user_context(user_id) if svc else None
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        set_current_user(user)
        return user

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization Bearer token or X-API-Key header.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    svc = _get_user_service(request)
    user: UserContext | None = None
    if svc is not None:
        user = svc.authenticate(api_key)

    # Backward-compat: fall back to legacy JSON key map in settings
    if user is None:
        legacy_role = settings.api_keys_dict.get(api_key)
        if legacy_role:
            mapped = {"admin": "owner", "readonly": "viewer"}.get(legacy_role, legacy_role)
            user = UserContext(
                user_id="legacy",
                email="legacy@local",
                role_name=mapped,
                api_key_prefix=api_key[:8],
            )

    if user is None:
        logger.warning("Rejected request with invalid API key prefix=%s", api_key[:8])
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or revoked API key.",
        )

    set_current_user(user)
    return user


# ── Backward-compat shims ────────────────────────────────────────────────────
# Old routes import `require_api_key` / `require_admin` and expect a role string.

async def require_api_key(user: UserContext = Security(require_user)) -> str:
    return user.role_name


async def require_admin(user: UserContext = Security(require_user)) -> str:
    if not user.role.can_manage_users and user.role_name not in ("owner", "dba", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required.",
        )
    return user.role_name


def require_role(*allowed: str):
    """Dependency factory: only the listed role names are accepted."""
    allowed_lc = {r.lower() for r in allowed}

    async def _dep(user: UserContext = Security(require_user)) -> UserContext:
        if user.role_name.lower() not in allowed_lc:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role `{user.role_name}` not permitted. Allowed: {sorted(allowed_lc)}",
            )
        return user
    return _dep


def require_capability(cap: str):
    """Dependency factory: gate by Role boolean capability flag (e.g. 'can_etl')."""

    async def _dep(user: UserContext = Security(require_user)) -> UserContext:
        role = get_role(user.role_name)
        if not getattr(role, cap, False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role `{user.role_name}` lacks capability `{cap}`.",
            )
        return user
    return _dep
