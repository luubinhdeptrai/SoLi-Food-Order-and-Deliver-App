import { Inject, Injectable } from '@nestjs/common';
import { and, ilike, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { restaurants } from '@/module/restaurant-catalog/restaurant/restaurant.schema';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';

export interface SearchFilters {
  name?: string;
  category?: string;
  lat?: number;
  lon?: number;
  radiusKm?: number;
  offset?: number;
  limit?: number;
}

@Injectable()
export class SearchRepository {
  constructor(
    @Inject(DB_CONNECTION) readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async search(filters: SearchFilters) {
    const conditions = [sql`${restaurants.isApproved} = true`];

    if (filters.name) {
      conditions.push(ilike(restaurants.name, `%${filters.name}%`));
    }

    if (filters.lat !== undefined && filters.lon !== undefined) {
      const radiusKm = filters.radiusKm || 5;
      const radiusDegrees = radiusKm / 111;
      conditions.push(
        sql`(${restaurants.latitude} IS NOT NULL AND ${restaurants.longitude} IS NOT NULL)`,
      );
      conditions.push(
        sql`SQRT(POWER(${restaurants.latitude} - ${filters.lat}, 2) + POWER(${restaurants.longitude} - ${filters.lon}, 2)) <= ${radiusDegrees}`,
      );
    }

    const baseQuery = this.db
      .select()
      .from(restaurants)
      .where(and(...conditions))
      .orderBy(restaurants.createdAt);

    const withOffset =
      filters.offset !== undefined ? baseQuery.offset(filters.offset) : baseQuery;
    const withLimit =
      filters.limit !== undefined ? withOffset.limit(filters.limit) : withOffset;

    return withLimit;
  }
}
