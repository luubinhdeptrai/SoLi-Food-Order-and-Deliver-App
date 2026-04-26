/**
 * RestaurantUpdatedEvent
 *
 * Published by: RestaurantCatalog BC (RestaurantService)
 * Triggers after: create, update, approve/unapprove, open/close
 * Consumed by: Ordering BC → RestaurantSnapshotProjector (Phase 3)
 *
 * Includes `address` so the snapshot table can populate `restaurantAddress`
 * in OrderReadyForPickupEvent (Phase 6).
 */
export class RestaurantUpdatedEvent {
  constructor(
    public readonly restaurantId: string,
    public readonly name: string,
    public readonly isOpen: boolean,
    public readonly isApproved: boolean,
    public readonly address: string,
  ) {}
}
