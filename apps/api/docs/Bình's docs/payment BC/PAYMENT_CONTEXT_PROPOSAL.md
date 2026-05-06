# Payment Context — Architectural Proposal

> **Document Type:** Living Design Document (Code-Verified)
> **Author Role:** Senior Software Architect
> **Status:** Phase 8 — Pending Implementation 🔲
> **Target Project:** `SoLi-Food-Order-and-Deliver-App` / `apps/api`
> **Depends On:** Phase 5 (Order Lifecycle), Phase 6 (Downstream Event Stubs)
> **Verified Against:** Full codebase audit — all facts cross-checked with source files

---

## Table of Contents

1. [Context Overview](#1-context-overview)
2. [Scope & Boundaries](#2-scope--boundaries)
3. [Domain Model](#3-domain-model)
4. [Key Design Decisions](#4-key-design-decisions)
5. [Module Architecture](#5-module-architecture)
6. [Event Architecture](#6-event-architecture)
7. [VNPay Integration](#7-vnpay-integration)
8. [State Machine](#8-state-machine)
9. [Database Design](#9-database-design)
10. [API Design](#10-api-design)
11. [Edge Cases](#11-edge-cases)
12. [Security](#12-security)
13. [Migration Strategy](#13-migration-strategy)
14. [Implementation Phases](#14-implementation-phases)

---

## 1. Context Overview

### 1.1 Role of the Payment Context

The **Payment Context** is a **downstream context** of the Ordering BC. Its sole responsibility is the lifecycle of a **payment transaction**: creating a VNPay payment session, receiving and validating the IPN callback from VNPay, publishing the authoritative payment result back to Ordering, and processing refunds when ordered cancelled.

The Payment Context does **not** own order state. It acts as a financial gateway adapter and reports outcomes to Ordering via domain events.

### 1.2 Position in the System

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SoLi Platform (Modular Monolith)                    │
│                                                                             │
│   ┌──────────────────────────┐      synchronous call (checkout)             │
│   │         ORDERING         │ ──────────────────────────────►  ┌─────────┐ │
│   │       (Core Domain)      │                                  │ PAYMENT │ │
│   │                          │ ◄──── PaymentConfirmedEvent ──── │         │ │
│   │  - OrderPlacedEvent      │ ◄──── PaymentFailedEvent ──────  │ (DOWN-  │ │
│   │  - OrderCancelled        │ ────► OrderCancelledAfter        │ STREAM) │ │
│   │    AfterPaymentEvent     │       PaymentEvent ────────────► │         │ │
│   └──────────────────────────┘                                  └────┬────┘ │
│                                                                       │      │
│                                                                       │ HTTPS│
│                                                                       ▼      │
│                                                              VNPay Sandbox   │
│                                                           (server-to-server  │
│                                                              IPN callback)   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Relationship to Ordering

The relationship is **event-driven for results, synchronous for URL generation**:

| Direction | Mechanism | Payload |
|-----------|-----------|---------|
| Ordering → Payment (checkout) | **[UPDATED]** Intra-process call via `IPaymentInitiationPort` (DIP token) | `orderId`, `customerId`, `amount`, `ipAddr` |
| Payment → Ordering (confirmed) | `PaymentConfirmedEvent` on CQRS EventBus | orderId, paidAmount, paidAt |
| Payment → Ordering (failed) | `PaymentFailedEvent` on CQRS EventBus | orderId, reason, failedAt |
| Ordering → Payment (refund) | `OrderCancelledAfterPaymentEvent` on CQRS EventBus | orderId, paidAmount |

> **Why synchronous URL generation?** The customer must receive the VNPay redirect URL in the `POST /carts/my/checkout` HTTP response. Making URL generation asynchronous would force a polling loop. The synchronous call is scoped to the monolith and protected by the cart checkout lock (TTL = 30 s, see `CART_LOCK_TTL_SECONDS`).

> **[UPDATED] Dependency direction:** Ordering (upstream) calling Payment (downstream) at checkout is the correct DDD direction. Payment **never** calls Ordering services directly — results flow back via events only. To enforce the **Dependency Inversion Principle** and avoid a hard NestJS module import from `OrderingModule → PaymentModule`, `PlaceOrderHandler` must depend on `IPaymentInitiationPort` (an interface defined in `src/shared/ports/`), not on `PaymentService` directly. `PaymentModule` registers a provider that binds `IPaymentInitiationPort` to `PaymentService`. `OrderingModule` imports only the interface token, not the concrete module.

---

## 2. Scope & Boundaries

### 2.1 What Is Inside the Payment Context

| Concern | Description |
|---------|-------------|
| `PaymentTransaction` lifecycle | Create, advance through status states, audit history |
| VNPay URL generation | Build signed `vnp_*` query string and return redirect URL |
| IPN signature validation | HMAC SHA512 verification before any DB mutation |
| IPN idempotency | Deduplicate repeated IPN calls from VNPay retry mechanism |
| Payment result event publishing | Fire `PaymentConfirmedEvent` or `PaymentFailedEvent` after IPN |
| Refund initiation | Consume `OrderCancelledAfterPaymentEvent`, call VNPay Refund API |
| Expired payment cleanup | Cron job to mark timed-out `awaiting_ipn` transactions as `failed` |
| Payment status query | HTTP endpoint for clients to re-fetch payment URL or check status |

### 2.2 What Is Outside the Payment Context

| Concern | Belongs To | How Payment Interacts |
|---------|------------|-----------------------|
| Order status transitions | Ordering BC | Via `PaymentConfirmedEvent` / `PaymentFailedEvent` |
| Cart management | Ordering BC (CartModule) | None — cart is destroyed at checkout before Payment is called |
| Delivery dispatch | Delivery BC | None |
| Push notifications | Notification BC | None |
| Restaurant approval | IAM BC | None |
| Refund dispute resolution | Manual/Admin workflow | Admin initiates T-12 (`delivered → refunded`) in Ordering |

### 2.3 Business Rules

| Rule | Description |
|------|-------------|
| BR-P1 | Only `vnpay` orders have `PaymentTransaction` records. COD orders are outside this context. |
| BR-P2 | `vnp_Amount` sent to VNPay = `order.totalAmount × 100` (VNPay uses VND smallest unit × 100). |
| BR-P3 | IPN is the **sole authoritative** source for confirming or failing a payment. Return URL is UI-only and **never** updates DB state. |
| BR-P4 | Amount in IPN (`vnp_Amount / 100`) MUST match `payment_transactions.amount` within ε=0.01; mismatches are rejected with `RspCode: '04'` and fire `PaymentFailedEvent`. |
| BR-P5 | Each `vnp_TransactionNo` (VNPay's own ID) is stored UNIQUE to prevent double-crediting. |
| BR-P6 | Refund is **asynchronous**: status transitions to `refund_pending` immediately; `refunded` is set only after VNPay Refund API responds with `00`. |
| BR-P7 | A `pending` transaction that reaches `expires_at` without ever reaching `awaiting_ipn` is transitioned to `failed` (customer never redirected or browser closed before redirect). |

---

## 3. Domain Model

### 3.1 PaymentTransaction — Core Aggregate

`PaymentTransaction` is the single aggregate of the Payment Context. It tracks every VNPay payment attempt for a VNPay order.

```typescript
// payment_transactions (DB entity)
interface PaymentTransaction {
  id: string;                        // UUID — also the vnp_TxnRef sent to VNPay
  orderId: string;                   // Cross-context reference to orders.id (no FK)
  customerId: string;                // Cross-context reference to users.id (no FK)
  amount: number;                    // NUMERIC(12,2) — order.totalAmount at checkout
  status: PaymentStatus;
  paymentUrl: string | null;         // VNPay redirect URL (set during URL generation)
  providerTxnId: string | null;      // vnp_TransactionNo from IPN (UNIQUE index)
  vnpResponseCode: string | null;    // IPN vnp_ResponseCode for audit
  rawIpnPayload: Record<string, string> | null; // Full IPN params (JSONB, audit trail)
  ipnReceivedAt: Date | null;
  paidAt: Date | null;               // Set when status → completed
  refundInitiatedAt: Date | null;
  refundedAt: Date | null;           // Set when VNPay Refund API confirms
  refundRetryCount: number | null;   // [ADDED] null until first retry; incremented by PaymentRefundRetryTask
  createdAt: Date;
  expiresAt: Date;                   // createdAt + PAYMENT_SESSION_TIMEOUT_SECONDS
  version: number;                   // Optimistic locking counter
}
```

### 3.2 PaymentStatus Enum

```typescript
type PaymentStatus =
  | 'pending'          // Transaction created, URL not yet generated
  | 'awaiting_ipn'     // URL generated, customer redirected, waiting for VNPay IPN
  | 'completed'        // IPN received with vnp_ResponseCode='00' — payment confirmed
  | 'failed'           // IPN received with non-'00' code, or expired
  | 'refund_pending'   // OrderCancelledAfterPaymentEvent received, refund queued
  | 'refunded';        // VNPay Refund API returned success
```

### 3.3 Value Objects

| Value Object | Description |
|---|---|
| `VNPaySignature` | HMAC SHA512 hex digest over sorted+encoded parameters. Encapsulates the VNPay-specific signing algorithm so it is not duplicated between URL generation and IPN validation. |
| `VNPayAmount` | Wraps `number → number * 100` conversion (VNPay requires amount in VND without decimal × 100). Guards against accidentally sending raw `NUMERIC(12,2)` values. |
| `IpnVerificationResult` | Typed result returned by `VNPayService.verifyIpn()`: `{ valid: boolean; responsePaid: boolean; amount: number; providerTxnId: string }`. |

---

## 4. Key Design Decisions

### D-P1 — PaymentTransaction.id = vnp_TxnRef

**Decision:** The UUID primary key of `payment_transactions` is used directly as `vnp_TxnRef` in the VNPay URL. VNPay echoes this back in IPN, enabling O(1) transaction lookup without an extra `orderId` index lookup.

**Alternative rejected:** Using `orderId` as `vnp_TxnRef`. Rejected because a single order could theoretically spawn multiple payment attempts (user abandons, session expires, retries). Using the transaction UUID keeps attempts isolated and prevents an old IPN from a stale attempt from overwriting a newer one.

**Consequence:** `payment_transactions` may have multiple rows for the same `orderId` if the customer creates multiple payment sessions. Only the row that receives a `completed` IPN is authoritative. The IPN handler must validate that the matching transaction is still in `awaiting_ipn` status.

---

### D-P2 — Synchronous URL Generation at Checkout **[UPDATED]**

**Decision:** `PlaceOrderHandler` (Ordering BC) calls `IPaymentInitiationPort.initiateVNPayPayment()` synchronously **after** `persistOrderAtomically()` commits the order row and **before** firing `OrderPlacedEvent`. The returned `paymentUrl` is written to `orders.payment_url` via a follow-up `UPDATE` so the checkout HTTP response carries the redirect URL immediately.

**Two-phase write sequence (Phase 8.2):**
1. `persistOrderAtomically()` inserts order with `payment_url = NULL`.
2. If `paymentMethod === 'vnpay'`: call `IPaymentInitiationPort.initiateVNPayPayment(order.id, customerId, amount, ipAddr)`.
3. On success: `UPDATE orders SET payment_url = :url WHERE id = :orderId` (second DB write — not atomic with step 1).
4. On failure (VNPay unreachable): `payment_url` stays NULL; the `PaymentTransaction` stays `pending`; `PaymentTimeoutTask` auto-fails it after `PAYMENT_SESSION_TIMEOUT_SECONDS`, firing `PaymentFailedEvent` → T-03 auto-cancels the order.
5. `EventBus.publish(new OrderPlacedEvent(..., paymentUrl))` — paymentUrl may be null if step 2 failed.

**Alternative rejected:** Async event-driven URL generation (handler on `OrderPlacedEvent` generates URL, then updates `orders.payment_url` via a second event). Rejected because it forces the client into a polling loop for a URL that must arrive sub-second UX.

**[UPDATED] Implementation contract:** `PlaceOrderHandler` must inject `IPaymentInitiationPort` (DI token `PAYMENT_INITIATION_PORT`), not `PaymentService` directly. This prevents a hard compile-time dependency from `OrderingModule` on `PaymentModule`. File `src/shared/ports/payment-initiation.port.ts`:

```typescript
export const PAYMENT_INITIATION_PORT = Symbol('PAYMENT_INITIATION_PORT');

export interface IPaymentInitiationPort {
  initiateVNPayPayment(
    orderId: string,
    customerId: string,
    amount: number,
    ipAddr: string,
  ): Promise<{ txnId: string; paymentUrl: string }>;
}
```

**Consequence:** The cart checkout lock (`CART_LOCK_TTL_SECONDS = 30 s`) must be large enough to cover VNPay URL generation latency. VNPay sandbox round-trip is typically < 500 ms. The two-phase write means a partial failure window exists between step 1 and step 3; this is acceptable because the `PaymentTimeoutTask` self-heals the dangling order.

---

### D-P3 — IPN as the Only Authoritative Payment Confirmation

**Decision:** `GET /api/payments/vnpay/ipn` is the **only** endpoint allowed to transition a `PaymentTransaction` to `completed` or `failed`. The return URL (`GET /api/payments/vnpay/return`) validates the signature for client-side display only and returns `{ status, code }` — it never writes to the DB.

**Rationale:** VNPay's own documentation mandates this. The return URL is browser-initiated and can be manipulated (user closes tab, modifies query params). IPN is server-to-server.

---

### D-P4 — Idempotency via UNIQUE(provider_txn_id)

**Decision:** `payment_transactions.provider_txn_id` has a UNIQUE index. A second IPN carrying the same `vnp_TransactionNo` is detected via `ON CONFLICT DO NOTHING` (or a pre-flight SELECT) and returns `{ RspCode: '00', Message: 'Success' }` without re-publishing events.

**Rationale:** VNPay retries IPN if it does not receive `{ RspCode: '00' }` within its timeout window. Without idempotency, each retry would fire a second `PaymentConfirmedEvent`, causing a double T-02 transition in Ordering (which the `status === toStatus` idempotency guard in `TransitionOrderHandler` would silently absorb, but is still wasteful and error-prone).

---

### D-P5 — Events Published AFTER DB Commit

**Decision:** `PaymentConfirmedEvent` and `PaymentFailedEvent` are published **only after** the `payment_transactions` row is committed to PostgreSQL. Never publish inside a transaction block.

**Rationale:** Mirrors the pattern established in `TransitionOrderHandler`. If the event is published before commit and the DB write fails, the Ordering BC would advance the order state against a payment record that doesn't exist.

---

### D-P6 — Refund Is Asynchronous (Two-Phase)

**Decision:** When `OrderCancelledAfterPaymentEvent` arrives, the Payment BC immediately transitions the transaction to `refund_pending` and publishes an acknowledgement (no event to Ordering — refund is fire-and-forget from Ordering's perspective). The actual VNPay Refund API call is made asynchronously (or in the same request but non-blocking to Ordering). When VNPay confirms, status → `refunded`.

**Rationale:** VNPay Refund API calls can fail transiently (network, sandbox downtime). Separating `refund_pending` from `refunded` enables a retry cron without needing to re-process the original event. Ordering does not need to know refund completion — T-12 (`delivered → refunded`) in Ordering is a separate admin action for dispute resolution.

---

### D-P7 — No Cross-BC Foreign Keys

**Decision:** `payment_transactions.order_id` and `payment_transactions.customer_id` are plain UUID columns with no PostgreSQL `REFERENCES` constraint to the Ordering BC tables.

**Rationale:** Follows the same bounded-context isolation principle used throughout: `orders.customerId`, `orders.restaurantId`, `order_items.menuItemId` are all cross-context UUIDs without FKs. This allows the Payment context to be extracted to a separate service in the future without schema changes.

---

## 5. Module Architecture

### 5.1 Folder Structure

```
src/module/payment/
├── payment.module.ts
│
├── controllers/
│   └── vnpay.controller.ts        # HTTP surface: /payments/vnpay/*
│
├── services/
│   ├── payment.service.ts         # Domain orchestration: initiate, confirm, refund
│   └── vnpay.service.ts           # VNPay adapter: URL gen, signature, IPN parsing
│
├── commands/
│   ├── initiate-payment.command.ts
│   ├── initiate-payment.handler.ts
│   ├── process-ipn.command.ts
│   ├── process-ipn.handler.ts
│   ├── initiate-refund.command.ts
│   └── initiate-refund.handler.ts
│
├── events/
│   ├── order-placed.handler.ts                    # Consumes OrderPlacedEvent (Phase 6 stub → Phase 8 no-op for COD)
│   └── order-cancelled-after-payment.handler.ts   # Consumes OrderCancelledAfterPaymentEvent
│
├── domain/
│   ├── payment-transaction.schema.ts   # Drizzle schema for payment_transactions
│   └── payment.types.ts               # PaymentStatus enum, value object types
│
├── dto/
│   ├── vnpay-ipn.dto.ts               # Query param DTO for GET /payments/vnpay/ipn
│   ├── vnpay-return.dto.ts            # Query param DTO for GET /payments/vnpay/return
│   └── payment-status.dto.ts          # Response DTO for GET /payments/:orderId
│
└── repositories/
    └── payment-transaction.repository.ts
```

### 5.2 Module Dependencies

```typescript
@Module({
  imports: [
    CqrsModule,
    DatabaseModule,     // DB_CONNECTION token
    ConfigModule,       // VNPAY_* env vars
  ],
  controllers: [VNPayController],
  providers: [
    PaymentService,
    VNPayService,
    PaymentTransactionRepository,
    // Commands
    InitiatePaymentHandler,
    ProcessIpnHandler,
    InitiateRefundHandler,
    // Event handlers (incoming from EventBus)
    OrderPlacedHandler,
    OrderCancelledAfterPaymentHandler,
  ],
  exports: [PaymentService],  // **[UPDATED]** Also bind IPaymentInitiationPort token:
                               // { provide: PAYMENT_INITIATION_PORT, useExisting: PaymentService }
                               // This allows PlaceOrderHandler to inject the interface, not the concrete class.
})
export class PaymentModule {}
```

`PaymentModule` must be registered in `AppModule` **after** `OrderingModule`. **[UPDATED]** With the `IPaymentInitiationPort` DIP token, there is no compile-time circular dependency between modules — `OrderingModule` depends on the interface token only, which is provided by `PaymentModule` at runtime via NestJS DI:

```typescript
// app.module.ts
imports: [
  // ...
  OrderingModule,
  PaymentModule,   // ← after OrderingModule
]
```

### 5.3 Service Responsibilities

#### `VNPayService` — Pure VNPay Adapter (No Business Logic)

```
VNPayService responsibilities:
  buildPaymentUrl(params: VNPayUrlParams): string
    └─ sort + encode params
    └─ HMAC SHA512 sign
    └─ return full redirect URL

  verifyIpn(query: Record<string, string>): IpnVerificationResult
    └─ strip vnp_SecureHash from params
    └─ sort + encode remaining params
    └─ HMAC SHA512 verify
    └─ return { valid, responsePaid, amount, providerTxnId }

  verifyReturn(query: Record<string, string>): { valid: boolean; code: string }
    └─ identical signature check (no DB interaction)

  sortObject(obj: Record<string, string>): Record<string, string>
    └─ private: URL-encode keys + values, sort by encoded key, rebuild object
       (must match VNPay algorithm exactly — see §7.3)
```

#### `PaymentService` — Domain Orchestration

```
PaymentService responsibilities:
  initiateVNPayPayment(orderId, customerId, amount, ipAddr): Promise<{ txnId, paymentUrl }>
    └─ creates PaymentTransaction (status: pending)
    └─ calls VNPayService.buildPaymentUrl()
    └─ updates status → awaiting_ipn, stores paymentUrl
    └─ returns { txnId, paymentUrl }

  handleIpn(query): Promise<{ RspCode: string; Message: string }>
    └─ **[UPDATED]** delegates to `commandBus.execute(new ProcessIpnCommand(query))`
       (thin orchestration wrapper — all business logic is in ProcessIpnHandler)

  handleReturn(query): Promise<{ status: string; code: string }>
    └─ calls VNPayService.verifyReturn() — no DB writes

  initiateRefund(orderId, paidAmount): Promise<void>
    └─ finds completed transaction by orderId
    └─ transitions to refund_pending
    └─ calls VNPay Refund API
    └─ on success: transitions to refunded
    └─ on failure: leaves as refund_pending (retry cron will re-attempt)

  getPaymentStatus(orderId): Promise<PaymentStatusDto>
    └─ returns current transaction status and paymentUrl
```

---

## 6. Event Architecture

### 6.1 Incoming Events (Consumed by Payment BC)

#### `OrderPlacedEvent`

**Source:** `PlaceOrderHandler` (Ordering BC), published after DB commit.
**Payment BC handler action:**

```
if (event.paymentMethod !== 'vnpay') → log COD order, return (no-op)

if (event.paymentMethod === 'vnpay'):
  → Look up payment_transactions by orderId
  → If transaction already exists (created synchronously at checkout): no-op
    (This handler is a safety net only — synchronous initiation is the primary path)
  → If NO transaction exists (edge case: synchronous initiation failed silently):
    → call PaymentService.initiateVNPayPayment() to create it now
    → log a WARN that the primary path was skipped
```

> **Note:** Under normal operation this handler is a **no-op for VNPay orders** (transaction already created synchronously). It exists to satisfy Phase 6 stub wiring and as a safety net for race conditions.

---

#### `OrderCancelledAfterPaymentEvent`

**Source:** `TransitionOrderHandler` (Ordering BC), published when T-05 (`paid→cancelled`) or T-07 (`confirmed→cancelled`) fires for a VNPay order.
**Payment BC handler action:**

```
1. Find PaymentTransaction where orderId = event.orderId AND status = 'completed'
2. If not found: log WARN and return (cannot refund what wasn't paid)
3. Validate event.paidAmount matches transaction.amount (ε=0.01 guard)
4. Call PaymentService.initiateRefund(txn.id, event.paidAmount)
   └─ transitions status → refund_pending (immediate)
   └─ calls VNPay Refund API (async — no await on final confirmation)
5. Log refund initiation
```

---

### 6.2 Outgoing Events (Published by Payment BC)

#### `PaymentConfirmedEvent`

**Trigger:** IPN received with `vnp_ResponseCode = '00'` AND signature valid AND amount matches.
**Published by:** `ProcessIpnHandler`, after committing `status = completed` to DB.
**Consumed by:** `PaymentConfirmedEventHandler` in Ordering BC → T-02 (`pending → paid`).

```typescript
// Already defined in src/shared/events/payment-confirmed.event.ts
new PaymentConfirmedEvent(
  txn.orderId,
  txn.customerId,
  'vnpay',
  txn.amount,       // paidAmount (NUMERIC(12,2))
  new Date(),       // paidAt
)
```

---

#### `PaymentFailedEvent`

**Trigger:** IPN received with `vnp_ResponseCode ≠ '00'` OR signature invalid OR amount mismatch OR `PaymentTimeoutTask` fires.
**Published by:** `ProcessIpnHandler` or `PaymentTimeoutTask`, after committing `status = failed` to DB.
**Consumed by:** `PaymentFailedEventHandler` in Ordering BC → T-03 (`pending → cancelled`).

```typescript
// Already defined in src/shared/events/payment-failed.event.ts
new PaymentFailedEvent(
  txn.orderId,
  txn.customerId,
  'vnpay',
  reason,         // MUST be non-empty string — T-03 requires requireNote=true
  new Date(),     // failedAt
)
```

> ⚠️ **CRITICAL:** `PaymentFailedEvent.reason` MUST be a non-empty, non-whitespace string. `TransitionOrderHandler` enforces `requireNote: true` for T-03 (`pending→cancelled`). An empty `reason` causes silent auto-cancel failure — the order stays in `pending` indefinitely. See T-03 note in `PHASE_6_DOWNSTREAM_EVENTS_PROPOSAL.md`.

---

### 6.3 Full Event Flow Diagram

```
CUSTOMER                ORDERING BC             PAYMENT BC              VNPAY
   │                        │                       │                     │
   │─ POST /carts/my/checkout ─────────────────────►│                     │
   │                        │                       │                     │
   │                  PlaceOrderHandler              │                     │
   │                        │  [DB commit: order (paymentUrl=NULL)]       │                     │
   │                        │                       │                     │
   │                        │── **[FIXED]** IPaymentInitiationPort.initiateVNPayPayment() ──►│
   │                        │◄─── { txnId, paymentUrl } (in-process, same NestJS app)  ──────│
   │                        │  (PaymentService creates PaymentTransaction, builds VNPay URL) │
   │                        │                       │                     │
   │                        │  [UPDATE orders SET payment_url = :url]     │                     │
   │                        │                       │                     │
   │                        │── EventBus.publish(OrderPlacedEvent) ──────►│ (no-op for vnpay)
   │                        │                       │                     │
   │◄── { orderId, paymentUrl } ────────────────────│                     │
   │                        │                       │                     │
   │─── browser redirects to paymentUrl ────────────────────────────────►│
   │                        │                       │                     │
   │                        │           user pays on VNPay sandbox        │
   │                        │                       │                     │
   │                        │        ◄── GET /api/payments/vnpay/ipn ─────│ (server-to-server)
   │                        │                       │                     │
   │                        │              VNPayService.verifyIpn()       │
   │                        │              [sig valid, amount matches]    │
   │                        │              [DB: status → completed]       │
   │                        │                       │                     │
   │                        │◄── PaymentConfirmedEvent ──────────────────│
   │                        │                       │                     │
   │               T-02 (pending → paid)            │── { RspCode:'00' }─►│
   │                        │                       │                     │
   │                        │   [restaurant confirms later]               │
   │                        │   T-04 (paid → confirmed)                   │
   │                        │                       │                     │
   │◄── GET /api/payments/vnpay/return ─────────────────────────────────────
   │      (UI only, status display)                                       │
```

---

### 6.4 Refund Event Flow

```
ORDERING BC              PAYMENT BC              VNPAY
    │                        │                     │
T-05/T-07 fires             │                     │
(paid/confirmed →            │                     │
 cancelled, vnpay)           │                     │
    │                        │                     │
    │── OrderCancelledAfterPaymentEvent ───────────►│
    │                        │                     │
    │              find txn by orderId             │
    │              status: completed → refund_pending
    │                        │── VNPay Refund API ►│
    │                        │◄── { RspCode: '00' }│
    │              status: refund_pending → refunded
    │                        │                     │
    │   (Ordering is NOT notified of refund completion —
    │    admin uses T-12 for dispute resolution)
```

---

## 7. VNPay Integration

### 7.1 Environment Variables

```bash
VNPAY_TMN_CODE=          # VNPay Terminal Code (from merchant portal)
VNPAY_HASH_SECRET=       # Secret key for HMAC SHA512 signing
VNPAY_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
VNPAY_RETURN_URL=https://api.soli.vn/api/payments/vnpay/return
VNPAY_IPN_URL=https://api.soli.vn/api/payments/vnpay/ipn
PAYMENT_SESSION_TIMEOUT_SECONDS=1800   # 30 min default
PAYMENT_REFUND_RETRY_INTERVAL_SECONDS=300  # retry cron interval
```

### 7.2 Payment URL Generation

```typescript
// VNPayService.buildPaymentUrl()
private buildPaymentUrl(txnId: string, amount: number, ipAddr: string, locale: 'vn' | 'en'): string {
  const createDate = moment().utcOffset('+07:00').format('YYYYMMDDHHmmss');
  const expireDate = moment().add(30, 'minutes').utcOffset('+07:00').format('YYYYMMDDHHmmss');

  const params: Record<string, string> = {
    vnp_Version:    '2.1.0',
    vnp_Command:    'pay',
    vnp_TmnCode:    this.tmnCode,
    vnp_Amount:     String(Math.round(amount * 100)),   // VNPay: VND × 100
    vnp_CreateDate: createDate,
    vnp_CurrCode:   'VND',
    vnp_IpAddr:     ipAddr,
    vnp_Locale:     locale,
    vnp_OrderInfo:  `SoLi Order ${txnId}`,
    vnp_OrderType:  '250000',                           // food & beverage category code
    vnp_ReturnUrl:  this.returnUrl,
    vnp_TxnRef:     txnId,                              // PaymentTransaction.id (UUID)
    vnp_ExpireDate: expireDate,
  };

  const signed = this.sortObject(params);
  const signData = qs.stringify(signed, { encode: false });
  const hmac = crypto.createHmac('sha512', this.hashSecret);
  signed.vnp_SecureHash = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

  return this.vnpUrl + '?' + qs.stringify(signed, { encode: false });
}
```

### 7.3 `sortObject()` — VNPay-Specific Algorithm

This method is **critical** for signature correctness. VNPay's verification algorithm sorts on the **URL-encoded representation** of keys, not raw keys. The implementation must match exactly:

```typescript
private sortObject(obj: Record<string, string>): Record<string, string> {
  // Step 1: URL-encode both keys and values
  const encoded: Array<[string, string]> = Object.entries(obj).map(
    ([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)]
  );

  // Step 2: Sort by URL-encoded key (lexicographic)
  encoded.sort(([a], [b]) => a.localeCompare(b));

  // Step 3: Build result object from sorted entries
  return Object.fromEntries(encoded);
}
```

> **Why encode-first, sort-second?** Keys containing `%2B`, `%20`, etc. sort differently than their raw counterparts. Sorting raw keys can produce a different order than VNPay's own verification algorithm, causing signature mismatch. This is a common integration bug.

### 7.4 IPN Signature Validation

```typescript
// VNPayService.verifyIpn()
verifyIpn(query: Record<string, string>): IpnVerificationResult {
  const { vnp_SecureHash, vnp_SecureHashType, ...params } = query; // **[FIXED]** strip both hash fields before signing

  if (!vnp_SecureHash) {
    return { valid: false, responsePaid: false, amount: 0, providerTxnId: '' };
  }

  // Reconstruct the signed string (same sortObject → qs.stringify pipeline)
  const sorted = this.sortObject(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  );
  const signData = qs.stringify(sorted, { encode: false });

  const expected = crypto
    .createHmac('sha512', this.hashSecret)
    .update(Buffer.from(signData, 'utf-8'))
    .digest('hex');

  const valid = crypto.timingSafeEqual(
    Buffer.from(vnp_SecureHash.toLowerCase()),
    Buffer.from(expected.toLowerCase()),
  );

  return {
    valid,
    responsePaid: query.vnp_ResponseCode === '00',
    amount: parseInt(query.vnp_Amount ?? '0', 10) / 100,  // convert back from VND×100
    providerTxnId: query.vnp_TransactionNo ?? '',
  };
}
```

> **`crypto.timingSafeEqual`** prevents timing attacks on the HMAC comparison. Never use `===` for signature comparison.

### 7.5 IPN Handler — Authoritative Payment Confirmation

```
ProcessIpnHandler.execute(cmd: ProcessIpnCommand):

1. Call VNPayService.verifyIpn(cmd.query)
   └─ if !valid → return { RspCode: '97', Message: 'Invalid signature' }
      (do NOT update DB — potential attack)

2. Look up PaymentTransaction by id = query.vnp_TxnRef
   └─ if not found → return { RspCode: '01', Message: 'Order not found' }

3. Idempotency check: if transaction.providerTxnId === query.vnp_TransactionNo
   └─ already processed → return { RspCode: '00', Message: 'Success' }

4. Status guard: transaction must be in 'awaiting_ipn'
   └─ if status ∈ {completed, failed} → return { RspCode: '02', Message: 'Already confirmed' }
   └─ if status ∈ {pending} → return { RspCode: '01', Message: 'Order not ready' }

5. Amount validation: |ipnAmount - transaction.amount| <= 0.01
   └─ if mismatch → DB: status = failed, vnpResponseCode = '04'
                 → publish PaymentFailedEvent(orderId, 'Amount mismatch')
                 → return { RspCode: '04', Message: 'Invalid amount' }

6. DB TRANSACTION:
   if responsePaid:
     └─ UPDATE payment_transactions SET
          status = 'completed',
          provider_txn_id = vnp_TransactionNo,   ← UNIQUE — prevents double-IPN
          vnp_response_code = vnp_ResponseCode,
          raw_ipn_payload = query (JSONB),
          ipn_received_at = NOW(),
          paid_at = NOW(),
          version = version + 1
   else:
     └─ UPDATE payment_transactions SET
          status = 'failed',
          provider_txn_id = vnp_TransactionNo,
          vnp_response_code = vnp_ResponseCode,
          raw_ipn_payload = query (JSONB),
          ipn_received_at = NOW(),
          version = version + 1

7. AFTER DB commit — publish event:
   if responsePaid → EventBus.publish(new PaymentConfirmedEvent(...))
   else            → EventBus.publish(new PaymentFailedEvent(..., reason))

8. return { RspCode: '00', Message: 'Success' }
   (VNPay always receives '00' even for failed payments — it only expects to know
    if the IPN itself was received and processed correctly, not whether payment passed)
```

> **⚠️ IPN Response Contract:** VNPay only retries the IPN when it receives a non-`'00'` `RspCode`. Return `'00'` for all cases where the IPN was successfully received and processed (including payment failures). Only return non-`'00'` when the IPN could NOT be processed (invalid signature, unknown txnRef).

### 7.6 Return URL Handler

The return URL is for browser display only. It validates the signature identically to IPN but **writes no DB state**:

```typescript
// GET /api/payments/vnpay/return
handleReturn(query: VNPayReturnDto): { status: string; code: string } {
  const result = this.vnpayService.verifyReturn(query);
  return {
    status: result.valid ? (query.vnp_ResponseCode === '00' ? 'success' : 'failed') : 'invalid',
    code: query.vnp_ResponseCode ?? 'unknown',
  };
}
```

---

## 8. State Machine

### 8.1 PaymentTransaction State Diagram

```
                         ┌─────────────────────┐
                         │       pending        │
                         │  (txn created, no    │
                         │   URL yet)           │
                         └────────┬─────────────┘
                                  │
                  PaymentService.initiateVNPayPayment()
                  URL generated → status = awaiting_ipn
                                  │
                         ┌────────▼─────────────┐
                         │    awaiting_ipn       │
                         │  (URL generated,      │
                         │   customer redirected │
                         │   to VNPay)           │
                         └──────┬───────┬────────┘
                                │       │
               vnp_ResponseCode='00'   vnp_ResponseCode ≠ '00'
               + valid sig              OR invalid sig
               + amount match          OR amount mismatch
               (IPN received)          (IPN received / cron timeout)
                                │       │
                    ┌───────────▼┐     ┌▼────────────────┐
                    │ completed  │     │     failed       │
                    │ (payment   │     │  (payment failed │
                    │  confirmed)│     │   or expired)    │
                    └───────┬────┘     └─────────────────-┘
                            │
          OrderCancelledAfterPaymentEvent
          (T-05 or T-07 in Ordering BC)
                            │
                 ┌──────────▼───────────┐
                 │   refund_pending     │
                 │  (awaiting VNPay     │
                 │   Refund API result) │
                 └──────────┬───────────┘
                            │
                VNPay Refund API → RspCode='00'
                            │
                 ┌──────────▼───────────┐
                 │      refunded        │
                 │   (refund confirmed) │
                 └──────────────────────┘

Additional transition:
  pending ─── PaymentTimeoutTask (cron, expires_at exceeded) ──► failed
```

> **Note on `pending → failed`:** If `PaymentService.initiateVNPayPayment()` successfully creates the `PaymentTransaction` but the VNPay URL generation call fails (network error, VNPay unavailable), the transaction stays `pending`. The `PaymentTimeoutTask` cron transitions it to `failed` when `expires_at` is exceeded, publishing `PaymentFailedEvent` so Ordering auto-cancels the order.

### 8.2 Mapping to Ordering Transitions

| PaymentTransaction Event | Ordering Transition | Result |
|---|---|---|
| `status → completed` | T-02: `pending → paid` | VNPay payment accepted by Ordering |
| `status → failed` (IPN) | T-03: `pending → cancelled` | Ordering cancels unpaid VNPay order |
| `status → failed` (timeout) | T-03: `pending → cancelled` | Ordering cancels expired order |
| Refund initiated | (none) | Ordering already in `cancelled` state |

---

## 9. Database Design

### 9.1 `payment_transactions` Table

```sql
CREATE TABLE payment_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cross-context references (no FK constraints — D-P7)
  order_id            UUID        NOT NULL,
  customer_id         UUID        NOT NULL,

  -- Financial amount (same moneyColumn pattern as Ordering BC)
  amount              NUMERIC(12, 2)  NOT NULL,

  -- Lifecycle status
  status              payment_status  NOT NULL DEFAULT 'pending',

  -- VNPay URL (stored for client recovery via GET /payments/:orderId)
  payment_url         TEXT,

  -- VNPay-provided identifiers (set by IPN)
  provider_txn_id     TEXT UNIQUE,    -- vnp_TransactionNo; UNIQUE prevents double-processing
  vnp_response_code   TEXT,           -- raw response code from IPN (for audit)
  raw_ipn_payload     JSONB,          -- full IPN query params (audit trail)

  -- Timestamps
  ipn_received_at     TIMESTAMPTZ,
  paid_at             TIMESTAMPTZ,
  refund_initiated_at TIMESTAMPTZ,
  refunded_at         TIMESTAMPTZ,
  refund_retry_count  INTEGER DEFAULT NULL,   -- [ADDED] incremented by PaymentRefundRetryTask; NULL until first retry attempt; alert ops when > threshold

  expires_at          TIMESTAMPTZ NOT NULL,   -- created_at + PAYMENT_SESSION_TIMEOUT_SECONDS

  -- Optimistic locking (same pattern as orders.version)
  version             INTEGER NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE payment_status AS ENUM (
  'pending',
  'awaiting_ipn',
  'completed',
  'failed',
  'refund_pending',
  'refunded'
);

-- Lookup by orderId (most common query path)
CREATE INDEX idx_payment_transactions_order_id   ON payment_transactions (order_id);
-- Lookup by customerId (for GET /payments/my)
CREATE INDEX idx_payment_transactions_customer_id ON payment_transactions (customer_id);
-- Timeout cron query
CREATE INDEX idx_payment_transactions_expires_at
  ON payment_transactions (expires_at)
  WHERE status IN ('pending', 'awaiting_ipn');
```

### 9.2 Drizzle Schema (TypeScript)

```typescript
// src/module/payment/domain/payment-transaction.schema.ts

import {
  pgTable, pgEnum, uuid, text, integer,
  timestamp, jsonb, unique, customType, index
} from 'drizzle-orm/pg-core';

// Reuse moneyColumn pattern from Ordering BC
const moneyColumn = customType<{ data: number; driverData: string }>({
  dataType() { return 'numeric(12, 2)'; },
  fromDriver(value) { return parseFloat(value as string); },
  toDriver(value) { return String(value); },
});

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'awaiting_ipn',
  'completed',
  'failed',
  'refund_pending',
  'refunded',
]);

export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id:                 uuid('id').defaultRandom().primaryKey(),
    orderId:            uuid('order_id').notNull(),
    customerId:         uuid('customer_id').notNull(),
    amount:             moneyColumn('amount').notNull(),
    status:             paymentStatusEnum('status').notNull().default('pending'),
    paymentUrl:         text('payment_url'),
    providerTxnId:      text('provider_txn_id'),    // unique — see indexes below
    vnpResponseCode:    text('vnp_response_code'),
    rawIpnPayload:      jsonb('raw_ipn_payload').$type<Record<string, string>>(),
    ipnReceivedAt:      timestamp('ipn_received_at', { withTimezone: true }),
    paidAt:             timestamp('paid_at', { withTimezone: true }),
    refundInitiatedAt:  timestamp('refund_initiated_at', { withTimezone: true }),
    refundedAt:         timestamp('refunded_at', { withTimezone: true }),
    refundRetryCount:   integer('refund_retry_count'),   // [ADDED] nullable; incremented by PaymentRefundRetryTask
    expiresAt:          timestamp('expires_at', { withTimezone: true }).notNull(),
    version:            integer('version').notNull().default(0),
    createdAt:          timestamp('created_at').defaultNow().notNull(),
    updatedAt:          timestamp('updated_at').defaultNow().notNull()
                          .$onUpdateFn(() => new Date()),
  },
  (t) => [
    unique('payment_transactions_provider_txn_id_unique').on(t.providerTxnId),
    index('idx_ptxn_order_id').on(t.orderId),
    index('idx_ptxn_customer_id').on(t.customerId),
    index('idx_ptxn_expires_at').on(t.expiresAt),
  ],
);

export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type NewPaymentTransaction = typeof paymentTransactions.$inferInsert;
```

### 9.3 Schema Registration

```typescript
// src/drizzle/schema.ts — add:
export * from '../module/payment/domain/payment-transaction.schema';
```

---

## 10. API Design

### 10.1 Endpoint Summary

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/payments/vnpay/ipn` | `@AllowAnonymous` (VNPay server) | IPN callback — authoritative payment result |
| `GET` | `/api/payments/vnpay/return` | `@AllowAnonymous` (browser) | Return URL — UI display only, no DB write |
| `GET` | `/api/payments/:orderId` | `@Session` (customer/admin) | Fetch payment status and URL for an order |

> **Why GET for IPN?** VNPay's IPN mechanism uses GET requests with all data in query parameters. This is a VNPay protocol constraint, not a design choice.

### 10.2 `GET /api/payments/vnpay/ipn`

```typescript
@Get('vnpay/ipn')
@AllowAnonymous()
@HttpCode(HttpStatus.OK)
async handleIpn(@Query() query: VNPayIpnDto): Promise<{ RspCode: string; Message: string }> {
  return this.paymentService.handleIpn(query);
}
```

**Response:** Always HTTP 200. Body contains VNPay-protocol `{ RspCode, Message }`:

| RspCode | Message | Meaning |
|---------|---------|---------|
| `'00'` | `'Success'` | IPN received and processed (payment succeeded OR failed — VNPay doesn't distinguish) |
| `'97'` | `'Invalid signature'` | HMAC mismatch — potential attack or misconfiguration |
| `'01'` | `'Order not found'` | `vnp_TxnRef` not in `payment_transactions` |
| `'02'` | `'Already confirmed'` | Duplicate IPN for already-processed transaction |
| `'04'` | `'Invalid amount'` | Amount in IPN does not match `payment_transactions.amount` |

---

### 10.3 `GET /api/payments/vnpay/return`

```typescript
@Get('vnpay/return')
@AllowAnonymous()
@HttpCode(HttpStatus.OK)
async handleReturn(@Query() query: VNPayReturnDto): Promise<{ status: string; code: string }> {
  return this.paymentService.handleReturn(query);
}
```

**Response:**

```json
// Success
{ "status": "success", "code": "00" }

// User cancelled on VNPay
{ "status": "failed", "code": "24" }

// Invalid signature (tampered return URL)
{ "status": "invalid", "code": "unknown" }
```

The mobile/web client reads `status` and navigates to the appropriate screen. The client must poll `GET /api/payments/:orderId` (or listen via WebSocket) for the actual order state change — the return URL is NOT authoritative.

---

### 10.4 `GET /api/payments/:orderId`

```typescript
@Get(':orderId')
@ApiBearerAuth()
@HttpCode(HttpStatus.OK)
async getPaymentStatus(
  @Param('orderId', ParseUUIDPipe) orderId: string,
  @Session() session: UserSession,
): Promise<PaymentStatusDto> {
  // Ownership: customer can only see their own order's payment; admin unrestricted
  return this.paymentService.getPaymentStatus(orderId, session.user.id, session.user.role);
}
```

**Response `PaymentStatusDto`:**

```typescript
interface PaymentStatusDto {
  orderId: string;
  transactionId: string;
  status: PaymentStatus;
  paymentUrl: string | null;   // client can retry redirect if status = awaiting_ipn
  paidAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
}
```

---

### 10.5 VNPay IPN DTO

```typescript
// dto/vnpay-ipn.dto.ts
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class VNPayIpnDto {
  @IsString() @IsNotEmpty() vnp_TxnRef!: string;
  @IsString() @IsNotEmpty() vnp_Amount!: string;
  @IsString() @IsNotEmpty() vnp_ResponseCode!: string;
  @IsString() @IsNotEmpty() vnp_TransactionNo!: string;
  @IsString() @IsNotEmpty() vnp_SecureHash!: string;
  @IsString() @IsNotEmpty() vnp_PayDate!: string;
  // **[FIXED]** Removed index signature `[key: string]: string` — it is incompatible
  // with class-validator decorators (TypeScript strict mode rejects it).
  // VNPay sends additional params (e.g. vnp_SecureHashType, vnp_BankCode) that are
  // NOT declared here. To pass the full raw query to VNPayService.verifyIpn(), the
  // controller should use @Req() and extract req.query directly, passing it as
  // Record<string,string> alongside the typed DTO:
  //
  //   async handleIpn(
  //     @Query() dto: VNPayIpnDto,
  //     @Req() req: FastifyRequest,
  //   ): Promise<...> {
  //     const rawQuery = req.query as Record<string, string>;
  //     return this.paymentService.handleIpn(rawQuery);   // full params to verifyIpn
  //   }
  //
  // The DTO validates presence of critical fields; verifyIpn() operates on rawQuery.
}
```

---

## 11. Edge Cases

### 11.1 Duplicate IPN (VNPay Retry)

**Scenario:** VNPay retries the IPN because the first delivery timed out on their end (but the server received and processed it).

**Handling:**
1. First IPN: `providerTxnId` is null → write `vnp_TransactionNo` to `provider_txn_id` (UNIQUE column).
2. Second IPN: `INSERT` or `UPDATE` attempt hits UNIQUE constraint → detected as duplicate.
3. Return `{ RspCode: '00', Message: 'Success' }` without re-publishing events.

**Guard code path:**
```typescript
const existing = await repo.findByProviderTxnId(query.vnp_TransactionNo);
if (existing) return { RspCode: '00', Message: 'Success' };
```

---

### 11.2 IPN Received for Already-Cancelled Order (Timeout Race)

**Scenario:** `OrderTimeoutTask` auto-cancels a `pending` order (T-03) at `expires_at`. Then VNPay sends a success IPN (customer paid but order was already cancelled server-side).

**Handling:**
1. `TransitionOrderHandler` T-02 (`pending → paid`) will be dispatched by `PaymentConfirmedEventHandler`.
2. But order is already `cancelled` → `TransitionOrderHandler` throws `UnprocessableEntityException` (invalid transition).
3. **[FIXED]** `PaymentConfirmedEventHandler` catches the error and must perform compensation — **do NOT silently discard**:

```typescript
// In PaymentConfirmedEventHandler.handle() — UPDATED catch block:
} catch (err) {
  // Check whether the failure is due to the order being already cancelled
  // (timeout race: OrderTimeoutTask fired before the IPN arrived).
  const currentOrder = await this.orderRepo.findById(orderId);
  if (
    currentOrder &&
    currentOrder.status === 'cancelled' &&
    currentOrder.paymentMethod === 'vnpay'
  ) {
    // The customer's money was captured but the order was auto-cancelled.
    // Trigger an automatic refund by re-publishing OrderCancelledAfterPaymentEvent.
    this.logger.warn(
      `Race condition: PaymentConfirmedEvent for order ${orderId} but order ` +
        `is already cancelled. Publishing OrderCancelledAfterPaymentEvent for auto-refund.`,
    );
    this.eventBus.publish(
      new OrderCancelledAfterPaymentEvent(
        orderId,
        currentOrder.customerId,
        'vnpay',
        currentOrder.totalAmount,   // paidAmount = order.totalAmount (confirmed by IPN epsilon check above)
        new Date(),
        'system',                   // system-initiated refund due to race
      ),
    );
  } else {
    this.logger.error(
      `T-02 transition failed for order ${orderId} (PaymentConfirmedEvent): ` +
        `${(err as Error).message}`,
      (err as Error).stack,
    );
  }
}
```

> **[FIXED] Why NOT `await delay(500)` ?** A fixed delay in an IPN request handler is fragile and wrong: (a) it holds the HTTP response to VNPay for 500 ms, risking a retry from VNPay; (b) NestJS CQRS `EventBus.publish()` is fire-and-forget — the T-02 handler runs asynchronously and may not complete in 500 ms under load; (c) it does not work across multiple pods. The correct fix is compensation in `PaymentConfirmedEventHandler` itself: when T-02 fails due to an already-cancelled order, the handler detects the race and synthetically re-publishes `OrderCancelledAfterPaymentEvent`, which the Payment BC then processes as a normal refund. `ProcessIpnHandler` returns `{ RspCode: '00' }` to VNPay immediately — no delay needed.

---

### 11.3 Amount Mismatch in IPN

**Scenario:** IPN contains `vnp_Amount` that does not match `payment_transactions.amount × 100`.

**Handling:**
1. `verifyIpn()` returns `{ valid: true, responsePaid: true, amount: X }` where `X ≠ txn.amount`.
2. `ProcessIpnHandler` detects mismatch: `Math.abs(ipnAmount - txn.amount) > 0.01`.
3. DB: `status = failed`, `vnp_response_code = '04'`.
4. Publish `PaymentFailedEvent` with reason `'Amount mismatch: expected ${txn.amount}, received ${ipnAmount}'`.
5. Return `{ RspCode: '04', Message: 'Invalid amount' }` to VNPay.
6. Log at ERROR level — this should trigger an alert. It indicates either data corruption or a VNPay integration bug.

---

### 11.4 Invalid Signature in IPN

**Scenario:** `vnp_SecureHash` does not match the recomputed HMAC.

**Handling:**
1. `verifyIpn()` returns `{ valid: false }`.
2. **Do not write to DB** — the IPN may be a spoofed attack.
3. Return `{ RspCode: '97', Message: 'Invalid signature' }`.
4. Log at WARN level with the source IP address for security auditing.

---

### 11.5 Expired Payment Session

**Scenario:** Customer received the payment URL but never completed the payment within the 30-minute window.

**Handling:** `PaymentTimeoutTask` (cron, every minute):
```typescript
@Cron(CronExpression.EVERY_MINUTE)
async handleExpiredPayments(): Promise<void> {
  // Find all transactions in ('pending', 'awaiting_ipn') past their expires_at
  const expired = await repo.findExpired();
  for (const txn of expired) {
    await repo.updateStatus(txn.id, 'failed', { version: txn.version });
    await eventBus.publish(new PaymentFailedEvent(
      txn.orderId, txn.customerId, 'vnpay',
      'Payment session expired — no IPN received within timeout',
      new Date(),
    ));
  }
}
```

> **Multi-pod safety:** Two cron instances running simultaneously will race on the `version` optimistic lock. The second update will fail (version mismatch) → log and skip. The event is only published once.

---

### 11.6 VNPay Refund API Failure

**Scenario:** VNPay Refund API returns an error (transient network issue, sandbox downtime).

**Handling:**
1. `status` remains `refund_pending`.
2. `PaymentRefundRetryTask` cron (every 5 minutes) retries all `refund_pending` transactions older than 1 minute.
3. Maximum retry attempts tracked via a `refund_retry_count` column (nullable integer, default null).
4. After N retries (configurable, e.g., 10), raise an alert to the operations team. Do NOT auto-transition to a terminal error state — manual intervention is required.

---

### 11.7 Customer Re-opens Payment URL After Expiry

**Scenario:** Customer bookmarks the payment URL and opens it after `expires_at`. VNPay rejects the expired URL and may not send an IPN.

**Handling:**
- `GET /api/payments/:orderId` returns `{ status: 'failed', paymentUrl: null }`.
- The client shows an error screen: "This payment session has expired. Please place a new order."
- The order is already `cancelled` in Ordering (via `PaymentTimeoutTask`).
- No DB action needed — the client can start a fresh cart.

---

### 11.8 Multiple Payment Attempts for the Same Order

**Scenario:** A customer completes checkout (VNPay), abandons the payment page, and the first `PaymentTransaction` expires. Can the customer retry?

**Current design:** No. The cart was deleted at checkout (Phase 4). The order is auto-cancelled by `OrderTimeoutTask` / `PaymentTimeoutTask`. The customer must place a new order (new cart).

**Future enhancement:** Allow re-payment for `pending` (not yet expired) VNPay orders — expose a `POST /api/payments/:orderId/retry` endpoint that creates a new `PaymentTransaction` for the same order.

---

## 12. Security

### 12.1 Signature Validation (OWASP: Broken Access Control)

- Every IPN call MUST pass HMAC SHA512 validation before any DB mutation.
- Use `crypto.timingSafeEqual` for signature comparison — never `===` or `indexOf`.
- The `VNPAY_HASH_SECRET` MUST be stored in environment variables, never committed to source control.
- Rotate `VNPAY_HASH_SECRET` via VNPay merchant portal if exposed.

### 12.2 Replay Protection (OWASP: Cryptographic Failures)

- `UNIQUE(provider_txn_id)` (= `vnp_TransactionNo`) prevents replay of the same IPN.
- After processing, the IPN parameters are stored in `raw_ipn_payload` (JSONB) for forensic audit.
- `expires_at` on `PaymentTransaction` prevents processing IPN calls for sessions that were cancelled server-side.

### 12.3 Idempotency (OWASP: Insecure Design)

- `UNIQUE(provider_txn_id)` in DB is the hard guard.
- Soft guard: pre-flight SELECT by `providerTxnId` before the DB write.
- Both guards are needed: the pre-flight catches concurrent duplicate IPNs without relying on exception handling; the UNIQUE constraint is the safety net if the pre-flight SELECT races.

### 12.4 Amount Tamper Prevention (OWASP: Security Misconfiguration)

- `payment_transactions.amount` is set at checkout time from `order.totalAmount` — **never** from client input.
- `vnp_Amount` in the IPN is validated against this server-side stored amount.
- The VNPay signing includes `vnp_Amount`, so a tampered amount produces a signature mismatch (caught by step 1).

### 12.5 IPN Endpoint Authorization

- `GET /api/payments/vnpay/ipn` is decorated `@AllowAnonymous` because VNPay does not send bearer tokens.
- Protection is entirely via HMAC signature, not HTTP auth.
- The endpoint MUST be excluded from global `AuthGuard` but MUST NOT be excluded from `ValidationPipe`.
- Log the source IP of every IPN call. Consider IP allowlisting for VNPay sandbox/production IP ranges in production.

### 12.6 `vnp_TxnRef` Input Validation

- `vnp_TxnRef` is the `PaymentTransaction.id` (UUID format).
- Apply `ParseUUIDPipe`-equivalent validation: if `vnp_TxnRef` is not a valid UUID, return `{ RspCode: '01', Message: 'Order not found' }` without querying the DB (prevents SQL injection through malformed UUIDs).

### 12.7 Raw IPN Payload Storage (JSONB)

- `raw_ipn_payload` stores the full, unmodified IPN query params.
- This data is for audit/forensic use only — it is NEVER rendered back to clients.
- Do NOT log `VNPAY_HASH_SECRET` alongside the payload.

---

## 13. Migration Strategy

### 13.1 Design for Future Microservice Extraction

The Payment Context is designed so it can be extracted to a standalone microservice with minimal changes:

| Design Decision | How It Enables Extraction |
|---|---|
| D-P7: No cross-BC FK constraints | Payment DB can be moved to a separate PostgreSQL instance |
| Event-driven result reporting | Replace `EventBus.publish()` with `KafkaProducer.produce()` — same interface |
| Event-driven consumption | Replace `@EventsHandler` with `KafkaConsumer` — same handler logic |
| No direct service imports in Ordering (except `PaymentService.initiateVNPayPayment`) | Replace with HTTP/gRPC call in extraction phase |
| `PAYMENT_SESSION_TIMEOUT_SECONDS` in env config | Microservice can have its own config |

### 13.2 Extraction Steps

**Phase 1 (Current):** Modular monolith — `PaymentModule` in same NestJS app, same DB, in-process `EventBus`.

**Phase 2 (Near-term):** Message broker introduction:
1. Add Kafka/RabbitMQ as the EventBus transport layer (NestJS supports this via `@nestjs/microservices`).
2. `OrderPlacedEvent`, `OrderCancelledAfterPaymentEvent` published to topic `ordering.events`.
3. `PaymentConfirmedEvent`, `PaymentFailedEvent` published to topic `payment.events`.
4. Both modules remain in the same process but consume via broker (enables observability and replay).

**Phase 3 (Long-term):** Full microservice:
1. Extract `PaymentModule` to `apps/payment-service`.
2. Replace `PaymentService.initiateVNPayPayment()` direct call (from `PlaceOrderHandler`) with HTTP POST to `payment-service/internal/payments`.
3. Replace in-process event handlers with Kafka consumers.
4. Migrate `payment_transactions` table to a dedicated PostgreSQL database.

### 13.3 Coupling Points to Resolve Before Extraction

| Coupling | File | Resolution |
|----------|------|------------|
| `PlaceOrderHandler` injects `IPaymentInitiationPort` (DIP token) **[UPDATED]** — concrete `PaymentService` is the impl | `place-order.handler.ts`, `src/shared/ports/payment-initiation.port.ts` | Replace `PaymentService` with HTTP/gRPC adapter that satisfies the same interface |
| Shared `src/shared/events/*.ts` event classes | Both modules import from same path | Extract to `@soli/shared-events` npm package or proto definitions |
| Single PostgreSQL database | `drizzle.constants.ts` `DB_CONNECTION` | Migrate payment tables to separate DB |

---

## 14. Implementation Phases

### Phase 8.0 — Domain & DB Foundation

**Goal:** `payment_transactions` table exists and can be read/written. No business logic yet.

Steps:
1. Create `src/module/payment/domain/payment-transaction.schema.ts` (Drizzle schema).
2. Export from `src/drizzle/schema.ts`.
3. Run `drizzle-kit generate` to produce migration file.
4. Apply migration (`drizzle-kit migrate` or `db:push`).
5. Create `PaymentTransactionRepository` with `findById`, `findByOrderId`, `findExpired`, `create`, `updateStatus`.
6. Write unit tests for repository.

**Done criteria:** `payment_transactions` table exists in DB with all columns and indexes.

---

### Phase 8.1 — VNPay Service (URL Generation + Signature)

**Goal:** `VNPayService` can generate valid payment URLs and verify signatures.

Steps:
1. Create `src/module/payment/services/vnpay.service.ts`.
2. Implement `sortObject()`, `buildPaymentUrl()`, `verifyIpn()`, `verifyReturn()`.
3. Add `crypto.timingSafeEqual` comparison in all signature checks.
4. Write unit tests:
   - `sortObject()` matches known VNPay test vectors.
   - `buildPaymentUrl()` produces a URL that passes `verifyIpn()` (round-trip test).
   - `verifyIpn()` rejects tampered amounts.
   - `verifyIpn()` rejects tampered signatures.

**Done criteria:** All VNPay unit tests pass. URLs generated in test match VNPay sandbox expectations.

---

### Phase 8.2 — PaymentService Orchestration **[UPDATED]**

**Goal:** `PaymentService.initiateVNPayPayment()` creates a `PaymentTransaction` and returns a valid paymentUrl. `PlaceOrderHandler` calls it via the DIP interface token.

Steps:
1. Create `src/shared/ports/payment-initiation.port.ts` — export `IPaymentInitiationPort` interface + `PAYMENT_INITIATION_PORT` symbol.
2. Create `src/module/payment/services/payment.service.ts` implementing `IPaymentInitiationPort`.
3. In `PaymentModule.providers`, add `{ provide: PAYMENT_INITIATION_PORT, useExisting: PaymentService }`.
4. **[UPDATED]** Wire into `PlaceOrderHandler` (Ordering BC) — inject `@Inject(PAYMENT_INITIATION_PORT) private readonly paymentPort: IPaymentInitiationPort`. Do NOT import `PaymentService` directly.
5. **[UPDATED]** Two-phase write in `PlaceOrderHandler.executeWithLock()`, after `persistOrderAtomically()`:
   ```typescript
   if (paymentMethod === 'vnpay') {
     const { paymentUrl } = await this.paymentPort.initiateVNPayPayment(
       order.id, customerId, order.totalAmount, ipAddr,
     );
     // Second DB write — not atomic with order insert (D-P2 known gap)
     await this.db.update(orders).set({ paymentUrl }).where(eq(orders.id, order.id));
     order = { ...order, paymentUrl };
   }
   ```
6. Write integration test: checkout a VNPay order → `orders.payment_url` is not null.

**Done criteria:** Checkout with `paymentMethod: 'vnpay'` returns an `order` with a valid VNPay redirect URL in `paymentUrl`. `PlaceOrderHandler` imports only the interface token — no direct `PaymentService` import.

---

### Phase 8.3 — IPN Handler

**Goal:** `GET /api/payments/vnpay/ipn` processes a valid IPN and fires `PaymentConfirmedEvent`.

Steps:
1. Create `VNPayController` with `GET /payments/vnpay/ipn` and `GET /payments/vnpay/return`.
2. Implement `ProcessIpnHandler` command handler with all 8 IPN processing steps (§7.5).
3. Implement idempotency: pre-flight check on `providerTxnId`.
4. Implement amount validation.
5. Implement event publishing: `PaymentConfirmedEvent` or `PaymentFailedEvent`.
6. Create `PaymentModule` and register in `AppModule` after `OrderingModule`.
7. **[ADDED]** In `AppModule`, also provide `PAYMENT_INITIATION_PORT` globally or ensure `PaymentModule` is imported by `OrderingModule`'s `forwardRef` — OR simply confirm that NestJS resolves `PAYMENT_INITIATION_PORT` at runtime (no forward ref needed if `AppModule` imports both in order).
8. Write E2E tests:
   - Simulate valid IPN → order transitions to `paid` (T-02 fires).
   - Simulate failed IPN → order transitions to `cancelled` (T-03 fires).
   - Simulate duplicate IPN → event fires only once.
   - Simulate tampered signature → `RspCode: '97'`.
   - Simulate amount mismatch → `RspCode: '04'` + order cancelled.

**Done criteria:** E2E tests pass. `PaymentConfirmedEvent` triggers T-02 in Ordering. `PaymentFailedEvent` triggers T-03 in Ordering.

---

### Phase 8.4 — Return URL Handler

**Goal:** `GET /api/payments/vnpay/return` validates signature and returns UI display data.

Steps:
1. Add `handleReturn()` to `VNPayController`.
2. Implement `PaymentService.handleReturn()`.
3. Write unit test: valid signature → `{ status: 'success', code: '00' }`.
4. Write unit test: tampered query → `{ status: 'invalid', code: 'unknown' }`.

**Done criteria:** Return URL handler responds correctly without touching DB.

---

### Phase 8.5 — Timeout Cron

**Goal:** Expired payment sessions are auto-failed and Ordering is notified.

Steps:
1. Create `src/module/payment/tasks/payment-timeout.task.ts`.
2. `@Cron(CronExpression.EVERY_MINUTE)` — query `findExpired()`, call `updateStatus(txn.id, 'failed')`, publish `PaymentFailedEvent`.
3. Add optimistic locking check to prevent multi-pod double-processing.
4. Write integration test: create a `PaymentTransaction` with `expiresAt = past`, run cron → order is cancelled.

**Done criteria:** Expired transactions auto-fail. `PaymentFailedEvent` is published with non-empty reason string.

---

### Phase 8.6 — Refund Flow

**Goal:** `OrderCancelledAfterPaymentEvent` triggers VNPay refund initiation.

Steps:
1. Create `OrderCancelledAfterPaymentHandler` event handler.
2. Find `completed` transaction for the order, transition to `refund_pending`.
3. Call VNPay Refund API (stub in unit test — mock HTTP).
4. On success: `refund_pending → refunded`.
5. Create `PaymentRefundRetryTask` cron for failed refund retries.
6. Write integration tests:
   - Cancel a paid VNPay order → `refund_pending` status.
   - Simulate VNPay Refund API returning `00` → `refunded` status.
   - Simulate VNPay Refund API failure → status stays `refund_pending` for retry.

**Done criteria:** Refund flow works end-to-end. Retry cron handles transient failures.

---

### Phase 8.7 — Payment Status Query

**Goal:** `GET /api/payments/:orderId` returns current payment state.

Steps:
1. Add `GET /payments/:orderId` to `VNPayController`.
2. Implement `PaymentService.getPaymentStatus()` with ownership check.
3. Write E2E test: customer queries their own order → gets `PaymentStatusDto`. Admin queries any order. Customer cannot query another customer's order (403).

**Done criteria:** Ownership-gated query endpoint works.

---

### Phase 8.8 — E2E Test Suite

**Goal:** Full payment flow E2E tests integrated into `spec-e2e.e2e-spec.ts` (or a new `payment.e2e-spec.ts`).

Test scenarios to cover:
| ID | Scenario | Expected |
|----|----------|----------|
| P-01 | Checkout with `paymentMethod: 'vnpay'` → `order.paymentUrl` is not null | 201 with paymentUrl |
| P-02 | Valid IPN with `vnp_ResponseCode='00'` → order status = `paid` | T-02 fired |
| P-03 | Valid IPN with `vnp_ResponseCode='24'` (cancelled) → order status = `cancelled` | T-03 fired |
| P-04 | IPN with invalid signature → `RspCode: '97'`, no DB change | Signature rejected |
| P-05 | IPN with amount mismatch → `RspCode: '04'`, order cancelled | T-03 fired |
| P-06 | Duplicate IPN (same `vnp_TransactionNo`) → second fire is no-op | Event fires once |
| P-07 | Expired transaction (mock `expiresAt = past`) → cron cancels | T-03 fired |
| P-08 | Cancel a paid VNPay order (T-05) → `refund_pending` transition | refund initiated |
| P-09 | Return URL with valid signature → `{ status: 'success' }` | UI display |
| P-10 | Return URL with tampered params → `{ status: 'invalid' }` | Rejected cleanly |
| P-11 | `GET /api/payments/:orderId` by owner → 200 with status | Own order |
| P-12 | `GET /api/payments/:orderId` by other customer → 403 | Ownership enforced |

---

## Self-Validation Checklist

Before implementation, validate this proposal against:

- [x] **Event flow correctness:** `PaymentConfirmedEvent` triggers T-02 (`pending→paid`). `PaymentFailedEvent` triggers T-03 (`pending→cancelled`) with non-empty reason (satisfies `requireNote: true`).
- [x] **Ordering compatibility:** COD orders never create `PaymentTransaction` records. VNPay flow (`pending → paid → confirmed`) is preserved. `OrderCancelledAfterPaymentEvent` only fires for T-05/T-07 VNPay orders — correctly consumed by Payment BC.
- [x] **VNPay correctness:** IPN is sole authoritative source. Return URL is UI-only. HMAC SHA512 with `sortObject()`. `vnp_Amount = amount × 100`. `vnp_TxnRef = PaymentTransaction.id`. Both `vnp_SecureHash` AND `vnp_SecureHashType` stripped before signing (§7.4 fix).
- [x] **Edge cases covered:** Duplicate IPN (§11.1), timeout race (§11.2 — fixed: compensation via `PaymentConfirmedEventHandler`), amount mismatch (§11.3), invalid signature (§11.4), expired session (§11.5), refund failure + retry (§11.6 — fixed: `refund_retry_count` column added).
- [x] **Security:** `timingSafeEqual` for HMAC comparison. Amount validated server-side. IPN IP logging. No FK cross-BC. Idempotency on `providerTxnId`. `VNPayIpnDto` index signature removed (§10.5 fix).
- [x] **Ordering flow not broken:** `TransitionOrderHandler` T-02/T-03 idempotency guard absorbs race conditions. `PaymentConfirmedEventHandler` epsilon comparison (`|paidAmount - totalAmount| <= 0.01`) is respected. Race condition compensation added to handler.
- [x] **DIP boundary preserved:** `PlaceOrderHandler` injects `IPaymentInitiationPort` (symbol token), not `PaymentService` directly (§4 D-P2 fix, §14 Phase 8.2 fix). No `OrderingModule → PaymentModule` compile-time import.
- [x] **Migration path:** No PostgreSQL FKs to other BCs. Event contracts can be swapped to Kafka. `IPaymentInitiationPort` is the only direct coupling to Ordering — replaced by HTTP/gRPC adapter when extracting.

---

## Audit Change Summary

> **Audit performed:** Full codebase cross-check of this proposal against `place-order.handler.ts`, `payment-confirmed.handler.ts`, `payment-failed.handler.ts`, `transitions.ts`, `order.schema.ts`, `ordering.constants.ts`, and `src/shared/events/*.ts`.

### Issues Found & Fixed

| # | Severity | Location | Issue | Annotation |
|---|----------|----------|-------|------------|
| 1 | **CRITICAL** | §4 D-P2, §5.2, §14.2, §13.3 | `PlaceOrderHandler` directly imports `PaymentService` — creates a concrete `OrderingModule → PaymentModule` NestJS dependency, violating the Dependency Inversion Principle. If `PaymentModule` uses any event from Ordering BC (which it does), this could create a circular-dependency warning. | `[UPDATED]` — `IPaymentInitiationPort` interface + `PAYMENT_INITIATION_PORT` symbol in `src/shared/ports/`. Handler injects the token, not the class. |
| 2 | **CRITICAL** | §11.2 | Race condition handling used `await delay(500)` — fragile, non-deterministic, blocks IPN response to VNPay, does not work multi-pod. | `[FIXED]` — Compensation moved to `PaymentConfirmedEventHandler`: when T-02 fails due to already-cancelled order, handler re-publishes `OrderCancelledAfterPaymentEvent` to trigger automatic refund. |
| 3 | **CRITICAL** | §7.4 | `verifyIpn()` only stripped `vnp_SecureHash` before signing, leaving `vnp_SecureHashType` in the params. VNPay does not include `vnp_SecureHashType` in their signed string — including it causes HMAC mismatch on every IPN. | `[FIXED]` — Destructure both: `const { vnp_SecureHash, vnp_SecureHashType, ...params } = query` |
| 4 | **HIGH** | §9.1, §9.2, §3.1 | `refund_retry_count` referenced in §11.6 business logic but absent from the SQL DDL, Drizzle schema, and `PaymentTransaction` interface. | `[ADDED]` — Column added to all three locations. |
| 5 | **HIGH** | §10.5 | `VNPayIpnDto` had `[key: string]: string` index signature — illegal in TypeScript strict mode when combined with class-validator property decorators; causes a compile error. | `[FIXED]` — Removed index signature; added controller pattern using `@Req()` to pass raw query to `verifyIpn()`. |
| 6 | **MEDIUM** | §6.3 | Diagram arrow `initiateVNPayPayment() ──►│ (no, internal)` was ambiguous — appeared to point toward the VNPay column but was actually an in-process call. Also showed order commit and URL generation as a single step. | `[FIXED]` — Redrawn to show (1) commit order with NULL paymentUrl, (2) in-process `IPaymentInitiationPort` call, (3) UPDATE `orders.payment_url`. |
| 7 | **MEDIUM** | §5.3 | `PaymentService.handleIpn()` was described as containing all IPN business logic inline, contradicting the `ProcessIpnHandler` CQRS command handler defined in §7.5. Unclear whether the service or the command handler owns the logic. | `[UPDATED]` — `handleIpn()` is a thin wrapper that delegates to `commandBus.execute(new ProcessIpnCommand(query))`. All logic lives in `ProcessIpnHandler`. |
| 8 | **MEDIUM** | §5.2, §14.3 | `AppModule` import order note said PaymentModule must come after OrderingModule "because PlaceOrderHandler depends on PaymentService". With DIP token this constraint is relaxed; also the Phase 8.3 steps didn't address `PAYMENT_INITIATION_PORT` registration in `AppModule`. | `[UPDATED]` / `[ADDED]` — Clarified module ordering and added DI token binding step. |
| 9 | **LOW** | §6.3 | `OrderPlacedEvent` handler labelled "(no-op for vnpay)" — correct per D-P2 synchronous path, but the comment should clarify it's a safety net, not the primary path. No text change needed (§6.1 already explains this clearly). | No change — §6.1 is already correct. |

### What Was Correct (No Change Needed)

- **D-P1** (txnId = vnp_TxnRef): Correct.
- **D-P3** (IPN sole authoritative): Correct.
- **D-P4** (idempotency via UNIQUE provider_txn_id): Correct.
- **D-P5** (events after DB commit): Correct.
- **D-P6** (refund two-phase): Correct.
- **D-P7** (no cross-BC FKs): Correct.
- **§7.3 sortObject()** algorithm (encode-first, sort-second): Correct per VNPay 2.1.0 spec.
- **§7.5 IPN 8-step algorithm**: Correct.  `RspCode: '04'` for amount mismatch + `RspCode: '00'` for all successfully-processed IPNs (both pass and fail): Correct per VNPay protocol spec.
- **§8.2 state machine + mapping to Ordering transitions**: Correct.
- **§12 Security controls**: Correct and complete.
- **BR-P1 through BR-P7**: All verified against codebase.
- **`PaymentFailedEvent.reason` must be non-empty** (T-03 `requireNote: true`): Correctly noted in §6.2. Verified against `transitions.ts`.
- **`PaymentConfirmedEventHandler` epsilon guard** (`|paidAmount - totalAmount| <= 0.01`): Correctly documented. Verified against `payment-confirmed.handler.ts` L60.

---

## Final Audit Verdict

**Production-Ready: NO** (before fixes) → **YES** (after applying fixes in this document)

The proposal is architecturally sound at its core. The five critical/high issues fixed above would have caused real production problems:
1. The `[key: string]: string` DTO would have caused a **compile error** preventing Phase 8 from building.
2. The missing `vnp_SecureHashType` strip would have caused **every IPN to fail** with signature mismatch.
3. The `await delay(500)` race condition handler would have **silently failed to refund** customers who paid but whose orders were auto-cancelled.
4. The missing `refund_retry_count` column would have caused a **runtime error** in `PaymentRefundRetryTask`.
5. The direct `PaymentService` injection would have created a **NestJS circular dependency** between OrderingModule and PaymentModule (Payment's event handlers consume Ordering events).

With all 8 annotated fixes applied, the proposal is safe to implement.
