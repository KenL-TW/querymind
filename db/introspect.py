from __future__ import annotations

import logging
import time
from threading import Lock

from sqlalchemy import inspect
from sqlalchemy.exc import NoSuchTableError

from .connector import DBConnector

logger = logging.getLogger(__name__)


# Process-wide TTL cache for cheap schema lookups (list_tables / list_schemas /
# get_ddl).  Avoids hitting information_schema on every LLM tool call — large
# DBs can take 5-10s per scan otherwise.  Keyed by (conn_name, method, args).
_CACHE_TTL_SECONDS = 300  # 5 minutes
_cache: dict[tuple, tuple[float, object]] = {}
_cache_lock = Lock()


def _cache_get(key: tuple):
    with _cache_lock:
        hit = _cache.get(key)
        if not hit:
            return None
        expires_at, value = hit
        if time.monotonic() > expires_at:
            _cache.pop(key, None)
            return None
        return value


def _cache_set(key: tuple, value) -> None:
    with _cache_lock:
        _cache[key] = (time.monotonic() + _CACHE_TTL_SECONDS, value)


def invalidate_schema_cache(conn_name: str | None = None) -> None:
    """Drop cached schema entries for a given connection (or all)."""
    with _cache_lock:
        if conn_name is None:
            _cache.clear()
        else:
            for k in [k for k in _cache if k and k[0] == conn_name]:
                _cache.pop(k, None)


class SchemaInspector:
    """PostgreSQL schema introspection built on top of SQLAlchemy."""

    def __init__(self, connector: DBConnector) -> None:
        self._conn = connector

    @property
    def _cn(self) -> str:
        return self._conn.conn_name

    # ── Discovery ─────────────────────────────────────────────────────────────

    def list_schemas(self) -> list[str]:
        key = (self._cn, "list_schemas")
        cached = _cache_get(key)
        if cached is not None:
            return cached  # type: ignore[return-value]
        insp = inspect(self._conn.engine)
        try:
            schemas = insp.get_schema_names()
        except Exception:
            schemas = ["public"]
        result = [s for s in schemas if s not in ("information_schema", "pg_catalog")]
        _cache_set(key, result)
        return result

    def list_tables(self, schema: str | None = None) -> list[str]:
        key = (self._cn, "list_tables", schema or "")
        cached = _cache_get(key)
        if cached is not None:
            return cached  # type: ignore[return-value]
        insp = inspect(self._conn.engine)
        result = insp.get_table_names(schema=schema)
        _cache_set(key, result)
        return result

    def list_views(self, schema: str | None = None) -> list[str]:
        key = (self._cn, "list_views", schema or "")
        cached = _cache_get(key)
        if cached is not None:
            return cached  # type: ignore[return-value]
        insp = inspect(self._conn.engine)
        result = insp.get_view_names(schema=schema)
        _cache_set(key, result)
        return result

    # ── DDL ───────────────────────────────────────────────────────────────────

    def get_ddl(self, table_name: str, schema: str | None = None) -> str:
        """Return a CREATE TABLE statement for the given table."""
        key = (self._cn, "get_ddl", schema or "", table_name)
        cached = _cache_get(key)
        if cached is not None:
            return cached  # type: ignore[return-value]
        insp = inspect(self._conn.engine)
        available_tables = insp.get_table_names(schema=schema)
        if table_name not in available_tables:
            qualified = f"{schema}.{table_name}" if schema else table_name
            raise NoSuchTableError(qualified)

        columns = insp.get_columns(table_name, schema=schema)
        pk = insp.get_pk_constraint(table_name, schema=schema)
        try:
            fks = insp.get_foreign_keys(table_name, schema=schema)
        except Exception:
            fks = []
        try:
            uniques = insp.get_unique_constraints(table_name, schema=schema)
        except Exception:
            uniques = []

        qualified = f"{schema}.{table_name}" if schema else table_name
        col_defs: list[str] = []

        for col in columns:
            nullable = "" if col["nullable"] else " NOT NULL"
            default = f" DEFAULT {col['default']}" if col.get("default") else ""
            col_defs.append(f"    {col['name']} {col['type']}{nullable}{default}")

        pk_names = pk.get("constrained_columns", [])
        if pk_names:
            col_defs.append(f"    PRIMARY KEY ({', '.join(pk_names)})")

        for fk in fks:
            cols = ", ".join(fk["constrained_columns"])
            ref_cols = ", ".join(fk["referred_columns"])
            col_defs.append(
                f"    FOREIGN KEY ({cols}) REFERENCES {fk['referred_table']}({ref_cols})"
            )

        for uq in uniques:
            cols = ", ".join(uq["column_names"])
            col_defs.append(f"    UNIQUE ({cols})")

        ddl = f"CREATE TABLE {qualified} (\n" + ",\n".join(col_defs) + "\n);"
        _cache_set(key, ddl)
        return ddl

    def compare_ddl(
        self,
        other: "SchemaInspector",
        table_name: str,
        schema: str | None = None,
    ) -> str:
        """Compare DDL between two connections and suggest ALTER TABLE statements."""
        ddl_a = self.get_ddl(table_name, schema)
        ddl_b = other.get_ddl(table_name, schema)

        if ddl_a == ddl_b:
            return "✅ DDL is identical across both connections."

        insp_a = inspect(self._conn.engine)
        insp_b = inspect(other._conn.engine)
        cols_a = {c["name"]: c for c in insp_a.get_columns(table_name, schema=schema)}
        cols_b = {c["name"]: c for c in insp_b.get_columns(table_name, schema=schema)}

        alters: list[str] = []
        qualified = f"{schema}.{table_name}" if schema else table_name

        # Columns in B but not in A → need to add
        for name, col in cols_b.items():
            if name not in cols_a:
                nullable = "" if col["nullable"] else " NOT NULL"
                alters.append(f"ALTER TABLE {qualified} ADD COLUMN {name} {col['type']}{nullable};")

        # Columns in A but not in B → removed in B
        for name in cols_a:
            if name not in cols_b:
                alters.append(f"-- Column '{name}' exists in source but not in target (manual review needed)")

        if not alters:
            return "⚠️  DDL differs but no automatic ALTER TABLE suggestion available. Manual review required."

        return "\n".join(alters)
