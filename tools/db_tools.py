from __future__ import annotations

import json
import logging
import re
from typing import Annotated

from langchain_core.tools import tool
from sqlalchemy.exc import NoSuchTableError

from api.context import get_current_user
from config.settings import settings as _settings
from core.dlp import mask_rows_with_report
from core.rbac import (
    PermissionDeniedError,
    assert_conn_allowed,
    assert_sql_allowed,
    assert_tool_allowed,
    extract_sql_verb,
)
from db.connector import DBConnector
from db.introspect import SchemaInspector
from db.registry import ConnectionRegistry

logger = logging.getLogger(__name__)


def _audit_rbac_deny(
    user,
    *,
    tool_name: str,
    conn_name: str | None,
    sql: str | None,
    error: Exception,
) -> None:
    """Record an RBAC denial to qm_audit_log so admins can audit it."""
    try:
        from api.main import app_state
        al = app_state.get("audit_logger") if app_state else None
        if al is None:
            return
        uid = getattr(user, "user_id", None)
        prefix = f"u{uid}"[:16] if uid and str(uid) != "anonymous" else "anon"
        al.log(
            "rbac.denied",
            api_key_prefix=prefix,
            tool_name=tool_name,
            conn_name=conn_name,
            detail=(sql or "")[:4000],
            status="denied",
            error_msg=str(error),
        )
    except Exception:
        pass


_LIMIT_RE = re.compile(r"\blimit\s+(\d+)", re.IGNORECASE)

# Destructive verbs that must be confirmed by the user *before* execution.
# Even if the role technically allows them, we require an explicit `confirmed=True`
# flag so that LLM prompt-injection cannot trigger silent writes.
_DESTRUCTIVE_VERBS: frozenset[str] = frozenset({
    "DELETE", "UPDATE", "INSERT", "MERGE", "REPLACE",
    "ALTER", "CREATE", "DROP", "TRUNCATE",
})


def _apply_row_cap(sql: str, max_rows: int) -> str:
    """Enforce an upper bound on returned rows.

    This is **not** bypassable by writing `LIMIT 9999999` inside the query, because
    we always wrap the original SELECT/WITH in an outer ``SELECT * FROM (...) LIMIT max_rows``.

    Strategy:
      * If user supplied a LIMIT N, keep it as long as N <= max_rows. Otherwise rewrite.
      * Wrap query in a subquery so any inner LIMIT becomes a per-subquery limit and
        the outer LIMIT is authoritative.
      * Strip trailing semicolons so wrapping stays valid SQL.
    """
    if not sql:
        return sql
    stripped = sql.strip().rstrip(";").strip()
    if not stripped:
        return sql

    # If existing LIMIT is already within cap, keep query unchanged for readability.
    existing = _LIMIT_RE.search(stripped)
    if existing:
        try:
            if int(existing.group(1)) <= max_rows:
                return stripped
        except ValueError:
            pass

    # Wrap in an outer SELECT with the hard cap. Works for SELECT and WITH (CTE) statements.
    return f"SELECT * FROM (\n{stripped}\n) AS qm_capped LIMIT {max_rows}"


def is_destructive(verb: str) -> bool:
    return verb.upper() in _DESTRUCTIVE_VERBS


# Public alias so other tool families (export, viz, …) can reuse the same row-cap logic.
apply_row_cap = _apply_row_cap


# ── SQL error → structured hint (helps the agent self-correct on first retry) ──
_AMBIGUOUS_RE = re.compile(r"ambiguous column name:\s*([A-Za-z_][\w]*)", re.IGNORECASE)
_NO_SUCH_COL_RE = re.compile(r"no such column:?\s*([A-Za-z_][\w.]*)", re.IGNORECASE)
_NO_SUCH_TABLE_RE = re.compile(r"no such table:?\s*([A-Za-z_][\w.]*)", re.IGNORECASE)
_UNDEFINED_COL_RE = re.compile(r'column "?([A-Za-z_][\w]*)"? does not exist', re.IGNORECASE)


