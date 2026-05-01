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
      conditions.push(
        sql`(${restaurants.latitude} IS NOT NULL AND ${restaurants.longitude} IS NOT NULL)`,
      );
      // Haversine formula — accurate great-circle distance regardless of latitude.
      // Replaces the previous Euclidean degree-based approximation which was inaccurate
      // at Vietnam latitudes (~10–21°N) and did not account for longitude compression.
      conditions.push(
        sql`(2 * 6371 * ASIN(SQRT(
          POWER(SIN(RADIANS(${restaurants.latitude} - ${filters.lat}) / 2), 2) +
          COS(RADIANS(${filters.lat})) * COS(RADIANS(${restaurants.latitude})) *
          POWER(SIN(RADIANS(${restaurants.longitude} - ${filters.lon}) / 2), 2)
        ))) <= ${radiusKm}`,
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
