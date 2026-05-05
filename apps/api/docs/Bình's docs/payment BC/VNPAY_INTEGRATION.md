# VNPay Sandbox Integration — Technical Deep Dive

> **Codebase**: `movie-hub` monorepo (Nx workspace)  
> **Scope**: `booking-service` + `api-gateway`  
> **Transport**: NestJS TCP Microservice  
> **Payment Gateway**: VNPay Sandbox (`sandbox.vnpayment.vn`)

---

## 1. Overview

The VNPay integration enables the movie-hub platform to collect online payments for cinema bookings. The implementation is spread across two services:

| Layer | Service | Role |
|---|---|---|
| HTTP Edge | `api-gateway` | Exposes REST endpoints, proxies to booking-service |
| Business Logic | `booking-service` | Owns all VNPay logic: URL generation, IPN handling, DB state |

The integration uses the **VNPay 2.1.0 API** (sandbox environment). Payments are initiated by the authenticated frontend, then confirmed **server-to-server via IPN** (Instant Payment Notification). The return URL is for browser redirection only and does **not** update state.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        BROWSER / CLIENT                          │
│                     (Next.js frontend)                           │
└──────────────┬────────────────────────────────┬─────────────────┘
               │ POST /api/v1/payments/bookings/:id    │ GET redirect (user browser)
               ▼                                       ▼
┌──────────────────────────┐             ┌─────────────────────────┐
│       API GATEWAY         │             │     VNPay Sandbox       │
│  (NestJS HTTP Server)     │◄────────────│ sandbox.vnpayment.vn    │
│                           │ GET /vnpay/ipn (server-to-server)     │
│  PaymentController        │             │                         │
│  - POST bookings/:id      │             └─────────────────────────┘
│  - GET vnpay/ipn  ← PUBLIC│
│  - GET vnpay/return ← PUBLIC
│                           │
│  PaymentService (gateway) │
│  (pure TCP proxy)         │
└──────────────┬────────────┘
               │ TCP (NestJS ClientProxy)
               │ MessagePattern: 'payment.*'
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      BOOKING SERVICE                             │
│                   (NestJS TCP Microservice)                      │
│                                                                  │
│  PaymentController   →   PaymentService                         │
│  (MessagePattern)        - createVNPayUrl()                     │
│                          - handleVNPayIPN()    ← CRITICAL PATH  │
│                          - handleVNPayReturn() ← sig check only │
│                          - sortObject()                         │
│                          - HMAC SHA512 signing                  │
│                                                                  │
│  PrismaService  →  PostgreSQL (payments, bookings, tickets)      │
│  BookingEventService  →  Redis (booking.confirmed pub/sub)       │
│  NotificationService  →  Email / SMS (async, fire-and-forget)   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Payment Flow — Step by Step

### 3.1 Happy Path (Successful Payment)

```
Step 1  ─ Client calls POST /api/v1/payments/bookings/:bookingId
           Body: { paymentMethod: "VNPAY", returnUrl, cancelUrl }
           Header: Authorization: Bearer <clerk_token>

Step 2  ─ API Gateway authenticates (ClerkAuthGuard), extracts IP from
           request.headers['x-forwarded-for'] || request.socket.remoteAddress

Step 3  ─ API Gateway proxies via TCP:
           bookingClient.send('payment.create', { bookingId, dto, ipAddr })

Step 4  ─ Booking Service: createPayment()
           - Validate booking exists + status === PENDING
           - Read final_amount from booking (NOT from client DTO — prevents tampering)
           - If amount < 1000 VND → handleZeroAmountPayment() [skip VNPay]
           - Otherwise: INSERT payments row (status=PENDING)
           - Call createVNPayUrl(paymentId, bookingId, expireAt, amount, ipAddr)
           - UPDATE payments.payment_url
           - Return { data: { paymentUrl: "https://sandbox.vnpayment.vn/..." } }

Step 5  ─ Client redirects browser to the returned paymentUrl

Step 6  ─ User completes payment on VNPay sandbox

Step 7  ─ VNPay calls GET /api/v1/payments/vnpay/ipn (server-to-server)
           *** THIS IS THE AUTHORITATIVE CALLBACK ***

Step 8  ─ Booking Service: handleVNPayIPN()
           - Verify HMAC SHA512 signature
           - Lookup payment by vnp_TxnRef (= paymentId)
           - Idempotency check: reject if already processed
           - Amount validation
           - If vnp_TransactionStatus === '00':
             → Prisma $transaction:
               UPDATE payments SET status=COMPLETED
               UPDATE bookings  SET status=CONFIRMED, payment_status=COMPLETED
               UPDATE tickets   SET status=VALID
               UPDATE promotions.current_usage++ (if promo used)
             → Publish Redis event: booking.confirmed
             → sendBookingConfirmationEmailAsync() [fire-and-forget]
           - Return { RspCode: '00', Message: 'Success' }

Step 9  ─ VNPay redirects user browser to GET /api/v1/payments/vnpay/return
           (UI only — just validates signature, returns { status, code })
```

