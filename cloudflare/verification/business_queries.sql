SELECT COUNT(*) AS customer_count FROM customers;
SELECT COUNT(*) AS non_cancelled_order_count FROM orders WHERE status <> 'cancelled';
SELECT ROUND(SUM(oi.subtotal), 2) AS sales_amount
FROM order_items oi JOIN orders o ON o.id = oi.order_id
WHERE o.status <> 'cancelled';
SELECT p.name AS product_name, SUM(oi.subtotal) AS sales_amount
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
WHERE o.status <> 'cancelled'
GROUP BY p.id, p.name
ORDER BY sales_amount DESC;

