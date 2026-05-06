-- Migration: 0010_phase7_order_history_indexes.sql
-- Purpose:   Phase 7 — Order History Query Layer performance indexes.
--
-- Background:
--   Phase 7 adds read-only list endpoints for all four actor types (customer,
--   restaurant, shipper, admin). Without supporting indexes every list query
--   performs a sequential scan of the orders table. At production scale
--   (millions of rows) this is unacceptable.
--
-- Index strategy:
--   All indexes use composite or partial forms to be as selective as possible
--   while remaining narrow enough to fit in the buffer pool.
--
--   Two FK child columns (order_items.order_id, order_status_logs.order_id)
--   are explicitly indexed. PostgreSQL does NOT automatically create indexes
--   on FK child columns — only the referenced PK column is indexed. Without
--   these indexes every detail-load query (Phase 7 GET /orders/my/:id) that
--   joins order_items and order_status_logs on order_id performs a full
--   sequential scan of those tables.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- orders table
-- ---------------------------------------------------------------------------

-- Customer order list  (GET /orders/my — WHERE customer_id + ORDER BY created_at)
CREATE INDEX IF NOT EXISTS idx_orders_customer_id_created_at
  ON orders (customer_id, created_at DESC);

-- Restaurant order list  (GET /restaurant/orders — WHERE restaurant_id + ORDER BY created_at)
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_id_created_at
  ON orders (restaurant_id, created_at DESC);

-- Shipper history  (WHERE shipper_id + status, e.g. delivered/picked_up/delivering)
-- Partial: only index rows where shipper_id IS NOT NULL (i.e., order is assigned).
-- This reduces the index size by excluding the large volume of unassigned orders.
CREATE INDEX IF NOT EXISTS idx_orders_shipper_id_status
  ON orders (shipper_id, status)
  WHERE shipper_id IS NOT NULL;

-- Shipper available pool  (GET /shipper/orders/available — WHERE status = 'ready_for_pickup')
-- Partial: only the narrow slice of rows actually in this state.
-- sorted by created_at ASC (oldest-first = highest pickup priority).
CREATE INDEX IF NOT EXISTS idx_orders_status_ready_for_pickup
  ON orders (status, created_at ASC)
  WHERE status = 'ready_for_pickup';

-- Admin full-table sort  (GET /admin/orders — ORDER BY created_at/updated_at/total_amount)
-- A general-purpose index used by the admin list endpoint when no other predicate
-- is selective enough to use a narrower index.
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
  ON orders (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- order_items table — FK child column index
-- ---------------------------------------------------------------------------
-- PostgreSQL does NOT auto-index FK child columns. This index is REQUIRED for
-- efficient detail loads (SELECT * FROM order_items WHERE order_id = $1).
-- Without it, PostgreSQL performs a full sequential scan of order_items for
-- every order detail page view.
CREATE INDEX IF NOT EXISTS idx_order_items_order_id
  ON order_items (order_id);

-- ---------------------------------------------------------------------------
-- order_status_logs table — FK child column index
-- ---------------------------------------------------------------------------
-- Same rationale as idx_order_items_order_id above. The timeline query
-- (SELECT * FROM order_status_logs WHERE order_id = $1 ORDER BY created_at)
-- is part of every detail load (Phase 7 GET /orders/my/:id) and requires this
-- index to avoid a sequential scan.
CREATE INDEX IF NOT EXISTS idx_order_status_logs_order_id
  ON order_status_logs (order_id);
