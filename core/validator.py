"""Lightweight SQL result-set validation utilities.

Called after executing a SQL query to surface data-quality warnings to users.
All checks are heuristic, best-effort, and non-blocking — never raises exceptions.
"""
from __future__ import annotations

import re


def validate_sql_result(rows: list[dict], sql: str) -> list[str]:
    """Return a list of human-readable warning strings (繁體中文).

    Args:
        rows:  The list of row dicts returned by the connector.
        sql:   The SQL that was executed (used for pattern matching).

    Returns:
        A list of zero or more warning strings.  Empty list means no issues found.
    """
    warnings: list[str] = []

    sql_upper = sql.upper()
    is_select = bool(re.search(r'\bSELECT\b', sql_upper))
    has_aggregate = bool(re.search(r'\b(SUM|COUNT|AVG|MIN|MAX)\s*\(', sql_upper))
    has_group_by = bool(re.search(r'\bGROUP\s+BY\b', sql_upper))

    # ── 1. Empty result ─────────────────────────────────────────────────────
    if not rows:
        if is_select:
            warnings.append(
                "查詢返回 0 筆資料。請確認 WHERE 條件、日期範圍或資料是否存在。"
            )
        return warnings

    n = len(rows)
    cols = list(rows[0].keys())

    # ── 2. High NULL ratio in columns ───────────────────────────────────────
    if n >= 5:
        for col in cols:
            null_count = sum(1 for r in rows if r.get(col) is None)
            ratio = null_count / n
            if ratio > 0.5:
                pct = int(ratio * 100)
                warnings.append(
                    f"欄位「{col}」有 {null_count}/{n} ({pct}%) 筆為空值，"
                    "可能影響彙總或比較分析的準確性。"
                )

    # ── 3. Aggregate returns all-zero / all-null ─────────────────────────────
    if n == 1 and has_aggregate:
        values = list(rows[0].values())
        if all(v in (None, 0, 0.0, "0", "0.0") for v in values):
            warnings.append(
                "彙總查詢結果全為 0 或空值。請確認時間範圍、JOIN 條件是否正確。"
            )

    # ── 4. Aggregate without GROUP BY on multi-row result ───────────────────
    if n > 1 and has_aggregate and not has_group_by:
        warnings.append(
            "SQL 使用了彙總函數（SUM/COUNT 等）但沒有 GROUP BY，"
            "當前結果為多列，可能代表邏輯有誤或欄位選取不完整。"
        )

    # ── 5. Large result set — likely missing filter ─────────────────────────
    if n >= 500:
        warnings.append(
            f"查詢返回 {n:,} 筆資料（接近或達系統上限）。"
            "建議加入 WHERE 篩選條件以縮小範圍、提升精準度。"
        )

    # ── 6. Numeric columns with suspicious outliers ─────────────────────────
    if n >= 10:
        for col in cols:
            vals = [r.get(col) for r in rows if r.get(col) is not None]
            numeric_vals = []
            for v in vals:
                try:
                    numeric_vals.append(float(v))
                except (TypeError, ValueError):
                    pass
            if len(numeric_vals) >= 10:
                mean = sum(numeric_vals) / len(numeric_vals)
                if mean != 0:
                    # Check if max value is > 10x the mean (likely outlier)
                    mx = max(numeric_vals)
                    if mx > mean * 20:
                        warnings.append(
                            f"欄位「{col}」最大值（{mx:,.0f}）遠超平均值（{mean:,.1f}），"
                            "可能存在異常值，建議進一步確認。"
                        )
                        break  # Only warn once for outliers

    return warnings
