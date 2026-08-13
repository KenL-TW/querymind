from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


class CodeMetadata(Base):
    """Stores metadata for archived ETL scripts."""

    __tablename__ = "qm_code_metadata"

    id = Column(Integer, primary_key=True, autoincrement=True)
    schema_name = Column(String(128), nullable=False, index=True)
    table_name = Column(String(128), nullable=False, index=True)
    file_path = Column(String(512), nullable=False)   # original source file
    storage_key = Column(String(512), nullable=False)  # key in StorageAdapter
    description = Column(Text, default="")
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class ScheduleRecord(Base):
    """Stores schedule task metadata."""

    __tablename__ = "qm_schedule_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    schedule_id = Column(String(256), unique=True, nullable=False)
    name = Column(String(256), nullable=False)
    cron_expression = Column(String(128), nullable=False)
    target = Column(String(512), nullable=False)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class AuditLog(Base):
    """Immutable audit trail for every agent invocation and tool call."""

    __tablename__ = "qm_audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Who & where
    session_id = Column(String(256), nullable=True, index=True)
    api_key_prefix = Column(String(16), nullable=True)   # first 8 chars, for correlation
    # What happened
    event_type = Column(String(64), nullable=False, index=True)   # agent_invoke | tool_call | error
    tool_name = Column(String(128), nullable=True)
    conn_name = Column(String(128), nullable=True)
    detail = Column(Text, nullable=True)        # SQL text or tool input (truncated to 4000 chars)
    # Outcome
    status = Column(String(32), nullable=False, default="success")   # success | error
    duration_ms = Column(Integer, nullable=True)
    error_msg = Column(Text, nullable=True)
    # Who triggered (user_id from qm_users; nullable for API-key-only flows)
    user_id = Column(Integer, nullable=True, index=True)
    # Token usage (populated by chat/agent flows; NULL for non-LLM events)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    model_name = Column(String(128), nullable=True, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)


