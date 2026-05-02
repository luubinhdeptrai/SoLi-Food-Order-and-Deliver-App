/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { eq, and, count, inArray } from 'drizzle-orm';
import {
  menuItems,
  menuCategories,
  type MenuItem,
  type MenuCategory,
  type NewMenuCategory,
  menuItemStatusEnum,
} from '@/module/restaurant-catalog/menu/menu.schema';
import type {
  CreateMenuItemDto,
  UpdateMenuItemDto,
  CreateMenuCategoryDto,
  UpdateMenuCategoryDto,
  MenuItemStatusFilter,
} from './dto/menu.dto';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/drizzle/schema';

// PostgreSQL unique-constraint violation error code.
const PG_UNIQUE_VIOLATION = '23505';

export interface FindMenuItemsOptions {
  categoryId?: string;
  /**
   * 'available' | 'unavailable' | 'out_of_stock' — filter to exact status.
   * 'all' — return every status (useful for owner/admin views).
   * Defaults to 'available' when not provided.
   */
  status?: MenuItemStatusFilter;
  offset?: number;
  limit?: number;
}

export interface PaginatedMenuItems {
  data: MenuItem[];
  total: number;
}

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
    opts: FindMenuItemsOptions = {},
  ): Promise<PaginatedMenuItems> {
    const { categoryId, status = 'available', offset = 0, limit = 20 } = opts;

    const conditions = [eq(menuItems.restaurantId, restaurantId)];

    if (categoryId) {
      conditions.push(eq(menuItems.categoryId, categoryId));
    }

    // Apply status filter unless caller explicitly requests all items.
    // Public endpoint defaults to 'available' so customers never see unavailable items.
    if (status !== 'all') {
      conditions.push(
        eq(menuItems.status, status as (typeof menuItemStatusEnum.enumValues)[number]),
      );
    }

    const whereClause = and(...conditions);

    // Run count and data queries in parallel for efficiency.
    const [countResult, rows] = await Promise.all([
      this.db.select({ total: count() }).from(menuItems).where(whereClause),
      this.db
        .select()
        .from(menuItems)
        .where(whereClause)
        .orderBy(menuItems.createdAt)
        .offset(offset)
        .limit(limit),
    ]);

    return {
      data: rows,
      total: countResult[0]?.total ?? 0,
    };
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

    try {
      const [row] = await this.db.insert(menuCategories).values(data).returning();
      return row;
    } catch (err: unknown) {
      // Map PostgreSQL unique-constraint violation (Issue #13) to a 409 so
      // the service layer doesn't need to understand DB error codes.
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(
          `Category "${dto.name}" already exists for this restaurant`,
        );
      }
      throw err;
    }
  }

  async updateCategory(
    id: string,
    dto: UpdateMenuCategoryDto,
  ): Promise<MenuCategory> {
    try {
      const [row] = await this.db
        .update(menuCategories)
        .set({ ...dto, updatedAt: new Date() })
        .where(eq(menuCategories.id, id))
        .returning();
      return row;
    } catch (err: unknown) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(
          `A category named "${dto.name}" already exists for this restaurant`,
        );
      }
      throw err;
    }
  }

  async removeCategory(id: string): Promise<void> {
    await this.db.delete(menuCategories).where(eq(menuCategories.id, id));
  }
}

