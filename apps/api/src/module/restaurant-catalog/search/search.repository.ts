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
// Scoring weights
// ---------------------------------------------------------------------------
// Restaurant section
const R_SCORE_NAME_EXACT = 12;
const R_SCORE_NAME_PARTIAL = 9;
const R_SCORE_CUISINE_MATCH = 6;
const R_SCORE_DESC_MATCH = 2;

// Item section
const I_SCORE_NAME_EXACT = 12;
const I_SCORE_NAME_PARTIAL = 8;
const I_SCORE_TAG_MATCH = 5;
const I_SCORE_CATEGORY_MATCH = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchFilters {
  /**
   * General search term (accent-insensitive via `unaccent`).
   * - Restaurant section: matched against name, cuisineType, description.
   * - Items section: matched against name, tags, category name.
   * Examples: "pho" matches "Phở", "banh mi" matches "Bánh Mì".
   */
  q?: string;
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
    @Inject(DB_CONNECTION) private readonly db: NodePgDatabase<typeof schema>,
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
    // Guard against negative offset — PostgreSQL rejects OFFSET < 0 with a
    // hard error. Clamp to 0 so an accidental negative value degrades
    // gracefully to "first page" instead of a 500.
    const safeOffset = Math.max(0, filters.offset ?? 0);
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

    // q must match at least one of: name, cuisineType, description, OR
    // the restaurant carries a matching item (so "pho" surfaces a pho house
    // even if the restaurant name is "Nhà Hàng Bắc" rather than "Phở Bắc").
    if (filters.q) {
      const q = filters.q;
      conditions.push(sql`(
        unaccent(${restaurants.name})        ILIKE unaccent(${'%' + q + '%'})
        OR unaccent(${restaurants.cuisineType}) ILIKE unaccent(${'%' + q + '%'})
        OR unaccent(${restaurants.description}) ILIKE unaccent(${'%' + q + '%'})
        OR EXISTS (
          SELECT 1 FROM menu_items mi
          WHERE  mi.restaurant_id = ${restaurants.id}
            AND  mi.status = 'available'
            AND  (
              unaccent(mi.name) ILIKE unaccent(${'%' + q + '%'})
              OR ${q} = ANY(mi.tags)
            )
        )
      )`);
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

    // ── Relevance score ───────────────────────────────────────────────────
    // Computed in SQL so ranking happens inside the DB and pagination is
    // applied to the already-ranked result set.
    const scoreExpr: SQL<unknown> = filters.q
      ? (() => {
          const q = filters.q;
          return sql<number>`(
            CASE WHEN unaccent(${restaurants.name}) ILIKE unaccent(${q})
                 THEN ${R_SCORE_NAME_EXACT} ELSE 0 END
            + CASE WHEN unaccent(${restaurants.name}) ILIKE unaccent(${'%' + q + '%'})
                        AND NOT (unaccent(${restaurants.name}) ILIKE unaccent(${q}))
                   THEN ${R_SCORE_NAME_PARTIAL} ELSE 0 END
            + CASE WHEN unaccent(${restaurants.cuisineType}) ILIKE unaccent(${'%' + q + '%'})
                   THEN ${R_SCORE_CUISINE_MATCH} ELSE 0 END
            + CASE WHEN unaccent(${restaurants.description}) ILIKE unaccent(${'%' + q + '%'})
                   THEN ${R_SCORE_DESC_MATCH} ELSE 0 END
          )`;
        })()
      : sql<number>`0`;

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
          score: scoreExpr,
        })
        .from(restaurants)
        .where(whereClause)
        // Primary: relevance score DESC; secondary: distance ASC when geo;
        // tertiary: creation date DESC (newest restaurants first).
        .orderBy(
          // Only sort by score when q is present; otherwise score is always 0
          // and ORDER BY 0 is an invalid positional reference in PostgreSQL.
          ...(filters.q ? [sql`${scoreExpr} DESC`] : []),
          ...(hasGeo ? [distanceExpr] : [sql`${restaurants.createdAt} DESC`]),
        )
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
   * The query is skipped entirely when no food-specific signal is provided
   * (q / tag / category). A plain cuisineType-only or geo-only search is a
   * restaurant-level query; there is nothing to rank items on.
   */
  private async findItems(
    filters: SearchFilters,
    offset: number,
    limit: number,
    radiusKm: number,
  ): Promise<{ data: ItemSearchRowDto[]; total: number }> {
    const hasFoodFilter = !!(filters.q || filters.tag || filters.category);
    if (!hasFoodFilter) {
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
      const q = filters.q;
      // Item matches q if: its name matches, OR it has a matching tag,
      // OR its parent category name matches.
      conditions.push(sql`(
        unaccent(${menuItems.name}) ILIKE unaccent(${'%' + q + '%'})
        OR ${q} = ANY(${menuItems.tags})
        OR EXISTS (
          SELECT 1 FROM menu_categories mc2
          WHERE mc2.id = ${menuItems.categoryId}
            AND unaccent(mc2.name) ILIKE unaccent(${'%' + q + '%'})
        )
      )`);
    }
    if (filters.tag) {
      conditions.push(sql`${filters.tag} = ANY(${menuItems.tags})`);
    }
    if (filters.category) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM menu_categories mc3
        WHERE mc3.id = ${menuItems.categoryId}
          AND unaccent(mc3.name) ILIKE unaccent(${'%' + filters.category + '%'})
      )`);
    }
    // cuisineType cross-filter: only items from restaurants of the right cuisine.
    if (filters.cuisineType) {
      conditions.push(
        sql`unaccent(${restaurants.cuisineType}) ILIKE unaccent(${'%' + filters.cuisineType + '%'})`,
      );
    }

    const whereClause = and(...conditions);
    const distanceExpr = this.buildDistanceExpr(filters);
    const hasGeo = filters.lat !== undefined && filters.lon !== undefined;

    // ── Item relevance score ──────────────────────────────────────────────
    const scoreExpr: SQL<unknown> = filters.q
      ? (() => {
          const q = filters.q;
          return sql<number>`(
            CASE WHEN unaccent(${menuItems.name}) ILIKE unaccent(${q})
                 THEN ${I_SCORE_NAME_EXACT} ELSE 0 END
            + CASE WHEN unaccent(${menuItems.name}) ILIKE unaccent(${'%' + q + '%'})
                        AND NOT (unaccent(${menuItems.name}) ILIKE unaccent(${q}))
                   THEN ${I_SCORE_NAME_PARTIAL} ELSE 0 END
            + CASE WHEN ${q} = ANY(${menuItems.tags})
                   THEN ${I_SCORE_TAG_MATCH} ELSE 0 END
            + CASE WHEN EXISTS (
                SELECT 1 FROM menu_categories mc4
                WHERE mc4.id = ${menuItems.categoryId}
                  AND unaccent(mc4.name) ILIKE unaccent(${'%' + q + '%'})
              ) THEN ${I_SCORE_CATEGORY_MATCH} ELSE 0 END
          )`;
        })()
      : sql<number>`0`;

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
          score: scoreExpr,
        })
        .from(menuItems)
        .innerJoin(restaurants, eq(menuItems.restaurantId, restaurants.id))
        .leftJoin(menuCategories, eq(menuItems.categoryId, menuCategories.id))
        .where(whereClause)
        .orderBy(
          // Only sort by score when q is present; score=0 would generate
          // ORDER BY 0 which PostgreSQL rejects as an invalid position.
          ...(filters.q ? [sql`${scoreExpr} DESC`] : []),
          ...(hasGeo ? [distanceExpr] : [sql`${menuItems.createdAt} DESC`]),
        )
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
      score: typeof row.score === 'number' ? row.score : Number(row.score ?? 0),
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
