import logging
import time

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from api.auth import require_api_key, require_user
from api.context import get_current_user
from api.rate_limit import limiter
from api.schemas import (
    ChatRequest,
    ChatResponse,
    ConfirmExecuteRequest,
    ConfirmExecuteResponse,
    RefineResponse,
    RegenerateRequest,
    RefineSqlRequest,
    ThoughtStep,
)
from api.streaming import run_agent_streaming
from config.settings import settings
from core.agent import invoke_agent
from core.agent_flow import build_agent_flow_trace, trace_to_debug_steps
from core.query_planner import build_query_plan_payload
from core.rbac import PermissionDeniedError, UserContext, assert_conn_allowed, assert_sql_allowed, assert_tool_allowed
from core.summarizer import generate_followups, generate_session_title

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["chat"])


def _resolve_user_id() -> int | None:
    cur = get_current_user()
    try:
        return int(cur.user_id)
    except (TypeError, ValueError):
        return None


def _audit_chat(audit_logger, *, session_id: str, conn_name: str, user_id: int | None,
                duration_ms: int, status: str, error_msg: str | None,
                usage: dict | None, detail: str | None) -> None:
    if audit_logger is None:
        return
    usage = usage or {}
    cur = get_current_user()
    try:
        audit_logger.log(
            "agent_invoke",
            session_id=session_id,
            user_id=user_id,
            api_key_prefix=getattr(cur, "api_key_prefix", None),
            conn_name=conn_name,
            detail=detail,
            status=status,
            duration_ms=duration_ms,
            error_msg=error_msg,
            prompt_tokens=usage.get("prompt_tokens") or None,
            completion_tokens=usage.get("completion_tokens") or None,
            total_tokens=usage.get("total_tokens") or None,
            model_name=usage.get("model_name"),
        )
    except Exception:  # never let audit break the response
        logger.debug("audit chat write failed", exc_info=True)


def _maybe_set_title(session_mgr, llm, session_id: str, first_message: str) -> None:
    """If the session has no title yet (first real turn), generate one from the LLM.

    Best-effort — never raises. Runs after the turn is persisted so it does not
    block the response stream / sync path beyond a single quick LLM call.
    """
    try:
        meta = session_mgr.get_session_meta(session_id)
        if meta.title:
            return
        if llm is None:
            return
        title = generate_session_title(llm, first_message)
        if title:
            session_mgr.upsert_session_meta(session_id, title=title)
    except Exception:
        logger.debug("auto-title generation failed", exc_info=True)


