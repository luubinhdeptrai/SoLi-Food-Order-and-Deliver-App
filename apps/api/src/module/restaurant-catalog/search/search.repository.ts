import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, SQL, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { restaurants } from '@/module/restaurant-catalog/restaurant/restaurant.schema';
import {
  menuItems,
  menuCategories,
  menuItemStatusEnum,
} from '@/module/restaurant-catalog/menu/menu.schema';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';
import type { RestaurantSearchResultDto } from '../restaurant/dto/restaurant.dto';
import type { ItemSearchRowDto, RestaurantSummaryDto } from './search.dto';

// ---------------------------------------------------------------------------
// Pagination constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Earth mean radius in km (WGS-84). Used in the Haversine formula. */
const EARTH_RADIUS_KM = 6371;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchFilters {
  /**
   * General search term (accent-insensitive via `unaccent`).
   * - Restaurant section: matched against `restaurants.name`.
   * - Items section: matched against `menu_items.name`.
   * Examples: "pho" matches "Phở", "banh mi" matches "Bánh Mì".
   */
  q?: string;
  /** Targeted restaurant name filter (accent-insensitive). */
  name?: string;
  /** Targeted menu item name filter (accent-insensitive). */
  item?: string;
  /** Menu category name filter (accent-insensitive). */
  category?: string;
  /** Cuisine type filter on `restaurants.cuisine_type` (accent-insensitive). */
  cuisineType?: string;
  /** Return only results associated with this tag value (exact match). */
  tag?: string;
  lat?: number;
  lon?: number;
  radiusKm?: number;
  offset?: number;
  limit?: number;
}

/**
 * Unified SERP result — two independent sections with separate full-counts.
 * Both sections share the same pagination params (offset / limit).
 */
