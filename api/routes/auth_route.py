from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from api.auth import require_user
from config.settings import settings
from core.jwt_utils import TokenError, create_access_token, create_refresh_token, decode_token
from core.rbac import UserContext

router = APIRouter(prefix="/v1/auth", tags=["auth"])


def _audit(request: Request, event_type: str, *, status_: str = "success", **kw) -> None:
    """Emit an auth-flow audit entry. Never raises."""
    al = getattr(request.app.state, "audit_logger", None)
    if al is None:
        # main.py stores audit_logger in app_state, not app.state — fall back
        try:
            from api.main import app_state
            al = app_state.get("audit_logger")
        except Exception:
            al = None
    if al is None:
        return
    try:
        al.log(event_type, status=status_, **kw)
    except Exception:
        pass


def _client_prefix(request: Request, user_id: str | int | None = None, email: str = "") -> str:
    from api.audit import actor_prefix_for_user
    return actor_prefix_for_user(user_id, email)


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenRefreshRequest(BaseModel):
    refresh_token: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)


class AcceptInviteRequest(BaseModel):
    token: str
    password: str = Field(..., min_length=8)
    display_name: str = ""


class FirstRunSetupRequest(BaseModel):
    new_email: str
    new_password: str = Field(..., min_length=8)
    display_name: str = "Owner"


def _svc(request: Request):
    svc = getattr(request.app.state, "user_service", None)
    if svc is None:
        raise HTTPException(status_code=503, detail="UserService not initialised.")
    return svc


def _set_refresh_cookie(response: Response, refresh_token: str, max_age_seconds: int) -> None:
    """Set the HttpOnly refresh-token cookie so SPA 不需要把 token 存進 localStorage。"""
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=refresh_token,
        max_age=max_age_seconds,
        httponly=True,
        secure=settings.refresh_cookie_secure,
        samesite=settings.refresh_cookie_samesite,
        domain=settings.refresh_cookie_domain,
        path="/",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        path="/",
        domain=settings.refresh_cookie_domain,
    )


@router.post("/login")
async def login(payload: LoginRequest, request: Request, response: Response):
    user = _svc(request).authenticate_password(payload.email, payload.password)
    if user is None:
        _audit(request, "auth.login", status_="error",
               api_key_prefix=_client_prefix(request, email=payload.email),
               detail=payload.email, error_msg="invalid credentials")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="帳號或密碼錯誤。")

    access, access_exp = create_access_token(
        user_id=user.user_id,
        email=user.email,
        role=user.role_name,
    )
    refresh, refresh_exp = create_refresh_token(user_id=user.user_id)
    _svc(request).save_refresh_token(int(user.user_id), refresh, refresh_exp)
    _set_refresh_cookie(response, refresh, settings.jwt_refresh_expire_days * 86400)
    _audit(request, "auth.login", status_="success",
           api_key_prefix=_client_prefix(request, user_id=user.user_id, email=user.email),
           detail=f"role={user.role_name}")

    return {
        "token_type": "bearer",
        "access_token": access,
        "access_token_expires_at": access_exp.isoformat(),
        "refresh_token": refresh,
        "refresh_token_expires_at": refresh_exp.isoformat(),
        "user": user.to_dict(),
    }


@router.post("/refresh")
async def refresh(
    request: Request,
    response: Response,
    payload: TokenRefreshRequest | None = None,
    qm_refresh: str | None = Cookie(default=None),
):
    # 順序：body.refresh_token → cookie
    body_token = payload.refresh_token if payload else None
    token = body_token or qm_refresh
    if not token:
        raise HTTPException(status_code=401, detail="缺少 refresh token。")

    try:
        claims = decode_token(token, expected_type="refresh")
    except TokenError:
        raise HTTPException(status_code=401, detail="Refresh token 無效。")

    user_id = _svc(request).validate_refresh_token(token)
    if not user_id or str(user_id) != str(claims.get("sub", "")):
        _audit(request, "auth.refresh", status_="error",
               api_key_prefix=_client_prefix(request, user_id=claims.get("sub")),
               error_msg="refresh token revoked or mismatched sub")
        raise HTTPException(status_code=401, detail="Refresh token 已失效。")

    user = _svc(request).get_user_context(user_id)
    if not user:
        _audit(request, "auth.refresh", status_="error",
               api_key_prefix=_client_prefix(request, user_id=user_id),
               error_msg="user not found or inactive")
        raise HTTPException(status_code=401, detail="使用者不存在或已停用。")

    access, access_exp = create_access_token(
        user_id=user.user_id,
        email=user.email,
        role=user.role_name,
    )
    _audit(request, "auth.refresh", status_="success",
           api_key_prefix=_client_prefix(request, user_id=user.user_id, email=user.email))
    return {
        "token_type": "bearer",
        "access_token": access,
        "access_token_expires_at": access_exp.isoformat(),
    }


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    payload: TokenRefreshRequest | None = None,
    qm_refresh: str | None = Cookie(default=None),
):
    token = (payload.refresh_token if payload else None) or qm_refresh
    revoked = False
    actor_uid: str | int | None = None
    if token:
        try:
            claims = decode_token(token, expected_type="refresh")
            actor_uid = claims.get("sub")
        except TokenError:
            pass
        revoked = _svc(request).revoke_refresh_token(token)
    _clear_refresh_cookie(response)
    _audit(request, "auth.logout", status_="success",
           api_key_prefix=_client_prefix(request, user_id=actor_uid),
           detail=f"revoked={revoked}")
    return {"ok": True}


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    user: UserContext = Depends(require_user),
):
    ok = _svc(request).change_password(int(user.user_id), payload.current_password, payload.new_password)
    if not ok:
        raise HTTPException(status_code=400, detail="目前密碼錯誤或更新失敗。")
    return {"ok": True}


