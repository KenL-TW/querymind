from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

from langchain.agents import AgentExecutor
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, HumanMessage

from core.insights import generate_insights
from core.agent_flow import build_agent_flow_trace
from core.answer_planner import build_answer_plan
from core.intent import detect_intent, format_plan_for_prompt
from core.query_planner import build_query_plan_payload, format_query_plan_for_prompt
from core.summarizer import generate_followups
from core.token_usage import UsageAccumulator, UsageCallbackHandler
from core.tool_observability import ToolObservabilityHandler
from core.validator import validate_sql_result
from api.context import get_current_user

logger = logging.getLogger(__name__)


def _extract_text(chunk) -> str:
    """Extract plain text from an AIMessageChunk or similar object."""
    content = getattr(chunk, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return ""


async def run_agent_streaming(
    agent,
    user_message: str,
    conn_name: str,
    history: list[BaseMessage] | None = None,
    result_holder: dict | None = None,
    llm: BaseChatModel | None = None,
) -> AsyncGenerator[str, None]:
    """
    Run the agent using astream_events and yield SSE chunks.

    Events emitted:
        token        — streaming text token
        thought      — tool call decision (action + input)
        observation  — tool result
        finish       — final answer + tokens_used + followup_questions
        error        — exception message

    Args:
        result_holder: optional dict populated with {"output": <answer>}
                       so callers can persist the conversation turn.
        llm: optional LLM instance used to generate follow-up questions.
    """
    stream_input = _build_stream_input(agent, user_message, history)
    usage = UsageAccumulator()
    callbacks = [
        UsageCallbackHandler(usage),
        ToolObservabilityHandler(
            session_id=result_holder.get("session_id") if result_holder else None,
            default_conn_name=conn_name,
        ),
    ]

    # Detect intent up-front and expose to UI; also embedded into the agent input
    # via _build_stream_input so the LLM gets the plan hint for free.
    intent_plan = detect_intent(user_message)
    yield (
        f"event: intent\n"
        f"data: {json.dumps(intent_plan.to_dict(), ensure_ascii=False)}\n\n"
    )
    semantic_plan = build_query_plan_payload(user_message)
    if semantic_plan:
        yield (
            f"event: query_plan\n"
            f"data: {json.dumps(semantic_plan, ensure_ascii=False)}\n\n"
        )
    try:
        from api.main import app_state

        registry = app_state.get("registry")
        if registry is not None:
            flow_trace = build_agent_flow_trace(user_message, registry, conn_name)
            if result_holder is not None:
                result_holder["flow_trace"] = flow_trace
            _audit_flow_trace(flow_trace, conn_name, result_holder)
            yield (
                f"event: flow_trace\n"
                f"data: {json.dumps(flow_trace, ensure_ascii=False, default=str)}\n\n"
            )
    except Exception:
        logger.debug("agent flow trace failed in streaming path", exc_info=True)

    final_answer = ""
    # Track the last execute_query call to validate its result quality
    _last_query_sql: str = ""
    _last_query_rows: list[dict] = []
    _last_query_facts: dict = {}
    _last_dlp_report: dict = {}

    try:
        async for event in agent.astream_events(stream_input, version="v2", config={"callbacks": callbacks}):
            kind: str = event["event"]
            event_name: str = event.get("name", "")

            if kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                # OpenAI with stream_usage=True attaches usage_metadata to the
                # final chunk; accumulate eagerly so SSE clients get accurate totals.
                usage.add(chunk)
                text = _extract_text(chunk)
                if text:
                    yield (
                        f"event: token\n"
                        f"data: {json.dumps({'token': text}, ensure_ascii=False)}\n\n"
                    )

            elif kind == "on_tool_start":
                tool_input = event["data"].get("input", {})
                # Track the SQL being executed for later validation
                if event_name == "execute_query":
                    _last_query_sql = str(tool_input.get("sql", "") if isinstance(tool_input, dict) else tool_input)
                yield (
                    f"event: thought\n"
                    f"data: {json.dumps({'action': event_name, 'action_input': str(tool_input)}, ensure_ascii=False)}\n\n"
                )

            elif kind == "on_tool_end":
                raw = event["data"].get("output", "")
                obs = raw.content if hasattr(raw, "content") else str(raw)
                # Parse rows from execute_query result for validation
                if event_name == "execute_query" and obs:
                    try:
                        parsed = json.loads(obs)
                        if isinstance(parsed, list):
                            _last_query_rows = parsed
                        elif isinstance(parsed, dict) and "rows" in parsed:
                            _last_query_rows = parsed["rows"]
                            if isinstance(parsed.get("query_facts"), dict):
                                _last_query_facts = parsed["query_facts"]
                            if isinstance(parsed.get("dlp"), dict):
                                _last_dlp_report = parsed["dlp"]
                    except (json.JSONDecodeError, Exception):
                        pass
                yield (
                    f"event: observation\n"
                    f"data: {json.dumps({'observation': obs[:2000]}, ensure_ascii=False)}\n\n"
                )

            elif kind == "on_chat_model_end":
                ai_msg = event["data"]["output"]
                usage.add(ai_msg)
                # Only treat as final answer when model produces no tool calls
                tool_calls = getattr(ai_msg, "tool_calls", []) or []
                if not tool_calls:
                    content = getattr(ai_msg, "content", "")
                    if content:
                        final_answer = content

            elif kind == "on_chain_end" and "AgentExecutor" in event_name:
                output = event["data"].get("output", {})
                if isinstance(output, dict) and output.get("output"):
                    final_answer = str(output.get("output"))

    except Exception as exc:
        logger.exception("Agent streaming error")
        yield f"event: error\ndata: {json.dumps({'error': str(exc)})}\n\n"
        return

    if result_holder is not None:
        result_holder["output"] = final_answer
        result_holder["usage"] = {
            "prompt_tokens": usage.prompt_tokens,
            "completion_tokens": usage.completion_tokens,
            "total_tokens": usage.total_tokens,
            "model_name": ",".join(usage.models)[:128] if usage.models else None,
        }

    followups: list[str] = []
    if final_answer and llm is not None:
        try:
            followups = generate_followups(llm, user_message, final_answer)
        except Exception:
            logger.debug("followups generation failed in streaming path", exc_info=True)

    # Validate the last query result quality (best-effort, non-blocking)
    warnings: list[str] = []
    insights: list[str] = []
    answer_plan: dict = {}
    if _last_query_rows or _last_query_sql:
        try:
            warnings = validate_sql_result(_last_query_rows, _last_query_sql)
        except Exception:
            logger.debug("validate_sql_result failed in streaming path", exc_info=True)
        try:
            insights = generate_insights(_last_query_rows, _last_query_sql)
        except Exception:
            logger.debug("generate_insights failed in streaming path", exc_info=True)
        try:
            answer_plan = build_answer_plan(_last_query_rows, _last_query_sql)
        except Exception:
            logger.debug("build_answer_plan failed in streaming path", exc_info=True)

    yield (
        f"event: finish\n"
        f"data: {json.dumps({'answer': final_answer, 'tokens_used': usage.total_tokens, 'followup_questions': followups, 'warnings': warnings, 'insights': insights, 'answer_plan': answer_plan, 'query_facts': _last_query_facts, 'dlp': _last_dlp_report}, ensure_ascii=False)}\n\n"
    )


def _build_stream_input(agent, user_message: str, history: list[BaseMessage] | None) -> dict:
    # Augment the question with a heuristic intent plan so the LLM can route
    # to fine-grained tools without an extra round-trip.
    blocks: list[str] = []
    semantic_block = format_query_plan_for_prompt(user_message)
    if semantic_block:
        blocks.append(semantic_block)
    plan_block = format_plan_for_prompt(detect_intent(user_message))
    if plan_block:
        blocks.append(plan_block)
    augmented = f"{user_message}\n\n" + "\n\n".join(blocks) if blocks else user_message

    # AgentExecutor (legacy) expects {input, chat_history}; its ``input_keys`` is
    # frequently reported as an empty list because the wrapped Runnable's schema
    # is opaque, so detect it explicitly instead of relying on ``input_keys``.
    if isinstance(agent, AgentExecutor) or hasattr(agent, "agent"):
        return {"input": augmented, "chat_history": list(history or [])}
    input_keys = getattr(agent, "input_keys", None)
    if isinstance(input_keys, (list, tuple, set)) and "input" in input_keys:
        return {"input": augmented, "chat_history": list(history or [])}
    return {"messages": list(history or []) + [HumanMessage(content=augmented)]}


def _audit_flow_trace(trace: dict, conn_name: str, result_holder: dict | None) -> None:
    try:
        from api.main import app_state

        audit_logger = app_state.get("audit_logger")
        if audit_logger is None:
            return
        cur = get_current_user()
        try:
            user_id = int(cur.user_id)
        except (TypeError, ValueError):
            user_id = None
        audit_logger.log(
            "agent_flow_trace",
            session_id=result_holder.get("session_id") if result_holder else None,
            user_id=user_id,
            api_key_prefix=getattr(cur, "api_key_prefix", None),
            conn_name=conn_name,
            detail=json.dumps(trace, ensure_ascii=False, default=str),
            status="success",
            duration_ms=int(trace.get("latency_ms") or 0),
        )
    except Exception:
        logger.debug("agent flow trace audit failed", exc_info=True)