### 3.2 Zero-Amount Path (100% Voucher)

```
If booking.final_amount < 1000 VND:

  createPayment()
       │
       └─► handleZeroAmountPayment()
              - INSERT payments (status=COMPLETED, amount=0)
              - $transaction: confirm booking + tickets atomically
              - Publish Redis event
              - Send email async
              - Return paymentUrl = dto.returnUrl (no redirect to VNPay)
```

---

## 4. VNPay URL Generation

### 4.1 Parameters

```typescript
// booking-service/src/app/payment/payment.service.ts :: createVNPayUrl()

const vnp_Params = {
  vnp_Version:    '2.1.0',
  vnp_Command:    'pay',
  vnp_TmnCode:    this.vnp_TmnCode,          // Merchant terminal code
  vnp_Locale:     'vn',
  vnp_CurrCode:   'VND',
  vnp_TxnRef:     paymentId,                 // Used as orderId — UUID from payments table
  vnp_OrderInfo:  `Thanh toan cho ma GD:${paymentId}`,
  vnp_OrderType:  'other',
  vnp_Amount:     amount * 100,              // VNPay requires amount × 100 (no decimals)
  vnp_ReturnUrl:  this.vnp_ReturnUrl,        // Where browser is redirected after payment
  vnp_IpAddr:     cleanIpAddr,              // Client IP, ::ffff: prefix stripped
  vnp_CreateDate: moment.utc().utcOffset('+07:00').format('YYYYMMDDHHmmss'),
  vnp_ExpireDate: moment.utc(expireAt).utcOffset('+07:00').format('YYYYMMDDHHmmss'),
};
```

> **Note**: `vnp_TxnRef` is the internal `payment.id` (UUID), not the `booking.id`. VNPay will echo this back in IPN as `vnp_TxnRef`, which is how the system looks up the payment record.

### 4.2 Signing Process

The signing pipeline has 4 steps:

```
1. Convert all values to strings
         ↓
2. URL-encode keys and sort alphabetically (sortObject)
         ↓
3. Serialize with qs.stringify(sorted, { encode: false })
   Result: "vnp_Amount=20000000&vnp_Command=pay&vnp_CreateDate=..."
         ↓
4. HMAC SHA512(signData, vnp_HashSecret) → hex digest
   Append as vnp_SecureHash to the query string
```

```typescript
// Step 1 — Stringify all values
const stringParams: Record<string, string> = {};
for (const [key, value] of Object.entries(vnp_Params)) {
  stringParams[key] = String(value);
}

// Step 2 — Sort (see sortObject() breakdown below)
const sortedParams = this.sortObject(stringParams);

// Step 3 — Serialize
const signData = querystring.stringify(sortedParams, { encode: false });

// Step 4 — Sign
const hmac = crypto.createHmac('sha512', this.vnp_HashSecret);
const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
sortedParams.vnp_SecureHash = signed;

// Build final URL
const paymentUrl = this.vnp_Url + '?' + querystring.stringify(sortedParams, { encode: false });
```

