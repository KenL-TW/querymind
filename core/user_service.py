"""
User & API-Key service.

Responsibilities:
- CRUD on `qm_users` and `qm_api_keys`
- Hashed-key validation → returns UserContext
- Bootstrapping a default owner account from environment settings
- Resolving allowed-connections from a comma-separated DB field
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from passlib.context import CryptContext
from sqlalchemy.orm import sessionmaker

from core.rbac import UserContext, get_role
from storage.metadata_db import ApiKey, Invitation, RefreshToken, SystemConfig, User

logger = logging.getLogger(__name__)
_PWD_CTX = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _generate_key() -> str:
    return "qm_" + secrets.token_urlsafe(32)


class UserService:
    def __init__(self, session_factory: sessionmaker):
        self._sf = session_factory

    # ── Bootstrap ────────────────────────────────────────────────────────────

    def ensure_owner(self, email: str, raw_api_key: str) -> None:
        """Create an owner account + API key if none exists.

        Idempotent: re-running with the same key is a no-op."""
        if not email or not raw_api_key:
            return
        with self._sf() as s:
            user = s.query(User).filter(User.email == email).one_or_none()
            if not user:
                user = User(email=email, display_name="Owner", role="owner")
                s.add(user)
                s.flush()
                logger.info("Bootstrapped owner user: %s", email)
            elif user.role != "owner":
                user.role = "owner"

            if not user.password_hash:
                user.invite_pending = True

            kh = _hash_key(raw_api_key)
            existing = s.query(ApiKey).filter(ApiKey.key_hash == kh).one_or_none()
            if not existing:
                s.add(ApiKey(
                    user_id=user.id,
                    key_hash=kh,
                    key_prefix=raw_api_key[:8],
                    label="bootstrap",
                ))
                logger.info("Bootstrapped owner API key prefix=%s", raw_api_key[:8])
            s.commit()

    # ── Auth ─────────────────────────────────────────────────────────────────

    def authenticate(self, raw_api_key: str) -> Optional[UserContext]:
        """Look up the key. Returns UserContext or None if invalid/inactive."""
        if not raw_api_key:
            return None
        kh = _hash_key(raw_api_key)
        with self._sf() as s:
            row = s.query(ApiKey, User).join(User, ApiKey.user_id == User.id) \
                .filter(ApiKey.key_hash == kh,
                        ApiKey.is_active.is_(True),
                        User.is_active.is_(True)).one_or_none()
            if not row:
                return None
            api_key, user = row
            api_key.last_used_at = datetime.now(timezone.utc)
            s.commit()
            allowed = [c.strip() for c in (user.allowed_conns or "").split(",") if c.strip()]
            return UserContext(
                user_id=str(user.id),
                email=user.email,
                display_name=user.display_name or "",
                role_name=user.role,
                allowed_conns=allowed,
                api_key_prefix=api_key.key_prefix,
            )

    def authenticate_password(self, email: str, password: str) -> Optional[UserContext]:
        if not email or not password:
            return None
        with self._sf() as s:
            user = s.query(User).filter(User.email == email, User.is_active.is_(True)).one_or_none()
            if not user or not user.password_hash or not _PWD_CTX.verify(password, user.password_hash):
                return None
            allowed = [c.strip() for c in (user.allowed_conns or "").split(",") if c.strip()]
            return UserContext(
                user_id=str(user.id),
                email=user.email,
                display_name=user.display_name or "",
                role_name=user.role,
                allowed_conns=allowed,
                api_key_prefix="jwt",
            )

    def get_user_context(self, user_id: int) -> Optional[UserContext]:
        with self._sf() as s:
            user = s.get(User, user_id)
            if not user or not user.is_active:
                return None
            allowed = [c.strip() for c in (user.allowed_conns or "").split(",") if c.strip()]
            return UserContext(
                user_id=str(user.id),
                email=user.email,
                display_name=user.display_name or "",
                role_name=user.role,
                allowed_conns=allowed,
                api_key_prefix="jwt",
            )

    # ── User CRUD ────────────────────────────────────────────────────────────

    def list_users(self) -> list[dict]:
        with self._sf() as s:
            users = s.query(User).order_by(User.created_at.asc()).all()
            return [self._user_dict(u) for u in users]

    def get_user(self, user_id: int) -> Optional[dict]:
        with self._sf() as s:
            u = s.get(User, user_id)
            return self._user_dict(u) if u else None

    def create_user(self, email: str, role: str = "viewer",
                    display_name: str = "", allowed_conns: list[str] | None = None,
                    initial_password: str | None = None,
                    invited_by_id: int | None = None) -> dict:
        get_role(role)  # validates
        with self._sf() as s:
            if s.query(User).filter(User.email == email).one_or_none():
                raise ValueError(f"User with email '{email}' already exists.")
            u = User(
                email=email,
                role=role,
                display_name=display_name,
                allowed_conns=",".join(allowed_conns or []),
            )
            if initial_password:
                u.password_hash = _PWD_CTX.hash(initial_password)
                u.invite_pending = False
            s.add(u); s.commit(); s.refresh(u)
            result = self._user_dict(u)

        if not initial_password and invited_by_id is not None:
            # Auto-generate a 7-day invitation so the user can set their password
            try:
                raw_token, inv = self.create_invitation(
                    email=email,
                    role=role,
                    invited_by_id=invited_by_id,
                    allowed_conns=allowed_conns,
                    expires_hours=168,
                )
                result["invite_token"] = raw_token
                result["invite_expires_at"] = inv.get("expires_at")
            except Exception:
                logger.exception("Auto-invite failed for new user %s", email)

        return result

    def update_user(self, user_id: int, *,
                    role: str | None = None,
                    display_name: str | None = None,
                    allowed_conns: list[str] | None = None,
                    is_active: bool | None = None) -> Optional[dict]:
        with self._sf() as s:
            u = s.get(User, user_id)
            if not u:
                return None
            if role is not None:
                get_role(role)  # validates
                u.role = role
            if display_name is not None:
                u.display_name = display_name
            if allowed_conns is not None:
                u.allowed_conns = ",".join(allowed_conns)
            if is_active is not None:
                u.is_active = is_active
            s.commit(); s.refresh(u)
            return self._user_dict(u)

    def delete_user(self, user_id: int) -> bool:
        with self._sf() as s:
            u = s.get(User, user_id)
            if not u:
                return False
            # Cascade keys
            s.query(ApiKey).filter(ApiKey.user_id == user_id).delete()
            s.delete(u); s.commit()
            return True

    # ── Key CRUD ─────────────────────────────────────────────────────────────

    def list_keys(self, user_id: int) -> list[dict]:
        with self._sf() as s:
            keys = s.query(ApiKey).filter(ApiKey.user_id == user_id) \
                .order_by(ApiKey.created_at.asc()).all()
            return [self._key_dict(k) for k in keys]

    def issue_key(self, user_id: int, label: str = "") -> tuple[str, dict]:
        """Generate a fresh key. Returns (raw_key, key_record).

        The raw key is shown only once — only its hash is stored.
        """
        raw = _generate_key()
        with self._sf() as s:
            if not s.get(User, user_id):
                raise ValueError(f"User {user_id} not found.")
            k = ApiKey(
                user_id=user_id,
                key_hash=_hash_key(raw),
                key_prefix=raw[:8],
                label=label or "api-key",
            )
            s.add(k); s.commit(); s.refresh(k)
            return raw, self._key_dict(k)

    def revoke_key(self, key_id: int) -> bool:
        with self._sf() as s:
            k = s.get(ApiKey, key_id)
            if not k:
                return False
            k.is_active = False
            s.commit()
            return True

    # ── Passwords ────────────────────────────────────────────────────────────

    def set_password(self, user_id: int, password: str) -> bool:
        if not password:
            return False
        with self._sf() as s:
            u = s.get(User, user_id)
            if not u:
                return False
            u.password_hash = _PWD_CTX.hash(password)
            u.invite_pending = False
            s.commit()
            return True

    def change_password(self, user_id: int, current_password: str, new_password: str) -> bool:
        if not new_password:
            return False
        with self._sf() as s:
            u = s.get(User, user_id)
            if not u or not u.password_hash:
                return False
            if not _PWD_CTX.verify(current_password, u.password_hash):
                return False
            u.password_hash = _PWD_CTX.hash(new_password)
            u.invite_pending = False
            s.commit()
            return True

    # ── JWT refresh token persistence ───────────────────────────────────────

    def save_refresh_token(self, user_id: int, raw_token: str, expires_at: datetime) -> None:
        with self._sf() as s:
            s.add(RefreshToken(
                user_id=user_id,
                token_hash=_hash_key(raw_token),
                expires_at=expires_at,
            ))
            s.commit()

    def validate_refresh_token(self, raw_token: str) -> Optional[int]:
        with self._sf() as s:
            rec = s.query(RefreshToken).filter(
                RefreshToken.token_hash == _hash_key(raw_token),
                RefreshToken.revoked.is_(False),
            ).one_or_none()
            if not rec:
                return None
            now = datetime.now(timezone.utc)
            exp = rec.expires_at
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp <= now:
                return None
            return rec.user_id

    def revoke_refresh_token(self, raw_token: str) -> bool:
        with self._sf() as s:
            rec = s.query(RefreshToken).filter(
                RefreshToken.token_hash == _hash_key(raw_token),
                RefreshToken.revoked.is_(False),
            ).one_or_none()
            if not rec:
                return False
            rec.revoked = True
            s.commit()
            return True

    # ── Invitations ──────────────────────────────────────────────────────────

    def create_invitation(
        self,
        *,
        email: str,
        role: str,
        invited_by_id: int,
        allowed_conns: list[str] | None = None,
        expires_hours: int = 72,
    ) -> tuple[str, dict]:
        get_role(role)
        raw = "inv_" + secrets.token_urlsafe(32)
        exp = datetime.now(timezone.utc) + timedelta(hours=expires_hours)
        with self._sf() as s:
            inv = Invitation(
                email=email,
                role=role,
                invited_by_id=invited_by_id,
                allowed_conns=",".join(allowed_conns or []),
                token_hash=_hash_key(raw),
                expires_at=exp,
            )
            s.add(inv)
            s.commit()
            s.refresh(inv)
            return raw, self._inv_dict(inv)

    def list_invitations(self) -> list[dict]:
        with self._sf() as s:
            rows = s.query(Invitation).order_by(Invitation.created_at.desc()).all()
            return [self._inv_dict(r) for r in rows]

    def preview_invitation(self, token: str) -> dict:
        now = datetime.now(timezone.utc)
        with self._sf() as s:
            inv = s.query(Invitation).filter(Invitation.token_hash == _hash_key(token)).one_or_none()
            if not inv:
                return {"valid": False, "reason": "not_found"}
            exp = inv.expires_at
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if inv.revoked:
                return {"valid": False, "reason": "revoked"}
            if inv.used_at is not None:
                return {"valid": False, "reason": "used"}
            if exp <= now:
                return {"valid": False, "reason": "expired", "expires_at": inv.expires_at.isoformat()}
            return {
                "valid": True,
                "email": inv.email,
                "role": inv.role,
                "allowed_conns": [c for c in (inv.allowed_conns or "").split(",") if c],
                "expires_at": inv.expires_at.isoformat() if inv.expires_at else None,
            }

    def revoke_invitation(self, invitation_id: int) -> bool:
        with self._sf() as s:
            inv = s.get(Invitation, invitation_id)
            if not inv:
                return False
            inv.revoked = True
            s.commit()
            return True

    def accept_invitation(self, token: str, password: str, display_name: str = "") -> Optional[dict]:
        now = datetime.now(timezone.utc)
        with self._sf() as s:
            inv = s.query(Invitation).filter(
                Invitation.token_hash == _hash_key(token),
                Invitation.revoked.is_(False),
                Invitation.used_at.is_(None),
            ).one_or_none()
            if not inv:
                return None
            exp = inv.expires_at
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp <= now:
                return None

            user = s.query(User).filter(User.email == inv.email).one_or_none()
            if not user:
                user = User(
                    email=inv.email,
                    role=inv.role,
                    display_name=display_name,
                    allowed_conns=inv.allowed_conns,
                    is_active=True,
                )
                s.add(user)
                s.flush()
            else:
                user.role = inv.role
                if display_name:
                    user.display_name = display_name
                user.allowed_conns = inv.allowed_conns
                user.is_active = True

            user.password_hash = _PWD_CTX.hash(password)
            user.invite_pending = False
            inv.used_at = now
            s.commit()
            return self._user_dict(user)

    # ── First-run state ──────────────────────────────────────────────────────

    def is_first_run_pending(self) -> bool:
        with self._sf() as s:
            cfg = s.query(SystemConfig).filter(SystemConfig.key == "first_run_complete").one_or_none()
            if cfg and cfg.value == "true":
                return False
            owner = s.query(User).filter(User.role == "owner", User.is_active.is_(True)).first()
            if not owner:
                return True
            return bool(owner.invite_pending)

    def mark_setup_complete(self) -> None:
        with self._sf() as s:
            cfg = s.query(SystemConfig).filter(SystemConfig.key == "first_run_complete").one_or_none()
            if not cfg:
                cfg = SystemConfig(key="first_run_complete", value="true")
                s.add(cfg)
            else:
                cfg.value = "true"
            s.commit()

    def setup_owner_account(self, email: str, password: str, display_name: str = "Owner") -> Optional[dict]:
        with self._sf() as s:
            owner = s.query(User).filter(User.role == "owner").order_by(User.id.asc()).first()
            if not owner:
                owner = User(email=email, role="owner", is_active=True)
                s.add(owner)
                s.flush()
            owner.email = email
            owner.display_name = display_name
            owner.password_hash = _PWD_CTX.hash(password)
            owner.invite_pending = False
            owner.is_active = True
            s.commit()
            s.refresh(owner)
            result = self._user_dict(owner)
        self.mark_setup_complete()
        return result

    # ── Mappers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _user_dict(u: User) -> dict:
        return {
            "id": u.id,
            "email": u.email,
            "display_name": u.display_name,
            "role": u.role,
            "allowed_conns": [c for c in (u.allowed_conns or "").split(",") if c],
            "invite_pending": u.invite_pending,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }

    @staticmethod
    def _key_dict(k: ApiKey) -> dict:
        return {
            "id": k.id,
            "user_id": k.user_id,
            "prefix": k.key_prefix,
            "label": k.label,
            "is_active": k.is_active,
            "created_at": k.created_at.isoformat() if k.created_at else None,
            "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
        }

    @staticmethod
    def _inv_dict(inv: Invitation) -> dict:
        return {
            "id": inv.id,
            "email": inv.email,
            "role": inv.role,
            "invited_by_id": inv.invited_by_id,
            "allowed_conns": [c for c in (inv.allowed_conns or "").split(",") if c],
            "expires_at": inv.expires_at.isoformat() if inv.expires_at else None,
            "used_at": inv.used_at.isoformat() if inv.used_at else None,
            "revoked": inv.revoked,
            "created_at": inv.created_at.isoformat() if inv.created_at else None,
        }
