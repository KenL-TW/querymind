from __future__ import annotations

import argparse
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from config.settings import settings


SEED_CITY = "RecentDemo"


def _require_count(conn, table: str) -> int:
    try:
        return int(conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar_one())
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            f"Table `{table}` is not ready. Run `python scripts/qm.py dev-init` first."
        ) from exc


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed recent demo sales for last-30-days analytics.")
    parser.add_argument("--db-url", default=settings.db_connections_dict.get("default", ""))
    parser.add_argument("--orders", type=int, default=90)
    parser.add_argument("--days", type=int, default=29)
    parser.add_argument("--seed", type=int, default=20260626)
    args = parser.parse_args()

    if not args.db_url.startswith("postgresql"):
        raise SystemExit("--db-url must be a PostgreSQL URL")
    if args.orders < 10:
        raise SystemExit("--orders must be at least 10")
    if args.days < 1 or args.days > 29:
        raise SystemExit("--days must be between 1 and 29")

    random.seed(args.seed)
    engine = create_engine(args.db_url)
    now = datetime.now(timezone.utc)

    with engine.begin() as conn:
        customer_count = _require_count(conn, "customers")
        product_count = _require_count(conn, "products")
        if customer_count == 0 or product_count == 0:
            raise RuntimeError("customers and products must contain seed data first.")

        products = conn.execute(text("""
            SELECT id, price
            FROM products
            WHERE is_active = true
            ORDER BY id
        """)).all()
        customer_ids = [
            row[0]
            for row in conn.execute(text("SELECT id FROM customers ORDER BY id")).all()
        ]

        # Make the script idempotent without touching user-created orders.
        conn.execute(text("""
            DELETE FROM order_items
            WHERE order_id IN (
                SELECT id FROM orders WHERE shipping_city = :seed_city
            )
        """), {"seed_city": SEED_CITY})
        conn.execute(text("""
            DELETE FROM orders
            WHERE shipping_city = :seed_city
        """), {"seed_city": SEED_CITY})

        current_order_id = conn.execute(text("SELECT COALESCE(MAX(id), 0) FROM orders")).scalar_one()
        product_weights = list(range(len(products), 0, -1))
        inserted_orders = 0
        inserted_items = 0

        for idx in range(args.orders):
            order_id = int(current_order_id) + idx + 1
            cust_id = random.choice(customer_ids)
            ordered_at = now - timedelta(
                days=random.randint(0, args.days),
                hours=random.randint(0, 23),
                minutes=random.randint(0, 59),
            )
            status = random.choices(
                ["completed", "shipped", "processing"],
                weights=[70, 20, 10],
            )[0]

            n_items = random.randint(1, 4)
            chosen_products = random.choices(products, weights=product_weights, k=n_items)
            deduped: dict[int, float] = {}
            for product_id, price in chosen_products:
                deduped[int(product_id)] = float(price)

            items = []
            subtotal = 0.0
            for product_id, base_price in deduped.items():
                qty = random.randint(1, 5)
                unit_price = round(base_price * random.uniform(0.92, 1.0), 2)
                item_subtotal = round(unit_price * qty, 2)
                subtotal += item_subtotal
                items.append((product_id, qty, unit_price, item_subtotal))

            discount_amt = round(subtotal * random.choice([0, 0, 0.05, 0.1]), 2)
            total = round(subtotal - discount_amt, 2)
            shipped_at = ordered_at + timedelta(days=random.randint(1, 3)) if status in {"completed", "shipped"} else None
            delivered_at = shipped_at + timedelta(days=random.randint(1, 5)) if status == "completed" else None

            conn.execute(text("""
                INSERT INTO orders (
                    id, customer_id, status, payment_method, shipping_city,
                    promotion_id, subtotal, discount_amt, total,
                    ordered_at, shipped_at, delivered_at
                )
                VALUES (
                    :id, :customer_id, :status, :payment_method, :shipping_city,
                    NULL, :subtotal, :discount_amt, :total,
                    :ordered_at, :shipped_at, :delivered_at
                )
            """), {
                "id": order_id,
                "customer_id": cust_id,
                "status": status,
                "payment_method": random.choice(["credit_card", "line_pay", "atm", "cod"]),
                "shipping_city": SEED_CITY,
                "subtotal": round(subtotal, 2),
                "discount_amt": discount_amt,
                "total": total,
                "ordered_at": ordered_at,
                "shipped_at": shipped_at,
                "delivered_at": delivered_at,
            })
            inserted_orders += 1

            for product_id, qty, unit_price, item_subtotal in items:
                conn.execute(text("""
                    INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal)
                    VALUES (:order_id, :product_id, :quantity, :unit_price, :subtotal)
                """), {
                    "order_id": order_id,
                    "product_id": product_id,
                    "quantity": qty,
                    "unit_price": unit_price,
                    "subtotal": item_subtotal,
                })
                inserted_items += 1

        conn.execute(text("""
            UPDATE customers c
            SET total_spent = COALESCE(s.total_spent, 0)
            FROM (
                SELECT customer_id, SUM(total) AS total_spent
                FROM orders
                WHERE status = 'completed'
                GROUP BY customer_id
            ) s
            WHERE c.id = s.customer_id
        """))
        conn.execute(text("""
            UPDATE customers c
            SET total_spent = 0
            WHERE NOT EXISTS (
                SELECT 1 FROM orders o
                WHERE o.customer_id = c.id AND o.status = 'completed'
            )
        """))
        conn.execute(text("""
            SELECT setval(pg_get_serial_sequence('orders', 'id'), (SELECT MAX(id) FROM orders))
        """))

    print(f"Seeded {inserted_orders} recent demo orders and {inserted_items} order items.")
    print(f"Marker: orders.shipping_city = {SEED_CITY}")


if __name__ == "__main__":
    main()
