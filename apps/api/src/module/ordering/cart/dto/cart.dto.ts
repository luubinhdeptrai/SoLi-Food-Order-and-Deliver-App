import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsString,
  IsNumber,
  IsInt,
  Min,
  MinLength,
  MaxLength,
  Max,
  IsPositive,
} from 'class-validator';
import { Type } from 'class-transformer';

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

/**
 * Request body for POST /carts/my/items.
 *
 * Phase 2 note (D3-B): MenuItemProjector (Phase 3) is not yet implemented,
 * so price, name, and restaurantId are accepted directly from the client and
 * snapshotted into Redis.  Phase 3 will add server-side price validation once
 * the projector populates `ordering_menu_item_snapshots`.
 */
export class AddItemToCartDto {
  @ApiProperty({
    description: 'UUID of the menu item to add',
    format: 'uuid',
    example: '22222222-2222-2222-2222-222222222222',
  })
  @IsUUID()
  menuItemId!: string;

  @ApiProperty({
    description: 'UUID of the restaurant that owns this menu item (BR-2)',
    format: 'uuid',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @IsUUID()
  restaurantId!: string;

  @ApiProperty({
    description: 'Display name of the restaurant (snapshotted in cart)',
    example: 'Sunset Bistro',
    minLength: 1,
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  restaurantName!: string;

  @ApiProperty({
    description: 'Display name of the menu item (snapshotted in cart)',
    example: 'Margherita Pizza',
    minLength: 1,
    maxLength: 200,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  itemName!: string;

  @ApiProperty({
    description: 'Unit price in store currency (snapshotted in cart)',
    example: 12.5,
    minimum: 0.01,
  })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  unitPrice!: number;

  @ApiProperty({
    description: 'Quantity to add (≥ 1).  If item already in cart, quantities merge.',
    example: 2,
    minimum: 1,
    maximum: 99,
  })
  @IsInt()
  @Min(1)
  @Max(99)
  @Type(() => Number)
  quantity!: number;
}

/**
 * Request body for PATCH /carts/my/items/:menuItemId.
 * Setting quantity to 0 removes the item (same as DELETE).
 */
export class UpdateCartItemQuantityDto {
  @ApiProperty({
    description:
      'New absolute quantity (0 = remove item, 1-99 = update).  ' +
      'Sending 0 is equivalent to calling DELETE /carts/my/items/:menuItemId.',
    example: 3,
    minimum: 0,
    maximum: 99,
  })
  @IsInt()
  @Min(0)
  @Max(99)
  @Type(() => Number)
  quantity!: number;
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export class CartItemResponseDto {
  @ApiProperty({ format: 'uuid', example: '22222222-2222-2222-2222-222222222222' })
  menuItemId!: string;

  @ApiProperty({ example: 'Margherita Pizza' })
  itemName!: string;

  @ApiProperty({ example: 12.5 })
  unitPrice!: number;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ description: 'subtotal = unitPrice × quantity', example: 25.0 })
  subtotal!: number;
}

export class CartResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Stable cart ID (D5-B idempotency key for order placement)' })
  cartId!: string;

  @ApiProperty({ format: 'uuid' })
  customerId!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ example: 'Sunset Bistro' })
  restaurantName!: string;

  @ApiProperty({ type: [CartItemResponseDto] })
  items!: CartItemResponseDto[];

  @ApiProperty({ description: 'Sum of all item subtotals', example: 37.5 })
  totalAmount!: number;

  @ApiProperty({ description: 'ISO 8601 UTC creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO 8601 UTC last-updated timestamp' })
  updatedAt!: string;
}


