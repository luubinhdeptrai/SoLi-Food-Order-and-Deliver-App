import { Injectable, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { ProcessIpnCommand } from './process-ipn.command';
import { VNPayService } from '../services/vnpay.service';
import { PaymentTransactionRepository } from '../repositories/payment-transaction.repository';
import { PaymentConfirmedEvent } from '@/shared/events/payment-confirmed.event';
import { PaymentFailedEvent } from '@/shared/events/payment-failed.event';
import type { PaymentTransaction } from '../domain/payment-transaction.schema';

// ---------------------------------------------------------------------------
// VNPay IPN response codes (defined in VNPay merchant documentation).
// These are the ONLY valid response codes VNPay accepts from our server.
// ---------------------------------------------------------------------------

/** Signature valid and transaction processed successfully. */
const IPN_RSP_SUCCESS = '00';

/** Invalid signature — VNPay will retry until it receives a success response. */
const IPN_RSP_INVALID_SIGNATURE = '97';

/** Transaction not found in our system. */
const IPN_RSP_ORDER_NOT_FOUND = '01';

/** Amount mismatch — the amount VNPay charged differs from what we expect. */
const IPN_RSP_AMOUNT_MISMATCH = '04';

/** Generic unknown error (should never happen in normal operation). */
const IPN_RSP_UNKNOWN_ERROR = '99';

/**
 * Epsilon for floating-point amount comparison.
 * Since amounts are stored as NUMERIC(12,2), maximum precision drift is 0.005 VND.
 * We use 0.01 to match the Ordering BC convention (see PaymentConfirmedEventHandler).
 */
const AMOUNT_EPSILON = 0.01;

/** IPN response shape — MUST NOT be wrapped in a result envelope. */
export interface IpnResponse {
  RspCode: string;
  Message: string;
}

/**
 * ProcessIpnHandler
 *
 * The authoritative handler for VNPay IPN (Instant Payment Notification) callbacks.
 * IPN is the ONLY mechanism that mutates PaymentTransaction state and publishes
 * payment outcome events. The return URL handler (Phase 8.4) never writes to DB.
 *
 * Security model:
 *   - HMAC SHA512 signature is verified BEFORE any DB read or write.
 *   - All DB mutations use optimistic locking (version field) to prevent
 *     race conditions when VNPay retries the IPN concurrently.
 *   - Amount is validated against the stored transaction to prevent over-
 *     or under-crediting (BR-P4).
 *
 * Idempotency model (handles VNPay's retry mechanism):
 *   - Pre-flight: lookup by vnp_TxnRef (our PaymentTransaction.id = PK).
 *     If the transaction is already in a terminal state (completed/failed/
 *     refund_pending/refunded), return IPN_RSP_SUCCESS immediately without
 *     any further DB access. VNPay considers this a valid acknowledgement.
 *   - Hard backstop: UNIQUE constraint on provider_txn_id in the DB prevents
 *     a second INSERT even if the application-level check races.
 *
 * Event publishing:
 *   - PaymentConfirmedEvent → Ordering BC (T-02: pending → paid)
 *   - PaymentFailedEvent    → Ordering BC (T-03: pending → cancelled)
 *   Published AFTER the DB write commits so the event consumer receives
 *   consistent state.
 *
 * Phase: 8.3
 */
@Injectable()
@CommandHandler(ProcessIpnCommand)
export class ProcessIpnHandler implements ICommandHandler<ProcessIpnCommand> {
  private readonly logger = new Logger(ProcessIpnHandler.name);

  constructor(
    private readonly vnpayService: VNPayService,
    private readonly txnRepo: PaymentTransactionRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: ProcessIpnCommand): Promise<IpnResponse> {
    // -------------------------------------------------------------------------
    // Step 1: Verify HMAC SHA512 signature.
    //
    // This MUST be the very first operation — we must not trust any parameter
    // value before the signature is confirmed valid. A spoofed IPN with a valid-
    // looking txnRef would otherwise let an attacker acknowledge fake payments.
    // -------------------------------------------------------------------------
    const verification = this.vnpayService.verifyIpn(command.query);

    if (!verification.valid) {
      this.logger.warn(
        `IPN rejected — invalid signature. ` +
          `Raw query keys: [${Object.keys(command.query).join(', ')}]`,
      );
      return {
        RspCode: IPN_RSP_INVALID_SIGNATURE,
        Message: 'Invalid signature',
      };
    }

    const {
      txnRef,
      providerTxnId,
      amount: ipnAmount,
      responsePaid,
    } = verification;

    this.logger.log(
      `IPN received — txnRef=${txnRef} providerTxnId=${providerTxnId} ` +
        `responsePaid=${responsePaid} amount=${ipnAmount}`,
    );

    // -------------------------------------------------------------------------
    // Step 2: Look up the PaymentTransaction by primary key.
    //
    // vnp_TxnRef = PaymentTransaction.id (we set this when building the URL).
    // Using findById() (PK lookup) is the most efficient and precise approach.
    // -------------------------------------------------------------------------
    const txn = await this.txnRepo.findById(txnRef);

    if (!txn) {
      this.logger.warn(
        `IPN references unknown txnRef=${txnRef} — no PaymentTransaction found.`,
      );
      return {
        RspCode: IPN_RSP_ORDER_NOT_FOUND,
        Message: 'Transaction not found',
      };
    }

    // -------------------------------------------------------------------------
    // Step 3: Idempotency — terminal state check.
    //
    // If the transaction is already in a terminal state, the IPN is a retry
    // from VNPay (they retry until they receive RspCode='00'). Acknowledge
    // immediately without re-processing to prevent double event publishing.
    //
    // Terminal states: completed, failed, refund_pending, refunded.
    // Non-terminal (still processable): pending, awaiting_ipn.
    // -------------------------------------------------------------------------
    if (this.isTerminalStatus(txn.status)) {
      this.logger.log(
        `IPN for txnRef=${txnRef} already in terminal status=${txn.status} — ` +
          `acknowledging without re-processing (idempotent response).`,
      );
      return {
        RspCode: IPN_RSP_SUCCESS,
        Message: 'Transaction already processed',
      };
    }

    // -------------------------------------------------------------------------
    // Step 4: Amount validation (BR-P4).
    //
    // vnp_Amount from IPN = what VNPay actually charged the customer.
    // txn.amount = what we asked VNPay to charge (stored at URL-generation time).
    // A mismatch indicates either a VNPay bug or a tampering attempt.
    //
    // We mark the transaction as failed and fire PaymentFailedEvent so Ordering
    // can cancel the order. The customer should contact support.
    // -------------------------------------------------------------------------
    if (Math.abs(ipnAmount - txn.amount) > AMOUNT_EPSILON) {
      this.logger.error(
        `IPN amount mismatch for txnRef=${txnRef}: ` +
          `expected=${txn.amount} received=${ipnAmount} (delta=${Math.abs(ipnAmount - txn.amount)})`,
      );

      // Only publish if this handler won the optimistic lock — prevents duplicate events
      // when VNPay retries concurrently and two handlers race on the same transaction.
      const mismatchFailed = await this.markFailed(
        txn,
        command.query,
        providerTxnId,
      );
      if (mismatchFailed) {
        this.publishPaymentFailed(
          txn,
          `IPN amount mismatch: expected ${txn.amount}, got ${ipnAmount}`,
        );
      }

      return { RspCode: IPN_RSP_AMOUNT_MISMATCH, Message: 'Amount mismatch' };
    }

    // -------------------------------------------------------------------------
    // Step 5: Process the IPN result.
    //
    // responsePaid = true  → vnp_ResponseCode=00 AND vnp_TransactionStatus=00
    //                        Bank approved the charge.
    // responsePaid = false → Any other code (bank declined, user cancelled, etc.)
    // -------------------------------------------------------------------------
    if (responsePaid) {
      return this.handleSuccess(txn, command.query, providerTxnId, ipnAmount);
    } else {
      const responseCode = command.query['vnp_ResponseCode'] ?? 'unknown';
      return this.handleFailure(
        txn,
        command.query,
        providerTxnId,
        responseCode,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private — success path
  // ---------------------------------------------------------------------------

  /**
   * Marks the transaction as 'completed' and publishes PaymentConfirmedEvent.
   *
   * Uses optimistic locking — if the version has changed since we read the
   * record, another process (e.g. concurrent IPN retry) won the race.
   * We return success either way because the intent is fulfilled.
   */
  private async handleSuccess(
    txn: PaymentTransaction,
    rawQuery: Record<string, string>,
    providerTxnId: string,
    paidAmount: number,
  ): Promise<IpnResponse> {
    const now = new Date();

    const updated = await this.txnRepo.updateStatus(
      txn.id,
      'completed',
      txn.version,
      {
        // Normalize empty string to null — VNPay omits vnp_TransactionNo in rare edge
        // cases. Storing '' would trigger the UNIQUE constraint on the second retry.
        providerTxnId: providerTxnId || null,
        vnpResponseCode: rawQuery['vnp_ResponseCode'] ?? null,
        rawIpnPayload: rawQuery,
        ipnReceivedAt: now,
        paidAt: now,
      },
    );

    if (!updated) {
      // Optimistic lock lost — a concurrent IPN handler already processed this.
      // Re-read to confirm terminal state before deciding on the response.
      this.logger.warn(
        `IPN success: optimistic lock lost for txn=${txn.id} ` +
          `(concurrent processing). Re-reading for terminal check.`,
      );

      const current = await this.txnRepo.findById(txn.id);
      if (current && this.isTerminalStatus(current.status)) {
        this.logger.log(
          `Concurrent IPN handler completed txn=${txn.id} with status=${current.status}.`,
        );
        return { RspCode: IPN_RSP_SUCCESS, Message: 'Confirmed' };
      }

      // Could not determine outcome — return unknown error so VNPay retries.
      return {
        RspCode: IPN_RSP_UNKNOWN_ERROR,
        Message: 'Concurrent processing conflict',
      };
    }

    this.logger.log(
      `Payment CONFIRMED: txn=${txn.id} order=${txn.orderId} ` +
        `amount=${paidAmount} providerTxnId=${providerTxnId}`,
    );

    // Publish AFTER the DB write — Ordering's handler needs consistent DB state.
    this.eventBus.publish(
      new PaymentConfirmedEvent(
        txn.orderId,
        txn.customerId,
        'vnpay',
        paidAmount,
        now,
      ),
    );

    return { RspCode: IPN_RSP_SUCCESS, Message: 'Confirmed' };
  }

  // ---------------------------------------------------------------------------
  // Private — failure path
  // ---------------------------------------------------------------------------

  /**
   * Marks the transaction as 'failed' and publishes PaymentFailedEvent.
   * The human-readable reason is derived from the VNPay response code.
   */
  private async handleFailure(
    txn: PaymentTransaction,
    rawQuery: Record<string, string>,
    providerTxnId: string,
    responseCode: string,
  ): Promise<IpnResponse> {
    // Only publish the event if THIS handler won the optimistic lock.
    // A concurrent IPN retry may have already marked the transaction failed
    // and published the event — publishing again would dispatch a second
    // T-03 cancel command, which would fail silently but is wasteful.
    const failed = await this.markFailed(txn, rawQuery, providerTxnId);
    if (failed) {
      const reason = `VNPay declined payment — responseCode=${responseCode}`;
      this.publishPaymentFailed(txn, reason);
      this.logger.log(
        `Payment FAILED: txn=${txn.id} order=${txn.orderId} ` +
          `responseCode=${responseCode}`,
      );
    }

    // Always return IPN_RSP_SUCCESS to VNPay after processing a failed payment.
    // IPN_RSP_INVALID_SIGNATURE is reserved for actual signature errors only.
    // Returning '00' here means VNPay stops retrying — our side handled it.
    return { RspCode: IPN_RSP_SUCCESS, Message: 'Processed' };
  }

  // ---------------------------------------------------------------------------
  // Private — shared helpers
  // ---------------------------------------------------------------------------

  /**
   * Writes the 'failed' terminal state to the DB with optimistic locking.
   *
   * Returns true  — this handler won the lock; caller MUST publish PaymentFailedEvent.
   * Returns false — another concurrent handler already resolved the transaction;
   *                 caller MUST NOT publish to avoid duplicate events.
   */
  private async markFailed(
    txn: PaymentTransaction,
    rawQuery: Record<string, string>,
    providerTxnId: string,
  ): Promise<boolean> {
    const now = new Date();

    const updated = await this.txnRepo.updateStatus(
      txn.id,
      'failed',
      txn.version,
      {
        providerTxnId: providerTxnId || null,
        vnpResponseCode: rawQuery['vnp_ResponseCode'] ?? null,
        rawIpnPayload: rawQuery,
        ipnReceivedAt: now,
      },
    );

    if (!updated) {
      this.logger.warn(
        `markFailed: optimistic lock lost for txn=${txn.id} — another process resolved it first.`,
      );
      return false;
    }

    return true;
  }

  /**
   * Publishes PaymentFailedEvent to the CQRS EventBus.
   * The `reason` string MUST be non-empty — PaymentFailedEventHandler forwards
   * it as the `note` in TransitionOrderCommand (T-03 requires `requireNote: true`).
   * An empty string would cause the order cancellation to fail silently.
   */
  private publishPaymentFailed(txn: PaymentTransaction, reason: string): void {
    this.eventBus.publish(
      new PaymentFailedEvent(
        txn.orderId,
        txn.customerId,
        'vnpay',
        reason,
        new Date(),
      ),
    );
  }

  /**
   * Returns true if the status is a terminal state that no longer accepts IPN.
   * Terminal states must not be overwritten by a late or retried IPN.
   */
  private isTerminalStatus(status: PaymentTransaction['status']): boolean {
    return (
      status === 'completed' ||
      status === 'failed' ||
      status === 'refund_pending' ||
      status === 'refunded'
    );
  }
}