### 4.3 `sortObject()` — Key Detail

This method is critical. It URL-encodes both keys and values, sorts by URL-encoded key, then builds the final object. VNPay's signature validation depends on the exact encoding.

```typescript
private sortObject(obj: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  const keys: string[] = [];

  // Encode keys for sorting
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      keys.push(encodeURIComponent(key));
    }
  }

  keys.sort(); // Alphabetical on URL-encoded key names

  for (const encodedKey of keys) {
    const originalKey = Object.keys(obj).find(
      (k) => encodeURIComponent(k) === encodedKey
    );
    if (originalKey) {
      sorted[encodedKey] = encodeURIComponent(obj[originalKey]).replace(/%20/g, '+');
    }
  }

  return sorted;
}
```

> **Why encode first, then sort?** VNPay's verification algorithm sorts on the URL-encoded representation of keys. Sorting raw keys would produce a different order for keys containing special characters, leading to signature mismatch.

---

## 5. IPN Handling (Authoritative Path)

IPN is the **only** mechanism that updates the database. The return URL does not update state.

### 5.1 Endpoint

```
GET /api/v1/payments/vnpay/ipn
```

- **Public** — no authentication (VNPay server calls this, no token)
- **Must respond** with `{ RspCode: string, Message: string }` (not wrapped in ServiceResult)
- The API Gateway controller explicitly unwraps: `return result.data` (not `return result`)

### 5.2 Verification Logic

```typescript
// 1. Extract and remove the hash from incoming params
const secureHash = vnpParams.vnp_SecureHash;
const paramsToVerify = { ...vnpParams }; // Clone to avoid mutation
delete paramsToVerify.vnp_SecureHash;
delete paramsToVerify.vnp_SecureHashType;

// 2. Re-sign using the same algorithm
const sortedParams = this.sortObject(paramsToVerify);
const signData    = querystring.stringify(sortedParams, { encode: false });
const hmac        = crypto.createHmac('sha512', this.vnp_HashSecret);
const signed      = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

// 3. Case-insensitive comparison
if (secureHash?.toUpperCase() !== signed?.toUpperCase()) {
  return { data: { RspCode: '97', Message: 'Checksum failed' } };
}
```

### 5.3 State Machine on IPN Success (`vnp_TransactionStatus === '00'`)

```
Incoming IPN (transactionStatus = '00')
           │
           ▼
  prisma.$transaction([
    payments.update  → status = COMPLETED
                        provider_transaction_id = vnp_TransactionNo
                        paid_at = now()
    bookings.update  → status = CONFIRMED
                        payment_status = COMPLETED
                        expires_at = null
    tickets.updateMany → status = VALID
    promotions.update  → current_usage++ (if promotion_code present)
  ])
           │
           ▼
  publishBookingConfirmed (Redis pub/sub)
  channel: 'booking.confirmed'
  payload: { userId, showtimeId, bookingId, seatIds[] }
           │
           ▼
  sendBookingConfirmationEmailAsync() ← fire-and-forget
  + SMS (fire-and-forget within the async)
```

### 5.4 State Machine on IPN Failure (`transactionStatus !== '00'`)

```
Incoming IPN (transactionStatus != '00')
           │
           ▼
  prisma.$transaction([
    payments.update    → status = FAILED
    bookings.update    → status = CANCELLED, payment_status = FAILED
    tickets.updateMany → status = CANCELLED
  ])
           │
           ▼
  Return { RspCode: '00', Message: 'Success' }
  ↑ This '00' means "we received and processed your notification"
    It does NOT mean the payment succeeded.
```

### 5.5 IPN Response Codes

| RspCode | Meaning |
|---|---|
| `00` | IPN received and processed (regardless of payment success/failure) |
| `97` | Invalid signature |
| `01` | Order not found |
| `02` | Order already processed (idempotency) |
| `04` | Order expired OR amount mismatch |
| `99` | Unspecified server error |

