-- Migration: delivery_zones schema update
-- Replaces the flat `delivery_fee` and `estimated_minutes` columns with
-- dynamic pricing columns (base_fee + per_km_rate) and separate time
-- components (avg_speed_kmh, prep_time_minutes, buffer_minutes).
--
-- Safe to run against an existing database:
--  • DROP COLUMN IF EXISTS handles a fresh DB where the old columns don't exist.
--  • ADD COLUMN … DEFAULT … fills existing rows automatically.
--  • CHECK constraints prevent invalid configurations at the DB level.
-- ---------------------------------------------------------------------------

ALTER TABLE delivery_zones
  DROP COLUMN IF EXISTS delivery_fee,
  DROP COLUMN IF EXISTS estimated_minutes,
  ADD COLUMN IF NOT EXISTS base_fee          NUMERIC(10, 2) NOT NULL DEFAULT 0
    CONSTRAINT delivery_zones_base_fee_non_negative CHECK (base_fee >= 0),
  ADD COLUMN IF NOT EXISTS per_km_rate       NUMERIC(10, 2) NOT NULL DEFAULT 0
    CONSTRAINT delivery_zones_per_km_rate_non_negative CHECK (per_km_rate >= 0),
  ADD COLUMN IF NOT EXISTS avg_speed_kmh     REAL           NOT NULL DEFAULT 30
    CONSTRAINT delivery_zones_avg_speed_positive CHECK (avg_speed_kmh > 0),
  ADD COLUMN IF NOT EXISTS prep_time_minutes REAL           NOT NULL DEFAULT 15
    CONSTRAINT delivery_zones_prep_time_non_negative CHECK (prep_time_minutes >= 0),
  ADD COLUMN IF NOT EXISTS buffer_minutes    REAL           NOT NULL DEFAULT 5
    CONSTRAINT delivery_zones_buffer_non_negative CHECK (buffer_minutes >= 0);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- General lookup by restaurant (already exists in most setups, kept idempotent)
CREATE INDEX IF NOT EXISTS idx_delivery_zones_restaurant_id
  ON delivery_zones (restaurant_id);

-- Active-zones query used by estimateDelivery (partial index — small, fast)
CREATE INDEX IF NOT EXISTS idx_delivery_zones_restaurant_active
  ON delivery_zones (restaurant_id, is_active)
  WHERE is_active = TRUE;

-- Ordered-radius query used by estimateDelivery and PlaceOrderHandler
CREATE INDEX IF NOT EXISTS idx_delivery_zones_restaurant_radius
  ON delivery_zones (restaurant_id, radius_km ASC)
  WHERE is_active = TRUE;
