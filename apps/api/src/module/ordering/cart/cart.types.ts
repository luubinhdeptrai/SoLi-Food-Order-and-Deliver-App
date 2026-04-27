/**
 * Redis-persisted Cart domain types for the Ordering bounded context.
 *
 * Design (D2-B): No `carts` / `cart_items` DB tables — Redis is the sole source
 * of truth.  Key format: `cart:<customerId>` (see CART_KEY_PREFIX).
 *
 * cartId is a stable UUID generated when the cart is created for the first time.
 * It is carried into orders.cartId (UNIQUE) to satisfy D5-B idempotency:
 * a second PlaceOrderCommand for the same cartId is detected by the DB constraint
 * and rejected before any side-effects happen.
 */
export interface CartItem {
  /** UUID of the upstream MenuItemModel (restaurant-catalog BC). */
  menuItemId: string;
  /** Snapshotted display name at add-time. */
  itemName: string;
  /** Snapshotted price at add-time (in store currency). */
  unitPrice: number;
  /** Positive integer — automatically merged when the same item is added again. */
  quantity: number;
}

export interface Cart {
  /**
   * Stable cart identifier — generated once when the cart is created.
   * Carried into orders.cartId for idempotency (D5-B).
   */
  cartId: string;
  /** The customer who owns this cart. Matches the Redis key suffix. */
  customerId: string;
  /**
   * All items must belong to this restaurant (BR-2: single-restaurant cart).
   * Set on first item add; cleared when the cart is emptied.
   */
  restaurantId: string;
  /** Snapshotted restaurant display name at first-item add time. */
  restaurantName: string;
  items: CartItem[];
  /** ISO 8601 UTC string — set once at cart creation. */
  createdAt: string;
  /** ISO 8601 UTC string — updated on every mutation; drives TTL-reset logic. */
  updatedAt: string;
}
