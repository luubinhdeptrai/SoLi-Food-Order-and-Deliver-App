import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler, CommandBus } from '@nestjs/cqrs';
import { PaymentConfirmedEvent } from '@/shared/events/payment-confirmed.event';
import { TransitionOrderCommand } from '../commands/transition-order.command';
import { OrderRepository } from '../repositories/order.repository';

/**
 * PaymentConfirmedEventHandler
 *
 * Consumed by: Ordering BC
 * Source:      Payment Context (published when VNPay payment succeeds)
 *
 * Action: Dispatches TransitionOrderCommand(orderId, 'paid', null, 'system')
 *         to advance a PENDING VNPay order to PAID (T-02).
 *
 * Guards:
 *  - Silently discards the event if the order has paymentMethod !== 'vnpay'
 *    (should never happen, but prevents silent order abandonment if it does).
 *  - Uses epsilon comparison for paidAmount vs totalAmount to avoid floating-
 *    point strict equality failures (tolerance: 0.01).
 *
 * Phase: 5 — T-02 (pending → paid)
 */
@Injectable()
@EventsHandler(PaymentConfirmedEvent)
export class PaymentConfirmedEventHandler
  implements IEventHandler<PaymentConfirmedEvent>
{
  private readonly logger = new Logger(PaymentConfirmedEventHandler.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly orderRepo: OrderRepository,
  ) {}

  async handle(event: PaymentConfirmedEvent): Promise<void> {
    const { orderId, paidAmount } = event;

    const order = await this.orderRepo.findById(orderId);

    if (!order) {
      this.logger.warn(
        `PaymentConfirmedEvent for unknown order ${orderId} — discarding.`,
      );
      return;
    }

    // Guard: only VNPay orders go through the payment gateway
    if (order.paymentMethod !== 'vnpay') {
      this.logger.warn(
        `PaymentConfirmedEvent for COD order ${orderId} — discarding.`,
      );
      return;
    }

    // Guard: epsilon comparison to avoid floating-point equality issues
    if (Math.abs(paidAmount - order.totalAmount) > 0.01) {
      this.logger.warn(
        `PaymentConfirmedEvent paidAmount mismatch on order ${orderId}: ` +
          `event=${paidAmount} db=${order.totalAmount} — discarding.`,
      );
      return;
    }

    this.logger.log(
      `PaymentConfirmedEvent received for order ${orderId} — dispatching T-02 (pending→paid).`,
    );

    try {
      await this.commandBus.execute(
        new TransitionOrderCommand(
          orderId,
          'paid',
          null,       // system actor — no user ID
          'system',
          'PaymentConfirmed',
        ),
      );
    } catch (err) {
      // If the order was already cancelled (e.g., by the timeout cron before this
      // event arrived), the transition will be rejected as invalid. Log and discard —
      // the DB state is already correct. Never re-throw from an event handler.
      this.logger.error(
        `T-02 transition failed for order ${orderId} (PaymentConfirmedEvent): ` +
          `${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
