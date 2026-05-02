import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  restaurants,
  type Restaurant,
} from '@/module/restaurant-catalog/restaurant/restaurant.schema';
import { CreateRestaurantDto, UpdateRestaurantDto } from './dto/restaurant.dto';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';

export interface FindAllOptions {
  offset?: number;
  limit?: number;
  /** When true, only approved restaurants are returned (public-facing endpoint). */
  approvedOnly?: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
}

@Injectable()
export class RestaurantRepository {
  constructor(
    @Inject(DB_CONNECTION) readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findAll(opts: FindAllOptions = {}): Promise<PaginatedResult<Restaurant>> {
    const { offset, limit, approvedOnly } = opts;

    // Build the WHERE conditions based on options.
    const conditions = approvedOnly ? [eq(restaurants.isApproved, true)] : [];
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Run count and data queries in parallel for efficiency.
    const [countResult, rows] = await Promise.all([
      this.db
        .select({ total: count() })
        .from(restaurants)
        .where(whereClause),
      this.db
        .select()
        .from(restaurants)
        .where(whereClause)
        .orderBy(restaurants.createdAt)
        .offset(offset ?? 0)
        .limit(limit ?? 20),
    ]);

    return {
      data: rows,
      total: countResult[0]?.total ?? 0,
    };
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

