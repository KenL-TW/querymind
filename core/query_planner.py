from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from core.semantic_layer import (
    DIMENSIONS,
    EXTRA_JOINS_BY_DIMENSION,
    METRICS,
    SALES_BASE_FROM,
    get_dimension,
    get_metric,
    match_dimensions,
    match_metric,
)


@dataclass
class QueryPlan:
    metric: str
    time_range: str = "last_30_days"
    dimensions: list[str] = field(default_factory=list)
    filters: list[str] = field(default_factory=list)
    sort: str = ""
    limit: int | None = None
    chart_type: str = "table"
    include_metrics: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


_TOP_N_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"top\s*(\d+)", re.IGNORECASE),
    re.compile(r"前\s*(\d+)", re.IGNORECASE),
    re.compile(r"最高的?\s*(\d+)\s*(?:項|個|名|筆)?", re.IGNORECASE),
    re.compile(r"最多的?\s*(\d+)\s*(?:項|個|名|筆)?", re.IGNORECASE),
    re.compile(r"(\d+)\s*(?:項|個|名|筆)\s*(?:商品|產品|品項|客戶|會員)", re.IGNORECASE),
)
_LAST_DAYS_RE = re.compile(r"(?:近|最近|過去)\s*(\d+)\s*天")
_LAST_MONTHS_RE = re.compile(r"(?:近|最近|過去)\s*(\d+)\s*(?:個)?月")


def plan_from_question(question: str) -> QueryPlan | None:
    text = question or ""
    metric_id = match_metric(text)
    if metric_id is None:
        return None

    dims = match_dimensions(text)
    if "熱銷" in text and "product" not in dims:
        dims.insert(0, "product")
    if ("類別" in text or "分類" in text or "category" in text.lower()) and "category" not in dims:
        dims.append("category")
    if not dims and metric_id in {"sales_amount", "units_sold"}:
        dims = ["order_month"]

    time_range = _detect_time_range(text)
    limit = _detect_limit(text)
    is_ranking = any(term in text.lower() for term in ("top", "排行", "排名", "最高", "最多", "熱銷"))
    chart_type = "bar" if is_ranking else ("line" if any(d in {"order_day", "order_month"} for d in dims) else "table")

    include_metrics = [metric_id]
    if metric_id == "sales_amount" and any(term in text for term in ("件數", "銷售件數", "數量", "銷量")):
        include_metrics.append("units_sold")

    sort = f"{metric_id} desc" if is_ranking or metric_id else ""
    if limit is None and is_ranking:
        limit = 10

    return QueryPlan(
        metric=metric_id,
        time_range=time_range,
        dimensions=_dedupe_valid_dimensions(dims),
        sort=sort,
        limit=limit,
        chart_type=chart_type,
        include_metrics=_dedupe(include_metrics),
    )


def compile_query_plan(plan: QueryPlan | dict[str, Any]) -> str:
    plan_obj = coerce_query_plan(plan)
    metric = get_metric(plan_obj.metric)
    if metric is None:
        raise ValueError(f"Unsupported metric: {plan_obj.metric}")

    include_metric_ids = _dedupe(plan_obj.include_metrics or [plan_obj.metric])
    if plan_obj.metric not in include_metric_ids:
        include_metric_ids.insert(0, plan_obj.metric)

    dimensions = [get_dimension(d) for d in plan_obj.dimensions]
    if any(d is None for d in dimensions):
        missing = [plan_obj.dimensions[i] for i, d in enumerate(dimensions) if d is None]
        raise ValueError(f"Unsupported dimensions: {', '.join(missing)}")

    select_parts = [d.select_sql for d in dimensions if d is not None]
    group_parts = [d.group_by_sql for d in dimensions if d is not None]

    for metric_id in include_metric_ids:
        m = get_metric(metric_id)
        if m is None:
            raise ValueError(f"Unsupported metric: {metric_id}")
        select_parts.append(f"{m.expression} AS {metric_id}")

    joins = [
        EXTRA_JOINS_BY_DIMENSION[d.id]
        for d in dimensions
        if d is not None and d.id in EXTRA_JOINS_BY_DIMENSION
    ]
    where_parts = list(metric.default_filters)
    where_parts.extend(_time_filter(metric.default_time_field, plan_obj.time_range))
    where_parts.extend(_validated_filters(plan_obj.filters))

    sql = [
        "SELECT",
        "  " + ",\n  ".join(select_parts),
        SALES_BASE_FROM,
    ]
    if joins:
        sql.extend(joins)
    if where_parts:
        sql.append("WHERE " + "\n  AND ".join(where_parts))
    if group_parts:
        sql.append("GROUP BY " + ", ".join(group_parts))
    if plan_obj.sort:
        sort_metric, _, sort_dir = plan_obj.sort.partition(" ")
        if sort_metric not in include_metric_ids and sort_metric not in DIMENSIONS:
            sort_metric = plan_obj.metric
        sort_dir = sort_dir.strip().upper() if sort_dir else "DESC"
        if sort_dir not in {"ASC", "DESC"}:
            sort_dir = "DESC"
        sql.append(f"ORDER BY {sort_metric} {sort_dir}")
    if plan_obj.limit:
        sql.append(f"LIMIT {max(1, min(int(plan_obj.limit), 1000))}")
    return "\n".join(sql) + ";"


