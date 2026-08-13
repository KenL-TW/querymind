"""Model routing: pick a 'cheap' vs 'strong' LLM tier per request.

Heuristic-only — no LLM round trip to classify.  Keeps cost low while still
giving the strong model to obviously complex turns (SQL keywords, long input,
explicit ``/strong`` prefix).

When ``settings.llm_routing_enabled`` is False, ``select_tier`` always returns
``"strong"`` so callers fall back to the existing single-model behaviour.
"""
from __future__ import annotations

import re
from typing import Literal

from config.settings import Settings

Tier = Literal["cheap", "strong"]

_SQL_KEYWORDS = re.compile(
    r"\b(select|from|join|where|group\s+by|having|window|with\s+\w+\s+as|union|intersect|"
    r"create|alter|drop|insert|update|delete|merge|explain|"
    r"\bjoin\b|\bsubquery\b|\bpivot\b|\bunpivot\b)\b",
    re.IGNORECASE,
)
_COMPLEX_HINTS = re.compile(
    r"(分析|解釋|為什麼|怎麼會|比較|比例|趨勢|預測|關聯|join|aggregate|"
    r"correlation|trend|forecast|breakdown|cohort|funnel)",
    re.IGNORECASE,
)


def select_tier(settings: Settings, user_message: str, *, history_len: int = 0) -> Tier:
    """Choose ``"cheap"`` or ``"strong"`` for the given turn.

    Rules (first match wins):
      1. Routing disabled → ``"strong"``.
      2. Explicit ``/cheap`` or ``/strong`` prefix → that tier.
      3. SQL keywords present → ``"strong"``.
      4. Message length > threshold characters → ``"strong"``.
      5. Complex analysis hints (Chinese + English) → ``"strong"``.
      6. Long running conversation (history_len >= 10 messages) → ``"strong"``.
      7. Otherwise → ``"cheap"``.
    """
    if not settings.llm_routing_enabled:
        return "strong"
    msg = (user_message or "").strip()
    low = msg.lower()
    if low.startswith("/cheap "):
        return "cheap"
    if low.startswith("/strong "):
        return "strong"
    if _SQL_KEYWORDS.search(msg):
        return "strong"
    if len(msg) > max(50, settings.llm_routing_complex_threshold_chars):
        return "strong"
    if _COMPLEX_HINTS.search(msg):
        return "strong"
    if history_len >= 10:
        return "strong"
    return "cheap"


def strip_tier_prefix(user_message: str) -> str:
    """Remove a leading ``/cheap`` or ``/strong`` slash command, if present."""
    if not user_message:
        return user_message
    for prefix in ("/cheap ", "/strong "):
        if user_message.lower().startswith(prefix):
            return user_message[len(prefix):]
    return user_message


def resolve_model_name(settings: Settings, tier: Tier) -> str:
    """Return the concrete model name to use for the given tier.

    Falls back to ``settings.openai_model`` when the tier-specific override is
    blank, so the routing feature is safe to enable even without setting both
    overrides.
    """
    if tier == "cheap" and settings.llm_model_cheap:
        return settings.llm_model_cheap
    if tier == "strong" and settings.llm_model_strong:
        return settings.llm_model_strong
    return settings.openai_model
