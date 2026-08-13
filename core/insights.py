"""
Result-set insights — pure-Python analytics over the LAST query rows.

Complements `core/validator.py`:
  * validator → defensive warnings (空結果 / 大量 NULL / 異常離群)
  * insights  → constructive observations (極值/集中度/趨勢/類別不均)

These run in O(rows × cols), no DB round-trip, no LLM call.
Outputs short Traditional Chinese bullets injected into the SSE `finish` event.
"""
from __future__ import annotations

import re
from datetime import datetime
from statistics import mean, median, pstdev
from typing import Any


_DATE_FMTS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%d",
)


def _coerce_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        s = value.strip().replace(",", "")
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _coerce_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    for fmt in _DATE_FMTS:
        try:
            return datetime.strptime(s[:len(fmt) + 4], fmt)
        except (ValueError, TypeError):
            continue
    return None


def _format_num(x: float) -> str:
    """Compact number formatting (K / M / 整數逗號)."""
    if abs(x) >= 1_000_000:
        return f"{x/1_000_000:,.2f}M"
    if abs(x) >= 1_000:
        return f"{x:,.0f}"
    if x == int(x):
        return f"{int(x):,}"
    return f"{x:,.2f}"


def generate_insights(rows: list[dict], sql: str = "") -> list[str]:
    """Return a list of human-readable insight strings (繁體中文).

    Insights are *additive* — they never replace the agent's answer, only
    augment it.  Safe to call on any rows; returns [] if nothing notable.
    """
    insights: list[str] = []
    if not rows:
        return insights

    n = len(rows)
    cols = list(rows[0].keys())
    is_aggregate_query = bool(re.search(r"\b(SUM|COUNT|AVG|MIN|MAX)\s*\(", (sql or "").upper()))

    # ── 1. Row count summary ────────────────────────────────────────────────
    if n == 1:
        insights.append(f"結果共 1 列（單值彙總）。")
    elif n <= 20:
        insights.append(f"結果共 {n} 列。")
    else:
        insights.append(f"結果共 {n:,} 列，顯示部分樣本。")

    # ── 2. Per-column quantitative summary ──────────────────────────────────
    # Pick up to 3 most "interesting" numeric columns
    numeric_summary: list[tuple[str, dict]] = []
    for col in cols:
        vals: list[float] = []
        for r in rows:
            v = _coerce_number(r.get(col))
            if v is not None:
                vals.append(v)
        if len(vals) < max(2, n // 2):
            continue
        mn, mx = min(vals), max(vals)
        if mn == mx:
            continue  # all-equal column is not interesting
        s = {
            "min": mn,
            "max": mx,
            "mean": mean(vals),
            "median": median(vals),
            "sum": sum(vals),
            "stddev": pstdev(vals) if len(vals) > 1 else 0,
            "count": len(vals),
        }
        numeric_summary.append((col, s))

    # Rank by relative spread (max/mean) — show the most varied 2 columns
    numeric_summary.sort(
        key=lambda x: (x[1]["max"] / x[1]["mean"]) if x[1]["mean"] else 0,
        reverse=True,
    )
    for col, s in numeric_summary[:2]:
        line = (
            f"欄位「{col}」：最小 {_format_num(s['min'])}、最大 {_format_num(s['max'])}、"
            f"平均 {_format_num(s['mean'])}、中位數 {_format_num(s['median'])}"
        )
        if s["sum"] != 0 and s["count"] > 1:
            line += f"、合計 {_format_num(s['sum'])}"
        insights.append(line + "。")

    # ── 3. Concentration / Pareto ───────────────────────────────────────────
    if n >= 5 and numeric_summary and not is_aggregate_query:
        col, s = numeric_summary[0]
        # Sort descending and check top-20% contribution
        vals = sorted(
            (_coerce_number(r.get(col)) or 0 for r in rows),
            reverse=True,
        )
        top_k = max(1, n // 5)
        top_share = sum(vals[:top_k]) / s["sum"] if s["sum"] else 0
        if 0.5 <= top_share <= 1.0:
            pct = int(top_share * 100)
            insights.append(
                f"前 {top_k} 列（約前 20%）的「{col}」貢獻佔 {pct}%，"
                f"呈現{'高度' if top_share >= 0.8 else '中度'}集中（柏拉圖效應）。"
            )

    # ── 4. Categorical dominance ────────────────────────────────────────────
    if n >= 5:
        for col in cols:
            vals = [r.get(col) for r in rows]
            non_null = [v for v in vals if v not in (None, "")]
            if len(non_null) < n / 2:
                continue
            # Skip numeric/temporal columns for dominance check
            if any(isinstance(v, (int, float)) for v in non_null):
                continue
            counts: dict[str, int] = {}
            for v in non_null:
                key = str(v)
                counts[key] = counts.get(key, 0) + 1
            if not counts:
                continue
            top_key, top_cnt = max(counts.items(), key=lambda kv: kv[1])
            top_ratio = top_cnt / len(non_null)
            if top_ratio >= 0.6 and len(counts) >= 2:
                insights.append(
                    f"欄位「{col}」中「{top_key}」佔 {int(top_ratio * 100)}%，"
                    "為主要類別；其餘類別佔比相對偏低。"
                )
                break  # only one categorical insight to avoid spam

    # ── 5. Time-series trend (monotonicity) ─────────────────────────────────
    date_col, val_col = _detect_time_series(rows, cols)
    if date_col and val_col and n >= 4:
        series: list[tuple[datetime, float]] = []
        for r in rows:
            ts = _coerce_datetime(r.get(date_col))
            vv = _coerce_number(r.get(val_col))
            if ts and vv is not None:
                series.append((ts, vv))
        if len(series) >= 4:
            series.sort(key=lambda x: x[0])
            first, last = series[0][1], series[-1][1]
            if first != 0:
                change = (last - first) / abs(first) * 100
                direction = "上升" if change > 5 else ("下降" if change < -5 else "持平")
                insights.append(
                    f"「{val_col}」時序：自 {series[0][0].strftime('%Y-%m-%d')} 至 "
                    f"{series[-1][0].strftime('%Y-%m-%d')} 整體{direction}"
                    + (f"（變化 {change:+.1f}%）。" if direction != "持平" else "。")
                )

    return insights


def _detect_time_series(rows: list[dict], cols: list[str]) -> tuple[str | None, str | None]:
    """Pick one date column + one numeric column most likely forming a series."""
    date_col = None
    for col in cols:
        # Sample first non-null
        sample = next((r.get(col) for r in rows if r.get(col) is not None), None)
        if _coerce_datetime(sample) is not None:
            date_col = col
            break
    if not date_col:
        return None, None
    # Pick first numeric column other than the date itself
    for col in cols:
        if col == date_col:
            continue
        sample = next((r.get(col) for r in rows if r.get(col) is not None), None)
        if _coerce_number(sample) is not None:
            return date_col, col
    return date_col, None
