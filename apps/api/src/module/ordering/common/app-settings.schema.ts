import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// app_settings
// ---------------------------------------------------------------------------

/**
 * Runtime-configurable platform parameters.
 *
 * Values are plain text; consumers are responsible for parsing (e.g. parseInt).
 * Changes take effect at the next read — no redeployment required.
 *
 * Seed rows (see src/drizzle/seeds/app-settings.seed.ts):
 *
 *   ORDER_IDEMPOTENCY_TTL_SECONDS     = '300'
 *     How long an idempotency key is retained in Redis before expiry (D5-A).
 *     Read by: PlaceOrderHandler (Phase 4).
 *
 *   RESTAURANT_ACCEPT_TIMEOUT_SECONDS = '600'
 *     Seconds before an unconfirmed PENDING/PAID order is auto-cancelled.
 *     Written to orders.expiresAt at order creation.
 *     Read by: PlaceOrderHandler (Phase 4) when setting orders.expiresAt.
 *     Read by: OrderTimeoutTask (Phase 5) cron job.
 *
 *   CART_ABANDONED_TTL_SECONDS        = '86400'
 *     Redis TTL for inactive carts (24h). Cart is auto-evicted by Redis.
 *     Read by: CartService (Phase 2) when writing the cart key.
 *     Note: also reflected in CART_TTL_SECONDS in ordering.constants.ts
 *     as a code-level fallback (Phase 2).
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;

// ---------------------------------------------------------------------------
// Well-known setting keys (type-safe constants for consumers)
// ---------------------------------------------------------------------------

export const APP_SETTING_KEYS = {
  ORDER_IDEMPOTENCY_TTL_SECONDS: 'ORDER_IDEMPOTENCY_TTL_SECONDS',
  RESTAURANT_ACCEPT_TIMEOUT_SECONDS: 'RESTAURANT_ACCEPT_TIMEOUT_SECONDS',
  CART_ABANDONED_TTL_SECONDS: 'CART_ABANDONED_TTL_SECONDS',
} as const;

export type AppSettingKey =
  (typeof APP_SETTING_KEYS)[keyof typeof APP_SETTING_KEYS];
