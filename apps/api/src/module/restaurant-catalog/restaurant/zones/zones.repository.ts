import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
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
        deliveryFee: dto.deliveryFee ?? 0,
        estimatedMinutes: dto.estimatedMinutes ?? 30,
      })
      .returning();
    return row;
  }

  async update(id: string, dto: UpdateDeliveryZoneDto): Promise<DeliveryZone> {
    const [row] = await this.db
      .update(deliveryZones)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(deliveryZones.id, id))
      .returning();
    return row;
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(deliveryZones).where(eq(deliveryZones.id, id));
  }
}
