import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsUrl,
  MinLength,
} from 'class-validator';

export class CreateRestaurantDto {
  @ApiProperty({
    description: 'Restaurant display name',
    minLength: 2,
    example: 'Sunset Bistro',
  })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  name!: string;

  @ApiProperty({
    description: 'Street address for delivery and pickup',
    example: '123 Main St, District 1',
  })
  @IsString()
  address!: string;

  @ApiProperty({
    description: 'Restaurant contact phone number',
    example: '+1-555-123-4567',
  })
  @IsString()
  phone!: string;

  @ApiPropertyOptional({
    description: 'Short description shown in the catalog',
    example: 'Cozy local spot serving modern comfort food.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Latitude coordinate of the restaurant location',
    example: 10.762622,
  })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({
    description: 'Longitude coordinate of the restaurant location',
    example: 106.660172,
  })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({
    description: 'Cuisine type label used for search filtering',
    example: 'Vietnamese',
  })
  @IsOptional()
  @IsString()
  cuisineType?: string;

  @ApiPropertyOptional({
    description: 'URL of the restaurant logo image',
    example: 'https://cdn.example.com/restaurants/sunset-bistro-logo.jpg',
  })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional({
    description: 'URL of the restaurant cover/banner image',
    example: 'https://cdn.example.com/restaurants/sunset-bistro-cover.jpg',
  })
  @IsOptional()
  @IsUrl()
  coverImageUrl?: string;
}

export class UpdateRestaurantDto extends PartialType(CreateRestaurantDto) {
  @ApiPropertyOptional({
    description: 'Open/closed operating status',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isOpen?: boolean;

  @ApiPropertyOptional({
    description: 'Approval status (admin only)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isApproved?: boolean;
}

export class RestaurantResponseDto {
  @ApiProperty({
    description: 'Restaurant unique identifier',
    format: 'uuid',
    example: 'f7d6df40-6c7e-4f44-b0d0-c544d6f9e8f9',
  })
  id!: string;

  @ApiProperty({
    description: 'Owner user identifier',
    format: 'uuid',
    example: 'd58d4f63-4780-4049-b204-311f2e0e488f',
  })
  ownerId!: string;

  @ApiProperty({
    description: 'Restaurant display name',
    example: 'Sunset Bistro',
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'Catalog description',
    example: 'Cozy local spot serving modern comfort food.',
  })
  description?: string | null;

  @ApiProperty({
    description: 'Street address',
    example: '123 Main St, District 1',
  })
  address!: string;

  @ApiProperty({
    description: 'Contact phone number',
    example: '+1-555-123-4567',
  })
  phone!: string;

  @ApiProperty({
    description: 'Whether the restaurant is currently open',
    example: true,
  })
  isOpen!: boolean;

  @ApiProperty({
    description: 'Approval status controlled by admins',
    example: true,
  })
  isApproved!: boolean;

  @ApiPropertyOptional({
    description: 'Latitude coordinate',
    example: 10.762622,
  })
  latitude?: number | null;

  @ApiPropertyOptional({
    description: 'Longitude coordinate',
    example: 106.660172,
  })
  longitude?: number | null;

  @ApiPropertyOptional({
    description: 'Cuisine type (e.g. Vietnamese, Italian)',
    example: 'Vietnamese',
  })
  cuisineType?: string | null;

  @ApiPropertyOptional({
    description: 'Logo image URL',
    example: 'https://cdn.example.com/logo.jpg',
  })
  logoUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Cover/banner image URL',
    example: 'https://cdn.example.com/cover.jpg',
  })
  coverImageUrl?: string | null;

  @ApiProperty({
    description: 'Record creation timestamp',
    type: String,
    format: 'date-time',
    example: '2026-04-15T08:30:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    type: String,
    format: 'date-time',
    example: '2026-04-15T08:45:00.000Z',
  })
  updatedAt!: Date;
}

/**
 * Paginated wrapper for restaurant listing endpoints.
 * `total` is the full count matching the query (ignoring offset/limit),
 * which clients use to render pagination controls or stop infinite scroll.
 */
export class RestaurantListResponseDto {
  @ApiProperty({ type: [RestaurantResponseDto] })
  data!: RestaurantResponseDto[];

  @ApiProperty({
    description: 'Total number of restaurants matching the query',
    example: 42,
  })
  total!: number;
}

/**
 * Public search result — excludes sensitive internal fields (ownerId, isApproved).
 * Includes `distanceKm` when the request included lat/lon coordinates.
 */
export class RestaurantSearchResultDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Sunset Bistro' })
  name!: string;

  @ApiPropertyOptional({ example: 'Cozy local spot.' })
  description?: string | null;

  @ApiProperty({ example: '123 Main St' })
  address!: string;

  @ApiProperty({ example: '+1-555-123-4567' })
  phone!: string;

  @ApiProperty({ example: true })
  isOpen!: boolean;

  @ApiPropertyOptional({ example: 10.762622 })
  latitude?: number | null;

  @ApiPropertyOptional({ example: 106.660172 })
  longitude?: number | null;

  @ApiPropertyOptional({ example: 'Vietnamese' })
  cuisineType?: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/logo.jpg' })
  logoUrl?: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/cover.jpg' })
  coverImageUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Straight-line distance from the search coordinates in km',
    example: 1.45,
  })
  distanceKm?: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

/** Paginated wrapper for search results. */
export class RestaurantSearchResponseDto {
  @ApiProperty({ type: [RestaurantSearchResultDto] })
  data!: RestaurantSearchResultDto[];

  @ApiProperty({ example: 10 })
  total!: number;
}
