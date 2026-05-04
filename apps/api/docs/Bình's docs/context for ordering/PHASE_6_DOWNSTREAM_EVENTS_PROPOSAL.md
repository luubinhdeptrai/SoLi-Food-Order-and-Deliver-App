# Phase 6 — Downstream Event Stubs

> **Document Type:** Architectural Proposal
> **Author Role:** Senior Software Architect
> **Status:** 🔲 PENDING IMPLEMENTATION
> **Depends On:** Phase 4 (Order Placement), Phase 5 (Order Lifecycle)
> **Target:** `apps/api/src/module/`
> **Verified Against:** Full codebase audit — all facts cross-checked with source files

---

## Table of Contents

1. [Overview](#1-overview)
2. [Current Event Analysis](#2-current-event-analysis)
3. [Downstream Context Responsibilities](#3-downstream-context-responsibilities)
4. [Design Options](#4-design-options)
5. [Event Contracts](#5-event-contracts)
6. [Stub Handler Design](#6-stub-handler-design)
7. [Event Flow End-to-End](#7-event-flow-end-to-end)
8. [Failure Handling Strategy](#8-failure-handling-strategy)
9. [Event Versioning Strategy](#9-event-versioning-strategy)
10. [Testing Strategy](#10-testing-strategy)
11. [Trade-off Analysis](#11-trade-off-analysis)
12. [Final Recommendation](#12-final-recommendation)
13. [Folder Structure Proposal](#13-folder-structure-proposal)

---

## 1. Overview

### Why Phase 6 Exists

Phases 4 and 5 built a complete, tested Ordering core: cart, checkout, pricing, state machine, and event publishing. However, the events that Ordering publishes — `OrderPlacedEvent`, `OrderStatusChangedEvent`, `OrderReadyForPickupEvent`, `OrderCancelledAfterPaymentEvent` — currently have **no registered consumers** in the codebase. They are published on the NestJS CQRS `EventBus` and silently dropped.

Phase 6 changes that: it wires up **stub event handlers** in the Payment, Delivery, and Notification contexts so the full integration boundary is tested and observable **before** those contexts are fully implemented.

### What Phase 6 Delivers

| Deliverable | Description |
| --- | --- |
| **Stub handlers** | `@EventsHandler` classes in Payment, Delivery, Notification that receive Ordering events and log receipt |
| **Event contract lock-in** | Confirms the TypeScript event shapes compile and can be consumed without runtime errors |
| **Module wiring** | Each stub module properly imports `CqrsModule` and is registered in the NestJS module graph |
| **Integration test coverage** | E2E tests confirm events flow from Ordering → downstream stub → observable side effect (log / DB record) |
| **Future microservice readiness** | Event contracts are designed as if external — minimal changes needed to swap EventBus for a broker |

### What Phase 6 Does NOT Deliver

- Full Payment context logic (VNPay session creation, refund processing)
- Full Delivery context logic (shipper dispatch algorithm)
- Full Notification context logic (push notification delivery)
- An external message broker (Kafka / RabbitMQ)

These are Phase 7+ concerns. Phase 6 is intentionally narrow: **prove the wiring works**.

---

## 2. Current Event Analysis

### 2.1 Events Ordering Already Publishes

All events are in `src/shared/events/` and exported from `index.ts`.

---

#### `OrderPlacedEvent`

**Published by:** `PlaceOrderHandler` (Phase 4), Step 12 — after the DB transaction commits.

**Code path:**
```
POST /carts/my/checkout
  → CartController
  → CartService.checkout()
  → CommandBus.execute(PlaceOrderCommand)
  → PlaceOrderHandler.execute()
  → [DB transaction: INSERT orders, order_items, order_status_logs]
  → EventBus.publish(new OrderPlacedEvent(...))   ← Step 12
```

**Payload (verified from source):**
```typescript
class OrderPlacedEvent {
  orderId: string;
  customerId: string;
  restaurantId: string;
  restaurantName: string;
  totalAmount: number;          // itemsTotal + shippingFee
  shippingFee: number;          // computed from delivery zone at checkout
  paymentMethod: 'cod' | 'vnpay';
  items: Array<{
    menuItemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  deliveryAddress: {
    street: string;
    district: string;
    city: string;
    latitude?: number;
    longitude?: number;
  };
  distanceKm: number | undefined;              // undefined if coords absent
  estimatedDeliveryMinutes: number | undefined; // undefined if zone unavailable
}
```

**Trigger condition:** Every successful order placement (both COD and VNPay).

---

#### `OrderStatusChangedEvent`

**Published by:** `TransitionOrderHandler` (Phase 5), Step 9 — after every DB transition.

**Code path:**
```
PATCH /orders/:id/{confirm|start-preparing|ready|pickup|en-route|deliver|cancel}
  → OrderLifecycleController
  → CommandBus.execute(TransitionOrderCommand)
  → TransitionOrderHandler.execute()
  → [DB transaction: UPDATE orders, INSERT order_status_logs]
  → EventBus.publish(new OrderStatusChangedEvent(...))   ← always
  → EventBus.publish(new OrderReadyForPickupEvent(...))  ← if T-08
  → EventBus.publish(new OrderCancelledAfterPaymentEvent(...)) ← if T-05/T-07 + VNPay
```

**Payload (verified from source):**
```typescript
class OrderStatusChangedEvent {
  orderId: string;
  customerId: string;
  restaurantId: string;
  fromStatus: string;
  toStatus: string;
  triggeredByRole: 'customer' | 'restaurant' | 'shipper' | 'admin' | 'system';
  note?: string;
}
```

**Trigger condition:** Every state transition (all 12 T-xx transitions, including system-triggered).

---

#### `OrderReadyForPickupEvent`

**Published by:** `TransitionOrderHandler`, Step 9 — only when `rule.triggersReadyForPickup === true`.

**TRANSITIONS map entry that triggers it:**
```typescript
'preparing→ready_for_pickup': {
  allowedRoles: ['restaurant', 'admin'],
  triggersReadyForPickup: true,   // ← this flag
},
```

**Payload (verified from source):**
```typescript
class OrderReadyForPickupEvent {
  orderId: string;
  restaurantId: string;
  restaurantName: string;     // from ordering_restaurant_snapshots
  restaurantAddress: string;  // from ordering_restaurant_snapshots
  customerId: string;
  deliveryAddress: {
    street: string;
    district: string;
    city: string;
    latitude?: number;
    longitude?: number;
  };
}
```

**Trigger condition:** T-08 only (`preparing → ready_for_pickup`).

> **Important:** `publishReadyForPickupEvent()` is a private helper that loads the restaurant snapshot. If the snapshot is missing it **logs a WARN and skips the event** — this is a soft failure. The Phase 6 stub should not assume the event always fires.

---

#### `OrderCancelledAfterPaymentEvent`

**Published by:** `TransitionOrderHandler`, Step 9 — only when `rule.triggersRefundIfVnpay === true` AND `order.paymentMethod === 'vnpay'`.

**TRANSITIONS that trigger it:**
```typescript
'paid→cancelled':      { triggersRefundIfVnpay: true }   // T-05
'confirmed→cancelled': { triggersRefundIfVnpay: true }   // T-07
```

**Payload (verified from source):**
```typescript
class OrderCancelledAfterPaymentEvent {
  orderId: string;
  customerId: string;
  paymentMethod: 'vnpay';  // always
  paidAmount: number;      // = orders.totalAmount (amount to refund)
  cancelledAt: Date;
  cancelledByRole: 'customer' | 'restaurant' | 'admin' | 'system';
}
```

**Trigger condition:** T-05 or T-07, only for VNPay orders.

---

### 2.2 Events Ordering Already Consumes (INCOMING)

These are produced by the Payment context and handled inside `OrderLifecycleModule`:

| Event | Handler | Effect |
| --- | --- | --- |
| `PaymentConfirmedEvent` | `PaymentConfirmedEventHandler` | T-02: `pending → paid` |
| `PaymentFailedEvent` | `PaymentFailedEventHandler` | T-03: `pending → cancelled` |

These handlers are **already implemented** in Phase 5. The Payment context must publish these events when it is built.

> ⚠️ **IMPORTANT for Phase N — T-03 `requireNote` contract:** T-03 (`pending→cancelled`) has `requireNote: true` in the TRANSITIONS map. `TransitionOrderHandler` throws `BadRequestException` if the `note` field is empty or whitespace, and `PaymentFailedEventHandler` catches this silently — meaning the order is **NOT cancelled** and no error surfaces. The Payment context MUST always supply a non-empty `reason` string in `PaymentFailedEvent`. An empty `reason` causes silent auto-cancel failure with no observable error to the customer or monitoring.

---

### 2.3 Event Publishing Summary

```
TRIGGER                           EVENT PUBLISHED                      ALWAYS?
─────────────────────────────────────────────────────────────────────────────
Checkout succeeds (Phase 4)       OrderPlacedEvent                     Yes
Any transition (T-01..T-12)       OrderStatusChangedEvent              Yes
T-08 (preparing→ready_for_pickup) OrderReadyForPickupEvent             Yes*
T-05 or T-07 + paymentMethod=vnpay OrderCancelledAfterPaymentEvent     Yes*

* Yes unless restaurant snapshot is missing (T-08) or actorRole='shipper' (T-05/T-07,
  which is architecturally impossible per TRANSITIONS map, but guarded defensively).
```

---

## 3. Downstream Context Responsibilities

### 3.1 Payment Context

#### Events to Consume

| Event | When | Why |
| --- | --- | --- |
| `OrderPlacedEvent` | `paymentMethod === 'vnpay'` | Must generate a VNPay payment URL and surface it to the customer |
| `OrderCancelledAfterPaymentEvent` | Always | Must initiate a VNPay refund for `paidAmount` |

#### Events to Publish (back to Ordering)

| Event | When | Effect in Ordering |
| --- | --- | --- |
| `PaymentConfirmedEvent` | VNPay gateway confirms | T-02: `pending → paid` |
| `PaymentFailedEvent` | VNPay gateway rejects | T-03: `pending → cancelled` |

#### Future Actions (not in Phase 6 stub)

- Call VNPay API to create payment session
- Store payment transaction record (`payment_transactions` table)
- Handle VNPay callback webhook
- Initiate refund via VNPay Refund API when `OrderCancelledAfterPaymentEvent` arrives

---

### 3.2 Delivery Context

#### Events to Consume

| Event | When | Why |
| --- | --- | --- |
| `OrderPlacedEvent` | Always (optional — pre-warm) | Pre-record delivery task with `distanceKm`, `estimatedDeliveryMinutes`, `shippingFee` before shipper is needed |
| `OrderReadyForPickupEvent` | T-08 fires | Primary trigger: dispatch a shipper to the restaurant |
| `OrderStatusChangedEvent` | `picked_up`, `delivering`, `delivered`, `cancelled` | Track delivery state; close task on `delivered`; cancel assignment on `cancelled` |
| `OrderStatusChangedEvent` | `ready_for_pickup` *(defensive fallback)* | Backup dispatch trigger if `OrderReadyForPickupEvent` was silently skipped due to missing restaurant snapshot |

> ⚠️ **Delivery gap risk (RISK-1):** `OrderReadyForPickupEvent` is silently skipped when the `ordering_restaurant_snapshots` record is missing for `order.restaurantId` (verified in `publishReadyForPickupEvent()` — logs WARN and returns without publishing). When this happens, `DeliveryOrderReadyForPickupHandler` never fires, leaving the order stuck in `ready_for_pickup` with no shipper dispatched. `'ready_for_pickup'` is therefore included in `DELIVERY_RELEVANT_STATUSES` (see §6.2) as a defensive fallback via `OrderStatusChangedEvent`. In Phase N, `updateDeliveryTask` should treat a `ready_for_pickup` signal as a dispatch trigger when no prior delivery task exists (idempotent via `orderId` UNIQUE).

#### Why Pre-warming on `OrderPlacedEvent` Matters

`OrderPlacedEvent` carries pre-computed `distanceKm` and `estimatedDeliveryMinutes` from the Haversine + zone calculation at checkout. If the Delivery BC consumes `OrderPlacedEvent`, it can store a delivery task record immediately, so that when `OrderReadyForPickupEvent` fires it only needs to look up an existing record rather than recompute routing. This reduces dispatch latency.

#### Future Actions (not in Phase 6 stub)

- Shipper assignment algorithm (proximity-based, rating-based, etc.)
- Delivery tracking (GPS polling)
- Delivery task state machine

---

### 3.3 Notification Context

#### Events to Consume

| Event | Transition | Notify Whom | Message |
| --- | --- | --- | --- |
| `OrderPlacedEvent` | `null → pending` | Customer | "Order placed, awaiting confirmation" |
| `OrderPlacedEvent` | `null → pending` | Restaurant | "New order received" |
| `OrderStatusChangedEvent` | `pending → confirmed` | Customer | "Restaurant confirmed your order" |
| `OrderStatusChangedEvent` | `confirmed → preparing` | Customer | "Restaurant is preparing your order" |
| `OrderStatusChangedEvent` | `preparing → ready_for_pickup` | Customer | "Order ready, shipper on the way" |
| `OrderStatusChangedEvent` | `ready_for_pickup → picked_up` | Customer | "Shipper picked up your order" |
| `OrderStatusChangedEvent` | `picked_up → delivering` | Customer | "Shipper is en route" |
| `OrderStatusChangedEvent` | `delivering → delivered` | Customer | "Order delivered!" |
| `OrderStatusChangedEvent` | any `→ cancelled` | Customer, Restaurant | "Order cancelled" |
| `OrderReadyForPickupEvent` | `preparing → ready_for_pickup` | Shipper (broadcast) | "Order ready for pickup at [restaurant]" |
| `OrderCancelledAfterPaymentEvent` | T-05/T-07 + VNPay | Customer | "Refund initiated for [amount]" |

#### Why `OrderReadyForPickupEvent` and `OrderStatusChangedEvent` Both Arrive

Both fire for the same T-08 transition. The Notification context should respond to `OrderReadyForPickupEvent` for **shipper notification** (it has restaurant address + delivery address needed for dispatch details) and to `OrderStatusChangedEvent` for **customer notification** (simpler payload, consistent pattern with all other transitions).

> ⚠️ **Phase N caution — double-fire on T-08:** Both `NotificationOrderStatusChangedHandler` (customer notification) and `NotificationOrderReadyForPickupHandler` (shipper broadcast) fire for the same T-08 transition. In Phase N real implementations, `NotificationOrderStatusChangedHandler` MUST NOT send any shipper-directed notification for `toStatus === 'ready_for_pickup'` — that is exclusively `NotificationOrderReadyForPickupHandler`'s responsibility. Failing to enforce this will cause shippers to receive two push notifications for the same event.

#### Future Actions (not in Phase 6 stub)

- FCM / APNs push notification dispatch
- In-app notification table insertion
- SMS for critical statuses (delivered, cancelled)

---

## 4. Design Options: In-Process EventBus Only

Keep all event handling inside the NestJS monolith using `@EventsHandler`. Downstream context modules live in `src/module/payment/`, `src/module/delivery/`, `src/module/notification/`, each with their own `@EventsHandler` classes consuming events from `src/shared/events/`.

```
                    ┌─────────────────────────────────────────────────┐
                    │             NestJS Process                       │
                    │                                                  │
  Ordering BC       │   CQRS EventBus (in-memory)                     │
  ─────────         │   ────────────────────────────────              │
  TransitionOrder   │                                                  │
  Handler           │   ┌──────────────────────────────────────────┐  │
    │               │   │ PaymentModule                            │  │
    ├─ publish ─────┼──►│   OrderPlacedEventHandler (stub)         │  │
    │  OrderPlaced  │   │   OrderCancelledAfterPaymentEventHandler  │  │
    │               │   └──────────────────────────────────────────┘  │
    ├─ publish ─────┼──►┌──────────────────────────────────────────┐  │
    │  OrderReady   │   │ DeliveryModule                           │  │
    │  ForPickup    │   │   OrderPlacedEventHandler (stub)         │  │
    │               │   │   OrderReadyForPickupEventHandler (stub) │  │
    │               │   │   OrderStatusChangedEventHandler (stub)  │  │
    └─ publish ─────┼──►└──────────────────────────────────────────┘  │
       OrderStatus  │   ┌──────────────────────────────────────────┐  │
       Changed      │   │ NotificationModule                       │  │
                    │   │   OrderPlacedEventHandler (stub)         │  │
                    │   │   OrderReadyForPickupEventHandler (stub) │  │
                    │   │   OrderStatusChangedEventHandler (stub)  │  │
                    │   │   OrderCancelledAfterPaymentHandler (stub)│  │
                    │   └──────────────────────────────────────────┘  │
                    └─────────────────────────────────────────────────┘
```

**Pros:**
- Zero infrastructure: no broker, no serialization, no retry queues
- Type-safe event payloads — TypeScript classes shared directly
- All failures visible in the same process and logs
- Simplest onboarding for new engineers
- Consistent with how Phase 5 handlers (`PaymentConfirmedEventHandler`) already work

**Cons:**
- If downstream handler throws and is not caught, it propagates back to the EventBus call site (mitigated by try/catch in all handlers)
- All consumers run in the same transaction/request cycle unless they spawn their own async work
- Migrating to a broker later requires a refactor of all handler registrations

---

## 5. Event Contracts

All contracts are already implemented in `src/shared/events/`. Phase 6 **adds no new event classes** — stubs consume the existing ones.

### 5.1 `OrderPlacedEvent` (Publisher: Ordering, Consumer: Payment + Delivery + Notification)

```typescript
// src/shared/events/order-placed.event.ts  ← ALREADY EXISTS
class OrderPlacedEvent {
  orderId: string;
  customerId: string;
  restaurantId: string;
  restaurantName: string;
  totalAmount: number;            // itemsTotal + shippingFee
  shippingFee: number;            // computed from delivery zone at checkout
  paymentMethod: 'cod' | 'vnpay';
  items: Array<{
    menuItemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  deliveryAddress: {
    street: string;
    district: string;
    city: string;
    latitude?: number;
    longitude?: number;
  };
  distanceKm: number | undefined;               // undefined if coords absent
  estimatedDeliveryMinutes: number | undefined; // undefined if zone unavailable
}
```

**Adequacy assessment:** ✅ Complete. Contains everything Payment needs (orderId, paymentMethod, totalAmount), Delivery needs (distanceKm, estimatedDeliveryMinutes, deliveryAddress), and Notification needs (restaurantName, customerId).

---

### 5.2 `OrderStatusChangedEvent` (Publisher: Ordering, Consumer: Delivery + Notification)

```typescript
// src/shared/events/order-status-changed.event.ts  ← ALREADY EXISTS
class OrderStatusChangedEvent {
  orderId: string;
  customerId: string;
  restaurantId: string;
  fromStatus: string;
  toStatus: string;
  triggeredByRole: 'customer' | 'restaurant' | 'shipper' | 'admin' | 'system';
  note?: string;
}
```

**Adequacy assessment:** ✅ Complete for notification and delivery tracking use cases.

> **Proposed improvement for future phases:** Add `shipperId?: string` for transitions T-09..T-11, so Notification can address the push to the specific shipper without an extra DB lookup. Not needed for Phase 6 stubs.

---

### 5.3 `OrderReadyForPickupEvent` (Publisher: Ordering, Consumer: Delivery + Notification)

```typescript
// src/shared/events/order-ready-for-pickup.event.ts  ← ALREADY EXISTS
class OrderReadyForPickupEvent {
  orderId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantAddress: string;
  customerId: string;
  deliveryAddress: {
    street: string;
    district: string;
    city: string;
    latitude?: number;
    longitude?: number;
  };
}
```

**Adequacy assessment:** ✅ Complete for shipper dispatch. `restaurantAddress` (from snapshot) is essential for the Delivery context.

> **Note:** `distanceKm` and `estimatedDeliveryMinutes` are NOT in this event — they were in `OrderPlacedEvent`. If Delivery BC pre-warms on `OrderPlacedEvent`, it already has them. If not, it must recompute. Phase 6 stubs don't need them.

---

### 5.4 `OrderCancelledAfterPaymentEvent` (Publisher: Ordering, Consumer: Payment)

```typescript
// src/shared/events/order-cancelled-after-payment.event.ts  ← ALREADY EXISTS
class OrderCancelledAfterPaymentEvent {
  orderId: string;
  customerId: string;
  paymentMethod: 'vnpay';   // always — only fires for VNPay orders
  paidAmount: number;       // amount to refund (= orders.totalAmount)
  cancelledAt: Date;
  cancelledByRole: 'customer' | 'restaurant' | 'admin' | 'system';
}
```

**Adequacy assessment:** ✅ Complete for refund initiation. `paidAmount` is the authoritative figure from `orders.totalAmount` at the time of cancellation.

---

### 5.5 Versioning Approach

The current events use **implicit v1** (no version field). For Phase 6 stubs, this is sufficient. See [Section 9](#9-event-versioning-strategy) for the full versioning strategy.

---

## 6. Stub Handler Design

### Architecture: Option C (Hybrid)

Each handler:
1. Receives the event
2. Logs receipt at `DEBUG` level (verifiable in tests)
3. Calls a thin `IntegrationService` method
4. The `IntegrationService` logs at `LOG` level and returns immediately (stub)
5. All errors are caught and logged at `ERROR` — never re-thrown

### 6.1 Payment Context Stubs

#### `PaymentOrderPlacedHandler`

```typescript
// src/module/payment/events/order-placed.handler.ts

import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderPlacedEvent } from '@/shared/events/order-placed.event';
import { PaymentIntegrationService } from '../services/payment-integration.service';

/**
 * PaymentOrderPlacedHandler
 *
 * Consumes OrderPlacedEvent to initiate a VNPay payment session for
 * paymentMethod='vnpay' orders.
 *
 * Phase 6: STUB — logs receipt; no real VNPay API call yet.
 * Phase N: PaymentIntegrationService.initiateVnpaySession(event) calls VNPay API.
 */
@Injectable()
@EventsHandler(OrderPlacedEvent)
export class PaymentOrderPlacedHandler implements IEventHandler<OrderPlacedEvent> {
  private readonly logger = new Logger(PaymentOrderPlacedHandler.name);

  constructor(private readonly integrationService: PaymentIntegrationService) {}

  async handle(event: OrderPlacedEvent): Promise<void> {
    // COD orders need no payment processing
    if (event.paymentMethod !== 'vnpay') return;

    this.logger.debug(
      `[STUB] OrderPlacedEvent received for VNPay order ${event.orderId}`,
    );

    try {
      await this.integrationService.handleOrderPlaced(event);
    } catch (err) {
      this.logger.error(
        `PaymentOrderPlacedHandler failed for order ${event.orderId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
```

#### `PaymentOrderCancelledAfterPaymentHandler`

```typescript
// src/module/payment/events/order-cancelled-after-payment.handler.ts

import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderCancelledAfterPaymentEvent } from '@/shared/events/order-cancelled-after-payment.event';
import { PaymentIntegrationService } from '../services/payment-integration.service';

/**
 * PaymentOrderCancelledAfterPaymentHandler
 *
 * Consumes OrderCancelledAfterPaymentEvent to initiate a VNPay refund.
 *
 * Phase 6: STUB — logs receipt; no real refund API call yet.
 * Phase N: PaymentIntegrationService.initiateRefund(event) calls VNPay Refund API.
 */
@Injectable()
@EventsHandler(OrderCancelledAfterPaymentEvent)
export class PaymentOrderCancelledAfterPaymentHandler
  implements IEventHandler<OrderCancelledAfterPaymentEvent>
{
  private readonly logger = new Logger(PaymentOrderCancelledAfterPaymentHandler.name);

  constructor(private readonly integrationService: PaymentIntegrationService) {}

  async handle(event: OrderCancelledAfterPaymentEvent): Promise<void> {
    this.logger.debug(
      `[STUB] OrderCancelledAfterPaymentEvent received for order ${event.orderId}, ` +
        `paidAmount=${event.paidAmount}, cancelledBy=${event.cancelledByRole}`,
    );

    try {
      await this.integrationService.handleOrderCancelledAfterPayment(event);
    } catch (err) {
      this.logger.error(
        `PaymentOrderCancelledAfterPaymentHandler failed for order ${event.orderId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
```

#### `PaymentIntegrationService` (Phase 6 stub body)

```typescript
// src/module/payment/services/payment-integration.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { OrderPlacedEvent } from '@/shared/events/order-placed.event';
import { OrderCancelledAfterPaymentEvent } from '@/shared/events/order-cancelled-after-payment.event';

/**
 * PaymentIntegrationService
 *
 * Adapter between Ordering domain events and the Payment BC's external actions.
 * Phase 6: all methods are stubs — they log and return.
 * Phase N: replace stub bodies with real VNPay API calls.
 */
@Injectable()
export class PaymentIntegrationService {
  private readonly logger = new Logger(PaymentIntegrationService.name);

  async handleOrderPlaced(event: OrderPlacedEvent): Promise<void> {
    // STUB: Phase N will call VNPay to create a payment session and store the URL.
    this.logger.log(
      `[STUB] Would initiate VNPay session for order ${event.orderId} ` +
        `(totalAmount=${event.totalAmount})`,
    );
  }

  async handleOrderCancelledAfterPayment(
    event: OrderCancelledAfterPaymentEvent,
  ): Promise<void> {
    // STUB: Phase N will call VNPay Refund API and record refund transaction.
    this.logger.log(
      `[STUB] Would initiate refund for order ${event.orderId} ` +
        `(paidAmount=${event.paidAmount})`,
    );
  }
}
```

---

### 6.2 Delivery Context Stubs

#### `DeliveryOrderPlacedHandler`

```typescript
// src/module/delivery/events/order-placed.handler.ts

import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderPlacedEvent } from '@/shared/events/order-placed.event';
import { DeliveryIntegrationService } from '../services/delivery-integration.service';

/**
 * DeliveryOrderPlacedHandler
 *
 * Pre-warms delivery task metadata when an order is placed.
 * Allows faster shipper dispatch when OrderReadyForPickupEvent fires later.
 *
 * Phase 6: STUB — logs receipt.
 * Phase N: DeliveryIntegrationService.prewarmDeliveryTask(event) inserts
 *          a delivery_tasks record with distanceKm + estimatedDeliveryMinutes.
 */
@Injectable()
@EventsHandler(OrderPlacedEvent)
export class DeliveryOrderPlacedHandler implements IEventHandler<OrderPlacedEvent> {
  private readonly logger = new Logger(DeliveryOrderPlacedHandler.name);

  constructor(private readonly integrationService: DeliveryIntegrationService) {}

  async handle(event: OrderPlacedEvent): Promise<void> {
    this.logger.debug(
      `[STUB] OrderPlacedEvent received for delivery pre-warm, order ${event.orderId}`,
    );

    try {
      await this.integrationService.prewarmDeliveryTask(event);
    } catch (err) {
      this.logger.error(
        `DeliveryOrderPlacedHandler failed for order ${event.orderId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
```

#### `DeliveryOrderReadyForPickupHandler`

```typescript
// src/module/delivery/events/order-ready-for-pickup.handler.ts

import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderReadyForPickupEvent } from '@/shared/events/order-ready-for-pickup.event';
import { DeliveryIntegrationService } from '../services/delivery-integration.service';

/**
 * DeliveryOrderReadyForPickupHandler
 *
 * Primary trigger for shipper dispatch. The restaurant has finished preparing
 * the order and it is ready at the pickup point.
 *
 * Phase 6: STUB — logs receipt.
 * Phase N: DeliveryIntegrationService.dispatchShipper(event) runs the
 *          shipper assignment algorithm and notifies the nearest available shipper.
 */
@Injectable()
@EventsHandler(OrderReadyForPickupEvent)
export class DeliveryOrderReadyForPickupHandler
  implements IEventHandler<OrderReadyForPickupEvent>
{
  private readonly logger = new Logger(DeliveryOrderReadyForPickupHandler.name);

  constructor(private readonly integrationService: DeliveryIntegrationService) {}

  async handle(event: OrderReadyForPickupEvent): Promise<void> {
    this.logger.debug(
      `[STUB] OrderReadyForPickupEvent received for order ${event.orderId} ` +
        `at restaurant ${event.restaurantName} (${event.restaurantAddress})`,
    );

    try {
      await this.integrationService.dispatchShipper(event);
    } catch (err) {
      this.logger.error(
        `DeliveryOrderReadyForPickupHandler failed for order ${event.orderId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
```

#### `DeliveryOrderStatusChangedHandler`

```typescript
// src/module/delivery/events/order-status-changed.handler.ts

import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderStatusChangedEvent } from '@/shared/events/order-status-changed.event';
import { DeliveryIntegrationService } from '../services/delivery-integration.service';

// Only these transitions are relevant to Delivery context.
// 'ready_for_pickup' is included as a defensive fallback for the case where
// OrderReadyForPickupEvent was silently skipped due to a missing restaurant snapshot
// (see §3.2 RISK-1 note). Primary dispatch path remains OrderReadyForPickupEvent.
const DELIVERY_RELEVANT_STATUSES = new Set([
  'ready_for_pickup', // defensive fallback — primary path is OrderReadyForPickupEvent
  'picked_up',
  'delivering',
  'delivered',
  'cancelled',
]);

/**
 * DeliveryOrderStatusChangedHandler
 *
 * Tracks delivery-relevant state changes to update the delivery task record.
 *
 * Phase 6: STUB — logs receipt for relevant transitions only.
 * Phase N: DeliveryIntegrationService.updateDeliveryTask(event) updates
 *          delivery_tasks status and closes the task on 'delivered'.
 */
@Injectable()
@EventsHandler(OrderStatusChangedEvent)
export class DeliveryOrderStatusChangedHandler
  implements IEventHandler<OrderStatusChangedEvent>
{
  private readonly logger = new Logger(DeliveryOrderStatusChangedHandler.name);

  constructor(private readonly integrationService: DeliveryIntegrationService) {}

  async handle(event: OrderStatusChangedEvent): Promise<void> {
    if (!DELIVERY_RELEVANT_STATUSES.has(event.toStatus)) return;

    this.logger.debug(
      `[STUB] OrderStatusChangedEvent (${event.fromStatus}→${event.toStatus}) ` +
        `received for delivery tracking, order ${event.orderId}`,
    );

    try {
      await this.integrationService.updateDeliveryTask(event);
    } catch (err) {
      this.logger.error(
        `DeliveryOrderStatusChangedHandler failed for order ${event.orderId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
```

---

### 6.3 Notification Context Stubs

#### `NotificationOrderPlacedHandler`

```typescript
// src/module/notification/events/order-placed.handler.ts

import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderPlacedEvent } from '@/shared/events/order-placed.event';
import { NotificationIntegrationService } from '../services/notification-integration.service';

/**
 * NotificationOrderPlacedHandler
 *
 * Sends order-confirmation notification to customer and restaurant.
 *
 * Phase 6: STUB — logs receipt.
 * Phase N: NotificationIntegrationService.notifyOrderPlaced(event) sends
 *          FCM push to customer ("Order placed") and restaurant ("New order").
 */
@Injectable()
@EventsHandler(OrderPlacedEvent)
export class NotificationOrderPlacedHandler implements IEventHandler<OrderPlacedEvent> {
  private readonly logger = new Logger(NotificationOrderPlacedHandler.name);

  constructor(private readonly integrationService: NotificationIntegrationService) {}

  async handle(event: OrderPlacedEvent): Promise<void> {
    this.logger.debug(
      `[STUB] OrderPlacedEvent received for notification, order ${event.orderId}`,
    );

    try {
      await this.integrationService.notifyOrderPlaced(event);
    } catch (err) {
      this.logger.error(
        `NotificationOrderPlacedHandler failed for order ${event.orderId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
```

#### `NotificationOrderStatusChangedHandler`

```typescript
// src/module/notification/events/order-status-changed.handler.ts

import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderStatusChangedEvent } from '@/shared/events/order-status-changed.event';
import { NotificationIntegrationService } from '../services/notification-integration.service';

/**
 * NotificationOrderStatusChangedHandler
 *
 * Sends status-update push notifications to affected actors.
 * Every transition produces a customer-facing notification.
 * Cancellation transitions additionally notify the restaurant.
 *
 * Phase 6: STUB — logs receipt.
 * Phase N: NotificationIntegrationService.notifyStatusChange(event) dispatches FCM.
 */
@Injectable()
@EventsHandler(OrderStatusChangedEvent)
export class NotificationOrderStatusChangedHandler
  implements IEventHandler<OrderStatusChangedEvent>
{
  private readonly logger = new Logger(NotificationOrderStatusChangedHandler.name);

  constructor(private readonly integrationService: NotificationIntegrationService) {}

  async handle(event: OrderStatusChangedEvent): Promise<void> {
    this.logger.debug(
      `[STUB] OrderStatusChangedEvent (${event.fromStatus}→${event.toStatus}) ` +
        `received for notification, order ${event.orderId}`,
    );

    try {
      await this.integrationService.notifyStatusChange(event);
    } catch (err) {
      this.logger.error(
        `NotificationOrderStatusChangedHandler failed for order ${event.orderId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
```

#### `NotificationOrderReadyForPickupHandler`

```typescript
// src/module/notification/events/order-ready-for-pickup.handler.ts

import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderReadyForPickupEvent } from '@/shared/events/order-ready-for-pickup.event';
import { NotificationIntegrationService } from '../services/notification-integration.service';

/**
 * NotificationOrderReadyForPickupHandler
 *
 * Broadcasts to available shippers that an order is ready at the restaurant.
 * Carries the full restaurant address + delivery address needed for the
 * shipper's acceptance screen.
 *
 * Phase 6: STUB — logs receipt.
 * Phase N: NotificationIntegrationService.broadcastToShippers(event) sends
 *          FCM topic push to all online shippers in range.
 */
@Injectable()
@EventsHandler(OrderReadyForPickupEvent)
export class NotificationOrderReadyForPickupHandler
  implements IEventHandler<OrderReadyForPickupEvent>
{
  private readonly logger = new Logger(NotificationOrderReadyForPickupHandler.name);

  constructor(private readonly integrationService: NotificationIntegrationService) {}

  async handle(event: OrderReadyForPickupEvent): Promise<void> {
    this.logger.debug(
      `[STUB] OrderReadyForPickupEvent received for shipper broadcast, ` +
        `order ${event.orderId} at ${event.restaurantName}`,
    );

    try {
      await this.integrationService.broadcastToShippers(event);
    } catch (err) {
      this.logger.error(
        `NotificationOrderReadyForPickupHandler failed for order ${event.orderId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
```

#### `NotificationOrderCancelledAfterPaymentHandler`

```typescript
// src/module/notification/events/order-cancelled-after-payment.handler.ts

import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { OrderCancelledAfterPaymentEvent } from '@/shared/events/order-cancelled-after-payment.event';
import { NotificationIntegrationService } from '../services/notification-integration.service';

/**
 * NotificationOrderCancelledAfterPaymentHandler
 *
 * Informs the customer that a refund has been initiated.
 *
 * Phase 6: STUB — logs receipt.
 * Phase N: NotificationIntegrationService.notifyRefundInitiated(event) sends
 *          FCM push to customer with refund amount and timeline.
 */
@Injectable()
@EventsHandler(OrderCancelledAfterPaymentEvent)
export class NotificationOrderCancelledAfterPaymentHandler
  implements IEventHandler<OrderCancelledAfterPaymentEvent>
{
  private readonly logger = new Logger(NotificationOrderCancelledAfterPaymentHandler.name);

  constructor(private readonly integrationService: NotificationIntegrationService) {}

  async handle(event: OrderCancelledAfterPaymentEvent): Promise<void> {
    this.logger.debug(
      `[STUB] OrderCancelledAfterPaymentEvent received for refund notification, ` +
        `order ${event.orderId}, amount=${event.paidAmount}`,
    );

    try {
      await this.integrationService.notifyRefundInitiated(event);
    } catch (err) {
      this.logger.error(
        `NotificationOrderCancelledAfterPaymentHandler failed for order ${event.orderId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
```

---

### 6.4 Module Definitions

#### `PaymentModule`

```typescript
// src/module/payment/payment.module.ts

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { PaymentOrderPlacedHandler } from './events/order-placed.handler';
import { PaymentOrderCancelledAfterPaymentHandler } from './events/order-cancelled-after-payment.handler';
import { PaymentIntegrationService } from './services/payment-integration.service';

@Module({
  imports: [CqrsModule],
  providers: [
    PaymentOrderPlacedHandler,
    PaymentOrderCancelledAfterPaymentHandler,
    PaymentIntegrationService,
  ],
})
export class PaymentModule {}
```

#### `DeliveryModule`

```typescript
// src/module/delivery/delivery.module.ts

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DeliveryOrderPlacedHandler } from './events/order-placed.handler';
import { DeliveryOrderReadyForPickupHandler } from './events/order-ready-for-pickup.handler';
import { DeliveryOrderStatusChangedHandler } from './events/order-status-changed.handler';
import { DeliveryIntegrationService } from './services/delivery-integration.service';

@Module({
  imports: [CqrsModule],
  providers: [
    DeliveryOrderPlacedHandler,
    DeliveryOrderReadyForPickupHandler,
    DeliveryOrderStatusChangedHandler,
    DeliveryIntegrationService,
  ],
})
export class DeliveryModule {}
```

#### `NotificationModule`

```typescript
// src/module/notification/notification.module.ts

import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { NotificationOrderPlacedHandler } from './events/order-placed.handler';
import { NotificationOrderStatusChangedHandler } from './events/order-status-changed.handler';
import { NotificationOrderReadyForPickupHandler } from './events/order-ready-for-pickup.handler';
import { NotificationOrderCancelledAfterPaymentHandler } from './events/order-cancelled-after-payment.handler';
import { NotificationIntegrationService } from './services/notification-integration.service';

@Module({
  imports: [CqrsModule],
  providers: [
    NotificationOrderPlacedHandler,
    NotificationOrderStatusChangedHandler,
    NotificationOrderReadyForPickupHandler,
    NotificationOrderCancelledAfterPaymentHandler,
    NotificationIntegrationService,
  ],
})
export class NotificationModule {}
```

#### `AppModule` additions

```typescript
// src/app.module.ts — add to imports array:
PaymentModule,
DeliveryModule,
NotificationModule,
```

> ⚠️ **Important:** NestJS CQRS `EventBus` is global once `CqrsModule` is in the app module tree. All `@EventsHandler` classes registered in any module in the tree will receive events. No special wiring is needed beyond registering the handler classes as `providers`.

---

## 7. Event Flow End-to-End

### 7.1 VNPay Order Placement Flow

```
Customer: POST /carts/my/checkout (paymentMethod='vnpay')
  │
  ▼
PlaceOrderHandler
  ├─ [DB] INSERT orders (status='pending'), order_items, order_status_logs
  └─ EventBus.publish(OrderPlacedEvent)
       │
       ├──► PaymentOrderPlacedHandler
       │      └─ PaymentIntegrationService.handleOrderPlaced()
       │           [Phase 6: LOG "Would initiate VNPay session"]
       │           [Phase N: call VNPay API → store paymentUrl → publish back to client]
       │
       ├──► DeliveryOrderPlacedHandler
       │      └─ DeliveryIntegrationService.prewarmDeliveryTask()
       │           [Phase 6: LOG "Would pre-warm delivery task"]
       │           [Phase N: INSERT delivery_tasks(orderId, distanceKm, eta)]
       │
       └──► NotificationOrderPlacedHandler
              └─ NotificationIntegrationService.notifyOrderPlaced()
                   [Phase 6: LOG "Would send 'Order placed' push"]
                   [Phase N: FCM push to customer + restaurant]
```

### 7.2 VNPay Payment Confirmation Flow

```
[External] VNPay webhook → Payment BC (Phase N)
  └─ EventBus.publish(PaymentConfirmedEvent)
       │
       └──► PaymentConfirmedEventHandler  ← ALREADY IN OrderLifecycleModule (Phase 5)
              └─ CommandBus.execute(TransitionOrderCommand(orderId, 'paid', null, 'system'))
                   └─ TransitionOrderHandler  (T-02: pending→paid)
                        ├─ [DB] UPDATE orders SET status='paid', version=version+1
                        │       INSERT order_status_logs
                        └─ EventBus.publish(OrderStatusChangedEvent{pending→paid})
                               │
                               └──► NotificationOrderStatusChangedHandler
                                      [Phase 6: LOG "Would notify: Payment confirmed"]
                                      [Phase N: FCM push to customer]
```

### 7.3 Restaurant Confirms and Prepares → Shipper Dispatched

```
Restaurant: PATCH /orders/:id/confirm  (T-01, COD) or T-04 (VNPay post-pay)
  └─ TransitionOrderHandler (confirmed)
       └─ EventBus.publish(OrderStatusChangedEvent{→confirmed})
            └──► NotificationOrderStatusChangedHandler [LOG]

Restaurant: PATCH /orders/:id/start-preparing  (T-06)
  └─ TransitionOrderHandler (preparing)
       └─ EventBus.publish(OrderStatusChangedEvent{→preparing})
            └──► NotificationOrderStatusChangedHandler [LOG]

Restaurant: PATCH /orders/:id/ready  (T-08)
  └─ TransitionOrderHandler (ready_for_pickup)
       ├─ EventBus.publish(OrderStatusChangedEvent{→ready_for_pickup})
       │    └──► NotificationOrderStatusChangedHandler [LOG]
       │
       └─ EventBus.publish(OrderReadyForPickupEvent)
            ├──► DeliveryOrderReadyForPickupHandler
            │      [Phase 6: LOG "Would dispatch shipper"]
            │      [Phase N: shipper assignment algorithm]
            │
            └──► NotificationOrderReadyForPickupHandler
                   [Phase 6: LOG "Would broadcast to shippers"]
                   [Phase N: FCM topic push to online shippers]
```

### 7.4 VNPay Order Cancelled After Payment (Refund Flow)

```
Customer/Restaurant/Admin: PATCH /orders/:id/cancel (reason required)
  │  (order is in 'paid' or 'confirmed' state, paymentMethod='vnpay')
  │
  └─ TransitionOrderHandler (T-05 or T-07)
       ├─ [DB] UPDATE orders SET status='cancelled'
       │       INSERT order_status_logs
       ├─ EventBus.publish(OrderStatusChangedEvent{→cancelled})
       │    └──► NotificationOrderStatusChangedHandler [LOG]
       │
       └─ EventBus.publish(OrderCancelledAfterPaymentEvent)
            ├──► PaymentOrderCancelledAfterPaymentHandler
            │      [Phase 6: LOG "Would initiate VNPay refund"]
            │      [Phase N: VNPay Refund API call]
            │
            └──► NotificationOrderCancelledAfterPaymentHandler
                   [Phase 6: LOG "Would notify customer: refund initiated"]
                   [Phase N: FCM push with refund amount]
```

### 7.5 Timeout Auto-Cancel Flow

```
OrderTimeoutTask: @Cron(EVERY_MINUTE)
  └─ Query: WHERE status IN ('pending','paid') AND expires_at < NOW()
       └─ for each: CommandBus.execute(TransitionOrderCommand(id,'cancelled',null,'system','Order expired...'))
                      └─ TransitionOrderHandler (T-03 or T-05)
                           ├─ [DB] UPDATE orders SET status='cancelled'
                           │       INSERT order_status_logs
                           ├─ EventBus.publish(OrderStatusChangedEvent{→cancelled, triggeredByRole='system'})
                           │    └──► NotificationOrderStatusChangedHandler [LOG]
                           │
                           └─ (if paid + vnpay) EventBus.publish(OrderCancelledAfterPaymentEvent)
                                ├──► PaymentOrderCancelledAfterPaymentHandler [LOG refund]
                                └──► NotificationOrderCancelledAfterPaymentHandler [LOG notify]
```

---

## 8. Failure Handling Strategy

### 8.1 Handler-Level Error Isolation

Every stub handler (and all future real handlers) MUST wrap its logic in `try/catch` and **never re-throw**. This is already the pattern established in Phase 5:

```typescript
try {
  await this.integrationService.handle(event);
} catch (err) {
  this.logger.error(`Handler failed: ${(err as Error).message}`, (err as Error).stack);
  // Do NOT rethrow — event publishing is fire-and-forget from Ordering's perspective
}
```

**Rationale:** The Ordering DB transaction has already committed. Re-throwing from an event handler cannot undo it. The only effect of a re-throw would be propagating an unhandled error up the EventBus call stack, which in NestJS CQRS causes a silent swallow at the EventBus level anyway.

### 8.2 What Happens When a Handler Fails

| Scenario | Effect | Recovery |
| --- | --- | --- |
| `PaymentIntegrationService.handleOrderPlaced` throws | Logged at ERROR; VNPay session not created | Customer retries from checkout history; order times out after TTL |
| `DeliveryOrderReadyForPickupHandler` throws | Logged at ERROR; shipper not dispatched | Restaurant can re-trigger by marking ready again (idempotent T-08 → already `ready_for_pickup` → no-op) |
| `NotificationOrderStatusChangedHandler` throws | Logged at ERROR; push not sent | Customer polls order status via `GET /orders/:id` |
| `PaymentOrderCancelledAfterPaymentHandler` throws | Logged at ERROR; refund not initiated | Admin manually triggers refund; monitored via error alerting |

### 8.3 Retry Strategy (Phase 6 — None; Phase N — Outbox)

Phase 6 stubs have **no retry** — they log and move on. This is acceptable for stubs.

For Phase N real implementations where failures have business consequences (missed refund, unassigned shipper), the recommended pattern is the **Transactional Outbox**:

```
DB Transaction:
  UPDATE orders SET status='cancelled'
  INSERT order_status_logs
  INSERT outbox_messages (eventType, payload, status='pending')   ← new

Outbox poller (separate process):
  SELECT * FROM outbox_messages WHERE status='pending'
  → publish to EventBus (or broker)
  → UPDATE outbox_messages SET status='sent'
```

This guarantees at-least-once event delivery even if the process crashes between commit and `EventBus.publish`. **Not needed for Phase 6.**

### 8.4 Idempotency in Consumers

Phase 6 stubs are idempotent by definition (logging is safe to repeat). For Phase N real handlers:

- Payment: use `orderId` as idempotency key — store `payment_transactions.orderId` UNIQUE to prevent double-charge
- Delivery: use `orderId` as idempotency key — `delivery_tasks.orderId` UNIQUE; second call is a no-op
- Notification: idempotency is less critical — duplicate pushes are acceptable UX for confirmation/status messages

### 8.5 Multi-Handler Fan-Out

`OrderPlacedEvent` is consumed by **three** handlers (Payment, Delivery, Notification). NestJS CQRS `EventBus` calls all registered handlers for an event in registration order. Each handler runs independently — a failure in one does not prevent the others from running (as long as re-throws are suppressed).

---

## 9. Event Versioning Strategy

### 9.1 Current State: Implicit v1

All events in `src/shared/events/` are unversioned TypeScript classes. They are shared by value — all consumers live in the same codebase and are updated atomically with the publisher. **No versioning is needed now.**

### 9.2 When Versioning Becomes Necessary

Versioning becomes necessary when:
- A consumer runs in a **separate process** (true microservices) and cannot be atomically redeployed with the publisher
- An event is **persisted** to an external store (event store, audit log, broker topic) and old records must remain readable

### 9.3 Recommended Strategy: Envelope + Version Field

When the time comes, add a `version` field to the event envelope — not the event class itself:

```typescript
// Option 1: Field on the class (simple)
class OrderPlacedEvent {
  readonly version = 1;  // increment when breaking changes occur
  // ... rest of payload
}

// Option 2: Wrapper envelope (broker-friendly)
interface EventEnvelope<T> {
  eventType: string;   // 'OrderPlacedEvent'
  version: number;     // 1, 2, ...
  occurredAt: string;  // ISO8601
  payload: T;
}
```

### 9.4 Backward Compatibility Rules

When evolving an event:

| Change Type | Strategy |
| --- | --- |
| Add optional field | Safe — all existing consumers ignore unknown fields |
| Add required field | Bump version; consumer must handle v1 (missing field) and v2 |
| Remove field | Bump version; deprecate in v1, remove in v2 after all consumers migrated |
| Rename field | Treated as remove + add; bump version |
| Change field type | Bump version; always breaking |

**Phase 6 concrete guidance:**
- `OrderStatusChangedEvent`: future addition of `shipperId?: string` (optional) is **safe without version bump**
- `OrderPlacedEvent`: all fields currently optional (`distanceKm?`, `estimatedDeliveryMinutes?`) so adding them was backward-compatible in Phase 4
- No version bumps are needed for Phase 6 stubs

---

## 10. Testing Strategy

### 10.1 Unit Tests for Stub Handlers

Each handler should have a unit test confirming:
1. It calls the integration service with the correct event
2. It does NOT re-throw when the service throws
3. It logs at ERROR level on failure

```typescript
// Example: PaymentOrderPlacedHandler unit test
describe('PaymentOrderPlacedHandler', () => {
  it('calls handleOrderPlaced for vnpay orders', async () => {
    const service = { handleOrderPlaced: jest.fn() };
    const handler = new PaymentOrderPlacedHandler(service as any);
    const event = new OrderPlacedEvent('order-1', 'cust-1', 'rest-1', 'Pizza Place',
      100, 15, 'vnpay', [], { street: '1 Main St', district: 'D1', city: 'HCM' }, 2.5, 30);

    await handler.handle(event);
    expect(service.handleOrderPlaced).toHaveBeenCalledWith(event);
  });

  it('ignores cod orders', async () => {
    const service = { handleOrderPlaced: jest.fn() };
    const handler = new PaymentOrderPlacedHandler(service as any);
    const event = new OrderPlacedEvent('order-1', 'cust-1', 'rest-1', 'Pizza Place',
      100, 0, 'cod', [], { street: '1 Main St', district: 'D1', city: 'HCM' }, 2.5, 30);

    await handler.handle(event);
    expect(service.handleOrderPlaced).not.toHaveBeenCalled();
  });

  it('does not rethrow when service throws', async () => {
    const service = { handleOrderPlaced: jest.fn().mockRejectedValue(new Error('boom')) };
    const handler = new PaymentOrderPlacedHandler(service as any);
    const event = new OrderPlacedEvent('order-1', 'cust-1', 'rest-1', 'Pizza Place',
      100, 15, 'vnpay', [], { street: '1 Main St', district: 'D1', city: 'HCM' }, 2.5, 30);

    await expect(handler.handle(event)).resolves.toBeUndefined();
  });
});
```

### 10.2 Integration Tests for Event Flow

Use the existing E2E test infrastructure (`test/e2e/`) which spins up a real NestJS app against a real PostgreSQL and Redis. The approach is the same as Phase 5 E2E tests.

**Strategy:** Register a **test spy handler** alongside the real stubs and assert it was called.

```typescript
// test/e2e/phase-6/event-flow.e2e-spec.ts

describe('Phase 6 — Event Flow', () => {
  it('publishes OrderPlacedEvent when order is placed', async () => {
    // Place an order via the checkout endpoint
    const response = await request(app.getHttpServer())
      .post('/carts/my/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ paymentMethod: 'cod', deliveryAddress: {...}, idempotencyKey: uuid() });

    expect(response.status).toBe(201);

    // Assert: PaymentIntegrationService received the call
    // (inject a spy/mock into PaymentIntegrationService in the test module)
    expect(paymentIntegrationSpy.handleOrderPlaced).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: response.body.orderId }),
    );
  });

  it('publishes OrderReadyForPickupEvent and calls delivery + notification stubs', async () => {
    // ... place order, advance to preparing, then call ready
    const readyResponse = await request(app.getHttpServer())
      .patch(`/orders/${orderId}/ready`)
      .set('Authorization', `Bearer ${restaurantToken}`);

    expect(readyResponse.status).toBe(200);
    expect(deliveryIntegrationSpy.dispatchShipper).toHaveBeenCalledWith(
      expect.objectContaining({ orderId }),
    );
    expect(notificationIntegrationSpy.broadcastToShippers).toHaveBeenCalledWith(
      expect.objectContaining({ orderId }),
    );
  });

  it('publishes OrderCancelledAfterPaymentEvent for vnpay paid→cancelled', async () => {
    // ... place vnpay order, fire PaymentConfirmedEvent to move to 'paid', then cancel
    const cancelResponse = await request(app.getHttpServer())
      .patch(`/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'Changed my mind' });

    expect(cancelResponse.status).toBe(200);
    expect(paymentIntegrationSpy.handleOrderCancelledAfterPayment).toHaveBeenCalledWith(
      expect.objectContaining({ orderId, paidAmount: expect.any(Number) }),
    );
  });
});
```

### 10.3 Contract Tests

**What:** Assert that the TypeScript event class shapes match what consumers expect. In a monorepo, this is guaranteed by the shared `src/shared/events/` module — the TypeScript compiler enforces contracts at build time.

**When to add formal contract tests:** Only when a context is extracted to a separate process with its own build. At that point, use [Pact](https://pact.io/) or a JSON schema registry.

---

## 11. Trade-off Analysis

### 11.1 In-Process vs. Broker

| Dimension | Option A (In-Process) | Option B (Broker) |
| --- | --- | --- |
| **Dev setup** | Zero infra | Kafka/RabbitMQ + management UI |
| **Type safety** | Full (shared TS classes) | Lost at serialization boundary |
| **Failure isolation** | Handler throws affect same thread | True async isolation |
| **Replay** | No built-in replay | Broker retains messages |
| **Observability** | Logs in same process | Distributed tracing required |
| **Microservice readiness** | Refactor needed | Ready |
| **Appropriate now?** | ✅ Yes | ❌ Overkill |

**Verdict:** Use Option A (in-process) now. Design Option C (hybrid with IntegrationService) so the adapter layer is clean when Option B becomes necessary.

### 11.2 Thick Handlers vs. Thin Handlers + IntegrationService

| Approach | Pro | Con |
| --- | --- | --- |
| **Thick handler** (all logic in `handle()`) | Fewer files | Hard to unit test; hard to swap to broker |
| **Thin handler + IntegrationService** | Testable; broker-swappable; follows SRP | Slightly more boilerplate |

**Verdict:** Thin handlers. The `IntegrationService` is the seam where broker replacement happens — this is the core of Option C.

### 11.3 Single `OrderStatusChangedHandler` vs. Per-Transition Handlers

| Approach | Pro | Con |
| --- | --- | --- |
| **One handler for all transitions** | Fewer files; centralised logic | Handler must filter transitions internally |
| **Per-transition handlers** | Maximum clarity | Many files; redundant EventBus registrations |

**Verdict:** One handler per context per event. Use internal `if` conditions to filter relevant transitions. `DELIVERY_RELEVANT_STATUSES` set in `DeliveryOrderStatusChangedHandler` demonstrates this pattern.

### 11.4 Fan-Out: Single `EventBus.publish` to Multiple Handlers

NestJS CQRS `EventBus` supports multiple handlers per event class. All registered handlers are called. This is the correct pattern for fan-out.

**Risk:** Handlers run **concurrently** — `EventBus.publish()` dispatches to all registered handlers without awaiting each in sequence. There is **no guaranteed execution order**. If Handler B depends on Handler A having run first, there is an implicit ordering dependency. **Avoid this** — each handler must be independently idempotent.

---

## 12. Final Recommendation

### ✅ Recommended Architecture: Option C (Hybrid)

**For Phase 6:** Implement in-process `@EventsHandler` stubs using the thin handler + `IntegrationService` pattern. No broker infrastructure.

**Rationale:**

1. **Matches existing patterns.** `PaymentConfirmedEventHandler` (Phase 5) is already this pattern — thin handler, calls a service, suppresses re-throws. Phase 6 stubs are identical in structure.

2. **Verifies integration early.** Even though the service bodies are stubs, the full NestJS module wiring is tested: event classes compile, handlers are registered, `CqrsModule` is in scope, and the EventBus fan-out works correctly.

3. **Clear seam for future broker.** When the Payment context needs to call a real VNPay API (Phase N), only `PaymentIntegrationService.handleOrderPlaced()` changes. The handler, the module, the event class — nothing else changes.

4. **Zero risk of over-engineering.** The deliverable is narrow and bounded: stub handlers that log. No new DB tables, no infrastructure, no complex algorithms.

### Implementation Order

```
Step 1: Create PaymentModule with 2 handlers + PaymentIntegrationService
Step 2: Create DeliveryModule with 3 handlers + DeliveryIntegrationService
Step 3: Create NotificationModule with 4 handlers + NotificationIntegrationService
Step 4: Register all 3 modules in AppModule
Step 5: Write E2E tests confirming event flow (3 scenarios minimum)
Step 6: Verify no existing Phase 4/5 tests break
```

### Future Migration Path to Microservices

When the system grows to require a broker (e.g., independent scaling of notification workers):

```
Phase N Migration:
1. Add Kafka or RabbitMQ to docker-compose.yml
2. Replace IntegrationService method bodies with broker.publish(envelope)
3. Create consumer processes that subscribe to broker topics
4. Add dead-letter queue + retry policy per consumer
5. Add distributed tracing (OpenTelemetry) across publish/consume boundaries

No changes needed in:
  - All @EventsHandler handler classes
  - All event class definitions in src/shared/events/
  - All Ordering source code
```

---

## 13. Folder Structure Proposal

```
src/
├── shared/
│   └── events/                           ← ALREADY EXISTS — no changes
│       ├── index.ts
│       ├── order-placed.event.ts
│       ├── order-status-changed.event.ts
│       ├── order-ready-for-pickup.event.ts
│       ├── order-cancelled-after-payment.event.ts
│       ├── payment-confirmed.event.ts
│       └── payment-failed.event.ts
│
└── module/
    ├── ordering/                         ← ALREADY EXISTS — no changes
    │   └── ...
    │
    ├── payment/                          ← NEW (Phase 6)
    │   ├── payment.module.ts
    │   ├── events/
    │   │   ├── order-placed.handler.ts               ← PaymentOrderPlacedHandler
    │   │   └── order-cancelled-after-payment.handler.ts
    │   └── services/
    │       └── payment-integration.service.ts        ← stub; real VNPay logic later
    │
    ├── delivery/                         ← NEW (Phase 6)
    │   ├── delivery.module.ts
    │   ├── events/
    │   │   ├── order-placed.handler.ts               ← DeliveryOrderPlacedHandler
    │   │   ├── order-ready-for-pickup.handler.ts     ← primary dispatch trigger
    │   │   └── order-status-changed.handler.ts       ← delivery tracking
    │   └── services/
    │       └── delivery-integration.service.ts       ← stub; real dispatch logic later
    │
    └── notification/                     ← NEW (Phase 6)
        ├── notification.module.ts
        ├── events/
        │   ├── order-placed.handler.ts               ← NotificationOrderPlacedHandler
        │   ├── order-status-changed.handler.ts       ← main notification path
        │   ├── order-ready-for-pickup.handler.ts     ← shipper broadcast
        │   └── order-cancelled-after-payment.handler.ts
        └── services/
            └── notification-integration.service.ts   ← stub; real FCM/APNs logic later
```

### Naming Conventions

| Layer | Pattern | Example |
| --- | --- | --- |
| Handler class | `{Context}{EventName}Handler` | `PaymentOrderPlacedHandler` |
| Handler file | `{event-name}.handler.ts` inside context `events/` | `order-placed.handler.ts` |
| Integration service | `{Context}IntegrationService` | `DeliveryIntegrationService` |
| Service file | `{context}-integration.service.ts` | `delivery-integration.service.ts` |
| Module file | `{context}.module.ts` | `notification.module.ts` |

---

## Self-Review Checklist

- [x] All event payloads verified directly from `src/shared/events/*.ts` source files
- [x] All code paths verified from `transition-order.handler.ts` and `place-order.handler.ts`
- [x] TRANSITIONS map entries verified from `constants/transitions.ts`
- [x] No contradiction with Phase 5 (stubs consume events already published; no duplicate handlers for `PaymentConfirmedEvent` / `PaymentFailedEvent` which are already in `OrderLifecycleModule`)
- [x] No unrealistic design — all proposed handlers follow the exact same structure as `PaymentConfirmedEventHandler` already in the codebase
- [x] Trade-offs explained for all major decisions
- [x] Final recommendation clearly stated with justification
- [x] `OrderCancelledAfterPaymentEvent` is only published for `paymentMethod='vnpay'` — handlers verify this via event type
- [x] `DeliveryOrderStatusChangedHandler` filters to relevant transitions (`picked_up`, `delivering`, `delivered`, `cancelled`) to avoid unnecessary processing on every transition
- [x] `PaymentOrderPlacedHandler` early-returns for `paymentMethod !== 'vnpay'` — COD orders require no payment action
- [x] All handlers suppress re-throws, matching the fire-and-forget contract established in Phase 5
- [x] RISK-1 documented: `OrderReadyForPickupEvent` soft-skip on missing snapshot; `'ready_for_pickup'` added to `DELIVERY_RELEVANT_STATUSES` as defensive fallback (§3.2, §6.2)
- [x] RISK-2 documented: T-03 `requireNote` contract — Payment context MUST supply non-empty `reason` in `PaymentFailedEvent` (§2.2)
- [x] EDGE-1 documented: Phase N `NotificationOrderStatusChangedHandler` must not send shipper notifications for `ready_for_pickup` to avoid double-fire with `NotificationOrderReadyForPickupHandler` (§3.3)
- [x] INCON-2 corrected: Section 11.4 now accurately states handlers run concurrently (fire-and-forget), not sequentially by registration order
