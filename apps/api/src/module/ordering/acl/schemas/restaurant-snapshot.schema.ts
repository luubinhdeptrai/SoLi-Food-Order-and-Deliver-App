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
 *  - deliveryRadiusKm has been REMOVED. Delivery zones are now managed via the
 *    dedicated `ordering_delivery_zone_snapshots` table (Phase 4).
 *  - cuisineType carries the cuisine label for any ordering-side queries that
 *    need it (e.g., displaying restaurant details in the order confirmation).
 *
 * Populated by: RestaurantSnapshotProjector (Phase 3) via RestaurantUpdatedEvent.
 * Consumed by:  CartService (Phase 2) — restaurantId resolution.
 *               PlaceOrderHandler (Phase 4) — open/approved validation.
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
    address: text('address').notNull(),

    // Cuisine type for display / future filtering at the ordering layer.
    cuisineType: text('cuisine_type'),

    // Sourced from restaurants.latitude / restaurants.longitude.
    // Used to compute Haversine distance at checkout (BR-3, Phase 4).
    latitude: real('latitude'),
    longitude: real('longitude'),

    // Owner of the restaurant — sourced from restaurants.owner_id.
    // Used by OrderLifecycleService (Phase 5) to verify restaurant ownership
    // without importing RestaurantModule (D3-B).
    ownerId: uuid('owner_id').notNull(),

    lastSyncedAt: timestamp('last_synced_at').defaultNow().notNull(),
  },
);

export type OrderingRestaurantSnapshot =
  typeof orderingRestaurantSnapshots.$inferSelect;
export type NewOrderingRestaurantSnapshot =
  typeof orderingRestaurantSnapshots.$inferInsert;
