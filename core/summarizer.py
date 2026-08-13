"""
Session summarization & follow-up generation utilities.

These are lightweight, best-effort LLM helpers used after each conversation
turn to maintain a rolling session summary, extract key entities, and propose
follow-up questions. All failures degrade gracefully — they never block the
main chat flow.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage

logger = logging.getLogger(__name__)

# ── Title generation ─────────────────────────────────────────────────────────

_TITLE_PROMPT = (
    "請根據以下使用者的第一個問題，產生一個 6-14 個字、不含標點的簡短繁體中文標題，"
    "用來代表整個對話主題。只回覆標題本身，不要任何說明、引號或額外字元。\n\n"
    "問題：{question}"
)


def generate_session_title(llm: BaseChatModel, first_user_message: str) -> str:
    try:
        prompt = _TITLE_PROMPT.format(question=first_user_message[:300])
        resp = llm.invoke([HumanMessage(content=prompt)])
        title = (resp.content if hasattr(resp, "content") else str(resp)).strip()
        title = re.sub(r"[「」『』\"'`\n\r]+", "", title).strip()
        return title[:20] or first_user_message[:18]
    except Exception as exc:
        logger.warning("title generation failed: %s", exc)
        return first_user_message[:18]


# ── Rolling summary ──────────────────────────────────────────────────────────

_SUMMARY_PROMPT = (
    "你是一個對話摘要器。請將以下對話內容整合成一份 150-250 字的繁體中文摘要，"
    "重點包含：使用者目標、已查詢過的資料表/欄位、關鍵數據結論、未解決問題。\n\n"
    "{existing_block}"
    "## 待整合的對話\n{turns}\n\n"
    "請直接輸出摘要本身，不要任何前言。"
)


def summarize_overflow(
    llm: BaseChatModel,
    overflow_messages: list[BaseMessage],
    existing_summary: str = "",
) -> str:
    if not overflow_messages:
        return existing_summary
    try:
        turn_lines = []
        for m in overflow_messages[-30:]:  # keep payload bounded
            role = "User" if getattr(m, "type", "") == "human" else "Assistant"
            content = m.content[:800]
            turn_lines.append(f"{role}: {content}")
        existing_block = (
            f"## 既有摘要（請整併進新摘要）\n{existing_summary}\n\n"
            if existing_summary else ""
        )
        prompt = _SUMMARY_PROMPT.format(
            existing_block=existing_block,
            turns="\n".join(turn_lines),
        )
        resp = llm.invoke([HumanMessage(content=prompt)])
        text = (resp.content if hasattr(resp, "content") else str(resp)).strip()
        return text[:1500] or existing_summary
    except Exception as exc:
        logger.warning("summarize_overflow failed: %s", exc)
        return existing_summary


# ── Entity extraction (regex-based, no LLM call) ─────────────────────────────

_TABLE_NAME_RE = re.compile(r"`([a-zA-Z_][a-zA-Z0-9_]{1,40})`")
_FROM_TABLE_RE = re.compile(r"\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-zA-Z_][a-zA-Z0-9_]{1,40})", re.IGNORECASE)


def extract_entities_from_turn(user_msg: str, ai_msg: str) -> list[str]:
    """Pull table/column-like identifiers from an assistant answer."""
    found: set[str] = set()
    for pat in (_TABLE_NAME_RE, _FROM_TABLE_RE):
        for m in pat.finditer(ai_msg):
            tok = m.group(1)
            if 2 <= len(tok) <= 40 and not tok.isdigit():
                found.add(tok)
    return sorted(found)


def merge_entities(existing: list[str], new: list[str], limit: int = 40) -> list[str]:
    seen: list[str] = []
    for x in (new + existing):  # new items first (more recent)
        if x not in seen:
            seen.append(x)
        if len(seen) >= limit:
            break
    return seen


# ── Follow-up suggestions ────────────────────────────────────────────────────

_FOLLOWUP_PROMPT = (
    "你是一位資深資料分析顧問。基於使用者最後一個問題與你的回答，"
    "請提出 3 個最有商業價值的後續追問。每個追問必須：\n"
    "- 用繁體中文撰寫\n"
    "- 12-25 字\n"
    "- 是使用者本人會想問的下一步問題（不是你問使用者）\n"
    "- 跟剛才的對話有明確邏輯延續\n\n"
    "請只輸出 JSON 陣列，例如：[\"問題1\", \"問題2\", \"問題3\"]\n"
    "不要任何解釋或 markdown 區塊標記。\n\n"
    "## 使用者問題\n{user}\n\n## 你的回答\n{ai}\n"
)


def generate_followups(
    llm: BaseChatModel,
    user_message: str,
    ai_answer: str,
) -> list[str]:
    if not ai_answer:
        return []
    try:
        prompt = _FOLLOWUP_PROMPT.format(
            user=user_message[:500],
            ai=ai_answer[:1500],
        )
        resp = llm.invoke([HumanMessage(content=prompt)])
        text = (resp.content if hasattr(resp, "content") else str(resp)).strip()
        # Tolerate code fences
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
        arr = json.loads(text)
        if isinstance(arr, list):
            return [str(q).strip()[:60] for q in arr if str(q).strip()][:3]
    except Exception as exc:
        logger.warning("followups generation failed: %s", exc)
    return []
