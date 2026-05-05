import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// ordering_delivery_zone_snapshots
// ---------------------------------------------------------------------------

/**
 * Local read-model (projection) of DeliveryZones owned by the Ordering BC.
 *
 * Design notes:
 *  - zoneId is the PK — sourced from the upstream delivery_zones.id.
 *    It is NOT a FK; the Ordering BC never imports restaurant-catalog tables (D3-B).
 *  - restaurantId is a plain UUID — indexed for fast BR-3 lookups at checkout.
 *    It is NOT a FK to ordering_restaurant_snapshots.
 *  - isDeleted is a tombstone flag set when the upstream zone is hard-deleted.
 *    The row is kept for event-replay safety; it is excluded from all active queries.
 *  - All fee / timing fields are copied verbatim from the event so the snapshot
 *    is self-contained for delivery estimation in future phases.
 *  - lastSyncedAt is reset on every upsert to track snapshot freshness.
 *
 * Populated by: DeliveryZoneSnapshotProjector via DeliveryZoneSnapshotUpdatedEvent.
 * Consumed by:  PlaceOrderHandler (Phase 4) — BR-3 active-zone radius check.
 */
export const orderingDeliveryZoneSnapshots = pgTable(
  'ordering_delivery_zone_snapshots',
  {
    zoneId: uuid('zone_id').primaryKey(), // upstream ID, not a FK
    restaurantId: uuid('restaurant_id').notNull(),
    name: text('name').notNull(),
    radiusKm: doublePrecision('radius_km').notNull(),
    // Fees stored as integer VND.
    baseFee: integer('base_fee').notNull(),
    perKmRate: integer('per_km_rate').notNull(),
    avgSpeedKmh: real('avg_speed_kmh').notNull(),
    prepTimeMinutes: real('prep_time_minutes').notNull(),
    bufferMinutes: real('buffer_minutes').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    /** Tombstone: true when the upstream zone was hard-deleted. */
    isDeleted: boolean('is_deleted').notNull().default(false),
    lastSyncedAt: timestamp('last_synced_at').defaultNow().notNull(),
  },
  (table) => [
    // Fast lookup: all active non-deleted zones for a restaurant (BR-3 at checkout).
    index('ordering_delivery_zone_snapshots_restaurant_idx').on(
      table.restaurantId,
    ),
  ],
);

export type OrderingDeliveryZoneSnapshot =
  typeof orderingDeliveryZoneSnapshots.$inferSelect;
export type NewOrderingDeliveryZoneSnapshot =
  typeof orderingDeliveryZoneSnapshots.$inferInsert;
