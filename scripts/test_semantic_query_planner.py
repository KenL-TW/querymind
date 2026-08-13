from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core.query_planner import build_query_plan_payload


def main() -> int:
    question = "列出近 30 天銷售金額最高的 10 項商品，含商品名稱、類別、銷售額與銷售件數。"
    payload = build_query_plan_payload(question)
    assert payload is not None
    plan = payload["query_plan"]
    sql = payload["sql"]

    assert plan["metric"] == "sales_amount"
    assert plan["time_range"] == "last_30_days"
    assert plan["dimensions"] == ["product", "category"]
    assert plan["limit"] == 10
    assert "units_sold" in plan["include_metrics"]
    assert "SUM(oi.subtotal)" in sql
    assert "SUM(oi.quantity)" in sql
    assert "o.ordered_at" in sql
    assert "oi.price" not in sql
    print("semantic query planner smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
