import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  unique,
  customType,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Monetary column (mirrors the moneyColumn pattern from order.schema.ts).
//
// PostgreSQL NUMERIC(12, 2) gives exact decimal storage.
// fromDriver converts the driver string representation to a JS number.
// toDriver converts a JS number back to a string for the driver.
// ---------------------------------------------------------------------------
const moneyColumn = customType<{ data: number; driverData: string }>({
  dataType() {
    return 'numeric(12, 2)';
  },
  fromDriver(value) {
    return parseFloat(value);
  },
  toDriver(value) {
    return String(value);
  },
});

// ---------------------------------------------------------------------------
// payment_status enum
//
// State machine:
//   pending        → awaiting_ipn  (URL generated, customer redirected)
//   awaiting_ipn   → completed     (IPN received, responsePaid = true)
//   awaiting_ipn   → failed        (IPN received, responsePaid = false, or timeout)
//   pending        → failed        (PaymentTimeoutTask — never redirected)
//   completed      → refund_pending (OrderCancelledAfterPaymentEvent)
//   refund_pending → refunded      (VNPay Refund API success)
// ---------------------------------------------------------------------------
export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'awaiting_ipn',
  'completed',
  'failed',
  'refund_pending',
  'refunded',
]);

export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// payment_transactions
//
// Single aggregate of the Payment BC. One row per payment attempt.
// Multiple rows per order are allowed (retry scenarios), but only the row
// with status='completed' is authoritative.
//
// Cross-context references (order_id, customer_id) are plain UUIDs — no FK
// constraints, per D-P7 (enables future microservice extraction).
// ---------------------------------------------------------------------------
export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Cross-context references — no PostgreSQL REFERENCES (D-P7)
    orderId: uuid('order_id').notNull(),
    customerId: uuid('customer_id').notNull(),

    // Order total at checkout time (source of truth for amount validation)
    amount: moneyColumn('amount').notNull(),

    status: paymentStatusEnum('status').notNull().default('pending'),

    // VNPay redirect URL, set when status transitions to awaiting_ipn.
    // Null until URL generation succeeds.
    paymentUrl: text('payment_url'),

    // vnp_TransactionNo from VNPay IPN — UNIQUE prevents double-processing
    // of the same IPN callback (idempotency, D-P4).
    providerTxnId: text('provider_txn_id'),

    // Raw vnp_ResponseCode from IPN — stored for audit/debugging
    vnpResponseCode: text('vnp_response_code'),

    // Full IPN query params stored verbatim for forensic audit.
    // Never rendered back to clients.
    rawIpnPayload: jsonb('raw_ipn_payload').$type<Record<string, string>>(),

    // Timestamps for each lifecycle phase
    ipnReceivedAt: timestamp('ipn_received_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    refundInitiatedAt: timestamp('refund_initiated_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),

    // Incremented by PaymentRefundRetryTask (Phase 8.6+).
    // NULL until the first retry attempt.
    refundRetryCount: integer('refund_retry_count'),

    // Session expiry — set at creation as NOW() + PAYMENT_SESSION_TIMEOUT_SECONDS.
    // PaymentTimeoutTask queries this to find stale pending/awaiting_ipn rows.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    // Optimistic locking — mirrors the orders.version pattern.
    // Updated on every status transition to prevent concurrent overwrites.
    version: integer('version').notNull().default(0),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    // Hard uniqueness constraint for IPN idempotency (D-P4).
    // A second IPN with the same vnp_TransactionNo hits this and is rejected.
    unique('payment_transactions_provider_txn_id_unique').on(t.providerTxnId),

    // Most queries look up by orderId (IPN processing, status query).
    index('idx_ptxn_order_id').on(t.orderId),

    // Customer-facing query: GET /payments/my (Phase 8.7+)
    index('idx_ptxn_customer_id').on(t.customerId),

    // PaymentTimeoutTask partial index: only pending/awaiting_ipn rows.
    // Drizzle does not support partial indexes natively — add WHERE clause
    // via raw SQL in the migration file after drizzle-kit generates the base.
    index('idx_ptxn_expires_at').on(t.expiresAt),
  ],
);

export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type NewPaymentTransaction = typeof paymentTransactions.$inferInsert;
