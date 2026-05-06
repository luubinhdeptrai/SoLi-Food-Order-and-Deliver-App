import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { PaymentTransactionRepository } from '../repositories/payment-transaction.repository';
import { OrderCancelledAfterPaymentEvent } from '@/shared/events/order-cancelled-after-payment.event';

/**
 * OrderCancelledAfterPaymentHandler
 *
 * Listens for `OrderCancelledAfterPaymentEvent` from the Ordering BC and
 * initiates a refund for the associated completed payment transaction.
 *
 * Event sources (transitions that fire this event):
 *  - T-05: PAID → CANCELLED (restaurant timeout — order confirmed by VNPay but
 *           not accepted by restaurant within the deadline).
 *  - T-07: CONFIRMED → CANCELLED (admin-initiated cancellation of a paid order).
 *
 * State machine:
 *   completed → refund_pending → refunded
 *
 * Idempotency:
 *   - Pre-flight: finds the most recent transaction for the order by `findByOrderId`.
 *   - Guards against duplicate events:
 *       (a) No `completed` transaction found → nothing to refund, return.
 *       (b) Transaction already in `refund_pending` or `refunded` → skip.
 *   - Optimistic locking on `updateStatus` prevents concurrent handlers from
 *       double-transitioning the same row.
 *
 * VNPay Refund API:
 *   VNPay's sandbox environment does not reliably support the Refund API.
 *   The actual HTTP call is stubbed here with a TODO comment.
 *   The transaction is moved to `refunded` immediately after the stub succeeds,
 *   which keeps the state machine consistent for testing.
 *   In production, replace the stub with a real VNPayService.requestRefund() call
 *   and implement retry logic (refundRetryCount / refundInitiatedAt columns are
 *   already available in the schema for this purpose).
 *
 * Cross-BC contract:
 *   This handler operates only on the `payment_transactions` table.
 *   It does NOT call any Ordering BC service or repository.
 *
 * Phase: 8.6
 */
