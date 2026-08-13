from __future__ import annotations

import json
from typing import Annotated

from langchain_core.tools import tool

from api.context import get_current_user
from core.agent_flow import build_agent_flow_trace, diagnose_empty_result, validate_sql_with_repair
from core.rbac import PermissionDeniedError, assert_conn_allowed, assert_sql_allowed, assert_tool_allowed
from core.schema_resolver import resolve_schema_context
from db.registry import ConnectionRegistry


def make_agent_flow_tools(registry: ConnectionRegistry):
    @tool
    def resolve_schema_for_question(
        question: Annotated[str, "Natural language question to ground against database schema."],
        conn_name: Annotated[str, "Connection name from registry."] = "default",
    ) -> str:
        """Rank likely tables/fields before generating SQL."""
        user = get_current_user()
        try:
            assert_tool_allowed(user, "resolve_schema_for_question")
            assert_conn_allowed(user, conn_name)
            payload = resolve_schema_context(question, registry, conn_name)
        except PermissionDeniedError as exc:
            return json.dumps({"error": str(exc), "denied": True}, ensure_ascii=False)
        except Exception as exc:  # noqa: BLE001
            return json.dumps({"error": f"Schema resolver failed: {exc}"}, ensure_ascii=False)
        return json.dumps(payload, ensure_ascii=False, default=str, indent=2)

    @tool
    def validate_sql_dry_run_tool(
        sql: Annotated[str, "SELECT/WITH SQL to validate with EXPLAIN before full execution."],
        conn_name: Annotated[str, "Connection name from registry."] = "default",
    ) -> str:
        """Validate SQL with EXPLAIN and semantic warnings before execution."""
        user = get_current_user()
        try:
            assert_tool_allowed(user, "validate_sql_dry_run_tool")
            assert_conn_allowed(user, conn_name)
            assert_sql_allowed(user, sql)
        except PermissionDeniedError as exc:
            return json.dumps({"error": str(exc), "denied": True}, ensure_ascii=False)
        payload = validate_sql_with_repair(registry, conn_name, sql)
        return json.dumps(payload, ensure_ascii=False, default=str, indent=2)

    @tool
    def diagnose_empty_sql_result(
        sql: Annotated[str, "SQL that returned zero rows."],
        rows_json: Annotated[str, "JSON rows returned by SQL execution, usually [] for empty result."],
        conn_name: Annotated[str, "Connection name from registry."] = "default",
    ) -> str:
        """Diagnose likely reasons when a SQL query returns zero rows."""
        user = get_current_user()
        try:
            assert_tool_allowed(user, "diagnose_empty_sql_result")
            assert_conn_allowed(user, conn_name)
            assert_sql_allowed(user, sql)
            rows = json.loads(rows_json or "[]")
            if not isinstance(rows, list):
                rows = []
            payload = diagnose_empty_result(registry, conn_name, sql, rows)
        except PermissionDeniedError as exc:
            return json.dumps({"error": str(exc), "denied": True}, ensure_ascii=False)
        except Exception as exc:  # noqa: BLE001
            return json.dumps({"error": f"Empty result diagnosis failed: {exc}"}, ensure_ascii=False)
        return json.dumps(payload, ensure_ascii=False, default=str, indent=2)

    @tool
    def build_agent_flow_trace_tool(
        question: Annotated[str, "Natural language question."],
        conn_name: Annotated[str, "Connection name from registry."] = "default",
    ) -> str:
        """Build the full deterministic planning trace: intent, schema, query plan, SQL validation."""
        user = get_current_user()
        try:
            assert_tool_allowed(user, "build_agent_flow_trace_tool")
            assert_conn_allowed(user, conn_name)
            payload = build_agent_flow_trace(question, registry, conn_name)
        except PermissionDeniedError as exc:
            return json.dumps({"error": str(exc), "denied": True}, ensure_ascii=False)
        except Exception as exc:  # noqa: BLE001
            return json.dumps({"error": f"Agent flow trace failed: {exc}"}, ensure_ascii=False)
        return json.dumps(payload, ensure_ascii=False, default=str, indent=2)

    return [
        resolve_schema_for_question,
        validate_sql_dry_run_tool,
        diagnose_empty_sql_result,
        build_agent_flow_trace_tool,
    ]
