import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsString,
  IsNumber,
  IsInt,
  IsArray,
  IsOptional,
  ValidateNested,
  Min,
  MinLength,
  MaxLength,
  Max,
  IsPositive,
} from 'class-validator';
import { Type } from 'class-transformer';

// ---------------------------------------------------------------------------
// Nested DTOs for modifier selection
// ---------------------------------------------------------------------------

/**
 * A single modifier option selection.  Only IDs are provided by the client —
 * the server resolves name and price from the menu item snapshot.
 */
export class SelectedOptionDto {
  @ApiProperty({
    description: 'UUID of the modifier group',
    format: 'uuid',
    example: '33333333-3333-3333-3333-333333333333',
  })
  @IsUUID()
  groupId!: string;

  @ApiProperty({
    description: 'UUID of the modifier option within that group',
    format: 'uuid',
    example: '44444444-4444-4444-4444-444444444444',
  })
  @IsUUID()
  optionId!: string;
}

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

/**
 * Request body for POST /carts/my/items.
 *
 * Phase 2 note (D3-B): MenuItemProjector (Phase 3) is not yet implemented,
 * so price, name, and restaurantId are accepted directly from the client and
 * snapshotted into Redis.  Phase 3 adds server-side price + modifier validation
 * once the projector populates `ordering_menu_item_snapshots`.
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

  @ApiPropertyOptional({
    description:
      'Modifier option selections for this item.  ' +
      'When the snapshot is available (Phase 3), the server validates group ' +
      'membership, option availability, and min/max selection constraints.  ' +
      'Prices are resolved from the snapshot — never from client-supplied values.',
    type: [SelectedOptionDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectedOptionDto)
  selectedOptions?: SelectedOptionDto[];
}

/**
 * Request body for PATCH /carts/my/items/:cartItemId/modifiers.
 *
 * Replace-semantics: the server replaces selectedModifiers entirely with the
 * resolved result of selectedOptions.  Sending [] clears all modifiers (valid
 * only if no group has minSelections > 0).
 *
 * quantity is intentionally absent — never combined with modifier changes
 * (see Section 4.2 anti-pattern documentation).
 */
export class UpdateCartItemModifiersDto {
  @ApiProperty({
    description:
      'Full desired modifier state.  Server replaces existing modifiers entirely. ' +
      'Send [] to clear all modifiers (only valid when no group requires minSelections > 0).',
    type: [SelectedOptionDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectedOptionDto)
  selectedOptions!: SelectedOptionDto[];
}

/**
 * Request body for PATCH /carts/my/items/:cartItemId.
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

export class SelectedModifierResponseDto {
  @ApiProperty({ format: 'uuid' })
  groupId!: string;

  @ApiProperty({ example: 'Toppings' })
  groupName!: string;

  @ApiProperty({ format: 'uuid' })
  optionId!: string;

  @ApiProperty({ example: 'Extra Cheese' })
  optionName!: string;

  @ApiProperty({ example: 1.5 })
  price!: number;
}

export class CartItemResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Stable per-line-item ID.  Use this as the :cartItemId parameter in PATCH/DELETE endpoints.',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  cartItemId!: string;

  @ApiProperty({ format: 'uuid', example: '22222222-2222-2222-2222-222222222222' })
  menuItemId!: string;

  @ApiProperty({ example: 'Margherita Pizza' })
  itemName!: string;

  @ApiProperty({ example: 12.5 })
  unitPrice!: number;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ description: 'subtotal = (unitPrice + modifiers total) × quantity', example: 28.0 })
  subtotal!: number;

  @ApiProperty({ type: [SelectedModifierResponseDto] })
  selectedModifiers!: SelectedModifierResponseDto[];
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


