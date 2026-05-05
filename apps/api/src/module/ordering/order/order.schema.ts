import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  real,
  jsonb,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * All states an Order can occupy.
 * PAID is exclusive to VNPay orders (see ORDERING_CONTEXT_PROPOSAL §8.3).
 */
export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'paid',
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'picked_up',
  'delivering',
  'delivered',
  'cancelled',
  'refunded',
]);

/** Payment methods supported by the platform. */
export const paymentMethodEnum = pgEnum('order_payment_method', [
  'cod',
  'vnpay',
]);

// ---------------------------------------------------------------------------
// Modifier snapshot type (stored in order_items.modifiers JSONB)
// ---------------------------------------------------------------------------

/**
 * A single modifier option snapshotted at checkout time.
 * Re-resolved from ACL snapshot — NOT copied from cart add-time data.
 * Prices reflect what was authoritative in the ACL at moment of order placement.
 */
export interface OrderModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  price: number;
}

/**
 * Actor that triggered a state transition.
 * 'system' is used for automated actions (timeout cron, PaymentContext event).
 */
export const triggeredByRoleEnum = pgEnum('order_triggered_by_role', [
  'customer',
  'restaurant',
  'shipper',
  'admin',
  'system',
]);

/** Derived TypeScript types for use across the ordering BC. */
export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
export type TriggeredByRole = (typeof triggeredByRoleEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// DeliveryAddress shape (JSONB — stored inline in orders row)
// ---------------------------------------------------------------------------

export type DeliveryAddress = {
  street: string;
  district: string;
  city: string;
  latitude?: number;
  longitude?: number;
};

// ---------------------------------------------------------------------------
// orders
// ---------------------------------------------------------------------------

/**
 * Core order aggregate.
 *
 * Design notes:
 *  - customerId / restaurantId are plain UUIDs — no FK to other BCs.
 *  - restaurantName is a snapshot captured at order creation.
 *  - cartId is UNIQUE but NOT a FK (no carts DB table — D2-B Redis-only cart).
 *  - deliveryAddress is JSONB to avoid a separate join for read-heavy paths.
 *  - paymentUrl stores the VNPay redirect URL so clients can recover it.
 *  - expiresAt is set at creation time and used by the timeout cron (Phase 5).
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Cross-context references — stored as plain UUIDs, never as FKs
    customerId: uuid('customer_id').notNull(),
    restaurantId: uuid('restaurant_id').notNull(),
    restaurantName: text('restaurant_name').notNull(), // snapshot

    // D5-B: unique constraint prevents same cart producing two orders
    cartId: uuid('cart_id').notNull(),

    status: orderStatusEnum('status').notNull().default('pending'),
    // All monetary amounts are stored as integer VND (no fractional units in Vietnam).
    totalAmount: integer('total_amount').notNull(),
    /**
     * Shipping fee computed at checkout time from the innermost eligible delivery
     * zone snapshot: baseFee + Math.round(distanceKm × perKmRate).
     * Stored as integer VND.
     */
    shippingFee: integer('shipping_fee').notNull().default(0),
    /**
     * Estimated delivery time in minutes, computed at checkout.
     * Formula: prepTimeMinutes + (distanceKm / avgSpeedKmh × 60) + bufferMinutes.
     * Null when coordinates or zone data is unavailable.
     * Informational only — does not gate order placement.
     */
    estimatedDeliveryMinutes: real('estimated_delivery_minutes'),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),

    // JSONB delivery address — DeliveryAddress shape
    deliveryAddress: jsonb('delivery_address')
      .$type<DeliveryAddress>()
      .notNull(),

    note: text('note'),

    // VNPay: URL returned by payment gateway; null for COD orders
    paymentUrl: text('payment_url'),

    // Set at creation = NOW() + RESTAURANT_ACCEPT_TIMEOUT_SECONDS (app_settings)
    // Used by OrderTimeoutTask (Phase 5) to find orders that restaurants ignored
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // Optimistic locking — incremented on every status transition (Phase 5).
    // Guards concurrent pickup races and any concurrent state change.
    version: integer('version').notNull().default(0),

    // Set during T-09 (ready_for_pickup → picked_up) when a shipper self-assigns.
    // Null until a shipper claims the order (Phase 5).
    shipperId: uuid('shipper_id'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    // D5-B idempotency — one cart can produce exactly one order
    unique('orders_cart_id_unique').on(t.cartId),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

// ---------------------------------------------------------------------------
// order_items
// ---------------------------------------------------------------------------

/**
 * Immutable price snapshot created at checkout time.
 * menuItemId is a cross-context reference — no FK to restaurant-catalog BC.
 * itemName and unitPrice are frozen at the moment the order was placed.
 */
export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),

  // Cross-context reference — snapshot, NOT a FK to restaurant-catalog
  menuItemId: uuid('menu_item_id').notNull(),
  itemName: text('item_name').notNull(), // snapshot
  // Base price in integer VND, snapshotted from ACL at checkout time.
  unitPrice: integer('unit_price').notNull(),
  /**
   * Sum of all selected modifier option prices (integer VND).
   */
  modifiersPrice: integer('modifiers_price').notNull().default(0),
  quantity: integer('quantity').notNull(),
  subtotal: integer('subtotal').notNull(),
  /**
   * Modifier selections snapshotted at checkout time.
   * Re-resolved from the ACL snapshot — NOT copied from the cart's add-time data.
   * This is the authoritative record of what the customer actually ordered.
   */
  modifiers: jsonb('modifiers').$type<OrderModifier[]>().notNull().default([]),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;

// ---------------------------------------------------------------------------
// order_status_logs
// ---------------------------------------------------------------------------

/**
 * Append-only audit trail for every state transition.
 *
 * fromStatus is nullable because the first log entry (null → PENDING) records
 * order creation, which has no prior state.
 *
 * triggeredBy is nullable for system-initiated transitions (cron, event handlers).
 */
export const orderStatusLogs = pgTable('order_status_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),

  fromStatus: orderStatusEnum('from_status'), // null = initial creation
  toStatus: orderStatusEnum('to_status').notNull(),
  triggeredBy: uuid('triggered_by'), // null = system
  triggeredByRole: triggeredByRoleEnum('triggered_by_role').notNull(),
  note: text('note'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type OrderStatusLog = typeof orderStatusLogs.$inferSelect;
export type NewOrderStatusLog = typeof orderStatusLogs.$inferInsert;
