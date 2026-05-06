import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler, CommandBus } from '@nestjs/cqrs';
import { PaymentFailedEvent } from '@/shared/events/payment-failed.event';
import { TransitionOrderCommand } from '../commands/transition-order.command';

/**
 * PaymentFailedEventHandler
 *
 * Consumed by: Ordering BC
 * Source:      Payment Context (published when VNPay payment fails or times out)
 *
 * Action: Dispatches TransitionOrderCommand(orderId, 'cancelled', null, 'system')
 *         to cancel a PENDING VNPay order (T-03: pending → cancelled).
 *
 * Note: Cart recovery is a UI concern — the cart was already deleted at checkout
 *       (Phase 4, Step 13). This handler does NOT attempt any cart recovery.
 *
 * Phase: 5 — T-03 (pending → cancelled, system actor)
 */
@Injectable()
@EventsHandler(PaymentFailedEvent)
export class PaymentFailedEventHandler implements IEventHandler<PaymentFailedEvent> {
  private readonly logger = new Logger(PaymentFailedEventHandler.name);

  constructor(private readonly commandBus: CommandBus) {}

  async handle(event: PaymentFailedEvent): Promise<void> {
    const { orderId, reason } = event;

    this.logger.log(
      `PaymentFailedEvent received for order ${orderId} — dispatching T-03 (pending→cancelled). Reason: ${reason}`,
    );

    try {
      await this.commandBus.execute(
        new TransitionOrderCommand(
          orderId,
          'cancelled',
          null, // system actor — no user ID
          'system',
          reason,
        ),
      );
    } catch (err) {
      // If the order was already cancelled (e.g., timeout cron fired first) or
      // does not exist, log and discard — never re-throw from an event handler.
      this.logger.error(
        `T-03 transition failed for order ${orderId} (PaymentFailedEvent): ` +
          `${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
