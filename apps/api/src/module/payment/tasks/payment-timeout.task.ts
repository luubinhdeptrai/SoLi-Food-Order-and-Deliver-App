import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventBus } from '@nestjs/cqrs';
import { PaymentTransactionRepository } from '../repositories/payment-transaction.repository';
import { PaymentFailedEvent } from '@/shared/events/payment-failed.event';

/**
 * PaymentTimeoutTask
 *
 * Runs every minute and expires payment transactions that have passed
 * their `expiresAt` deadline while still in a non-terminal status
 * (`pending` or `awaiting_ipn`).
 *
 * Scenarios handled:
 *  - `pending`      → URL generation failed before redirect; self-healing expiry.
 *  - `awaiting_ipn` → Customer abandoned the payment page or VNPay never called IPN.
 *
 * For each expired transaction:
 *   1. Transition to `failed` via optimistic locking.
 *   2. Publish `PaymentFailedEvent` — Ordering BC handler (T-03) cancels the order.
 *
 * Multi-pod safety:
 *  Two pods may race on the same transaction. Optimistic locking ensures only
 *  one pod wins the DB update. The losing pod's `updateStatus` returns null
 *  and no event is published, preventing duplicate `PaymentFailedEvent` dispatches.
 *
 * Acceptable delay: up to 60 seconds between expiry and status transition.
 *
 * Phase: 8.5
 */
@Injectable()
export class PaymentTimeoutTask {
  private readonly logger = new Logger(PaymentTimeoutTask.name);

  constructor(
    private readonly txnRepo: PaymentTransactionRepository,
    private readonly eventBus: EventBus,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredPayments(): Promise<void> {
    let expired: Awaited<ReturnType<typeof this.txnRepo.findExpired>>;

    try {
      expired = await this.txnRepo.findExpired();
    } catch (err) {
      this.logger.error(
        `PaymentTimeoutTask failed to query expired transactions: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return;
    }

    if (expired.length === 0) return;

    this.logger.log(
      `PaymentTimeoutTask: found ${expired.length} expired transaction(s) to fail.`,
    );

    for (const txn of expired) {
      try {
        const updated = await this.txnRepo.updateStatus(
          txn.id,
          'failed',
          txn.version,
        );

        if (!updated) {
          // Optimistic lock lost — another pod or process already resolved this transaction.
          // Do NOT publish the event; the winning process is responsible for that.
          this.logger.warn(
            `PaymentTimeoutTask: optimistic lock lost for txn=${txn.id} — skipping event.`,
          );
          continue;
        }

        // Differentiate reason by status so the cancellation note in Ordering
        // reflects the actual failure mode (never redirected vs. abandoned page).
        // T-03 (pending→cancelled) has requireNote: true — reason MUST be non-empty.
        const reason =
          txn.status === 'pending'
            ? 'Payment session could not be initialised — VNPay URL generation failed before redirect'
            : 'Payment session expired — customer did not complete payment within the allowed time';

        // Publish AFTER the DB write commits to ensure consistent state.
        this.eventBus.publish(
          new PaymentFailedEvent(
            txn.orderId,
            txn.customerId,
            'vnpay',
            reason,
            new Date(),
          ),
        );

        this.logger.log(
          `PaymentTimeoutTask: expired txn=${txn.id} order=${txn.orderId} (was ${txn.status}) → failed.`,
        );
      } catch (err) {
        // Log per-transaction failures without aborting the rest of the batch.
        this.logger.error(
          `PaymentTimeoutTask: failed to expire txn=${txn.id}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }
  }
}