---

## 6. Return URL Handling

```
GET /api/v1/payments/vnpay/return?vnp_ResponseCode=00&vnp_SecureHash=...
```

This endpoint is for **browser redirection only**. It verifies the signature and returns a `{ status, code }` object. It does **not** write to the database.

```typescript
async handleVNPayReturn(vnpParams: Record<string, string>) {
  const secureHash = vnpParams.vnp_SecureHash;

  // ⚠️ WARNING: mutates the input object (see Security section)
  delete vnpParams.vnp_SecureHash;
  delete vnpParams.vnp_SecureHashType;

  const sortedParams = this.sortObject(vnpParams);
  const signData = querystring.stringify(sortedParams, { encode: false });
  const hmac = crypto.createHmac('sha512', this.vnp_HashSecret);
  const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

  if (secureHash?.toUpperCase() === signed?.toUpperCase()) {
    return { data: { status: 'success', code: vnpParams.vnp_ResponseCode } };
  } else {
    return { data: { status: 'error', code: '97' } };
  }
}
```

> The comment in code explicitly says: `## DONT USE THIS , use ipn instead` — correctly deferring all state updates to IPN.

---

## 7. Sequence Diagram

```
Client          API Gateway         Booking Service     VNPay Sandbox     Redis/Email
  │                  │                     │                  │               │
  │──POST /payments/bookings/:id──►        │                  │               │
  │  {paymentMethod, returnUrl}            │                  │               │
  │                  │──TCP send──────────►│                  │               │
  │                  │   payment.create    │                  │               │
  │                  │                     │──INSERT payments──►(DB)           │
  │                  │                     │──build VNPay URL                 │
  │                  │                     │  sortObject() + HMAC SHA512      │
  │                  │◄──{paymentUrl}──────│                  │               │
  │◄──{paymentUrl}───│                     │                  │               │
  │                  │                     │                  │               │
  │──REDIRECT browser to paymentUrl───────────────────────►  │               │
  │                  │                     │                  │               │
  │         User fills in payment on VNPay UI                │               │
  │                  │                     │                  │               │
  │                  │       ┌─────────────────────────────── │               │
  │                  │       │ GET /payments/vnpay/ipn        │               │
  │                  │◄──────┘  ?vnp_TxnRef=paymentId&...    │               │
  │                  │──TCP send──────────►│                  │               │
  │                  │   payment.vnpay.ipn │                  │               │
  │                  │                     │──verify HMAC─────►              │
  │                  │                     │──idempotency check               │
  │                  │                     │──$transaction:                   │
  │                  │                     │  UPDATE payments/bookings/tickets│
  │                  │                     │──publish booking.confirmed───────►(Redis)
  │                  │                     │──sendEmailAsync()────────────────►(SMTP)
  │                  │◄──{RspCode:'00'}────│                  │               │
  │                  │──────────────────────────────────────► │               │
  │                  │  HTTP 200 {RspCode:'00'}  (VNPay reads this)           │
  │                  │                     │                  │               │
  │◄──VNPay redirects browser to GET /payments/vnpay/return──┤               │
  │                  │◄─── sig-check only ─│                  │               │
  │◄──{status:'success', code:'00'}──────  │                  │               │
```

---

## 8. Configuration

### 8.1 Environment Variables

```bash
# booking-service/.env (from .env.example)

VNPAY_TMN_CODE=0GEGLRAD                                    # Merchant Terminal Code
VNPAY_HASH_SECRET=KB2XXMTTDUA1HTSW68JIG0U963AC7TOV        # HMAC signing key
VNPAY_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
VNPAY_RETURN_URL=http://localhost:3000/payment/return      # Browser redirect target
VNPAY_API=https://sandbox.vnpayment.vn/merchant_webapi/merchant.html
```

### 8.2 Constructor Initialization

