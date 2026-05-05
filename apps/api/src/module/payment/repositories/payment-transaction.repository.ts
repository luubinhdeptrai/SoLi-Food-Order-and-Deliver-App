import { Injectable, Inject, Logger } from '@nestjs/common';
import { eq, and, lte, inArray, asc, desc } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';
import {
  paymentTransactions,
  type PaymentTransaction,
  type NewPaymentTransaction,
  type PaymentStatus,
} from '../domain/payment-transaction.schema';

/**
 * PaymentTransactionRepository
 *
 * Data access layer for the payment_transactions table.
 * All queries are thin wrappers around Drizzle — no business logic here.
 *
 * Cross-context note: this repository operates only on the Payment BC's own
 * table. It does not join or reference any Ordering BC tables.
 */
@Injectable()
export class PaymentTransactionRepository {
  private readonly logger = new Logger(PaymentTransactionRepository.name);

  constructor(
    @Inject(DB_CONNECTION)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  /**
   * Inserts a new PaymentTransaction row.
   * Called by PaymentService.initiateVNPayPayment() as the first step.
   */
  async create(data: NewPaymentTransaction): Promise<PaymentTransaction> {
    const [row] = await this.db
      .insert(paymentTransactions)
      .values(data)
      .returning();

    return row;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Looks up a transaction by its primary key (= vnp_TxnRef sent to VNPay).
   * Returns null when not found.
   */
  async findById(id: string): Promise<PaymentTransaction | null> {
    const [row] = await this.db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, id))
      .limit(1);

    return row ?? null;
  }

  /**
   * Looks up the most recent transaction for an order.
   * Returns null when the order has no payment record (COD orders).
   *
   * Sorts by createdAt DESC to return the latest attempt — for retry
   * scenarios where multiple transactions exist for the same orderId,
   * the most recently created row is the authoritative one.
   */
  async findByOrderId(orderId: string): Promise<PaymentTransaction | null> {
    const [row] = await this.db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.orderId, orderId))
      .orderBy(desc(paymentTransactions.createdAt))
      .limit(1);

    return row ?? null;
  }

  /**
   * Looks up a transaction by the VNPay-assigned transaction number.
   * Used for IPN idempotency pre-flight check (D-P4).
   * Returns null when not found.
   */
  async findByProviderTxnId(
    providerTxnId: string,
  ): Promise<PaymentTransaction | null> {
    const [row] = await this.db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.providerTxnId, providerTxnId))
      .limit(1);

    return row ?? null;
  }

  /**
   * Returns all transactions for a given customer, ordered newest-first.
   * Used by GET /payments/my (Phase 8.7).
   */
  async findByCustomerId(customerId: string): Promise<PaymentTransaction[]> {
    return this.db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.customerId, customerId))
      .orderBy(desc(paymentTransactions.createdAt));
  }

  /**
   * Returns the most recently completed transaction for an order, or null.
   *
   * Used by OrderCancelledAfterPaymentHandler (Phase 8.6) to find the
   * authoritative completed transaction for refund processing, regardless of
   * whether newer `failed` transactions also exist for the same orderId.
   *
   * Querying explicitly by `status = 'completed'` is safer than relying on
   * `findByOrderId` (which returns only the most-recently-created row) in
   * scenarios where multiple payment attempts occurred for the same order.
   */
  async findCompletedByOrderId(
    orderId: string,
  ): Promise<PaymentTransaction | null> {
    const [row] = await this.db
      .select()
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.orderId, orderId),
          eq(paymentTransactions.status, 'completed'),
        ),
      )
      .orderBy(desc(paymentTransactions.createdAt))
      .limit(1);

    return row ?? null;
  }

  /**
   * Returns expired transactions in 'pending' or 'awaiting_ipn' status.
   * Used by PaymentTimeoutTask (Phase 8.5).
   *
   * Processes oldest-first (createdAt ASC) to prioritise long-overdue
   * transactions. Limited to 500 rows per run to prevent unbounded DB reads
   * if many transactions expire simultaneously (e.g. after a system outage).
   * Any remaining will be caught on the next cron tick.
   */
  async findExpired(): Promise<PaymentTransaction[]> {
    return this.db
      .select()
      .from(paymentTransactions)
      .where(
        and(
          inArray(paymentTransactions.status, ['pending', 'awaiting_ipn']),
          lte(paymentTransactions.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(paymentTransactions.createdAt))
      .limit(500);
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /**
   * Transitions a transaction to 'awaiting_ipn' and stores the VNPay payment URL.
   * Called immediately after successful URL generation.
   *
   * Uses optimistic locking: only updates if `version` matches.
   * Returns the updated row, or null if the version check fails (concurrent
   * modification — caller should treat this as a non-fatal warning and retry).
   */
  async updateToAwaitingIpn(
    id: string,
    paymentUrl: string,
    currentVersion: number,
  ): Promise<PaymentTransaction | null> {
    const [updated] = await this.db
      .update(paymentTransactions)
      .set({
        status: 'awaiting_ipn',
        paymentUrl,
        version: currentVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paymentTransactions.id, id),
          eq(paymentTransactions.version, currentVersion),
        ),
      )
      .returning();

    return updated ?? null;
  }

  /**
   * Generic status update with optimistic locking.
   * `extra` allows callers to set additional columns alongside the status change
   * (e.g. paidAt, providerTxnId, rawIpnPayload for IPN processing — Phase 8.3).
   *
   * Returns the updated row, or null if the version check failed.
   */
  async updateStatus(
    id: string,
    status: PaymentStatus,
    currentVersion: number,
    extra: Partial<
      Pick<
        PaymentTransaction,
        | 'providerTxnId'
        | 'vnpResponseCode'
        | 'rawIpnPayload'
        | 'ipnReceivedAt'
        | 'paidAt'
        | 'refundInitiatedAt'
        | 'refundedAt'
        | 'refundRetryCount'
      >
    > = {},
  ): Promise<PaymentTransaction | null> {
    const [updated] = await this.db
      .update(paymentTransactions)
      .set({
        status,
        version: currentVersion + 1,
        updatedAt: new Date(),
        ...extra,
      })
      .where(
        and(
          eq(paymentTransactions.id, id),
          eq(paymentTransactions.version, currentVersion),
        ),
      )
      .returning();

    if (!updated) {
      this.logger.warn(
        `updateStatus: optimistic lock failed for txn ${id} at version ${currentVersion}`,
      );
    }

    return updated ?? null;
  }
}