class User(Base):
    """Application user. One user can have multiple API keys."""

    __tablename__ = "qm_users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(256), unique=True, nullable=False, index=True)
    display_name = Column(String(128), default="")
    role = Column(String(32), nullable=False, default="viewer")   # rbac role name
    allowed_conns = Column(Text, default="")     # comma-separated, empty = all
    password_hash = Column(String(255), nullable=True)
    invite_pending = Column(Boolean, default=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class ApiKey(Base):
    """Issued API keys. The raw key value is stored hashed (SHA-256 hex)."""

    __tablename__ = "qm_api_keys"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    key_hash = Column(String(128), unique=True, nullable=False, index=True)
    key_prefix = Column(String(16), nullable=False)   # first 8 chars of raw key, for display
    label = Column(String(128), default="")
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_used_at = Column(DateTime, nullable=True)


class RefreshToken(Base):
    """Refresh tokens for JWT session rotation (stored hashed)."""

    __tablename__ = "qm_refresh_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("qm_users.id"), nullable=False, index=True)
    token_hash = Column(String(128), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    revoked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Invitation(Base):
    """Invitations for onboarding users with role + password setup."""

    __tablename__ = "qm_invitations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(256), nullable=False, index=True)
    role = Column(String(32), nullable=False, default="viewer")
    invited_by_id = Column(Integer, ForeignKey("qm_users.id"), nullable=False)
    allowed_conns = Column(Text, default="")
    token_hash = Column(String(128), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    used_at = Column(DateTime, nullable=True)
    revoked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class SessionMeta(Base):
    """Per-session metadata: title, summary, ownership, pin/archive state."""

    __tablename__ = "qm_session_meta"

    session_id = Column(String(256), primary_key=True)
    title = Column(String(200), default="", nullable=False, server_default="")
    summary = Column(Text, default="", nullable=False, server_default="")
    entities = Column(Text, default="", nullable=False, server_default="")  # JSON array
    owner_user_id = Column(Integer, nullable=True, index=True)
    pinned = Column(Boolean, default=False, nullable=False)
    archived = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class UserTemplate(Base):
    """User-created question templates stored in DB (supplements built-in ones in core/templates.py)."""

    __tablename__ = "qm_user_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_user_id = Column(Integer, nullable=True, index=True)  # NULL = system-wide
    title = Column(String(256), nullable=False)
    icon = Column(String(16), default="📌")
    category = Column(String(64), nullable=False, default="自訂")
    prompt = Column(Text, nullable=False)
    description = Column(Text, default="")
    roles = Column(String(256), default="*")  # comma-separated or "*"
    metric_ids = Column(Text, default="")      # comma-separated semantic metric ids
    query_plan = Column(Text, default="")      # JSON QueryPlan payload
    chart_config = Column(Text, default="")    # JSON chart defaults
    is_public = Column(Boolean, default=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class SystemConfig(Base):
    """Simple key/value settings persisted in metadata DB."""

    __tablename__ = "qm_system_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(128), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=False, default="")
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class SavedInsight(Base):
    """User-saved SQL / chart / answer for later reuse."""

    __tablename__ = "qm_saved_insights"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_user_id = Column(Integer, nullable=True, index=True)
    title = Column(String(256), nullable=False, default="")
    description = Column(Text, default="")
    kind = Column(String(16), nullable=False, default="sql")  # sql | chart | answer
    conn_name = Column(String(128), nullable=True)
    sql = Column(Text, default="")
    chart_config = Column(Text, default="")   # JSON string
    tags = Column(String(512), default="")    # comma-separated
    pinned = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


def init_metadata_db(db_url: str) -> sessionmaker:
    """Create tables and return a session factory."""
    engine = create_engine(db_url)
    Base.metadata.create_all(engine)

    # Backfill legacy qm_session_meta tables created before newer metadata fields existed.
    # create_all() does not ALTER existing tables, so we ensure expected columns explicitly.
    with engine.begin() as conn:
        conn.execute(text("""
            ALTER TABLE IF EXISTS qm_session_meta
            ADD COLUMN IF NOT EXISTS title VARCHAR(200) NOT NULL DEFAULT ''
        """))
        conn.execute(text("""
            ALTER TABLE IF EXISTS qm_session_meta
            ADD COLUMN IF NOT EXISTS summary TEXT NOT NULL DEFAULT ''
        """))
        conn.execute(text("""
            ALTER TABLE IF EXISTS qm_session_meta
            ADD COLUMN IF NOT EXISTS entities TEXT NOT NULL DEFAULT ''
        """))
        conn.execute(text("""
            ALTER TABLE IF EXISTS qm_session_meta
            ADD COLUMN IF NOT EXISTS owner_user_id INTEGER
        """))
        conn.execute(text("""
            ALTER TABLE IF EXISTS qm_session_meta
            ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE
        """))
        conn.execute(text("""
            ALTER TABLE IF EXISTS qm_session_meta
            ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE
        """))
        conn.execute(text("""
            ALTER TABLE IF EXISTS qm_session_meta
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
        """))
        conn.execute(text("""
            ALTER TABLE IF EXISTS qm_session_meta
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_qm_session_meta_owner_user_id
            ON qm_session_meta (owner_user_id)
        """))
        # qm_user_templates backfill (added with template CRUD feature)
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS qm_user_templates (
                id SERIAL PRIMARY KEY,
                owner_user_id INTEGER,
                title VARCHAR(256) NOT NULL,
                icon VARCHAR(16) DEFAULT '',
                category VARCHAR(64) NOT NULL DEFAULT '',
                prompt TEXT NOT NULL DEFAULT '',
                description TEXT DEFAULT '',
                roles VARCHAR(256) DEFAULT '*',
                metric_ids TEXT DEFAULT '',
                query_plan TEXT DEFAULT '',
                chart_config TEXT DEFAULT '',
                is_public BOOLEAN NOT NULL DEFAULT TRUE,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.execute(text("""
            ALTER TABLE IF EXISTS qm_user_templates
            ADD COLUMN IF NOT EXISTS metric_ids TEXT DEFAULT ''
        """))
        conn.execute(text("""
            ALTER TABLE IF EXISTS qm_user_templates
            ADD COLUMN IF NOT EXISTS query_plan TEXT DEFAULT ''
        """))
        conn.execute(text("""
            ALTER TABLE IF EXISTS qm_user_templates
            ADD COLUMN IF NOT EXISTS chart_config TEXT DEFAULT ''
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_qm_user_templates_owner
            ON qm_user_templates (owner_user_id)
        """))

    logger.info("Metadata DB initialised", extra={"url": db_url.split("@")[-1]})
    return sessionmaker(bind=engine)