def coerce_query_plan(plan: QueryPlan | dict[str, Any] | str) -> QueryPlan:
    if isinstance(plan, QueryPlan):
        return plan
    if isinstance(plan, str):
        plan = json.loads(plan)
    return QueryPlan(
        metric=str(plan.get("metric") or "sales_amount"),
        time_range=str(plan.get("time_range") or "last_30_days"),
        dimensions=list(plan.get("dimensions") or []),
        filters=list(plan.get("filters") or []),
        sort=str(plan.get("sort") or ""),
        limit=plan.get("limit"),
        chart_type=str(plan.get("chart_type") or "table"),
        include_metrics=list(plan.get("include_metrics") or []),
    )


def build_query_plan_payload(question: str) -> dict[str, Any] | None:
    plan = plan_from_question(question)
    if plan is None:
        return None
    sql = compile_query_plan(plan)
    return {
        "query_plan": plan.to_dict(),
        "sql": sql,
        "semantic_warnings": _semantic_warnings(sql),
    }


def format_query_plan_for_prompt(question: str) -> str:
    payload = build_query_plan_payload(question)
    if not payload:
        return ""
    return (
        "## Semantic Query Plan\n"
        "Use this plan before writing SQL. Prefer the generated SQL unless the user asks for a different metric.\n"
        "```json\n"
        f"{json.dumps(payload['query_plan'], ensure_ascii=False, indent=2)}\n"
        "```\n"
        "Generated SQL:\n"
        "```sql\n"
        f"{payload['sql']}\n"
        "```"
    )


def _detect_time_range(text: str) -> str:
    m = _LAST_DAYS_RE.search(text)
    if m:
        return f"last_{m.group(1)}_days"
    m = _LAST_MONTHS_RE.search(text)
    if m:
        return f"last_{m.group(1)}_months"
    if "本月" in text:
        return "current_month"
    if "本季" in text:
        return "current_quarter"
    if "今年" in text or "本年" in text:
        return "current_year"
    return "last_30_days"


def _detect_limit(text: str) -> int | None:
    m = None
    for pattern in _TOP_N_PATTERNS:
        m = pattern.search(text)
        if m:
            break
    if m is None:
        return None
    try:
        n = int(m.group(1))
    except ValueError:
        return None
    if n <= 0:
        return None
    return min(n, 100)


def _time_filter(field: str, time_range: str) -> list[str]:
    m = re.fullmatch(r"last_(\d+)_days", time_range)
    if m:
        return [f"{field} >= NOW() - INTERVAL '{int(m.group(1))} days'"]
    m = re.fullmatch(r"last_(\d+)_months", time_range)
    if m:
        return [f"{field} >= NOW() - INTERVAL '{int(m.group(1))} months'"]
    if time_range == "current_month":
        return [f"{field} >= DATE_TRUNC('month', NOW())"]
    if time_range == "current_quarter":
        return [f"{field} >= DATE_TRUNC('quarter', NOW())"]
    if time_range == "current_year":
        return [f"{field} >= DATE_TRUNC('year', NOW())"]
    return []


def _semantic_warnings(sql: str) -> list[str]:
    warnings: list[str] = []
    lowered = sql.lower()
    if "oi.price" in lowered or "order_items.price" in lowered:
        warnings.append("Invalid semantic reference: order_items has no price column. Use order_items.unit_price or subtotal.")
    if "ordered_at" not in lowered and "sales_amount" in lowered:
        warnings.append("Sales queries should usually filter by orders.ordered_at.")
    return warnings


def _validated_filters(filters: list[str]) -> list[str]:
    out: list[str] = []
    for raw in filters:
        value = str(raw or "").strip()
        if not value:
            continue
        if ";" in value or "--" in value or "/*" in value or "*/" in value:
            raise ValueError("QueryPlan filters may not contain semicolons or SQL comments.")
        out.append(value)
    return out


def _dedupe_valid_dimensions(items: list[str]) -> list[str]:
    return [x for x in _dedupe(items) if x in DIMENSIONS]


def _dedupe(items: list[str]) -> list[str]:
    out: list[str] = []
    for item in items:
        if item and item not in out:
            out.append(item)
    return out
