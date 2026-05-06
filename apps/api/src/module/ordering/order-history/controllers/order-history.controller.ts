import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { hasRole } from '@/module/auth/role.util';
import { OrderHistoryService } from '../services/order-history.service';
import {
  AdminOrderFiltersDto,
  OrderHistoryFiltersDto,
} from '../dto/order-history.dto';

/**
 * OrderHistoryController
 *
 * Exposes the Phase 7 read-only query layer over four path groups:
 *  - /orders/my        (customer: own order list + detail + reorder)
 *  - /restaurant       (restaurant owner: order list + kitchen view)
 *  - /shipper          (shipper: available pool, active delivery, history)
 *  - /admin            (admin: full platform view)
 *
 * IMPORTANT: This module MUST be registered BEFORE OrderLifecycleModule in
 * OrderingModule.imports so that the `/orders/my` and `/orders/my/:id` routes
 * take precedence over the `/orders/:id` catch-all in OrderLifecycleController.
 *
 * Access control is enforced at the handler level using `hasRole()` — any
 * authenticated user who does not hold the required role receives 403.
 *
 * Phase: 7
 */

// ---------------------------------------------------------------------------
// Customer routes — /orders/my/**
// ---------------------------------------------------------------------------

@ApiTags('Ordering - Order History (Customer)')
@ApiBearerAuth()
@Controller('orders')
export class OrderHistoryCustomerController {
  constructor(private readonly orderHistoryService: OrderHistoryService) {}

  /**
   * GET /orders/my — paginated list of the caller's own orders.
   */
  @Get('my')
  @ApiOperation({ summary: "Get current customer's order list (paginated)" })
  @ApiOkResponse({ description: 'Paginated order list' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  async getMyOrders(
    @Session() session: UserSession,
    @Query() filters: OrderHistoryFiltersDto,
  ) {
    return this.orderHistoryService.getCustomerOrders(session.user.id, filters);
  }

  /**
   * GET /orders/my/:id — full detail for one of the caller's orders.
   * Returns 404 (not 403) when the order belongs to another customer to avoid
   * leaking order existence.
   */
  @Get('my/:id')
  @ApiOperation({
    summary: "Get a specific order from the customer's own history",
  })
  @ApiOkResponse({ description: 'Full order detail' })
  @ApiNotFoundResponse({
    description: 'Order not found or does not belong to caller',
  })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async getMyOrderDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ) {
    return this.orderHistoryService.getCustomerOrderDetail(session.user.id, id);
  }

  /**
   * GET /orders/my/:id/reorder — items from a past order for cart pre-fill.
   * Pure read; no side effects.
   */
  @Get('my/:id/reorder')
  @ApiOperation({
    summary: 'Get reorder items from a past order (no side effects)',
  })
  @ApiOkResponse({
    description: 'List of items + modifier IDs for cart pre-fill',
  })
  @ApiNotFoundResponse({
    description: 'Order not found or does not belong to caller',
  })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async getReorderItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ) {
    return this.orderHistoryService.getCustomerReorderItems(
      session.user.id,
      id,
    );
  }
}

// ---------------------------------------------------------------------------
// Restaurant-owner routes — /restaurant/**
// ---------------------------------------------------------------------------

@ApiTags('Ordering - Order History (Restaurant)')
@ApiBearerAuth()
@Controller('restaurant')
export class OrderHistoryRestaurantController {
  constructor(private readonly orderHistoryService: OrderHistoryService) {}

  /**
   * GET /restaurant/orders — paginated list of orders placed at this restaurant.
   * Requires the `restaurant` role; the restaurant is resolved from the snapshot
   * by owner ID (no body parameter required).
   */
  @Get('orders')
  @ApiOperation({ summary: "Get restaurant's order list (paginated)" })
  @ApiOkResponse({ description: 'Paginated order list for the restaurant' })
  @ApiForbiddenResponse({
    description: 'Not a restaurant owner or no restaurant found',
  })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  async getRestaurantOrders(
    @Session() session: UserSession,
    @Query() filters: OrderHistoryFiltersDto,
  ) {
    if (!hasRole(session.user.role, 'restaurant', 'admin')) {
      throw new ForbiddenException(
        'Only restaurant owners and admins can access this endpoint.',
      );
    }
    return this.orderHistoryService.getRestaurantOrders(
      session.user.id,
      filters,
    );
  }

