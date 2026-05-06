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

/**
 * A single selected modifier option snapshotted at cart-add time.
 * Price is frozen here — not re-validated at checkout (same pattern as item price).
 */
export interface SelectedModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  /** Snapshotted at add-time. */
  price: number;
}

export interface CartItem {
  /**
   * Stable per-line-item UUID generated at append time.
   * Required by PATCH/DELETE endpoints now that multiple lines can share the
   * same menuItemId (different modifier combinations — Case 9 fix).
   */
  cartItemId: string;
  /**
   * Deterministic fingerprint built from resolved SelectedModifier[] (not raw DTO).
   * Sorted by groupId+optionId so order of selection does not affect identity.
   * Empty string when no modifiers are selected.
   * Used for merge-identity: same menuItemId + same fingerprint → merge quantity.
   */
  modifierFingerprint: string;
  /** UUID of the upstream MenuItemModel (restaurant-catalog BC). */
  menuItemId: string;
  /** Snapshotted display name at add-time. */
  itemName: string;
  /**
   * Base unit price snapshotted at add-time (excluding modifier prices).
   * Total item price = unitPrice + sum(selectedModifiers[*].price).
   */
  unitPrice: number;
  /** Positive integer — automatically merged when the same item is added again. */
  quantity: number;
  /**
   * Modifier options selected by the customer, snapshotted at add-time.
   * Empty array when the item has no modifiers or none were selected.
   */
  selectedModifiers: SelectedModifier[];
}

/**
 * Builds a deterministic fingerprint from a resolved SelectedModifier array.
 *
 * Rules:
 *  - Input is sorted by (groupId, optionId) so insertion order is irrelevant.
 *  - Returns '' for empty arrays (no modifier selected).
 *  - Must be called on RESOLVED modifiers (not raw SelectedOptionDto) so that
 *    only server-confirmed IDs are hashed. This prevents a client from crafting
 *    a fingerprint from an invalid optionId that passes merge but fails validation.
 */
export function buildFingerprintFromResolved(
  resolved: SelectedModifier[],
): string {
  if (resolved.length === 0) return '';
  return [...resolved]
    .sort(
      (a, b) =>
        a.groupId.localeCompare(b.groupId) ||
        a.optionId.localeCompare(b.optionId),
    )
    .map((o) => `${o.groupId}:${o.optionId}`)
    .join('|');
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
