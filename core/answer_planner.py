from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from core.insights import generate_insights
from core.validator import validate_sql_result


@dataclass
class AnswerPlan:
    answer_type: str
    row_count: int
    table: bool = True
    chart_type: str = "table"
    chart_x: str = ""
    chart_y: str = ""
    columns: list[str] = field(default_factory=list)
    preview_rows: list[dict[str, Any]] = field(default_factory=list)
    summary_points: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    next_actions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def build_answer_plan(
    rows: list[dict],
    sql: str = "",
    *,
    question: str = "",
    diagnosis: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a presentation plan for the final answer."""
    row_count = len(rows or [])
    warnings = validate_sql_result(rows or [], sql)
    diagnosis = diagnosis or {}

    if row_count == 0:
        summary = ["查詢成功，但沒有符合條件的資料。"]
        for item in diagnosis.get("diagnostics", [])[:3]:
            summary.append(str(item))
        return AnswerPlan(
            answer_type="empty_result",
            row_count=0,
            table=False,
            chart_type="none",
            columns=[],
            preview_rows=[],
            summary_points=summary,
            warnings=warnings,
            next_actions=[
                "放寬時間範圍或移除部分 WHERE 條件重新查詢。",
                "檢查資料庫最新資料時間是否落在使用者指定期間內。",
            ],
        ).to_dict()

    cols = list(rows[0].keys()) if rows else []
    numeric_cols = [c for c in cols if _is_numeric_column(rows, c)]
    category_cols = [c for c in cols if c not in numeric_cols]
    time_cols = [c for c in cols if _looks_time_column(c)]

    chart_type = "table"
    chart_x = ""
    chart_y = ""
    if time_cols and numeric_cols:
        chart_type = "line"
        chart_x = time_cols[0]
        chart_y = numeric_cols[0]
    elif category_cols and numeric_cols and 2 <= row_count <= 50:
        chart_type = "bar"
        chart_x = category_cols[0]
        chart_y = numeric_cols[0]
    elif category_cols and numeric_cols and row_count <= 12 and any(term in (question or "") for term in ("占比", "佔比", "比例", "%")):
        chart_type = "pie"
        chart_x = category_cols[0]
        chart_y = numeric_cols[0]

    insights = generate_insights(rows or [], sql)
    summary = insights[:5] or [f"查詢返回 {row_count:,} 筆資料。"]
    preview_rows = [_json_safe_row(row) for row in (rows or [])[:50]]
    next_actions = []
    if chart_type != "table":
        next_actions.append("可將結果轉成圖表檢視趨勢或排名差距。")
    if row_count >= 50:
        next_actions.append("若要進一步分析，建議加入時間、類別或狀態條件縮小範圍。")

    return AnswerPlan(
        answer_type="ranked_table" if "order by" in (sql or "").lower() else "table",
        row_count=row_count,
        table=True,
        chart_type=chart_type,
        chart_x=chart_x,
        chart_y=chart_y,
        columns=cols,
        preview_rows=preview_rows,
        summary_points=summary,
        warnings=warnings,
        next_actions=next_actions,
    ).to_dict()


def _is_numeric_column(rows: list[dict], column: str) -> bool:
    checked = 0
    numeric = 0
    for row in rows[:50]:
        value = row.get(column)
        if value is None:
            continue
        checked += 1
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            numeric += 1
            continue
        try:
            float(str(value).replace(",", ""))
            numeric += 1
        except (TypeError, ValueError):
            pass
    return checked > 0 and numeric / checked >= 0.8


def _looks_time_column(column: str) -> bool:
    lowered = column.lower()
    return any(term in lowered for term in ("date", "day", "month", "time", "ordered_at", "_at"))


def _json_safe_row(row: dict[str, Any]) -> dict[str, Any]:
    safe: dict[str, Any] = {}
    for key, value in row.items():
        if value is None or isinstance(value, (str, int, float, bool)):
            safe[str(key)] = value
        else:
            safe[str(key)] = str(value)
    return safe
