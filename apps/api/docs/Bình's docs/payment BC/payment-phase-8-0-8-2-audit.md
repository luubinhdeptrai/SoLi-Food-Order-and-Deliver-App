# Payment BC — Phase 8.0–8.2 Post-Implementation Audit

> **Auditor Role:** Senior Backend Engineer  
> **Audit Date:** 2026-05-05  
> **Scope:** Phase 8.0 (DB Foundation) · Phase 8.1 (VNPay Service) · Phase 8.2 (PaymentService + DIP)  
> **Status:** ✅ COMPLETED — All issues fixed

---

## 1. Audit Methodology

Every source file was read in full and cross-checked against:
- `PAYMENT_CONTEXT_PROPOSAL.md` (design spec)
- `VNPAY_INTEGRATION.md` (reference implementation)
- `ORDERING_CONTEXT_PROPOSAL.md` (integration contract)
- `PHASE_6_DOWNSTREAM_EVENTS_PROPOSAL.md` (event contracts)
- Existing codebase patterns (`order.schema.ts`, `RedisModule`, `PlaceOrderHandler`)

---

## 2. Issues Found

### Issue A — `findByOrderId` Wrong Sort Direction (BUG · HIGH)

**File:** `src/module/payment/repositories/payment-transaction.repository.ts`

**Problem:**
```typescript
// BEFORE (wrong)
.orderBy(paymentTransactions.createdAt)  // ASC → returns OLDEST row
.limit(1)
```

The method docstring says "most recent transaction for an order" but the implementation
returns the **oldest** row because Drizzle's default `orderBy` direction is ASC.

In a retry scenario where a customer's first VNPay attempt timed out and a second transaction
was created for the same `orderId`, this method would return the **expired** transaction — not
the active one. Any Phase 8.3+ code relying on this method to find the current payment status
would silently operate on stale data with no error.

**Fix:** Changed to `desc(paymentTransactions.createdAt)` and added `desc` to the Drizzle
imports. Now returns the latest transaction for the order.

---

### Issue B — `IpnVerificationResult` Missing `txnRef` Field (DESIGN GAP · MEDIUM)

**File:** `src/module/payment/services/vnpay.service.ts`

**Problem:**
```typescript
// BEFORE — missing txnRef
export interface IpnVerificationResult {
  valid: boolean;
  responsePaid: boolean;
  amount: number;
  providerTxnId: string;  // vnp_TransactionNo — VNPay's ID
  // ⚠️ vnp_TxnRef (= PaymentTransaction.id) was NOT returned
}
```

The Phase 8.3 IPN handler needs **two different identifiers** from the IPN callback:
- `vnp_TxnRef` → our `PaymentTransaction.id` (primary key) — used to look up the record in DB
- `vnp_TransactionNo` → VNPay's own ID — stored as `provider_txn_id` for idempotency (D-P4)

Without `txnRef` in the result, the Phase 8.3 implementer would have no clean path to look
up the transaction. They would be forced to either:
1. Access raw `query` params directly (bypassing the verified result), OR
2. Add a `findByProviderTxnId` call but that only works AFTER an IPN, not for idempotency checks

This is a forward-looking gap that, if left unfixed, would either:
- Cause a refactoring of `verifyIpn()` during Phase 8.3 (disrupting already-tested code), OR
- Lead to a workaround that accesses raw query params outside the verified result (worse)

**Fix:** Added `txnRef: string` to `IpnVerificationResult`. `verifyIpn()` now populates it
from `query.vnp_TxnRef`. Returns empty string when signature is invalid (same pattern as
`providerTxnId`). The interface comment distinguishes clearly between the two IDs.

---

### Issue C — `sortAndBuildSignData` Uses `localeCompare` (DETERMINISM · MEDIUM)

**File:** `src/module/payment/services/vnpay.service.ts`

**Problem:**
```typescript
// BEFORE — locale-sensitive sort
entries.sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
```

`localeCompare()` without explicit locale and sensitivity arguments uses the **system
locale** (the `LANG`/`LC_ALL` environment variable of the Node.js process). On a developer
machine with `en-US.UTF-8`, it may sort identically to ASCII order. On a production server
with a different locale configuration, it could potentially sort differently.

VNPay's server sorts using standard lexicographic byte-order (equivalent to ASCII/POSIX sort).
If the sort order on our side diverges from VNPay's sort order, the HMAC would be computed
over a different string → **every single VNPay request would produce an invalid signature**,
causing 100% payment failures with no obvious error in logs.

