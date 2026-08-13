"""
Export tool: validate a SQL query for export and confirm it is ready for download.
The agent calls this when the user asks to "download" or "export" query results.
Actual file generation is handled by the /v1/export/* HTTP endpoints;
these tools only perform RBAC checks, execute the query to get a row count,
and return a small confirmation JSON so the LLM response stays small.
"""
from __future__ import annotations

import json
import logging
from typing import Annotated

from langchain_core.tools import tool

from api.context import get_current_user
from core.rbac import (
    PermissionDeniedError,
    assert_capability,
    assert_conn_allowed,
    assert_sql_allowed,
    assert_tool_allowed,
)
from db.registry import ConnectionRegistry
from tools.db_tools import apply_row_cap

logger = logging.getLogger(__name__)


def _denied(msg: str) -> str:
    return json.dumps({"error": msg, "denied": True}, ensure_ascii=False)


def _guard_export(tool_name: str, sql: str, conn_name: str) -> tuple[str, str | None]:
    """Run RBAC checks for an export tool. Returns (capped_sql, error_json_or_None)."""
    user = get_current_user()
    try:
        assert_tool_allowed(user, tool_name)
        assert_capability(user, "can_export")
        assert_conn_allowed(user, conn_name)
        assert_sql_allowed(user, sql)
    except PermissionDeniedError as exc:
        return sql, _denied(str(exc))
    return apply_row_cap(sql, user.role.max_rows_per_query), None


def make_export_tools(registry: ConnectionRegistry):
    """Return export-related tools bound to the given registry."""

    @tool
    def export_query_csv(
        sql: Annotated[str, "Valid SQL SELECT statement"],
        conn_name: Annotated[str, "Connection name from registry"] = "default",
        filename: Annotated[str, "Desired filename (without extension)"] = "export",
    ) -> str:
        """
        Validate a SQL query for CSV export and confirm it is ready to download.
        Returns a small JSON with row count. The user will see a Download CSV
        button in the chat to retrieve the actual file.
        """
        capped_sql, err = _guard_export("export_query_csv", sql, conn_name)
        if err is not None:
            return err
        conn = registry.get(conn_name)
        try:
            rows = conn.execute(capped_sql)
            row_count = len(rows) if rows else 0
        except Exception as exc:
            return json.dumps({"error": str(exc)}, ensure_ascii=False)
        return json.dumps(
            {"status": "ready", "format": "csv", "filename": f"{filename}.csv", "rows": row_count},
            ensure_ascii=False,
        )

    @tool
    def export_query_xlsx(
        sql: Annotated[str, "Valid SQL SELECT statement"],
        conn_name: Annotated[str, "Connection name from registry"] = "default",
        filename: Annotated[str, "Desired filename (without extension)"] = "export",
        sheet_name: Annotated[str, "Excel sheet name"] = "Sheet1",
    ) -> str:
        """
        Validate a SQL query for Excel export and confirm it is ready to download.
        Returns a small JSON with row count. The user will see a Download Excel
        button in the chat to retrieve the actual file.
        """
        capped_sql, err = _guard_export("export_query_xlsx", sql, conn_name)
        if err is not None:
            return err
        conn = registry.get(conn_name)
        try:
            rows = conn.execute(capped_sql)
            row_count = len(rows) if rows else 0
        except Exception as exc:
            return json.dumps({"error": str(exc)}, ensure_ascii=False)
        return json.dumps(
            {"status": "ready", "format": "xlsx", "filename": f"{filename}.xlsx", "rows": row_count},
            ensure_ascii=False,
        )

    return [export_query_csv, export_query_xlsx]
