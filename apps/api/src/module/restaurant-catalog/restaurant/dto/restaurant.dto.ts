import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
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
}

export class UpdateRestaurantDto extends PartialType(CreateRestaurantDto) {
  @ApiPropertyOptional({
    description: 'Open/closed operating status',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isOpen?: boolean;
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