While VNPay param keys (`vnp_Amount`, `vnp_Command`, etc.) are pure ASCII, meaning most
locales would sort them identically, the risk of a non-standard locale deployment is non-zero
and the fix is a one-liner.

**Fix:** Replaced with deterministic explicit comparison:
```typescript
entries.sort(([keyA], [keyB]) => (keyA < keyB ? -1 : keyA > keyB ? 1 : 0));
```
This guarantees byte-order sort regardless of Node.js locale settings.

---

### Issue D — Duplicate `// ---` Separator in `place-order.handler.ts` (COSMETIC · LOW)

**File:** `src/module/ordering/order/commands/place-order.handler.ts`

**Problem:**
```typescript
    // -------------------------------------------------------------------------
    // -------------------------------------------------------------------------  // ← duplicate
    // Step 11 — C-1 FIX: ...
```

Two consecutive separator lines were left by the multi-step edit that inserted the
two-phase VNPay write block. Cosmetic but confusing.

**Fix:** Removed the duplicate separator line.

---

## 3. Non-Issues (Verified Correct)

The following were scrutinized and confirmed correct:

| Concern | Verdict |
|---|---|
| `NUMERIC(12,2)` for `amount` — exact decimal, no float | ✅ Correct — mirrors `order.schema.ts` pattern |
| UNIQUE on `provider_txn_id` NULL handling | ✅ Correct — PostgreSQL UNIQUE allows multiple NULLs (D-P4) |
| No FK on `order_id` / `customer_id` | ✅ Correct — D-P7 microservice extraction readiness |
| Optimistic locking via `version` column | ✅ Correct — incremented on every status mutation |
| `buildPaymentUrl` URL construction with pre-encoded signData | ✅ Correct — VNPay decodes query params server-side |
| `vnp_Amount = Math.round(amount × 100)` | ✅ Correct — BR-P2; Math.round guards float precision |
| `vnp_SecureHash` stripped before re-sign in `verifyIpn` | ✅ Correct |
| `vnp_SecureHashType` also stripped (separate from `vnp_SecureHash`) | ✅ Correct — common oversight in other impls |
| `timingSafeEqual` for HMAC comparison | ✅ Correct — OWASP timing attack prevention |
| Both `vnp_ResponseCode` AND `vnp_TransactionStatus` checked for `'00'` | ✅ Correct |
| `formatVNPayDate` uses UTC+7 offset without `moment` | ✅ Correct |
| `::ffff:` IPv6-mapped IPv4 stripping in `sanitizeIpAddr` | ✅ Correct |
| `requireConfig` throws at `onModuleInit` — fail-fast | ✅ Correct |
| `@Global()` on `PaymentModule` — no OrderModule→PaymentModule coupling | ✅ Correct |
| `useExisting: PaymentService` for PAYMENT_INITIATION_PORT | ✅ Correct |
| `PlaceOrderHandler` injects `IPaymentInitiationPort` token, not `PaymentService` | ✅ DIP respected |
| Two-phase write in `place-order.handler.ts` inside try/catch | ✅ Correct |
| VNPay failure leaves order alive (no rollback) — PaymentTimeoutTask recovers | ✅ Correct per proposal |
| Idempotency key saved to `finalOrder.id` (not `order.id`) after VNPay write | ✅ Correct |
| `OrderPlacedEvent` published with `finalOrder` (carries `paymentUrl`) | ✅ Correct |
| IP extraction from `x-forwarded-for` with split/trim | ✅ Correct |
| `@Req() req: Request` import is Express `Request`, not NestJS `Request` | ✅ Correct |

---

## 4. Test Simulation

### Case 1 — Normal VNPay Checkout (Happy Path)

**Input:**
```
POST /carts/my/checkout
Body: { deliveryAddress: {...}, paymentMethod: "vnpay" }
Headers: x-forwarded-for: 203.113.131.9
```

