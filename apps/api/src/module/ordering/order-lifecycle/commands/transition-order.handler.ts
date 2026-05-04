import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  Inject,
} from '@nestjs/common';
import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';
import {
  orders,
  orderStatusLogs,
  type Order,
} from '../../order/order.schema';
import { TransitionOrderCommand } from './transition-order.command';
import { OrderRepository } from '../repositories/order.repository';
import { OrderLifecycleService } from '../services/order-lifecycle.service';
import { RestaurantSnapshotRepository } from '../../acl/repositories/restaurant-snapshot.repository';
import { TRANSITIONS } from '../constants/transitions';
import { OrderStatusChangedEvent } from '@/shared/events/order-status-changed.event';
import { OrderReadyForPickupEvent } from '@/shared/events/order-ready-for-pickup.event';
import { OrderCancelledAfterPaymentEvent } from '@/shared/events/order-cancelled-after-payment.event';

/**
 * TransitionOrderHandler
 *
 * Core of Phase 5: validates a requested state transition, enforces permissions
 * and ownership, persists the change atomically with an audit log entry, and
 * publishes domain events after the DB transaction commits.
 *
 * Architecture decisions:
 *  D1-C  Hybrid CQRS — single handler for all lifecycle transitions.
 *  D6-A  Hand-crafted TRANSITIONS map — no XState.
 *  Optimistic locking via `version` column guards concurrent race conditions
 *  (e.g., two shippers simultaneously claiming T-09).
 *  Events are published AFTER the DB commit so downstream consumers always
 *  see consistent data when they query the DB.
 *
 * Phase: 5
 */
