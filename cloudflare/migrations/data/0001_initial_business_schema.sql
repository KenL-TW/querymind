-- QueryMind's single read-only business database (Cloudflare D1 / SQLite).
-- IDs and timestamps are represented with SQLite-compatible INTEGER/TEXT types.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  manager_id INTEGER,
  budget NUMERIC,
  location TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  dept_id INTEGER REFERENCES departments(id),
  title TEXT,
  salary NUMERIC,
  hire_date TEXT,
  email TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id),
  description TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  country TEXT,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  gender TEXT CHECK (gender IN ('M', 'F')),
  birth_date TEXT,
  city TEXT,
  tier TEXT NOT NULL DEFAULT 'regular' CHECK (tier IN ('regular', 'silver', 'gold', 'vip')),
  total_spent NUMERIC NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  label TEXT NOT NULL DEFAULT 'home' CHECK (label IN ('home', 'work', 'other')),
  city TEXT,
  district TEXT,
  address TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  price NUMERIC NOT NULL,
  cost NUMERIC,
  stock INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 10,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  discount_type TEXT CHECK (discount_type IN ('percent', 'fixed')),
  discount_value NUMERIC,
  min_order_amt NUMERIC NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 0,
  used_count INTEGER NOT NULL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('completed', 'shipped', 'processing', 'cancelled')),
  payment_method TEXT,
  shipping_city TEXT,
  promotion_id INTEGER REFERENCES promotions(id),
  subtotal NUMERIC,
  discount_amt NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC,
  ordered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  shipped_at TEXT,
  delivered_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC NOT NULL,
  subtotal NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  txn_type TEXT NOT NULL CHECK (txn_type IN ('purchase', 'sale', 'return', 'adjustment')),
  qty_change INTEGER NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_reviews (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT,
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_targets (
  id INTEGER PRIMARY KEY,
  dept_id INTEGER NOT NULL REFERENCES departments(id),
  year INTEGER NOT NULL,
  quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  target_amt NUMERIC,
  actual_amt NUMERIC NOT NULL DEFAULT 0,
  target_orders INTEGER,
  actual_orders INTEGER NOT NULL DEFAULT 0,
  UNIQUE (dept_id, year, quarter)
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_id INTEGER REFERENCES orders(id),
  category TEXT NOT NULL CHECK (category IN ('refund', 'damage', 'delay', 'inquiry', 'other')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  subject TEXT,
  assigned_to INTEGER REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_ordered_at ON orders(customer_id, ordered_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_ordered_at ON orders(status, ordered_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product_created_at ON inventory_transactions(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_product_created_at ON product_reviews(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_status_created_at ON support_tickets(status, created_at DESC);
