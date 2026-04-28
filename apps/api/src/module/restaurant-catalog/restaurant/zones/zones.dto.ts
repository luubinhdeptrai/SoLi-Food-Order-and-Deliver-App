import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsBoolean, MinLength, Min } from 'class-validator';

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

  @ApiPropertyOptional({
    description: 'Delivery fee for this zone',
    minimum: 0,
    example: 2.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryFee?: number;

  @ApiPropertyOptional({
    description: 'Estimated delivery time in minutes',
    minimum: 0,
    example: 30,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedMinutes?: number;
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

  @ApiProperty({
    example: 'Downtown',
  })
  name!: string;

  @ApiProperty({
    example: 5,
  })
  radiusKm!: number;

  @ApiProperty({
    example: 2.5,
  })
  deliveryFee!: number;

  @ApiProperty({
    example: 30,
  })
  estimatedMinutes!: number;

  @ApiProperty({
    example: true,
  })
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
