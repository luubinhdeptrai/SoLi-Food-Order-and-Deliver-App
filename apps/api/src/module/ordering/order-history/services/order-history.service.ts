import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RestaurantSnapshotRepository } from '../../acl/repositories/restaurant-snapshot.repository';
import { OrderHistoryRepository } from '../repositories/order-history.repository';
import type {
  AdminOrderFiltersDto,
  OrderDetailDto,
  OrderHistoryFiltersDto,
  OrderItemResponseDto,
  OrderListItemDto,
  OrderListResponseDto,
  OrderModifierResponseDto,
  OrderStatusLogEntryDto,
  ReorderItemDto,
  ReorderModifierDto,
} from '../dto/order-history.dto';
import type {
  Order,
  OrderItem,
  OrderStatusLog,
} from '../../order/order.schema';
import type { OrderListRow } from '../repositories/order-history.repository';

// ---------------------------------------------------------------------------
// Private mapping helpers — kept pure (no I/O) so they are easily unit-tested
// ---------------------------------------------------------------------------

function mapListRow(row: OrderListRow): OrderListItemDto {
  return {
    orderId: row.id,
    status: row.status,
    restaurantId: row.restaurantId,
    restaurantName: row.restaurantName,
    paymentMethod: row.paymentMethod,
    totalAmount: Number(row.totalAmount),
    shippingFee: Number(row.shippingFee),
    itemCount: row.itemCount,
    firstItemName: row.firstItemName ?? '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    estimatedDeliveryMinutes: row.estimatedDeliveryMinutes ?? null,
  };
}

function mapModifier(m: {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  price: number;
}): OrderModifierResponseDto {
  return {
    groupId: m.groupId,
    groupName: m.groupName,
    optionId: m.optionId,
    optionName: m.optionName,
    price: Number(m.price),
  };
}

function mapItem(item: OrderItem): OrderItemResponseDto {
  return {
    orderItemId: item.id,
    menuItemId: item.menuItemId,
    itemName: item.itemName,
    unitPrice: Number(item.unitPrice),
    modifiersPrice: Number(item.modifiersPrice),
    quantity: item.quantity,
    subtotal: Number(item.subtotal),
    modifiers: (item.modifiers as Parameters<typeof mapModifier>[0][]).map(
      mapModifier,
    ),
  };
}

function mapStatusLog(log: OrderStatusLog): OrderStatusLogEntryDto {
  return {
    fromStatus: log.fromStatus ?? null,
    toStatus: log.toStatus,
    triggeredBy: log.triggeredBy ?? null,
    triggeredByRole: log.triggeredByRole,
    note: log.note ?? null,
    createdAt: log.createdAt.toISOString(),
  };
}

function mapOrderToDetail(
  order: Order,
  items: OrderItem[],
  timeline: OrderStatusLog[],
): OrderDetailDto {
  return {
    orderId: order.id,
    status: order.status,
    restaurantId: order.restaurantId,
    restaurantName: order.restaurantName,
    paymentMethod: order.paymentMethod,
    totalAmount: Number(order.totalAmount),
    shippingFee: Number(order.shippingFee),
    estimatedDeliveryMinutes: order.estimatedDeliveryMinutes ?? null,
    note: order.note ?? null,
    paymentUrl: order.paymentUrl ?? null,
    deliveryAddress: order.deliveryAddress as OrderDetailDto['deliveryAddress'],
    shipperId: order.shipperId ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: items.map(mapItem),
    timeline: timeline.map(mapStatusLog),
  };
}

/**
 * OrderHistoryService
 *
 * Application service for the Phase 7 read layer.
 *
 * Responsibilities:
 *  - Orchestrate repository calls
 *  - Enforce per-actor ownership / access control BEFORE returning data
 *  - Map raw DB rows to strongly-typed response DTOs
 *
 * Security model:
 *  - Customer:    can only see their own orders (customerId === actorId).
 *  - Restaurant:  can only see orders for their restaurant (resolved via snapshot).
 *  - Shipper:     can see available pool (any), active delivery (their own), history (their own).
 *  - Admin:       unrestricted read access (no ownership check).
 *
 * Phase: 7
 */
