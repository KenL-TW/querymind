from __future__ import annotations

import logging
from typing import Any

from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.agents import AgentAction
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import BaseTool

from core.intent import detect_intent, format_plan_for_prompt
from core.query_planner import format_query_plan_for_prompt
from core.token_usage import UsageAccumulator, UsageCallbackHandler
from core.tool_observability import ToolObservabilityHandler

logger = logging.getLogger(__name__)


def build_agent(
    tools: list[BaseTool],
    llm: BaseChatModel,
    system_prompt: str,
    verbose: bool = False,
    max_iterations: int = 20,
) -> Any:
    """Create a tool-calling agent executor compatible with the installed LangChain version."""
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
            MessagesPlaceholder(variable_name="agent_scratchpad"),
        ]
    )
    runnable = create_tool_calling_agent(
        llm=llm,
        tools=tools,
        prompt=prompt,
    )
    agent = AgentExecutor.from_agent_and_tools(
        agent=runnable,
        tools=tools,
        verbose=verbose,
        max_iterations=max_iterations,
        return_intermediate_steps=True,
    )
    logger.info("Agent created", extra={"num_tools": len(tools)})
    return agent


def invoke_agent(
    agent: Any,
    user_message: str,
    history: list[BaseMessage] | None = None,
    *,
    session_id: str | None = None,
    conn_name: str | None = None,
) -> dict[str, Any]:
    """
    Invoke the agent synchronously.

    Returns:
        {"output": str, "messages": list[BaseMessage], "usage": {...}}
    """
    chat_history: list[BaseMessage] = list(history or [])
    usage = UsageAccumulator()
    callbacks = [
        UsageCallbackHandler(usage),
        ToolObservabilityHandler(session_id=session_id, default_conn_name=conn_name),
    ]
    augmented_message = _augment_user_message(user_message)
    result = agent.invoke(
        {"input": augmented_message, "chat_history": chat_history},
        config={"callbacks": callbacks},
    )

    output = str(result.get("output", ""))
    output_messages: list[BaseMessage] = list(chat_history)
    output_messages.append(HumanMessage(content=user_message))

    steps = result.get("intermediate_steps", []) or []
    for idx, step in enumerate(steps):
        action, observation = _parse_intermediate_step(step)
        if action is None:
            continue
        output_messages.append(
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": action.tool,
                        "args": action.tool_input,
                        "id": f"tool_{idx}",
                        "type": "tool_call",
                    }
                ],
            )
        )
        output_messages.append(
            ToolMessage(
                content=str(observation),
                tool_call_id=f"tool_{idx}",
            )
        )

    output_messages.append(AIMessage(content=output))
    return {
        "output": output,
        "messages": output_messages,
        "usage": {
            "prompt_tokens": usage.prompt_tokens,
            "completion_tokens": usage.completion_tokens,
            "total_tokens": usage.total_tokens,
            "model_name": ",".join(usage.models)[:128] if usage.models else None,
        },
    }


def _augment_user_message(user_message: str) -> str:
    blocks: list[str] = []
    semantic_plan = format_query_plan_for_prompt(user_message)
    if semantic_plan:
        blocks.append(semantic_plan)
    intent_plan = format_plan_for_prompt(detect_intent(user_message))
    if intent_plan:
        blocks.append(intent_plan)
    return f"{user_message}\n\n" + "\n\n".join(blocks) if blocks else user_message


def _parse_intermediate_step(step: Any) -> tuple[AgentAction | None, Any]:
    if not isinstance(step, tuple) or len(step) < 2:
        return None, None
    action = step[0]
    observation = step[1]
    if not isinstance(action, AgentAction):
        return None, observation
    return action, observation


# ── Backward-compat alias ────────────────────────────────────────────────────
def build_agent_executor(
    tools: list[BaseTool],
    llm: BaseChatModel,
    system_prompt: str,
    verbose: bool = False,
    **kwargs,
) -> Any:
    """Alias for build_agent — kept so existing callers don't break immediately."""
    return build_agent(tools, llm, system_prompt, verbose=verbose)
