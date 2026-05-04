import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { hasRole } from '@/module/auth/role.util';
import { TransitionOrderCommand } from '../commands/transition-order.command';
import { OrderRepository } from '../repositories/order.repository';
import { CancelOrderDto, RefundOrderDto } from '../dto/cancel-order.dto';
import type { TriggeredByRole } from '../../order/order.schema';

/**
 * OrderLifecycleController
 *
 * Exposes the HTTP surface for the Phase 5 order state machine.
 *
 * All mutation endpoints dispatch a TransitionOrderCommand with the actor's
 * identity and role. Ownership and permission enforcement happens inside
 * TransitionOrderHandler and OrderLifecycleService — not in this controller.
 *
 * Routes:
 *  PATCH  /orders/:id/confirm         → T-01 (pending → confirmed, COD)
 *  PATCH  /orders/:id/start-preparing → T-06 (confirmed → preparing)
 *  PATCH  /orders/:id/ready           → T-08 (preparing → ready_for_pickup)
 *  PATCH  /orders/:id/pickup          → T-09 (ready_for_pickup → picked_up)
 *  PATCH  /orders/:id/en-route        → T-10 (picked_up → delivering)
 *  PATCH  /orders/:id/deliver         → T-11 (delivering → delivered)
 *  PATCH  /orders/:id/cancel          → T-03 / T-05 / T-07 (body: { reason })
 *  POST   /orders/:id/refund          → T-12 (delivered → refunded, admin only)
 *  GET    /orders/:id                 → get current order state + items
 *  GET    /orders/:id/timeline        → get OrderStatusLog history
 *
 * Phase: 5
 */