@Injectable()
export class OrderHistoryService {
  constructor(
    private readonly orderHistoryRepo: OrderHistoryRepository,
    private readonly restaurantSnapshotRepo: RestaurantSnapshotRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Customer
  // ---------------------------------------------------------------------------

  async getCustomerOrders(
    actorId: string,
    filters: OrderHistoryFiltersDto,
  ): Promise<OrderListResponseDto> {
    const { data, total } = await this.orderHistoryRepo.findByCustomer(
      actorId,
      filters,
    );
    return {
      data: data.map(mapListRow),
      total,
      limit: filters.limit ?? 20,
      offset: filters.offset ?? 0,
    };
  }

  async getCustomerOrderDetail(
    actorId: string,
    orderId: string,
  ): Promise<OrderDetailDto> {
    const bundle = await this.orderHistoryRepo.findDetailById(orderId);
    if (!bundle) throw new NotFoundException(`Order ${orderId} not found.`);
    if (bundle.order.customerId !== actorId) {
      throw new NotFoundException(`Order ${orderId} not found.`);
    }
    return mapOrderToDetail(bundle.order, bundle.items, bundle.timeline);
  }

  /**
   * Returns the items of a past order in a shape the mobile/web client can use
   * to pre-fill a new cart. This is a pure read — no side effects.
   */
  async getCustomerReorderItems(
    actorId: string,
    orderId: string,
  ): Promise<ReorderItemDto[]> {
    const bundle = await this.orderHistoryRepo.findDetailById(orderId);
    if (!bundle) throw new NotFoundException(`Order ${orderId} not found.`);
    if (bundle.order.customerId !== actorId) {
      throw new NotFoundException(`Order ${orderId} not found.`);
    }
    return bundle.items.map(
      (item): ReorderItemDto => ({
        menuItemId: item.menuItemId,
        itemName: item.itemName,
        quantity: item.quantity,
        selectedModifiers: (
          item.modifiers as { groupId: string; optionId: string }[]
        ).map(
          (m): ReorderModifierDto => ({
            groupId: m.groupId,
            optionId: m.optionId,
          }),
        ),
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Restaurant owner
  // ---------------------------------------------------------------------------

  async getRestaurantOrders(
    ownerId: string,
    filters: OrderHistoryFiltersDto,
  ): Promise<OrderListResponseDto> {
    const snapshot = await this.restaurantSnapshotRepo.findByOwnerId(ownerId);
    if (!snapshot) {
      throw new ForbiddenException('No restaurant found for this account.');
    }
    const { data, total } = await this.orderHistoryRepo.findByRestaurantId(
      snapshot.restaurantId,
      filters,
    );
    return {
      data: data.map(mapListRow),
      total,
      limit: filters.limit ?? 20,
      offset: filters.offset ?? 0,
    };
  }

  /**
   * Kitchen operational view — returns confirmed/preparing/ready orders, oldest first.
   * No pagination; this is a live operational screen, not a historical query.
   */
  async getRestaurantActiveOrders(
    ownerId: string,
  ): Promise<OrderListItemDto[]> {
    const snapshot = await this.restaurantSnapshotRepo.findByOwnerId(ownerId);
    if (!snapshot) {
      throw new ForbiddenException('No restaurant found for this account.');
    }
    const rows = await this.orderHistoryRepo.findActiveByRestaurantId(
      snapshot.restaurantId,
    );
    return rows.map(mapListRow);
  }

  // ---------------------------------------------------------------------------
  // Shipper
  // ---------------------------------------------------------------------------

  /**
   * All orders in ready_for_pickup state (hard-capped at 50).
   * No ownership filter — any authenticated shipper can see and claim these.
   */
  async getAvailableOrders(): Promise<OrderListItemDto[]> {
    const rows = await this.orderHistoryRepo.findAvailableForPickup();
    return rows.map(mapListRow);
  }

  /**
   * Returns the shipper's current active delivery (if any).
   * Business rule: at most one active delivery per shipper at a time.
   */
  async getShipperActiveOrder(shipperId: string): Promise<OrderListItemDto[]> {
    const rows = await this.orderHistoryRepo.findActiveForShipper(shipperId);
    return rows.map(mapListRow);
  }

  async getShipperHistory(
    shipperId: string,
    filters: OrderHistoryFiltersDto,
  ): Promise<OrderListResponseDto> {
    const { data, total } = await this.orderHistoryRepo.findDeliveredByShipper(
      shipperId,
      filters,
    );
    return {
      data: data.map(mapListRow),
      total,
      limit: filters.limit ?? 20,
      offset: filters.offset ?? 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  async getAllOrders(
    filters: AdminOrderFiltersDto,
  ): Promise<OrderListResponseDto> {
    const { data, total } = await this.orderHistoryRepo.findAll(filters);
    return {
      data: data.map(mapListRow),
      total,
      limit: filters.limit ?? 20,
      offset: filters.offset ?? 0,
    };
  }

  /**
   * Admin-only: load the full detail for any order by ID.
   * No ownership check is applied.
   */
  async getAnyOrderDetail(orderId: string): Promise<OrderDetailDto> {
    const bundle = await this.orderHistoryRepo.findDetailById(orderId);
    if (!bundle) throw new NotFoundException(`Order ${orderId} not found.`);
    return mapOrderToDetail(bundle.order, bundle.items, bundle.timeline);
  }
}
