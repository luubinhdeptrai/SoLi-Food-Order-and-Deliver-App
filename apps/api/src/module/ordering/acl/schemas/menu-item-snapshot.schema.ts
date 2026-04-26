import { pgTable, pgEnum, uuid, text, doublePrecision, timestamp } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enum
// ---------------------------------------------------------------------------

/**
 * Mirrors the upstream `menu_item_status` enum from restaurant-catalog BC.
 * Defined independently here so the Ordering context has zero runtime coupling
 * to the restaurant-catalog schema (D3-B, D4-B).
 *
 * Named with an `ordering_` prefix to avoid PostgreSQL enum name collision.
 */
export const orderingMenuItemStatusEnum = pgEnum('ordering_menu_item_status', [
  'available',
  'unavailable',
  'out_of_stock',
]);

// ---------------------------------------------------------------------------
// ordering_menu_item_snapshots
// ---------------------------------------------------------------------------

/**
 * Local read-model (projection) of MenuItems owned by the Ordering BC.
 *
 * Design notes:
 *  - menuItemId is the PK — sourced from the upstream menu_items.id.
 *    It is NOT a FK; the Ordering BC never imports restaurant-catalog tables.
 *  - restaurantId is stored as a plain UUID for snapshot queries (e.g. "fetch
 *    all items for this restaurant when validating checkout").
 *  - price and name are copied from the upstream at event time; they represent
 *    the latest known values and are re-snapshotted into order_items at checkout.
 *  - status uses a BC-local enum; canonical field is `status` (not `isAvailable`).
 *    See ORDERING_CONTEXT_PROPOSAL §3 and Phase 3 ACL design.
 *  - lastSyncedAt is set whenever the projector handles a MenuItemUpdatedEvent.
 *
 * Populated by: MenuItemProjector (Phase 3) via MenuItemUpdatedEvent.
 * Consumed by:  CartService (Phase 2) — addItem price/name lookup.
 *               PlaceOrderHandler (Phase 4) — re-validate availability at checkout.
 */
export const orderingMenuItemSnapshots = pgTable(
  'ordering_menu_item_snapshots',
  {
    menuItemId: uuid('menu_item_id').primaryKey(), // upstream ID, not a FK
    restaurantId: uuid('restaurant_id').notNull(),
    name: text('name').notNull(),
    price: doublePrecision('price').notNull(),
    status: orderingMenuItemStatusEnum('status').notNull().default('available'),
    lastSyncedAt: timestamp('last_synced_at').defaultNow().notNull(),
  },
);

export type OrderingMenuItemSnapshot = typeof orderingMenuItemSnapshots.$inferSelect;
export type NewOrderingMenuItemSnapshot = typeof orderingMenuItemSnapshots.$inferInsert;