def _columns_containing(conn: "DBConnector", col_name: str, limit: int = 12) -> list[str]:
    """Best-effort: return list of `<table>.<col>` where `col_name` exists."""
    try:
        from sqlalchemy import inspect as sa_inspect
        insp = sa_inspect(conn.engine)
        hits: list[str] = []
        for tbl in insp.get_table_names():
            try:
                for c in insp.get_columns(tbl):
                    if c["name"].lower() == col_name.lower():
                        hits.append(f"{tbl}.{c['name']}")
                        if len(hits) >= limit:
                            return hits
            except Exception:
                continue
        return hits
    except Exception:
        return []


def _build_sql_error_payload(exc: Exception, sql: str, conn: "DBConnector") -> dict:
    """Convert a raw DB exception into actionable JSON for the agent.

    Adds a `hint` field for the most common, mechanically-fixable errors so the
    agent can self-correct on the first retry instead of guessing blindly.
    """
    msg = str(exc)
    payload: dict = {"error": f"SQL 執行失敗: {msg}", "sql": sql.strip()[:600]}

    m = _AMBIGUOUS_RE.search(msg)
    if m:
        col = m.group(1)
        candidates = _columns_containing(conn, col)
        payload["error_type"] = "ambiguous_column"
        payload["column"] = col
        payload["candidates"] = candidates
        payload["hint"] = (
            f"欄位 `{col}` 同時存在於多個表，請以 `<table>.{col}` 或表別名限定。"
            + (f" 候選：{', '.join(candidates)}。" if candidates else "")
            + " 請改寫 SQL 重試一次。"
        )
        return payload

    m = _NO_SUCH_COL_RE.search(msg) or _UNDEFINED_COL_RE.search(msg)
    if m:
        col = m.group(1).split(".")[-1]
        candidates = _columns_containing(conn, col)
        payload["error_type"] = "unknown_column"
        payload["column"] = col
        payload["candidates"] = candidates
        payload["hint"] = (
            f"找不到欄位 `{col}`。"
            + (f" 與此名稱相近的欄位：{', '.join(candidates)}。" if candidates
               else " 請先用 `get_table_ddl` 確認正確欄位名再重試。")
        )
        return payload

    m = _NO_SUCH_TABLE_RE.search(msg)
    if m:
        payload["error_type"] = "unknown_table"
        payload["table"] = m.group(1)
        payload["hint"] = (
            f"找不到資料表 `{m.group(1)}`。請用 `list_tables` 確認名稱（含 schema 前綴）後重試。"
        )
        return payload

    payload["error_type"] = "other"
    payload["hint"] = "請檢視錯誤訊息修正 SQL；若是 schema 不確定請先 introspect。"
    return payload


