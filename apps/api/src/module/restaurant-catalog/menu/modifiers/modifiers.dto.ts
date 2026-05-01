import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

// ---------------------------------------------------------------------------
// Modifier Group DTOs
// ---------------------------------------------------------------------------

export class CreateModifierGroupDto {
  @ApiProperty({ description: 'Group label shown to customer', example: 'Size' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({
    description: 'Minimum number of options customer must select (0 = optional)',
    example: 1,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  minSelections?: number;

  @ApiPropertyOptional({
    description: 'Maximum number of options customer can select (0 = no upper limit)',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxSelections?: number;

  @ApiPropertyOptional({ description: 'UI sort order', example: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateModifierGroupDto extends PartialType(CreateModifierGroupDto) {}

export class ModifierGroupResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  menuItemId!: string;

  @ApiProperty({ example: 'Size' })
  name!: string;

  @ApiProperty({ example: 1 })
  minSelections!: number;

  @ApiProperty({ example: 1 })
  maxSelections!: number;

  @ApiProperty({ example: 0 })
  displayOrder!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: () => [ModifierOptionResponseDto] })
  options!: ModifierOptionResponseDto[];
}

// ---------------------------------------------------------------------------
// Modifier Option DTOs
// ---------------------------------------------------------------------------

export class CreateModifierOptionDto {
  @ApiProperty({ description: 'Option label shown to customer', example: 'Large' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({
    description: 'Additional price for this option',
    example: 5.0,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({
    description: 'Pre-select this option in the UI',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'UI sort order', example: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({
    description: 'Whether this option is currently orderable',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

export class UpdateModifierOptionDto extends PartialType(CreateModifierOptionDto) {}

export class ModifierOptionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  groupId!: string;

  @ApiProperty({ example: 'Large' })
  name!: string;

  @ApiProperty({ example: 5.0 })
  price!: number;

  @ApiProperty({ example: false })
  isDefault!: boolean;

  @ApiProperty({ example: 0 })
  displayOrder!: number;

  @ApiProperty({ example: true })
  isAvailable!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
