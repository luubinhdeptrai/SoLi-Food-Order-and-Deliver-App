import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsBoolean, MinLength, Min } from 'class-validator';

export class CreateMenuItemModifierDto {
  @ApiProperty({
    description: 'Modifier name',
    minLength: 1,
    example: 'Large',
  })
  @IsString()
  @MinLength(1, { message: 'Name must be at least 1 character' })
  name!: string;

  @ApiPropertyOptional({
    description: 'Modifier description',
    example: 'Increase size to large',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Price adjustment for this modifier',
    minimum: 0,
    example: 2.5,
  })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({
    description: 'Whether this modifier is required',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}

export class UpdateMenuItemModifierDto extends PartialType(
  CreateMenuItemModifierDto,
) {}

export class MenuItemModifierResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '33333333-3333-3333-3333-333333333333',
  })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    example: '22222222-2222-2222-2222-222222222222',
  })
  menuItemId!: string;

  @ApiProperty({
    example: 'Large',
  })
  name!: string;

  @ApiPropertyOptional({
    example: 'Increase size to large',
  })
  description?: string | null;

  @ApiProperty({
    example: 2.5,
  })
  price!: number;

  @ApiProperty({
    example: false,
  })
  isRequired!: boolean;

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