@router.post("/chat")
@limiter.limit(settings.rate_limit_chat)
async def chat_stream(
    request: Request,
    body: ChatRequest = Body(...),
    role: str = Depends(require_api_key),
) -> StreamingResponse:
    """
    Streaming chat endpoint (SSE).
    Events: token | thought | observation | finish | error

    Rate-limited per API key (default 30/min).
    Conversation memory is loaded automatically and saved when the agent finishes.
    """
    from api.main import app_state

    agent = app_state["agent"]
    session_mgr = app_state["session_manager"]
    audit_logger = app_state.get("audit_logger")
    llm = app_state.get("llm")

    history = session_mgr.get_messages_for_agent(body.session_id)
    is_first_turn = not history
    result_holder: dict = {"session_id": body.session_id}

    async def event_generator():
        t0 = time.monotonic()
        err: str | None = None
        try:
            async for chunk in run_agent_streaming(
                agent,
                body.message,
                body.conn_name,
                history=history,
                result_holder=result_holder,
                llm=llm,
            ):
                yield chunk
        except Exception as exc:  # pragma: no cover
            err = str(exc)
            logger.exception("chat_stream generator error")
            raise
        finally:
            duration_ms = int((time.monotonic() - t0) * 1000)
            ai_answer = result_holder.get("output", "")
            usage = result_holder.get("usage") or {}
            owner_id = _resolve_user_id()
            if ai_answer:
                try:
                    session_mgr.add_turn(body.session_id, body.message, ai_answer, owner_user_id=owner_id)
                except Exception:
                    logger.exception("session add_turn failed")
                if is_first_turn:
                    _maybe_set_title(session_mgr, llm, body.session_id, body.message)
            _audit_chat(
                audit_logger,
                session_id=body.session_id,
                conn_name=body.conn_name,
                user_id=owner_id,
                duration_ms=duration_ms,
                status="error" if err else "success",
                error_msg=err,
                usage=usage,
                detail=(ai_answer or "")[:500],
            )

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/chat/sync", response_model=ChatResponse)
@limiter.limit(settings.rate_limit_chat)
async def chat_sync(
    request: Request,
    body: ChatRequest = Body(...),
    role: str = Depends(require_api_key),
) -> ChatResponse:
    """Synchronous chat endpoint. Loads history, runs agent, saves turn, returns result."""
    from api.main import app_state

    agent = app_state["agent"]
    session_mgr = app_state["session_manager"]
    audit_logger = app_state.get("audit_logger")
    llm = app_state.get("llm")

    history = session_mgr.get_messages_for_agent(body.session_id)
    is_first_turn = not history

    t0 = time.monotonic()
    err: str | None = None
    result: dict = {}
    try:
        result = invoke_agent(
            agent,
            body.message,
            history=history,
            session_id=body.session_id,
            conn_name=body.conn_name,
        )
    except Exception as exc:
        err = str(exc)
        logger.exception("chat_sync invoke_agent failed")
    duration_ms = int((time.monotonic() - t0) * 1000)

    answer = str(result.get("output", "")) if result else ""
    usage: dict = result.get("usage") or {} if result else {}
    owner_id = _resolve_user_id()

    if answer:
        try:
            session_mgr.add_turn(body.session_id, body.message, answer, owner_user_id=owner_id)
        except Exception:
            logger.exception("session add_turn failed")
        if is_first_turn:
            _maybe_set_title(session_mgr, llm, body.session_id, body.message)

    # Extract tool call steps from returned messages (defensive against shape drift)
    steps: list[ThoughtStep] = []
    try:
        flow_trace = build_agent_flow_trace(body.message, app_state["registry"], body.conn_name)
        for item in trace_to_debug_steps(flow_trace):
            steps.append(ThoughtStep(**item))
        _audit_flow_trace(
            audit_logger,
            flow_trace,
            session_id=body.session_id,
            conn_name=body.conn_name,
            user_id=owner_id,
        )
    except Exception:
        logger.debug("agent flow trace failed in sync path", exc_info=True)
    semantic_plan = build_query_plan_payload(body.message)
    if semantic_plan:
        steps.append(
            ThoughtStep(
                thought="",
                action="query_plan",
                action_input=str(semantic_plan.get("query_plan", {}))[:1000],
                observation=str(semantic_plan.get("sql", ""))[:2000],
            )
        )
    messages = result.get("messages", []) if result else []
    for i, msg in enumerate(messages):
        tool_calls = getattr(msg, "tool_calls", []) or []
        for tc in tool_calls:
            try:
                if isinstance(tc, dict):
                    tool_name = tc.get("name", "")
                    tool_input = tc.get("args", {})
                else:
                    tool_name = getattr(tc, "name", "")
                    tool_input = getattr(tc, "args", {})
            except Exception:
                continue
            if not tool_name:
                continue
            obs = ""
            for j in range(i + 1, len(messages)):
                if getattr(messages[j], "type", "") == "tool":
                    obs = getattr(messages[j], "content", "")
                    break
            steps.append(
                ThoughtStep(
                    thought="",
                    action=tool_name,
                    action_input=str(tool_input)[:1000],
                    observation=str(obs)[:2000],
                )
            )

    _audit_chat(
        audit_logger,
        session_id=body.session_id,
        conn_name=body.conn_name,
        user_id=owner_id,
        duration_ms=duration_ms,
        status="error" if err else "success",
        error_msg=err,
        usage=usage,
        detail=(answer or "")[:500],
    )

    if err:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"Agent error: {err}")

    # Generate follow-up questions (best-effort, does not block the response)
    followups: list[str] = []
    if answer and llm is not None:
        try:
            followups = generate_followups(llm, body.message, answer)
        except Exception:
            logger.debug("followups generation failed", exc_info=True)

    return ChatResponse(
        answer=answer,
        session_id=body.session_id,
        steps=steps,
        tokens_used=int(usage.get("total_tokens") or 0),
        followup_questions=followups,
    )


