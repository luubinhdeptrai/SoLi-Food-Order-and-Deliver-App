# Phase 5 — Order Lifecycle State Machine: Implementation Summary

> **Status:** IMPLEMENTED ✅  
> **Date:** 2025  
> **Module:** `src/module/ordering/order-lifecycle/`  
> **Proposal:** `ORDER_LIFECYCLE_PHASE5_PROPOSAL.md`

---

## Overview

Phase 5 implements the complete order lifecycle state machine for the SoLi Food Delivery platform. It introduces a single `TransitionOrderCommand` (D1-C CQRS pattern), a hand-crafted `ALLOWED_TRANSITIONS` table (D6-A), ownership verification via ACL snapshots (D3-B), optimistic locking, cron-based timeout, and HTTP endpoints for all lifecycle transitions.

---

## Files Created

### Module Entry

| File | Description |
|------|-------------|
| `order-lifecycle.module.ts` | Registers all providers, controllers, event handlers, and imports `CqrsModule` + `DatabaseModule` |

### Constants

| File | Description |
|------|-------------|
| `constants/transitions.ts` | Single source of truth — `TRANSITIONS` map and `ALLOWED_TRANSITIONS` set (D6-A) |

### Commands

| File | Description |
|------|-------------|
| `commands/transition-order.command.ts` | `TransitionOrderCommand` — carries orderId, targetStatus, actorId, actorRole, optional note |
| `commands/transition-order.handler.ts` | Core state machine — validates transition, checks ownership, optimistic-lock DB transaction, publishes events |

### Event Handlers

| File | Description |
|------|-------------|
| `events/payment-confirmed.handler.ts` | T-02: `PaymentConfirmedEvent` → `paid` state (skips COD) |
| `events/payment-failed.handler.ts` | T-03: `PaymentFailedEvent` → `cancelled` state |

### Tasks

| File | Description |
|------|-------------|
| `tasks/order-timeout.task.ts` | `@Cron(EVERY_MINUTE)` — auto-cancels expired `pending` and `paid` orders |

### Controllers

| File | Description |
|------|-------------|
| `controllers/order-lifecycle.controller.ts` | HTTP endpoints for all lifecycle transitions (see API below) |

### DTOs

| File | Description |
|------|-------------|
| `dto/cancel-order.dto.ts` | `CancelOrderDto` (reason) + `RefundOrderDto` (reason) |

### Repositories

| File | Description |
|------|-------------|
| `repositories/order.repository.ts` | `findById`, `findExpiredPendingOrPaid`, `findWithItems`, `findTimeline` |

### Services

| File | Description |
|------|-------------|
| `services/order-lifecycle.service.ts` | `assertOwnership` — verifies restaurant/customer ownership before transitions |

---

## Database Migration

**File:** `src/drizzle/out/0009_phase5_order_lifecycle.sql`

```sql
ALTER TABLE orders ADD COLUMN version integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN shipper_id uuid;
ALTER TABLE ordering_restaurant_snapshots
  ADD COLUMN owner_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE ordering_restaurant_snapshots ALTER COLUMN owner_id DROP DEFAULT;
```

---

## Prerequisite Changes Applied

| File | Change |
|------|--------|
| `order/order.schema.ts` | Added `version integer NOT NULL DEFAULT 0`, `shipperId uuid`; exported `OrderStatus`, `TriggeredByRole` types |
| `acl/schemas/restaurant-snapshot.schema.ts` | Added `ownerId: uuid('owner_id').notNull()` |
| `acl/repositories/restaurant-snapshot.repository.ts` | Persist `ownerId` in upsert; added `findByRestaurantIdAndOwnerId()` |
| `acl/projections/restaurant-snapshot.projector.ts` | Destructure and pass `ownerId` from `RestaurantUpdatedEvent` |
| `shared/events/restaurant-updated.event.ts` | Added `ownerId: string` as 6th constructor parameter |
| `restaurant-catalog/restaurant/restaurant.service.ts` | Pass `restaurant.ownerId` in both `publishRestaurantEvent` and `remove()` calls |
| `shared/events/order-cancelled-after-payment.event.ts` | Extended `cancelledByRole` to `'customer' \| 'restaurant' \| 'admin' \| 'system'` |
| `shared/events/payment-failed.event.ts` | Removed incorrect "cart recovery" comment |
| `app.module.ts` | Added `ScheduleModule.forRoot()` |
| `drizzle/seeds/seed.ts` | Added `ownerId` to all `ordering_restaurant_snapshots` seed rows |

---

## API Endpoints

All endpoints require authentication. Role permissions are enforced per the `TRANSITIONS` map.

| Method | Path | Transition | Notes |
|--------|------|-----------|-------|
| `PATCH` | `/orders/:id/confirm` | T-01: `pending/paid → confirmed` | restaurant, admin |
| `PATCH` | `/orders/:id/start-preparing` | T-06: `confirmed → preparing` | restaurant, admin |
| `PATCH` | `/orders/:id/ready` | T-08: `preparing → ready_for_pickup` | restaurant, admin |
| `PATCH` | `/orders/:id/pickup` | T-09: `ready_for_pickup → picked_up` | shipper, admin |
| `PATCH` | `/orders/:id/en-route` | T-10: `picked_up → delivering` | shipper, admin |
| `PATCH` | `/orders/:id/deliver` | T-11: `delivering → delivered` | shipper, admin |
| `PATCH` | `/orders/:id/cancel` | T-03/T-05/T-07: any cancelable → `cancelled` | requires reason |
| `POST` | `/orders/:id/refund` | T-12: `delivered → refunded` | admin only |
| `GET` | `/orders/:id` | — | get order with items |
| `GET` | `/orders/:id/timeline` | — | get full event timeline |

---

## State Machine Transitions (ALLOWED_TRANSITIONS)

```
pending→confirmed        restaurant, admin
pending→paid             system (VNPay webhook)
pending→cancelled        customer, restaurant, admin, system (requireNote)
paid→confirmed           restaurant, admin
paid→cancelled           customer, restaurant, admin, system (requireNote, triggersRefundIfVnpay)
confirmed→preparing      restaurant, admin
confirmed→cancelled      restaurant, admin (requireNote, triggersRefundIfVnpay)
preparing→ready_for_pickup  restaurant, admin (triggersReadyForPickup)
ready_for_pickup→picked_up  shipper, admin
picked_up→delivering     shipper, admin
delivering→delivered     shipper, admin
delivered→refunded       admin (requireNote)
```

---

## Design Decisions

- **D1-C:** Single `TransitionOrderCommand` for all lifecycle state changes — no per-transition commands
- **D6-A:** Hand-crafted `TRANSITIONS` map is the sole source of truth — no XState, no lib
- **D3-B:** Restaurant ownership verified against `ordering_restaurant_snapshots` ACL table — no cross-module import
- **Optimistic locking:** `version` column incremented on every transition; concurrent writes throw `ConflictException`
- **No outbox pattern:** Events published inline within the DB transaction (acceptable for current scale)
- **COD guard:** `PaymentConfirmedEventHandler` checks `paymentMethod === 'cod'` and skips — COD flows directly T-01
- **Epsilon comparison:** `paidAmount` vs `order.totalAmount` uses `Math.abs(diff) < 0.01` to avoid float issues

---

## TypeScript Compilation

After implementation, `npx tsc --noEmit` passes with **zero errors**.
