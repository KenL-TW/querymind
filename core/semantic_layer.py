from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class SemanticMetric:
    id: str
    label: str
    description: str
    expression: str
    default_time_field: str
    unit: str
    aliases: tuple[str, ...]
    default_filters: tuple[str, ...] = ()


@dataclass(frozen=True)
class SemanticDimension:
    id: str
    label: str
    select_sql: str
    group_by_sql: str
    aliases: tuple[str, ...]
    chart_role: str = "category"


SALES_BASE_FROM = """
FROM order_items oi
JOIN orders o ON oi.order_id = o.id
JOIN products p ON oi.product_id = p.id
LEFT JOIN categories c ON p.category_id = c.id
""".strip()


METRICS: dict[str, SemanticMetric] = {
    "sales_amount": SemanticMetric(
        id="sales_amount",
        label="Sales Amount",
        description="Revenue recognised from order line subtotals. Always use order_items.subtotal, not order_items.price.",
        expression="SUM(oi.subtotal)",
        default_time_field="o.ordered_at",
        unit="currency",
        aliases=(
            "sales",
            "revenue",
            "gmv",
            "turnover",
            "銷售額",
            "銷售金額",
            "營收",
            "收入",
            "業績",
            "成交金額",
        ),
        default_filters=("o.status <> 'cancelled'",),
    ),
    "units_sold": SemanticMetric(
        id="units_sold",
        label="Units Sold",
        description="Total sold quantity from order_items.quantity.",
        expression="SUM(oi.quantity)",
        default_time_field="o.ordered_at",
        unit="items",
        aliases=("quantity", "units", "銷售件數", "件數", "銷量", "數量"),
        default_filters=("o.status <> 'cancelled'",),
    ),
    "order_count": SemanticMetric(
        id="order_count",
        label="Order Count",
        description="Distinct order count.",
        expression="COUNT(DISTINCT o.id)",
        default_time_field="o.ordered_at",
        unit="orders",
        aliases=("orders", "order count", "訂單數", "訂單量", "筆數"),
        default_filters=("o.status <> 'cancelled'",),
    ),
    "avg_order_value": SemanticMetric(
        id="avg_order_value",
        label="Average Order Value",
        description="Average order value computed from order total divided by distinct orders.",
        expression="SUM(o.total) / NULLIF(COUNT(DISTINCT o.id), 0)",
        default_time_field="o.ordered_at",
        unit="currency/order",
        aliases=("aov", "客單價", "平均客單價", "平均訂單金額"),
        default_filters=("o.status <> 'cancelled'",),
    ),
}


DIMENSIONS: dict[str, SemanticDimension] = {
    "product": SemanticDimension(
        id="product",
        label="Product",
        select_sql="p.name AS product_name",
        group_by_sql="p.name",
        aliases=("product", "products", "商品", "產品", "品項", "商品名稱"),
    ),
    "category": SemanticDimension(
        id="category",
        label="Category",
        select_sql="COALESCE(c.name, 'Uncategorized') AS category_name",
        group_by_sql="COALESCE(c.name, 'Uncategorized')",
        aliases=("category", "categories", "類別", "分類", "商品類別"),
    ),
    "payment_method": SemanticDimension(
        id="payment_method",
        label="Payment Method",
        select_sql="o.payment_method AS payment_method",
        group_by_sql="o.payment_method",
        aliases=("payment", "payment method", "付款方式", "支付方式"),
    ),
    "order_day": SemanticDimension(
        id="order_day",
        label="Order Day",
        select_sql="DATE_TRUNC('day', o.ordered_at)::date AS order_day",
        group_by_sql="DATE_TRUNC('day', o.ordered_at)::date",
        aliases=("day", "daily", "日期", "每日", "逐日"),
        chart_role="time",
    ),
    "order_month": SemanticDimension(
        id="order_month",
        label="Order Month",
        select_sql="DATE_TRUNC('month', o.ordered_at)::date AS order_month",
        group_by_sql="DATE_TRUNC('month', o.ordered_at)::date",
        aliases=("month", "monthly", "月份", "每月", "逐月"),
        chart_role="time",
    ),
    "customer": SemanticDimension(
        id="customer",
        label="Customer",
        select_sql="cu.name AS customer_name",
        group_by_sql="cu.name",
        aliases=("customer", "customers", "客戶", "會員"),
    ),
}


EXTRA_JOINS_BY_DIMENSION: dict[str, str] = {
    "customer": "LEFT JOIN customers cu ON o.customer_id = cu.id",
}


TERM_ALIASES: dict[str, str] = {
    "order_items.subtotal": "Line-level sales amount; use this for revenue aggregation.",
    "order_items.unit_price": "Line-level unit price; order_items has no price column.",
    "orders.ordered_at": "Canonical order timestamp for sales time filtering.",
    "products.price": "Current product list price, not historical transaction price.",
    "products.name": "Readable product name.",
    "categories.name": "Readable product category name.",
}


def get_metric(metric_id: str) -> SemanticMetric | None:
    return METRICS.get(metric_id)


def get_dimension(dimension_id: str) -> SemanticDimension | None:
    return DIMENSIONS.get(dimension_id)


def match_metric(text: str) -> str | None:
    haystack = (text or "").lower()
    best: str | None = None
    for metric_id, metric in METRICS.items():
        terms = (metric.id, metric.label, *metric.aliases)
        if any(str(term).lower() in haystack for term in terms):
            best = metric_id
            break
    if best is None and any(term in haystack for term in ("top", "最高", "排行", "排名", "熱銷")):
        best = "sales_amount"
    return best


def match_dimensions(text: str) -> list[str]:
    haystack = (text or "").lower()
    out: list[str] = []
    for dim_id, dim in DIMENSIONS.items():
        terms = (dim.id, dim.label, *dim.aliases)
        if any(str(term).lower() in haystack for term in terms):
            out.append(dim_id)
    return out


def semantic_layer_dict() -> dict[str, Any]:
    return {
        "metrics": {k: asdict(v) for k, v in METRICS.items()},
        "dimensions": {k: asdict(v) for k, v in DIMENSIONS.items()},
        "term_aliases": TERM_ALIASES,
        "facts": [
            "sales_amount MUST use SUM(order_items.subtotal).",
            "order_items has unit_price and subtotal; it does not have price.",
            "sales time filters MUST use orders.ordered_at.",
            "product/category reporting should join order_items -> products -> categories.",
        ],
    }


def build_semantic_brief() -> str:
    lines = [
        "Semantic layer rules:",
        "- sales_amount = SUM(oi.subtotal). Never use oi.price; order_items has no price column.",
        "- units_sold = SUM(oi.quantity).",
        "- order_count = COUNT(DISTINCT o.id).",
        "- default sales time field = o.ordered_at.",
        "- default sales FROM/JOIN pattern:",
        f"  {SALES_BASE_FROM.replace(chr(10), ' ')}",
        "- default sales filter excludes cancelled orders: o.status <> 'cancelled'.",
        "",
        "Supported dimensions:",
    ]
    for dim in DIMENSIONS.values():
        lines.append(f"- {dim.id}: {dim.select_sql}; group by {dim.group_by_sql}")
    return "\n".join(lines)
