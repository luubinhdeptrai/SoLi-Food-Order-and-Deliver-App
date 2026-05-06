import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  restaurants,
  type Restaurant,
} from '@/module/restaurant-catalog/restaurant/restaurant.schema';
import { CreateRestaurantDto, UpdateRestaurantDto } from './dto/restaurant.dto';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';

@Injectable()
export class RestaurantRepository {
  constructor(
    @Inject(DB_CONNECTION) readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findAll(): Promise<Restaurant[]> {
    return this.db.select().from(restaurants).orderBy(restaurants.createdAt);
  }

  async findById(id: string): Promise<Restaurant | null> {
    const result = await this.db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  async create(ownerId: string, dto: CreateRestaurantDto): Promise<Restaurant> {
    const [row] = await this.db
      .insert(restaurants)
      .values({ ...dto, ownerId })
      .returning();
    return row;
  }

  async update(id: string, dto: UpdateRestaurantDto): Promise<Restaurant> {
    const [row] = await this.db
      .update(restaurants)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(restaurants.id, id))
      .returning();
    return row;
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(restaurants).where(eq(restaurants.id, id));
  }
}