@router.post("/chat/regenerate")
@limiter.limit(settings.rate_limit_chat)
async def chat_regenerate(
    request: Request,
    body: RegenerateRequest = Body(...),
    role: str = Depends(require_api_key),
) -> StreamingResponse:
    """Re-run the agent on the most recent user message.

    Removes the last AI+human exchange from the session DB so the agent
    sees clean history, then invokes the agent again with the same user
    message and streams the new response as SSE (identical event format to
    /v1/chat).
    """
    from api.main import app_state

    agent = app_state["agent"]
    session_mgr = app_state["session_manager"]
    audit_logger = app_state.get("audit_logger")
    llm = app_state.get("llm")

    # Pop the last turn from history and return the user message to re-run
    last_user_message = session_mgr.pop_last_turn(body.session_id)
    if not last_user_message:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="No previous turn found to regenerate.")

    # Load history *after* popping so the agent sees the clean window
    history = session_mgr.get_messages_for_agent(body.session_id)
    result_holder: dict = {"session_id": body.session_id}

    async def event_generator():
        t0 = time.monotonic()
        err: str | None = None
        try:
            async for chunk in run_agent_streaming(
                agent,
                last_user_message,
                body.conn_name,
                history=history,
                result_holder=result_holder,
                llm=llm,
            ):
                yield chunk
        except Exception as exc:
            err = str(exc)
            logger.exception("chat_regenerate generator error")
            raise
        finally:
            duration_ms = int((time.monotonic() - t0) * 1000)
            ai_answer = result_holder.get("output", "")
            usage = result_holder.get("usage") or {}
            owner_id = _resolve_user_id()
            if ai_answer:
                try:
                    session_mgr.add_turn(body.session_id, last_user_message, ai_answer, owner_user_id=owner_id)
                except Exception:
                    logger.exception("regenerate add_turn failed")
            _audit_chat(
                audit_logger,
                session_id=body.session_id,
                conn_name=body.conn_name,
                user_id=owner_id,
                duration_ms=duration_ms,
                status="error" if err else "success",
                error_msg=err,
                usage=usage,
                detail=(ai_answer or "")[:500],
            )

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/chat/confirm-execute", response_model=ConfirmExecuteResponse)
@limiter.limit(settings.rate_limit_chat)
async def chat_confirm_execute(
    request: Request,
    body: ConfirmExecuteRequest = Body(...),
    user: UserContext = Depends(require_user),
) -> ConfirmExecuteResponse:
    """Execute a previously surfaced destructive SQL statement after user approval.

    This is the non-LLM fast path paired with the `needs_confirmation` payload
    returned by the `execute_query` tool. It still enforces RBAC and connection
    access before writing.
    """
    from api.main import app_state
    from tools.db_tools import is_destructive

    registry = app_state["registry"]
    session_mgr = app_state["session_manager"]
    audit_logger = app_state.get("audit_logger")

    try:
        assert_tool_allowed(user, "execute_query")
        assert_conn_allowed(user, body.conn_name)
        verb = assert_sql_allowed(user, body.sql)
    except PermissionDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    if not is_destructive(verb):
        raise HTTPException(
            status_code=400,
            detail="confirm-execute is only for SQL statements that require explicit write confirmation.",
        )
    if not settings.sql_write_execution_enabled:
        _audit_chat(
            audit_logger,
            session_id=body.session_id,
            conn_name=body.conn_name,
            user_id=_resolve_user_id(),
            duration_ms=0,
            status="denied",
            error_msg="sql_write_execution_enabled=false",
            usage=None,
            detail=body.sql[:500],
        )
        raise HTTPException(
            status_code=403,
            detail="目前環境預設為 read-only DB Agent，寫入或 DDL SQL 已被安全政策阻擋。",
        )

    try:
        conn = registry.get(body.conn_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"連線 '{body.conn_name}' 不存在。") from exc

    t0 = time.monotonic()
    try:
        affected_rows = int(conn.execute_write(body.sql) or 0)
    except Exception as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        _audit_chat(
            audit_logger,
            session_id=body.session_id,
            conn_name=body.conn_name,
            user_id=_resolve_user_id(),
            duration_ms=duration_ms,
            status="error",
            error_msg=str(exc),
            usage=None,
            detail=body.sql[:500],
        )
        raise HTTPException(status_code=400, detail=f"SQL 執行失敗：{exc}") from exc

    duration_ms = int((time.monotonic() - t0) * 1000)
    answer = f"{verb} 已執行，影響 {affected_rows} 列。"

    try:
        session_mgr.add_turn(
            body.session_id,
            f"[確認執行 SQL]\n```sql\n{body.sql}\n```",
            answer,
            owner_user_id=_resolve_user_id(),
        )
    except Exception:
        logger.debug("confirm_execute add_turn failed", exc_info=True)

    _audit_chat(
        audit_logger,
        session_id=body.session_id,
        conn_name=body.conn_name,
        user_id=_resolve_user_id(),
        duration_ms=duration_ms,
        status="success",
        error_msg=None,
        usage=None,
        detail=body.sql[:500],
    )

    return ConfirmExecuteResponse(
        ok=True,
        verb=verb,
        affected_rows=affected_rows,
        answer=answer,
    )


