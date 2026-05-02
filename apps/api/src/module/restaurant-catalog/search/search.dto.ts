import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ---------------------------------------------------------------------------
// RestaurantSummaryDto
// ---------------------------------------------------------------------------

/**
 * Lean restaurant shape embedded inside item search results.
 * Deliberately excludes sensitive internal fields: ownerId, isApproved.
 * Mirrors RestaurantSearchResultDto but without the less-relevant audit fields.
 */
export class RestaurantSummaryDto {
  @ApiProperty({ description: 'Restaurant unique identifier', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Sunset Bistro' })
  name!: string;

  @ApiProperty({ example: '123 Main St, District 1' })
  address!: string;

  @ApiPropertyOptional({ example: 'Vietnamese' })
  cuisineType?: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/logo.jpg' })
  logoUrl?: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/cover.jpg' })
  coverImageUrl?: string | null;

  @ApiPropertyOptional({ example: 10.762622 })
  latitude?: number | null;

  @ApiPropertyOptional({ example: 106.660172 })
  longitude?: number | null;

  @ApiPropertyOptional({
    description: 'Straight-line distance from the search coordinates (km)',
    example: 1.45,
  })
  distanceKm?: number | null;
}

// ---------------------------------------------------------------------------
// ItemSearchRowDto
// ---------------------------------------------------------------------------

/**
 * A single menu item returned by food/item search, bundled with a lean
 * RestaurantSummaryDto so the UI can display full context without a second
 * request. Status is always 'available' — unavailable items are excluded.
 */
export class ItemSearchRowDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Bánh Mì Thịt Nướng' })
  name!: string;

  @ApiPropertyOptional({
    example: 'Grilled pork bánh mì with pickled vegetables',
  })
  description?: string | null;

  @ApiProperty({
    description: 'Price in local currency unit (numeric)',
    example: 35000,
  })
  price!: number;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/item.jpg' })
  imageUrl?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Tags such as vegetarian, spicy, halal',
    example: ['vegetarian'],
  })
  tags?: string[] | null;

  @ApiPropertyOptional({
    description: 'Parent menu category name (null when item has no category)',
    example: 'Sandwiches',
  })
  categoryName?: string | null;

  @ApiProperty({ type: () => RestaurantSummaryDto })
  restaurant!: RestaurantSummaryDto;
}

// ---------------------------------------------------------------------------
// UnifiedSearchTotalsDto
// ---------------------------------------------------------------------------

/**
 * Separate full-count values for both halves of the unified SERP.
 * Allows the UI to show "3 restaurants · 12 dishes" and render independent
 * pagination controls without a second request.
 */
export class UnifiedSearchTotalsDto {
  @ApiProperty({
    description: 'Total matching restaurants (ignoring pagination)',
    example: 5,
  })
  restaurants!: number;

  @ApiProperty({
    description: 'Total matching menu items (ignoring pagination)',
    example: 12,
  })
  items!: number;
}

// ---------------------------------------------------------------------------
// UnifiedSearchResponseDto
// ---------------------------------------------------------------------------

/**
 * Unified SERP response — mirrors the structure used by GrabFood / ShopeeFood:
 *
 * - `restaurants`: restaurants whose name, cuisineType, or category matched,
 *   OR that carry items matching the query (when `item` param is used).
 * - `items`: available menu items whose name or tags matched, each paired with
 *   their parent restaurant so the UI can link directly to the dish.
 * - `total`: full-count values for both sections (not capped by pagination).
 *
 * Both sections use the same `offset`/`limit` pagination params independently.
 */
export class UnifiedSearchResponseDto {
  @ApiProperty({
    description:
      'Restaurants matching the search criteria (no ownerId / isApproved exposed)',
    isArray: true,
    type: Object,
  })
  restaurants!: object[];

  @ApiProperty({ type: [ItemSearchRowDto] })
  items!: ItemSearchRowDto[];

  @ApiProperty({ type: UnifiedSearchTotalsDto })
  total!: UnifiedSearchTotalsDto;
}
