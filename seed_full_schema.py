"""
Full-schema demo seeder — aligns every table with the data dictionary.

Creates (or rebuilds) all tables from data/dictionary/default.json:
  departments, employees, categories, suppliers, products (rebuilt),
  customers (rebuilt), customer_addresses, promotions, orders (rebuilt),
  order_items, inventory_transactions, product_reviews,
  sales_targets, support_tickets

Usage:
  python seed_full_schema.py
  python seed_full_schema.py --db-url postgresql+psycopg2://qm_user:qm_pass@127.0.0.1:5433/querymind
  python seed_full_schema.py --drop-first   # drop & recreate all tables
"""
from __future__ import annotations

import argparse
import random
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import create_engine, text

from config.settings import settings

random.seed(42)

# ─────────────────────────────────────────────────────────────────────────────
# Master data
# ─────────────────────────────────────────────────────────────────────────────

DEPT_DATA = [
    (1, "業務部",   None,  18_000_000, "台北總部"),
    (2, "行銷部",   None,   8_000_000, "台北總部"),
    (3, "技術部",   None,  12_000_000, "新竹研發中心"),
    (4, "客服部",   None,   5_000_000, "台中客服中心"),
    (5, "財務部",   None,   4_000_000, "台北總部"),
    (6, "供應鏈部", None,   7_000_000, "桃園物流中心"),
]

EMPLOYEE_DATA = [
    # (name, dept_id, title, salary, hire_date, email)
    ("王大明", 1, "業務總監",  95000, "2018-03-01", "dm.wang@corp.com"),
    ("林小華", 1, "資深業務",  65000, "2019-06-15", "xiaohua.lin@corp.com"),
    ("張美玲", 1, "業務專員",  48000, "2021-02-20", "meiling.zhang@corp.com"),
    ("陳志豪", 1, "業務專員",  48000, "2022-07-01", "zhihao.chen@corp.com"),
    ("李雅婷", 2, "行銷經理",  72000, "2019-01-10", "yating.li@corp.com"),
    ("吳俊傑", 2, "數位行銷",  55000, "2020-09-01", "junjie.wu@corp.com"),
    ("黃淑芬", 3, "技術總監",  110000,"2017-05-01", "shufen.huang@corp.com"),
    ("劉建宏", 3, "資深工程師",80000, "2018-11-15", "jianhong.liu@corp.com"),
    ("蔡文軒", 3, "工程師",    62000, "2021-04-01", "wenxuan.cai@corp.com"),
    ("許雅雯", 4, "客服主任",  58000, "2019-08-01", "yawen.xu@corp.com"),
    ("鄭怡君", 4, "客服專員",  42000, "2020-03-15", "yijun.zheng@corp.com"),
    ("謝承翰", 4, "客服專員",  42000, "2021-10-01", "chenghan.xie@corp.com"),
    ("方淑惠", 5, "財務長",    95000, "2016-07-01", "shuhui.fang@corp.com"),
    ("周立仁", 5, "會計師",    65000, "2019-12-01", "liren.zhou@corp.com"),
    ("洪麗珍", 6, "供應鏈主任",70000, "2018-06-01", "lizhen.hong@corp.com"),
    ("邱庭瑋", 6, "採購專員",  50000, "2020-05-01", "tingwei.qiu@corp.com"),
]

CATEGORY_DATA = [
    (1, "電子產品",  None, "智慧型裝置、電腦週邊、配件"),
    (2, "電腦週邊",  1,    "滑鼠、鍵盤、螢幕等"),
    (3, "家具辦公",  None, "辦公室與家居傢俱"),
    (4, "服飾",      None, "男女裝、鞋款"),
    (5, "食品飲料",  None, "零食、飲品、保健品"),
    (6, "運動休閒",  None, "健身器材、戶外裝備"),
    (7, "美妝保養",  None, "護膚、彩妝"),
    (8, "書籍文具",  None, "書本、文具用品"),
]

SUPPLIER_DATA = [
    ("精英科技股份有限公司",   "陳明志", "02-2345-6789", "elite@elite.com.tw",   "台灣", 5, True),
    ("全球供應鏈有限公司",     "李惠芬", "02-8765-4321", "global@global.com.tw", "台灣", 4, True),
    ("優質家居股份有限公司",   "王建國", "04-2234-5678", "homeco@home.com.tw",   "台灣", 4, True),
    ("時尚服飾集團",           "張麗華", "02-3456-7890", "fashion@fashion.com",  "台灣", 3, True),
    ("健康食品股份有限公司",   "黃志偉", "03-1234-5678", "health@health.com.tw", "台灣", 5, True),
    ("韓國時尚進口商",         "Kim Minjun","82-2-1234-5678","korea@fashion.kr",  "韓國", 4, True),
    ("日本精品代理",           "Tanaka Yuki","81-3-1234-5678","japan@fine.jp",    "日本", 5, True),
    ("美國運動器材",           "John Smith","1-800-SPORTS","us@sports.com",       "美國", 4, False),
]

