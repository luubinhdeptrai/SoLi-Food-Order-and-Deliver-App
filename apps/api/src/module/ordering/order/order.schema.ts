import {
  pgTable,
  pgEnum,
  uuid,
  text,
  doublePrecision,
  integer,
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
    totalAmount: doublePrecision('total_amount').notNull(),
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

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
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
  itemName: text('item_name').notNull(),       // snapshot
  unitPrice: doublePrecision('unit_price').notNull(), // snapshot
  quantity: integer('quantity').notNull(),
  subtotal: doublePrecision('subtotal').notNull(),
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

  fromStatus: orderStatusEnum('from_status'),          // null = initial creation
  toStatus: orderStatusEnum('to_status').notNull(),
  triggeredBy: uuid('triggered_by'),                   // null = system
  triggeredByRole: triggeredByRoleEnum('triggered_by_role').notNull(),
  note: text('note'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type OrderStatusLog = typeof orderStatusLogs.$inferSelect;
export type NewOrderStatusLog = typeof orderStatusLogs.$inferInsert;
