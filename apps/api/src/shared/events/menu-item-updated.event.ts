/**
 * MenuItemUpdatedEvent
 *
 * Published by: RestaurantCatalog BC (MenuService)
 * Triggers after: create, update, toggleSoldOut, delete
 * Consumed by: Ordering BC → MenuItemProjector (Phase 3)
 *
 * Payload uses `status` enum as the single source of truth.
 * `isAvailable` is intentionally omitted — derive with `status === 'available'`.
 */
export class MenuItemUpdatedEvent {
  constructor(
    public readonly menuItemId: string,
    public readonly restaurantId: string,
    public readonly name: string,
    /**
     * Current unit price. Snapshot consumers store this value;
     * it is frozen into order_items at checkout time.
     */
    public readonly price: number,
    /** Canonical availability field. 'available' | 'unavailable' | 'out_of_stock' */
    public readonly status: 'available' | 'unavailable' | 'out_of_stock',
  ) {}
}