@Injectable()
@CommandHandler(TransitionOrderCommand)
export class TransitionOrderHandler
  implements ICommandHandler<TransitionOrderCommand>
{
  private readonly logger = new Logger(TransitionOrderHandler.name);

  constructor(
    @Inject(DB_CONNECTION) private readonly db: NodePgDatabase<typeof schema>,
    private readonly orderRepo: OrderRepository,
    private readonly lifecycleService: OrderLifecycleService,
    private readonly restaurantSnapshotRepo: RestaurantSnapshotRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(cmd: TransitionOrderCommand): Promise<Order> {
    const { orderId, toStatus, actorId, actorRole, note } = cmd;

    // -------------------------------------------------------------------------
    // 1. Load order
    // -------------------------------------------------------------------------
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found.`);
    }

    // -------------------------------------------------------------------------
    // 2. Idempotency — already in target state (safe for system-triggered commands)
    // -------------------------------------------------------------------------
    if (order.status === toStatus) {
      return order;
    }

    // -------------------------------------------------------------------------
    // 3. Validate transition exists in the TRANSITIONS map
    // -------------------------------------------------------------------------
    const transitionKey =
      `${order.status}→${toStatus}` as `${typeof order.status}→${typeof toStatus}`;
    const rule = TRANSITIONS[transitionKey];
    if (!rule) {
      throw new UnprocessableEntityException(
        `Cannot transition order from '${order.status}' to '${toStatus}'.`,
      );
    }

    // -------------------------------------------------------------------------
    // 4. Check actor role is permitted for this transition
    // -------------------------------------------------------------------------
    if (!rule.allowedRoles.includes(actorRole)) {
      throw new ForbiddenException(
        `Role '${actorRole}' cannot perform the '${order.status}→${toStatus}' transition.`,
      );
    }

    // -------------------------------------------------------------------------
    // 5. Ownership check (delegated to OrderLifecycleService)
    // -------------------------------------------------------------------------
    await this.lifecycleService.assertOwnership(order, actorId, actorRole);

    // -------------------------------------------------------------------------
    // 5b. Shipper T-10/T-11 ownership: assigned shipper must match
    //     (T-09 is self-assign, so no check needed there)
    // -------------------------------------------------------------------------
    if (
      actorRole === 'shipper' &&
      (order.status === 'picked_up' || order.status === 'delivering')
    ) {
      if (order.shipperId !== actorId) {
        throw new ForbiddenException(
          'Only the assigned shipper can advance this order.',
        );
      }
    }

    // -------------------------------------------------------------------------
    // 6. T-01 precondition: COD-only for restaurant role
    //    (admin may confirm VNPay orders via T-01 if needed — admin bypasses)
    // -------------------------------------------------------------------------
    if (
      order.status === 'pending' &&
      toStatus === 'confirmed' &&
      actorRole === 'restaurant'
    ) {
      if (order.paymentMethod !== 'cod') {
        throw new UnprocessableEntityException(
          'VNPay orders cannot be confirmed directly by the restaurant. ' +
            'Wait for PaymentConfirmedEvent to advance the order to `paid` first.',
        );
      }
    }

    // -------------------------------------------------------------------------
    // 7. Note requirement (cancel / refund transitions)
    // -------------------------------------------------------------------------
    if (rule.requireNote && !note?.trim()) {
      throw new BadRequestException(
        'A reason note is required for this transition.',
      );
    }

    // -------------------------------------------------------------------------
    // 8. DB transaction — atomic status update + status log entry
    // -------------------------------------------------------------------------
    const updatedOrder = await this.db.transaction(async (tx) => {
      // Build the update payload
      const setClause: Partial<Order> = {
        status: toStatus,
        version: order.version + 1,
        updatedAt: new Date(),
      };

      // T-09: record the actor who picked up the order.
      // Works for both shipper (self-assign) and admin (operational override).
      // Shipper continuity for T-10/T-11 is enforced in step 5b via shipperId match.
      if (order.status === 'ready_for_pickup' && toStatus === 'picked_up') {
        setClause.shipperId = actorId!;
      }

      // Optimistic locking: update only if version hasn't changed since we read
      const result = await tx
        .update(orders)
        .set(setClause)
        .where(and(eq(orders.id, orderId), eq(orders.version, order.version)))
        .returning();

      if (result.length === 0) {
        throw new ConflictException(
          'Order was modified concurrently. Please refresh and retry.',
        );
      }

      // Append audit log entry (atomic with status update)
      await tx.insert(orderStatusLogs).values({
        orderId,
        fromStatus: order.status,
        toStatus,
        triggeredBy: actorId ?? null,
        triggeredByRole: actorRole,
        note: note ?? null,
      });

      return result[0];
    });

    // -------------------------------------------------------------------------
    // 9. Publish domain events AFTER the transaction commits
    //    If publishing fails after a successful commit: log at ERROR level.
    //    The DB state is correct; the downstream miss is observable.
    // -------------------------------------------------------------------------
    try {
      this.eventBus.publish(
        new OrderStatusChangedEvent(
          orderId,
          order.customerId,
          order.restaurantId,
          order.status,
          toStatus,
          actorRole,
          note,
        ),
      );

      if (rule.triggersReadyForPickup) {
        await this.publishReadyForPickupEvent(order);
      }

      if (rule.triggersRefundIfVnpay && order.paymentMethod === 'vnpay') {
        // 'shipper' is never in allowedRoles for any refund-triggering transition.
        // Guard defensively so type narrowing is explicit rather than a cast.
        if (actorRole === 'shipper') {
          this.logger.error(
            `Unexpected actor role 'shipper' on refund-triggering transition ` +
              `${order.status}→${toStatus} for order ${orderId}. Refund event suppressed.`,
          );
        } else {
          this.eventBus.publish(
            new OrderCancelledAfterPaymentEvent(
              orderId,
              order.customerId,
              'vnpay',
              order.totalAmount,
              new Date(),
              actorRole,
            ),
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Event publishing failed for order ${orderId} after successful ${order.status}→${toStatus} transition: ${(err as Error).message}`,
        (err as Error).stack,
      );
      // Do NOT rethrow — DB state is correct, event miss is observable.
    }

    return updatedOrder;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Publish OrderReadyForPickupEvent (T-08).
   * Loads the restaurant snapshot to populate address and name fields.
   * Logs a warning and skips the event if the snapshot is missing.
   */
  private async publishReadyForPickupEvent(order: Order): Promise<void> {
    const snapshot = await this.restaurantSnapshotRepo.findById(
      order.restaurantId,
    );

    if (!snapshot) {
      this.logger.warn(
        `OrderReadyForPickupEvent skipped for order ${order.id}: ` +
          `restaurant snapshot ${order.restaurantId} not found.`,
      );
      return;
    }

    this.eventBus.publish(
      new OrderReadyForPickupEvent(
        order.id,
        order.restaurantId,
        snapshot.name,
        snapshot.address,
        order.customerId,
        order.deliveryAddress as {
          street: string;
          district: string;
          city: string;
          latitude?: number;
          longitude?: number;
        },
      ),
    );
  }
}
