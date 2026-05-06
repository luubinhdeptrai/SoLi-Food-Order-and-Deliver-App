import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  MinLength,
  Min,
  Max,
  IsLatitude,
  IsLongitude,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsVNDFee } from '@/shared/validators/vnd-amount.validator';

export class CreateDeliveryZoneDto {
  @ApiProperty({
    description: 'Zone name',
    minLength: 1,
    example: 'Downtown',
  })
  @IsString()
  @MinLength(1, { message: 'Name must be at least 1 character' })
  name!: string;

  @ApiProperty({
    description: 'Delivery radius in kilometers',
    minimum: 0.1,
    example: 5,
  })
  @IsNumber()
  @Min(0.1)
  radiusKm!: number;

  @ApiProperty({
    description: 'Base delivery fee in VND (integer, multiple of 1000; 0 = free)',
    minimum: 0,
    example: 15000,
  })
  @IsVNDFee()
  baseFee!: number;

  @ApiProperty({
    description: 'Additional fee per kilometre in VND (integer, multiple of 1000; 0 = flat-rate only)',
    minimum: 0,
    example: 3000,
  })
  @IsVNDFee()
  perKmRate!: number;

  @ApiPropertyOptional({
    description: 'Average delivery speed in km/h (used for ETA calculation)',
    minimum: 1,
    maximum: 120,
    example: 20,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(120)
  avgSpeedKmh?: number;

  @ApiPropertyOptional({
    description: 'Restaurant preparation time in minutes',
    minimum: 0,
    example: 15,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  prepTimeMinutes?: number;

  @ApiPropertyOptional({
    description: 'Buffer time added to ETA in minutes',
    minimum: 0,
    example: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  bufferMinutes?: number;
}

export class UpdateDeliveryZoneDto extends PartialType(CreateDeliveryZoneDto) {
  @ApiPropertyOptional({
    description: 'Whether this zone is active',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class DeliveryZoneResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '44444444-4444-4444-4444-444444444444',
  })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    example: '11111111-1111-1111-1111-111111111111',
  })
  restaurantId!: string;

  @ApiProperty({ example: 'Downtown' })
  name!: string;

  @ApiProperty({ example: 5 })
  radiusKm!: number;

  @ApiProperty({ example: 15000 })
  baseFee!: number;

  @ApiProperty({ example: 3000 })
  perKmRate!: number;

  @ApiProperty({ example: 20 })
  avgSpeedKmh!: number;

  @ApiProperty({ example: 15 })
  prepTimeMinutes!: number;

  @ApiProperty({ example: 5 })
  bufferMinutes!: number;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-04-27T10:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-04-27T10:00:00.000Z',
  })
  updatedAt!: Date;
}

// ---------------------------------------------------------------------------
// Delivery estimate
// ---------------------------------------------------------------------------

/**
 * Query params for GET /restaurants/:restaurantId/delivery-zones/delivery-estimate
 *
 * IMPORTANT: HTTP query parameters arrive as strings. The @Type(() => Number)
 * decorator from class-transformer coerces them to numbers before class-validator
 * runs its numeric checks. Without it, @IsNumber() / @IsLatitude() would always
 * fail at runtime.
 */
export class DeliveryEstimateQueryDto {
  @ApiProperty({
    description: 'Customer latitude',
    example: 10.7769,
  })
  @Type(() => Number)
  @IsLatitude()
  @IsNumber()
  lat!: number;

  @ApiProperty({
    description: 'Customer longitude',
    example: 106.7009,
  })
  @Type(() => Number)
  @IsLongitude()
  @IsNumber()
  lon!: number;
}

export class DeliveryFeeBreakdownDto {
  @ApiProperty({ description: 'Flat base fee', example: 15000 })
  baseFee!: number;

  @ApiProperty({ description: 'Distance-based fee', example: 9000 })
  distanceFee!: number;

  @ApiProperty({ description: 'Restaurant prep time (minutes)', example: 15 })
  prepTimeMinutes!: number;

  @ApiProperty({ description: 'Travel time estimate (minutes)', example: 9 })
  travelTimeMinutes!: number;

  @ApiProperty({ description: 'Buffer time (minutes)', example: 5 })
  bufferMinutes!: number;
}

export class DeliveryEstimateResponseDto {
  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ description: 'Straight-line distance in km', example: 3.0 })
  distanceKm!: number;

  @ApiProperty({
    description: 'Matched delivery zone',
    example: {
      id: '44444444-4444-4444-4444-444444444444',
      name: 'Downtown',
      radiusKm: 5,
    },
  })
  zone!: { id: string; name: string; radiusKm: number };

  @ApiProperty({ description: 'Total delivery fee (VND)', example: 24000 })
  deliveryFee!: number;

  @ApiProperty({
    description: 'Estimated delivery time in minutes',
    example: 29,
  })
  estimatedMinutes!: number;

  @ApiProperty({ type: DeliveryFeeBreakdownDto })
  breakdown!: DeliveryFeeBreakdownDto;
}
