"""Role-aware question template library.

提供「範本問題庫」給不熟 SQL 的業務/營運/主管使用：
每個範本是一句已調好的自然語言提問，可一鍵丟給 chat agent。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class QuestionTemplate:
    id: str
    title: str
    icon: str
    category: str          # 銷售 | 客戶 | 商品 | 庫存 | 行銷 | 客服 | 營運
    prompt: str
    roles: tuple[str, ...] # "*" 表示全角色可見
    description: str = ""
    metric_ids: tuple[str, ...] = ()
    default_plan: dict[str, Any] = field(default_factory=dict)
    chart_config: dict[str, Any] = field(default_factory=dict)


_TEMPLATES: tuple[QuestionTemplate, ...] = (
    # ── 銷售 ────────────────────────────────────────────────
    QuestionTemplate(
        id="sales_month_overview",
        title="本月銷售總覽",
        icon="📦",
        category="銷售",
        prompt="統計本月的銷售總金額、訂單數與平均客單價，並與上月做月對月比較。",
        roles=("*",),
        description="一眼看本月業績是否達標。",
        metric_ids=("sales_amount", "order_count", "avg_order_value"),
        default_plan={
            "metric": "sales_amount",
            "time_range": "current_month",
            "dimensions": [],
            "include_metrics": ["sales_amount", "order_count", "avg_order_value"],
            "chart_type": "table",
        },
    ),
    QuestionTemplate(
        id="sales_top10_products",
        title="TOP 10 熱銷商品",
        icon="🏆",
        category="銷售",
        prompt="列出近 30 天銷售金額最高的 10 項商品，含商品名稱、類別、銷售額與銷售件數。",
        roles=("*",),
        metric_ids=("sales_amount", "units_sold"),
        default_plan={
            "metric": "sales_amount",
            "time_range": "last_30_days",
            "dimensions": ["product", "category"],
            "sort": "sales_amount desc",
            "limit": 10,
            "chart_type": "bar",
            "include_metrics": ["sales_amount", "units_sold"],
        },
        chart_config={
            "type": "bar",
            "x": "product_name",
            "y": "sales_amount",
            "series": ["sales_amount", "units_sold"],
        },
    ),
    QuestionTemplate(
        id="sales_payment_split",
        title="付款方式佔比",
        icon="💳",
        category="銷售",
        prompt="統計近 90 天各付款方式的訂單數與金額佔比,並以圓餅圖呈現。",
        roles=("*",),
        metric_ids=("sales_amount", "order_count"),
        default_plan={
            "metric": "sales_amount",
            "time_range": "last_90_days",
            "dimensions": ["payment_method"],
            "sort": "sales_amount desc",
            "chart_type": "pie",
            "include_metrics": ["sales_amount", "order_count"],
        },
        chart_config={"type": "pie", "name": "payment_method", "value": "sales_amount"},
    ),
    QuestionTemplate(
        id="sales_cancel_rate",
        title="退單率分析",
        icon="📉",
        category="銷售",
        prompt="計算近 6 個月各月份的訂單取消率（status = cancelled），並以折線圖呈現走勢。",
        roles=("*",),
    ),
    # ── 客戶 ────────────────────────────────────────────────
    QuestionTemplate(
        id="customer_new_trend",
        title="新增會員趨勢",
        icon="👥",
        category="客戶",
        prompt="分析最近 12 個月每月新增會員數量的變化趨勢，標出最高與最低月份。",
        roles=("*",),
    ),
    QuestionTemplate(
        id="customer_tier_distribution",
        title="會員等級分布",
        icon="🎖️",
        category="客戶",
        prompt="依會員等級統計人數與平均累積消費金額，並列出每個等級的代表客戶 TOP 3。",
        roles=("*",),
    ),
    QuestionTemplate(
        id="customer_top_spenders",
        title="VIP 客戶 TOP 20",
        icon="💎",
        category="客戶",
        prompt="列出累積消費金額最高的 20 位客戶，含姓名、累積金額、訂單數與最近一次下單日期。",
        roles=("*",),
    ),
    # ── 商品 ────────────────────────────────────────────────
    QuestionTemplate(
        id="product_review_top10",
        title="商品評分排行",
        icon="⭐",
        category="商品",
        prompt="計算各商品的平均評分與評論數，篩出至少 5 則評論的商品中 TOP 10。",
        roles=("*",),
    ),
    QuestionTemplate(
        id="product_category_revenue",
        title="商品類別營收貢獻",
        icon="📊",
        category="商品",
        prompt="統計各商品類別近 90 天的銷售金額與佔比，並以長條圖呈現。",
        roles=("*",),
        metric_ids=("sales_amount",),
        default_plan={
            "metric": "sales_amount",
            "time_range": "last_90_days",
            "dimensions": ["category"],
            "sort": "sales_amount desc",
            "chart_type": "bar",
        },
        chart_config={"type": "bar", "x": "category_name", "y": "sales_amount"},
    ),
    # ── 庫存 ────────────────────────────────────────────────
    QuestionTemplate(
        id="inventory_low_stock",
        title="庫存不足預警",
        icon="⚠️",
        category="庫存",
        prompt="列出 stock 低於 reorder_point 的商品,依缺口量（reorder_point - stock）遞減排序。",
        roles=("*",),
    ),
    QuestionTemplate(
        id="inventory_movement",
        title="近期庫存異動",
        icon="🔁",
        category="庫存",
        prompt="統計近 30 天各商品的入庫與出庫總量,標示淨變化最大的 10 項商品。",
        roles=("*",),
    ),
    # ── 行銷 ────────────────────────────────────────────────
    QuestionTemplate(
        id="promo_usage",
        title="促銷活動成效",
        icon="🎯",
        category="行銷",
        prompt="統計每個促銷活動被使用的次數、帶來的營收與平均折扣,排序由營收最高到最低。",
        roles=("*",),
    ),
    # ── 客服 ────────────────────────────────────────────────
    QuestionTemplate(
        id="support_category_dist",
        title="客服工單分析",
        icon="🧑‍💼",
        category="客服",
        prompt="分析客服工單的類別分布、平均處理時數與未結案件數，標出處理最慢的類別。",
        roles=("*",),
    ),
    # ── 營運（管理者） ───────────────────────────────────────
    QuestionTemplate(
        id="ops_dept_target",
        title="部門業績達成率",
        icon="🏢",
        category="營運",
        prompt="依部門統計本季業績目標達成率（sales_targets 對比實際銷售），低於 80% 的標紅。",
        roles=("owner", "dba", "analyst", "editor"),
    ),
    QuestionTemplate(
        id="ops_data_health",
        title="資料健康度檢查",
        icon="🩺",
        category="營運",
        prompt="檢查各主要資料表的資料筆數、NULL 比例與最近一次更新時間，標出異常的表。",
        roles=("owner", "dba", "analyst"),
    ),
)


# ── Public API ───────────────────────────────────────────────────────────────


def list_categories() -> list[str]:
    """Return categories in insertion order, deduplicated."""
    seen: list[str] = []
    for t in _TEMPLATES:
        if t.category not in seen:
            seen.append(t.category)
    return seen


def list_templates(
    role: str | None = None,
    category: str | None = None,
) -> list[dict]:
    """Return templates visible to the given role (and optionally a category)."""
    out: list[dict] = []
    for t in _TEMPLATES:
        if role and "*" not in t.roles and role not in t.roles:
            continue
        if category and t.category != category:
            continue
        out.append(asdict(t))
    return out


def get_template(template_id: str) -> dict | None:
    for t in _TEMPLATES:
        if t.id == template_id:
            return asdict(t)
    return None
