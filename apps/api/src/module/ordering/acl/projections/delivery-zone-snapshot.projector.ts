import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { DeliveryZoneSnapshotUpdatedEvent } from '@/shared/events/delivery-zone-snapshot-updated.event';
import { DeliveryZoneSnapshotRepository } from '../repositories/delivery-zone-snapshot.repository';

/**
 * DeliveryZoneSnapshotProjector
 *
 * Listens for DeliveryZoneSnapshotUpdatedEvent from the RestaurantCatalog BC
 * and maintains the local `ordering_delivery_zone_snapshots` read-model.
 *
 * Design:
 *  - Idempotent: ON CONFLICT (zone_id) DO UPDATE — safe to replay events.
 *  - isDeleted=true → calls markDeleted() to tombstone the row rather than
 *    physically remove it, preserving event-replay correctness.
 *  - No auth, no guards — projectors run inside the in-process EventBus.
 *  - DB errors are logged at ERROR level and re-thrown for observability.
 *
 * Phase: 4 — ACL Layer (delivery-zones snapshot)
 * Architecture decision: D3-B + D4-B (PostgreSQL snapshots, no runtime imports).
 */
@Injectable()
@EventsHandler(DeliveryZoneSnapshotUpdatedEvent)
export class DeliveryZoneSnapshotProjector
  implements IEventHandler<DeliveryZoneSnapshotUpdatedEvent>
{
  private readonly logger = new Logger(DeliveryZoneSnapshotProjector.name);

  constructor(
    private readonly deliveryZoneSnapshotRepo: DeliveryZoneSnapshotRepository,
  ) {}

  async handle(event: DeliveryZoneSnapshotUpdatedEvent): Promise<void> {
    const {
      zoneId,
      restaurantId,
      name,
      radiusKm,
      baseFee,
      perKmRate,
      avgSpeedKmh,
      prepTimeMinutes,
      bufferMinutes,
      isActive,
      isDeleted,
    } = event;

    this.logger.debug(
      `Processing delivery zone snapshot: zoneId=${zoneId}, restaurantId=${restaurantId}, isDeleted=${isDeleted}`,
    );

    try {
      if (isDeleted) {
        // Hard-delete path: tombstone the row so it is excluded from BR-3 queries.
        await this.deliveryZoneSnapshotRepo.markDeleted(zoneId);
        this.logger.log(`Delivery zone snapshot tombstoned: zoneId=${zoneId}`);
      } else {
        // Create / update path: upsert the full zone snapshot.
        await this.deliveryZoneSnapshotRepo.upsert({
          zoneId,
          restaurantId,
          name,
          radiusKm,
          baseFee,
          perKmRate,
          avgSpeedKmh,
          prepTimeMinutes,
          bufferMinutes,
          isActive,
          isDeleted: false,
          lastSyncedAt: new Date(),
        });
        this.logger.log(
          `Delivery zone snapshot upserted: zoneId=${zoneId} (isActive=${isActive})`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to process delivery zone snapshot zoneId=${zoneId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }
}
