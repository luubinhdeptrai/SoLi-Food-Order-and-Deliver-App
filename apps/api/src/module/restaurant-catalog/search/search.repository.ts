import { Inject, Injectable } from '@nestjs/common';
import { and, count, ilike, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { restaurants } from '@/module/restaurant-catalog/restaurant/restaurant.schema';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';

// ---------------------------------------------------------------------------
// Pagination constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchFilters {
  name?: string;
  /** Text search against menu_category names within each restaurant. */
  category?: string;
  lat?: number;
  lon?: number;
  radiusKm?: number;
  offset?: number;
  limit?: number;
}

/**
 * Public-facing restaurant shape returned by the search endpoint.
 * Deliberately excludes sensitive internal fields: ownerId, isApproved.
 * Includes optional distanceKm when the caller provided lat/lon (Issue #19, #11).
 */
export type RestaurantSearchRow = Pick<
  typeof restaurants.$inferSelect,
  | 'id'
  | 'name'
  | 'description'
  | 'address'
  | 'phone'
  | 'isOpen'
  | 'latitude'
  | 'longitude'
  | 'cuisineType'
  | 'logoUrl'
  | 'coverImageUrl'
  | 'createdAt'
  | 'updatedAt'
> & { distanceKm: number | null };

export interface SearchResult {
  data: RestaurantSearchRow[];
  total: number;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class SearchRepository {
  constructor(
    @Inject(DB_CONNECTION) readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async search(filters: SearchFilters): Promise<SearchResult> {
    const safeLimit = Math.min(
      filters.limit ?? DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );
    const safeOffset = filters.offset ?? 0;
    const radiusKm = filters.radiusKm ?? 5;

    // -----------------------------------------------------------------------
    // Build WHERE conditions
    // -----------------------------------------------------------------------

    // Always filter: only show open, approved restaurants to customers (Issues #4, #6).
    const conditions = [
      sql`${restaurants.isApproved} = true`,
      sql`${restaurants.isOpen} = true`,
    ];

    // Substring match against restaurant name.
    if (filters.name) {
      conditions.push(ilike(restaurants.name, `%${filters.name}%`));
    }

    // Category filter: EXISTS subquery so we don't need DISTINCT (Issue #3).
    // Finds restaurants that have at least one menu item whose category name
    // matches the search term (case-insensitive substring match).
    if (filters.category) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM menu_items mi
          JOIN menu_categories mc ON mc.id = mi.category_id
          WHERE mi.restaurant_id = ${restaurants.id}
            AND mc.name ILIKE ${'%' + filters.category + '%'}
        )`,
      );
    }

    // Haversine radius filter — only when coordinates are supplied (Issue #1 fix).
    if (filters.lat !== undefined && filters.lon !== undefined) {
      // Guard: restaurant must have coordinates stored.
      conditions.push(
        sql`(${restaurants.latitude} IS NOT NULL AND ${restaurants.longitude} IS NOT NULL)`,
      );
      // Haversine formula for great-circle distance (km).
      // Accurate at Vietnam latitudes (~10–21°N); replaces the former degree-based approximation.
      conditions.push(sql`(
        2 * 6371 * ASIN(SQRT(
          POWER(SIN(RADIANS(${restaurants.latitude} - ${filters.lat}) / 2), 2) +
          COS(RADIANS(${filters.lat})) * COS(RADIANS(${restaurants.latitude})) *
          POWER(SIN(RADIANS(${restaurants.longitude} - ${filters.lon}) / 2), 2)
        ))
      ) <= ${radiusKm}`);
    }

    const whereClause = and(...conditions);

    // -----------------------------------------------------------------------
    // Distance expression for SELECT and ORDER BY (Issue #11)
    // -----------------------------------------------------------------------

    // When lat/lon are provided we include the computed distance in the result
    // and sort by proximity. Otherwise we fall back to creation date.
    const distanceExpr =
      filters.lat !== undefined && filters.lon !== undefined
        ? sql<number>`(
            2 * 6371 * ASIN(SQRT(
              POWER(SIN(RADIANS(${restaurants.latitude} - ${filters.lat}) / 2), 2) +
              COS(RADIANS(${filters.lat})) * COS(RADIANS(${restaurants.latitude})) *
              POWER(SIN(RADIANS(${restaurants.longitude} - ${filters.lon}) / 2), 2)
            ))
          )`
        : sql<null>`null`;

    // -----------------------------------------------------------------------
    // Execute COUNT + data queries in parallel (Issue #12)
    // -----------------------------------------------------------------------

    const [countResult, rows] = await Promise.all([
      this.db.select({ total: count() }).from(restaurants).where(whereClause),
      this.db
        .select({
          // Public fields only — no ownerId or isApproved (Issue #19).
          id: restaurants.id,
          name: restaurants.name,
          description: restaurants.description,
          address: restaurants.address,
          phone: restaurants.phone,
          isOpen: restaurants.isOpen,
          latitude: restaurants.latitude,
          longitude: restaurants.longitude,
          cuisineType: restaurants.cuisineType,
          logoUrl: restaurants.logoUrl,
          coverImageUrl: restaurants.coverImageUrl,
          createdAt: restaurants.createdAt,
          updatedAt: restaurants.updatedAt,
          distanceKm: distanceExpr,
        })
        .from(restaurants)
        .where(whereClause)
        .orderBy(
          // Sort by distance when coordinates are provided; otherwise by creation date.
          filters.lat !== undefined && filters.lon !== undefined
            ? distanceExpr
            : restaurants.createdAt,
        )
        .offset(safeOffset)
        .limit(safeLimit),
    ]);

    return {
      data: rows as RestaurantSearchRow[],
      total: countResult[0]?.total ?? 0,
    };
  }
}
