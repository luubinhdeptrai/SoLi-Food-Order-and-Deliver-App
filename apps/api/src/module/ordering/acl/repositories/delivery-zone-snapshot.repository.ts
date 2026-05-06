import { Injectable, Inject } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';
import {
  orderingDeliveryZoneSnapshots,
  type NewOrderingDeliveryZoneSnapshot,
  type OrderingDeliveryZoneSnapshot,
} from '../schemas/delivery-zone-snapshot.schema';

/**
 * DeliveryZoneSnapshotRepository
 *
 * Read/write access to `ordering_delivery_zone_snapshots` — the Ordering BC's
 * local projection of upstream DeliveryZoneSnapshotUpdatedEvents (populated by
 * DeliveryZoneSnapshotProjector).
 *
 * Write path: upsert (create/update) + markDeleted (tombstone on hard-delete).
 * Read path:  findActiveByRestaurantId (BR-3 checkout check in PlaceOrderHandler).
 *
 * Phase: 4 — ACL Layer (delivery-zones snapshot)
 */
@Injectable()
export class DeliveryZoneSnapshotRepository {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Returns all active, non-deleted zone snapshots for a restaurant,
   * ordered by radius ascending (innermost zone first).
   * Used by PlaceOrderHandler to enforce BR-3 delivery-radius check.
   */
  async findActiveByRestaurantId(
    restaurantId: string,
  ): Promise<OrderingDeliveryZoneSnapshot[]> {
    return this.db
      .select()
      .from(orderingDeliveryZoneSnapshots)
      .where(
        and(
          eq(orderingDeliveryZoneSnapshots.restaurantId, restaurantId),
          eq(orderingDeliveryZoneSnapshots.isActive, true),
          eq(orderingDeliveryZoneSnapshots.isDeleted, false),
        ),
      );
  }

  /**
   * Upsert a zone snapshot row.
   * ON CONFLICT (zone_id) DO UPDATE — idempotent; safe to replay events.
   */
  async upsert(data: NewOrderingDeliveryZoneSnapshot): Promise<void> {
    await this.db
      .insert(orderingDeliveryZoneSnapshots)
      .values(data)
      .onConflictDoUpdate({
        target: orderingDeliveryZoneSnapshots.zoneId,
        set: {
          restaurantId: data.restaurantId,
          name: data.name,
          radiusKm: data.radiusKm,
          baseFee: data.baseFee,
          perKmRate: data.perKmRate,
          avgSpeedKmh: data.avgSpeedKmh,
          prepTimeMinutes: data.prepTimeMinutes,
          bufferMinutes: data.bufferMinutes,
          isActive: data.isActive,
          isDeleted: data.isDeleted,
          lastSyncedAt: data.lastSyncedAt ?? new Date(),
        },
      });
  }

  /**
   * Tombstone a zone row on hard-delete.
   * Sets isDeleted=true and isActive=false so it is excluded from
   * findActiveByRestaurantId without removing it (preserves replay safety).
   */
  async markDeleted(zoneId: string): Promise<void> {
    await this.db
      .update(orderingDeliveryZoneSnapshots)
      .set({
        isDeleted: true,
        isActive: false,
        lastSyncedAt: new Date(),
      })
      .where(eq(orderingDeliveryZoneSnapshots.zoneId, zoneId));
  }
}
