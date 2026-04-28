/**
 * Redis key patterns for the Ordering bounded context (D5-A).
 *
 * Key format: idempotency:order:<X-Idempotency-Key-header-value>
 * Stored value: orderId (UUID string) once the order is created
 *
 * TTL is resolved at runtime from the DB setting ORDER_IDEMPOTENCY_TTL_SECONDS.
 * The value below is used as a fallback before Phase 1 DB seeding is complete.
 */
export const IDEMPOTENCY_KEY_PREFIX = 'idempotency:order:' as const;

/**
 * Fallback TTL (5 min) used when app_settings DB row is not yet seeded.
 * Matches the ORDER_IDEMPOTENCY_TTL_SECONDS seed value of 300s defined in
 * Phase 1 (app_settings table). The old value of 86400 (24h) was wrong and
 * would have blocked cart reuse for far longer than intended (M-3 fix).
 */
export const IDEMPOTENCY_TTL_FALLBACK_SECONDS = 300;

/**
 * Cart key format: cart:<customerId>
 * Each customer has exactly one active cart (D2-B, Redis-only).
 */
export const CART_KEY_PREFIX = 'cart:' as const;

/**
 * Cart TTL — 7 days. Items left in cart expire silently.
 */
export const CART_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Cart checkout lock (Phase 4).
 * Full key: `${CART_KEY_PREFIX}${customerId}:lock`
 * Acquired with SET NX EX before PlaceOrderHandler runs to prevent
 * concurrent checkouts of the same cart.
 */
export const CART_LOCK_SUFFIX = ':lock' as const;

/**
 * TTL for the cart checkout lock — 30 seconds.
 * Covers worst-case PlaceOrderHandler latency (DB write + VNPay init).
 */
export const CART_LOCK_TTL_SECONDS = 30;
