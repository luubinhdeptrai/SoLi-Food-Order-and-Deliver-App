import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsUUID,
  IsUrl,
  IsArray,
  Min,
  MinLength,
} from 'class-validator';

export const MENU_ITEM_CATEGORIES = [
  'salads',
  'desserts',
  'breads',
  'mains',
  'drinks',
  'sides',
] as const;

export const MENU_ITEM_STATUSES = [
  'available',
  'unavailable',
  'out_of_stock',
] as const;

export type MenuItemCategory = (typeof MENU_ITEM_CATEGORIES)[number];
export type MenuItemStatus = (typeof MENU_ITEM_STATUSES)[number];

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
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiProperty({
    description: 'Category used for menu grouping',
    enum: MENU_ITEM_CATEGORIES,
    enumName: 'MenuItemCategory',
    example: 'mains',
  })
  @IsEnum(MENU_ITEM_CATEGORIES)
  category!: MenuItemCategory;

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

  @ApiPropertyOptional({
    description: 'Whether customers can currently order this item',
    example: true,
  })
  @IsOptional()
  isAvailable?: boolean;
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
    description: 'Optional category filter',
    enum: MENU_ITEM_CATEGORIES,
    enumName: 'MenuItemCategory',
    example: 'drinks',
  })
  @IsOptional()
  @IsEnum(MENU_ITEM_CATEGORIES)
  category?: MenuItemCategory;
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

  @ApiProperty({
    enum: MENU_ITEM_CATEGORIES,
    enumName: 'MenuItemCategory',
    example: 'mains',
  })
  category!: MenuItemCategory;

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

  @ApiProperty({ example: true })
  isAvailable!: boolean;

  @ApiPropertyOptional({
    type: [String],
    example: ['vegetarian', 'popular'],
  })
  tags?: string[] | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-04-15T08:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-04-15T08:00:00.000Z',
  })
  updatedAt!: Date;
}
