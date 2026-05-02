/**
 * RestaurantUpdatedEvent
 *
 * Published by: RestaurantCatalog BC (RestaurantService)
 * Triggers after: create, update, approve/unapprove, open/close, delete
 * Consumed by: Ordering BC → RestaurantSnapshotProjector (Phase 3)
 *
 * Design notes:
 *  - `address` is required for OrderReadyForPickupEvent payload (Phase 6).
 *  - `latitude`/`longitude` are optional — not all restaurants have coordinates.
 *  - `cuisineType` is optional — carries the cuisine label for snapshot queries.
 *  - `deliveryRadiusKm` has been removed; delivery zones are now managed via the
 *    dedicated `delivery_zones` table and `DeliveryZoneSnapshotUpdatedEvent`.
 */
export class RestaurantUpdatedEvent {
  constructor(
    public readonly restaurantId: string,
    public readonly name: string,
    public readonly isOpen: boolean,
    public readonly isApproved: boolean,
    public readonly address: string,
    /** Nullable because many restaurants may not have coordinates yet. */
    public readonly latitude?: number | null,
    public readonly longitude?: number | null,
    /** Cuisine label (e.g. 'Vietnamese', 'Italian') — null when not set. */
    public readonly cuisineType?: string | null,
  ) {}
}
