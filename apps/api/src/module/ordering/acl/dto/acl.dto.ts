import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ---------------------------------------------------------------------------
// Menu item snapshot
// ---------------------------------------------------------------------------

export const ACL_MENU_ITEM_STATUSES = [
  'available',
  'unavailable',
  'out_of_stock',
] as const;

export type AclMenuItemStatus = (typeof ACL_MENU_ITEM_STATUSES)[number];

/**
 * Response shape for GET /ordering/menu-items/:id
 * and each element of GET /ordering/menu-items?ids=...
 *
 * Mirrors `ordering_menu_item_snapshots` exactly so Swagger renders
 * the actual fields consumers will receive.
 */
export class MenuItemSnapshotResponseDto {
  @ApiProperty({
    description: 'Menu item identifier (sourced from upstream menu_items.id)',
    format: 'uuid',
    example: '4dc7cdfa-5a54-402f-b1a8-2d47de146081',
  })
  menuItemId!: string;

  @ApiProperty({
    description: 'Restaurant that owns this menu item',
    format: 'uuid',
    example: 'fe8b2648-2260-4bc5-9acd-d88972148c78',
  })
  restaurantId!: string;

  @ApiProperty({
    description: 'Display name of the menu item at the time of last sync',
    example: 'Margherita Pizza',
  })
  name!: string;

  @ApiProperty({
    description: 'Unit price at the time of last sync (frozen into order_items at checkout)',
    example: 12.5,
  })
  price!: number;

  @ApiProperty({
    description:
      'Canonical availability status. `unavailable` is set on deletion (tombstone).',
    enum: ACL_MENU_ITEM_STATUSES,
    enumName: 'AclMenuItemStatus',
    example: 'available',
  })
  status!: AclMenuItemStatus;

  @ApiProperty({
    description: 'Timestamp of the last MenuItemUpdatedEvent that updated this row',
    type: String,
    format: 'date-time',
    example: '2026-04-28T07:00:00.000Z',
  })
  lastSyncedAt!: Date;
}

// ---------------------------------------------------------------------------
// Restaurant snapshot
// ---------------------------------------------------------------------------

/**
 * Response shape for GET /ordering/restaurants/:id
 * and each element of GET /ordering/restaurants?ids=...
 *
 * Mirrors `ordering_restaurant_snapshots` exactly.
 */
export class RestaurantSnapshotResponseDto {
  @ApiProperty({
    description: 'Restaurant identifier (sourced from upstream restaurants.id)',
    format: 'uuid',
    example: 'fe8b2648-2260-4bc5-9acd-d88972148c78',
  })
  restaurantId!: string;

  @ApiProperty({
    description: 'Restaurant display name at the time of last sync',
    example: 'Sunset Bistro',
  })
  name!: string;

  @ApiProperty({
    description: 'Whether the restaurant is currently accepting orders',
    example: true,
  })
  isOpen!: boolean;

  @ApiProperty({
    description: 'Whether the restaurant has been approved by an admin',
    example: true,
  })
  isApproved!: boolean;

  @ApiProperty({
    description: 'Street address — used in OrderReadyForPickupEvent (Phase 6)',
    example: '123 Main St, District 1, Ho Chi Minh City',
  })
  address!: string;

  @ApiPropertyOptional({
    description: 'Cuisine type, e.g. "Vietnamese", "Japanese" (Issue #10)',
    example: 'Vietnamese',
    nullable: true,
    type: String,
  })
  cuisineType!: string | null;

  @ApiPropertyOptional({
    description: 'Latitude for Haversine distance check (BR-3)',
    example: 10.762622,
    nullable: true,
    type: Number,
  })
  latitude!: number | null;

  @ApiPropertyOptional({
    description: 'Longitude for Haversine distance check (BR-3)',
    example: 106.660172,
    nullable: true,
    type: Number,
  })
  longitude!: number | null;

  @ApiProperty({
    description: 'Timestamp of the last RestaurantUpdatedEvent that updated this row',
    type: String,
    format: 'date-time',
    example: '2026-04-28T07:00:00.000Z',
  })
  lastSyncedAt!: Date;
}
