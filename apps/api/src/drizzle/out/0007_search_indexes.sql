-- Migration: 0007_search_indexes.sql
-- Purpose:   Enable accent-insensitive search and efficient ILIKE queries.
-- Requires:  PostgreSQL 12+ (both extensions are bundled — no extra install).

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

-- unaccent: strips diacritical marks, enabling accent-insensitive search.
-- "pho" matches "Phở", "banh" matches "Bánh", "com" matches "Cơm".
-- Used in the SearchRepository via: unaccent(column) ILIKE unaccent('%query%')
CREATE EXTENSION IF NOT EXISTS unaccent;

-- pg_trgm: trigram similarity for efficient ILIKE '%partial%' queries.
-- Without this, every ILIKE scan is sequential; trigram GIN indexes make it
-- O(log n) regardless of the leading wildcard.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Trigram GIN indexes for ILIKE substring search
-- ---------------------------------------------------------------------------

-- Restaurant name search (primary text field on the restaurant SERP section).
CREATE INDEX IF NOT EXISTS restaurants_name_trgm_idx
  ON restaurants USING gin (name gin_trgm_ops);

-- Menu item name search — critical for food-level queries ("bánh mì", "pizza").
-- This is the most important index for the items section of the unified SERP.
CREATE INDEX IF NOT EXISTS menu_items_name_trgm_idx
  ON menu_items USING gin (name gin_trgm_ops);

-- Menu category name search (used in the EXISTS subquery for category filter).
CREATE INDEX IF NOT EXISTS menu_categories_name_trgm_idx
  ON menu_categories USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Geo bounding-box index
-- ---------------------------------------------------------------------------

-- Composite B-tree on (latitude, longitude) supports the cheap bounding-box
-- pre-filter (BETWEEN) that runs before the Haversine expression. Partial
-- index skips rows with no coordinates to keep it compact.
CREATE INDEX IF NOT EXISTS restaurants_lat_lon_idx
  ON restaurants (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
