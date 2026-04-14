import { Inject, Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import {
  menuItems,
  type MenuItem,
} from '@/module/restaurant-catalog/menu/menu.schema';
import type {
  CreateMenuItemDto,
  MenuItemCategory,
  UpdateMenuItemDto,
} from './dto/menu.dto';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../drizzle/schema';

@Injectable()
export class MenuRepository {
  constructor(
    @Inject(DB_CONNECTION) readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findByRestaurant(
    restaurantId: string,
    category?: MenuItemCategory,
  ): Promise<MenuItem[]> {
    const conditions = [eq(menuItems.restaurantId, restaurantId)];
    if (category) {
      conditions.push(eq(menuItems.category, category));
    }

    return await this.db
      .select()
      .from(menuItems)
      .where(and(...conditions))
      .orderBy(menuItems.createdAt);
  }

  async findById(id: string): Promise<MenuItem | null> {
    const result = await this.db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  async create(dto: CreateMenuItemDto): Promise<MenuItem> {
    const [row] = await this.db.insert(menuItems).values(dto).returning();
    return row;
  }

  async update(id: string, dto: UpdateMenuItemDto): Promise<MenuItem> {
    const [row] = await this.db
      .update(menuItems)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(menuItems.id, id))
      .returning();
    return row;
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(menuItems).where(eq(menuItems.id, id));
  }
}