# (sku, name, cat_id, sup_id, price, cost, stock, reorder_point)
PRODUCT_DATA = [
    ("ELEC-001", "Laptop Pro 14吋",         1, 1, 32900, 20000, 25,  5),
    ("ELEC-002", "無線藍芽耳機",             1, 1,  3990,  1800, 120, 20),
    ("ELEC-003", "智慧手錶 Series X",        1, 7,  8990,  4500, 60,  10),
    ("PERI-001", "無線滑鼠",                 2, 1,   690,   250, 300, 50),
    ("PERI-002", "機械式鍵盤",               2, 1,  2490,   980, 80,  15),
    ("PERI-003", "27吋 4K 螢幕",             2, 1, 12900,  7500, 20,  5),
    ("PERI-004", "USB-C 集線器",             2, 2,   890,   350, 200, 30),
    ("FURN-001", "電動升降桌",               3, 3,  9800,  5200, 15,  3),
    ("FURN-002", "人體工學椅",               3, 3,  7200,  3800, 18,  3),
    ("FURN-003", "書架（六層）",             3, 3,  1890,   780, 45,  8),
    ("APRL-001", "防風衝鋒衣",               4, 4,  2490,  1100, 100, 15),
    ("APRL-002", "排汗運動短袖",             4, 4,   490,   180, 350, 50),
    ("APRL-003", "牛仔長褲",                 4, 4,  1290,   550, 180, 25),
    ("APRL-004", "慢跑鞋",                   4, 4,  2990,  1400, 130, 20),
    ("FOOD-001", "精品咖啡豆 1kg",           5, 5,   980,   420, 600, 80),
    ("FOOD-002", "有機燕麥片",               5, 5,   299,   100, 800, 100),
    ("FOOD-003", "乳清蛋白粉 2kg",           5, 5,  1890,   800, 250, 30),
    ("FOOD-004", "日本宇治抹茶禮盒",         5, 7,  1280,   580, 300, 40),
    ("SPRT-001", "瑜珈墊",                   6, 5,   790,   320, 250, 30),
    ("SPRT-002", "可調式啞鈴組",             6, 8,  5990,  2800, 35,  5),
    ("SPRT-003", "跳繩（計數器版）",         6, 5,   390,   140, 400, 60),
    ("COSM-001", "玻尿酸保濕面霜",           7, 7,  1580,   650, 200, 30),
    ("COSM-002", "胜肽緊緻精華",             7, 7,  2980,  1200, 150, 20),
]

