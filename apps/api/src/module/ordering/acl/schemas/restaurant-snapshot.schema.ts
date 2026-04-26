import {
  pgTable,
  uuid,
  text,
  boolean,
  real,
  timestamp,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// ordering_restaurant_snapshots
// ---------------------------------------------------------------------------

/**
 * Local read-model (projection) of Restaurants owned by the Ordering BC.
 *
 * Design notes:
 *  - restaurantId is the PK — sourced from the upstream restaurants.id.
 *    It is NOT a FK; the Ordering BC never imports restaurant-catalog tables.
 *  - isOpen and isApproved drive checkout validation (BR-8): an order cannot
 *    be placed if the restaurant is closed or not yet approved.
 *  - address is stored for downstream use in OrderReadyForPickupEvent (Phase 6),
 *    which the Delivery context consumes to dispatch a shipper.
 *
 * ⚠️  UPSTREAM MISSING — deliveryRadiusKm:
 *    The `restaurants` table in restaurant-catalog BC does NOT have this column.
 *    It is included here as nullable so the schema is ready when upstream adds it.
 *    BR-3 (delivery-radius enforcement at checkout, Phase 4) CANNOT be fully
 *    implemented until restaurant-catalog adds `delivery_radius_km`.
 *    → Documented in: docs/Những yêu cầu cho các BC/restaurant-catalog.md
 *
 * ⚠️  UPSTREAM MISSING — latitude / longitude on restaurants:
 *    The upstream `restaurants` table has `latitude` and `longitude` columns.
 *    They are included here so the Ordering context can compute the Haversine
 *    distance between delivery address and restaurant (BR-3).
 *    They are nullable because the upstream values are optional.
 *
 * Populated by: RestaurantSnapshotProjector (Phase 3) via RestaurantUpdatedEvent.
 * Consumed by:  CartService (Phase 2) — restaurantId resolution.
 *               PlaceOrderHandler (Phase 4) — open/approved + radius validation.
 *               OrderReadyForPickupEvent (Phase 6) — restaurantAddress payload.
 */
export const orderingRestaurantSnapshots = pgTable(
  'ordering_restaurant_snapshots',
  {
    restaurantId: uuid('restaurant_id').primaryKey(), // upstream ID, not a FK
    name: text('name').notNull(),
    isOpen: boolean('is_open').notNull().default(false),
    isApproved: boolean('is_approved').notNull().default(false),

    // Required by OrderReadyForPickupEvent payload (Phase 6).
    // Sourced from restaurants.address; nullable here until upstream provides it
    // via RestaurantUpdatedEvent.
    address: text('address'),

    // Required for BR-3 (delivery radius check) — sourced from upstream.
    // Nullable until restaurant-catalog BC adds the column and starts publishing it.
    deliveryRadiusKm: real('delivery_radius_km'),

    // Sourced from restaurants.latitude / restaurants.longitude.
    // Used to compute Haversine distance at checkout (BR-3, Phase 4).
    latitude: real('latitude'),
    longitude: real('longitude'),

    lastSyncedAt: timestamp('last_synced_at').defaultNow().notNull(),
  },
);

export type OrderingRestaurantSnapshot =
  typeof orderingRestaurantSnapshots.$inferSelect;
export type NewOrderingRestaurantSnapshot =
  typeof orderingRestaurantSnapshots.$inferInsert;
