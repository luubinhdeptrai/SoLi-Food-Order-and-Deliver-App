-- ============================================================
-- Migration: 0006_catalog_enrichment
-- Applies all restaurant-catalog enrichment changes from
-- the RESTAURANT_CATALOG_AUDIT.md audit (Issues #9-#15, #19).
-- ============================================================

-- Issue #10: Add new display/discovery columns to restaurants table.
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "cuisine_type" TEXT;
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "logo_url" TEXT;
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "cover_image_url" TEXT;

-- Issue #14: Composite index for the public search query path
-- (is_approved = true AND is_open = true).
CREATE INDEX IF NOT EXISTS "restaurants_approved_open_idx"
    ON "restaurants" ("is_approved", "is_open");

-- Issue #9: Remove deprecated delivery_radius_km from the Ordering BC snapshot.
-- This column was never accurate (the domain uses delivery_zones instead) and
-- confuses snapshot consumers.
ALTER TABLE "ordering_restaurant_snapshots"
    DROP COLUMN IF EXISTS "delivery_radius_km";

-- Issue #10: Add cuisine_type to the Ordering BC snapshot so consumers can
-- display cuisine information without a round-trip to the Catalog BC.
ALTER TABLE "ordering_restaurant_snapshots"
    ADD COLUMN IF NOT EXISTS "cuisine_type" TEXT;

-- Issue #13: Unique constraint — category names must be unique per restaurant.
-- Enforced at the DB level so concurrent INSERTs cannot produce duplicates even
-- if the application's ConflictException catch fires too late.
CREATE UNIQUE INDEX IF NOT EXISTS "menu_categories_restaurant_name_uidx"
    ON "menu_categories" ("restaurant_id", "name");

-- Issue #15: GIN index on menu_items.tags for efficient array containment
-- queries (@>, &&, etc.) used by the future tag-based search feature.
CREATE INDEX IF NOT EXISTS "menu_items_tags_gin_idx"
    ON "menu_items" USING gin ("tags");
