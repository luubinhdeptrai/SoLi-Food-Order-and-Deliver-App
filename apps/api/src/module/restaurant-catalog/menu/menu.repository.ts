/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Inject, Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import {
  menuItems,
  menuCategories,
  type MenuItem,
  type MenuCategory,
  type NewMenuCategory,
} from '@/module/restaurant-catalog/menu/menu.schema';
import type {
  CreateMenuItemDto,
  UpdateMenuItemDto,
  CreateMenuCategoryDto,
  UpdateMenuCategoryDto,
} from './dto/menu.dto';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/drizzle/schema';

@Injectable()
export class MenuRepository {
  constructor(
    @Inject(DB_CONNECTION) readonly db: NodePgDatabase<typeof schema>,
  ) {}

  // -------------------------------------------------------------------------
  // Menu Items
  // -------------------------------------------------------------------------

  async findByRestaurant(
    restaurantId: string,
    categoryId?: string,
  ): Promise<MenuItem[]> {
    const conditions = [eq(menuItems.restaurantId, restaurantId)];
    if (categoryId) {
      conditions.push(eq(menuItems.categoryId, categoryId));
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

  // -------------------------------------------------------------------------
  // Menu Categories
  // -------------------------------------------------------------------------

  async findCategoriesByRestaurant(
    restaurantId: string,
  ): Promise<MenuCategory[]> {
    return this.db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.restaurantId, restaurantId))
      .orderBy(menuCategories.displayOrder);
  }

  async findCategoryById(id: string): Promise<MenuCategory | null> {
    const result = await this.db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  async createCategory(dto: CreateMenuCategoryDto): Promise<MenuCategory> {
    const data: NewMenuCategory = {
      restaurantId: dto.restaurantId,
      name: dto.name,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      displayOrder: dto.displayOrder ?? 0,
    };
    const [row] = await this.db.insert(menuCategories).values(data).returning();
    return row;
  }

  async updateCategory(
    id: string,
    dto: UpdateMenuCategoryDto,
  ): Promise<MenuCategory> {
    const [row] = await this.db
      .update(menuCategories)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(menuCategories.id, id))
      .returning();
    return row;
  }

  async removeCategory(id: string): Promise<void> {
    await this.db.delete(menuCategories).where(eq(menuCategories.id, id));
  }
}
