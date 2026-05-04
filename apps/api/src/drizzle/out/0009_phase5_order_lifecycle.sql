-- Migration: 0009_phase5_order_lifecycle.sql
-- Purpose:   Phase 5 — Order Lifecycle State Machine prerequisites.
--
-- Changes:
--   1. orders.version         — optimistic locking column for concurrent T-09 races.
--   2. orders.shipper_id      — set by T-09 (ready_for_pickup → picked_up) when
--                               a shipper self-assigns the order.
--   3. ordering_restaurant_snapshots.owner_id — required for Phase 5 restaurant
--                               ownership check without importing RestaurantModule (D3-B).
-- ---------------------------------------------------------------------------

-- 1. Optimistic locking version counter.
-- NOT NULL DEFAULT 0 so all existing rows start at version 0.
ALTER TABLE orders
  ADD COLUMN version integer NOT NULL DEFAULT 0;

-- 2. Shipper UUID — nullable until a shipper claims the order via T-09.
ALTER TABLE orders
  ADD COLUMN shipper_id uuid;

-- 3. Restaurant owner UUID — required for Phase 5 permission checks.
-- Existing snapshot rows get a placeholder UUID; they will be overwritten
-- the next time RestaurantService publishes a RestaurantUpdatedEvent.
ALTER TABLE ordering_restaurant_snapshots
  ADD COLUMN owner_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

-- Remove the default so future upserts must always supply the value.
ALTER TABLE ordering_restaurant_snapshots
  ALTER COLUMN owner_id DROP DEFAULT;
