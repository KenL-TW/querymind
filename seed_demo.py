"""Seed demo tables into PostgreSQL for local UI testing.

Creates and populates:
  - customers  (30 rows)
  - products   (20 rows, 5 categories)
  - orders     (400+ rows, spread over last 180 days, various statuses)

Usage:
  python seed_demo.py
  python seed_demo.py --db-url postgresql+psycopg2://qm_user:qm_pass@127.0.0.1:5433/querymind
"""
from __future__ import annotations

import argparse
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, text

from config.settings import settings

# ── Deterministic seed for reproducibility ────────────────────────────────────
random.seed(42)

# ── Master data ───────────────────────────────────────────────────────────────
CUSTOMERS = [
    ("Alice Chen",      "alice@example.com"),
    ("Bob Wang",        "bob@example.com"),
    ("Carol Lin",       "carol@example.com"),
    ("David Wu",        "david@example.com"),
    ("Eva Zhang",       "eva@example.com"),
    ("Frank Liu",       "frank@example.com"),
    ("Grace Huang",     "grace@example.com"),
    ("Henry Xu",        "henry@example.com"),
    ("Irene Zhou",      "irene@example.com"),
    ("Jack Sun",        "jack@example.com"),
    ("Karen Li",        "karen@example.com"),
    ("Leo Yang",        "leo@example.com"),
    ("Mary He",         "mary@example.com"),
    ("Nick Guo",        "nick@example.com"),
    ("Olivia Ma",       "olivia@example.com"),
    ("Peter Cao",       "peter@example.com"),
    ("Quinn Feng",      "quinn@example.com"),
    ("Rachel Ye",       "rachel@example.com"),
    ("Sam Cheng",       "sam@example.com"),
    ("Tina Luo",        "tina@example.com"),
    ("Uma Bai",         "uma@example.com"),
    ("Victor Jiang",    "victor@example.com"),
    ("Wendy Xia",       "wendy@example.com"),
    ("Xin Tang",        "xin@example.com"),
    ("Yuki Pan",        "yuki@example.com"),
    ("Zoe Zhu",         "zoe@example.com"),
    ("Aaron Qian",      "aaron@example.com"),
    ("Betty Song",      "betty@example.com"),
    ("Chris Han",       "chris@example.com"),
    ("Diana Fu",        "diana@example.com"),
]

# (name, category, price, stock)
PRODUCTS = [
    # Electronics
    ("Laptop Pro",       "Electronics",  8999.00, 30),
    ("Wireless Mouse",   "Electronics",   199.00, 200),
    ("Mechanical Keyboard", "Electronics", 799.00, 80),
    ("4K Monitor",       "Electronics",  3499.00, 25),
    ("USB-C Hub",        "Electronics",   299.00, 150),
    # Furniture
    ("Standing Desk",    "Furniture",    3200.00, 20),
    ("Ergonomic Chair",  "Furniture",    2800.00, 15),
    ("Bookshelf",        "Furniture",     699.00, 40),
    ("Filing Cabinet",   "Furniture",     999.00, 35),
    ("Monitor Stand",    "Furniture",     399.00, 60),
    # Clothing
    ("Winter Jacket",    "Clothing",      899.00, 100),
    ("Sports T-Shirt",   "Clothing",      199.00, 300),
    ("Denim Jeans",      "Clothing",      499.00, 150),
    ("Running Shoes",    "Clothing",      799.00, 120),
    ("Baseball Cap",     "Clothing",      149.00, 250),
    # Food & Beverage
    ("Organic Coffee",   "Food",          299.00, 500),
    ("Green Tea Set",    "Food",          189.00, 400),
    ("Protein Bar Pack", "Food",          149.00, 600),
    # Sports
    ("Yoga Mat",         "Sports",        399.00, 200),
    ("Dumbbell Set",     "Sports",       1299.00, 50),
]