@Injectable()
@EventsHandler(OrderCancelledAfterPaymentEvent)
export class OrderCancelledAfterPaymentHandler
  implements IEventHandler<OrderCancelledAfterPaymentEvent>
{
  private readonly logger = new Logger(OrderCancelledAfterPaymentHandler.name);

  constructor(private readonly txnRepo: PaymentTransactionRepository) {}

  async handle(event: OrderCancelledAfterPaymentEvent): Promise<void> {
    this.logger.log(
      `OrderCancelledAfterPaymentEvent received: orderId=${event.orderId} ` +
        `paidAmount=${event.paidAmount} cancelledByRole=${event.cancelledByRole}`,
    );

    try {
      await this.processRefund(event);
    } catch (err) {
      // Never rethrow from an event handler — an unhandled exception would propagate
      // up through the CQRS EventBus and could disrupt other handlers in the chain.
      // The error is logged at ERROR level so it is observable by monitoring.
      this.logger.error(
        `OrderCancelledAfterPaymentHandler failed for orderId=${event.orderId}: ` +
          `${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private — core refund logic (separated so try-catch boundary is clean)
  // ---------------------------------------------------------------------------

  private async processRefund(
    event: OrderCancelledAfterPaymentEvent,
  ): Promise<void> {
    // -------------------------------------------------------------------------
    // Step 1: Find the COMPLETED transaction for this order.
    //
    // `findCompletedByOrderId` explicitly queries for status='completed' so the
    // refund targets the right row even if a newer `failed` transaction also
    // exists for the same orderId (e.g. from a prior failed payment attempt).
    // Using `findByOrderId` (most-recent row) would return the wrong transaction
    // in that edge case, causing the refund to be silently skipped.
    // -------------------------------------------------------------------------
    const txn = await this.txnRepo.findCompletedByOrderId(event.orderId);

    if (!txn) {
      // No completed transaction — this is a COD order, the payment failed before
      // confirmation, or the event arrived for an already-refunded order.
      // Nothing to refund; log and exit cleanly.
      this.logger.warn(
        `No completed payment transaction found for orderId=${event.orderId}. ` +
          `Skipping refund (COD, failed payment, or already refunded).`,
      );
      return;
    }

    // -------------------------------------------------------------------------
    // Step 2: Defensive guard — amount must be positive.
    //
    // `txn.amount` is the Payment BC's ground truth (stored at checkout time).
    // All VND amounts are multiples of 1000, so this should always be ≥ 1000.
    // Guard defensively: issuing a VNPay refund for 0 VND is meaningless and
    // indicates a data corruption scenario that should be surfaced.
    // -------------------------------------------------------------------------
    if (txn.amount <= 0) {
      this.logger.error(
        `Unexpected non-positive amount=${txn.amount} for txn=${txn.id} orderId=${event.orderId}. ` +
          `Aborting refund — manual investigation required.`,
      );
      return;
    }

    // -------------------------------------------------------------------------
    // Step 3: Idempotency guard — check current status.
    //
    // `findCompletedByOrderId` only returns rows with status='completed', so
    // this guard is redundant in the normal path but provides an additional
    // safety net in case the status changed between the select and this check.
    // -------------------------------------------------------------------------
    if (txn.status === 'refund_pending' || txn.status === 'refunded') {
      this.logger.log(
        `Refund already initiated for txn=${txn.id} (status=${txn.status}). ` +
          `Skipping duplicate OrderCancelledAfterPaymentEvent.`,
      );
      return;
    }

    if (txn.status !== 'completed') {
      // Should never reach here given findCompletedByOrderId only returns 'completed'
      // rows. Log as a sanity check and exit.
      this.logger.warn(
        `Unexpected txn status=${txn.status} for orderId=${event.orderId} ` +
          `(findCompletedByOrderId returned a non-completed row). Skipping.`,
      );
      return;
    }

    // -------------------------------------------------------------------------
    // Step 4: Transition to `refund_pending` (optimistic locking).
    //
    // Sets `refundInitiatedAt` to track when the refund process started.
    // -------------------------------------------------------------------------
    const now = new Date();
    const pending = await this.txnRepo.updateStatus(
      txn.id,
      'refund_pending',
      txn.version,
      { refundInitiatedAt: now },
    );

    if (!pending) {
      // Optimistic lock lost — a concurrent handler won the race.
      // The winning handler is responsible for completing the refund.
      this.logger.warn(
        `Optimistic lock lost when transitioning txn=${txn.id} to refund_pending. ` +
          `Another handler is processing the refund.`,
      );
      return;
    }

    this.logger.log(
      `txn=${txn.id} → refund_pending for orderId=${event.orderId} amount=${txn.amount}`,
    );

    // -------------------------------------------------------------------------
    // Step 5: Issue VNPay refund (STUBBED — sandbox does not support refund API).
    //
    // `txn.amount` is used here (Payment BC ground truth) rather than
    // `event.paidAmount` (Ordering BC value). Both should be equal in normal
    // operation, but the Payment BC owns the canonical refund amount.
    //
    // TODO: Replace this stub with a real VNPayService.requestRefund() call:
    //
    //   const refundResult = await this.vnpayService.requestRefund({
    //     txnRef: txn.id,
    //     transactionNo: txn.providerTxnId,
    //     amount: txn.amount,                    ← Payment BC ground truth
    //     transactionDate: txn.paidAt,
    //     createdDate: now,
    //     createBy: 'system',
    //     orderInfo: `Refund for cancelled order ${event.orderId}`,
    //   });
    //
    //   if (!refundResult.success) {
    //     // Increment refundRetryCount and leave in `refund_pending`.
    //     // A future PaymentRefundRetryTask (Phase 8.8) can retry these rows.
    //     this.logger.warn(`VNPay refund failed for txn=${txn.id}: ${refundResult.message}`);
    //     return;
    //   }
    //
    // -------------------------------------------------------------------------
    this.logger.log(
      `[STUB] VNPay Refund API call for txn=${txn.id} amount=${txn.amount} — ` +
        `treating as success (sandbox limitation).`,
    );

    // -------------------------------------------------------------------------
    // Step 6: Transition to `refunded` (optimistic locking, new version).
    //
    // `pending` is the just-updated row — its `version` is now txn.version + 1.
    // -------------------------------------------------------------------------
    const refunded = await this.txnRepo.updateStatus(
      txn.id,
      'refunded',
      pending.version,
      { refundedAt: new Date() },
    );

    if (!refunded) {
      // Extremely unlikely: another process modified the row between steps 4 and 6.
      // Leave in `refund_pending`; a future retry task can recover.
      this.logger.error(
        `Failed to transition txn=${txn.id} to refunded after successful stub. ` +
          `Leaving in refund_pending for manual recovery.`,
      );
      return;
    }

    this.logger.log(
      `Refund COMPLETE (stub): txn=${txn.id} orderId=${event.orderId} amount=${txn.amount} → refunded.`,
    );
  }
}
