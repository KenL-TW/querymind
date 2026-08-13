from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.auth import require_user
from core.agent_flow import diagnose_empty_result, validate_sql_with_repair
from core.answer_planner import build_answer_plan
from core.query_planner import build_query_plan_payload, coerce_query_plan, compile_query_plan
from core.rbac import PermissionDeniedError, UserContext, assert_conn_allowed, assert_sql_allowed, assert_tool_allowed
from core.semantic_layer import semantic_layer_dict
from tools.db_tools import apply_row_cap

router = APIRouter(prefix="/v1", tags=["semantic"])


class QueryPlanRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)


class ExecuteQueryPlanRequest(BaseModel):
    query_plan: dict[str, Any]
    conn_name: str = "default"


@router.get("/semantic-layer")
async def get_semantic_layer(user: UserContext = Depends(require_user)):  # noqa: ARG001
    return semantic_layer_dict()


@router.post("/query-plan")
async def create_query_plan(
    body: QueryPlanRequest,
    user: UserContext = Depends(require_user),  # noqa: ARG001
):
    payload = build_query_plan_payload(body.question)
    if payload is None:
        raise HTTPException(status_code=422, detail="No supported semantic query plan was detected.")
    return payload


@router.post("/query-plan/execute")
async def execute_query_plan_endpoint(
    body: ExecuteQueryPlanRequest,
    user: UserContext = Depends(require_user),
):
    from api.main import app_state

    try:
        assert_tool_allowed(user, "execute_query_plan")
        assert_conn_allowed(user, body.conn_name)
    except PermissionDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    try:
        plan = coerce_query_plan(body.query_plan)
        sql = compile_query_plan(plan)
        assert_sql_allowed(user, sql)
        repair_result = validate_sql_with_repair(app_state["registry"], body.conn_name, sql)
        if not repair_result.get("ok"):
            return {
                "error": "SQL validation failed before execution.",
                "query_plan": plan.to_dict(),
                "sql": sql,
                "validation": repair_result.get("validation", {}),
                "repair": repair_result,
                "rows": [],
                "row_count": 0,
                "diagnosis": {},
                "answer_plan": {},
            }
        sql = str(repair_result.get("sql") or sql)
        capped_sql = apply_row_cap(sql, user.role.max_rows_per_query)
        rows = app_state["registry"].get(body.conn_name).execute(capped_sql)
        diagnosis = diagnose_empty_result(app_state["registry"], body.conn_name, sql, rows)
        answer_plan = build_answer_plan(rows, sql, diagnosis=diagnosis)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Semantic query execution failed: {exc}") from exc

    return {
        "query_plan": plan.to_dict(),
        "sql": sql,
        "validation": repair_result.get("validation", {}),
        "repair": repair_result,
        "rows": rows,
        "row_count": len(rows),
        "diagnosis": diagnosis,
        "answer_plan": answer_plan,
    }
