from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from adapters.scheduler.apscheduler_adapter import APSchedulerAdapter
from adapters.storage.local_adapter import LocalStorageAdapter
from adapters.storage.s3_adapter import S3StorageAdapter
from api.audit import AuditLogger
from config.logging import configure_logging
from config.settings import settings
from core.agent import build_agent
from core.connection_manager import (
    active_connection_urls,
    load_workspace_connections,
    merged_connection_definitions,
)
from core.llm_factory import LLMFactory
from core.memory import SessionMemoryManager
from core.semantic_layer import build_semantic_brief
from core.system_prompt import build_schema_brief, build_system_prompt
from core.user_service import UserService
from db.registry import ConnectionRegistry
from storage.code_archive import CodeArchive
from storage.metadata_db import init_metadata_db
from tools import get_all_tools

logger = logging.getLogger(__name__)

# Shared application state (registry, executor, etc.)
app_state: dict[str, Any] = {}


def _build_scheduler(registry: ConnectionRegistry, session_factory):
    backend = settings.scheduler_backend.strip().lower()
    if backend == "apscheduler":
        return APSchedulerAdapter(registry=registry, session_factory=session_factory)
    if backend == "eventbridge":
        if not settings.aws_eventbridge_role_arn:
            raise RuntimeError("AWS_EVENTBRIDGE_ROLE_ARN is required when SCHEDULER_BACKEND=eventbridge")
        from adapters.scheduler.eventbridge_adapter import EventBridgeAdapter

        return EventBridgeAdapter(
            region=settings.aws_region or "ap-northeast-1",
            role_arn=settings.aws_eventbridge_role_arn,
        )
    raise RuntimeError(f"Unsupported SCHEDULER_BACKEND: {settings.scheduler_backend}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(settings.environment)

    # --- Metadata DB ---
    session_factory = init_metadata_db(settings.metadata_db_url)
    app_state["session_factory"] = session_factory
    app.state.session_factory = session_factory

    # --- DB Registry ---
    workspace_connections = load_workspace_connections(session_factory)
    connection_definitions = merged_connection_definitions(
        settings.db_connections_dict,
        workspace_connections,
        settings.environment,
    )
    registry = ConnectionRegistry.from_config(active_connection_urls(connection_definitions))
    app_state["registry"] = registry
    app_state["connection_definitions"] = connection_definitions
    app_state["workspace_connections"] = workspace_connections

    # --- Storage Adapter ---
    if settings.storage_backend == "s3":
        storage = S3StorageAdapter(
            bucket=settings.aws_s3_bucket or "",
            prefix="querymind/archive",
            region=settings.aws_region or "ap-northeast-1",
        )
    else:
        storage = LocalStorageAdapter(settings.local_storage_path)
    app_state["storage"] = storage

    # --- Code Archive ---
    archive = CodeArchive(storage, session_factory)
    app_state["archive"] = archive

    # --- User Service (auth / API-key validation) ---
    user_svc = UserService(session_factory)
    user_svc.ensure_owner(settings.default_owner_email, settings.default_owner_api_key)
    app_state["user_service"] = user_svc
    app.state.user_service = user_svc

    # --- Audit Logger ---
    audit_logger = AuditLogger(session_factory)
    app_state["audit_logger"] = audit_logger
    app.state.audit_logger = audit_logger

    # --- Scheduler ---
    scheduler = _build_scheduler(registry, session_factory)
    app_state["scheduler"] = scheduler

    # --- LLM + Tools + Agent ---
    llm = LLMFactory.create(settings)
    app_state["llm"] = llm
    app.state.llm = llm
    tools = get_all_tools(registry, storage, archive, scheduler)
    system_prompt = build_system_prompt(
        registry.list_connections(),
        schema_brief=build_schema_brief(registry),
        glossary_brief=build_semantic_brief(),
    )
    agent = build_agent(tools, llm, system_prompt, verbose=(settings.environment == "local"))
    app_state["agent"] = agent
    app_state["session_factory"] = session_factory
    app.state.session_factory = session_factory

    # --- Session Memory Manager ---
    session_manager = SessionMemoryManager(
        metadata_db_url=settings.metadata_db_url,
        max_window_turns=settings.memory_window_turns,
    )
    app_state["session_manager"] = session_manager

    logger.info("QueryMind API started", extra={"env": settings.environment})
    yield

    logger.info("QueryMind API shutting down")


def create_app() -> FastAPI:
    app = FastAPI(
        title="QueryMind API",
        version="0.1.0",
        description="AI-powered database agent",
        lifespan=lifespan,
    )

    # ── Rate limiting ────────────────────────────────────────────────────────
    from api.rate_limit import limiter
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    # ── CORS ──────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*", "X-API-Key"],
    )

    from api.routes.admin import me_router, router as admin_router
    from api.routes.auth_route import router as auth_router
    from api.routes.chat import router as chat_router
    from api.routes.connections import admin_router as admin_connections_router, router as connections_router
    from api.routes.export import router as export_router
    from api.routes.health import router as health_router
    from api.routes.import_route import router as import_router
    from api.routes.dictionary import router as dictionary_router
    from api.routes.insights import router as insights_router
    from api.routes.schema import router as schema_router
    from api.routes.sessions import router as sessions_router
    from api.routes.semantic import router as semantic_router
    from api.routes.templates import router as templates_router

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(admin_router)
    app.include_router(me_router)
    app.include_router(chat_router)
    app.include_router(sessions_router)
    app.include_router(semantic_router)
    app.include_router(connections_router)
    app.include_router(admin_connections_router)
    app.include_router(schema_router)
    app.include_router(export_router)
    app.include_router(import_router)
    app.include_router(insights_router)
    app.include_router(templates_router)
    app.include_router(dictionary_router)

    return app


app = create_app()
