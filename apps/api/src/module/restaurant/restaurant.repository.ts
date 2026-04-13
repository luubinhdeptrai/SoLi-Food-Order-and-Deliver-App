import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '@/drizzle/drizzle.service';
import { restaurants, type Restaurant, type NewRestaurant } from '@/drizzle/schemas/restaurant.schema';
import { CreateRestaurantDto, UpdateRestaurantDto } from './dto/restaurant.dto';

@Injectable()
export class RestaurantRepository {
  constructor(private readonly db: DrizzleService) {}

  async findAll(): Promise<Restaurant[]> {
    return this.db.db.select().from(restaurants).orderBy(restaurants.createdAt);
  }

  async findById(id: string): Promise<Restaurant | null> {
    const result = await this.db.db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  async create(ownerId: string, dto: CreateRestaurantDto): Promise<Restaurant> {
    const [row] = await this.db.db
      .insert(restaurants)
      .values({ ...dto, ownerId })
      .returning();
    return row;
  }

  async update(id: string, dto: UpdateRestaurantDto): Promise<Restaurant> {
    const [row] = await this.db.db
      .update(restaurants)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(restaurants.id, id))
      .returning();
    return row;
  }

  async remove(id: string): Promise<void> {
    await this.db.db.delete(restaurants).where(eq(restaurants.id, id));
  }
}