def make_db_tools(registry: ConnectionRegistry):
    """Return DB-related tools bound to the given registry.

    All tools enforce RBAC by reading the current UserContext from the
    request-scoped contextvar set in `api.auth.require_user`.
    """

    def _visible_conns() -> list[str]:
        user = get_current_user()
        all_conns = registry.list_connections()
        if not user.allowed_conns:
            return all_conns
        return [c for c in all_conns if c in user.allowed_conns]

    @tool
    def execute_query(
        sql: Annotated[str, "SQL statement. Allowed verbs depend on your role."],
        conn_name: Annotated[str, "Connection name from registry (default: 'default')"] = "default",
        confirmed: Annotated[bool, "Set True only after the user has explicitly approved a destructive operation (DELETE/UPDATE/INSERT/...)"] = False,
    ) -> str:
        """Execute a SQL statement and return rows as JSON.

        Enforces the caller's role:
          * only verbs in `role.allowed_sql_verbs` are accepted
          * the connection must be in `user.allowed_conns` (or wildcard)
          * SELECT/WITH queries are wrapped in an outer LIMIT (cannot be bypassed)
          * Destructive verbs (DELETE/UPDATE/INSERT/MERGE/ALTER/CREATE) are blocked
            until `confirmed=True` is passed.  The LLM MUST first present the SQL
            to the user, receive explicit approval, then call again with confirmed=True.
        """
        user = get_current_user()
        try:
            assert_tool_allowed(user, "execute_query")
            assert_conn_allowed(user, conn_name)
            verb = assert_sql_allowed(user, sql)
        except PermissionDeniedError as e:
            logger.warning("RBAC deny user=%s conn=%s verb=%s: %s",
                           user.email, conn_name, extract_sql_verb(sql), e)
            _audit_rbac_deny(user, tool_name="execute_query", conn_name=conn_name, sql=sql, error=e)
            return json.dumps({"error": str(e), "denied": True}, ensure_ascii=False)

        if is_destructive(verb) and not _settings.sql_write_execution_enabled:
            try:
                from api.main import app_state

                al = app_state.get("audit_logger") if app_state else None
                if al is not None:
                    al.log(
                        "sql.write_blocked",
                        api_key_prefix=(getattr(user, "api_key_prefix", None) or getattr(user, "user_id", "anon"))[:16],
                        tool_name="execute_query",
                        conn_name=conn_name,
                        detail=sql.strip()[:4000],
                        status="denied",
                        error_msg="sql_write_execution_enabled=false",
                    )
            except Exception:
                pass
            return json.dumps({
                "denied": True,
                "needs_owner_approval": True,
                "verb": verb,
                "sql_preview": sql.strip()[:1000],
                "message": (
                    "目前環境預設為 read-only DB Agent，僅允許 SELECT/WITH 查詢。"
                    "寫入或 DDL SQL 已被安全政策阻擋；若企業正式流程需要，請由 owner 啟用核准工作流。"
                ),
            }, ensure_ascii=False)

        # Hard backstop for destructive operations — require explicit confirmation
        # even if the role permits the verb. Prevents prompt-injection writes.
        if is_destructive(verb) and not confirmed:
            return json.dumps({
                "needs_confirmation": True,
                "verb": verb,
                "sql_preview": sql.strip()[:1000],
                "message": (
                    f"偵測到 {verb} 操作。請先向使用者展示這段 SQL 並取得明確同意，"
                    f"再以 `confirmed=True` 重新呼叫本工具以執行。"
                ),
            }, ensure_ascii=False)

        original_sql = sql
        row_cap_applied = False
        if verb in {"SELECT", "WITH"}:
            capped_sql = _apply_row_cap(sql, user.role.max_rows_per_query)
            row_cap_applied = capped_sql.strip() != original_sql.strip().rstrip(";").strip()
            sql = capped_sql

        conn: DBConnector = registry.get(conn_name)
        try:
            if is_destructive(verb):
                affected = conn.execute_write(sql)
                logger.warning(
                    "Destructive SQL executed user=%s conn=%s verb=%s rows=%s",
                    user.email, conn_name, verb, affected,
                )
                return json.dumps({
                    "verb": verb,
                    "affected_rows": affected,
                    "message": f"{verb} 已執行，影響 {affected} 列。",
                }, ensure_ascii=False)

            # ── Query result cache (SELECT/WITH only) ─────────────────────
            from config.settings import settings as _cfg
            from core.query_cache import get as _cache_get, put as _cache_put

            cached_rows: list[dict] | None = None
            if _cfg.query_cache_enabled:
                cached_rows = _cache_get(conn_name, sql, _cfg.query_cache_ttl_seconds)

            if cached_rows is not None:
                rows = cached_rows
            else:
                rows = conn.execute(sql)
                if _cfg.query_cache_enabled and isinstance(rows, list):
                    _cache_put(conn_name, sql, rows, _cfg.query_cache_ttl_seconds)

        except Exception as e:
            logger.exception("SQL execution failed (user=%s conn=%s)", user.email, conn_name)
            return json.dumps(
                _build_sql_error_payload(e, sql, conn),
                ensure_ascii=False,
            )

        row_count_before_cap = None
        if isinstance(rows, list) and len(rows) > user.role.max_rows_per_query:
            row_count_before_cap = len(rows)
            rows = rows[: user.role.max_rows_per_query]
        dlp_report = {
            "enabled": bool(_settings.dlp_enabled),
            "applied": False,
            "total_redactions": 0,
            "columns": [],
            "reason": "not_applicable",
        }
        if isinstance(rows, list):
            exempt = {r.strip() for r in (_settings.dlp_role_exempt or "").split(",") if r.strip()}
            rows, dlp_report = mask_rows_with_report(
                rows,
                enabled=bool(_settings.dlp_enabled),
                role_exempt=exempt,
                role_name=getattr(user, "role_name", None),
            )
            if dlp_report.get("total_redactions"):
                logger.info(
                    "DLP masked %d field(s) for user=%s conn=%s verb=%s",
                    dlp_report["total_redactions"], user.email, conn_name, verb,
                )
        payload = {
            "rows": rows,
            "query_facts": {
                "conn_name": conn_name,
                "verb": verb,
                "row_count": len(rows) if isinstance(rows, list) else None,
                "row_count_before_cap": row_count_before_cap,
                "row_cap": user.role.max_rows_per_query,
                "row_cap_applied": row_cap_applied or bool(row_count_before_cap is not None),
                "sql": sql.strip()[:4000],
                "original_sql": original_sql.strip()[:4000] if row_cap_applied else "",
                "safety_policy": "select_with_only_default",
            },
            "dlp": dlp_report,
        }
        return json.dumps(payload, default=str, ensure_ascii=False, indent=2)

    @tool
    def list_schemas(
        conn_name: Annotated[str, "Connection name from registry (default: 'default')"] = "default",
    ) -> str:
        """List all schema names in the database."""
        user = get_current_user()
        try:
            assert_tool_allowed(user, "list_schemas")
            assert_conn_allowed(user, conn_name)
        except PermissionDeniedError as e:
            _audit_rbac_deny(user, tool_name="list_schemas", conn_name=conn_name, sql=None, error=e)
            return json.dumps({"error": str(e), "denied": True}, ensure_ascii=False)
        conn: DBConnector = registry.get(conn_name)
        return json.dumps(SchemaInspector(conn).list_schemas())

    @tool
    def list_tables(
        db_schema: Annotated[str, "Schema name (empty for default)"] = "",
        conn_name: Annotated[str, "Connection name from registry"] = "default",
    ) -> str:
        """List all tables and views in a schema."""
        user = get_current_user()
        try:
            assert_tool_allowed(user, "list_tables")
            assert_conn_allowed(user, conn_name)
        except PermissionDeniedError as e:
            _audit_rbac_deny(user, tool_name="list_tables", conn_name=conn_name, sql=db_schema, error=e)
            return json.dumps({"error": str(e), "denied": True}, ensure_ascii=False)
        conn: DBConnector = registry.get(conn_name)
        inspector = SchemaInspector(conn)
        return json.dumps({
            "tables": inspector.list_tables(db_schema or None),
            "views":  inspector.list_views(db_schema or None),
        })

    @tool
    def get_table_ddl(
        table_name: Annotated[str, "Table name"],
        db_schema: Annotated[str, "Schema name (leave empty for default)"] = "",
        conn_name: Annotated[str, "Connection name from registry"] = "default",
    ) -> str:
        """Return the CREATE TABLE DDL for a specific table."""
        user = get_current_user()
        try:
            assert_tool_allowed(user, "get_table_ddl")
            assert_conn_allowed(user, conn_name)
        except PermissionDeniedError as e:
            _audit_rbac_deny(user, tool_name="get_table_ddl", conn_name=conn_name, sql=f"{db_schema}.{table_name}", error=e)
            return json.dumps({"error": str(e), "denied": True}, ensure_ascii=False)
        try:
            conn: DBConnector = registry.get(conn_name)
            return SchemaInspector(conn).get_ddl(table_name, db_schema or None)
        except NoSuchTableError:
            inspector = SchemaInspector(conn)
            available = inspector.list_tables(db_schema or None)
            qualified = f"{db_schema}.{table_name}" if db_schema else table_name
            return json.dumps(
                {
                    "error": f"Table not found: {qualified}",
                    "available_tables": available,
                    "denied": False,
                },
                ensure_ascii=False,
            )
        except Exception as exc:
            return json.dumps(
                {
                    "error": f"Failed to inspect DDL for {db_schema + '.' if db_schema else ''}{table_name}: {exc}",
                    "denied": False,
                },
                ensure_ascii=False,
            )

    @tool
    def compare_ddl(
        table_name: Annotated[str, "Table name to compare"],
        source_conn: Annotated[str, "Source connection name"],
        target_conn: Annotated[str, "Target connection name"],
        db_schema: Annotated[str, "Schema name (leave empty for default)"] = "",
    ) -> str:
        """Compare DDL of a table between two connections and suggest ALTER TABLE statements."""
        user = get_current_user()
        try:
            assert_tool_allowed(user, "compare_ddl")
            assert_conn_allowed(user, source_conn)
            assert_conn_allowed(user, target_conn)
        except PermissionDeniedError as e:
            _audit_rbac_deny(user, tool_name="compare_ddl", conn_name=f"{source_conn}->{target_conn}", sql=table_name, error=e)
            return json.dumps({"error": str(e), "denied": True}, ensure_ascii=False)
        try:
            src = SchemaInspector(registry.get(source_conn))
            tgt = SchemaInspector(registry.get(target_conn))
            alterations = src.compare_ddl(tgt, table_name, db_schema or None)
        except NoSuchTableError:
            try:
                available = SchemaInspector(registry.get(source_conn)).list_tables(db_schema or None)
            except Exception:
                available = []
            qualified = f"{db_schema}.{table_name}" if db_schema else table_name
            return json.dumps(
                {
                    "error": f"Table not found: {qualified}",
                    "available_tables": available,
                    "denied": False,
                },
                ensure_ascii=False,
            )
        except Exception as exc:
            return json.dumps(
                {
                    "error": f"Failed to compare DDL for {db_schema + '.' if db_schema else ''}{table_name}: {exc}",
                    "denied": False,
                },
                ensure_ascii=False,
            )
        if not alterations:
            return "No DDL differences found."
        return "\n".join(alterations)

    @tool
    def list_connections() -> str:
        """List the database connections this role is allowed to use."""
        return json.dumps(_visible_conns())

    @tool
    def explain_query(
        sql: Annotated[str, "SELECT/WITH statement to explain"],
        conn_name: Annotated[str, "Connection name"] = "default",
    ) -> str:
        """Return the database's execution plan for a query (PostgreSQL EXPLAIN ANALYZE).

        Use this when a query is slow or you want to verify it actually uses an
        index / avoids a sequential scan.  Read-only — never executes writes.
        """
        user = get_current_user()
        try:
            assert_tool_allowed(user, "explain_query")
            assert_conn_allowed(user, conn_name)
            verb = assert_sql_allowed(user, sql)
        except PermissionDeniedError as e:
            _audit_rbac_deny(user, tool_name="explain_query", conn_name=conn_name, sql=sql, error=e)
            return json.dumps({"error": str(e), "denied": True}, ensure_ascii=False)

        if verb not in {"SELECT", "WITH"}:
            return json.dumps(
                {"error": f"explain_query 只能用於 SELECT / WITH 語句（現為 {verb}）"},
                ensure_ascii=False,
            )
        conn: DBConnector = registry.get(conn_name)
        try:
            cleaned = sql.strip().rstrip(";")
            rows = conn.execute(f"EXPLAIN (ANALYZE false, VERBOSE false, FORMAT JSON) {cleaned}")
        except Exception as exc:
            return json.dumps(
                _build_sql_error_payload(exc, sql, conn),
                ensure_ascii=False,
            )
        return json.dumps({"plan": rows}, default=str, ensure_ascii=False)

    return [execute_query, list_schemas, list_tables, get_table_ddl, compare_ddl,
            list_connections, explain_query]
