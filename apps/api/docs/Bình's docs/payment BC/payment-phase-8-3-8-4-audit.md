# Payment BC — Phase 8.3 / 8.4 Post-Implementation Audit

> **Auditor Role**: Senior Backend Engineer  
> **Date**: 2026-05-05  
> **Scope**: Phase 8.3 (VNPay IPN Handler) + Phase 8.4 (VNPay Return URL Handler)  
> **Verdict**: Issues found and fixed. Production-ready after fixes applied.

---

## Files Reviewed

| File | Phase |
|------|-------|
| `src/module/payment/commands/process-ipn.command.ts` | 8.3 |
| `src/module/payment/commands/process-ipn.handler.ts` | 8.3 |
| `src/module/payment/controllers/payment.controller.ts` | 8.3 + 8.4 |
| `src/module/payment/services/vnpay.service.ts` | Shared |
| `src/module/payment/services/payment.service.ts` | Shared |
| `src/module/payment/repositories/payment-transaction.repository.ts` | Shared |
| `src/module/payment/domain/payment-transaction.schema.ts` | Shared |
| `src/module/payment/payment.module.ts` | 8.3 + 8.4 |
| `src/shared/events/payment-confirmed.event.ts` | Contract |
| `src/shared/events/payment-failed.event.ts` | Contract |
| `src/module/ordering/order-lifecycle/events/payment-confirmed.handler.ts` | Consumer |
| `src/module/ordering/order-lifecycle/events/payment-failed.handler.ts` | Consumer |

---

## Issues Found

### ISSUE E-01 — Duplicate `PaymentFailedEvent` on concurrent IPN (CRITICAL)

**Location**: `process-ipn.handler.ts` — `handleFailure()` and the amount-mismatch path in `execute()`

**Description**:  
`publishPaymentFailed()` was called unconditionally after `markFailed()`, regardless of whether the DB update actually succeeded. `markFailed()` returned `void`, so the caller had no way to check the result.

**Why this is dangerous**:  
VNPay retries IPN callbacks with millisecond-level intervals. Two concurrent IPN handlers could race on the same transaction:

1. Both handlers read `status = 'awaiting_ipn'` — pass the terminal-state idempotency check.
2. Both reach `handleFailure()` or the amount mismatch path.
3. One handler wins the optimistic lock and writes `status = 'failed'` (version 0 → 1).
4. The other handler loses the lock (`updateStatus` returns `null`).
5. **BEFORE the fix**: Both handlers call `publishPaymentFailed()` → two `PaymentFailedEvent` → two `TransitionOrderCommand(orderId, 'cancelled', ...)` dispatched to Ordering.
6. `PaymentFailedEventHandler` in Ordering catches and swallows the second error, but the duplicate event is wasteful and violates the exactly-once semantic.

The same race exists in the amount mismatch path in `execute()`.

**Fix applied**:  
Changed `markFailed()` return type from `Promise<void>` to `Promise<boolean>`. Returns `true` when the DB update succeeded (this handler owns the result), `false` when the optimistic lock was lost (another handler already resolved it). `publishPaymentFailed()` is now guarded:

```typescript
// handleFailure()
const failed = await this.markFailed(txn, rawQuery, providerTxnId);
if (failed) {
  this.publishPaymentFailed(txn, reason);
}

// amount mismatch path
const mismatchFailed = await this.markFailed(txn, command.query, providerTxnId);
if (mismatchFailed) {
  this.publishPaymentFailed(txn, `IPN amount mismatch: ...`);
}
```

---

### ISSUE I-01 — `providerTxnId` empty string not normalized to `null` in success path (MODERATE)

**Location**: `process-ipn.handler.ts` — `handleSuccess()`, the `updateStatus` call

**Description**:  
`markFailed()` correctly normalized empty `providerTxnId` to `null` via `providerTxnId || null`. `handleSuccess()` passed `providerTxnId` directly without this normalization.