```typescript
// payment.service.ts constructor
this.vnp_TmnCode    = this.configService.get('VNPAY_TMN_CODE')    || 'EX6ATLAM';
this.vnp_HashSecret = this.configService.get('VNPAY_HASH_SECRET') || 'ID4MX46WVEFNI39KLW9JUFHDR0I4U3IB';
this.vnp_Url        = this.configService.get('VNPAY_URL')         || 'https://sandbox.vnpayment.vn/...';
this.vnp_ReturnUrl  = this.configService.get('VNPAY_RETURN_URL')  || 'http://localhost:3000/payment/return';
```

### 8.3 TCP Transport (Payment Module)

```typescript
// payment.module.ts
ClientsModule.register([{
  name: SERVICE_NAME.USER,
  transport: Transport.TCP,
  options: {
    host: process.env.USER_HOST || 'localhost',
    port: parseInt(process.env.USER_PORT) || 3001,
  },
}])
```

### 8.4 Message Routing

```typescript
// shared-types/src/constant/message.ts
PaymentMessage = {
  CREATE:        'payment.create',
  VNPAY_IPN:     'payment.vnpay.ipn',
  VNPAY_RETURN:  'payment.vnpay.return',
  FIND_ONE:      'payment.findOne',
  FIND_BY_BOOKING: 'payment.findByBooking',
  ...
}
```

---

## 9. Security Analysis

### 9.1 What Is Done Correctly

| Control | Implementation |
|---|---|
| Signature verification | Both IPN and return URL re-sign with HMAC SHA512 and compare (case-insensitive) |
| Amount integrity | `paymentAmount` is read from `booking.final_amount` in DB, **not** from client DTO |
| Idempotency | IPN checks `payment.status !== PENDING` before processing — duplicate callbacks are safely rejected with `RspCode: '02'` |
| Atomic updates | Booking + payment + tickets updated in a single `prisma.$transaction` — no partial state |
| IPN is authoritative | Return URL only verifies signature and returns status; no DB writes |
| Input clone on IPN | `const paramsToVerify = { ...vnpParams }` before deleting keys — avoids mutating the original |

### 9.2 Vulnerabilities and Risks

#### 🔴 CRITICAL — Hardcoded Fallback Secrets in Source Code

```typescript
// payment.service.ts lines 43–55
this.vnp_TmnCode    = this.configService.get('VNPAY_TMN_CODE')    || 'EX6ATLAM';
this.vnp_HashSecret = this.configService.get('VNPAY_HASH_SECRET') || 'ID4MX46WVEFNI39KLW9JUFHDR0I4U3IB';
```

Real sandbox credentials are committed directly into the source code as fallbacks. If this code is ever deployed to production with misconfigured env vars, it will silently use these hardcoded sandbox keys — and anyone who reads the source can forge valid VNPay signatures.

**Fix**: Remove all fallback values. Throw at startup if env vars are missing.

```typescript
// Recommended
const secret = this.configService.get('VNPAY_HASH_SECRET');
if (!secret) throw new Error('VNPAY_HASH_SECRET is required');
this.vnp_HashSecret = secret;
```

#### 🟡 MEDIUM — `handleVNPayReturn` Mutates Input Object

```typescript
// Mutates the incoming record
delete vnpParams.vnp_SecureHash;
delete vnpParams.vnp_SecureHashType;
```

If the framework passes the query object by reference and it's shared downstream, this silently corrupts state. `handleVNPayIPN` correctly clones first. `handleVNPayReturn` should too.

#### 🟡 MEDIUM — IPN Returns `RspCode: '00'` for Expired/Mismatched Orders

When a booking is expired or amount mismatches, the code returns `RspCode: '04'`. However, according to VNPay spec, returning anything other than `'00'` causes VNPay to **retry the IPN callback**. Expired orders should still return `'00'` after logging, to stop VNPay from retrying.

#### 🟡 MEDIUM — No IP Allowlisting on IPN Endpoint

