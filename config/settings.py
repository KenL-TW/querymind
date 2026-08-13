from __future__ import annotations

import json
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local", ".env.production"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Environment ──────────────────────────────────────────────────────────
    env: str = "local"
    environment: str = "local"  # alias used by API/infra layers

    # ── LLM ──────────────────────────────────────────────────────────────────
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    llm_provider: str = "openai"        # openai | anthropic | gemini | bedrock
    llm_temperature: float = 0.0
    llm_max_tokens: int = 2048
    llm_timeout: int = 120
    openai_max_retries: int = 6

    # Model routing: when enabled, short/simple turns use ``llm_model_cheap``
    # and long/complex (SQL keywords, multi-step) turns use ``llm_model_strong``.
    # Both default to ``openai_model`` so behaviour is unchanged unless explicitly set.
    llm_routing_enabled: bool = False
    llm_model_cheap: str = ""    # e.g. "gpt-4o-mini" / "gpt-4.1-mini"
    llm_model_strong: str = ""   # e.g. "gpt-4o" / "gpt-4.1"
    llm_routing_complex_threshold_chars: int = 240

    # ── DLP / PII masking ─────────────────────────────────────────────────────
    # When True, ``execute_query`` results are passed through ``core.dlp`` before
    # being returned. Set ``dlp_role_exempt="owner,admin"`` to let privileged
    # roles see raw data. Extend patterns via env var ``DLP_EXTRA_PATTERNS_JSON``.
    dlp_enabled: bool = False
    dlp_role_exempt: str = "owner"
    # B2B PoC safety default: keep DB Agent execution read-only unless an
    # operator explicitly enables write SQL in the environment.
    sql_write_execution_enabled: bool = False

    # ── DB Connections ────────────────────────────────────────────────────────
    # JSON string: {"conn_name": "sqlalchemy_conn_string", ...}
    db_connections: str = '{"default": "postgresql+psycopg2://qm_user:qm_pass@127.0.0.1:5432/querymind"}'
    metadata_db_url: str = "postgresql+psycopg2://qm_user:qm_pass@127.0.0.1:5432/querymind"

    # ── Storage ───────────────────────────────────────────────────────────────
    storage_backend: str = "local"          # local | s3
    local_storage_path: str = "./data/code_archive"

    # ── AWS ───────────────────────────────────────────────────────────────────
    aws_region: Optional[str] = None
    aws_s3_bucket: Optional[str] = None
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None

    # ── Scheduler ─────────────────────────────────────────────────────────────
    scheduler_backend: str = "apscheduler"  # apscheduler | eventbridge
    aws_eventbridge_role_arn: str = ""

    # ── Auth ──────────────────────────────────────────────────────────────────
    auth_enabled: bool = False  # set True in production
    # JSON map of  api_key -> role ("admin" | "readonly")
    # NOTE: deprecated in favour of qm_users + qm_api_keys tables (RBAC).
    # Still read for backward compatibility on first boot.
    api_keys: str = '{"dev-key-change-me": "admin"}'
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_expire_minutes: int = 60
    jwt_refresh_expire_days: int = 7

    # ── RBAC ──────────────────────────────────────────────────────────────────
    rbac_enabled: bool = True
    # Bootstrap owner account (auto-created on first start if missing)
    default_owner_email: str = "owner@local"
    default_owner_api_key: str = "qm_owner_dev_key_change_me"
    # When True, anonymous (auth-disabled) callers are treated as `owner`.
    # Set to "viewer" in a shared environment.
    anonymous_role: str = "owner"

    # ── CORS ──────────────────────────────────────────────────────────────────
    # JSON list of allowed origins. 不能用 ["*"] 搭配 cookie credentials，
    # 必須明確列出。Production 註明你的后台/前台網域。
    cors_origins: str = (
        '["http://localhost:3000","http://127.0.0.1:3000",'
        '"http://localhost:3001","http://127.0.0.1:3001",'
        '"http://localhost:8080","http://127.0.0.1:8080",'
        '"http://localhost:8101","http://127.0.0.1:8101"]'
    )

    # ── Refresh token cookie（完全可選，供前端 SPA 使用）──────────────────────
    refresh_cookie_name: str = "qm_refresh"
    refresh_cookie_secure: bool = False     # 上 HTTPS 註 production 説 True
    refresh_cookie_samesite: str = "lax"     # lax | strict | none
    refresh_cookie_domain: Optional[str] = None

    # ── Rate limiting ─────────────────────────────────────────────────────────
    rate_limit_enabled: bool = True
    rate_limit_chat: str = "30/minute"   # /v1/chat endpoints
    rate_limit_api: str = "120/minute"   # all other /v1/* endpoints

    # ── Memory / Retention ────────────────────────────────────────────────────
    memory_window_turns: int = 10        # number of Q&A turns kept in active context
    session_retention_days: int = 90     # messages older than this are pruned by /v1/sessions/prune

    # ── Query Result Cache ────────────────────────────────────────────────────
    # In-process TTL cache for SELECT query results.
    # Reduces repeated identical queries from the LLM agent hitting the DB.
    query_cache_enabled: bool = True
    query_cache_ttl_seconds: int = 120   # 2 minutes — balance freshness vs speed

    # ── API ───────────────────────────────────────────────────────────────────
    api_host: str = "0.0.0.0"
    api_port: int = 8101
    admin_portal_url: str = "http://localhost:3000"

    # ── Properties ───────────────────────────────────────────────────────────
    @property
    def db_connections_dict(self) -> dict[str, str]:
        return json.loads(self.db_connections)

    @property
    def api_keys_dict(self) -> dict[str, str]:
        """Return {api_key: role} mapping."""
        return json.loads(self.api_keys)

    @property
    def cors_origins_list(self) -> list[str]:
        """Parsed CORS allowed origins list."""
        return json.loads(self.cors_origins)

    @property
    def is_local(self) -> bool:
        return self.env == "local"


settings = Settings()