The DB column `provider_txn_id` has a `UNIQUE` constraint (via Drizzle `unique()`). In PostgreSQL, `UNIQUE` applies to non-null values. An empty string `''` IS subject to this constraint. If VNPay ever sends a successful IPN without `vnp_TransactionNo` (edge case), two different transactions both with empty string `providerTxnId` would violate the unique constraint on the second insert/update. In practice, VNPay always provides `vnp_TransactionNo` for successful payments, but consistency is required.

**Fix applied**:
```typescript
// Before
providerTxnId,

// After
providerTxnId: providerTxnId || null,
```

---

### ISSUE RET-02 — Missing `txnRef` returns misleading `status: 'failed'` (LOW)

**Location**: `payment.controller.ts` — `handleReturn()`, the `!txnRef` guard

**Description**:  
When `vnp_TxnRef` is absent from the return URL query params, the response contained `status: 'failed'`. This is misleading: the payment might have succeeded (IPN confirmed it), but the return URL arrived without the expected parameter. A frontend showing "Payment failed" based on this response would be incorrect.

**Fix applied**: Changed `status: 'failed'` → `status: 'unknown'`.

Additionally, `signatureValid` was hardcoded to `false` in this branch instead of using the actual value computed by `verifyReturn()`. Fixed to use the actual `signatureValid` variable.

---

### ISSUE RET-03 — Transaction not found returns misleading `status: 'failed'` (LOW)

**Location**: `payment.controller.ts` — `handleReturn()`, the `!txn` guard

**Description**:  
When the transaction cannot be found by `txnRef`, the response contained `status: 'failed'`. This is misleading for the same reasons as ISSUE RET-02. A valid txnRef that can't be found could indicate an extremely rare race condition or a tampered-but-valid-signature return URL. In either case, the status is indeterminate — not `'failed'`.

**Fix applied**: Changed `status: 'failed'` → `status: 'unknown'`.

---

## Fixes Applied Summary

| Issue | Severity | File | Change |
|-------|----------|------|--------|
| E-01 | CRITICAL | `process-ipn.handler.ts` | `markFailed()` returns `boolean`; `publishPaymentFailed` guarded by check |
| I-01 | MODERATE | `process-ipn.handler.ts` | `providerTxnId: providerTxnId \|\| null` in success path |
| RET-02 | LOW | `payment.controller.ts` | Missing txnRef: `status: 'unknown'`, `signatureValid` (actual value) |
| RET-03 | LOW | `payment.controller.ts` | Transaction not found: `status: 'unknown'` |
| (Swagger) | COSMETIC | `payment.controller.ts` | Added `'unknown'` to `status` enum in `@ApiOkResponse` schema |

---

## Confirmed Correct — No Changes Needed

### Phase 8.3 — IPN Handler