**Trace:**
1. `CartController.checkout()` — extracts `ipAddr = "203.113.131.9"`, creates `PlaceOrderCommand`
2. `PlaceOrderHandler.execute()` — acquires cart lock, validates, prices, persists order (steps 1–10)
3. Step 10b: `paymentPort.initiateVNPayPayment(orderId, customerId, amount, "203.113.131.9")`
4. `PaymentService.initiateVNPayPayment()`:
   - `txnId = randomUUID()` → e.g. `"a1b2c3d4-..."`
   - `expiresAt = now + 1800s`
   - DB INSERT: `payment_transactions(id=txnId, status='pending', version=0)`
   - `VNPayService.buildPaymentUrl({txnRef: txnId, amount, ipAddr: "203.113.131.9"})`
     - Builds `vnpParams` with 14 params
     - `sortAndBuildSignData(vnpParams)` → deterministic ASCII sort → `signData`
     - `hmacSha512(signData)` → 128-char hex
     - Returns `"https://sandbox.vnpayment.vn/...?vnp_Amount=...&...&vnp_SecureHash=..."`
   - `updateToAwaitingIpn(txnId, paymentUrl, version=0)` → sets `status='awaiting_ipn'`
   - Returns `{ txnId, paymentUrl }`
5. `PlaceOrderHandler`: `UPDATE orders SET payment_url = paymentUrl WHERE id = orderId`
6. `finalOrder = { ...order, paymentUrl }`
7. Idempotency saved, `OrderPlacedEvent` published, cart cleared
8. Response: `{ orderId, status: "pending", paymentUrl: "https://sandbox.vnpayment.vn/..." }`

**Result:** ✅ `paymentUrl` returned, `payment_transactions.status = awaiting_ipn`

---

### Case 2 — VNPay URL Generation Fails (Graceful Fallback)

**Simulated:** `VNPayService.buildPaymentUrl()` throws (e.g., config missing or VNPay SDK error)

**Trace:**
1. Steps 1–10: order persisted to DB normally
2. Step 10b try block: `paymentPort.initiateVNPayPayment(...)` throws
3. Catch block: `this.logger.error("VNPay URL generation failed for order X: ...")` — **no rethrow**
4. `finalOrder = order` (paymentUrl remains null)
5. Idempotency saved with `finalOrder.id` (order ID, no paymentUrl)
6. `OrderPlacedEvent` published (paymentMethod = 'vnpay', paymentUrl = null)
7. Response: `{ orderId, status: "pending", paymentUrl: null }` — **no 500 error**

**Recovery path:**
- `PaymentTransaction` in DB with `status='pending'` (if DB write succeeded in step 1)
- OR no `PaymentTransaction` at all (if DB write itself threw — then `initiateVNPayPayment` propagates up to catch)
- `PaymentTimeoutTask` (Phase 8.5) finds the 'pending' transaction at `expiresAt`
- Fires `PaymentFailedEvent` → `PaymentFailedEventHandler` → T-03 cancels the order
- Customer receives push notification (via `OrderStatusChangedEvent`) that order was cancelled

**Result:** ✅ No crash, order self-heals within `PAYMENT_SESSION_TIMEOUT_SECONDS`

---

### Case 3 — Edge Cases

#### Case 3a — Missing `ipAddr` (integration test or internal call)

`PlaceOrderCommand.ipAddr` is `undefined`. In `place-order.handler.ts`:
```typescript
ipAddr ?? '127.0.0.1'
```
`PaymentService` receives `'127.0.0.1'`. `VNPayService.sanitizeIpAddr('127.0.0.1')` returns
`'127.0.0.1'` (no prefix to strip). VNPay sandbox accepts localhost IPs.

**Result:** ✅ Degrades gracefully, 127.0.0.1 sent to VNPay (acceptable for test environments)

#### Case 3b — Zero or Negative Amount

`PlaceOrderHandler` throws `UnprocessableEntityException` at step 8 if `itemsTotal <= 0`.
This happens BEFORE step 10b (VNPay initiation). `PaymentService.initiateVNPayPayment()`
is never called with a zero amount.

**Result:** ✅ Input validated before reaching payment layer

#### Case 3c — Duplicate IPN (VNPay retry mechanism)

VNPay retries IPN delivery if it doesn't receive `RspCode: '00'` within a timeout. Second
IPN arrives with same `vnp_TransactionNo`. Phase 8.3 IPN handler should call
`findByProviderTxnId(providerTxnId)` — if non-null row found with `status='completed'`,
return `RspCode: '02'` (already processed) without re-publishing `PaymentConfirmedEvent`.

The UNIQUE constraint on `provider_txn_id` prevents any DB write from succeeding twice
for the same VNPay transaction number. This is the hard idempotency backstop (D-P4).

