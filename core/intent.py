"""
Lightweight intent detection — heuristic-only, no LLM round-trip.

Classifies a natural-language analytics question into:
  * intent     — the dominant analytical pattern (e.g. trend, ranking, ratio, …)
  * dimensions — surface terms describing the grouping dimension (產品, 客戶, 地區…)
  * time_hint  — recognised relative time window if any (本月 / 近 30 天 / 上季…)
  * needs_clarification — ambiguous quantifiers that the agent should clarify

Used as a planning aid:
  * agent calls it BEFORE writing SQL
  * UI displays the parsed intent for transparency
  * router/cache decisions can use the intent to pre-warm schema info
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Intent = Literal[
    "lookup",        # 「列出/查/找出 …」純查資料
    "ranking",       # TOP-N / 排行
    "trend",         # 趨勢 / 走勢 / 月對月變化
    "ratio",         # 比例 / 佔比 / 百分比
    "comparison",    # 與 X 比較 / 同比 / 環比
    "aggregation",   # 總和 / 平均 / 數量
    "distribution",  # 分佈 / 直方圖
    "anomaly",       # 異常 / 離群 / 突增
    "correlation",   # 相關性 / 是否相關
    "filter_check",  # 確認某條件下是否存在
    "unknown",
]


@dataclass(frozen=True)
class IntentPlan:
    intent: Intent
    dimensions: tuple[str, ...]
    time_hint: str | None
    needs_clarification: tuple[str, ...]
    suggested_tools: tuple[str, ...]
    suggested_steps: tuple[str, ...]

    def to_dict(self) -> dict:
        return {
            "intent": self.intent,
            "dimensions": list(self.dimensions),
            "time_hint": self.time_hint,
            "needs_clarification": list(self.needs_clarification),
            "suggested_tools": list(self.suggested_tools),
            "suggested_steps": list(self.suggested_steps),
        }


# ── Pattern tables ───────────────────────────────────────────────────────────

_PATTERNS: tuple[tuple[Intent, re.Pattern[str]], ...] = (
    ("ranking",      re.compile(r"top\s*\d+|前\s*\d+|排行|排名|最高|最低|最多|最少|前幾", re.IGNORECASE)),
    ("trend",        re.compile(r"趨勢|走勢|變化|每月|每日|每週|每年|逐月|逐日|逐年|月對月|日對日|series", re.IGNORECASE)),
    ("ratio",        re.compile(r"佔比|占比|比例|百分比|比率|%|占多少|占比例", re.IGNORECASE)),
    ("comparison",   re.compile(r"比較|對比|相比|同比|環比|yoy|mom|wow|vs\.?|對照", re.IGNORECASE)),
    ("distribution", re.compile(r"分佈|分布|區間|直方圖|histogram|區段", re.IGNORECASE)),
    ("anomaly",      re.compile(r"異常|離群|outlier|突增|突降|異樣|不正常", re.IGNORECASE)),
    ("correlation",  re.compile(r"相關|關聯|是否影響|影響因素|因果|correlate", re.IGNORECASE)),
    ("aggregation",  re.compile(r"總和|合計|總共|總數|平均|平均值|數量|有幾|多少筆|加總|sum|avg|count", re.IGNORECASE)),
    ("lookup",       re.compile(r"列出|查詢|顯示|找出|是哪些|有哪些|請給|請查|顯示一下", re.IGNORECASE)),
    ("filter_check", re.compile(r"是否|有沒有|存在|曾經|是否曾", re.IGNORECASE)),
)

_DIMENSION_KEYWORDS: dict[str, str] = {
    "客戶": "客戶", "會員": "客戶", "用戶": "客戶", "customer": "客戶",
    "產品": "產品", "商品": "產品", "品項": "產品", "product": "產品",
    "類別": "類別", "category": "類別",
    "供應商": "供應商", "supplier": "供應商",
    "部門": "部門", "department": "部門",
    "員工": "員工", "業務": "員工",
    "地區": "地區", "城市": "地區", "region": "地區",
    "付款": "付款方式", "支付": "付款方式",
    "訂單": "訂單", "order": "訂單",
    "促銷": "促銷活動", "活動": "促銷活動", "promotion": "促銷活動",
}

_TIME_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("本月",     re.compile(r"本月|這個?月")),
    ("本週",     re.compile(r"本週|這個?週|本周")),
    ("本季",     re.compile(r"本季|這一?季")),
    ("本年",     re.compile(r"今年|本年|今年度")),
    ("上月",     re.compile(r"上個?月")),
    ("上季",     re.compile(r"上一?季|上季")),
    ("去年",     re.compile(r"去年|前一?年")),
    ("近 N 天",  re.compile(r"近\s*(\d+)\s*天|過去\s*(\d+)\s*天|最近\s*(\d+)\s*天")),
    ("近 N 月",  re.compile(r"近\s*(\d+)\s*個?月|過去\s*(\d+)\s*個?月|最近\s*(\d+)\s*個?月")),
)

_AMBIGUOUS_TERMS: tuple[tuple[str, str], ...] = (
    ("最近", "「最近」未指定明確區間，請判斷使用「近 7 / 30 / 90 天」之一並在回覆中明示。"),
    ("一些", "「一些」量詞模糊，請判定具體筆數（建議 TOP 10）。"),
    ("最好", "「最好」可能是金額最高、評分最高或回購最多，請依問題語境選最合理的指標。"),
)


# ── Public API ───────────────────────────────────────────────────────────────

def detect_intent(question: str) -> IntentPlan:
    """Analyse a question and return an :class:`IntentPlan`."""
    q = (question or "").strip()

    # ── Intent ──────────────────────────────────────────────────────────────
    intent: Intent = "unknown"
    for label, pattern in _PATTERNS:
        if pattern.search(q):
            intent = label
            break

    # ── Dimensions ──────────────────────────────────────────────────────────
    dims: list[str] = []
    for kw, label in _DIMENSION_KEYWORDS.items():
        if kw.lower() in q.lower() and label not in dims:
            dims.append(label)

    # ── Time hint ───────────────────────────────────────────────────────────
    time_hint: str | None = None
    for label, pattern in _TIME_PATTERNS:
        m = pattern.search(q)
        if m:
            if "N" in label:
                # Capture the numeric group that matched
                num = next((g for g in m.groups() if g), None)
                time_hint = label.replace("N", str(num)) if num else label
            else:
                time_hint = label
            break

    # ── Ambiguity ───────────────────────────────────────────────────────────
    clarifications: list[str] = []
    for term, msg in _AMBIGUOUS_TERMS:
        if term in q:
            clarifications.append(msg)

    # ── Recommended tools / steps per intent ────────────────────────────────
    suggested_tools, suggested_steps = _plan_for_intent(intent, dims, time_hint)

    return IntentPlan(
        intent=intent,
        dimensions=tuple(dims),
        time_hint=time_hint,
        needs_clarification=tuple(clarifications),
        suggested_tools=tuple(suggested_tools),
        suggested_steps=tuple(suggested_steps),
    )


def _plan_for_intent(
    intent: Intent,
    dimensions: list[str],
    time_hint: str | None,
) -> tuple[list[str], list[str]]:
    tools: list[str] = ["list_tables"]
    steps: list[str] = []

    if intent == "ranking":
        tools += ["find_relations", "execute_query"]
        steps = [
            "確認相關資料表與聚合欄位",
            "用 ORDER BY + LIMIT 拿 TOP-N",
            "JOIN 外鍵把 ID 轉成可讀名稱",
        ]
    elif intent == "trend":
        tools += ["time_range", "execute_query"]
        steps = [
            "用 time_range 確認資料涵蓋區間",
            "依日/週/月 GROUP BY 計算指標",
            "輸出折線圖 JSON",
        ]
    elif intent == "ratio":
        tools += ["execute_query"]
        steps = [
            "用 CTE 算分子（指定條件）",
            "用 CTE 算分母（總體）",
            "輸出 `子集 / 總體 * 100` 並標 %",
        ]
    elif intent == "comparison":
        tools += ["compare_periods"]
        steps = [
            "判斷比較期間（同比 / 環比）",
            "呼叫 compare_periods 一次拿到絕對差 + 百分比變化",
        ]
    elif intent == "distribution":
        tools += ["column_stats", "execute_query"]
        steps = [
            "用 column_stats 看分佈統計（min/max/quartiles）",
            "如需直方圖，用 WIDTH_BUCKET 或 CASE 分區段",
        ]
    elif intent == "anomaly":
        tools += ["detect_outliers"]
        steps = [
            "用 detect_outliers 拿 IQR 區間外的紀錄",
            "回報筆數 + 範例 + 可能成因",
        ]
    elif intent == "correlation":
        tools += ["execute_query"]
        steps = [
            "確認兩個指標的時間粒度一致",
            "計算 CORR(x, y) 或實際組對比的差異",
        ]
    elif intent == "aggregation":
        tools += ["execute_query"]
        steps = [
            "確認要彙總的欄位與條件",
            "用 SUM/COUNT/AVG 一次取回",
        ]
    elif intent == "lookup":
        tools += ["execute_query"]
        steps = [
            "依條件 SELECT，必要時加 LIMIT",
            "ID 欄位 JOIN 取可讀名稱",
        ]
    elif intent == "filter_check":
        tools += ["execute_query"]
        steps = [
            "用 EXISTS / COUNT(*) 確認條件下是否有資料",
        ]
    else:
        tools += ["execute_query"]
        steps = [
            "從題目推敲所需資料表",
            "撰寫單一 SQL 取得結果",
        ]

    if time_hint:
        steps.insert(0, f"已偵測時間範圍：{time_hint}（請換算成具體日期）")
    if dimensions:
        steps.insert(0, f"已偵測分析維度：{', '.join(dimensions)}")

    return tools, steps


def format_plan_for_prompt(plan: IntentPlan) -> str:
    """Render an IntentPlan as a short Chinese block to inject into the prompt."""
    if plan.intent == "unknown" and not plan.dimensions and not plan.time_hint:
        return ""
    lines = ["## 本題建議執行計畫（由意圖識別器產生，僅供參考）"]
    lines.append(f"- 意圖類型：**{plan.intent}**")
    if plan.dimensions:
        lines.append(f"- 分析維度：{', '.join(plan.dimensions)}")
    if plan.time_hint:
        lines.append(f"- 時間範圍提示：{plan.time_hint}")
    if plan.needs_clarification:
        lines.append("- 模糊詞警告：")
        for msg in plan.needs_clarification:
            lines.append(f"  - {msg}")
    if plan.suggested_steps:
        lines.append("- 建議步驟：")
        for i, s in enumerate(plan.suggested_steps, 1):
            lines.append(f"  {i}. {s}")
    if plan.suggested_tools:
        lines.append(f"- 建議工具：{', '.join(plan.suggested_tools)}")
    return "\n".join(lines)
