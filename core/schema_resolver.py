from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

from sqlalchemy import inspect as sa_inspect

from core.schema_embedding import history_table_scores, rank_schema_by_embedding
from core.schema_observer import ensure_schema_observed
from core.semantic_layer import DIMENSIONS, METRICS, SALES_BASE_FROM, match_dimensions, match_metric
from db.registry import ConnectionRegistry


@dataclass
class ColumnCandidate:
    name: str
    type: str = ""
    score: float = 0.0
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TableCandidate:
    table: str
    score: float
    reasons: list[str] = field(default_factory=list)
    columns: list[ColumnCandidate] = field(default_factory=list)
    foreign_keys: list[dict[str, Any]] = field(default_factory=list)
    row_count: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "table": self.table,
            "score": round(self.score, 3),
            "reasons": self.reasons,
            "columns": [c.to_dict() for c in self.columns],
            "foreign_keys": self.foreign_keys,
            "row_count": self.row_count,
        }


SALES_TABLE_HINTS: dict[str, tuple[str, ...]] = {
    "order_items": ("line items", "quantity", "subtotal", "product_id", "sales_amount"),
    "orders": ("ordered_at", "order time", "status", "payment", "customer_id"),
    "products": ("product name", "category_id", "product dimension"),
    "categories": ("category name", "category dimension"),
    "customers": ("customer name", "customer dimension"),
}

TERM_TABLE_HINTS: dict[str, tuple[str, ...]] = {
    "商品": ("products", "order_items"),
    "產品": ("products", "order_items"),
    "品項": ("products", "order_items"),
    "類別": ("categories", "products"),
    "分類": ("categories", "products"),
    "訂單": ("orders", "order_items"),
    "客戶": ("customers", "orders"),
    "會員": ("customers", "orders"),
    "付款": ("orders",),
    "支付": ("orders",),
    "銷售": ("order_items", "orders", "products"),
    "營收": ("order_items", "orders"),
    "sales": ("order_items", "orders", "products"),
    "revenue": ("order_items", "orders"),
    "product": ("products", "order_items"),
    "category": ("categories", "products"),
    "order": ("orders", "order_items"),
    "customer": ("customers", "orders"),
}


def resolve_schema_context(
    question: str,
    registry: ConnectionRegistry,
    conn_name: str = "default",
    *,
    max_tables: int = 8,
    max_columns: int = 12,
) -> dict[str, Any]:
    """Rank likely tables/fields for a user question.

    This is deterministic and best-effort. It is intended as a grounding layer
    before SQL generation, so the agent can see relevant schema without loading
    the whole database.
    """
    schema_observation = _observe_schema(conn_name, registry)
    connector = registry.get(conn_name)
    inspector = sa_inspect(connector.engine)
    text = question or ""
    lowered = text.lower()
    metric_id = match_metric(text)
    dim_ids = match_dimensions(text)

    table_scores: dict[str, float] = {}
    table_reasons: dict[str, list[str]] = {}

    def bump(table: str, score: float, reason: str) -> None:
        table_scores[table] = table_scores.get(table, 0.0) + score
        table_reasons.setdefault(table, [])
        if reason not in table_reasons[table]:
            table_reasons[table].append(reason)

    tables = inspector.get_table_names()
    views = inspector.get_view_names()
    all_tables = list(dict.fromkeys([*tables, *views]))

    if metric_id:
        metric = METRICS.get(metric_id)
        bump("order_items", 3.0, f"metric `{metric_id}` uses order line facts")
        bump("orders", 2.5, f"metric `{metric_id}` uses order timestamp/status")
        if metric and "subtotal" in metric.expression:
            bump("order_items", 2.0, "sales amount maps to order_items.subtotal")

    for dim_id in dim_ids:
        dim = DIMENSIONS.get(dim_id)
        if dim_id == "product":
            bump("products", 2.4, "dimension `product` needs product name")
            bump("order_items", 1.6, "product joins through order_items.product_id")
        elif dim_id == "category":
            bump("categories", 2.4, "dimension `category` needs category name")
            bump("products", 1.4, "category joins through products.category_id")
        elif dim_id == "customer":
            bump("customers", 2.4, "dimension `customer` needs customer name")
            bump("orders", 1.4, "customer joins through orders.customer_id")
        elif dim_id in {"order_day", "order_month", "payment_method"}:
            bump("orders", 2.0, f"dimension `{dim_id}` is on orders")
        if dim:
            for token in _tokens(dim.select_sql):
                _bump_tables_with_column(inspector, all_tables, token, bump, f"dimension `{dim_id}` references `{token}`")

    for term, hinted_tables in TERM_TABLE_HINTS.items():
        if term.lower() in lowered:
            for table in hinted_tables:
                bump(table, 1.0, f"matched business term `{term}`")

    for table in all_tables:
        table_lc = table.lower()
        if table_lc in lowered or table_lc.rstrip("s") in lowered:
            bump(table, 1.5, "table name appears in question")
        try:
            columns = inspector.get_columns(table)
        except Exception:
            continue
        for col in columns:
            col_name = str(col.get("name", ""))
            col_lc = col_name.lower()
            if col_lc and col_lc in lowered:
                bump(table, 1.2, f"column `{col_name}` appears in question")
            for token in _tokens(text):
                if token and token == col_lc:
                    bump(table, 0.7, f"token matched column `{col_name}`")

    if metric_id in {"sales_amount", "units_sold", "order_count", "avg_order_value"}:
        for table, hints in SALES_TABLE_HINTS.items():
            bump(table, 0.8, "semantic sales query base table")
            for hint in hints:
                table_reasons.setdefault(table, [])
                if hint not in table_reasons[table]:
                    table_reasons[table].append(hint)

    embedding_signals = rank_schema_by_embedding(
        question,
        inspector,
        all_tables,
        table_hints=SALES_TABLE_HINTS,
    )
    for table, payload in embedding_signals.items():
        matched = ", ".join(payload.get("matched_terms") or [])
        reason = "local schema embedding match"
        if matched:
            reason = f"{reason} ({matched})"
        bump(table, min(float(payload.get("score") or 0), 2.0), reason)

    history_signals = history_table_scores(question, conn_name, all_tables)
    for table, payload in history_signals.items():
        hits = int(payload.get("hits") or 0)
        bump(table, min(float(payload.get("score") or 0), 1.8), f"similar successful query history ({hits} hits)")

    candidates: list[TableCandidate] = []
    for table, score in table_scores.items():
        if table not in all_tables:
            continue
        columns = _rank_columns(question, inspector, table, metric_id, dim_ids)[:max_columns]
        fks = _safe_foreign_keys(inspector, table)
        candidates.append(TableCandidate(
            table=table,
            score=score,
            reasons=table_reasons.get(table, []),
            columns=columns,
            foreign_keys=fks,
            row_count=_safe_row_count(connector, table),
        ))

    candidates.sort(key=lambda item: item.score, reverse=True)
    return {
        "conn_name": conn_name,
        "metric": metric_id,
        "dimensions": dim_ids,
        "candidate_tables": [c.to_dict() for c in candidates[:max_tables]],
        "join_hint": SALES_BASE_FROM if metric_id in {"sales_amount", "units_sold", "order_count", "avg_order_value"} else "",
        "schema_observation": schema_observation,
        "ranking_signals": {
            "schema_embedding": embedding_signals,
            "query_history": history_signals,
        },
    }


