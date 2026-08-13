from __future__ import annotations

import logging
import sys

import structlog


def configure_logging(env: str = "local") -> None:
    """Configure structlog + stdlib logging for the given environment."""

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
    ]

    if env == "local":
        renderer = structlog.dev.ConsoleRenderer(colors=True)
    else:
        # JSON for CloudWatch
        renderer = structlog.processors.JSONRenderer()

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        processor=renderer,
        foreign_pre_chain=shared_processors,
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(logging.INFO)

    # Quieten noisy libs
    for noisy in ("httpx", "httpcore", "openai", "sqlalchemy.engine"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
