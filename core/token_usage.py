"""Token-usage helpers.

Extracts prompt/completion token counts from LangChain AIMessage objects across
provider differences (OpenAI ``usage_metadata``, Anthropic ``response_metadata``,
Bedrock streaming totals), and provides a small accumulator that the agent
streaming loop can feed once per ``on_chat_model_end`` event.

A small pricing table (USD per 1K tokens) is exposed so the admin dashboard can
render an estimated cost.  Numbers are kept conservative and explicitly editable
via ``LLM_PRICE_TABLE_JSON`` env var so they don't drift silently from reality.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


# Default rough pricing in USD per 1K tokens (input, output).
# Override with env var LLM_PRICE_TABLE_JSON='{"gpt-4o-mini":[0.00015,0.0006],...}'
_DEFAULT_PRICES: dict[str, tuple[float, float]] = {
    "gpt-4o": (0.0025, 0.01),
    "gpt-4o-mini": (0.00015, 0.0006),
    "gpt-4.1": (0.002, 0.008),
    "gpt-4.1-mini": (0.0004, 0.0016),
    "gpt-4.1-nano": (0.0001, 0.0004),
    "gpt-3.5-turbo": (0.0005, 0.0015),
    "claude-3-5-sonnet-20241022": (0.003, 0.015),
    "claude-3-5-haiku-20241022": (0.0008, 0.004),
    "claude-3-opus-20240229": (0.015, 0.075),
}


def _load_prices() -> dict[str, tuple[float, float]]:
    raw = os.environ.get("LLM_PRICE_TABLE_JSON", "").strip()
    if not raw:
        return dict(_DEFAULT_PRICES)
    try:
        parsed = json.loads(raw)
        out: dict[str, tuple[float, float]] = dict(_DEFAULT_PRICES)
        for k, v in parsed.items():
            if isinstance(v, (list, tuple)) and len(v) == 2:
                out[str(k)] = (float(v[0]), float(v[1]))
        return out
    except Exception:
        logger.warning("LLM_PRICE_TABLE_JSON parse failed; using defaults")
        return dict(_DEFAULT_PRICES)


PRICE_TABLE = _load_prices()


def estimate_cost_usd(model: str | None, prompt_tokens: int, completion_tokens: int) -> float:
    """Return USD cost or 0.0 if the model isn't in the table."""
    if not model:
        return 0.0
    key = model.lower()
    price = PRICE_TABLE.get(key) or PRICE_TABLE.get(key.split(":")[0])
    if price is None:
        # Try prefix match (e.g. "gpt-4o-2024-08-06" → "gpt-4o")
        for k, v in PRICE_TABLE.items():
            if key.startswith(k):
                price = v
                break
    if price is None:
        return 0.0
    p_in, p_out = price
    return round((prompt_tokens / 1000.0) * p_in + (completion_tokens / 1000.0) * p_out, 6)


def extract_usage(ai_msg: Any) -> tuple[int, int, int, Optional[str]]:
    """Return (prompt, completion, total, model_name) from a LangChain AI message.

    Tries multiple sources in order:
      1. ``usage_metadata`` (LangChain >=0.2 canonical: input_tokens/output_tokens/total_tokens)
      2. ``response_metadata['token_usage']`` (OpenAI legacy)
      3. ``response_metadata['usage']`` (Anthropic)
      4. ``additional_kwargs['usage']`` (Bedrock-style)
    Missing fields default to 0.  Model name comes from ``response_metadata['model_name']``
    or ``response_metadata['model']``.
    """
    if ai_msg is None:
        return 0, 0, 0, None

    prompt = completion = total = 0
    model = None

    um = getattr(ai_msg, "usage_metadata", None)
    if isinstance(um, dict):
        prompt = int(um.get("input_tokens", 0) or 0)
        completion = int(um.get("output_tokens", 0) or 0)
        total = int(um.get("total_tokens", 0) or 0) or (prompt + completion)

    rm = getattr(ai_msg, "response_metadata", None) or {}
    if isinstance(rm, dict):
        model = rm.get("model_name") or rm.get("model") or model
        if not total:
            tu = rm.get("token_usage") or rm.get("usage") or {}
            if isinstance(tu, dict):
                prompt = int(tu.get("prompt_tokens", tu.get("input_tokens", 0)) or 0)
                completion = int(tu.get("completion_tokens", tu.get("output_tokens", 0)) or 0)
                total = int(tu.get("total_tokens", 0) or 0) or (prompt + completion)

    if not total:
        ak = getattr(ai_msg, "additional_kwargs", None) or {}
        tu = ak.get("usage") if isinstance(ak, dict) else None
        if isinstance(tu, dict):
            prompt = int(tu.get("prompt_tokens", tu.get("input_tokens", 0)) or 0)
            completion = int(tu.get("completion_tokens", tu.get("output_tokens", 0)) or 0)
            total = int(tu.get("total_tokens", 0) or 0) or (prompt + completion)

    return prompt, completion, total, model