| Check | Result |
|-------|--------|
| Signature verification strips `vnp_SecureHash` AND `vnp_SecureHashType` | ✅ |
| HMAC SHA512 with `timingSafeEqual` (prevents timing oracle) | ✅ |
| Signature verified BEFORE any DB read or write | ✅ |
| Idempotency: terminal-state pre-flight check | ✅ |
| `isTerminalStatus()` covers all 4 terminal states (`completed/failed/refund_pending/refunded`) | ✅ |
| Amount comparison uses epsilon (`0.01`) — correct for `NUMERIC(12,2)` | ✅ |
| `vnp_Amount / 100` conversion uses `parseInt` + integer division | ✅ |
| Success path: `paidAt` and `providerTxnId` and `rawIpnPayload` all stored | ✅ |
| Failure path: `paidAt` NOT stored (correct — payment wasn't made) | ✅ |
| DB UNIQUE constraint on `provider_txn_id` as hard-stop for duplicate IPN | ✅ |
| Optimistic lock re-read on success path when lock is lost | ✅ |
| `PaymentConfirmedEvent` published AFTER DB write | ✅ |
| `PaymentFailedEvent.reason` is always non-empty (T-03 `requireNote: true` contract) | ✅ |
| `sortAndBuildSignData`: encode-first, sort-second — matches VNPay algorithm | ✅ |
| ASCII lexicographic sort (not `localeCompare`) — deterministic across Node.js locales | ✅ |
| `%20 → '+'` in value encoding — matches VNPay's traditional form encoding | ✅ |
| IPN response: `'00'` for success, `'97'` for bad sig, `'01'` for unknown, `'04'` for mismatch | ✅ |
| Failure IPN returns `'00'` (not `'97'`) — stops VNPay retrying a legitimately declined payment | ✅ |
| No cross-BC calls — only event publishing via `EventBus` | ✅ |

### Phase 8.4 — Return URL Handler

| Check | Result |
|-------|--------|
| Zero DB writes in `handleReturn()` | ✅ |
| Signature verification called (defensive, non-blocking) | ✅ |
| `signatureValid: false` surfaced to frontend without rejecting the request | ✅ |
| Status reflects what IPN has already written (read-only) | ✅ |
| `txnRef` validation happens before DB lookup | ✅ |
| Missing txnRef handled gracefully (now returns `status: 'unknown'`) | ✅ |

### Security

| Check | Result |
|-------|--------|
| `rawIpnPayload` stored but never echoed back to clients | ✅ |
| VNPay hash secret never logged | ✅ |
| Both endpoints are PUBLIC (no auth guard) — correct for server-to-server IPN | ✅ |
| Global prefix `/api` — VNPay IPN URL is `/api/payments/vnpay/ipn` | ✅ Note below |
| No global response interceptor that would wrap the `{ RspCode, Message }` shape | ✅ |

> ⚠️ **Configuration note**: `main.ts` sets `app.setGlobalPrefix('api')`. The VNPay merchant dashboard and `.env.example` must have `VNPAY_RETURN_URL` and the IPN URL set to paths under `/api/`, not the root. E.g.: `http://yourdomain.com/api/payments/vnpay/return`.

### Architecture Compliance

| Constraint | Result |
|------------|--------|
| IPN is the only DB state mutator for payment outcome | ✅ |
| Return URL handler is read-only | ✅ |
| Payment → Ordering: only via `EventBus` (no direct service calls) | ✅ |
| `PaymentConfirmedEvent` payload matches Phase 6 / Ordering consumer contract | ✅ |
| `PaymentFailedEvent` payload matches Phase 6 / Ordering consumer contract | ✅ |
| No NestJS module import cycle between Payment ↔ Ordering | ✅ |

---

## Test Simulation

### Case 1 — Successful IPN

**Input** (simulated VNPay IPN query):
```
vnp_TxnRef        = <our PaymentTransaction.id>
vnp_TransactionNo = 14000000  (VNPay's ID)
vnp_ResponseCode  = 00
vnp_TransactionStatus = 00
vnp_Amount        = 20000000  (= 200,000 VND × 100)
vnp_SecureHash    = <valid HMAC SHA512>
```

**Flow**:
1. `verifyIpn()` strips `vnp_SecureHash`, rebuilds sign data, computes HMAC → `valid: true`, `responsePaid: true`, `amount: 200000.00`.
2. `findById(txnRef)` → found, `status: 'awaiting_ipn'`.
3. `isTerminalStatus('awaiting_ipn')` → `false` → continues.
4. `|200000.00 - 200000.00| = 0 ≤ 0.01` → amount check passes.
5. `responsePaid = true` → `handleSuccess()`.
6. `updateStatus(id, 'completed', version=1, { providerTxnId: '14000000', paidAt: now, ... })` → updated.
7. `EventBus.publish(new PaymentConfirmedEvent(orderId, customerId, 'vnpay', 200000.00, now))`.
8. Returns `{ RspCode: '00', Message: 'Confirmed' }`.

**Ordering consumer** (`PaymentConfirmedEventHandler`):
- Reads order → `paymentMethod: 'vnpay'` → proceeds.
- `|200000.00 - order.totalAmount| ≤ 0.01` → dispatches `TransitionOrderCommand(orderId, 'paid', null, 'system', 'PaymentConfirmed')`.
- Order state: `pending → paid`.

---

### Case 2 — Failed IPN (bank declined)

**Input**:
```
vnp_ResponseCode  = 24  (customer cancelled)
vnp_TransactionStatus = 01
vnp_SecureHash    = <valid>
```

**Flow**:
1. Signature verified → `responsePaid: false`.
2. Transaction found, not terminal.
3. Amount check: VNPay still sends the full amount even on decline → passes.
4. `responsePaid = false` → `handleFailure('24')`.
5. `markFailed()` writes `status: 'failed'`, returns `true`.
6. `publishPaymentFailed(txn, 'VNPay declined payment — responseCode=24')` — reason is non-empty ✅.
7. Returns `{ RspCode: '00', Message: 'Processed' }` — VNPay stops retrying.

**Ordering consumer** (`PaymentFailedEventHandler`):
- Dispatches `TransitionOrderCommand(orderId, 'cancelled', null, 'system', 'VNPay declined payment — responseCode=24')`.
- T-03 `requireNote: true` is satisfied — note is non-empty ✅.
- Order state: `pending → cancelled`.

---

### Case 3 — Duplicate IPN (VNPay retry)

**Input**: Same IPN as Case 1, sent again 3 seconds later.

**Flow**:
1. Signature verification passes (same params, same hash).
2. `findById(txnRef)` → found, `status: 'completed'` (already set by first IPN).
3. `isTerminalStatus('completed')` → `true` → returns `{ RspCode: '00', Message: 'Transaction already processed' }` immediately.
4. No DB write. No event published. ✅

**Explanation**: The application-level terminal state check prevents duplicate processing at zero DB write cost. The `UNIQUE` constraint on `provider_txn_id` is a hard backstop for the race window between steps 2 and 3.

---

### Case 4 — Concurrent IPN race (two handlers racing on failure)

**Input**: Two identical failure IPNs arrive within milliseconds.

**Flow**:
1. Both handlers read `status: 'awaiting_ipn'` → both pass the idempotency check.
2. Both reach `handleFailure()`.
3. Handler A: `markFailed()` → optimistic lock version matches → update succeeds → returns `true` → publishes `PaymentFailedEvent`.
4. Handler B: `markFailed()` → optimistic lock version no longer matches (A incremented it) → `updateStatus` returns `null` → returns `false` → event is **NOT published**. ✅
5. Both return `{ RspCode: '00', Message: 'Processed' }` to VNPay.

**Explanation**: Only one `PaymentFailedEvent` is published (by whichever handler won the lock). Ordering receives exactly one T-03 cancellation command.

---

## Remaining Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `app.setGlobalPrefix('api')` — VNPay URLs must include `/api/` prefix | CONFIG | Document in `.env.example`; verify in sandbox testing |
| No `X-Forwarded-For` trust config in `main.ts` — `ipAddr` may be `::1` in production behind a proxy | LOW | Configure `app.set('trust proxy', 1)` if deployed behind nginx/load balancer |
| `findByProviderTxnId` is defined but not called in `ProcessIpnHandler` — an extra pre-flight check would catch provider txn ID collisions before DB write | LOW | DB UNIQUE constraint is the backstop; acceptable for now |
| PaymentTimeoutTask (Phase 8.5) not yet implemented — `pending`/`awaiting_ipn` rows are never expired | PHASE 8.5 | Tracked in Phase 8.5 |
| Refund flow (Phase 8.6+) not yet implemented — `OrderCancelledAfterPaymentEvent` is published by Ordering but has no handler in Payment BC | PHASE 8.6 | Tracked in Phase 8.6 |

---

## Final Verdict

| Dimension | Result |
|-----------|--------|
| Phase 8.3 (IPN Handler) correct | **YES** (after fixes) |
| Phase 8.4 (Return URL) correct | **YES** (after fixes) |
| Production-ready | **YES** |
| Architecture compliance | ✅ Full compliance |
| Event contracts match ordering BC | ✅ |
| Security (HMAC, timing-safe, no secret leakage) | ✅ |
| Idempotency (duplicate IPN, concurrent IPN) | ✅ |