  /**
   * GET /restaurant/orders/active — kitchen operational view.
   * Returns all confirmed/preparing/ready_for_pickup orders, oldest-first.
   * No pagination — this is a live operational screen.
   */
  @Get('orders/active')
  @ApiOperation({
    summary: "Kitchen view: active orders for the caller's restaurant",
  })
  @ApiOkResponse({ description: 'Active orders ordered oldest-first' })
  @ApiForbiddenResponse({
    description: 'Not a restaurant owner or no restaurant found',
  })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  async getRestaurantActiveOrders(@Session() session: UserSession) {
    if (!hasRole(session.user.role, 'restaurant', 'admin')) {
      throw new ForbiddenException(
        'Only restaurant owners and admins can access this endpoint.',
      );
    }
    return this.orderHistoryService.getRestaurantActiveOrders(session.user.id);
  }
}

// ---------------------------------------------------------------------------
// Shipper routes — /shipper/**
// ---------------------------------------------------------------------------

@ApiTags('Ordering - Order History (Shipper)')
@ApiBearerAuth()
@Controller('shipper')
export class OrderHistoryShipperController {
  constructor(private readonly orderHistoryService: OrderHistoryService) {}

  /**
   * GET /shipper/orders/available — all orders in ready_for_pickup state.
   * Hard-capped at 50 rows in the repository. No caller-specific filter.
   */
  @Get('orders/available')
  @ApiOperation({
    summary: 'List orders available for pickup (hard-capped at 50)',
  })
  @ApiOkResponse({
    description: 'Available orders — any authenticated shipper can view these',
  })
  @ApiForbiddenResponse({ description: 'Not a shipper' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  async getAvailableOrders(@Session() session: UserSession) {
    if (!hasRole(session.user.role, 'shipper', 'admin')) {
      throw new ForbiddenException(
        'Only shippers and admins can access this endpoint.',
      );
    }
    return this.orderHistoryService.getAvailableOrders();
  }

  /**
   * GET /shipper/orders/active — the caller's current in-progress delivery.
   * Returns null (HTTP 200 with null body) when the shipper has no active delivery.
   */
  @Get('orders/active')
  @ApiOperation({
    summary: "Get the caller's current active delivery (if any)",
  })
  @ApiOkResponse({ description: 'The active delivery order or null' })
  @ApiForbiddenResponse({ description: 'Not a shipper' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  async getShipperActiveOrder(@Session() session: UserSession) {
    if (!hasRole(session.user.role, 'shipper', 'admin')) {
      throw new ForbiddenException(
        'Only shippers and admins can access this endpoint.',
      );
    }
    return this.orderHistoryService.getShipperActiveOrder(session.user.id);
  }

  /**
   * GET /shipper/orders/history — paginated list of the caller's delivered orders.
   */
  @Get('orders/history')
  @ApiOperation({ summary: "Get the shipper's delivery history (paginated)" })
  @ApiOkResponse({ description: 'Paginated list of delivered orders' })
  @ApiForbiddenResponse({ description: 'Not a shipper' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  async getShipperHistory(
    @Session() session: UserSession,
    @Query() filters: OrderHistoryFiltersDto,
  ) {
    if (!hasRole(session.user.role, 'shipper', 'admin')) {
      throw new ForbiddenException(
        'Only shippers and admins can access this endpoint.',
      );
    }
    return this.orderHistoryService.getShipperHistory(session.user.id, filters);
  }
}

// ---------------------------------------------------------------------------
// Admin routes — /admin/**
// ---------------------------------------------------------------------------

@ApiTags('Ordering - Order History (Admin)')
@ApiBearerAuth()
@Controller('admin')
export class OrderHistoryAdminController {
  constructor(private readonly orderHistoryService: OrderHistoryService) {}

  /**
   * GET /admin/orders — full platform order list with composable filters.
   */
  @Get('orders')
  @ApiOperation({
    summary: 'Admin: full platform order list with composable filters',
  })
  @ApiOkResponse({ description: 'Paginated order list (all orders)' })
  @ApiForbiddenResponse({ description: 'Not an admin' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  async getAllOrders(
    @Session() session: UserSession,
    @Query() filters: AdminOrderFiltersDto,
  ) {
    if (!hasRole(session.user.role, 'admin')) {
      throw new ForbiddenException('Admin access required.');
    }
    return this.orderHistoryService.getAllOrders(filters);
  }

  /**
   * GET /admin/orders/:id — full detail for any order on the platform.
   * No ownership check; admin sees everything.
   */
  @Get('orders/:id')
  @ApiOperation({ summary: 'Admin: get full detail for any order' })
  @ApiOkResponse({ description: 'Full order detail' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({ description: 'Not an admin' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async getAnyOrderDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ) {
    if (!hasRole(session.user.role, 'admin')) {
      throw new ForbiddenException('Admin access required.');
    }
    return this.orderHistoryService.getAnyOrderDetail(id);
  }
}
