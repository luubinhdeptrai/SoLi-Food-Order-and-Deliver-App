import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  deliveryZones,
  type DeliveryZone,
} from '@/module/restaurant-catalog/restaurant/restaurant.schema';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';
import type { CreateDeliveryZoneDto, UpdateDeliveryZoneDto } from './zones.dto';

@Injectable()
export class ZonesRepository {
  constructor(
    @Inject(DB_CONNECTION) readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findByRestaurant(restaurantId: string): Promise<DeliveryZone[]> {
    return this.db
      .select()
      .from(deliveryZones)
      .where(eq(deliveryZones.restaurantId, restaurantId))
      .orderBy(deliveryZones.createdAt);
  }

  async findById(id: string): Promise<DeliveryZone | null> {
    const result = await this.db
      .select()
      .from(deliveryZones)
      .where(eq(deliveryZones.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Returns all active zones for a restaurant ordered by radius ascending.
   * Used by estimateDelivery — the first zone whose radiusKm >= distanceKm is
   * the eligible zone.
   */
  async findActiveByRestaurantOrderedByRadius(
    restaurantId: string,
  ): Promise<DeliveryZone[]> {
    return this.db
      .select()
      .from(deliveryZones)
      .where(
        and(
          eq(deliveryZones.restaurantId, restaurantId),
          eq(deliveryZones.isActive, true),
        ),
      )
      .orderBy(asc(deliveryZones.radiusKm));
  }

  async create(
    restaurantId: string,
    dto: CreateDeliveryZoneDto,
  ): Promise<DeliveryZone> {
    const [row] = await this.db
      .insert(deliveryZones)
      .values({
        restaurantId,
        name: dto.name,
        radiusKm: dto.radiusKm,
        baseFee: dto.baseFee,
        perKmRate: dto.perKmRate,
        avgSpeedKmh: dto.avgSpeedKmh ?? 30,
        prepTimeMinutes: dto.prepTimeMinutes ?? 15,
        bufferMinutes: dto.bufferMinutes ?? 5,
      })
      .returning();
    return row;
  }

  async update(id: string, dto: UpdateDeliveryZoneDto): Promise<DeliveryZone> {
    // Explicit per-field mapping avoids spreading undefined DTO fields into .set().
    // Drizzle treats undefined as "skip this column" but that is undocumented behaviour;
    // an explicit patch object is safer and self-documenting.
    const patch: Partial<typeof deliveryZones.$inferInsert> = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.radiusKm !== undefined && { radiusKm: dto.radiusKm }),
      ...(dto.baseFee !== undefined && { baseFee: dto.baseFee }),
      ...(dto.perKmRate !== undefined && { perKmRate: dto.perKmRate }),
      ...(dto.avgSpeedKmh !== undefined && { avgSpeedKmh: dto.avgSpeedKmh }),
      ...(dto.prepTimeMinutes !== undefined && {
        prepTimeMinutes: dto.prepTimeMinutes,
      }),
      ...(dto.bufferMinutes !== undefined && {
        bufferMinutes: dto.bufferMinutes,
      }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      updatedAt: new Date(),
    };

    const [row] = await this.db
      .update(deliveryZones)
      .set(patch)
      .where(eq(deliveryZones.id, id))
      .returning();
    return row;
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(deliveryZones).where(eq(deliveryZones.id, id));
  }
}
