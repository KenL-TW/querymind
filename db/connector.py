from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# Hard ceiling for any single SQL statement run by the agent (milliseconds).
# Prevents a runaway / cartesian-product query from holding a DB connection open
# indefinitely after the user has disconnected the SSE stream.
DEFAULT_STATEMENT_TIMEOUT_MS = 60_000


def _install_statement_timeout(engine: Engine, timeout_ms: int) -> None:
    """Attach a PostgreSQL per-connection statement_timeout hook."""
    dialect = engine.dialect.name

    @event.listens_for(engine, "connect")
    def _set_timeout(dbapi_conn, _conn_record):  # noqa: ANN001
        try:
            if dialect != "postgresql":
                raise ValueError(f"Unsupported SQL dialect: {dialect}. QueryMind now requires PostgreSQL.")
            cur = dbapi_conn.cursor()
            cur.execute(f"SET statement_timeout = {int(timeout_ms)}")
            cur.close()
        except Exception as exc:  # pragma: no cover - best effort
            logger.debug("statement_timeout not applied for %s: %s", dialect, exc)


class DBConnector:
    """Thin SQLAlchemy wrapper for PostgreSQL."""

    def __init__(self, engine: Engine, conn_name: str) -> None:
        self.engine = engine
        self.conn_name = conn_name

    # ── Factory ───────────────────────────────────────────────────────────────

    @classmethod
    def from_conn_string(cls, conn_string: str, conn_name: str = "default") -> "DBConnector":
        """Create a DBConnector from a SQLAlchemy connection string.

        Supported dialects (examples):
          postgresql://user:pw@host:5432/dbname
          postgresql+psycopg2://user:pw@host:5432/dbname
        """
        if not conn_string.startswith("postgresql"):
            raise ValueError(
                f"Connection '{conn_name}' must use PostgreSQL. Got: {conn_string.split(':', 1)[0]}"
            )

        engine = create_engine(
            conn_string,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
            pool_recycle=3600,   # recycle connections after 1 h to avoid stale TCP
            pool_timeout=15,     # raise if no connection available within 15 s
        )
        _install_statement_timeout(engine, DEFAULT_STATEMENT_TIMEOUT_MS)

        logger.info("DB connector created", extra={"conn_name": conn_name})
        return cls(engine, conn_name)

    # ── Query ─────────────────────────────────────────────────────────────────

    def execute(self, sql: str, params: dict[str, Any] | None = None) -> list[dict]:
        """Execute SQL and return rows as list of dicts.

        Only SELECT is permitted for ad-hoc queries; INSERT/UPDATE are
        reserved for the ETL engine which uses this method internally.
        """
        with self.engine.connect() as conn:
            result = conn.execute(text(sql), params or {})
            if result.returns_rows:
                columns = list(result.keys())
                return [dict(zip(columns, row)) for row in result.fetchall()]
            conn.commit()
            return []

    def execute_write(self, sql: str, params: dict[str, Any] | None = None) -> int:
        """Execute a write statement (INSERT/UPDATE/DELETE/CREATE/ALTER/MERGE) and return affected rows.

        Hard-blocks ``DROP`` and ``TRUNCATE`` regardless of caller role — these
        are globally forbidden per RBAC policy.  Verb-level permission is
        validated upstream in `tools.db_tools.execute_query` via
        `core.rbac.assert_sql_allowed`.
        """
        forbidden = ("drop ", "truncate ")
        if any(sql.strip().lower().startswith(kw) for kw in forbidden):
            raise PermissionError(f"Operation not permitted: {sql[:40]}")

        with self.engine.begin() as conn:
            result = conn.execute(text(sql), params or {})
            return result.rowcount

    # ── Health ────────────────────────────────────────────────────────────────

    def ping(self) -> bool:
        try:
            with self.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True
        except Exception as exc:
            logger.error("Connection ping failed", extra={"conn_name": self.conn_name, "error": str(exc)})
            return False
