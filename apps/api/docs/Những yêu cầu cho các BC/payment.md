# Required Changes — Payment Context

**Document Type:** Integration Contract  
**Ordering Phase Dependency:** Phase 4 (Order Placement), Phase 5 (Order Lifecycle)  
**Status:** Required before Phase 4 is considered end-to-end complete

---

## Overview

The Ordering bounded context integrates with the Payment context via **domain events only** — no direct service calls, no shared tables.

This document lists what the Payment context must provide so the Ordering context can:
1. Advance a VNPay order from `PENDING → PAID` after successful payment
2. Cancel a VNPay order when payment fails or times out
3. Trigger a refund for `PAID → CANCELLED` scenarios

---

## 1. Events to Publish (REQUIRED)

### 1.1 `PaymentConfirmedEvent`

**File:** `src/shared/events/payment-confirmed.event.ts`

**Published when:** VNPay payment gateway confirms successful payment.

**Consumed by:** Ordering context — `PaymentConfirmedHandler`  
**Effect:** Transitions order `PENDING → PAID`

**Required payload:**
```typescript
export class PaymentConfirmedEvent {
  constructor(
    public readonly orderId: string,        // UUID
    public readonly customerId: string,     // UUID
    public readonly paymentMethod: 'vnpay',
    public readonly paidAmount: number,     // matches orders.total_amount
    public readonly paidAt: Date,
  ) {}
}
```

**Why it is required:**
- The `PAID` state is exclusive to VNPay orders (see ORDERING_CONTEXT_PROPOSAL §8.3).
- `PENDING → PAID` must ONLY be triggered by this system event, never by a direct
  user API call.
- Without this event, VNPay orders are stuck in `PENDING` indefinitely and will
  eventually be auto-cancelled by the OrderTimeoutTask (undesirable UX).

---

### 1.2 `PaymentFailedEvent`

**File:** `src/shared/events/payment-failed.event.ts`

**Published when:** VNPay payment gateway returns a failure response or the payment
session expires.

**Consumed by:** Ordering context — `PaymentFailedHandler`  
**Effect:** Transitions order `PENDING → CANCELLED`

**Required payload:**
```typescript
export class PaymentFailedEvent {
  constructor(
    public readonly orderId: string,    // UUID
    public readonly customerId: string, // UUID
    public readonly paymentMethod: 'vnpay',
    public readonly reason: string,     // human-readable failure reason
    public readonly failedAt: Date,
  ) {}
}
```

**Why it is required:**
- Without this event, a failed VNPay payment leaves the order in `PENDING`, which
  will time out but only after `RESTAURANT_ACCEPT_TIMEOUT_SECONDS` — creating
  confusion for the customer who already knows the payment failed.
- Ordering relies on this to cancel promptly and release the cart lock.

---

## 2. Event Ordering Receives (OUTGOING — for Payment Context to react to)

### 2.1 `OrderPlacedEvent` (published by Ordering)

**File:** `src/shared/events/order-placed.event.ts` ← defined in Phase 0

**The Payment context must handle this event to:**
- For `paymentMethod = 'vnpay'`: create a VNPay payment session and return a
  payment URL (stored in `orders.payment_url` by Ordering at order creation time).
- For `paymentMethod = 'cod'`: record a COD payment entry (no user action needed).

**Payload the Payment context receives:**
```typescript
{
  orderId: string,
  customerId: string,
  restaurantId: string,
  restaurantName: string,
  totalAmount: number,
  paymentMethod: 'cod' | 'vnpay',
  items: Array<{ menuItemId, name, quantity, unitPrice }>,
  deliveryAddress: { street, district, city, latitude?, longitude? },
}
```

---

### 2.2 `OrderCancelledAfterPaymentEvent` (published by Ordering)

**File:** `src/shared/events/order-cancelled-after-payment.event.ts`

**Published when:** A `PAID` order is cancelled by a customer or restaurant.

**The Payment context must handle this event to:** Initiate a VNPay refund.

**Payload:**
```typescript
{
  orderId: string,
  customerId: string,
  paymentMethod: 'vnpay',
  paidAmount: number,    // amount to refund
  cancelledAt: Date,
  cancelledByRole: 'customer' | 'restaurant',
}
```

---

## 3. Implementation Guidance

### How to publish events (using `@nestjs/cqrs` EventBus):

```typescript
// In your Payment service / event handler:
import { EventBus } from '@nestjs/cqrs';
import { PaymentConfirmedEvent } from '../../../shared/events/payment-confirmed.event';

constructor(private readonly eventBus: EventBus) {}

// After VNPay callback confirmation:
this.eventBus.publish(
  new PaymentConfirmedEvent(orderId, customerId, 'vnpay', paidAmount, new Date()),
);
```

**Important:** Import `CqrsModule` in the Payment module:
```typescript
@Module({ imports: [CqrsModule], ... })
export class PaymentModule {}
```

---

## 4. Missing Fields in Ordering Schema

The `orders` table is designed to accommodate Payment context integration:

| Field          | Type   | Purpose                                         |
|----------------|--------|-------------------------------------------------|
| `payment_url`  | TEXT   | Stores VNPay redirect URL returned after `OrderPlacedEvent` |
| `payment_method` | ENUM | `cod` or `vnpay` — drives state machine logic  |

No additional schema changes are required in the Ordering context for Payment integration.

---

## 5. Phase Dependency

| Phase | Dependency on Payment Context                                |
|-------|--------------------------------------------------------------|
| Phase 4 | Payment context must handle `OrderPlacedEvent` to generate VNPay URL |
| Phase 5 | Payment context must publish `PaymentConfirmedEvent` and `PaymentFailedEvent` |
| Phase 6 | Full event stubs wired end-to-end                           |