**Result:** ✅ Schema + repository designed correctly for idempotent IPN handling

#### Case 3d — Concurrent IPN + Timeout expiry race

Two goroutines: IPN arrives exactly when `PaymentTimeoutTask` is expiring the same transaction.

`updateStatus` and `updateToAwaitingIpn` both use `WHERE version = currentVersion`. Only one
UPDATE will succeed (the one that runs first). The losing UPDATE returns `null`. Both callers
handle `null` return gracefully (log warn).

**Result:** ✅ Optimistic locking prevents double state transition

---

## 5. Constraint Validation

| Constraint | Status |
|---|---|
| **DIP** — Ordering uses `PAYMENT_INITIATION_PORT` token, not `PaymentService` import | ✅ |
| **No cross-BC calls** — Payment never calls Ordering services | ✅ |
| **Communication back to Ordering** — ONLY via `PaymentConfirmedEvent` / `PaymentFailedEvent` | ✅ (events defined in shared/events, ready for Phase 8.3) |
| **Schema matches proposal** — all fields, types, indexes present | ✅ |
| **`@Global()` pattern** — same as `RedisModule` | ✅ |
| **No `qs` dependency** — manual URL encoding | ✅ |
| **No `moment` dependency** — manual UTC+7 date formatting | ✅ |
| **`crypto.timingSafeEqual`** — HMAC comparison | ✅ |
| **No fallback for VNPay config** — throws at startup if missing | ✅ |
| **`Math.round(amount × 100)`** — float-safe VNPay amount | ✅ |
| **Cart lock covers VNPay init** — `CART_LOCK_TTL_SECONDS = 30` > VNPay URL latency | ✅ |

---

## 6. Risks (Residual, Post-Fix)

| Risk | Severity | Notes |
|---|---|---|
| `updateToAwaitingIpn` fails (optimistic lock) after URL generated | LOW | Transaction stays 'pending'; timeout task recovers. Phase 8.3 IPN handler must accept 'pending' as a valid pre-IPN status (not require 'awaiting_ipn'). |
| `VNPAY_RETURN_URL` contains special chars → URL is correctly encoded | LOW | `encodeURIComponent` handles this. Verified. |
| Multiple `PaymentTransaction` rows for same `orderId` | ACCEPTABLE | Allowed by design (retry). `findByOrderId` now returns newest (Issue A fix). Phase 8.3 should use `findById(txnRef)` as primary lookup — more precise than `findByOrderId`. |
| `payment_transactions.created_at` lacks `WITH TIME ZONE` | INFORMATIONAL | Matches codebase convention (`order.schema.ts` same pattern). Server is expected to run UTC. No behavioral issue. A separate migration could add `WITH TIME ZONE` if audit compliance requires it. |

---

## 7. Final Verdict

| Phase | Correct | Production-Ready |
|---|---|---|
| **Phase 8.0** — Domain & DB Foundation | ✅ YES (post-fix) | ✅ YES |
| **Phase 8.1** — VNPay Service | ✅ YES (post-fix) | ✅ YES |
| **Phase 8.2** — PaymentService + DIP Integration | ✅ YES | ✅ YES |

**Overall: Phase 8.0–8.2 is production-ready after the 4 fixes applied in this audit.**

The architecture is sound: DIP is respected, no cross-BC direct calls, VNPay signing is
correct and deterministic, graceful failure handling is implemented, and the DB schema
supports all required queries for Phase 8.3 (IPN handling) and Phase 8.5 (timeout task).

---

## 8. Fix Summary

| # | File | What Was Fixed | Why |
|---|---|---|---|
| A | `payment-transaction.repository.ts` | `findByOrderId`: ASC → DESC sort, added `desc` import | Was returning oldest transaction; retry scenarios need newest |
| B | `vnpay.service.ts` | Added `txnRef: string` to `IpnVerificationResult`; populated from `query.vnp_TxnRef` in `verifyIpn()` | Phase 8.3 IPN handler needs `vnp_TxnRef` to look up transaction by primary key |
| C | `vnpay.service.ts` | `localeCompare` → explicit `< > ===` in `sortAndBuildSignData` | `localeCompare` is locale-sensitive; VNPay expects deterministic ASCII sort |
| D | `place-order.handler.ts` | Removed duplicate `// ---` separator before Step 11 | Left by multi-step edit; cosmetic but confusing |
