from __future__ import annotations

import json
import logging
from decimal import Decimal
from typing import Annotated

from langchain_core.tools import tool

from api.context import get_current_user
from core.rbac import (
    PermissionDeniedError,
    assert_conn_allowed,
    assert_sql_allowed,
    assert_tool_allowed,
)
from db.connector import DBConnector
from db.registry import ConnectionRegistry
from tools.db_tools import apply_row_cap

logger = logging.getLogger(__name__)

# Supported ECharts chart types
_CHART_TYPES = {"bar", "line", "pie", "scatter", "heatmap", "funnel"}


def _denied(msg: str) -> str:
    return json.dumps({"error": msg, "denied": True}, ensure_ascii=False)


def _coerce_value(v: object) -> float | int | str | None:
    """Convert DB-native numeric types (Decimal, etc.) to plain Python numbers."""
    if v is None:
        return None
    if isinstance(v, Decimal):
        f = float(v)
        return int(f) if f == int(f) else round(f, 4)
    if isinstance(v, (int, float)):
        return v
    # Fallback: try numeric coercion, otherwise keep as string
    try:
        f = float(v)  # type: ignore[arg-type]
        return int(f) if f == int(f) else round(f, 4)
    except (TypeError, ValueError):
        return str(v)


def _json_default(obj: object) -> object:
    """JSON encoder fallback: converts any DB-native type that slipped through."""
    if isinstance(obj, Decimal):
        f = float(obj)
        return int(f) if f == int(f) else round(f, 4)
    return str(obj)


def make_viz_tools(registry: ConnectionRegistry):
    """Return visualisation tools bound to the given registry."""

    @tool
    def query_to_chart(
        sql: Annotated[str, "SELECT SQL query — first column = category/label, second = value"],
        chart_type: Annotated[str, "Chart type: bar | line | pie | scatter | heatmap | funnel"] = "bar",
        title: Annotated[str, "Chart title"] = "",
        conn_name: Annotated[str, "Connection name from registry"] = "default",
    ) -> str:
        """
        Execute a SQL query and return an ECharts JSON configuration for visualisation.
        The first column is treated as the category/label axis; the second as the value axis.
        """
        if chart_type not in _CHART_TYPES:
            return f"Unsupported chart type '{chart_type}'. Choose from: {sorted(_CHART_TYPES)}"

        user = get_current_user()
        try:
            assert_tool_allowed(user, "query_to_chart")
            assert_conn_allowed(user, conn_name)
            assert_sql_allowed(user, sql)
        except PermissionDeniedError as exc:
            return _denied(str(exc))

        capped_sql = apply_row_cap(sql, user.role.max_rows_per_query)
        conn: DBConnector = registry.get(conn_name)
        rows = conn.execute(capped_sql)

        if not rows:
            return json.dumps({"error": "Query returned no rows."})

        keys = list(rows[0].keys())
        if len(keys) < 2:
            return json.dumps({"error": "Query must return at least two columns (label + value)."})

        labels = [str(row[keys[0]]) for row in rows]
        values = [_coerce_value(row[keys[1]]) for row in rows]

        if chart_type == "pie":
            series_data = [{"name": lbl, "value": val} for lbl, val in zip(labels, values)]
            option = {
                "title": {"text": title or keys[1]},
                "tooltip": {"trigger": "item"},
                "series": [{"type": "pie", "data": series_data}],
            }
        else:
            option = {
                "title": {"text": title or keys[1]},
                "tooltip": {},
                "xAxis": {"type": "category", "data": labels},
                "yAxis": {"type": "value"},
                "series": [{"type": chart_type, "data": values}],
            }

        return json.dumps(option, ensure_ascii=False, indent=2, default=_json_default)

    return [query_to_chart]
