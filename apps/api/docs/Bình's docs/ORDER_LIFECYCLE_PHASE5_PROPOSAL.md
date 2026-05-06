# Order Lifecycle — Phase 5 Implementation Proposal

> **Status:** [IMPLEMENTED] ✅
> **Target Module:** `src/module/ordering/order-lifecycle/`
> **Depends on:** Phases 0–4 (all implemented ✅)
> **Source of Truth:** `ORDERING_CONTEXT_PROPOSAL.md` (D6-A + §8)

---

## Table of Contents

1. [Overview](#1-overview)
2. [State Machine](#2-state-machine)
3. [Transition Rules](#3-transition-rules)
4. [Permission Model](#4-permission-model)
5. [Events](#5-events)
6. [OrderStatusLog Strategy](#6-orderstatuslog-strategy)
7. [Timeout Handling](#7-timeout-handling)
8. [Concurrency & Idempotency](#8-concurrency--idempotency)
9. [Error Handling](#9-error-handling)
10. [Edge Cases](#10-edge-cases)
11. [Implementation Plan](#11-implementation-plan)

---

## 1. Overview

Phase 4 creates orders. Phase 5 makes them **move**.

Without Phase 5:

- Restaurant cannot accept, prepare, or cancel orders
- Shippers cannot pick up or deliver
- VNPay orders are permanently stuck in `pending`
- Expired orders accumulate in the DB indefinitely
- `order_status_logs` is always empty — no audit trail

Phase 5 implements the complete **order state machine**: every transition from `pending` through `delivered`, auto-cancellation via timeout, and payment-aware cancellation (refund trigger).

**Cross-BC impact:**

- `OrderReadyForPickupEvent` → Delivery BC dispatches shippers
- `OrderCancelledAfterPaymentEvent` → Payment BC triggers VNPay refunds
- `OrderStatusChangedEvent` → Notification BC sends push alerts

---

## 2. State Machine

### 2.1 States

| State              | Description                                                              |
| ------------------ | ------------------------------------------------------------------------ |
| `pending`          | Order created; awaiting payment (VNPay) or restaurant confirmation (COD) |
| `paid`             | VNPay payment confirmed; awaiting restaurant confirmation                |
| `confirmed`        | Restaurant accepted; not yet preparing                                   |
| `preparing`        | Kitchen is cooking                                                       |
| `ready_for_pickup` | Food ready; awaiting shipper                                             |
| `picked_up`        | Shipper has the food                                                     |
| `delivering`       | Shipper en route to customer                                             |
| `delivered`        | Handed off to customer — terminal (except refund)                        |
| `cancelled`        | Order cancelled — terminal                                               |
| `refunded`         | Refund processed — terminal                                              |

### 2.2 Transition Table

| #    | From               | To                 | Actor(s)                            | Trigger                                  |
| ---- | ------------------ | ------------------ | ----------------------------------- | ---------------------------------------- |
| T-01 | `pending`          | `confirmed`        | restaurant, admin                   | COD: restaurant accepts directly         |
| T-02 | `pending`          | `paid`             | system                              | `PaymentConfirmedEvent` (VNPay only)     |
| T-03 | `pending`          | `cancelled`        | customer, restaurant, admin, system | Manual cancel or timeout                 |
| T-04 | `paid`             | `confirmed`        | restaurant, admin                   | VNPay: restaurant confirms after payment |
| T-05 | `paid`             | `cancelled`        | customer, restaurant, admin, system | Manual cancel or VNPay timeout           |
| T-06 | `confirmed`        | `preparing`        | restaurant, admin                   | Start cooking                            |
| T-07 | `confirmed`        | `cancelled`        | restaurant, admin                   | Restaurant cannot fulfill                |
| T-08 | `preparing`        | `ready_for_pickup` | restaurant, admin                   | Food ready for shipper                   |
| T-09 | `ready_for_pickup` | `picked_up`        | shipper, admin                      | Shipper physically picks up              |
| T-10 | `picked_up`        | `delivering`       | shipper, admin                      | Shipper starts en route                  |
| T-11 | `delivering`       | `delivered`        | shipper, admin                      | Handoff confirmed                        |
| T-12 | `delivered`        | `refunded`         | admin                               | Dispute resolution                       |

> Any `from → to` not in this table → **422 Unprocessable Entity**.

### 2.3 Full State Diagram

**Happy path (all forward transitions):**

```
          ┌── T-01 (restaurant/admin, COD only) ─────────────────────────────────────────────┐
          │                                                                                   │
PENDING ──┤                                                                                   ▼
          └── T-02 (system, VNPay only) ──► PAID ──T-04 (restaurant/admin) ──────────► CONFIRMED
                                                                                             │
                                                                               T-06 (restaurant/admin)
                                                                                             │
                                                                                             ▼
                                                                                         PREPARING
                                                                                             │
                                                                               T-08 (restaurant/admin)
                                                                                             │
                                                                                             ▼
                                                                                    READY_FOR_PICKUP
                                                                                             │
                                                                               T-09 (shipper/admin)
                                                                                             │
                                                                                             ▼
                                                                                         PICKED_UP
                                                                                             │
                                                                               T-10 (shipper/admin)
                                                                                             │
                                                                                             ▼
                                                                                        DELIVERING
                                                                                             │
                                                                               T-11 (shipper/admin)
                                                                                             │
                                                                                             ▼
                                                                      DELIVERED ──T-12 (admin)──► REFUNDED ⊘
```

**Cancellation exits:**

```
PENDING   ──T-03 (customer/restaurant/admin/system)──────────────────────────────────► CANCELLED ⊘
PAID      ──T-05 (customer/restaurant/admin/system)──────────────────────────────────► CANCELLED ⊘
CONFIRMED ──T-07 (restaurant/admin)──────────────────────────────────────────────────► CANCELLED ⊘
```

> `CANCELLED` and `REFUNDED` are terminal — no further transitions.
> `PREPARING` has no cancel path; cancellation at that stage requires an out-of-band process.
> T-05 and T-07 additionally fire `OrderCancelledAfterPaymentEvent` when `paymentMethod === 'vnpay'`.

### 2.4 `ALLOWED_TRANSITIONS` Map (D6-A — canonical)

```typescript
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'confirmed', 'cancelled'],
  paid: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready_for_pickup'],
  ready_for_pickup: ['picked_up'],
  picked_up: ['delivering'],
  delivering: ['delivered'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};
```

---

## 3. Transition Rules

### T-01: `pending → confirmed` (COD — Restaurant Accepts)

|                  |                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| **Actor**        | `restaurant`, `admin`                                                                             |
| **Precondition** | `order.paymentMethod === 'cod'` (admin bypasses this check)                                       |
| **Ownership**    | Restaurant: `snapshot.ownerId === req.user.id` AND `snapshot.restaurantId === order.restaurantId` |
| **Events**       | `OrderStatusChangedEvent`                                                                         |

---

### T-02: `pending → paid` (VNPay — System Only)

|                  |                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------- |
| **Actor**        | `system` — internal event handler only; no HTTP endpoint                                |
| **Trigger**      | `PaymentConfirmedEventHandler` on `PaymentConfirmedEvent`                               |
| **Precondition** | `order.paymentMethod === 'vnpay'` (silently discard if COD)                             |
| **Precondition** | `Math.abs(event.paidAmount - order.totalAmount) <= 0.01` (epsilon, not strict equality) |
| **Log**          | `triggeredBy=null, triggeredByRole='system', note='PaymentConfirmed'`                   |
| **Events**       | `OrderStatusChangedEvent`                                                               |

---

### T-03: `pending → cancelled` (Cancel Before Payment)

|                  |                                                                               |
| ---------------- | ----------------------------------------------------------------------------- |
| **Actor**        | `customer`, `restaurant`, `admin`, `system` (timeout cron)                    |
| **Ownership**    | Customer: `order.customerId === req.user.id`; Restaurant: owns the restaurant |
| **Precondition** | System actor: `order.expiresAt < NOW()`                                       |
| **Note**         | Required: cancellation reason                                                 |
| **Events**       | `OrderStatusChangedEvent` only — no refund (order was never paid)             |

---

### T-04: `paid → confirmed` (VNPay — Restaurant Accepts)

|               |                                                |
| ------------- | ---------------------------------------------- |
| **Actor**     | `restaurant`, `admin`                          |
| **Ownership** | Restaurant: `snapshot.ownerId === req.user.id` |
| **Events**    | `OrderStatusChangedEvent`                      |

---

### T-05: `paid → cancelled` (Cancel After VNPay Payment)

|               |                                                                                   |
| ------------- | --------------------------------------------------------------------------------- |
| **Actor**     | `customer`, `restaurant`, `admin`, `system` (VNPay timeout)                       |
| **Ownership** | Customer: owns order; Restaurant: owns restaurant                                 |
| **Note**      | Required: cancellation reason                                                     |
| **Events**    | `OrderStatusChangedEvent` + `OrderCancelledAfterPaymentEvent`                     |
| ⚠️            | Always triggers refund event — order was paid. `cancelledByRole` passed to event. |

---

### T-06: `confirmed → preparing`

|               |                            |
| ------------- | -------------------------- |
| **Actor**     | `restaurant`, `admin`      |
| **Ownership** | Restaurant: owns the order |
| **Events**    | `OrderStatusChangedEvent`  |

---

### T-07: `confirmed → cancelled` (Restaurant Cannot Fulfill)

|               |                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------- |
| **Actor**     | `restaurant`, `admin`                                                                              |
| **Ownership** | Restaurant: owns the order                                                                         |
| **Note**      | Required: cancellation reason                                                                      |
| **Events**    | `OrderStatusChangedEvent` + `OrderCancelledAfterPaymentEvent` if `order.paymentMethod === 'vnpay'` |
| ⚠️            | VNPay orders: a confirmed order was already paid — refund is required                              |

---

### T-08: `preparing → ready_for_pickup`

|               |                                                        |
| ------------- | ------------------------------------------------------ |
| **Actor**     | `restaurant`, `admin`                                  |
| **Ownership** | Restaurant: owns the order                             |
| **Events**    | `OrderStatusChangedEvent` + `OrderReadyForPickupEvent` |

---

### T-09: `ready_for_pickup → picked_up`

|                 |                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------- |
| **Actor**       | `shipper`, `admin`                                                                            |
| **Ownership**   | Any authenticated shipper may self-assign (first-come); sets `orders.shipperId = req.user.id` |
| **Side effect** | Write `shipperId` to `orders` row inside the DB transaction                                   |
| **Events**      | `OrderStatusChangedEvent`                                                                     |

---

### T-10: `picked_up → delivering`

|               |                                                  |
| ------------- | ------------------------------------------------ |
| **Actor**     | `shipper`, `admin`                               |
| **Ownership** | `order.shipperId === req.user.id` (admin exempt) |
| **Events**    | `OrderStatusChangedEvent`                        |

---

### T-11: `delivering → delivered`

|               |                                                  |
| ------------- | ------------------------------------------------ |
| **Actor**     | `shipper`, `admin`                               |
| **Ownership** | `order.shipperId === req.user.id` (admin exempt) |
| **Events**    | `OrderStatusChangedEvent`                        |

---

### T-12: `delivered → refunded`

|            |                           |
| ---------- | ------------------------- |
| **Actor**  | `admin` only              |
| **Note**   | Required: refund reason   |
| **Events** | `OrderStatusChangedEvent` |

---

## 4. Permission Model

### Role → Allowed Transitions

| Role         | Transitions                        | Ownership Check                                                                                   |
| ------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `customer`   | T-03, T-05                         | `order.customerId === req.user.id`                                                                |
| `restaurant` | T-01, T-04, T-05, T-06, T-07, T-08 | `ordering_restaurant_snapshots.ownerId === req.user.id` AND `restaurantId === order.restaurantId` |
| `shipper`    | T-09 (self-assign), T-10, T-11     | T-09: any shipper; T-10/T-11: `order.shipperId === req.user.id`                                   |
| `admin`      | All transitions (T-01 – T-12)      | None — admin bypasses all ownership checks                                                        |
| `system`     | T-02, T-03, T-05                   | None — internal only                                                                              |

### Ownership Verification Details

| Actor                | How to verify                                                                                           | Data source                     |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Customer             | `order.customerId === req.user.id`                                                                      | `orders` DB row                 |
| Restaurant           | Query `ordering_restaurant_snapshots WHERE restaurantId = order.restaurantId AND ownerId = req.user.id` | `ordering_restaurant_snapshots` |
| Shipper (T-10, T-11) | `order.shipperId === req.user.id`                                                                       | `orders` DB row                 |
| Admin                | Always permitted                                                                                        | JWT role claim                  |

> **Permission enforcement:** Service-level, not controller guards. Complex multi-role conditions are co-located with the state machine for testability and correctness.

> **D3-B:** The Ordering BC never imports `RestaurantModule`. Restaurant ownership is verified through the local `ordering_restaurant_snapshots` projection. See §11 Prerequisites for the required `ownerId` column.

---

## 5. Events

### Events Published per Transition

| Transition                                 | Event(s) Published                  | Consumer        |
| ------------------------------------------ | ----------------------------------- | --------------- |
| Every transition                           | `OrderStatusChangedEvent`           | Notification BC |
| T-08 (`preparing → ready_for_pickup`)      | + `OrderReadyForPickupEvent`        | Delivery BC     |
| T-05 (`paid → cancelled`)                  | + `OrderCancelledAfterPaymentEvent` | Payment BC      |
| T-07 (`confirmed → cancelled`, VNPay only) | + `OrderCancelledAfterPaymentEvent` | Payment BC      |

### Refund Event Rule

`OrderCancelledAfterPaymentEvent` fires when **all three** conditions are true:

1. The transition leads to `cancelled`
2. `order.paymentMethod === 'vnpay'`
3. The order has already been paid (from state is `paid` or later — i.e., T-05 and T-07)

### Event Publishing Timing

Always publish **after** the DB transaction commits:

```typescript
await this.db.transaction(async (tx) => {
  await tx.update(orders).set({ status: toStatus, version: order.version + 1, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.version, order.version)));
  await tx.insert(orderStatusLogs).values({ orderId, fromStatus: order.status, toStatus, triggeredBy: actorId, triggeredByRole: actorRole, note });
}); // ← commit here

// Publish only after successful commit
this.eventBus.publish(new OrderStatusChangedEvent(...));
if (rule.triggersReadyForPickup) this.eventBus.publish(new OrderReadyForPickupEvent(...));
if (rule.triggersRefundIfVnpay && order.paymentMethod === 'vnpay') {
  this.eventBus.publish(new OrderCancelledAfterPaymentEvent(...));
}
```

> If event publishing throws after a successful commit: log at `ERROR` level with `orderId`. The DB state is correct; the downstream miss is observable and can be re-triggered manually.

---

## 6. OrderStatusLog Strategy

Every transition inserts a row into `order_status_logs` **inside the same DB transaction** as the status update — they are atomic.

```typescript
await tx.insert(orderStatusLogs).values({
  orderId,
  fromStatus: order.status, // current status before transition
  toStatus,
  triggeredBy: actorId ?? null, // null for system
  triggeredByRole: actorRole,
  note: note ?? null,
});
```

### Logging Rules

| Actor                  | `triggeredBy` | `triggeredByRole` | `note`                                                        |
| ---------------------- | ------------- | ----------------- | ------------------------------------------------------------- |
| Customer               | `req.user.id` | `'customer'`      | Optional                                                      |
| Restaurant             | `req.user.id` | `'restaurant'`    | Required for cancel                                           |
| Shipper                | `req.user.id` | `'shipper'`       | Optional                                                      |
| Admin                  | `req.user.id` | `'admin'`         | Required for cancel/refund                                    |
| System (payment event) | `null`        | `'system'`        | `'PaymentConfirmed'`                                          |
| System (timeout cron)  | `null`        | `'system'`        | `'Order expired — no restaurant confirmation within timeout'` |

---

## 7. Timeout Handling

### Strategy: `@nestjs/schedule` Cron (every minute)

`orders.expiresAt` is set at checkout to `NOW() + RESTAURANT_ACCEPT_TIMEOUT_SECONDS` (Phase 4, Step 9).

The cron finds expired orders in `pending` or `paid` state and auto-cancels them:

```typescript
@Cron(CronExpression.EVERY_MINUTE)
async handleExpiredOrders(): Promise<void> {
  const expired = await this.orderRepo.findExpiredPendingOrPaid();
  for (const order of expired) {
    await this.commandBus.execute(
      new TransitionOrderCommand(
        order.id,
        'cancelled',
        null,
        'system',
        'Order expired — no restaurant confirmation within timeout',
      ),
    );
  }
}
```

**`findExpiredPendingOrPaid` query:**

```sql
SELECT id, status FROM orders
WHERE status IN ('pending', 'paid') AND expires_at < NOW()
```

**Timeout behavior by payment method:**

- `pending` (COD or pre-payment VNPay): T-03 fires — no refund event
- `paid` (VNPay paid but not confirmed by restaurant): T-05 fires — refund event published

**Multi-pod safety:** If two instances run concurrently, the second instance will find the order already `cancelled` and the transition will no-op silently (idempotency guard).

**Acceptable delay:** Up to 60 seconds between expiry and actual cancellation. Acceptable for MVP.

---

## 8. Concurrency & Idempotency

### Race Condition: Multiple Shippers Claiming T-09

Two shippers simultaneously press "Accept Pickup" for the same `ready_for_pickup` order.

**Guard:** Optimistic locking via `version` column on `orders`:

```typescript
// Inside transaction:
const result = await tx
  .update(orders)
  .set({
    status: toStatus,
    shipperId: actorId,
    version: order.version + 1,
    updatedAt: new Date(),
  })
  .where(
    and(
      eq(orders.id, orderId),
      eq(orders.status, order.status), // fromStatus must still be current
      eq(orders.version, order.version), // optimistic lock
    ),
  )
  .returning();

if (result.length === 0) {
  throw new ConflictException(
    'Order was modified concurrently. Please refresh and retry.',
  );
}
```

The same pattern applies to any concurrent transition attempt.

### Idempotency: Duplicate Requests

If the order is already in the target status:

```typescript
if (order.status === toStatus) {
  return order; // no-op — safe for system-triggered transitions (payment events, timeout)
}
```

For HTTP requests from human actors, the order is likely in an unexpected state due to a concurrent update — return 409 so the client can refresh and retry.

---

## 9. Error Handling

| Scenario                                             | Exception                      | HTTP |
| ---------------------------------------------------- | ------------------------------ | ---- |
| `from → to` not in `ALLOWED_TRANSITIONS`             | `UnprocessableEntityException` | 422  |
| Actor role not in `allowedRoles` for this transition | `ForbiddenException`           | 403  |
| Ownership check fails                                | `ForbiddenException`           | 403  |
| Order not found                                      | `NotFoundException`            | 404  |
| Concurrent update (optimistic lock miss)             | `ConflictException`            | 409  |
| Cancel transition without a note                     | `BadRequestException`          | 400  |

**Special cases:**

```typescript
// PaymentConfirmedEvent for a COD order — silently discard:
if (order.paymentMethod !== 'vnpay') {
  this.logger.warn(
    `PaymentConfirmedEvent for COD order ${orderId} — ignoring.`,
  );
  return;
}

// T-02 paidAmount mismatch — use epsilon comparison, never strict equality:
if (Math.abs(event.paidAmount - order.totalAmount) > 0.01) {
  this.logger.warn(
    `PaymentConfirmedEvent paidAmount mismatch on order ${orderId} — ignoring.`,
  );
  return; // do not throw — prevents silent order abandonment
}
```

---

## 10. Edge Cases

### Cancel After VNPay Payment (T-05)

Customer or restaurant cancels an order already in `paid` state.

1. T-05: `paid → cancelled`
2. `order.paymentMethod === 'vnpay'` → publish `OrderCancelledAfterPaymentEvent(paidAmount = order.totalAmount, cancelledByRole = actorRole)`
3. Payment BC receives event and initiates VNPay refund asynchronously (stub until Phase 6)

### VNPay Order Confirmed Then Cancelled (T-07)

Restaurant accepts a VNPay order (`confirmed`) then cancels due to kitchen capacity.

- Order was already `paid` before reaching `confirmed`
- `paymentMethod === 'vnpay'` → publish `OrderCancelledAfterPaymentEvent`
- Same refund path as T-05

### VNPay Order Timeout in `paid` State

Restaurant ignores a paid VNPay order until `expiresAt` is exceeded.

- Cron dispatches `TransitionOrderCommand(id, 'cancelled', null, 'system', 'Order expired...')`
- T-05 (`paid → cancelled`) fires — `system` is in the allowed roles
- Refund event is published automatically

### `preparing → cancelled` Is Not Supported

Once an order reaches `preparing`, **no actor — including admin — can cancel it** through the lifecycle API. There is no `preparing → cancelled` transition (`ALLOWED_TRANSITIONS['preparing'] = ['ready_for_pickup']`).

If cancellation is needed at this stage, it requires a manual out-of-band process. This matches the canonical D6-A definition.

### `PaymentConfirmedEvent` for a COD Order

Should never happen. If it does, the handler logs a warning and returns silently. Do not throw — a thrown exception would cause the event bus to retry infinitely.

### `PaymentFailedEvent` — No Cart Recovery

The cart was already deleted at checkout (Phase 4, Step 13). `PaymentFailedEventHandler` must only:

1. Dispatch `TransitionOrderCommand(orderId, 'cancelled', null, 'system', event.reason)`
2. Log at `INFO` level

Cart recovery is a UI concern — the frontend prompts the customer to place a new order.

---

## 11. Implementation Plan

### Prerequisites (complete before writing Phase 5 code)

| #   | Change                                                                                | Why                              | Status        |
| --- | ------------------------------------------------------------------------------------- | -------------------------------- | ------------- |
| 1   | Add `ownerId: uuid('owner_id').notNull()` to `ordering_restaurant_snapshots` schema   | Restaurant ownership check in §4 | [IMPLEMENTED] |
| 2   | Add `ownerId: string` to `RestaurantUpdatedEvent` constructor                         | Propagate ownerId to snapshot    | [IMPLEMENTED] |
| 3   | Update `RestaurantSnapshotProjector` to persist `ownerId` from event                  | Populate the new column          | [IMPLEMENTED] |
| 4   | Update `RestaurantService` to include `ownerId` in published `RestaurantUpdatedEvent` | Source the value                 | [IMPLEMENTED] |

| 7 | Extend `OrderCancelledAfterPaymentEvent.cancelledByRole` → `'customer' \| 'restaurant' \| 'admin' \| 'system'` | Admin triggers T-07; system triggers T-05 timeout | [IMPLEMENTED] |
| 8 | Install: `pnpm add @nestjs/schedule --filter api` | Timeout cron required | [IMPLEMENTED] |
| 9 | Add `ScheduleModule.forRoot()` to `app.module.ts` imports | Register cron scheduler | [IMPLEMENTED] |
| 10 | Fix comment in `payment-failed.event.ts` — remove "cart recovery" reference | Cart is already deleted at checkout | [IMPLEMENTED] |

### Files to Create

```
src/module/ordering/order-lifecycle/
├── order-lifecycle.module.ts           ← register all providers/controllers
│
├── constants/
│   └── transitions.ts                  ← TRANSITIONS combined map + ALLOWED_TRANSITIONS
│
├── commands/
│   ├── transition-order.command.ts     ← TransitionOrderCommand class
│   └── transition-order.handler.ts     ← core state machine logic
│
├── events/
│   ├── payment-confirmed.handler.ts    ← PaymentConfirmedEvent → T-02 (pending→paid)
│   └── payment-failed.handler.ts       ← PaymentFailedEvent → T-03 (pending→cancelled)
│
├── tasks/
│   └── order-timeout.task.ts           ← @Cron: detect expired orders, cancel
│
├── controllers/
│   └── order-lifecycle.controller.ts   ← HTTP endpoints
│
├── dto/
│   ├── transition-order.dto.ts
│   └── cancel-order.dto.ts             ← { reason: string }
│
├── services/
│   └── order-lifecycle.service.ts      ← ownership checks, COD precondition
│
└── repositories/
    └── order.repository.ts             ← findById, findExpiredPendingOrPaid
```

### HTTP API

```
PATCH  /orders/:id/confirm          → T-01  actors: restaurant, admin
PATCH  /orders/:id/start-preparing  → T-06  actors: restaurant, admin
PATCH  /orders/:id/ready            → T-08  actors: restaurant, admin
PATCH  /orders/:id/pickup           → T-09  actors: shipper, admin
PATCH  /orders/:id/en-route         → T-10  actors: shipper, admin
PATCH  /orders/:id/deliver          → T-11  actors: shipper, admin
PATCH  /orders/:id/cancel           → T-03 / T-05 / T-07   body: { reason: string }
POST   /orders/:id/refund           → T-12  actors: admin only
GET    /orders/:id                  → get current order state + items
GET    /orders/:id/timeline         → get OrderStatusLog history
```

### `TransitionOrderCommand`

```typescript
export class TransitionOrderCommand {
  constructor(
    public readonly orderId: string,
    public readonly toStatus: OrderStatus,
    public readonly actorId: string | null, // null for system
    public readonly actorRole: TriggeredByRole,
    public readonly note?: string,
  ) {}
}
```

### `transitions.ts` — Combined Map

Using a single combined structure avoids the dual-maintenance hazard of keeping `ALLOWED_TRANSITIONS` and a separate permissions record in sync.

```typescript
import type { OrderStatus, TriggeredByRole } from '../order/order.schema';

type TransitionRule = {
  allowedRoles: TriggeredByRole[];
  requireNote?: boolean;
  triggersRefundIfVnpay?: boolean;
  triggersReadyForPickup?: boolean;
};

/** Single source of truth for all transition rules. */
export const TRANSITIONS: Partial<
  Record<`${OrderStatus}→${OrderStatus}`, TransitionRule>
> = {
  'pending→paid': { allowedRoles: ['system'] },
  'pending→confirmed': { allowedRoles: ['restaurant', 'admin'] },
  'pending→cancelled': {
    allowedRoles: ['customer', 'restaurant', 'admin', 'system'],
    requireNote: true,
  },
  'paid→confirmed': { allowedRoles: ['restaurant', 'admin'] },
  'paid→cancelled': {
    allowedRoles: ['customer', 'restaurant', 'admin', 'system'],
    requireNote: true,
    triggersRefundIfVnpay: true,
  },
  'confirmed→preparing': { allowedRoles: ['restaurant', 'admin'] },
  'confirmed→cancelled': {
    allowedRoles: ['restaurant', 'admin'],
    requireNote: true,
    triggersRefundIfVnpay: true,
  },
  'preparing→ready_for_pickup': {
    allowedRoles: ['restaurant', 'admin'],
    triggersReadyForPickup: true,
  },
  'ready_for_pickup→picked_up': { allowedRoles: ['shipper', 'admin'] },
  'picked_up→delivering': { allowedRoles: ['shipper', 'admin'] },
  'delivering→delivered': { allowedRoles: ['shipper', 'admin'] },
  'delivered→refunded': { allowedRoles: ['admin'], requireNote: true },
};

/** Derived from TRANSITIONS — used for fast first-pass validation. */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'confirmed', 'cancelled'],
  paid: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready_for_pickup'],
  ready_for_pickup: ['picked_up'],
  picked_up: ['delivering'],
  delivering: ['delivered'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};
```

### Handler Core Logic (Pseudocode)

```typescript
async execute(cmd: TransitionOrderCommand): Promise<Order> {
  const { orderId, toStatus, actorId, actorRole, note } = cmd;

  // 1. Load order
  const order = await this.orderRepo.findById(orderId);
  if (!order) throw new NotFoundException(`Order ${orderId} not found`);

  // 2. Idempotency — already in target state (safe for system transitions)
  if (order.status === toStatus) return order;

  // 3. Validate transition exists
  const rule = TRANSITIONS[`${order.status}→${toStatus}`];
  if (!rule) {
    throw new UnprocessableEntityException(
      `Cannot transition order from '${order.status}' to '${toStatus}'.`,
    );
  }

  // 4. Check actor role
  if (!rule.allowedRoles.includes(actorRole)) {
    throw new ForbiddenException(`Role '${actorRole}' cannot perform this transition.`);
  }

  // 5. Ownership check
  await this.lifecycleService.assertOwnership(order, actorId, actorRole);

  // 6. COD-only precondition for T-01
  if (order.status === 'pending' && toStatus === 'confirmed' && actorRole !== 'admin') {
    if (order.paymentMethod !== 'cod') {
      throw new UnprocessableEntityException(
        'VNPay orders cannot be confirmed directly. Wait for PaymentConfirmedEvent.',
      );
    }
  }

  // 7. Note requirement
  if (rule.requireNote && !note?.trim()) {
    throw new BadRequestException('A reason note is required for this transition.');
  }

  // 8. DB transaction — atomic status update + log
  const updated = await this.db.transaction(async (tx) => {
    const setClause: Partial<Order> = {
      status: toStatus,
      version: order.version + 1,
      updatedAt: new Date(),
    };

    // T-09: self-assign shipper on first pickup
    if (order.status === 'ready_for_pickup' && toStatus === 'picked_up' && actorRole === 'shipper') {
      setClause.shipperId = actorId!;
    }

    const result = await tx.update(orders)
      .set(setClause)
      .where(and(eq(orders.id, orderId), eq(orders.version, order.version)))
      .returning();

    if (result.length === 0) {
      throw new ConflictException('Order was modified concurrently. Please refresh and retry.');
    }

    await tx.insert(orderStatusLogs).values({
      orderId,
      fromStatus: order.status,
      toStatus,
      triggeredBy: actorId ?? null,
      triggeredByRole: actorRole,
      note: note ?? null,
    });

    return result[0];
  });

  // 9. Publish events after commit
  this.eventBus.publish(
    new OrderStatusChangedEvent(orderId, order.customerId, order.restaurantId, order.status, toStatus, actorRole, note),
  );

  if (rule.triggersReadyForPickup) {
    this.eventBus.publish(new OrderReadyForPickupEvent(...));
  }

  if (rule.triggersRefundIfVnpay && order.paymentMethod === 'vnpay') {
    this.eventBus.publish(
      new OrderCancelledAfterPaymentEvent(
        orderId, order.customerId, 'vnpay', order.totalAmount,
        new Date(), actorRole as 'customer' | 'restaurant' | 'admin' | 'system',
      ),
    );
  }

  return updated;
}
```

### Implementation Order

Build in this order to keep each step independently testable:

1. `transitions.ts` — define `TRANSITIONS` and `ALLOWED_TRANSITIONS` — [IMPLEMENTED]
2. `order.repository.ts` — `findById`, `findExpiredPendingOrPaid` — [IMPLEMENTED]
3. `transition-order.command.ts` + `transition-order.handler.ts` — core logic — [IMPLEMENTED]
4. `order-lifecycle.service.ts` — ownership checks — [IMPLEMENTED]
5. `order-lifecycle.controller.ts` — HTTP endpoints — [IMPLEMENTED]
6. `payment-confirmed.handler.ts` + `payment-failed.handler.ts` — [IMPLEMENTED]
7. `order-timeout.task.ts` — [IMPLEMENTED]
8. `order-lifecycle.module.ts` — wire all providers, `CqrsModule`, `ScheduleModule` — [IMPLEMENTED]

---

## Self-Review Checklist

### Alignment with `ORDERING_CONTEXT_PROPOSAL.md`

- [x] All 10 order states present and named correctly
- [x] `ALLOWED_TRANSITIONS` exactly matches canonical D6-A
- [x] 12 transitions exactly match §8 state diagram and §5 Phase 5 permission table
- [x] COD path: `pending → confirmed` (T-01) — restaurant, no `paid` state
- [x] VNPay path: `pending → paid → confirmed` (T-02, T-04) — system + restaurant
- [x] VNPay payment failure: `pending → cancelled` (T-03) via `PaymentFailedEvent`
- [x] D3-B respected — no `RestaurantModule` import; ownership via ACL snapshot
- [x] D6-A respected — hand-crafted transition table, no XState

### Correctness

- [x] `system` actor in `paid→cancelled` permissions — timeout cancels VNPay paid orders
- [x] `OrderCancelledAfterPaymentEvent.cancelledByRole` extended to `'customer' | 'restaurant' | 'admin' | 'system'`
- [x] `paidAmount` comparison uses epsilon, not strict equality
- [x] `payment-failed.event.ts` cart recovery reference removed
- [x] `@nestjs/schedule` install listed as prerequisite
- [x] `ownerId` prerequisite on `ordering_restaurant_snapshots` documented

### Practicality

- [x] One `TransitionOrderCommand` for all transitions (D1-C)
- [x] No XState, no Bull queues, no outbox pattern
- [x] ~10 new files
- [x] Two DB migrations (`version`, `shipperId`)
- [x] Combined `TRANSITIONS` map eliminates dual-maintenance hazard

---

## Change Summary

### Removed

| Removed                                                          | Reason                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| §2 "Current System Analysis" (what exists / gap analysis)        | Already implemented — not useful for implementation guide          |
| §11 "Design Options & Trade-offs"                                | All decisions are made; options discussion adds noise              |
| §13 "Risks & Mitigations" table                                  | Integrated into relevant sections                                  |
| §14 "Final Recommended Architecture"                             | Content merged into §11 Implementation Plan                        |
| §17 "Architecture Review — Principal Architect Validation"       | All issues resolved in this refactor                               |
| T-09 (`preparing → cancelled`)                                   | Not in canonical `ALLOWED_TRANSITIONS` D6-A                        |
| T-13 (`picked_up → delivered`)                                   | Not in canonical D6-A; was dead code (not in transitions array)    |
| T-15 (`cancelled → refunded`)                                    | Not in canonical D6-A (`cancelled: []`); no business justification |
| Verbose prose in T-10 through T-15 (collapsed as "same pattern") | Each transition now has a full rule table                          |

### Simplified

| Simplified           | How                                                            |
| -------------------- | -------------------------------------------------------------- |
| Transition numbering | Renumbered T-01 through T-12 (was T-01 through T-15)           |
| Permission model     | Role table replaces ASCII-box diagrams                         |
| Timeout handling     | Decision final (Option A — cron); Options B and C removed      |
| Concurrency          | Single idempotency approach (no-op); option comparison removed |
| Command design       | Decision final; section removed                                |
| HTTP API design      | Decision final; section removed                                |

### Aligned with `ORDERING_CONTEXT_PROPOSAL.md`

| Issue                                       | Fix Applied                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| C-1: `cancelledByRole` type error           | Extended `OrderCancelledAfterPaymentEvent.cancelledByRole` to include `'admin' \| 'system'` |
| C-2: `ALLOWED_TRANSITIONS` deviations       | Removed T-09, T-13, T-15; matches D6-A verbatim                                             |
| C-4: `ownerId` field missing from snapshot  | Added as prerequisite items 1–4 in §11                                                      |
| C-6: `system` missing from `paid→cancelled` | Added to `TRANSITIONS` map                                                                  |
| M-1: T-05 "only" refund trigger claim       | Removed — T-05 and T-07 both trigger refund                                                 |
| M-2: `@nestjs/schedule` not optional        | Listed as required install in prerequisites                                                 |
| M-3: float equality fragile                 | Epsilon comparison in T-02 and §9                                                           |
| M-4: T-15 no justification                  | T-15 removed entirely                                                                       |
| M-5: cart recovery in `PaymentFailedEvent`  | Documented as impossible; added to §10 Edge Cases                                           |
| OE-1: dual-maintenance hazard               | Single `TRANSITIONS` map replaces two separate records                                      |
