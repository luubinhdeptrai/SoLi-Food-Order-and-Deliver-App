/**
 * DeliveryZoneSnapshotUpdatedEvent
 *
 * Published by: RestaurantCatalog BC (ZonesService)
 * Triggers after: create, update, remove (hard-delete)
 * Consumed by: Ordering BC → DeliveryZoneSnapshotProjector
 *
 * One event per zone mutation — mirrors the MenuItemUpdatedEvent pattern.
 *
 * `isDeleted = true` is the tombstone signal for hard-deleted zones.
 * The projector marks the snapshot row as deleted rather than physically
 * removing it, preserving event-replay safety.
 */
export class DeliveryZoneSnapshotUpdatedEvent {
  constructor(
    /** Upstream delivery_zones.id */
    public readonly zoneId: string,
    /** Parent restaurant — used for bulk snapshot queries at checkout (BR-3). */
    public readonly restaurantId: string,
    public readonly name: string,
    public readonly radiusKm: number,
    public readonly baseFee: number,
    public readonly perKmRate: number,
    public readonly avgSpeedKmh: number,
    public readonly prepTimeMinutes: number,
    public readonly bufferMinutes: number,
    public readonly isActive: boolean,
    /**
     * true  → zone was hard-deleted; projector must tombstone the snapshot row.
     * false → zone was created or updated; projector must upsert.
     */
    public readonly isDeleted: boolean,
  ) {}
}