@router.post("/accept-invite")
async def accept_invite(payload: AcceptInviteRequest, request: Request, response: Response):
    u = _svc(request).accept_invitation(
        token=payload.token,
        password=payload.password,
        display_name=payload.display_name,
    )
    if not u:
        _audit(request, "auth.accept_invite", status_="error",
               api_key_prefix="anon",
               error_msg="invitation invalid/expired/used")
        raise HTTPException(status_code=400, detail="邀請不存在、已過期或已使用。")

    user = _svc(request).authenticate_password(u["email"], payload.password)
    if not user:
        raise HTTPException(status_code=500, detail="邀請接受成功但登入失敗。")

    access, access_exp = create_access_token(
        user_id=user.user_id,
        email=user.email,
        role=user.role_name,
    )
    refresh, refresh_exp = create_refresh_token(user_id=user.user_id)
    _svc(request).save_refresh_token(int(user.user_id), refresh, refresh_exp)
    _set_refresh_cookie(response, refresh, settings.jwt_refresh_expire_days * 86400)
    _audit(request, "auth.accept_invite", status_="success",
           api_key_prefix=_client_prefix(request, user_id=user.user_id, email=user.email),
           detail=f"role={user.role_name}")

    return {
        "token_type": "bearer",
        "access_token": access,
        "access_token_expires_at": access_exp.isoformat(),
        "refresh_token": refresh,
        "refresh_token_expires_at": refresh_exp.isoformat(),
        "user": user.to_dict(),
    }


@router.get("/invite/{token}")
async def preview_invite(token: str, request: Request):
    preview = _svc(request).preview_invitation(token)
    if not preview.get("valid"):
        _audit(request, "auth.preview_invite", status_="error",
               api_key_prefix="anon", detail=str(preview.get("reason") or "invalid"))
        raise HTTPException(status_code=404, detail="邀請不存在、已過期或已使用。")
    _audit(request, "auth.preview_invite", status_="success",
           api_key_prefix="anon", detail=f"role={preview.get('role')}")
    return preview


@router.post("/first-run/setup")
async def first_run_setup(payload: FirstRunSetupRequest, request: Request, response: Response):
    svc = _svc(request)
    if not svc.is_first_run_pending():
        raise HTTPException(status_code=409, detail="初始設定已完成。")

    owner = svc.setup_owner_account(
        email=payload.new_email,
        password=payload.new_password,
        display_name=payload.display_name,
    )
    if not owner:
        raise HTTPException(status_code=500, detail="初始設定失敗。")

    user = svc.authenticate_password(payload.new_email, payload.new_password)
    if not user:
        raise HTTPException(status_code=500, detail="初始設定成功但登入失敗。")

    access, access_exp = create_access_token(
        user_id=user.user_id,
        email=user.email,
        role=user.role_name,
    )
    refresh, refresh_exp = create_refresh_token(user_id=user.user_id)
    svc.save_refresh_token(int(user.user_id), refresh, refresh_exp)
    _set_refresh_cookie(response, refresh, settings.jwt_refresh_expire_days * 86400)
    _audit(request, "auth.first_run_setup", status_="success",
           api_key_prefix=_client_prefix(request, user_id=user.user_id, email=user.email),
           detail=f"role={user.role_name}")

    return {
        "first_run_pending": False,
        "token_type": "bearer",
        "access_token": access,
        "access_token_expires_at": access_exp.isoformat(),
        "refresh_token": refresh,
        "refresh_token_expires_at": refresh_exp.isoformat(),
        "user": user.to_dict(),
    }