STATUSES = ["completed", "completed", "completed", "shipped", "pending", "cancelled"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed QueryMind demo data in PostgreSQL.")
    parser.add_argument("--db-url", default=settings.db_connections_dict.get("default", ""),
                        help="Target PostgreSQL URL")
    args = parser.parse_args()

    if not args.db_url.startswith("postgresql"):
        raise ValueError("seed_demo.py requires a PostgreSQL connection URL.")

    engine = create_engine(args.db_url)
    now = datetime.now(timezone.utc)

    with engine.begin() as conn:
        # ── DDL ───────────────────────────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS customers (
              id         BIGSERIAL PRIMARY KEY,
              name       TEXT NOT NULL,
              email      TEXT UNIQUE NOT NULL,
              created_at TIMESTAMPTZ DEFAULT now()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS products (
              id       BIGSERIAL PRIMARY KEY,
              name     TEXT NOT NULL,
              category TEXT,
              price    NUMERIC(12,2) NOT NULL,
              stock    INTEGER DEFAULT 0
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS orders (
              id          BIGSERIAL PRIMARY KEY,
              customer_id BIGINT NOT NULL REFERENCES customers(id),
              product     TEXT NOT NULL,
              amount      NUMERIC(12,2) NOT NULL,
              status      TEXT DEFAULT 'pending',
              order_date  TIMESTAMPTZ DEFAULT now()
            )
        """))

        # ── Customers ─────────────────────────────────────────────────────────
        for name, email in CUSTOMERS:
            conn.execute(text("""
                INSERT INTO customers (name, email)
                VALUES (:name, :email)
                ON CONFLICT (email) DO NOTHING
            """), {"name": name, "email": email})

        # ── Products ──────────────────────────────────────────────────────────
        for p_name, category, price, stock in PRODUCTS:
            conn.execute(text("""
                INSERT INTO products (name, category, price, stock)
                SELECT :name, :category, :price, :stock
                WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = :name)
            """), {"name": p_name, "category": category, "price": price, "stock": stock})

        # ── Resolve IDs ───────────────────────────────────────────────────────
        cust_rows = conn.execute(text("SELECT id, email FROM customers")).fetchall()
        cust_ids = {email: cid for cid, email in cust_rows}

        prod_rows = conn.execute(text("SELECT name, price FROM products")).fetchall()
        prod_map = {name: float(price) for name, price in prod_rows}
        prod_names = list(prod_map.keys())

        # ── Orders (skip if already have 100+ orders) ─────────────────────────
        existing = conn.execute(text("SELECT COUNT(*) FROM orders")).scalar_one()
        if existing >= 100:
            print(f"  orders already has {existing} rows — skipping order seed.")
        else:
            # Build ~400 orders spread over last 180 days
            order_rows = []
            emails = [e for _, e in CUSTOMERS]
            for _ in range(420):
                email = random.choice(emails)
                cid = cust_ids[email]
                p_name = random.choice(prod_names)
                base_price = prod_map[p_name]
                # Apply occasional discount (0.8–1.0× multiplier)
                amount = round(base_price * random.uniform(0.8, 1.0), 2)
                status = random.choice(STATUSES)
                # Spread orders: weight toward recent 90 days
                days_ago = int(random.triangular(0, 180, 30))
                order_date = now - timedelta(days=days_ago,
                                             hours=random.randint(0, 23),
                                             minutes=random.randint(0, 59))
                order_rows.append((cid, p_name, amount, status, order_date))

            conn.execute(
                text("""
                    INSERT INTO orders (customer_id, product, amount, status, order_date)
                    VALUES (:cid, :product, :amount, :status, :order_date)
                """),
                [{"cid": r[0], "product": r[1], "amount": r[2],
                  "status": r[3], "order_date": r[4]} for r in order_rows],
            )
            print(f"  Inserted {len(order_rows)} orders.")

        # ── Summary ───────────────────────────────────────────────────────────
        for tbl in ("customers", "products", "orders"):
            n = conn.execute(text(f"SELECT COUNT(*) FROM {tbl}")).scalar_one()  # noqa: S608
            print(f"  {tbl}: {n} rows")

    print("Demo seed completed.")


if __name__ == "__main__":
    main()

