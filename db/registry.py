from __future__ import annotations

import logging
from threading import Lock

from .connector import DBConnector

logger = logging.getLogger(__name__)

_lock = Lock()


class ConnectionRegistry:
    """Thread-safe registry that holds one DBConnector per conn_name."""

    def __init__(self) -> None:
        self._pool: dict[str, DBConnector] = {}

    def register(self, conn_name: str, conn_string: str) -> DBConnector:
        with _lock:
            if conn_name not in self._pool:
                self._pool[conn_name] = DBConnector.from_conn_string(conn_string, conn_name)
                logger.info("Registered DB connection", extra={"conn_name": conn_name})
            return self._pool[conn_name]

    def replace(self, conn_name: str, conn_string: str) -> DBConnector:
        """Create or replace one connector at runtime."""
        connector = DBConnector.from_conn_string(conn_string, conn_name)
        with _lock:
            old = self._pool.get(conn_name)
            self._pool[conn_name] = connector
        if old is not None:
            try:
                old.engine.dispose()
            except Exception:
                logger.debug("Failed to dispose old DB engine", exc_info=True)
        logger.info("Replaced DB connection", extra={"conn_name": conn_name})
        return connector

    def unregister(self, conn_name: str) -> bool:
        """Remove a connector at runtime and dispose its engine."""
        with _lock:
            connector = self._pool.pop(conn_name, None)
        if connector is None:
            return False
        try:
            connector.engine.dispose()
        except Exception:
            logger.debug("Failed to dispose DB engine", exc_info=True)
        logger.info("Unregistered DB connection", extra={"conn_name": conn_name})
        return True

    def get(self, conn_name: str = "default") -> DBConnector:
        if conn_name not in self._pool:
            raise KeyError(f"Connection '{conn_name}' not registered. Available: {list(self._pool)}")
        return self._pool[conn_name]

    def list_connections(self) -> list[str]:
        return list(self._pool.keys())

    @classmethod
    def from_config(cls, connections: dict[str, str]) -> "ConnectionRegistry":
        """Bootstrap registry from config dict {conn_name: conn_string}."""
        registry = cls()
        for name, conn_str in connections.items():
            registry.register(name, conn_str)
        return registry