export interface UnifiedSearchResult {
  restaurants: RestaurantSearchResultDto[];
  items: ItemSearchRowDto[];
  total: {
    restaurants: number;
    items: number;
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class SearchRepository {
  constructor(
    @Inject(DB_CONNECTION) readonly db: NodePgDatabase<typeof schema>,
  ) {}

  // -------------------------------------------------------------------------
  // Public entry point
  // -------------------------------------------------------------------------

  /**
   * Unified search: runs restaurant and item queries concurrently and returns
   * both result sets in one response. Either section may be empty (e.g. the
   * items section is skipped when no food-specific filter is supplied).
   */
  async search(filters: SearchFilters): Promise<UnifiedSearchResult> {
    const safeLimit = Math.min(
      filters.limit ?? DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );
    const safeOffset = filters.offset ?? 0;
    const radiusKm = filters.radiusKm ?? 5;

    const [restaurantResult, itemResult] = await Promise.all([
      this.findRestaurants(filters, safeOffset, safeLimit, radiusKm),
      this.findItems(filters, safeOffset, safeLimit, radiusKm),
    ]);

    return {
      restaurants: restaurantResult.data,
      items: itemResult.data,
      total: {
        restaurants: restaurantResult.total,
        items: itemResult.total,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Restaurant sub-query
  // -------------------------------------------------------------------------

  private async findRestaurants(
    filters: SearchFilters,
    offset: number,
    limit: number,
    radiusKm: number,
  ): Promise<{ data: RestaurantSearchResultDto[]; total: number }> {
    const conditions: SQL<unknown>[] = [
      sql`${restaurants.isApproved} = true`,
      sql`${restaurants.isOpen} = true`,
    ];

    // Bounding-box pre-filter + exact Haversine check — cheap scan first.
    this.applyGeoConditions(conditions, filters, radiusKm);

    // `q` matches restaurant name (item-name matches surfaced in findItems).
    // `unaccent` makes "pho" match "Phở", "banh" match "Bánh", etc.
    if (filters.q) {
      conditions.push(
        sql`unaccent(${restaurants.name}) ILIKE unaccent(${'%' + filters.q + '%'})`,
      );
    }
    if (filters.name) {
      conditions.push(
        sql`unaccent(${restaurants.name}) ILIKE unaccent(${'%' + filters.name + '%'})`,
      );
    }
    if (filters.cuisineType) {
      conditions.push(
        sql`unaccent(${restaurants.cuisineType}) ILIKE unaccent(${'%' + filters.cuisineType + '%'})`,
      );
    }
    // Category: restaurant must have ≥1 category whose name matches.
    if (filters.category) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM menu_categories mc
        WHERE mc.restaurant_id = ${restaurants.id}
          AND unaccent(mc.name) ILIKE unaccent(${'%' + filters.category + '%'})
      )`);
    }
    // Item name: restaurant must carry ≥1 available item whose name matches.
    if (filters.item) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM menu_items mi
        WHERE mi.restaurant_id = ${restaurants.id}
          AND unaccent(mi.name) ILIKE unaccent(${'%' + filters.item + '%'})
          AND mi.status = 'available'
      )`);
    }
    // Tag: restaurant must carry ≥1 available item tagged with this value.
    if (filters.tag) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM menu_items mi
        WHERE mi.restaurant_id = ${restaurants.id}
          AND mi.status = 'available'
          AND ${filters.tag} = ANY(mi.tags)
      )`);
    }

    const whereClause = and(...conditions);
    const distanceExpr = this.buildDistanceExpr(filters);
    const hasGeo = filters.lat !== undefined && filters.lon !== undefined;

    const [countResult, rows] = await Promise.all([
      this.db.select({ total: count() }).from(restaurants).where(whereClause),
      this.db
        .select({
          // Public projection — no ownerId or isApproved exposed to callers.
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
        .orderBy(hasGeo ? distanceExpr : restaurants.createdAt)
        .offset(offset)
        .limit(limit),
    ]);

    return {
      data: rows as RestaurantSearchResultDto[],
      total: countResult[0]?.total ?? 0,
    };
  }

  // -------------------------------------------------------------------------
  // Item sub-query
  // -------------------------------------------------------------------------

  /**
   * Returns available menu items matching the food-specific filters, each
   * paired with a lean restaurant summary.
   *
   * Skips the query entirely when no food-specific filter is supplied (q /
   * item / tag) — there is nothing to match items on in that case.
   */
  private async findItems(
    filters: SearchFilters,
    offset: number,
    limit: number,
    radiusKm: number,
  ): Promise<{ data: ItemSearchRowDto[]; total: number }> {
    if (!filters.q && !filters.item && !filters.tag) {
      return { data: [], total: 0 };
    }

    // Item-level conditions — references both menuItems and the JOINed restaurants table.
    const conditions: SQL<unknown>[] = [
      eq(
        menuItems.status,
        'available' as (typeof menuItemStatusEnum.enumValues)[number],
      ),
      sql`${restaurants.isApproved} = true`,
      sql`${restaurants.isOpen} = true`,
    ];

    // Geo conditions reference `restaurants` columns — works via the INNER JOIN.
    this.applyGeoConditions(conditions, filters, radiusKm);

    if (filters.q) {
      conditions.push(
        sql`unaccent(${menuItems.name}) ILIKE unaccent(${'%' + filters.q + '%'})`,
      );
    }
    if (filters.item) {
      conditions.push(
        sql`unaccent(${menuItems.name}) ILIKE unaccent(${'%' + filters.item + '%'})`,
      );
    }
    if (filters.tag) {
      conditions.push(sql`${filters.tag} = ANY(${menuItems.tags})`);
    }

    const whereClause = and(...conditions);
    const distanceExpr = this.buildDistanceExpr(filters);
    const hasGeo = filters.lat !== undefined && filters.lon !== undefined;

    const [countResult, rows] = await Promise.all([
      this.db
        .select({ total: count() })
        .from(menuItems)
        .innerJoin(restaurants, eq(menuItems.restaurantId, restaurants.id))
        .where(whereClause),
      this.db
        .select({
          // Item fields
          id: menuItems.id,
          name: menuItems.name,
          description: menuItems.description,
          price: menuItems.price,
          imageUrl: menuItems.imageUrl,
          tags: menuItems.tags,
          // Category name — LEFT JOIN since items may have no category.
          categoryName: menuCategories.name,
          // Lean restaurant summary — no ownerId or isApproved.
          restaurantId: restaurants.id,
          restaurantName: restaurants.name,
          restaurantAddress: restaurants.address,
          cuisineType: restaurants.cuisineType,
          logoUrl: restaurants.logoUrl,
          coverImageUrl: restaurants.coverImageUrl,
          restaurantLatitude: restaurants.latitude,
          restaurantLongitude: restaurants.longitude,
          distanceKm: distanceExpr,
        })
        .from(menuItems)
        .innerJoin(restaurants, eq(menuItems.restaurantId, restaurants.id))
        .leftJoin(menuCategories, eq(menuItems.categoryId, menuCategories.id))
        .where(whereClause)
        .orderBy(hasGeo ? distanceExpr : menuItems.createdAt)
        .limit(limit)
        .offset(offset),
    ]);

    const data: ItemSearchRowDto[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      price: row.price,
      imageUrl: row.imageUrl,
      tags: row.tags,
      categoryName: row.categoryName,
      restaurant: {
        id: row.restaurantId,
        name: row.restaurantName,
        address: row.restaurantAddress,
        cuisineType: row.cuisineType,
        logoUrl: row.logoUrl,
        coverImageUrl: row.coverImageUrl,
        latitude: row.restaurantLatitude,
        longitude: row.restaurantLongitude,
        distanceKm: row.distanceKm !== null ? Number(row.distanceKm) : null,
      } satisfies RestaurantSummaryDto,
    }));

    return { data, total: countResult[0]?.total ?? 0 };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Pushes a cheap lat/lon bounding-box pre-filter followed by an exact
   * Haversine radius check into `conditions`. The bounding-box eliminates the
   * majority of rows using simple arithmetic (index-scannable) before the
   * trigonometric Haversine expression runs only on the surviving candidates.
   *
   * 1° latitude  ≈ 111 km (constant)
   * 1° longitude ≈ 111 × cos(lat) km (varies with latitude)
   */
  private applyGeoConditions(
    conditions: SQL<unknown>[],
    filters: SearchFilters,
    radiusKm: number,
  ): void {
    if (filters.lat === undefined || filters.lon === undefined) return;

    conditions.push(
      sql`${restaurants.latitude} IS NOT NULL AND ${restaurants.longitude} IS NOT NULL`,
    );

    const latDelta = radiusKm / 111.0;
    const lonDelta =
      radiusKm / (111.0 * Math.cos((filters.lat * Math.PI) / 180));

    conditions.push(
      sql`${restaurants.latitude} BETWEEN ${filters.lat - latDelta} AND ${filters.lat + latDelta}`,
    );
    conditions.push(
      sql`${restaurants.longitude} BETWEEN ${filters.lon - lonDelta} AND ${filters.lon + lonDelta}`,
    );

    // Exact great-circle distance check (Haversine formula, result in km).
    conditions.push(sql`(
      2 * ${EARTH_RADIUS_KM} * ASIN(SQRT(
        POWER(SIN(RADIANS(${restaurants.latitude} - ${filters.lat}) / 2), 2) +
        COS(RADIANS(${filters.lat})) * COS(RADIANS(${restaurants.latitude})) *
        POWER(SIN(RADIANS(${restaurants.longitude} - ${filters.lon}) / 2), 2)
      ))
    ) <= ${radiusKm}`);
  }

  /**
   * Returns a Haversine distance SQL expression suitable for SELECT and
   * ORDER BY. Returns SQL NULL when no coordinates were provided so the
   * SELECT list shape stays consistent regardless of whether geo is active.
   */
  private buildDistanceExpr(filters: SearchFilters): SQL<unknown> {
    if (filters.lat === undefined || filters.lon === undefined) {
      return sql<null>`null`;
    }
    return sql<number>`(
      2 * ${EARTH_RADIUS_KM} * ASIN(SQRT(
        POWER(SIN(RADIANS(${restaurants.latitude} - ${filters.lat}) / 2), 2) +
        COS(RADIANS(${filters.lat})) * COS(RADIANS(${restaurants.latitude})) *
        POWER(SIN(RADIANS(${restaurants.longitude} - ${filters.lon}) / 2), 2)
      ))
    )`;
  }
}
