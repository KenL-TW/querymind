-- Deterministic local/demo data for migration rehearsals.
-- Apply only to an empty QUERYMIND_DATA database.
INSERT INTO departments (id, name, budget, location) VALUES
  (1, 'Sales', 5000000, 'Taipei'),
  (2, 'Customer Success', 2800000, 'Taichung');

INSERT INTO employees (id, name, dept_id, title, salary, hire_date, email, is_active) VALUES
  (1, 'Alice Chen', 1, 'Sales Manager', 120000, '2022-01-10', 'alice@example.com', 1),
  (2, 'Brian Lin', 1, 'Account Executive', 82000, '2023-03-15', 'brian@example.com', 1),
  (3, 'Cathy Wu', 2, 'Support Lead', 95000, '2021-08-01', 'cathy@example.com', 1);

UPDATE departments SET manager_id = 1 WHERE id = 1;
UPDATE departments SET manager_id = 3 WHERE id = 2;

INSERT INTO categories (id, name, parent_id, description) VALUES
  (1, 'Electronics', NULL, 'Consumer electronics'),
  (2, 'Accessories', 1, 'Electronic accessories'),
  (3, 'Home', NULL, 'Home and living');

INSERT INTO suppliers (id, name, contact_name, phone, email, country, rating, is_active) VALUES
  (1, 'Formosa Tech', 'Kevin Huang', '02-5555-0101', 'sales@formosa.example', 'Taiwan', 5, 1),
  (2, 'Pacific Goods', 'May Lee', '04-5555-0202', 'hello@pacific.example', 'Taiwan', 4, 1);

INSERT INTO customers (id, name, email, phone, gender, birth_date, city, tier, total_spent, created_at) VALUES
  (1, '王小明', 'ming@example.com', '0912-111-111', 'M', '1988-06-12', 'Taipei', 'gold', 36880, '2025-01-05T08:00:00Z'),
  (2, '李美玲', 'mei@example.com', '0922-222-222', 'F', '1992-11-03', 'Taichung', 'silver', 14760, '2025-02-18T08:00:00Z'),
  (3, '陳志強', 'chiang@example.com', '0933-333-333', 'M', '1985-04-21', 'Kaohsiung', 'regular', 6990, '2025-03-22T08:00:00Z');

INSERT INTO customer_addresses (id, customer_id, label, city, district, address, is_default) VALUES
  (1, 1, 'home', 'Taipei', 'Xinyi', 'Demo Road 1', 1),
  (2, 2, 'home', 'Taichung', 'West', 'Sample Street 2', 1),
  (3, 3, 'work', 'Kaohsiung', 'Lingya', 'Example Avenue 3', 1);

INSERT INTO products (id, sku, name, category_id, supplier_id, price, cost, stock, reorder_point, is_active, created_at) VALUES
  (1, 'QM-LAPTOP-01', 'QueryBook Air', 1, 1, 29990, 22500, 18, 5, 1, '2025-01-01T00:00:00Z'),
  (2, 'QM-HEADSET-01', 'Focus Headset', 2, 1, 3290, 1900, 45, 10, 1, '2025-01-01T00:00:00Z'),
  (3, 'QM-LAMP-01', 'Smart Desk Lamp', 3, 2, 1890, 980, 30, 8, 1, '2025-01-01T00:00:00Z');

INSERT INTO promotions (id, code, description, discount_type, discount_value, min_order_amt, max_uses, used_count, start_date, end_date, is_active) VALUES
  (1, 'WELCOME500', 'New customer discount', 'fixed', 500, 5000, 1000, 2, '2025-01-01', '2026-12-31', 1);

INSERT INTO orders (id, customer_id, status, payment_method, shipping_city, promotion_id, subtotal, discount_amt, total, ordered_at, shipped_at, delivered_at) VALUES
  (1, 1, 'completed', 'credit_card', 'Taipei', 1, 33280, 500, 32780, '2025-04-03T10:15:00Z', '2025-04-04T03:00:00Z', '2025-04-06T06:30:00Z'),
  (2, 2, 'completed', 'bank_transfer', 'Taichung', NULL, 8470, 0, 8470, '2025-05-12T02:20:00Z', '2025-05-13T03:10:00Z', '2025-05-15T08:00:00Z'),
  (3, 3, 'shipped', 'credit_card', 'Kaohsiung', NULL, 6990, 0, 6990, '2025-06-21T12:05:00Z', '2025-06-22T04:00:00Z', NULL),
  (4, 1, 'cancelled', 'credit_card', 'Taipei', NULL, 3290, 0, 3290, '2025-07-01T07:45:00Z', NULL, NULL);

INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, subtotal) VALUES
  (1, 1, 1, 1, 29990, 29990),
  (2, 1, 2, 1, 3290, 3290),
  (3, 2, 2, 2, 3290, 6580),
  (4, 2, 3, 1, 1890, 1890),
  (5, 3, 2, 1, 3290, 3290),
  (6, 3, 3, 2, 1850, 3700),
  (7, 4, 2, 1, 3290, 3290);

INSERT INTO inventory_transactions (id, product_id, txn_type, qty_change, note, created_by, created_at) VALUES
  (1, 1, 'purchase', 20, 'Initial stock', 1, '2025-03-01T00:00:00Z'),
  (2, 1, 'sale', -1, 'Order 1', 2, '2025-04-03T10:15:00Z'),
  (3, 2, 'sale', -4, 'Orders 1-3', 2, '2025-06-21T12:05:00Z');

INSERT INTO product_reviews (id, product_id, customer_id, rating, title, body, is_verified, created_at) VALUES
  (1, 1, 1, 5, 'Great laptop', 'Lightweight and fast.', 1, '2025-04-10T08:00:00Z'),
  (2, 2, 2, 4, 'Good value', 'Comfortable for long meetings.', 1, '2025-05-20T08:00:00Z');

INSERT INTO sales_targets (id, dept_id, year, quarter, target_amt, actual_amt, target_orders, actual_orders) VALUES
  (1, 1, 2025, 2, 100000, 48240, 20, 3),
  (2, 1, 2025, 3, 130000, 0, 25, 0);

INSERT INTO support_tickets (id, customer_id, order_id, category, priority, status, subject, assigned_to, created_at, resolved_at) VALUES
  (1, 2, 2, 'inquiry', 'low', 'resolved', '查詢訂單狀態', 3, '2025-05-13T05:00:00Z', '2025-05-13T06:10:00Z'),
  (2, 3, 3, 'delay', 'medium', 'open', '物流資訊沒更新', 3, '2025-06-24T09:00:00Z', NULL);

