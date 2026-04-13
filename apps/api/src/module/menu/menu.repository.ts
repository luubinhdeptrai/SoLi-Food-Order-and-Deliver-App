import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DrizzleService } from '@/drizzle/drizzle.service';
import { menuItems, type MenuItem } from '@/drizzle/schemas/menu.schema';
import type { CreateMenuItemDto, MenuItemCategory, UpdateMenuItemDto } from './dto/menu.dto';

@Injectable()
export class MenuRepository {
  constructor(private readonly db: DrizzleService) {}

  async findByRestaurant(
    restaurantId: string,
    category?: MenuItemCategory,
  ): Promise<MenuItem[]> {
    const conditions = [eq(menuItems.restaurantId, restaurantId)];
    if (category) {
      conditions.push(eq(menuItems.category, category));
    }
    return this.db.db
      .select()
      .from(menuItems)
      .where(and(...conditions))
      .orderBy(menuItems.createdAt);
  }

  async findById(id: string): Promise<MenuItem | null> {
    const result = await this.db.db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  async create(dto: CreateMenuItemDto): Promise<MenuItem> {
    const [row] = await this.db.db
      .insert(menuItems)
      .values(dto)
      .returning();
    return row;
  }

  async update(id: string, dto: UpdateMenuItemDto): Promise<MenuItem> {
    const [row] = await this.db.db
      .update(menuItems)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(menuItems.id, id))
      .returning();
    return row;
  }

  async remove(id: string): Promise<void> {
    await this.db.db.delete(menuItems).where(eq(menuItems.id, id));
  }
}
