/**
 * RestaurantUpdatedEvent
 *
 * Published by: RestaurantCatalog BC (RestaurantService)
 * Triggers after: create, update, approve/unapprove, open/close
 * Consumed by: Ordering BC → RestaurantSnapshotProjector (Phase 3)
 *
 * Includes `address` so the snapshot table can populate `restaurantAddress`
 * in OrderReadyForPickupEvent (Phase 6).
 *
 * Optional fields (`deliveryRadiusKm`, `latitude`, `longitude`) are included
 * to future-proof BR-3 (delivery-radius check, Phase 4). They are nullable
 * because the upstream `restaurants` table may not have these values populated.
 */
export class RestaurantUpdatedEvent {
  constructor(
    public readonly restaurantId: string,
    public readonly name: string,
    public readonly isOpen: boolean,
    public readonly isApproved: boolean,
    public readonly address: string,
    /** BR-3: delivery radius. Nullable until restaurant-catalog adds the column. */
    public readonly deliveryRadiusKm?: number | null,
    /** Haversine distance source. Nullable until upstream populates it. */
    public readonly latitude?: number | null,
    public readonly longitude?: number | null,
  ) {}
}