CUSTOMER_DATA = [
    # (name, email, phone, gender, birth_date, city, tier)
    ("Alice Chen",      "alice@example.com",   "0912-345-001", "F", "1990-03-15", "台北市", "gold"),
    ("Bob Wang",        "bob@example.com",     "0912-345-002", "M", "1985-07-22", "新北市", "vip"),
    ("Carol Lin",       "carol@example.com",   "0912-345-003", "F", "1992-11-08", "桃園市", "silver"),
    ("David Wu",        "david@example.com",   "0912-345-004", "M", "1988-04-30", "台中市", "regular"),
    ("Eva Zhang",       "eva@example.com",     "0912-345-005", "F", "1995-09-17", "台南市", "silver"),
    ("Frank Liu",       "frank@example.com",   "0912-345-006", "M", "1980-12-25", "高雄市", "gold"),
    ("Grace Huang",     "grace@example.com",   "0912-345-007", "F", "1993-06-14", "台北市", "vip"),
    ("Henry Xu",        "henry@example.com",   "0912-345-008", "M", "1987-02-03", "新竹市", "regular"),
    ("Irene Zhou",      "irene@example.com",   "0912-345-009", "F", "1997-08-29", "台北市", "silver"),
    ("Jack Sun",        "jack@example.com",    "0912-345-010", "M", "1983-05-11", "新北市", "gold"),
    ("Karen Li",        "karen@example.com",   "0912-345-011", "F", "1991-01-19", "台中市", "regular"),
    ("Leo Yang",        "leo@example.com",     "0912-345-012", "M", "1989-10-07", "台北市", "vip"),
    ("Mary He",         "mary@example.com",    "0912-345-013", "F", "1994-03-23", "高雄市", "silver"),
    ("Nick Guo",        "nick@example.com",    "0912-345-014", "M", "1986-07-16", "桃園市", "regular"),
    ("Olivia Ma",       "olivia@example.com",  "0912-345-015", "F", "1996-12-02", "台北市", "gold"),
    ("Peter Cao",       "peter@example.com",   "0912-345-016", "M", "1984-04-28", "新北市", "silver"),
    ("Quinn Feng",      "quinn@example.com",   "0912-345-017", "F", "1998-09-13", "台南市", "regular"),
    ("Rachel Ye",       "rachel@example.com",  "0912-345-018", "F", "1990-06-05", "台中市", "vip"),
    ("Sam Cheng",       "sam@example.com",     "0912-345-019", "M", "1982-11-20", "台北市", "gold"),
    ("Tina Luo",        "tina@example.com",    "0912-345-020", "F", "1993-08-09", "新竹市", "silver"),
    ("Uma Bai",         "uma@example.com",     "0912-345-021", "F", "1999-02-14", "台北市", "regular"),
    ("Victor Jiang",    "victor@example.com",  "0912-345-022", "M", "1981-05-30", "高雄市", "gold"),
    ("Wendy Xia",       "wendy@example.com",   "0912-345-023", "F", "1995-10-18", "桃園市", "silver"),
    ("Xin Tang",        "xin@example.com",     "0912-345-024", "M", "1988-01-07", "台北市", "vip"),
    ("Yuki Pan",        "yuki@example.com",    "0912-345-025", "F", "1997-04-25", "新北市", "regular"),
    ("Zoe Zhu",         "zoe@example.com",     "0912-345-026", "F", "1991-07-12", "台中市", "silver"),
    ("Aaron Qian",      "aaron@example.com",   "0912-345-027", "M", "1986-03-08", "台南市", "regular"),
    ("Betty Song",      "betty@example.com",   "0912-345-028", "F", "1994-11-22", "台北市", "gold"),
    ("Chris Han",       "chris@example.com",   "0912-345-029", "M", "1989-06-17", "新北市", "silver"),
    ("Diana Fu",        "diana@example.com",   "0912-345-030", "F", "1992-09-03", "高雄市", "vip"),
]

PROMOTION_DATA = [
    ("SUMMER10", "夏季九折優惠", "percent", 10, 0,       500, 0, "2025-06-01", "2025-08-31", True),
    ("SAVE200",  "滿千折兩百",   "fixed",   200, 1000,   300, 0, "2025-07-01", "2025-12-31", True),
    ("VIP15",    "VIP 85折",     "percent", 15, 0,         0, 0, "2025-01-01", "2026-12-31", True),
    ("NEWBIE50", "新會員折五十", "fixed",   50,  0,       100, 0, "2025-03-01", "2025-12-31", True),
    ("TECH20",   "電子品8折",    "percent", 20, 500,      200, 0, "2025-09-01", "2025-10-31", False),
    ("XMAS100",  "聖誕滿兩千折百","fixed", 100, 2000,    500, 0, "2025-12-01", "2025-12-25", True),
]

CITIES = ["台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市", "新竹市", "嘉義市"]
PAYMENT_METHODS = ["信用卡", "LINE Pay", "街口支付", "超商取貨付款", "ATM轉帳"]
ORDER_STATUSES = ["completed", "completed", "completed", "shipped", "processing", "cancelled"]
REVIEW_TITLES = [
    "非常好用！", "物超所值", "品質不錯", "推薦購買", "還行，CP值普通",
    "出乎意料的好", "有點失望", "會再回購", "送禮自用兩相宜", "快速到貨",
]
REVIEW_BODIES = [
    "產品質量很好，使用起來非常順手，值得購買。",
    "包裝精美，送貨速度快，商品完全符合描述。",
    "性價比很高，已經是第三次購買了，還會繼續支持。",
    "功能強大，操作簡單，新手也很容易上手。",
    "商品不錯，但運送時間稍長，整體還是滿意。",
    "收到後立刻試用，效果超出預期，非常推薦！",
    "材質比圖片看起來稍差，但功能正常，尚可接受。",
    "已使用一個月，品質穩定，不負好評口碑。",
    "外觀漂亮，朋友看到都說好看，買到賺到。",
    "客服回應迅速，有問題馬上處理，服務很好。",
]
TICKET_SUBJECTS = {
    "refund": ["申請退款", "商品瑕疵要求退貨", "訂單金額有誤", "重複扣款退款申請"],
    "damage": ["收到破損商品", "包裝嚴重凹陷", "商品功能異常", "螢幕有裂縫"],
    "delay": ["訂單超時未到", "物流資訊沒更新", "預估到達日已過", "急件請協助追蹤"],
    "inquiry": ["查詢訂單狀態", "詢問商品規格", "確認出貨時間", "問折扣碼是否有效"],
    "other":   ["帳戶問題", "地址修改請求", "發票抬頭更改", "要求更換顏色"],
}


