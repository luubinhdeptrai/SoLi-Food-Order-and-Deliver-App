import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { OrderStatus, TriggeredByRole } from '../../order/order.schema';
import { orderStatusEnum } from '../../order/order.schema';

// ---------------------------------------------------------------------------
// Nested modifier DTO (for both detail and reorder responses)
// ---------------------------------------------------------------------------

export class OrderModifierResponseDto {
  @ApiProperty({ description: 'Modifier group ID', format: 'uuid' })
  groupId!: string;

  @ApiProperty({ description: 'Modifier group name (frozen snapshot)' })
  groupName!: string;

  @ApiProperty({ description: 'Modifier option ID', format: 'uuid' })
  optionId!: string;

  @ApiProperty({ description: 'Modifier option name (frozen snapshot)' })
  optionName!: string;

  @ApiProperty({ description: 'Modifier option price (frozen snapshot)' })
  price!: number;
}

// ---------------------------------------------------------------------------
// Order list item DTO — used in all paginated list responses
// ---------------------------------------------------------------------------

export class OrderListItemDto {
  @ApiProperty({ description: 'Order ID', format: 'uuid' })
  orderId!: string;

  @ApiProperty({
    description: 'Current order status',
    enum: orderStatusEnum.enumValues,
  })
  status!: OrderStatus;

  @ApiProperty({ description: 'Restaurant ID', format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ description: 'Restaurant name (frozen snapshot)' })
  restaurantName!: string;

  @ApiProperty({ description: 'Payment method', enum: ['cod', 'vnpay'] })
  paymentMethod!: 'cod' | 'vnpay';

  @ApiProperty({
    description: 'Total order amount (item subtotals + shipping fee)',
  })
  totalAmount!: number;

  @ApiProperty({ description: 'Shipping fee' })
  shippingFee!: number;

  @ApiProperty({ description: 'Number of line items in the order' })
  itemCount!: number;

  @ApiProperty({ description: 'Name of the first line item (for preview)' })
  firstItemName!: string;

  @ApiProperty({ description: 'ISO8601 creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO8601 last-updated timestamp' })
  updatedAt!: string;

  @ApiPropertyOptional({
    description: 'Estimated delivery time in minutes (may be a decimal)',
  })
  estimatedDeliveryMinutes!: number | null;
}

// ---------------------------------------------------------------------------
// Paginated list wrapper — used for all paginated endpoints
// ---------------------------------------------------------------------------

export class OrderListResponseDto {
  @ApiProperty({ type: [OrderListItemDto] })
  data!: OrderListItemDto[];

  @ApiProperty({
    description: 'Total number of matching rows (for pagination UI)',
  })
  total!: number;

  @ApiProperty({ description: 'Page size applied to this response' })
  limit!: number;

  @ApiProperty({ description: 'Offset applied to this response' })
  offset!: number;
}

// ---------------------------------------------------------------------------
// Order item DTO — used in order detail
// ---------------------------------------------------------------------------

export class OrderItemResponseDto {
  @ApiProperty({ description: 'Order item row ID', format: 'uuid' })
  orderItemId!: string;

  @ApiProperty({
    description: 'Menu item ID (cross-context reference)',
    format: 'uuid',
  })
  menuItemId!: string;

  @ApiProperty({ description: 'Item name (frozen snapshot)' })
  itemName!: string;

  @ApiProperty({
    description: 'Base unit price (frozen snapshot, excludes modifiers)',
  })
  unitPrice!: number;

  @ApiProperty({ description: 'Sum of all selected modifier prices' })
  modifiersPrice!: number;

  @ApiProperty({ description: 'Quantity ordered' })
  quantity!: number;

  @ApiProperty({
    description: 'Subtotal = (unitPrice + modifiersPrice) × quantity',
  })
  subtotal!: number;

  @ApiProperty({
    type: [OrderModifierResponseDto],
    description: 'Modifier selections (frozen snapshot)',
  })
  modifiers!: OrderModifierResponseDto[];
}

// ---------------------------------------------------------------------------
// Status log entry DTO — used in order timeline
// ---------------------------------------------------------------------------

export class OrderStatusLogEntryDto {
  @ApiPropertyOptional({
    description: 'Previous status (null for the initial creation entry)',
    enum: orderStatusEnum.enumValues,
  })
  fromStatus!: OrderStatus | null;

  @ApiProperty({
    description: 'Status after this transition',
    enum: orderStatusEnum.enumValues,
  })
  toStatus!: OrderStatus;

  @ApiPropertyOptional({
    description:
      'UUID of the actor who triggered the transition (null for system-triggered transitions)',
  })
  triggeredBy!: string | null;

  @ApiProperty({
    description: 'Role of the actor',
    enum: ['customer', 'restaurant', 'shipper', 'admin', 'system'],
  })
  triggeredByRole!: TriggeredByRole;

