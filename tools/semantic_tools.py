from __future__ import annotations

import json
from typing import Annotated

from langchain_core.tools import tool

from api.context import get_current_user
from core.agent_flow import diagnose_empty_result, validate_sql_with_repair
from core.answer_planner import build_answer_plan
from core.query_planner import build_query_plan_payload, coerce_query_plan, compile_query_plan
from core.rbac import PermissionDeniedError, assert_conn_allowed, assert_sql_allowed, assert_tool_allowed
from core.semantic_layer import build_semantic_brief, semantic_layer_dict
from db.registry import ConnectionRegistry
from tools.db_tools import apply_row_cap


def make_semantic_tools(registry: ConnectionRegistry):
    @tool
    def describe_semantic_layer() -> str:
        """Return business metrics, dimensions, and safe column mappings for SQL generation."""
        return json.dumps(semantic_layer_dict(), ensure_ascii=False, default=str)

    @tool
    def build_query_plan(
        question: Annotated[str, "Natural language analytics question."],
    ) -> str:
        """Convert a business question into a semantic query plan and deterministic SQL."""
        payload = build_query_plan_payload(question)
        if payload is None:
            return json.dumps({
                "error": "No supported semantic query plan was detected.",
                "semantic_layer": build_semantic_brief(),
            }, ensure_ascii=False)
        return json.dumps(payload, ensure_ascii=False, indent=2)

    @tool
    def execute_query_plan(
        query_plan_json: Annotated[str, "JSON query plan created by build_query_plan."],
        conn_name: Annotated[str, "Connection name from registry."] = "default",
    ) -> str:
        """Compile and execute a semantic query plan. Prefer this over hand-written SQL for supported metrics."""
        user = get_current_user()
        try:
            assert_tool_allowed(user, "execute_query_plan")
            assert_conn_allowed(user, conn_name)
        except PermissionDeniedError as exc:
            return json.dumps({"error": str(exc), "denied": True}, ensure_ascii=False)

        try:
            plan = coerce_query_plan(query_plan_json)
            sql = compile_query_plan(plan)
            assert_sql_allowed(user, sql)
            repair_result = validate_sql_with_repair(registry, conn_name, sql)
            if not repair_result.get("ok"):
                return json.dumps({
                    "error": "SQL validation failed before execution.",
                    "validation": repair_result.get("validation", {}),
                    "repair": repair_result,
                    "sql": sql,
                }, ensure_ascii=False, default=str)
            sql = str(repair_result.get("sql") or sql)
            capped_sql = apply_row_cap(sql, user.role.max_rows_per_query)
            rows = registry.get(conn_name).execute(capped_sql)
            diagnosis = diagnose_empty_result(registry, conn_name, sql, rows)
            answer_plan = build_answer_plan(rows, sql, diagnosis=diagnosis)
        except Exception as exc:  # noqa: BLE001
            return json.dumps({"error": f"Semantic query execution failed: {exc}"}, ensure_ascii=False)

        return json.dumps({
            "query_plan": plan.to_dict(),
            "sql": sql,
            "validation": repair_result.get("validation", {}),
            "repair": repair_result,
            "rows": rows,
            "row_count": len(rows),
            "diagnosis": diagnosis,
            "answer_plan": answer_plan,
        }, ensure_ascii=False, default=str, indent=2)

    return [describe_semantic_layer, build_query_plan, execute_query_plan]
