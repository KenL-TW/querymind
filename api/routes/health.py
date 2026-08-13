from __future__ import annotations

import logging

from fastapi import APIRouter

from api.schemas import HealthResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])

VERSION = "0.1.0"


@router.get("/health", response_model=HealthResponse)
@router.get("/v1/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Health check endpoint.

    Available at both ``/health`` (used by container probes) and
    ``/v1/health`` (used by the frontend for backward-compat with older
    pages that haven't migrated to the RBAC-aware ``/v1/connections``).
    """
    from api.main import app_state

    registry = app_state.get("registry")
    connections = registry.list_connections() if registry else []
    user_service = app_state.get("user_service")
    first_run_pending = bool(user_service.is_first_run_pending()) if user_service else False

    return HealthResponse(
        status="ok",
        version=VERSION,
        connections=connections,
        first_run_pending=first_run_pending,
    )