  @ApiPropertyOptional({
    description:
      'Note / reason attached to this transition (required for cancel/refund)',
  })
  note!: string | null;

  @ApiProperty({ description: 'ISO8601 timestamp of the transition' })
  createdAt!: string;
}

// ---------------------------------------------------------------------------
// Full order detail DTO — used by GET /orders/my/:id and GET /admin/orders/:id
// ---------------------------------------------------------------------------

export class DeliveryAddressResponseDto {
  @ApiProperty()
  street!: string;

  @ApiProperty()
  district!: string;

  @ApiProperty()
  city!: string;

  @ApiPropertyOptional()
  latitude?: number;

  @ApiPropertyOptional()
  longitude?: number;
}

export class OrderDetailDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ enum: orderStatusEnum.enumValues })
  status!: OrderStatus;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ description: 'Restaurant name (frozen snapshot)' })
  restaurantName!: string;

  @ApiProperty({ enum: ['cod', 'vnpay'] })
  paymentMethod!: 'cod' | 'vnpay';

  @ApiProperty({ description: 'Total order amount' })
  totalAmount!: number;

  @ApiProperty({ description: 'Shipping fee' })
  shippingFee!: number;

  @ApiPropertyOptional({
    description:
      'Estimated delivery minutes (null when coordinates/zone unavailable)',
  })
  estimatedDeliveryMinutes!: number | null;

  @ApiPropertyOptional({ description: 'Order note from the customer' })
  note!: string | null;

  // VNPay orders: the redirect URL returned by the payment gateway.
  // Customers may use this to re-open the payment page for pending orders.
  // null for COD orders and after the VNPay URL has expired.
  @ApiPropertyOptional({
    description: 'VNPay payment URL (null for COD orders)',
  })
  paymentUrl!: string | null;

  @ApiProperty({ type: DeliveryAddressResponseDto })
  deliveryAddress!: DeliveryAddressResponseDto;

  @ApiPropertyOptional({
    description: 'UUID of the assigned shipper (null until T-09)',
    format: 'uuid',
  })
  shipperId!: string | null;

  @ApiProperty({ description: 'ISO8601 creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO8601 last-updated timestamp' })
  updatedAt!: string;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items!: OrderItemResponseDto[];

  @ApiProperty({ type: [OrderStatusLogEntryDto] })
  timeline!: OrderStatusLogEntryDto[];
}

// ---------------------------------------------------------------------------
// Reorder DTO — returned by GET /orders/my/:id/reorder
// Client uses this to pre-fill a new cart without server-side side effects.
// ---------------------------------------------------------------------------

export class ReorderModifierDto {
  @ApiProperty({ format: 'uuid' })
  groupId!: string;

  @ApiProperty({ format: 'uuid' })
  optionId!: string;
}

export class ReorderItemDto {
  @ApiProperty({
    description: 'Menu item ID (cross-context reference)',
    format: 'uuid',
  })
  menuItemId!: string;

  @ApiProperty({ description: 'Item name at the time of the original order' })
  itemName!: string;

  @ApiProperty({ description: 'Quantity from the original order' })
  quantity!: number;

  @ApiProperty({
    type: [ReorderModifierDto],
    description: 'Modifier IDs to re-select (no price — client re-validates)',
  })
  selectedModifiers!: ReorderModifierDto[];
}

// ---------------------------------------------------------------------------
// Filter DTOs — query params for list endpoints
// ---------------------------------------------------------------------------

/**
 * Base filter DTO shared by customer, restaurant, and shipper list endpoints.
 */
export class OrderHistoryFiltersDto {
  @ApiPropertyOptional({ enum: orderStatusEnum.enumValues })
  @IsOptional()
  @IsEnum(orderStatusEnum.enumValues)
  status?: OrderStatus;

  @ApiPropertyOptional({
    description: 'ISO8601 date — include orders created at or after this date',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'ISO8601 date — include orders created at or before this date',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset?: number = 0;
}

/**
 * Extended filter DTO for the admin list endpoint — adds per-actor and
 * payment-method filters plus configurable sort order.
 */
export class AdminOrderFiltersDto extends OrderHistoryFiltersDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  restaurantId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  shipperId?: string;

  @ApiPropertyOptional({ enum: ['cod', 'vnpay'] })
  @IsOptional()
  @IsEnum(['cod', 'vnpay'])
  paymentMethod?: 'cod' | 'vnpay';

  @ApiPropertyOptional({
    enum: ['created_at', 'updated_at', 'total_amount'],
    default: 'created_at',
  })
  @IsOptional()
  @IsEnum(['created_at', 'updated_at', 'total_amount'])
  sortBy?: 'created_at' | 'updated_at' | 'total_amount' = 'created_at';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
