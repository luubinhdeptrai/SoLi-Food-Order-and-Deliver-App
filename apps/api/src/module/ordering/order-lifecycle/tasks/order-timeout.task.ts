import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommandBus } from '@nestjs/cqrs';
import { OrderRepository } from '../repositories/order.repository';
import { TransitionOrderCommand } from '../commands/transition-order.command';

/**
 * OrderTimeoutTask
 *
 * Runs every minute and auto-cancels orders that have exceeded their
 * `expires_at` deadline without being confirmed by the restaurant.
 *
 * Timeout scenarios handled:
 *  - `pending` (COD or pre-payment VNPay): T-03 fires — no refund event.
 *  - `paid` (VNPay paid but restaurant did not confirm): T-05 fires — refund
 *    event is published by TransitionOrderHandler automatically.
 *
 * Multi-pod safety:
 *  If two instances run simultaneously, the second will find the order
 *  already `cancelled` and the TransitionOrderHandler idempotency guard
 *  (status === toStatus → no-op) will silently return. The optimistic
 *  locking version check provides an additional safety net.
 *
 * Acceptable delay: up to 60 seconds between expiry and actual cancellation.
 *
 * Phase: 5
 */
@Injectable()
export class OrderTimeoutTask {
  private readonly logger = new Logger(OrderTimeoutTask.name);

  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly commandBus: CommandBus,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredOrders(): Promise<void> {
    let expired: Awaited<ReturnType<typeof this.orderRepo.findExpiredPendingOrPaid>>;

    try {
      expired = await this.orderRepo.findExpiredPendingOrPaid();
    } catch (err) {
      this.logger.error(
        `OrderTimeoutTask failed to query expired orders: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return;
    }

    if (expired.length === 0) return;

    this.logger.log(
      `OrderTimeoutTask: found ${expired.length} expired order(s) to cancel.`,
    );

    for (const order of expired) {
      try {
        await this.commandBus.execute(
          new TransitionOrderCommand(
            order.id,
            'cancelled',
            null,       // system actor — no user ID
            'system',
            'Order expired — no restaurant confirmation within timeout',
          ),
        );
        this.logger.log(`Auto-cancelled expired order ${order.id} (was ${order.status}).`);
      } catch (err) {
        // Log per-order failures without aborting the rest of the batch.
        this.logger.error(
          `Failed to auto-cancel expired order ${order.id}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }
  }
}