@ApiTags('Ordering - Order Lifecycle')
@ApiBearerAuth()
@Controller('orders')
export class OrderLifecycleController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly orderRepo: OrderRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // T-01: pending → confirmed (COD — restaurant accepts)
  // ---------------------------------------------------------------------------

  @Patch(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm order (T-01 — COD: restaurant accepts)' })
  @ApiOkResponse({ description: 'Order confirmed' })
  @ApiForbiddenResponse({ description: 'Role or ownership check failed' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiUnprocessableEntityResponse({
    description: 'Invalid transition or VNPay order',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ) {
    const actorRole = this.resolveRole(session.user.role);
    return this.commandBus.execute(
      new TransitionOrderCommand(id, 'confirmed', session.user.id, actorRole),
    );
  }

  // ---------------------------------------------------------------------------
  // T-06: confirmed → preparing (restaurant starts cooking)
  // ---------------------------------------------------------------------------

  @Patch(':id/start-preparing')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start preparing order (T-06)' })
  @ApiOkResponse({ description: 'Order is now being prepared' })
  @ApiForbiddenResponse({ description: 'Role or ownership check failed' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid transition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async startPreparing(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ) {
    const actorRole = this.resolveRole(session.user.role);
    return this.commandBus.execute(
      new TransitionOrderCommand(id, 'preparing', session.user.id, actorRole),
    );
  }

  // ---------------------------------------------------------------------------
  // T-08: preparing → ready_for_pickup (food ready for shipper)
  // ---------------------------------------------------------------------------

  @Patch(':id/ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark order ready for pickup (T-08)' })
  @ApiOkResponse({ description: 'Order is ready for pickup' })
  @ApiForbiddenResponse({ description: 'Role or ownership check failed' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid transition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async markReady(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ) {
    const actorRole = this.resolveRole(session.user.role);
    return this.commandBus.execute(
      new TransitionOrderCommand(
        id,
        'ready_for_pickup',
        session.user.id,
        actorRole,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // T-09: ready_for_pickup → picked_up (shipper self-assigns)
  // ---------------------------------------------------------------------------

  @Patch(':id/pickup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Shipper picks up order (T-09, self-assign)' })
  @ApiOkResponse({ description: 'Order picked up by shipper' })
  @ApiForbiddenResponse({ description: 'Role check failed' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiConflictResponse({
    description: 'Another shipper claimed the order first',
  })
  @ApiUnprocessableEntityResponse({ description: 'Invalid transition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async pickup(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ) {
    const actorRole = this.resolveRole(session.user.role);
    return this.commandBus.execute(
      new TransitionOrderCommand(id, 'picked_up', session.user.id, actorRole),
    );
  }

  // ---------------------------------------------------------------------------
  // T-10: picked_up → delivering (shipper en route)
  // ---------------------------------------------------------------------------

  @Patch(':id/en-route')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Shipper starts en route (T-10)' })
  @ApiOkResponse({ description: 'Order is being delivered' })
  @ApiForbiddenResponse({ description: 'Role or ownership check failed' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid transition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async enRoute(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ) {
    const actorRole = this.resolveRole(session.user.role);
    return this.commandBus.execute(
      new TransitionOrderCommand(id, 'delivering', session.user.id, actorRole),
    );
  }

  // ---------------------------------------------------------------------------
  // T-11: delivering → delivered (handoff confirmed)
  // ---------------------------------------------------------------------------

  @Patch(':id/deliver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm order delivered (T-11)' })
  @ApiOkResponse({ description: 'Order delivered successfully' })
  @ApiForbiddenResponse({ description: 'Role or ownership check failed' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid transition' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ) {
    const actorRole = this.resolveRole(session.user.role);
    return this.commandBus.execute(
      new TransitionOrderCommand(id, 'delivered', session.user.id, actorRole),
    );
  }

  // ---------------------------------------------------------------------------
  // T-03 / T-05 / T-07: cancel order (any cancellable state)
  // ---------------------------------------------------------------------------

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel order (T-03 / T-05 / T-07)',
    description:
      'Cancels the order from its current state. Requires a reason. ' +
      'VNPay paid orders trigger a refund event automatically.',
  })
  @ApiOkResponse({ description: 'Order cancelled' })
  @ApiBadRequestResponse({ description: 'Missing reason note' })
  @ApiForbiddenResponse({ description: 'Role or ownership check failed' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiUnprocessableEntityResponse({
    description: 'Order cannot be cancelled from current state',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
    @Body() dto: CancelOrderDto,
  ) {
    const actorRole = this.resolveRole(session.user.role);
    return this.commandBus.execute(
      new TransitionOrderCommand(
        id,
        'cancelled',
        session.user.id,
        actorRole,
        dto.reason,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // T-12: delivered → refunded (admin only)
  // ---------------------------------------------------------------------------

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Process refund for delivered order (T-12, admin only)',
    description: 'Admin-only dispute resolution. Requires a reason note.',
  })
  @ApiOkResponse({ description: 'Order refunded' })
  @ApiBadRequestResponse({ description: 'Missing reason note' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiUnprocessableEntityResponse({
    description: 'Order is not in delivered state',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  async refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
    @Body() dto: RefundOrderDto,
  ) {
    if (!hasRole(session.user.role, 'admin')) {
      throw new ForbiddenException('Only admins can process refunds.');
    }
    return this.commandBus.execute(
      new TransitionOrderCommand(
        id,
        'refunded',
        session.user.id,
        'admin',
        dto.reason,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // GET /orders/:id — current order state + items
  // ---------------------------------------------------------------------------

  @Get(':id')
  @ApiOperation({ summary: 'Get order details (state + items)' })
  @ApiOkResponse({ description: 'Order details' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async getOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() _session: UserSession,
  ) {
    const result = await this.orderRepo.findWithItems(id);
    if (!result) {
      throw new NotFoundException(`Order ${id} not found.`);
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // GET /orders/:id/timeline — audit trail
  // ---------------------------------------------------------------------------

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Get order status timeline (audit log)' })
  @ApiOkResponse({ description: 'Ordered list of status log entries' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiUnauthorizedResponse({ description: 'Not authenticated' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async getTimeline(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() _session: UserSession,
  ) {
    return this.orderRepo.findTimeline(id);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Map the session user's role to a TriggeredByRole.
   *
   * Priority: admin > restaurant > shipper > customer
   * This means a user with multiple roles gets the most-privileged one.
   */
  private resolveRole(
    userRole: string | string[] | undefined | null,
  ): TriggeredByRole {
    if (hasRole(userRole, 'admin')) return 'admin';
    if (hasRole(userRole, 'restaurant')) return 'restaurant';
    if (hasRole(userRole, 'shipper')) return 'shipper';
    return 'customer';
  }
}
