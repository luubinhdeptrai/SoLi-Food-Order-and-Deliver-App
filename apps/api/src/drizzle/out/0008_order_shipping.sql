-- Migration: 0008_order_shipping.sql
-- Purpose:   Add shipping_fee and estimated_delivery_minutes to the orders table.
--
-- Context:
--   Phase 4 (Order Placement) now computes delivery pricing at checkout time
--   using the delivery zone snapshot (ordering_delivery_zone_snapshots).
--   shippingFee = baseFee + (distanceKm * perKmRate)
--   totalAmount = itemsTotal + shippingFee
--
--   estimated_delivery_minutes is informational: stored so the client can
--   surface an ETA to the customer immediately after checkout.
-- ---------------------------------------------------------------------------

-- shipping_fee: NUMERIC(12, 2) — exact decimal, not float.
-- NOT NULL DEFAULT 0 so existing rows (if any) get a safe fallback value.
-- 0 is correct for orders placed before zone data was configured.
ALTER TABLE orders
  ADD COLUMN shipping_fee numeric(12, 2) NOT NULL DEFAULT 0;

-- estimated_delivery_minutes: real (float4) — informational ETA in minutes.
-- Nullable because it cannot be computed when restaurant/address coordinates
-- are absent. Clients must treat null as "unknown".
ALTER TABLE orders
  ADD COLUMN estimated_delivery_minutes real;