The `/vnpay/ipn` endpoint accepts requests from any IP. In production, VNPay IPN calls should originate from known VNPay IP ranges. Without allowlisting, the endpoint is exposed to crafted requests (mitigated by signature check, but defense-in-depth is still missing).

#### 🟢 LOW — `vnp_ReturnUrl` Points to Gateway, Not Frontend

The current `VNPAY_RETURN_URL` default is `http://localhost:3000/payment/return`, which is the API gateway. In production, this should point to the **frontend URL** (Next.js app) so the user lands on a meaningful UI page after payment, not an API endpoint.

---

## 10. Edge Cases

### 10.1 Duplicate IPN Callbacks

VNPay retries IPN if it does not receive `RspCode: '00'`. Handled by:

```typescript
if (
  payment.status !== PaymentStatus.PENDING ||
  payment.booking.status !== BookingStatus.PENDING
) {
  return { data: { RspCode: '02', Message: 'This order has been updated to the payment status' } };
}
```

**Problem**: Returning `'02'` will cause VNPay to keep retrying. The correct response for "already handled" is `'00'`.

### 10.2 User Cancels Payment on VNPay

When a user clicks "Cancel" on the VNPay page:
- VNPay redirects to the return URL with `vnp_ResponseCode = '24'`
- VNPay may also send an IPN with `vnp_TransactionStatus !== '00'`
- The IPN handler will set booking/payment status to `CANCELLED/FAILED`
- The booking's `expires_at` remains set — if it hasn't expired, the user could theoretically retry

**Gap**: There is no explicit handling for `vnp_ResponseCode = '24'` (user cancelled) vs other failure codes. All non-`'00'` transaction statuses are treated identically.

### 10.3 IPN Never Arrives (Network Failure)

If VNPay's IPN never reaches the server:
- Payment stays `PENDING`, booking stays `PENDING`
- The booking will expire via `expires_at` (set at creation time)
- No automated cleanup job is visible in this codebase — expired `PENDING` bookings accumulate

**Gap**: No scheduled job to sweep and cancel expired PENDING bookings/payments.

### 10.4 Amount Mismatch

```typescript
const amount = parseInt(vnpParams.vnp_Amount) / 100;
if (Number(payment.amount) !== amount) {
  return { data: { RspCode: '04', Message: 'Amount invalid' } };
}
```

Handled. However, using `parseInt` on a float string and strict equality comparison with a Prisma `Decimal` could have floating-point edge cases. A tolerance-based comparison (e.g., `Math.abs(a - b) < 0.01`) is safer.

### 10.5 Redis Event Publish Failure

```typescript
try {
  await this.bookingEventService.publishBookingConfirmed({ ... });
} catch (eventError) {
  console.error('[VNPay IPN] Event publish warning:', eventError);
  // Non-critical
}
```

Redis publish failure is swallowed after logging. The DB has already been committed. Downstream consumers (e.g., seat availability cache) may not be notified. This is acceptable only if consumers reconcile against the DB directly.

### 10.6 Zero-Amount Payment

When `final_amount < 1000 VND` (100% voucher coverage), VNPay is bypassed entirely:
- Payment is marked `COMPLETED` immediately
- Booking is confirmed atomically
- `paymentUrl` returned to client is `dto.returnUrl` (no VNPay redirect)

This is a clean design, but it means the frontend must detect the case: if the returned `paymentUrl` equals the `returnUrl` it submitted, no redirect is needed.

---

## 11. Design Evaluation

### Good Practices

- **Amount sourced from DB**: `booking.final_amount` is trusted, not `dto.amount` — prevents client-side price manipulation
- **Atomic DB transaction**: All related records updated together — no partial state corruption
- **IPN as authoritative source**: Return URL is UI-only — correct VNPay pattern
- **Idempotency guard**: Duplicate IPN calls are detected and rejected
- **Async email/SMS**: Notification failures cannot affect payment outcome
- **Zero-amount path**: Voucher-covered bookings skip gateway cleanly