@dataclass
class UsageAccumulator:
    """Sum token usage across many AIMessage events within one agent invocation."""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    models: list[str] = field(default_factory=list)

    def add(self, ai_msg: Any) -> None:
        p, c, t, m = extract_usage(ai_msg)
        if not (p or c or t):
            return
        self.prompt_tokens += p
        self.completion_tokens += c
        self.total_tokens += t or (p + c)
        if m and m not in self.models:
            self.models.append(m)

    def as_log_kwargs(self) -> dict:
        if not self.total_tokens:
            return {}
        return {
            "prompt_tokens": self.prompt_tokens or None,
            "completion_tokens": self.completion_tokens or None,
            "total_tokens": self.total_tokens or None,
            "model_name": ",".join(self.models)[:128] if self.models else None,
        }


try:  # pragma: no cover
    from langchain_core.callbacks import BaseCallbackHandler as _BaseCBH  # type: ignore
except Exception:  # pragma: no cover
    _BaseCBH = object  # type: ignore


class UsageCallbackHandler(_BaseCBH):  # type: ignore[misc]
    """LangChain callback that pipes every ``on_llm_end`` into a UsageAccumulator.

    Subclasses ``BaseCallbackHandler`` so the callback manager dispatches LLM
    events even when the agent flattens its result messages.
    """

    raise_error = False
    ignore_chain = True
    ignore_agent = True
    ignore_retriever = True
    ignore_retry = True

    def __init__(self, accumulator: "UsageAccumulator") -> None:
        if _BaseCBH is not object:
            super().__init__()
        self.acc = accumulator

    # The signature is (response: LLMResult, **kwargs) — we accept anything.
    def on_llm_end(self, response: Any, **_: Any) -> None:  # pragma: no cover - thin glue
        try:
            generations = getattr(response, "generations", None) or []
            for gen_list in generations:
                for gen in gen_list:
                    msg = getattr(gen, "message", None)
                    if msg is not None:
                        self.acc.add(msg)
            # Fallback: aggregate llm_output token_usage if no messages carried it.
            if not self.acc.total_tokens:
                llm_output = getattr(response, "llm_output", None) or {}
                tu = (llm_output.get("token_usage") if isinstance(llm_output, dict) else None) or {}
                if tu:
                    p = int(tu.get("prompt_tokens", tu.get("input_tokens", 0)) or 0)
                    c = int(tu.get("completion_tokens", tu.get("output_tokens", 0)) or 0)
                    t = int(tu.get("total_tokens", 0) or 0) or (p + c)
                    if t:
                        self.acc.prompt_tokens += p
                        self.acc.completion_tokens += c
                        self.acc.total_tokens += t
                        m = llm_output.get("model_name") if isinstance(llm_output, dict) else None
                        if m and m not in self.acc.models:
                            self.acc.models.append(m)
        except Exception:
            logger.debug("UsageCallbackHandler.on_llm_end failed", exc_info=True)

    # Required no-op stubs so LangChain's BaseCallbackHandler protocol is satisfied
    # even though we don't inherit from it (avoiding an import dep here).
    def on_llm_start(self, *_: Any, **__: Any) -> None: ...
    def on_chat_model_start(self, *_: Any, **__: Any) -> None: ...
    def on_llm_new_token(self, *_: Any, **__: Any) -> None: ...
    def on_llm_error(self, *_: Any, **__: Any) -> None: ...
