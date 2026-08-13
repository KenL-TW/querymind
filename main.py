"""
QueryMind — main entrypoint.
Starts the FastAPI server.

Usage:
  python main.py
"""
from __future__ import annotations

import uvicorn

from config.settings import settings


def main() -> None:
    uvicorn.run(
        "api.main:app",
        host="0.0.0.0",  # noqa: S104
        port=settings.api_port,
        reload=False,  # Disable reload to avoid metrics double-registration with uvicorn watch
        log_config=None,  # structlog handles logging
    )


if __name__ == "__main__":
    main()
