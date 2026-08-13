from __future__ import annotations

import json
import math
import re
from collections import Counter
from typing import Any


BUSINESS_TERMS: dict[str, tuple[str, ...]] = {
    "商品": ("product", "products", "product_name", "order_items"),
    "產品": ("product", "products", "product_name", "order_items"),
    "品項": ("product", "products", "order_items"),
    "類別": ("category", "categories", "category_name"),
    "分類": ("category", "categories", "category_name"),
    "訂單": ("order", "orders", "ordered_at", "order_items"),
    "銷售": ("sales", "subtotal", "quantity", "order_items", "orders"),
    "營收": ("revenue", "sales", "subtotal", "order_items"),
    "金額": ("amount", "subtotal", "sales", "order_items"),
    "件數": ("quantity", "units", "order_items"),
    "客戶": ("customer", "customers", "orders"),
    "會員": ("customer", "customers", "orders"),
    "時間": ("time", "date", "ordered_at", "orders"),
    "近": ("recent", "ordered_at", "orders"),
}


def rank_schema_by_embedding(
    question: str,
    inspector,
    tables: list[str],
    *,
    table_hints: dict[str, tuple[str, ...]] | None = None,
) -> dict[str, dict[str, Any]]:
    """Rank tables with a deterministic local lexical embedding.

    This is intentionally local and cheap. It gives the resolver a stable signal
    without requiring OpenAI embeddings or a vector database during local dev.
    """
    q_vec = _vectorize(question)
    if not q_vec:
        return {}

    ranked: dict[str, dict[str, Any]] = {}
    for table in tables:
        doc, terms = _schema_document(inspector, table, (table_hints or {}).get(table, ()))
        score = _cosine(q_vec, _vectorize(doc))
        if score <= 0:
            continue
        ranked[table] = {
            "score": min(score * 3.0, 2.0),
            "matched_terms": _matched_terms(q_vec, terms),
        }
    return ranked


def history_table_scores(question: str, conn_name: str, tables: list[str], limit: int = 200) -> dict[str, dict[str, Any]]:
    """Score tables from similar recent successful agent traces."""
    try:
        from api.main import app_state
        from storage.metadata_db import AuditLog

        sf = app_state.get("session_factory")
        if sf is None:
            return {}
        with sf() as session:
            rows = (
                session.query(AuditLog.detail)
                .filter(AuditLog.status == "success")
                .filter(AuditLog.conn_name == conn_name)
                .filter(AuditLog.event_type.in_(["agent_flow_trace", "tool_call", "agent_invoke"]))
                .order_by(AuditLog.created_at.desc())
                .limit(limit)
                .all()
            )
    except Exception:
        return {}

    q_vec = _vectorize(question)
    signals: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(rows):
        detail = str(row[0] or "")
        if not detail:
            continue
        similarity = _cosine(q_vec, _vectorize(_history_question_text(detail)))
        recency = max(0.15, 1.0 - (index / max(limit, 1)))
        table_hits = _tables_in_detail(detail, tables)
        if not table_hits:
            continue
        weight = max(0.12, similarity) * recency
        for table in table_hits:
            current = signals.setdefault(table, {"score": 0.0, "hits": 0})
            current["score"] = float(current["score"]) + weight
            current["hits"] = int(current["hits"]) + 1

    for table, payload in signals.items():
        payload["score"] = min(float(payload["score"]) * 0.6, 1.8)
    return signals


def _schema_document(inspector, table: str, hints: tuple[str, ...]) -> tuple[str, set[str]]:
    parts = [table, *_split_identifier(table), *hints]
    try:
        columns = inspector.get_columns(table)
    except Exception:
        columns = []
    for col in columns:
        name = str(col.get("name", ""))
        parts.extend([name, *_split_identifier(name), str(col.get("type", ""))])
    terms = set(_tokens(" ".join(parts)))
    return " ".join(parts), terms


def _history_question_text(detail: str) -> str:
    try:
        payload = json.loads(detail)
    except Exception:
        return detail[:2000]
    chunks: list[str] = []
    if isinstance(payload, dict):
        for step in payload.get("steps", []) or []:
            if not isinstance(step, dict):
                continue
            step_input = step.get("input")
            if isinstance(step_input, dict) and step_input.get("question"):
                chunks.append(str(step_input.get("question")))
        query_plan = payload.get("query_plan")
        if isinstance(query_plan, dict):
            chunks.append(json.dumps(query_plan, ensure_ascii=False))
    return "\n".join(chunks) or detail[:2000]


def _tables_in_detail(detail: str, tables: list[str]) -> list[str]:
    lowered = detail.lower()
    return [table for table in tables if re.search(rf"\b{re.escape(table.lower())}\b", lowered)]


def _vectorize(text: str) -> Counter[str]:
    tokens = _tokens(_expand_business_terms(text))
    return Counter(tokens)


def _tokens(text: str) -> list[str]:
    raw = re.findall(r"[A-Za-z_][A-Za-z0-9_]*|[\u4e00-\u9fff]{2,}", text.lower())
    out: list[str] = []
    for token in raw:
        out.append(token)
        out.extend(_split_identifier(token))
    return [token for token in out if token and len(token) > 1]


def _expand_business_terms(text: str) -> str:
    expanded = [text or ""]
    for term, synonyms in BUSINESS_TERMS.items():
        if term in (text or ""):
            expanded.extend(synonyms)
    return " ".join(expanded)


def _split_identifier(value: str) -> list[str]:
    return [part for part in re.split(r"[_\W]+", value.lower()) if part and part != value.lower()]


def _cosine(left: Counter[str], right: Counter[str]) -> float:
    if not left or not right:
        return 0.0
    common = set(left) & set(right)
    dot = sum(left[token] * right[token] for token in common)
    left_norm = math.sqrt(sum(v * v for v in left.values()))
    right_norm = math.sqrt(sum(v * v for v in right.values()))
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


def _matched_terms(question_vec: Counter[str], terms: set[str], limit: int = 6) -> list[str]:
    return [term for term in question_vec if term in terms][:limit]