### Bad Practices / Improvement Areas

| Issue | Severity | Fix |
|---|---|---|
| Hardcoded fallback credentials | Critical | Remove fallbacks; throw on missing env |
| Input mutation in `handleVNPayReturn` | Medium | Clone params before deletion |
| `RspCode: '04'` for already-processed orders | Medium | Return `'00'` to stop VNPay retries |
| No IPN IP allowlist | Medium | Add middleware to check VNPay IP ranges |
| No expired booking sweep job | Medium | Add cron job to cancel expired PENDING bookings |
| `vnp_ReturnUrl` points to API | Low | Should point to frontend UI URL |
| `TODO` stubs in email data | Low | `movieTitle`, `cinemaName`, `startTime` are hardcoded placeholders |
| Amount comparison via strict equality on Decimal | Low | Use epsilon-based comparison |

---

## 12. Suggested Improvements for Production

### 12.1 Remove Hardcoded Secrets

```typescript
// ❌ Current
this.vnp_HashSecret = this.configService.get('VNPAY_HASH_SECRET') || 'ID4MX46WVEFNI39KLW9JUFHDR0I4U3IB';

// ✅ Recommended
const secret = this.configService.getOrThrow<string>('VNPAY_HASH_SECRET');
this.vnp_HashSecret = secret;
```

### 12.2 IPN Response for Already-Processed Orders

```typescript
// ❌ Returns '02' → VNPay keeps retrying
return { data: { RspCode: '02', Message: 'Already processed' } };

// ✅ Return '00' → VNPay stops retrying
return { data: { RspCode: '00', Message: 'Already processed' } };
```

### 12.3 Expired Booking Sweep (Scheduled Job)

```typescript
@Cron('*/5 * * * *') // Every 5 minutes
async sweepExpiredBookings() {
  await this.prisma.bookings.updateMany({
    where: {
      status: BookingStatus.PENDING,
      expires_at: { lt: new Date() },
    },
    data: { status: BookingStatus.CANCELLED },
  });
}
```

### 12.4 IPN IP Allowlisting

```typescript
// In API Gateway middleware or guard
const VNPAY_IPS = ['113.52.45.0/24', '113.52.49.0/24']; // example ranges
if (!isIpAllowed(req.ip, VNPAY_IPS)) {
  throw new ForbiddenException('IPN source not trusted');
}
```

### 12.5 Amount Comparison Safety

```typescript
// ❌ Floating point risk
if (Number(payment.amount) !== amount) { ... }

// ✅ Epsilon comparison
if (Math.abs(Number(payment.amount) - amount) > 0.01) { ... }
```

### 12.6 Retry / Dead-Letter Queue for Redis Events

If Redis is down at the moment of IPN, the `booking.confirmed` event is lost. Consider:
- Storing the event in the DB (outbox pattern)
- A background worker that re-publishes undelivered events
- Or using a message broker (RabbitMQ/Kafka) with delivery guarantees

---

## Appendix — File Map

| File | Purpose |
|---|---|
| `apps/booking-service/src/app/payment/payment.service.ts` | All VNPay business logic |
| `apps/booking-service/src/app/payment/payment.controller.ts` | TCP MessagePattern handlers |
| `apps/booking-service/src/app/payment/payment.module.ts` | Module wiring, TCP client to user-service |
| `apps/booking-service/src/app/redis/booking-event.service.ts` | Redis pub/sub for `booking.confirmed` |
| `apps/api-gateway/src/app/module/booking/controller/payment.controller.ts` | HTTP REST endpoints |
| `apps/api-gateway/src/app/module/booking/service/payment.service.ts` | TCP proxy to booking-service |
| `apps/booking-service/prisma/schema.prisma` | `Payments`, `Bookings`, `Tickets` models |
| `apps/booking-service/.env.example` | VNPay env variable reference |
| `libs/shared-types/src/constant/message.ts` | `PaymentMessage` constants |
