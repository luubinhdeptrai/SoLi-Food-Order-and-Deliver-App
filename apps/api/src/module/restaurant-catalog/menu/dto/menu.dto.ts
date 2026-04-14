import { PartialType, OmitType } from '@nestjs/mapped-types';
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
  @IsUUID()
  restaurantId!: string;

  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  name!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsEnum(MENU_ITEM_CATEGORIES)
  category!: MenuItemCategory;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateMenuItemDto extends PartialType(
  OmitType(CreateMenuItemDto, ['restaurantId'] as const),
) {
  @IsOptional()
  @IsEnum(MENU_ITEM_STATUSES)
  status?: MenuItemStatus;

  @IsOptional()
  isAvailable?: boolean;
}

export class QueryMenuItemDto {
  @IsUUID()
  restaurantId!: string;

  @IsOptional()
  @IsEnum(MENU_ITEM_CATEGORIES)
  category?: MenuItemCategory;
}
