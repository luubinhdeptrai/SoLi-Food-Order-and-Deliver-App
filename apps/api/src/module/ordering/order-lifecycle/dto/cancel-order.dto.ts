import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * CancelOrderDto — request body for PATCH /orders/:id/cancel.
 *
 * A non-empty reason is required for all cancellation transitions
 * (T-03, T-05, T-07) and for the refund transition (T-12).
 */
export class CancelOrderDto {
  @ApiProperty({
    description: 'Reason for cancellation (required for all cancel transitions)',
    example: 'Restaurant out of stock',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty({ message: 'A cancellation reason is required.' })
  @MaxLength(500)
  reason!: string;
}

/**
 * RefundOrderDto — request body for POST /orders/:id/refund.
 *
 * Admin-only. A note explaining the refund reason is required (T-12).
 */
export class RefundOrderDto {
  @ApiProperty({
    description: 'Reason for the refund (admin-only, required)',
    example: 'Customer dispute — food not delivered',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty({ message: 'A refund reason is required.' })
  @MaxLength(500)
  reason!: string;
}