def _audit_flow_trace(
    audit_logger,
    trace: dict,
    *,
    session_id: str,
    conn_name: str,
    user_id: int | None,
) -> None:
    if audit_logger is None:
        return
    import json as _json

    cur = get_current_user()
    try:
        audit_logger.log(
            "agent_flow_trace",
            session_id=session_id,
            user_id=user_id,
            api_key_prefix=getattr(cur, "api_key_prefix", None),
            conn_name=conn_name,
            detail=_json.dumps(trace, ensure_ascii=False, default=str),
            status="success",
            duration_ms=int(trace.get("latency_ms") or 0),
        )
    except Exception:
        logger.debug("agent flow trace audit failed", exc_info=True)


@router.post("/chat/refine-sql", response_model=RefineResponse)
@limiter.limit(settings.rate_limit_chat)
async def chat_refine_sql(
    request: Request,
    body: RefineSqlRequest = Body(...),
    user: UserContext = Depends(require_user),
) -> RefineResponse:
    """Execute a user-edited SQL directly, bypassing the agent.

    Applies RBAC (conn + SQL allow-list), row cap, executes the query,
    validates the result quality, saves the turn to session memory, and
    returns structured result with any data-quality warnings.
    """
    from api.main import app_state
    from core.validator import validate_sql_result
    from tools.db_tools import _apply_row_cap, is_destructive

    registry = app_state["registry"]
    session_mgr = app_state["session_manager"]
    audit_logger = app_state.get("audit_logger")

    # ── RBAC ──────────────────────────────────────────────────────────────────
    try:
        assert_conn_allowed(user, body.conn_name)
        verb = assert_sql_allowed(user, body.sql)
    except PermissionDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if is_destructive(verb) or verb not in {"SELECT", "WITH"}:
        raise HTTPException(
            status_code=403,
            detail="修正 SQL 僅允許 SELECT/WITH 查詢；寫入或 DDL SQL 已被安全政策阻擋。",
        )

    try:
        conn = registry.get(body.conn_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"連線 '{body.conn_name}' 不存在。") from exc

    # ── Execute ────────────────────────────────────────────────────────────────
    t0 = time.monotonic()
    try:
        capped_sql = _apply_row_cap(body.sql, user.role.max_rows_per_query)
        rows: list[dict] = conn.execute(capped_sql) or []
    except Exception as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        _audit_chat(
            audit_logger,
            session_id=body.session_id,
            conn_name=body.conn_name,
            user_id=_resolve_user_id(),
            duration_ms=duration_ms,
            status="error",
            error_msg=str(exc),
            usage=None,
            detail=body.sql[:500],
        )
        raise HTTPException(status_code=400, detail=f"SQL 執行失敗：{exc}") from exc

    duration_ms = int((time.monotonic() - t0) * 1000)

    # ── Validate result quality ────────────────────────────────────────────────
    warnings = validate_sql_result(rows, body.sql)

    # ── Format markdown table ──────────────────────────────────────────────────
    row_count = len(rows)
    if row_count == 0:
        answer = "查詢執行成功，返回 0 筆資料。"
    else:
        cols = list(rows[0].keys())
        header = " | ".join(cols)
        sep = " | ".join(["---"] * len(cols))
        display_rows = rows[:50]
        table_lines = [f"| {header} |", f"| {sep} |"]
        for row in display_rows:
            cells = " | ".join(str(row.get(c) if row.get(c) is not None else "") for c in cols)
            table_lines.append(f"| {cells} |")
        table_md = "\n".join(table_lines)

        suffix = (
            f"\n\n共 **{row_count:,}** 筆（顯示前 50 筆）。"
            if row_count > 50
            else f"\n\n共 **{row_count:,}** 筆。"
        )
        note_text = f"\n\n*備註：{body.note}*" if body.note else ""
        answer = f"{table_md}{suffix}{note_text}"

    # ── Save turn to session history ───────────────────────────────────────────
    user_content = (
        f"[修正 SQL]{' — ' + body.note if body.note else ''}\n```sql\n{body.sql}\n```"
    )
    try:
        session_mgr.add_turn(body.session_id, user_content, answer)
    except Exception:
        logger.debug("refine_sql add_turn failed", exc_info=True)

    _audit_chat(
        audit_logger,
        session_id=body.session_id,
        conn_name=body.conn_name,
        user_id=_resolve_user_id(),
        duration_ms=duration_ms,
        status="success",
        error_msg=None,
        usage=None,
        detail=body.sql[:500],
    )

    return RefineResponse(
        ok=True,
        answer=answer,
        rows=rows,
        row_count=row_count,
        warnings=warnings,
    )
