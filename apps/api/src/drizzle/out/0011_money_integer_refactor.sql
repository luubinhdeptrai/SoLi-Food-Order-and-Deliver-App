-- Migration: 0011_money_integer_refactor.sql
-- Purpose:   Convert all monetary columns from NUMERIC(12,2) / NUMERIC(10,2)
--            to INTEGER (VND, no fractional units).
--
-- Background:
--   VND (Vietnamese Dong) has no sub-units. All prices, fees, and totals
--   must be whole numbers. Storing them as NUMERIC(12,2) allowed fractional
--   values (e.g. 48001.51) to enter the system, causing VNPay IPN amount
--   mismatches because VNPay silently truncates sub-VND amounts.
--
-- Conversion strategy:
--   USING ROUND(column)::integer — rounds any existing fractional value to
--   the nearest VND before casting. This is a one-way, non-reversible change.
--
-- Tables affected:
--   menu_items.price
--   modifier_options.price
--   delivery_zones.base_fee
--   delivery_zones.per_km_rate
--   ordering_menu_item_snapshots.price
--   ordering_delivery_zone_snapshots.base_fee
--   ordering_delivery_zone_snapshots.per_km_rate
--   orders.total_amount
--   orders.shipping_fee
--   order_items.unit_price
--   order_items.modifiers_price
--   order_items.subtotal
--   payment_transactions.amount
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- restaurant-catalog: menu_items
-- ---------------------------------------------------------------------------
ALTER TABLE "menu_items"
  ALTER COLUMN "price" TYPE integer USING ROUND("price")::integer;

-- ---------------------------------------------------------------------------
-- restaurant-catalog: modifier_options
-- ---------------------------------------------------------------------------
ALTER TABLE "modifier_options"
  ALTER COLUMN "price" TYPE integer USING ROUND("price")::integer;

-- ---------------------------------------------------------------------------
-- restaurant-catalog: delivery_zones
-- ---------------------------------------------------------------------------
ALTER TABLE "delivery_zones"
  ALTER COLUMN "base_fee" TYPE integer USING ROUND("base_fee")::integer;
ALTER TABLE "delivery_zones"
  ALTER COLUMN "per_km_rate" TYPE integer USING ROUND("per_km_rate")::integer;

-- ---------------------------------------------------------------------------
-- ordering: ordering_menu_item_snapshots
-- ---------------------------------------------------------------------------
ALTER TABLE "ordering_menu_item_snapshots"
  ALTER COLUMN "price" TYPE integer USING ROUND("price")::integer;

-- ---------------------------------------------------------------------------
-- ordering: ordering_delivery_zone_snapshots
-- ---------------------------------------------------------------------------
ALTER TABLE "ordering_delivery_zone_snapshots"
  ALTER COLUMN "base_fee" TYPE integer USING ROUND("base_fee")::integer;
ALTER TABLE "ordering_delivery_zone_snapshots"
  ALTER COLUMN "per_km_rate" TYPE integer USING ROUND("per_km_rate")::integer;

-- ---------------------------------------------------------------------------
-- ordering: orders
-- ---------------------------------------------------------------------------
ALTER TABLE "orders"
  ALTER COLUMN "total_amount" TYPE integer USING ROUND("total_amount")::integer;
ALTER TABLE "orders"
  ALTER COLUMN "shipping_fee" TYPE integer USING ROUND("shipping_fee")::integer;

-- ---------------------------------------------------------------------------
-- ordering: order_items
-- ---------------------------------------------------------------------------
ALTER TABLE "order_items"
  ALTER COLUMN "unit_price" TYPE integer USING ROUND("unit_price")::integer;
ALTER TABLE "order_items"
  ALTER COLUMN "modifiers_price" TYPE integer USING ROUND("modifiers_price")::integer;
ALTER TABLE "order_items"
  ALTER COLUMN "subtotal" TYPE integer USING ROUND("subtotal")::integer;

-- ---------------------------------------------------------------------------
-- payment: payment_transactions
-- ---------------------------------------------------------------------------
ALTER TABLE "payment_transactions"
  ALTER COLUMN "amount" TYPE integer USING ROUND("amount")::integer;
