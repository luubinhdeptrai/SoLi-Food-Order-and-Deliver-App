import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { RestaurantUpdatedEvent } from '@/shared/events/restaurant-updated.event';
import { RestaurantSnapshotRepository } from '../repositories/restaurant-snapshot.repository';

/**
 * RestaurantSnapshotProjector
 *
 * Listens for RestaurantUpdatedEvent from the RestaurantCatalog BC and upserts
 * the local read-model in `ordering_restaurant_snapshots` via
 * RestaurantSnapshotRepository (single source of upsert logic).
 *
 * Design:
 *  - Idempotent: ON CONFLICT (restaurant_id) DO UPDATE — safe to replay events.
 *  - No auth, no guards — projectors run inside the process event bus.
 *  - `deliveryRadiusKm`, `latitude`, `longitude` are optional in the event and
 *    nullable in the DB — BR-3 will work correctly once upstream provides them.
 *  - `lastSyncedAt` is reset on every upsert to track freshness.
 *  - DB errors are logged at ERROR level and re-thrown for observability.
 *
 * Phase: 3 — ACL Layer
 * Architecture decision: D3-B + D4-B (PostgreSQL snapshots, no runtime imports).
 */
@Injectable()
@EventsHandler(RestaurantUpdatedEvent)
export class RestaurantSnapshotProjector
  implements IEventHandler<RestaurantUpdatedEvent>
{
  private readonly logger = new Logger(RestaurantSnapshotProjector.name);

  constructor(
    private readonly restaurantSnapshotRepo: RestaurantSnapshotRepository,
  ) {}

  async handle(event: RestaurantUpdatedEvent): Promise<void> {
    const {
      restaurantId,
      name,
      isOpen,
      isApproved,
      address,
      deliveryRadiusKm = null,
      latitude = null,
      longitude = null,
    } = event;

    this.logger.debug(
      `Upserting restaurant snapshot: ${restaurantId} (isOpen=${isOpen}, isApproved=${isApproved})`,
    );

    try {
      await this.restaurantSnapshotRepo.upsert({
        restaurantId,
        name,
        isOpen,
        isApproved,
        address,
        deliveryRadiusKm,
        latitude,
        longitude,
        lastSyncedAt: new Date(),
      });
      this.logger.log(`Restaurant snapshot upserted: ${restaurantId}`);
    } catch (err) {
      this.logger.error(
        `Failed to upsert restaurant snapshot ${restaurantId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }
}