# ─────────────────────────────────────────────────────────────────────────────
# DDL helpers
# ─────────────────────────────────────────────────────────────────────────────

DDL_STATEMENTS = """
CREATE TABLE IF NOT EXISTS departments (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(64)  NOT NULL,
    manager_id INTEGER,
    budget     NUMERIC(14,2),
    location   VARCHAR(128)
);

CREATE TABLE IF NOT EXISTS employees (
    id        SERIAL PRIMARY KEY,
    name      VARCHAR(64)  NOT NULL,
    dept_id   INTEGER REFERENCES departments(id),
    title     VARCHAR(64),
    salary    NUMERIC(10,2),
    hire_date DATE,
    email     VARCHAR(128) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(64) NOT NULL,
    parent_id   INTEGER REFERENCES categories(id),
    description TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(128) NOT NULL,
    contact_name VARCHAR(64),
    phone        VARCHAR(32),
    email        VARCHAR(128),
    country      VARCHAR(64),
    rating       SMALLINT CHECK (rating BETWEEN 1 AND 5),
    is_active    BOOLEAN DEFAULT TRUE
);

DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS inventory_transactions;
DROP TABLE IF EXISTS product_reviews;
DROP TABLE IF EXISTS support_tickets;
DROP TABLE IF EXISTS sales_targets;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS promotions;
DROP TABLE IF EXISTS customer_addresses;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS products;

CREATE TABLE customers (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    email       VARCHAR(128) UNIQUE NOT NULL,
    phone       VARCHAR(32),
    gender      CHAR(1) CHECK (gender IN ('M','F')),
    birth_date  DATE,
    city        VARCHAR(64),
    tier        VARCHAR(16) DEFAULT 'regular'
                CHECK (tier IN ('regular','silver','gold','vip')),
    total_spent NUMERIC(14,2) DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE customer_addresses (
    id          BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id),
    label       VARCHAR(16) DEFAULT 'home' CHECK (label IN ('home','work','other')),
    city        VARCHAR(64),
    district    VARCHAR(64),
    address     TEXT,
    is_default  BOOLEAN DEFAULT FALSE
);

CREATE TABLE products (
    id            BIGSERIAL PRIMARY KEY,
    sku           VARCHAR(32) UNIQUE NOT NULL,
    name          VARCHAR(256) NOT NULL,
    category_id   INTEGER REFERENCES categories(id),
    supplier_id   INTEGER REFERENCES suppliers(id),
    price         NUMERIC(12,2) NOT NULL,
    cost          NUMERIC(12,2),
    stock         INTEGER DEFAULT 0,
    reorder_point INTEGER DEFAULT 10,
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE promotions (
    id             SERIAL PRIMARY KEY,
    code           VARCHAR(32) UNIQUE NOT NULL,
    description    TEXT,
    discount_type  VARCHAR(16) CHECK (discount_type IN ('percent','fixed')),
    discount_value NUMERIC(10,2),
    min_order_amt  NUMERIC(12,2) DEFAULT 0,
    max_uses       INTEGER DEFAULT 0,
    used_count     INTEGER DEFAULT 0,
    start_date     DATE,
    end_date       DATE,
    is_active      BOOLEAN DEFAULT TRUE
);

CREATE TABLE orders (
    id             BIGSERIAL PRIMARY KEY,
    customer_id    BIGINT NOT NULL REFERENCES customers(id),
    status         VARCHAR(16) DEFAULT 'processing'
                   CHECK (status IN ('completed','shipped','processing','cancelled')),
    payment_method VARCHAR(32),
    shipping_city  VARCHAR(64),
    promotion_id   INTEGER REFERENCES promotions(id),
    subtotal       NUMERIC(14,2),
    discount_amt   NUMERIC(14,2) DEFAULT 0,
    total          NUMERIC(14,2),
    ordered_at     TIMESTAMPTZ DEFAULT now(),
    shipped_at     TIMESTAMPTZ,
    delivered_at   TIMESTAMPTZ
);

CREATE TABLE order_items (
    id         BIGSERIAL PRIMARY KEY,
    order_id   BIGINT NOT NULL REFERENCES orders(id),
    product_id BIGINT NOT NULL REFERENCES products(id),
    quantity   INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2) NOT NULL,
    subtotal   NUMERIC(14,2) NOT NULL
);

CREATE TABLE inventory_transactions (
    id         BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id),
    txn_type   VARCHAR(16) CHECK (txn_type IN ('purchase','sale','return','adjustment')),
    qty_change INTEGER NOT NULL,
    note       TEXT,
    created_by INTEGER REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE product_reviews (
    id          BIGSERIAL PRIMARY KEY,
    product_id  BIGINT NOT NULL REFERENCES products(id),
    customer_id BIGINT NOT NULL REFERENCES customers(id),
    rating      SMALLINT CHECK (rating BETWEEN 1 AND 5),
    title       VARCHAR(128),
    body        TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sales_targets (
    id            SERIAL PRIMARY KEY,
    dept_id       INTEGER NOT NULL REFERENCES departments(id),
    year          SMALLINT NOT NULL,
    quarter       SMALLINT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
    target_amt    NUMERIC(14,2),
    actual_amt    NUMERIC(14,2) DEFAULT 0,
    target_orders INTEGER,
    actual_orders INTEGER DEFAULT 0,
    UNIQUE (dept_id, year, quarter)
);

CREATE TABLE support_tickets (
    id          BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id),
    order_id    BIGINT REFERENCES orders(id),
    category    VARCHAR(16) CHECK (category IN ('refund','damage','delay','inquiry','other')),
    priority    VARCHAR(8)  DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
    status      VARCHAR(16) DEFAULT 'open'
                CHECK (status IN ('open','in_progress','resolved','closed')),
    subject     VARCHAR(256),
    assigned_to INTEGER REFERENCES employees(id),
    created_at  TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ
);
"""