def _rank_columns(question: str, inspector, table: str, metric_id: str | None, dim_ids: list[str]) -> list[ColumnCandidate]:
    lowered = (question or "").lower()
    columns: list[ColumnCandidate] = []
    try:
        raw_columns = inspector.get_columns(table)
    except Exception:
        return []

    for col in raw_columns:
        name = str(col.get("name", ""))
        col_lc = name.lower()
        score = 0.0
        reasons: list[str] = []
        if col_lc in lowered:
            score += 2.0
            reasons.append("column name appears in question")
        if metric_id == "sales_amount" and name in {"subtotal", "unit_price", "quantity"}:
            score += 2.5
            reasons.append("sales metric field")
        if metric_id == "units_sold" and name == "quantity":
            score += 2.5
            reasons.append("units_sold metric field")
        if name in {"id", "order_id", "product_id", "category_id", "customer_id"}:
            score += 0.8
            reasons.append("join key")
        if "product" in dim_ids and name in {"name", "product_id", "category_id"}:
            score += 1.2
            reasons.append("product dimension")
        if "category" in dim_ids and name in {"name", "category_id"}:
            score += 1.2
            reasons.append("category dimension")
        if any(d in dim_ids for d in ("order_day", "order_month")) and name == "ordered_at":
            score += 1.5
            reasons.append("time dimension")
        if name in {"ordered_at", "status", "subtotal", "quantity", "name"}:
            score += 0.5
            reasons.append("common analytics field")

        if score > 0:
            columns.append(ColumnCandidate(name=name, type=str(col.get("type", "")), score=score, reasons=reasons))

    columns.sort(key=lambda item: item.score, reverse=True)
    return columns


def _bump_tables_with_column(inspector, tables: list[str], token: str, bump, reason: str) -> None:
    if not token or token in {"as", "coalesce", "date_trunc", "day", "month"}:
        return
    for table in tables:
        try:
            if any(str(c.get("name", "")).lower() == token.lower() for c in inspector.get_columns(table)):
                bump(table, 0.6, reason)
        except Exception:
            continue


def _safe_foreign_keys(inspector, table: str) -> list[dict[str, Any]]:
    try:
        return [
            {
                "columns": fk.get("constrained_columns", []),
                "ref_table": fk.get("referred_table", ""),
                "ref_columns": fk.get("referred_columns", []),
            }
            for fk in inspector.get_foreign_keys(table)
        ]
    except Exception:
        return []


def _safe_row_count(connector, table: str) -> int | None:
    try:
        rows = connector.execute(f'SELECT COUNT(*) AS cnt FROM "{table}"')
        return int(rows[0]["cnt"]) if rows else None
    except Exception:
        return None


def _tokens(text: str) -> list[str]:
    return [x.lower() for x in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", text or "")]


def _observe_schema(conn_name: str, registry: ConnectionRegistry) -> dict[str, Any]:
    try:
        from api.main import app_state

        observation = ensure_schema_observed(
            registry,
            conn_name,
            app_state.get("session_factory"),
            ttl_seconds=180,
        )
        if observation.get("status") in {"baseline", "changed"}:
            try:
                from api.routes.connections import _refresh_agent_prompt

                _refresh_agent_prompt()
            except Exception:
                pass
        return observation
    except Exception as exc:
        return {"status": "error", "error": str(exc)[:240], "conn_name": conn_name}


def _history_table_signals(conn_name: str, tables: list[str], limit: int = 200) -> dict[str, float]:
    """Best-effort table boosts from recent successful audit logs."""
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
        signals: dict[str, float] = {}
        haystack = "\n".join(str(r[0] or "").lower() for r in rows)
        for table in tables:
            count = haystack.count(table.lower())
            if count:
                signals[table] = min(0.25 * count, 1.5)
        return signals
    except Exception:
        return {}
