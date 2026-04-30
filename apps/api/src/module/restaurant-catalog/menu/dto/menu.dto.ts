import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export const MENU_ITEM_STATUSES = [
  'available',
  'unavailable',
  'out_of_stock',
] as const;

export type MenuItemStatus = (typeof MENU_ITEM_STATUSES)[number];

// ---------------------------------------------------------------------------
// MenuCategory DTOs (per-restaurant categories replacing global enum)
// ---------------------------------------------------------------------------

export class CreateMenuCategoryDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Restaurant that owns this category',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @IsUUID()
  restaurantId!: string;

  @ApiProperty({ description: 'Category display name', example: 'Burgers' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ description: 'Sort order', example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateMenuCategoryDto extends PartialType(
  OmitType(CreateMenuCategoryDto, ['restaurantId'] as const),
) {}

export class MenuCategoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ example: 'Burgers' })
  name!: string;

  @ApiProperty({ example: 0 })
  displayOrder!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

// ---------------------------------------------------------------------------
// MenuItem DTOs
// ---------------------------------------------------------------------------

export class CreateMenuItemDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Restaurant identifier that owns this menu item',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @IsUUID()
  restaurantId!: string;

  @ApiProperty({
    description: 'Display name of the menu item',
    example: 'Margherita Pizza',
    minLength: 2,
  })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  name!: string;

  @ApiProperty({
    description: 'Price of the item in store currency',
    example: 12.5,
    minimum: 0.01,
  })
  @IsNumber()
  @Min(0.01)
  price!: number;

  @ApiPropertyOptional({
    description: 'UUID of the per-restaurant category this item belongs to',
    format: 'uuid',
    example: '44444444-4444-4444-4444-444444444444',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Short item description shown to customers',
    example: 'Classic tomato, basil, and mozzarella',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Internal stock keeping unit reference',
    example: 'PIZZA-MARG-01',
  })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({
    description: 'Public image URL of the menu item',
    example: 'https://cdn.example.com/menu/margherita.jpg',
  })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Tags used for searching and filtering',
    type: [String],
    example: ['vegetarian', 'popular'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateMenuItemDto extends PartialType(
  OmitType(CreateMenuItemDto, ['restaurantId'] as const),
) {
  @ApiPropertyOptional({
    description: 'Current selling status of this menu item',
    enum: MENU_ITEM_STATUSES,
    enumName: 'MenuItemStatus',
    example: 'available',
  })
  @IsOptional()
  @IsEnum(MENU_ITEM_STATUSES)
  status?: MenuItemStatus;
}

export class QueryMenuItemDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Restaurant identifier to fetch menu items for',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @IsUUID()
  restaurantId!: string;

  @ApiPropertyOptional({
    description: 'Optional category filter by category UUID',
    format: 'uuid',
    example: '44444444-4444-4444-4444-444444444444',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class MenuItemResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '22222222-2222-2222-2222-222222222222',
  })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    example: '11111111-1111-1111-1111-111111111111',
  })
  restaurantId!: string;

  @ApiProperty({ example: 'Margherita Pizza' })
  name!: string;

  @ApiPropertyOptional({ example: 'Classic tomato, basil, and mozzarella' })
  description?: string | null;

  @ApiProperty({ example: 12.5 })
  price!: number;

  @ApiPropertyOptional({ example: 'PIZZA-MARG-01' })
  sku?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '44444444-4444-4444-4444-444444444444',
  })
  categoryId?: string | null;

  @ApiProperty({
    enum: MENU_ITEM_STATUSES,
    enumName: 'MenuItemStatus',
    example: 'available',
  })
  status!: MenuItemStatus;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/menu/margherita.jpg',
  })
  imageUrl?: string | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['vegetarian', 'popular'],
  })
  tags?: string[] | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
