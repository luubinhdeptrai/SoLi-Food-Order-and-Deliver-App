import { Injectable, Inject } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';
import {
  orderingRestaurantSnapshots,
  type NewOrderingRestaurantSnapshot,
  type OrderingRestaurantSnapshot,
} from '../schemas/restaurant-snapshot.schema';

/**
 * RestaurantSnapshotRepository
 *
 * Read/write access to `ordering_restaurant_snapshots` — the Ordering BC's local
 * projection of upstream RestaurantUpdatedEvents (populated by
 * RestaurantSnapshotProjector, Phase 3).
 *
 * Phase: 3 — ACL Layer
 */
@Injectable()
export class RestaurantSnapshotRepository {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findById(
    restaurantId: string,
  ): Promise<OrderingRestaurantSnapshot | null> {
    const result = await this.db
      .select()
      .from(orderingRestaurantSnapshots)
      .where(eq(orderingRestaurantSnapshots.restaurantId, restaurantId))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Bulk-fetch snapshots by multiple IDs.
   * Used by AclService (bulk query endpoint) and PlaceOrderHandler (Phase 4).
   * Returns only rows that exist — callers must handle missing entries.
   */
  async findManyByIds(
    restaurantIds: string[],
  ): Promise<OrderingRestaurantSnapshot[]> {
    if (restaurantIds.length === 0) return [];
    return this.db
      .select()
      .from(orderingRestaurantSnapshots)
      .where(inArray(orderingRestaurantSnapshots.restaurantId, restaurantIds));
  }

  async upsert(data: NewOrderingRestaurantSnapshot): Promise<void> {
    await this.db
      .insert(orderingRestaurantSnapshots)
      .values(data)
      .onConflictDoUpdate({
        target: orderingRestaurantSnapshots.restaurantId,
        set: {
          name: data.name,
          isOpen: data.isOpen,
          isApproved: data.isApproved,
          address: data.address,
          cuisineType: data.cuisineType,
          latitude: data.latitude,
          longitude: data.longitude,
          lastSyncedAt: data.lastSyncedAt ?? new Date(),
        },
      });
  }
}
