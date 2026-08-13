from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from config.settings import settings


class TokenError(ValueError):
    pass


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(*, user_id: str, email: str, role: str) -> tuple[str, datetime]:
    exp = _utc_now() + timedelta(minutes=settings.jwt_access_expire_minutes)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "typ": "access",
        "exp": exp,
        "iat": _utc_now(),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm), exp


def create_refresh_token(*, user_id: str) -> tuple[str, datetime]:
    exp = _utc_now() + timedelta(days=settings.jwt_refresh_expire_days)
    payload = {
        "sub": user_id,
        "typ": "refresh",
        "jti": secrets.token_urlsafe(32),
        "exp": exp,
        "iat": _utc_now(),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm), exp


def decode_token(token: str, expected_type: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as e:
        raise TokenError("Invalid token") from e
    typ = str(payload.get("typ", ""))
    if typ != expected_type:
        raise TokenError(f"Unexpected token type: {typ}")
    return payload