# ─────────────────────────────────────────────────────────────────────────────
# Seeder
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-url", default=settings.db_connections_dict.get("default", ""))
    parser.add_argument("--drop-first", action="store_true",
                        help="Drop existing tables before recreating (WARNING: data loss)")
    args = parser.parse_args()

    if not args.db_url.startswith("postgresql"):
        raise SystemExit("--db-url must be a PostgreSQL URL")

    engine = create_engine(args.db_url)
    now = datetime.now(timezone.utc)

    with engine.begin() as conn:

        # ── DDL ──────────────────────────────────────────────────────────────
        if args.drop_first:
            # Extra safety: drop in dependency order
            for tbl in [
                "support_tickets", "sales_targets", "product_reviews",
                "inventory_transactions", "order_items", "orders",
                "promotions", "customer_addresses", "customers",
                "products", "suppliers", "categories",
                "employees", "departments",
            ]:
                conn.execute(text(f"DROP TABLE IF EXISTS {tbl} CASCADE"))
            print("Dropped all tables.")

        for stmt in DDL_STATEMENTS.strip().split(";"):
            stmt = stmt.strip()
            if stmt:
                conn.execute(text(stmt))
        print("DDL applied.")

        # ── Departments ───────────────────────────────────────────────────────
        for dept_id, name, manager_id, budget, location in DEPT_DATA:
            conn.execute(text("""
                INSERT INTO departments (id, name, manager_id, budget, location)
                VALUES (:id, :name, :mgr, :budget, :loc)
                ON CONFLICT DO NOTHING
            """), {"id": dept_id, "name": name, "mgr": manager_id,
                   "budget": budget, "loc": location})

        # ── Employees ─────────────────────────────────────────────────────────
        for i, (name, dept_id, title, salary, hire_date, email) in enumerate(EMPLOYEE_DATA, 1):
            conn.execute(text("""
                INSERT INTO employees (id, name, dept_id, title, salary, hire_date, email, is_active)
                VALUES (:id, :name, :dept, :title, :sal, :hd, :email, true)
                ON CONFLICT (email) DO NOTHING
            """), {"id": i, "name": name, "dept": dept_id, "title": title,
                   "sal": salary, "hd": hire_date, "email": email})

        # Assign manager_id back
        conn.execute(text("UPDATE departments SET manager_id=1 WHERE id=1"))
        conn.execute(text("UPDATE departments SET manager_id=5 WHERE id=2"))
        conn.execute(text("UPDATE departments SET manager_id=7 WHERE id=3"))
        conn.execute(text("UPDATE departments SET manager_id=10 WHERE id=4"))
        conn.execute(text("UPDATE departments SET manager_id=13 WHERE id=5"))
        conn.execute(text("UPDATE departments SET manager_id=15 WHERE id=6"))

        # ── Categories ────────────────────────────────────────────────────────
        for cat_id, name, parent_id, desc in CATEGORY_DATA:
            conn.execute(text("""
                INSERT INTO categories (id, name, parent_id, description)
                VALUES (:id, :name, :pid, :desc)
                ON CONFLICT DO NOTHING
            """), {"id": cat_id, "name": name, "pid": parent_id, "desc": desc})

        # ── Suppliers ─────────────────────────────────────────────────────────
        for i, (name, contact, phone, email, country, rating, is_active) in enumerate(SUPPLIER_DATA, 1):
            conn.execute(text("""
                INSERT INTO suppliers (id, name, contact_name, phone, email, country, rating, is_active)
                VALUES (:id, :name, :contact, :phone, :email, :country, :rating, :active)
                ON CONFLICT DO NOTHING
            """), {"id": i, "name": name, "contact": contact, "phone": phone,
                   "email": email, "country": country, "rating": rating, "active": is_active})

        # ── Customers ─────────────────────────────────────────────────────────
        cust_id_map: dict[str, int] = {}
        for i, (name, email, phone, gender, birth_date, city, tier) in enumerate(CUSTOMER_DATA, 1):
            conn.execute(text("""
                INSERT INTO customers (id, name, email, phone, gender, birth_date, city, tier,
                                       total_spent, created_at)
                VALUES (:id, :name, :email, :phone, :gender, :bd, :city, :tier, 0,
                        now() - INTERVAL '1 day' * :days_ago)
                ON CONFLICT (email) DO NOTHING
            """), {"id": i, "name": name, "email": email, "phone": phone,
                   "gender": gender, "bd": birth_date, "city": city, "tier": tier,
                   "days_ago": random.randint(30, 730)})
            cust_id_map[email] = i

        # ── Customer Addresses ────────────────────────────────────────────────
        districts = ["中正區", "大安區", "信義區", "松山區", "中山區", "板橋區", "三重區", "永和區"]
        for cust_id in range(1, len(CUSTOMER_DATA) + 1):
            addr_count = random.choice([1, 1, 2])
            for j in range(addr_count):
                city = random.choice(CITIES)
                conn.execute(text("""
                    INSERT INTO customer_addresses (customer_id, label, city, district, address, is_default)
                    VALUES (:cid, :label, :city, :dist, :addr, :is_def)
                """), {
                    "cid": cust_id,
                    "label": "home" if j == 0 else random.choice(["work", "other"]),
                    "city": city,
                    "dist": random.choice(districts),
                    "addr": f"{random.randint(1,200)}號{random.randint(1,15)}樓",
                    "is_def": j == 0,
                })

        # ── Products ──────────────────────────────────────────────────────────
        prod_id_map: dict[str, int] = {}
        for i, (sku, name, cat_id, sup_id, price, cost, stock, reorder) in enumerate(PRODUCT_DATA, 1):
            conn.execute(text("""
                INSERT INTO products (id, sku, name, category_id, supplier_id, price, cost,
                                      stock, reorder_point, is_active, created_at)
                VALUES (:id, :sku, :name, :cat, :sup, :price, :cost, :stock, :reorder,
                        true, now() - INTERVAL '1 day' * :days_ago)
                ON CONFLICT (sku) DO NOTHING
            """), {"id": i, "sku": sku, "name": name, "cat": cat_id, "sup": sup_id,
                   "price": price, "cost": cost, "stock": stock, "reorder": reorder,
                   "days_ago": random.randint(60, 365)})
            prod_id_map[sku] = i

        # ── Promotions ────────────────────────────────────────────────────────
        promo_ids: list[int] = []
        for i, (code, desc, dtype, dval, min_amt, max_uses, used, sdate, edate, active) in enumerate(PROMOTION_DATA, 1):
            conn.execute(text("""
                INSERT INTO promotions (id, code, description, discount_type, discount_value,
                                        min_order_amt, max_uses, used_count, start_date, end_date, is_active)
                VALUES (:id, :code, :desc, :dtype, :dval, :min_amt, :max_uses, :used,
                        :sdate, :edate, :active)
                ON CONFLICT (code) DO NOTHING
            """), {"id": i, "code": code, "desc": desc, "dtype": dtype, "dval": dval,
                   "min_amt": min_amt, "max_uses": max_uses, "used": used,
                   "sdate": sdate, "edate": edate, "active": active})
            promo_ids.append(i)

        # ── Orders + Order Items ───────────────────────────────────────────────
        prod_prices = [(i+1, p[4]) for i, p in enumerate(PRODUCT_DATA)]  # (id, price)
        cust_ids_list = list(range(1, len(CUSTOMER_DATA) + 1))
        order_id = 0
        total_spent: dict[int, float] = {cid: 0.0 for cid in cust_ids_list}

        for _ in range(600):
            order_id += 1
            cust_id = random.choice(cust_ids_list)
            days_ago = int(random.triangular(0, 365, 60))
            ordered_at = now - timedelta(
                days=days_ago,
                hours=random.randint(0, 23),
                minutes=random.randint(0, 59),
            )
            status = random.choice(ORDER_STATUSES)
            payment = random.choice(PAYMENT_METHODS)
            shipping_city = random.choice(CITIES)
            use_promo = random.random() < 0.25
            promo_id = random.choice(promo_ids) if use_promo else None

            # 1–3 items per order
            n_items = random.randint(1, 3)
            chosen_prods = random.sample(prod_prices, min(n_items, len(prod_prices)))
            subtotal = 0.0
            items: list[tuple] = []
            for pid, base_price in chosen_prods:
                qty = random.randint(1, 4)
                unit_price = round(base_price * random.uniform(0.9, 1.0), 2)
                item_sub = round(unit_price * qty, 2)
                subtotal += item_sub
                items.append((pid, qty, unit_price, item_sub))

            discount_amt = 0.0
            if promo_id:
                promo = PROMOTION_DATA[promo_id - 1]
                if promo[2] == "percent":
                    discount_amt = round(subtotal * promo[3] / 100, 2)
                else:
                    discount_amt = promo[3] if subtotal >= promo[4] else 0.0
            total = round(subtotal - discount_amt, 2)

            shipped_at = None
            delivered_at = None
            if status in ("shipped", "completed"):
                shipped_at = ordered_at + timedelta(days=random.randint(1, 3))
            if status == "completed":
                delivered_at = shipped_at + timedelta(days=random.randint(2, 7))

            conn.execute(text("""
                INSERT INTO orders (id, customer_id, status, payment_method, shipping_city,
                                    promotion_id, subtotal, discount_amt, total,
                                    ordered_at, shipped_at, delivered_at)
                VALUES (:id, :cid, :status, :pay, :city, :promo,
                        :sub, :disc, :total, :oat, :sat, :dat)
            """), {
                "id": order_id, "cid": cust_id, "status": status, "pay": payment,
                "city": shipping_city, "promo": promo_id,
                "sub": round(subtotal, 2), "disc": discount_amt, "total": total,
                "oat": ordered_at, "sat": shipped_at, "dat": delivered_at,
            })

            for pid, qty, unit_price, item_sub in items:
                conn.execute(text("""
                    INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal)
                    VALUES (:oid, :pid, :qty, :up, :sub)
                """), {"oid": order_id, "pid": pid, "qty": qty, "up": unit_price, "sub": item_sub})

            if status == "completed":
                total_spent[cust_id] = total_spent.get(cust_id, 0) + total

        # Update customer total_spent
        for cid, spent in total_spent.items():
            conn.execute(text(
                "UPDATE customers SET total_spent = :spent WHERE id = :cid"
            ), {"spent": round(spent, 2), "cid": cid})

        print(f"  Inserted {order_id} orders.")

        # ── Inventory Transactions (initial purchase + sale records) ──────────
        emp_ids = list(range(1, len(EMPLOYEE_DATA) + 1))
        for prod_idx, (sku, *_, stock, _reorder) in enumerate(PRODUCT_DATA):
            pid = prod_idx + 1
            # Initial purchase
            conn.execute(text("""
                INSERT INTO inventory_transactions (product_id, txn_type, qty_change, note, created_by, created_at)
                VALUES (:pid, 'purchase', :qty, '初始進貨', :emp, now() - INTERVAL '180 days')
            """), {"pid": pid, "qty": stock + random.randint(50, 200), "emp": random.choice(emp_ids)})

            # Sales deductions
            for _ in range(random.randint(5, 15)):
                days_ago = random.randint(1, 170)
                conn.execute(text("""
                    INSERT INTO inventory_transactions (product_id, txn_type, qty_change, note, created_by, created_at)
                    VALUES (:pid, 'sale', :qty, NULL, :emp, now() - INTERVAL '1 day' * :days)
                """), {"pid": pid, "qty": -random.randint(1, 10),
                       "emp": random.choice(emp_ids), "days": days_ago})

            # Occasional returns
            if random.random() < 0.4:
                conn.execute(text("""
                    INSERT INTO inventory_transactions (product_id, txn_type, qty_change, note, created_by, created_at)
                    VALUES (:pid, 'return', :qty, '客戶退貨', :emp, now() - INTERVAL '1 day' * :days)
                """), {"pid": pid, "qty": random.randint(1, 5),
                       "emp": random.choice(emp_ids), "days": random.randint(1, 60)})

        # ── Product Reviews ───────────────────────────────────────────────────
        reviewed: set[tuple] = set()
        for _ in range(300):
            pid = random.randint(1, len(PRODUCT_DATA))
            cid = random.randint(1, len(CUSTOMER_DATA))
            if (pid, cid) in reviewed:
                continue
            reviewed.add((pid, cid))
            rating = random.choices([5, 4, 3, 2, 1], weights=[40, 30, 15, 10, 5])[0]
            days_ago = random.randint(1, 300)
            conn.execute(text("""
                INSERT INTO product_reviews (product_id, customer_id, rating, title, body, is_verified, created_at)
                VALUES (:pid, :cid, :rating, :title, :body, :ver,
                        now() - INTERVAL '1 day' * :days)
            """), {
                "pid": pid, "cid": cid, "rating": rating,
                "title": random.choice(REVIEW_TITLES),
                "body": random.choice(REVIEW_BODIES),
                "ver": random.random() < 0.7,
                "days": days_ago,
            })

        # ── Sales Targets ─────────────────────────────────────────────────────
        for dept_id in range(1, 7):
            for year in (2024, 2025):
                for quarter in range(1, 5):
                    target = random.randint(1_000_000, 5_000_000)
                    actual = round(target * random.uniform(0.6, 1.35), 2)
                    t_orders = random.randint(100, 500)
                    a_orders = random.randint(80, 520)
                    conn.execute(text("""
                        INSERT INTO sales_targets (dept_id, year, quarter, target_amt, actual_amt,
                                                    target_orders, actual_orders)
                        VALUES (:dept, :year, :q, :target, :actual, :to, :ao)
                        ON CONFLICT (dept_id, year, quarter) DO NOTHING
                    """), {"dept": dept_id, "year": year, "q": quarter,
                           "target": target, "actual": actual,
                           "to": t_orders, "ao": a_orders})

        # ── Support Tickets ───────────────────────────────────────────────────
        ticket_emp_ids = [10, 11, 12]  # Customer service employees
        for _ in range(200):
            cid = random.randint(1, len(CUSTOMER_DATA))
            cat = random.choice(list(TICKET_SUBJECTS.keys()))
            priority = random.choices(["low", "medium", "high"], weights=[30, 50, 20])[0]
            status = random.choices(
                ["open", "in_progress", "resolved", "closed"],
                weights=[20, 15, 35, 30]
            )[0]
            days_ago = random.randint(1, 180)
            created_at = now - timedelta(days=days_ago)
            resolved_at = None
            if status in ("resolved", "closed"):
                resolved_at = created_at + timedelta(hours=random.randint(1, 72))

            # Link to a real order occasionally
            order_id_ref = random.randint(1, order_id) if random.random() < 0.6 else None

            conn.execute(text("""
                INSERT INTO support_tickets
                    (customer_id, order_id, category, priority, status, subject,
                     assigned_to, created_at, resolved_at)
                VALUES (:cid, :oid, :cat, :pri, :status, :subj,
                        :emp, :created, :resolved)
            """), {
                "cid": cid,
                "oid": order_id_ref,
                "cat": cat,
                "pri": priority,
                "status": status,
                "subj": random.choice(TICKET_SUBJECTS[cat]),
                "emp": random.choice(ticket_emp_ids),
                "created": created_at,
                "resolved": resolved_at,
            })

        # ── Reset sequences ───────────────────────────────────────────────────
        for tbl, col in [
            ("departments", "id"), ("employees", "id"), ("categories", "id"),
            ("suppliers", "id"), ("customers", "id"), ("products", "id"),
            ("promotions", "id"), ("orders", "id"),
        ]:
            conn.execute(text(
                f"SELECT setval(pg_get_serial_sequence('{tbl}', '{col}'), "
                f"(SELECT MAX({col}) FROM {tbl}))"
            ))

        # ── Summary ───────────────────────────────────────────────────────────
        tables = [
            "departments", "employees", "categories", "suppliers",
            "customers", "customer_addresses", "products", "promotions",
            "orders", "order_items", "inventory_transactions",
            "product_reviews", "sales_targets", "support_tickets",
        ]
        print("\n  Table              Rows")
        print("  " + "-" * 30)
        for tbl in tables:
            n = conn.execute(text(f"SELECT COUNT(*) FROM {tbl}")).scalar_one()
            print(f"  {tbl:<28} {n:>5}")

    print("\nFull schema seed completed.")


if __name__ == "__main__":
    main()
