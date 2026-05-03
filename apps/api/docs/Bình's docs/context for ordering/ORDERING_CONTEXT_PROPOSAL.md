# Ordering Context — Architectural Proposal

> **Document Type:** Living Design Document (Code-Verified)
> **Author Role:** Senior Software Architect
> **Status:** Phases 0–4 Complete — Production-Ready ✅
> **Target Project:** `SoLi-Food-Order-and-Deliver-App` / `apps/api`
> **Last Verified Against:** Full codebase audit — all facts cross-checked with source files

### Change Legend
- **[UPDATED]** — Section corrected to match current implementation
- **[ADDED]** — New content not present in previous version
- **[REMOVED]** — Content removed (feature deprecated or superseded)
- **[DEPRECATED]** — Design decision superseded by newer implementation
- **[IMPLEMENTED]** — Confirmed present in source code

---

## Table of Contents

1. [Context Overview](#1-context-overview)
2. [Scope & Boundaries](#2-scope--boundaries)
3. [Domain Model](#3-domain-model)
4. [Key Design Decisions](#4-key-design-decisions)
5. [Phase Breakdown](#5-phase-breakdown)
6. [Module Architecture](#6-module-architecture)
7. [Integration Patterns](#7-integration-patterns)
8. [State Machine Specification](#8-state-machine-specification)
9. [Pricing Model](#9-pricing-model)
10. [Delivery Zone Architecture](#10-delivery-zone-architecture)
11. [Event Catalog](#11-event-catalog)
12. [Phase Roadmap](#12-phase-roadmap)
13. [Pre-Implementation Checklist](#13-pre-implementation-checklist)

---

## 1. Context Overview

The **Ordering Context** is the **core domain** of the SoLi Food Delivery platform. It orchestrates the complete order lifecycle — from a customer adding items to a cart, through checkout and payment, to final delivery.

### Position in the System

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SoLi Platform (Modular Monolith)                    │
│                                                                             │
│   ┌──────────────┐    events/calls     ┌──────────────────────────────┐    │
│   │     IAM      │ ─────────────────►  │          ORDERING            │    │
│   │  (Shared     │                     │         (Core Domain)        │    │
│   │   Kernel)    │                     │                              │    │
│   └──────────────┘                     │  CartModule                  │    │
│                                        │  OrderModule                 │    │
│   ┌──────────────┐    events           │  OrderLifecycleModule        │    │
│   │  Restaurant  │ ─────────────────►  │  OrderHistoryModule          │    │
│   │  & Catalog   │    (upstream)       │                              │    │
│   │  (Upstream)  │                     └───────────┬──────────────────┘    │
│   └──────────────┘                                 │                       │
│                                                    │ events (downstream)   │
│                                     ┌──────────────┼──────────────────┐   │
│                                     ▼              ▼                  ▼   │
│                              ┌──────────┐  ┌────────────┐  ┌──────────┐  │
│                              │ Payment  │  │  Delivery  │  │ Notific- │  │
│                              │ Context  │  │  Context   │  │  ation   │  │
│                              └──────────┘  └────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Roles Involved

| Role       | Ordering Actions                                    |
|------------|-----------------------------------------------------|
| Customer   | Manage cart, place order, cancel, track, reorder    |
| Restaurant | Confirm order, mark preparing, mark ready for pickup |
| Shipper    | Pickup order, mark delivering, mark delivered        |
| Admin      | Override any state, view all orders                  |

---

## 2. Scope & Boundaries

### 2.1 What Is Inside the Ordering Context

| Module               | Responsibility                                             |
|----------------------|------------------------------------------------------------|
| `CartModule`         | Cart CRUD, single-restaurant constraint, item management   |
| `OrderModule`        | Order aggregate creation, price snapshot, checkout         |
| `OrderLifecycleModule` | State machine, state transitions, permission per actor  |
| `OrderHistoryModule` | Read-side queries for past orders (Customer, Restaurant, Shipper) |

### 2.2 What Is Outside the Ordering Context

| Concern              | Belongs To             | How Ordering Interacts                           |
|----------------------|------------------------|--------------------------------------------------|
| Menu item data/price | Restaurant & Catalog   | Via local projection (event-driven snapshot)     |
| Restaurant open/closed | Restaurant & Catalog | Via local projection snapshot (D3-B selected)    |
| Payment processing   | Payment Context        | Ordering publishes `OrderPlacedEvent`            |
| Shipper assignment   | Delivery Context       | Ordering publishes `OrderReadyForPickupEvent`    |
| Push notifications   | Notification Context   | Ordering publishes `OrderStatusChangedEvent`     |

### 2.3 Business Rules Governing This Context

| Rule  | Description                                                                             |
|-------|-----------------------------------------------------------------------------------------|
| BR-2  | Cart must contain items from **one restaurant only**                                    |
| BR-3  | Delivery address must be within the restaurant's operational radius                     |
| BR-4  | Payment: COD and VNPay supported. VNPay orders transition `PENDING → PAID` upon `PaymentConfirmedEvent` from Payment Context, then await restaurant confirmation (`PAID → CONFIRMED`). COD orders skip the `PAID` state and go directly `PENDING → CONFIRMED` upon restaurant confirmation. |
| BR-7  | Orders follow a defined sequential state machine (see Section 8)                        |
| BR-8  | Restaurant/item availability is enforced at checkout time                               |

---

## 3. Domain Model

### 3.1 Entities & Value Objects **[UPDATED]**

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ORDERING CONTEXT — Domain Model                                            │
│                                                                            │
│  ┌──────────────────┐  1        N  ┌─────────────────────────────────┐   │
│  │      Cart        │ ──────────── │           CartItem              │   │
│  │──────────────────│              │─────────────────────────────────│   │
│  │ cartId (uuid)    │              │ cartItemId (stable UUID)        │   │  ← [ADDED]
│  │ customerId       │              │ modifierFingerprint (hash)      │   │  ← [ADDED]
│  │ restaurantId     │              │ menuItemId                      │   │
│  │ restaurantName   │              │ itemName    ← snapshotted       │   │
│  │ items[]          │              │ unitPrice   ← snapshotted       │   │
│  │ createdAt        │              │ quantity    (max 99)            │   │  ← [ADDED]
│  │ updatedAt        │              │ selectedModifiers[]             │   │  ← [ADDED]
│  │                  │              │   groupId, groupName            │   │
│  │ Redis-only (D2-B)│              │   optionId, optionName, price   │   │
│  │ TTL: 604800s (7d)│              └─────────────────────────────────┘   │
│  └──────────────────┘                                                      │
│                                                                            │
│  ┌─────────────────────┐  1    N  ┌───────────────────────────────────┐  │
│  │       Order         │ ──────── │           OrderItem               │  │
│  │─────────────────────│          │───────────────────────────────────│  │
│  │ id (PK, uuid)       │          │ id (PK)                           │  │
│  │ customerId          │          │ orderId (FK cascade)              │  │
│  │ restaurantId        │          │ menuItemId                        │  │
│  │ restaurantName ◄────┤ snapshot │ itemName       ← immutable snap   │  │
│  │ cartId (UNIQUE D5-B)│          │ unitPrice      ← NUMERIC(12,2)   │  │  ← [UPDATED]
│  │ status (enum)       │          │ modifiersPrice ← NUMERIC(12,2)   │  │  ← [ADDED]
│  │ totalAmount         │          │ quantity                          │  │
│  │ paymentMethod       │          │ subtotal       ← NUMERIC(12,2)   │  │  ← [UPDATED]
│  │ deliveryAddress     │          │ modifiers[]    ← JSONB snapshot   │  │  ← [ADDED]
│  │ note                │          └───────────────────────────────────┘  │
│  │ paymentUrl          │                                                   │
│  │ expiresAt           │  1    N  ┌────────────────────────────────────┐  │
│  │ createdAt           │ ──────── │         OrderStatusLog             │  │
│  │ updatedAt           │          │────────────────────────────────────│  │
│  └─────────────────────┘          │ id (PK)                            │  │
│                                   │ orderId (FK cascade)               │  │
│  ┌──────────────────────┐          │ fromStatus (nullable — null=init) │  │  ← [ADDED]
│  │   DeliveryAddress    │          │ toStatus                          │  │
│  │──────────────────────│          │ triggeredBy (nullable — null=sys) │  │  ← [UPDATED]
│  │ street               │          │ triggeredByRole (enum)            │  │
│  │ district             │          │ note                              │  │
│  │ city                 │          │ createdAt                         │  │
│  │ latitude? (number)   │          └────────────────────────────────────┘  │
│  │ longitude? (number)  │                                                   │
│  └──────────────────────┘                                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

**Order status enum:** `pending | paid | confirmed | preparing | ready_for_pickup | picked_up | delivering | delivered | cancelled | refunded`

**Payment method enum:** `cod | vnpay`

**TriggeredByRole enum:** `customer | restaurant | shipper | admin | system`

**OrderModifier (JSONB in order_items.modifiers):**
```typescript
{
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  price: number;          // snapshotted at checkout — immutable
}
```

### 3.2 Local Read Models (Projections — ACL Layer) **[UPDATED]**

These are **owned by the Ordering context**, kept in sync via domain events from upstream:

```
┌──────────────────────────────────────────────────────────────────────┐
│ ordering_menu_item_snapshots  (PostgreSQL — D4-B)  [IMPLEMENTED]     │
│──────────────────────────────────────────────────────────────────────│
│ menuItemId (PK)     ← upstream ID — NOT a FK                        │
│ restaurantId                                                         │
│ name                                                                 │
│ price               ← NUMERIC(12,2) — authoritative price at checkout│
│ status              ← available | unavailable | out_of_stock         │
│ modifiers           ← JSONB MenuItemModifierSnapshot[]  [ADDED]      │
│ lastSyncedAt                                                         │
│                                                                      │
│ Populated by: MenuItemProjector ← MenuItemUpdatedEvent               │
│ Consumed by:  CartService (addItem validation)                       │
│               PlaceOrderHandler (checkout validation + price snap)   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ ordering_restaurant_snapshots  (PostgreSQL — D4-B)  [IMPLEMENTED]   │
│──────────────────────────────────────────────────────────────────────│
│ restaurantId (PK)   ← upstream ID — NOT a FK                        │
│ name                                                                 │
│ isOpen                                                               │
│ isApproved                                                           │
│ address                                                              │
│ cuisineType                                                          │
│ latitude            ← optional; used by BR-3 Haversine check        │
│ longitude           ← optional; used by BR-3 Haversine check        │
│ lastSyncedAt                                                         │
│                                                                      │
│ NOTE: deliveryRadiusKm has been REMOVED — see Section 10.            │
│ Populated by: RestaurantSnapshotProjector ← RestaurantUpdatedEvent   │
│ Consumed by:  PlaceOrderHandler (open/approved check at checkout)    │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ ordering_delivery_zone_snapshots  (PostgreSQL — D4-B)  [ADDED]      │
│──────────────────────────────────────────────────────────────────────│
│ zoneId (PK)         ← upstream ID — NOT a FK                        │
│ restaurantId        ← indexed for fast BR-3 checkout lookup          │
│ name                                                                 │
│ radiusKm            ← doublePrecision                                │
│ baseFee             ← NUMERIC(10,2)                                  │
│ perKmRate           ← NUMERIC(10,2)                                  │
│ avgSpeedKmh         ← real                                           │
│ prepTimeMinutes     ← real                                           │
│ bufferMinutes       ← real                                           │
│ isActive            ← boolean                                        │
│ isDeleted           ← boolean (tombstone for hard-deleted zones)     │
│ lastSyncedAt                                                         │
│                                                                      │
│ Populated by: DeliveryZoneSnapshotProjector                          │
│               ← DeliveryZoneSnapshotUpdatedEvent                     │
│ Consumed by:  PlaceOrderHandler (BR-3 zone check at checkout)        │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.3 Cart Item Identity — `cartItemId` and `modifierFingerprint` **[ADDED]**

A customer may add the same `menuItemId` multiple times with different modifier selections (e.g., "Large Latte" and "Small Latte"). These are stored as **separate line items** distinguished by a **stable `cartItemId`** and a deterministic **`modifierFingerprint`**.

```
Fingerprint algorithm (buildFingerprintFromResolved):
  1. Take resolved SelectedModifier[]
  2. Sort by (groupId ASC, optionId ASC)
  3. Concatenate: "groupId1:optionId1|groupId2:optionId2|..."
  4. Empty modifiers → empty string ""

Merge rule (addItem):
  if (existingItem.menuItemId === newItem.menuItemId
      && existingItem.modifierFingerprint === newItem.modifierFingerprint):
      existingItem.quantity += newItem.quantity   ← merge
  else:
      cart.items.push(newItem)                    ← append new line
```

**Key operations use `cartItemId` (not `menuItemId`):**
- `PATCH /carts/my/items/:cartItemId` — update quantity for specific line
- `PATCH /carts/my/items/:cartItemId/modifiers` — replace modifiers for specific line
- `DELETE /carts/my/items/:cartItemId` — remove specific line

---

## 4. Key Design Decisions

> ✅ **All decisions have been finalized.** The selections below are locked in and reflected throughout this document. No further action required in this section.

---

### D1 — CQRS Adoption Strategy

The current codebase uses a simple `Service → Repository` pattern (no `@nestjs/cqrs`). The Demo project uses full CQRS with `CommandBus`, `EventBus`, and `CommandHandler`.

---

#### Option A: Full CQRS (`@nestjs/cqrs`)

Install `@nestjs/cqrs`. Use `CommandBus`, `QueryBus`, `EventBus`, `CommandHandler`, `QueryHandler`, `EventsHandler`.

```
CartController
    │  commandBus.execute(AddItemToCartCommand)
    ▼
AddItemToCartHandler  ← handles domain logic, persists
    │  eventBus.publish(CartItemAddedEvent)
    ▼
[Other handlers react if needed]
```

**Pros:**
- Strict separation of write (Command) and read (Query) paths
- Event publishing is built-in and idiomatic
- Future microservice extraction requires only swapping `EventBus` transport
- Consistent with the Demo project's architecture

**Cons:**
- `@nestjs/cqrs` is not installed — requires new dependency and learning curve
- More boilerplate: separate Command/Handler classes per operation
- Potentially over-engineered for early MVP phases (cart CRUD)

---

#### Option B: Simple Service Pattern (Current Convention)

Follow the existing `restaurant-catalog` pattern: `Controller → Service → Repository`. Emit events manually using Node.js `EventEmitter2` or NestJS's built-in `EventEmitter`.

```
CartController
    │  this.cartService.addItem(...)
    ▼
CartService  ← handles domain logic, persists via CartRepository
    │  this.eventEmitter.emit('order.placed', payload)
    ▼
[Other services listen via @OnEvent decorator]
```

**Pros:**
- Zero new dependencies
- Consistent with the existing `restaurant-catalog` module immediately
- Faster to scaffold (no Command/Query boilerplate)

**Cons:**
- Mixed read/write responsibility in Service classes over time
- Event system is `EventEmitter2` (not type-safe by default, weaker contract)
- Harder to migrate to microservices later (EventEmitter is in-process only — same as CQRS, but contract is weaker)

---

#### Option C: Hybrid — Services Now, CQRS at Order Placement Only (Tui chọn option này ✅SELECTED.)

Use simple `Service → Repository` for Cart CRUD, but adopt `@nestjs/cqrs` **only for the PlaceOrder command** (the most critical write operation).

```
CartModule      → Service-based (simple)
OrderModule     → CommandHandler-based (CQRS)
                → EventBus for downstream integration
```

**Pros:**
- Balances pragmatism and architecture
- Ordering's critical path uses the right pattern
- Cart is simple enough not to need full CQRS

**Cons:**
- Inconsistency within the Ordering context itself
- Still requires installing `@nestjs/cqrs`

---

> **Selected Option:** [ ] A   [ ] B   [✅SELECTED] C

---

### D2 — Cart Persistence Strategy

Where and how is a customer's cart stored?

---

#### Option A: Database Only (PostgreSQL via Drizzle)

Cart and CartItems are stored in PostgreSQL tables, same as other entities.

**Pros:**
- No additional infrastructure (no Redis)
- Durable — survives API restarts
- Consistent with current stack
- Easy to query for admin/debugging

**Cons:**
- Slightly higher latency for frequent cart operations (add/remove item)
- DB load from high-frequency operations

---

#### Option B: Redis + Database (Write-through) (Tui chọn option này ✅SELECTED)

Cart is stored in Redis (fast read/write). When order is placed, cart data is persisted to PostgreSQL and Redis entry is cleared.

**Pros:**
- Very fast cart operations (sub-millisecond reads)
- Natural TTL for abandoned carts (e.g., 24h expiry)

**Cons:**
- Requires Redis infrastructure — ✅ `redis:7-alpine` already added to `docker-compose.yml`
- Cart lives solely in Redis — no DB fallback (by design, D2-B)
- New pattern introduced in this codebase

---

#### Option C: Database with Soft-delete / TTL via cron

Cart stored in PostgreSQL. A scheduled job cleans up carts older than N hours.

**Pros:**
- Durable, auditable, no extra infra
- Abandoned cart analytics possible later

**Cons:**
- Requires a cron job setup
- Slightly more complex schema (need `expiresAt` or `lastActivityAt`)

---

> **Selected Option:** [ ] A   [✅SELECTED ] B   [ ] C

---

### D3 — Restaurant & Item Validation at Checkout

When a customer checks out, the system must verify:
1. The restaurant is `isOpen = true` and `isApproved = true`
2. All cart items are `status = 'available'`

How does Ordering access this data without importing `RestaurantService`?

---

#### Option A: Direct Synchronous Call to RestaurantService (Current Pattern)

Ordering's `CheckoutService` injects `RestaurantService` (same process, already done in `MenuService`).

```
CheckoutService
    │  this.restaurantService.assertOpenAndApproved(restaurantId)
    │  this.menuService.assertItemAvailable(itemId)  ← for each item
    ▼
Order created
```

**Pros:**
- No new infrastructure
- Immediately consistent (reads from canonical source)
- Already used in `MenuService` for ownership check

**Cons:**
- Tight coupling between Ordering and Restaurant catalog
- Violates bounded context boundary (Ordering imports RestaurantModule)
- Harder to extract to microservice later

---

#### Option B: Local Projection Snapshot (Event-Driven, Pure DDD) (Tui chọn option này ✅SELECTED)

Ordering maintains its own snapshots of `MenuItem` and `Restaurant` state, kept fresh via domain events.

```
RestaurantService  ──(RestaurantUpdatedEvent)──►  RestaurantSnapshotProjector
MenuService        ──(MenuItemUpdatedEvent)────►  MenuItemProjector

CheckoutHandler
    │  this.menuItemProjector.findManyByIds([...])
    │  this.restaurantProjector.findById(restaurantId)
    │  validate locally — zero cross-module calls
    ▼
Order created
```

**Pros:**
- Zero coupling between Ordering and Restaurant catalog at runtime
- Matches the Demo project's architecture exactly
- Easily extracted to microservice: just swap EventBus transport
- Price is already available in the snapshot → no extra lookup needed

**Cons:**
- Eventual consistency: snapshot may lag behind reality (milliseconds in same process)
- Restaurant Catalog must publish events — currently it does NOT (needs to be added)
- Slightly more complex setup (projector classes, event contracts)

---

#### Option C: Anti-Corruption Layer (ACL) Facade

Create an `OrderingACL` module that wraps `RestaurantService` behind an interface. The Ordering context only depends on the interface.

```
ordering/acl/
    restaurant-catalog.facade.ts   ← interface only Ordering uses
    restaurant-catalog.adapter.ts  ← implements facade, imports RestaurantModule
```

**Pros:**
- Decouples Ordering from implementation details of Restaurant catalog
- Easy to swap adapter if Restaurant becomes a microservice later

**Cons:**
- More files/abstractions for same result as Option A initially
- Still synchronous at runtime — same consistency as A

---

> **Selected Option:** [ ] A   [✅SELECTED ] B   [ ] C

---

### D4 — Menu Item Snapshot Storage

If Option B or C is selected for D3, where are local snapshots stored?

---

#### Option A: In-Memory Map (Same Process)

Use a `Map<id, Snapshot>` in the Projector class (as in Demo project).

**Pros:**
- Zero DB overhead
- Instant lookup
- Simple implementation

**Cons:**
- Lost on API restart → needs warm-up event replay or initial sync
- Memory grows with catalog size (large menus = large map)

---

#### Option B: PostgreSQL Table (`ordering.menu_item_snapshots`) (Tui chọn option này ✅SELECTED)

Store snapshots in a dedicated DB table owned by the Ordering context.

**Pros:**
- Survives restarts with no replay needed
- Queryable for debugging
- Scales better than in-memory for large catalogs

**Cons:**
- Additional Drizzle schema/migration
- Slightly higher latency than in-memory (still fast for local queries)

---

> **Selected Option:** [ ] A   [✅SELECTED ] B

---

### D5 — Order Idempotency

Prevent duplicate orders if a customer submits checkout twice (double-click, network retry).

---

#### Option A: Idempotency Key Header (Tui chọn option A này và cả option B bên dưới, tui có giải thích tại sao chọn cả 2 bên dưới ✅SELECTED)

Client sends a unique `X-Idempotency-Key` header. Server checks if this key was processed; if yes, returns the cached result.

```
POST /orders
X-Idempotency-Key: uuid-from-client

Server: if key seen → return cached Order
        else → process + store key + return Order
```

**Pros:**
- Industry standard pattern
- Works for any client (mobile, web)

**Cons:**
- Client must generate and manage the key
- Requires a short-lived storage for processed keys (Redis or DB table)

> 🟢 **[FIXED][from RISK]** Idempotency key storage is documented. Redis key schema and TTL are specified in Phase 0 config (see Phase 0 scope below).

---

#### Option B: DB Unique Constraint on Cart ID (tui chọn option B này và cả option A bên trên, tui có giải thích lý do bên dưới ✅SELECTED)

When a cart is converted to an order, store `cartId` on the Order and enforce a `UNIQUE(cartId)` constraint. A second checkout attempt for the same cart fails at DB level.

**Pros:**
- No client changes required
- Zero-cost deduplication via DB constraint
- Simple to implement with Drizzle

**Cons:**
- Only prevents duplicate order from same cart; does not handle general API retries
- Cart must be locked/cleared immediately after order creation

---

> **Selected Option:** [✅SELECTED ] A   [✅SELECTED ] B
(I select both Option A (Idempotency Key) and Option B (DB Unique Constraint on cartId).
Option A ensures request-level idempotency, preventing duplicate processing caused by retries or double-clicks. 
Option B enforces a data-level invariant, guaranteeing that a cart can only be converted into a single order, even under race conditions or inconsistent client behavior. 
Combining both provides a defense-in-depth strategy, which is especially critical when integrating with payment gateways such as VNPay.)

---

### D6 — Order State Machine Implementation

---

#### Option A: Hand-crafted Transition Table in Service (Tui chọn option này ✅SELECTED)

Define allowed transitions as a plain TypeScript object and validate in `OrderLifecycleService`.

```typescript
// Status values use lowercase — matching the PostgreSQL enum ('order_status')
const ALLOWED_TRANSITIONS = {
  pending:           ['paid', 'confirmed', 'cancelled'],
  // paid: reachable only for VNPay orders via PaymentConfirmedEvent (system-triggered)
  // confirmed: reachable directly for COD orders via restaurant confirmation
  paid:              ['confirmed', 'cancelled'],
  confirmed:         ['preparing', 'cancelled'],
  preparing:         ['ready_for_pickup'],
  ready_for_pickup:  ['picked_up'],
  picked_up:         ['delivering'],
  delivering:        ['delivered'],
  delivered:         ['refunded'],
  cancelled:         [],
  refunded:          [],
};
```

**Pros:**
- No new dependency
- Easy to read and maintain
- Consistent with existing code style

**Cons:**
- Side effects (events, notifications) must be manually wired
- Risk of forgetting to publish events after transition

---

#### Option B: XState or Similar State Machine Library

Use a formal state machine library.

**Pros:**
- Explicit side effects (`entry`, `exit` actions)
- Visual tooling available

**Cons:**
- New dependency
- Additional learning curve
- Likely over-engineered for this stage

---

> **Selected Option:** [✅SELECTED ] A   [ ] B
> *(Recommendation: Option A is sufficient and consistent with current style)*

---

## 5. Phase Breakdown

Each phase has a **clear scope**, is **independently deliverable**, and ends with a **working, testable state**.

---

### Phase 0 — Infrastructure Setup **[IMPLEMENTED]**

**Goal:** Prepare the Ordering context skeleton without any domain logic.

**Scope:**
- Install `@nestjs/cqrs` — ✅ `@nestjs/cqrs ^11.0.3`
- Install `ioredis` — ✅ `ioredis ^5.10.1`
- Create context folder structure `src/module/ordering/` — ✅
- Create `ordering.module.ts` (root context module, imports all sub-modules) — ✅
- Register `OrderingModule` in `app.module.ts` — ✅
- Create `RedisModule` (global) in `src/lib/redis/` — ✅ (`redis.module.ts`, `redis.service.ts`, `redis.constants.ts`)
- Register `RedisModule` in `app.module.ts` — ✅
- Create `GeoModule`/`GeoService` in `src/lib/geo/` — ✅ (Haversine utilities) **[ADDED]**
- Create `src/shared/events/` with typed event classes — ✅
- Create placeholder module files: `cart.module.ts`, `order.module.ts`, `order-lifecycle.module.ts`, `order-history.module.ts` — ✅
- Create `src/module/ordering/acl/` — ✅
- Create `src/module/ordering/common/ordering.constants.ts` — ✅

**Redis key schema and constants (from `ordering.constants.ts`):**
```typescript
IDEMPOTENCY_KEY_PREFIX          = 'idempotency:order:'   // key: idempotency:order:<X-Idempotency-Key>
IDEMPOTENCY_TTL_FALLBACK_SECONDS = 300                   // 5 min (matches ORDER_IDEMPOTENCY_TTL_SECONDS seed)
CART_KEY_PREFIX                 = 'cart:'                // key: cart:<customerId>
CART_TTL_SECONDS                = 604800                 // 7 days
CART_LOCK_SUFFIX                = ':lock'                // key: cart:<customerId>:lock
CART_LOCK_TTL_SECONDS           = 30                     // checkout lock duration
```

- `@nestjs/event-emitter` is **NOT used** — all events use CQRS `EventBus` exclusively
- `CqrsModule` must be imported in every module that publishes or handles events
- Add Redis service to `docker-compose.yml` — ✅ `redis:7-alpine`
- Add `REDIS_HOST`, `REDIS_PORT` to `.env.example` — ✅

**Deliverable:** App boots with `OrderingModule` + `RedisModule` + `GeoModule` registered and no errors.

---

### Phase 1 — Domain Schema (Drizzle Tables) **[IMPLEMENTED]**

**Goal:** Define all database tables for the Ordering context.

**Scope:**
- ~~`carts` table~~ — **not needed (D2-B): cart is Redis-only**
- ~~`cart_items` table~~ — **not needed (D2-B): items are embedded in the Redis cart JSON**
- `orders` table
- `order_items` table (immutable price snapshot per line)
- `order_status_logs` table
- `ordering_menu_item_snapshots` table — required (D4-B selected)
- `ordering_restaurant_snapshots` table — required (D3-B + D4-B selected)
- `ordering_delivery_zone_snapshots` table — **[ADDED]** required for BR-3 (replaces `deliveryRadiusKm`)
- `app_settings` table — stores runtime-configurable platform parameters
- Export all types
- Register schemas in `drizzle/schema.ts`
- Run migration (`db:push`)

**Redis Cart Structure (D2-B — no DB tables for cart):** **[UPDATED]**
```json
{
  "cartId": "uuid",
  "customerId": "string",
  "restaurantId": "string",
  "restaurantName": "string",
  "items": [
    {
      "cartItemId": "uuid (stable, generated at item add)",
      "modifierFingerprint": "groupId:optionId|... or ''",
      "menuItemId": "string",
      "itemName": "string (snapshotted)",
      "unitPrice": "number (snapshotted)",
      "quantity": "number (max 99)",
      "selectedModifiers": [
        { "groupId": "...", "groupName": "...", "optionId": "...", "optionName": "...", "price": 0 }
      ]
    }
  ],
  "createdAt": "ISO string",
  "updatedAt": "ISO string"
}
```
- **Key pattern:** `cart:<customerId>` — one active cart per customer
- **TTL:** `CART_TTL_SECONDS = 604800` (7 days) — reset on every write

**Table Overview:** **[UPDATED]**

| Table                                 | Key Fields                                                                                                                                                      |
|---------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `orders`                              | `id`, `customerId`, `restaurantId`, `restaurantName`*, `cartId` (UNIQUE — D5-B), `status` (enum), `totalAmount` (NUMERIC(12,2)), `paymentMethod` (cod\|vnpay), `deliveryAddress` (JSONB), `note`, `paymentUrl`, `expiresAt`, `createdAt`, `updatedAt` |
| `order_items`                         | `id`, `orderId` (FK cascade), `menuItemId`, `itemName`*, `unitPrice`* (NUMERIC(12,2)), `modifiersPrice` (NUMERIC(12,2), default 0), `quantity`, `subtotal` (NUMERIC(12,2)), `modifiers` (JSONB `OrderModifier[]`) |
| `order_status_logs`                   | `id`, `orderId` (FK cascade), `fromStatus` (nullable — null = initial creation), `toStatus`, `triggeredBy` (nullable — null = system), `triggeredByRole` (enum), `note`, `createdAt` |
| `ordering_menu_item_snapshots`        | `menuItemId` (PK), `restaurantId`, `name`, `price` (NUMERIC(12,2)), `status` (enum), `modifiers` (JSONB), `lastSyncedAt` |
| `ordering_restaurant_snapshots`       | `restaurantId` (PK), `name`, `isOpen`, `isApproved`, `address`, `cuisineType`, `latitude`, `longitude`, `lastSyncedAt` |
| `ordering_delivery_zone_snapshots`    | `zoneId` (PK), `restaurantId` (indexed), `name`, `radiusKm`, `baseFee` (NUMERIC(10,2)), `perKmRate` (NUMERIC(10,2)), `avgSpeedKmh`, `prepTimeMinutes`, `bufferMinutes`, `isActive`, `isDeleted` (tombstone), `lastSyncedAt` |
| `app_settings`                        | `key` (PK, text), `value` (text), `description` (text), `updatedAt` |

> `*` = snapshotted value (not a FK — stored as plain data for immutable order history)

**Money column pattern (M-1 fix — NUMERIC, not float):**
```typescript
// All financial columns use this custom type to avoid IEEE-754 float precision loss.
const moneyColumn = customType<{ data: number; driverData: string }>({
  dataType() { return 'numeric(12, 2)'; },
  fromDriver(value) { return parseFloat(value); },
  toDriver(value) { return String(value); },
});
```
- Used in: `order_items.unitPrice`, `order_items.modifiersPrice`, `order_items.subtotal`, `orders.totalAmount`, `ordering_menu_item_snapshots.price`
- Delivery zone fees use `numeric(10, 2)` via a `zoneFeeColumn` helper

**`app_settings` seed rows (inserted in migration):**

| key | default value | description |
|-----|---------------|-------------|
| `ORDER_IDEMPOTENCY_TTL_SECONDS` | `300` | How long an idempotency key is retained in Redis (5 min) |
| `RESTAURANT_ACCEPT_TIMEOUT_SECONDS` | `600` | How long before unconfirmed PENDING/PAID order is auto-cancelled |
| `CART_ABANDONED_TTL_SECONDS` | `86400` | Redis TTL for inactive carts (24h) — informational; actual TTL is 7 days (`CART_TTL_SECONDS`) |

> **Design note:** `cartId` UNIQUE constraint on `orders` is NOT a foreign key — there is no `carts` DB table (D2-B). The constraint still enforces that a cart can only produce one order.

> **Design note:** `order_status_logs.fromStatus` is nullable: `null` indicates the initial `PENDING` state creation (no "from" status). `triggeredBy` is nullable: `null` indicates system-triggered transitions (payment confirmation, timeout).

**Deliverable:** Tables exist in DB. Types exported. No logic yet.

---

### Phase 2 — Cart Module **[IMPLEMENTED]**

**Goal:** Customers can manage their cart. Single-restaurant constraint and modifier identity are enforced.

**Scope:**
- `CartRedisRepository` — Redis operations: read/write/delete cart JSON at `cart:<customerId>`
- `CartService` — Domain logic:
  - `getCart(customerId)` → reads Redis; returns `null` if no cart
  - `addItem(customerId, dto)` → enforces BR-2 (single-restaurant); validates+resolves modifiers from snapshot; merges or appends using fingerprint
  - `updateItemQuantity(customerId, cartItemId, quantity)` → targets specific line by `cartItemId`; `quantity=0` removes line; 204 if cart becomes empty
  - `updateItemModifiers(customerId, cartItemId, dto)` → replace semantics — full modifier state replaced; re-validates constraints
  - `removeItem(customerId, cartItemId)` → removes specific line by `cartItemId`
  - `clearCart(customerId)` → deletes Redis key
- `CartController` — REST endpoints
- `CartModule`

> **No `CartRepository` (DB).** Cart state is never written to PostgreSQL. At checkout, cart data is read from Redis and written to `orders` + `order_items` in one atomic DB transaction. The Redis key is deleted best-effort after successful order creation.

**REST Endpoints:** **[UPDATED]**

```
GET    /carts/my                              → get customer's active cart (from Redis)
POST   /carts/my/items                        → add item to cart (merge or append)
PATCH  /carts/my/items/:cartItemId            → update quantity (0 = remove line; 204 if cart empty)
PATCH  /carts/my/items/:cartItemId/modifiers  → replace modifiers for a specific line (re-validates constraints)
DELETE /carts/my/items/:cartItemId            → remove specific line item
DELETE /carts/my                              → clear cart (delete Redis key)
POST   /carts/my/checkout                     → place order (dispatches PlaceOrderCommand)
```

All cart endpoints require authentication. No `@AllowAnonymous()`.

**BR-2 Enforcement Logic (single-restaurant cart):**
```
addItem(customerId, dto):
  1. Load cart from Redis (key: cart:<customerId>)
  2. If cart exists and cart.restaurantId !== dto.restaurantId → throw 409 CONFLICT
     "Cart already contains items from [restaurant name].
      Clear cart before adding from a different restaurant."
  3. Validate+resolve dto.selectedOptions against MenuItemSnapshot modifiers
     → validate: groupId/optionId exist, isAvailable, minSelections, maxSelections
     → resolve: server fills in groupName, optionName, price from snapshot
  4. Compute modifierFingerprint from resolved modifiers
  5. If existing line with same (menuItemId + fingerprint) → merge quantity
     else → append new CartItem (new cartItemId UUID assigned)
  6. SET cart JSON back to Redis, reset TTL to CART_TTL_SECONDS (7 days)
```

**Modifier validation at add-item time:**
- Client submits only `groupId` + `optionId` (no names or prices)
- Server resolves names and prices from `ordering_menu_item_snapshots.modifiers` JSONB
- Validates: group+option exist in snapshot, option `isAvailable`, `minSelections`/`maxSelections` satisfied
- Rejects with 400 if any constraint fails

**Max quantity per line item:** 99 (`@Max(99)` on DTO)

**Deliverable:** Cart CRUD works end-to-end. Single-restaurant constraint and modifier identity enforced.

---

### Phase 3 — ACL Layer (Menu Item, Restaurant & Delivery Zone Projections) **[IMPLEMENTED]**

> **D3-B is active.** The Ordering context does NOT import `RestaurantModule`, `MenuModule`, or `ZonesModule` at runtime. All validation uses local PostgreSQL snapshots populated by event projectors.

**Goal:** The Ordering context maintains local, up-to-date snapshots of `MenuItem`, `Restaurant`, and `DeliveryZone` state. Zero cross-module service calls at runtime.

**Scope:**

**Part A — Event Contracts (Shared)** **[UPDATED]**

| Event | Direction | Publisher | Consumer |
|-------|-----------|-----------|----------|
| `MenuItemUpdatedEvent` | Upstream → Ordering | `MenuService` | `MenuItemProjector` |
| `RestaurantUpdatedEvent` | Upstream → Ordering | `RestaurantService` | `RestaurantSnapshotProjector` |
| `DeliveryZoneSnapshotUpdatedEvent` | Upstream → Ordering | `ZonesService` | `DeliveryZoneSnapshotProjector` |

> `isAvailable` field has been **[REMOVED]** from `MenuItemUpdatedEvent`. `status` enum is the single canonical availability field.

**Part B — Restaurant Catalog Changes (Upstream)** **[IMPLEMENTED]**
- `MenuService`: publishes `MenuItemUpdatedEvent` after `create()`, `update()`, `toggleSoldOut()`, `remove()` (publishes `status=unavailable` on delete)
- `RestaurantService`: publishes `RestaurantUpdatedEvent` after `create()`, `update()`, status changes
- `ZonesService`: publishes `DeliveryZoneSnapshotUpdatedEvent` after `create()`, `update()`, `remove()` (isDeleted=true on remove)
- `CqrsModule` imported in `MenuModule`, `RestaurantModule`, `ZonesModule`

**Part C — Projectors in Ordering Context** **[IMPLEMENTED]**
- `MenuItemProjector` — `@EventsHandler(MenuItemUpdatedEvent)` — upserts `ordering_menu_item_snapshots`; `modifiers=null` → skips modifiers column update (preserves existing snapshot)
- `RestaurantSnapshotProjector` — `@EventsHandler(RestaurantUpdatedEvent)` — upserts `ordering_restaurant_snapshots`
- `DeliveryZoneSnapshotProjector` — `@EventsHandler(DeliveryZoneSnapshotUpdatedEvent)` — upserts or tombstones `ordering_delivery_zone_snapshots` **[ADDED]**
- `MenuItemSnapshotRepository` — `findById`, `findManyByIds`, `upsert`
- `RestaurantSnapshotRepository` — `findById`, `upsert`
- `DeliveryZoneSnapshotRepository` — `findActiveByRestaurantId`, `upsert`, `markDeleted` **[ADDED]**
- `AclModule` — wires projectors, repositories, `CqrsModule`, `DatabaseModule`
- `AclController` — diagnostic endpoints (no auth):
  - `GET /ordering/menu-items?ids=...` → bulk fetch menu item snapshots
  - `GET /ordering/menu-items/:id` → single menu item snapshot
  - `GET /ordering/restaurants?ids=...` → bulk fetch restaurant snapshots
  - `GET /ordering/restaurants/:id` → single restaurant snapshot

**Tombstone pattern for delivery zone hard-deletes:** **[ADDED]**
```
ZonesService.remove() → eventBus.publish(DeliveryZoneSnapshotUpdatedEvent { isDeleted: true })
                           ↓
DeliveryZoneSnapshotProjector.handle()
  → isDeleted=true → repo.markDeleted(zoneId)
      → UPDATE SET isDeleted=true, isActive=false
      (row preserved for event-replay safety; excluded from BR-3 queries)
```

**Modifier snapshot in `ordering_menu_item_snapshots`:** **[ADDED]**
```typescript
interface MenuItemModifierSnapshot {
  groupId: string;
  groupName: string;
  minSelections: number;
  maxSelections: number;
  options: Array<{
    optionId: string;
    name: string;          // ← 'name', not 'optionName'
    price: number;
    isDefault: boolean;    // ← included in snapshot
    isAvailable: boolean;
  }>;
}
```
- Stored as JSONB in `ordering_menu_item_snapshots.modifiers`
- Consumed by `CartService.addItem()` to validate and resolve option selections at add-item time
- Consumed by `PlaceOrderHandler` to re-validate modifier constraints at checkout (step 5b)

**Coupling Audit:**
- [x] `order.module.ts` does NOT import `RestaurantModule`, `MenuModule`, or `ZonesModule`
- [x] `cart.module.ts` does NOT import `RestaurantModule`, `MenuModule`, or `ZonesModule`
- [x] Only shared artifacts are the event classes in `src/shared/events/`

**Deliverable:** Snapshots are populated and stay fresh when menu/restaurant/zone data changes.

---

### Phase 4 — Order Placement (Checkout → Place Order) **[IMPLEMENTED ✅]**

> All design fixes (C-1, C-2, M-1, M-2, M-3) and modifier-related fixes (Cases 9, 12, 13, 14, 15) are applied and verified.

**Goal:** A customer can check out their cart and create an Order with a fully frozen price snapshot.

**Scope:**
- `PlaceOrderHandler` — CQRS `CommandHandler` (D1-C); dispatched via `CommandBus` by `CartController.checkout()`
- `PlaceOrderCommand` — carries `customerId`, `deliveryAddress`, `paymentMethod`, `note?`, `idempotencyKey?`
- `CheckoutDto` — `deliveryAddress` (nested `DeliveryAddressDto`), `paymentMethod` (cod|vnpay), `note?` (maxLength 500)
- `CheckoutResponseDto` — `orderId`, `status`, `totalAmount`, `paymentMethod`, `paymentUrl?`

**Checkout Flow — 13 Steps:** **[UPDATED]**

```
Client                     CartController          PlaceOrderHandler (CQRS)
──────────────────────────────────────────────────────────────────────────
POST /carts/my/checkout
  body: { deliveryAddress, paymentMethod, note? }
  header: X-Idempotency-Key (optional; validated: /^[0-9a-fA-F-]{8,64}$/)
    │
    ▼ [M-2] Validate idempotency key format in controller → 400 on invalid
    │
    ▼ CommandBus.execute(new PlaceOrderCommand(...))
    │
    │  ┌─ STEP 1: D5-A — Redis idempotency check ──────────────────────┐
    │  │  key: idempotency:order:<idempotencyKey>                       │
    │  │  → HIT: return cached { orderId } immediately (fast path)     │
    │  └──────────────────────────────────────────────────────────────┘
    │
    │  ┌─ STEP 2: Cart checkout lock (SET NX EX 30s) ──────────────────┐
    │  │  key: cart:<customerId>:lock                                   │
    │  │  → NOT ACQUIRED: 409 "Checkout already in progress"           │
    │  └──────────────────────────────────────────────────────────────┘
    │
    │  ┌─ STEP 3: Load cart from Redis ──────────────────────────────┐
    │  │  → EMPTY or MISSING: 400 Bad Request                        │
    │  └─────────────────────────────────────────────────────────────┘
    │
    │  ┌─ STEP 4: Load ACL snapshots ───────────────────────────────────┐
    │  │  MenuItemSnapshotRepository.findManyByIds(cart item IDs)       │
    │  │  RestaurantSnapshotRepository.findById(cart.restaurantId)      │
    │  └───────────────────────────────────────────────────────────────┘
    │
    │  ┌─ STEP 5: Validate restaurant + items ──────────────────────────┐
    │  │  restaurant.isOpen && restaurant.isApproved                    │
    │  │  every item: status = 'available'                              │
    │  │  [C-2] every item: snapshot.restaurantId === cart.restaurantId │
    │  │  → FAILS: 422 UnprocessableEntityException                     │
    │  └───────────────────────────────────────────────────────────────┘
    │
    │  ┌─ STEP 5b: Re-validate modifier constraints at checkout ─────────┐
    │  │  [ADDED] For each cart item's selectedModifiers:                │
    │  │  - Option still exists in snapshot                             │
    │  │  - Option isAvailable = true                                   │
    │  │  - minSelections / maxSelections still satisfied               │
    │  │  → FAILS: 422 UnprocessableEntityException                     │
    │  └────────────────────────────────────────────────────────────────┘
    │
    │  ┌─ STEP 6: BR-3 Delivery zone check (best-effort) ───────────────┐
    │  │  DeliveryZoneSnapshotRepository.findActiveByRestaurantId()     │
    │  │  → SKIP if restaurant has no lat/lng OR no active zones        │
    │  │  → SKIP (best-effort): zones present but customer has no coords│
    │  │  → HAS coords + zones: GeoService.calculateDistanceKm()        │
    │  │    (Haversine formula; ±0.1 km accuracy at delivery distances) │
    │  │    find innermost zone with radiusKm >= distanceKm             │
    │  │    → OUTSIDE ALL ZONES: 422 UnprocessableEntityException       │
    │  └───────────────────────────────────────────────────────────────┘
    │
    │  ┌─ STEP 7: Snapshot prices from ACL ──────────────────────────────┐
    │  │  unitPrice = snapshot.price  (ACL — authoritative over cart)   │
    │  │  itemName  = snapshot.name   (ACL — frozen at this moment)     │
    │  │  modifiersPrice = sum of resolved option prices                │
    │  │  subtotal = (unitPrice + modifiersPrice) × quantity            │
    │  └───────────────────────────────────────────────────────────────┘
    │
    │  ┌─ STEP 8: Calculate totalAmount ────────────────────────────────┐
    │  │  totalAmount = SUM(subtotal for all items)                    │
    │  │  NOTE: no shipping fee in current implementation              │
    │  └───────────────────────────────────────────────────────────────┘
    │
    │  ┌─ STEP 9: Get expiresAt from app_settings ──────────────────────┐
    │  │  RESTAURANT_ACCEPT_TIMEOUT_SECONDS (default 600s)             │
    │  │  expiresAt = NOW() + timeoutSeconds                           │
    │  └───────────────────────────────────────────────────────────────┘
    │
    │  ┌─ STEP 10: Atomic DB transaction ───────────────────────────────┐
    │  │  INSERT orders (status='pending', cartId=cart.cartId)         │
    │  │  INSERT order_items (with modifiersPrice + modifiers JSONB)   │
    │  │  INSERT order_status_logs (fromStatus=null → 'pending')       │
    │  │  D5-B: UNIQUE(cartId) violation → 409 CONFLICT               │
    │  └───────────────────────────────────────────────────────────────┘
    │
    │  ┌─ STEP 11: [C-1] Save idempotency key — BEFORE cart cleanup ───┐
    │  │  key: idempotency:order:<idempotencyKey>                      │
    │  │  value: orderId                                               │
    │  │  TTL: ORDER_IDEMPOTENCY_TTL_SECONDS (from app_settings, 300s) │
    │  │  fallback: IDEMPOTENCY_TTL_FALLBACK_SECONDS = 300 [M-3]      │
    │  └───────────────────────────────────────────────────────────────┘
    │
    │  ┌─ STEP 12: Publish OrderPlacedEvent ──────────────────────────┐
    │  │  EventBus.publish(new OrderPlacedEvent(...))                 │
    │  └─────────────────────────────────────────────────────────────┘
    │
    │  ┌─ STEP 13: [C-1] Delete Redis cart — BEST EFFORT ──────────────┐
    │  │  .catch() wrapped — never throws; ghost cart expires via TTL  │
    │  └───────────────────────────────────────────────────────────────┘
    │
    ▼ (finally) Release cart lock — .catch() wrapped; TTL self-expires
    │
    ▼ Return CheckoutResponseDto { orderId, status, totalAmount, paymentMethod, paymentUrl? }
```

**Idempotency (D5-A + D5-B — both active):**
- **D5-A (Redis):** `X-Idempotency-Key` header → `idempotency:order:<key>` in Redis; TTL from `app_settings.ORDER_IDEMPOTENCY_TTL_SECONDS` (default 300s); fallback constant `IDEMPOTENCY_TTL_FALLBACK_SECONDS = 300`
- **D5-B (DB):** `UNIQUE(cart_id)` constraint on `orders` table — second-line guard against race conditions
- Key saved immediately after DB commit (Step 11), BEFORE cart cleanup (Step 13) — prevents key loss on cleanup failure
- Key validation regex: `/^[0-9a-fA-F-]{8,64}$/` — rejects non-hex keys with 400

**`PlaceOrderCommand` signature:**
```typescript
new PlaceOrderCommand(
  customerId: string,       // from JWT sub — never from cart payload (spoofing prevention)
  deliveryAddress: DeliveryAddress,
  paymentMethod: 'cod' | 'vnpay',
  note?: string,
  idempotencyKey?: string,  // optional; when absent only D5-B guard is active
)
```

**Payment flow after order creation:**
```
COD:   PENDING → Restaurant confirms (PENDING → CONFIRMED)

VNPay: PENDING → Payment Context generates payment URL
                  (paymentUrl stored in orders.paymentUrl)
              → PaymentConfirmedEvent → PENDING → PAID
              → Restaurant confirms → PAID → CONFIRMED
              │
              └─ PaymentFailedEvent → PENDING → CANCELLED

Timeout: expiresAt exceeded → OrderTimeoutTask (Phase 5) → CANCELLED
```

**Deliverable:** Order created with frozen prices and modifier snapshots. `OrderPlacedEvent` published.

---

### Phase 5 — Order Lifecycle (State Machine)

**Goal:** All actors can transition order states according to defined rules.

**Scope:**
- `OrderLifecycleService` — state machine logic + permission check per actor role
- `OrderLifecycleController` — REST endpoints for state transitions
- `OrderLifecycleModule`
- `OrderStatusLog` appended on every transition
- `OrderTimeoutTask` — `@Cron` job that queries PENDING/PAID orders where `expiresAt < NOW()` and transitions them to `CANCELLED` with `triggeredBy = 'system'`, then publishes `OrderStatusChangedEvent`   ← [FIXED][from MISSING]

**State Machine:**

```
                    ┌────────────────────────────────────────────┐
                    │            ORDER STATE MACHINE             │
                    └────────────────────────────────────────────┘

  [Customer places order]
         │
         ▼
      PENDING ──────────────────────────────────────────────────► CANCELLED
         │                                                         ▲ (Customer or Restaurant)
         │                                                         │
         ├── COD: Restaurant confirms ──────────────────────────► CONFIRMED
         │                                                         │
         └── VNPay: PaymentConfirmedEvent (system) ─────────────► PAID
                                                                   │
                                                                   │ Restaurant confirms
                                                                   ▼
                                                               CONFIRMED ──────────────► CANCELLED
                                                                   │                    ▲ (Restaurant only)
                                                                   │ Restaurant starts cooking
                                                                   ▼
                                                               PREPARING
                                                                   │
                                                                   │ Restaurant marks done
                                                                   ▼
                                                          READY_FOR_PICKUP
                                                                   │
                                                                   │ Shipper picks up
                                                                   ▼
                                                               PICKED_UP
                                                                   │
                                                                   │ Shipper starts delivery
                                                                   ▼
                                                              DELIVERING
                                                                   │
                                                                   │ Shipper marks delivered
                                                                   ▼
                                                             DELIVERED ──────────────────► REFUNDED
                                                                                           (Admin only)
```

**Transition Permission Table:**

| Transition                        | Triggered By            | Notes                                                    |
|-----------------------------------|-------------------------|----------------------------------------------------------|
| `PENDING → PAID`                  | System (Payment Context) | VNPay payment confirmed via `PaymentConfirmedEvent`     |
| `PENDING → CONFIRMED`             | Restaurant              | COD orders only — direct restaurant confirmation         |
| `PENDING → CANCELLED`             | Customer, Restaurant    | Before payment (VNPay) or before restaurant confirms (COD) |
| `PAID → CONFIRMED`                | Restaurant              | VNPay orders — restaurant confirms after payment         |
| `PAID → CANCELLED`                | Customer, Restaurant    | After VNPay payment but before restaurant confirms — publishes `OrderCancelledAfterPaymentEvent` to trigger refund   ← [FIXED][from WARNING] |
| `CONFIRMED → PREPARING`           | Restaurant              | Cooking started                                          |
| `CONFIRMED → CANCELLED`           | Restaurant              | Cannot fulfill                                           |
| `PREPARING → READY_FOR_PICKUP`    | Restaurant              | Ready for shipper                                        |
| `READY_FOR_PICKUP → PICKED_UP`    | Shipper                 | Shipper collected order                                  |
| `PICKED_UP → DELIVERING`          | Shipper                 | En route to customer                                     |
| `DELIVERING → DELIVERED`          | Shipper                 | Confirmed delivery                                       |
| `DELIVERED → REFUNDED`            | Admin                   | Post-delivery refund                                     |

**REST Endpoints:**
```
PATCH  /orders/:id/status    → body: { toStatus: 'CONFIRMED', note?: string }
GET    /orders/:id/timeline  → get OrderStatusLog history
```

**Events Published on Each Transition:**
- Every transition → `OrderStatusChangedEvent` → Notification Context reacts
- `READY_FOR_PICKUP` → `OrderReadyForPickupEvent` → Delivery Context reacts

> � **[FIXED][from MISSING]** Restaurant accept timeout implemented via **both** mechanisms:
> - `orders.expiresAt` set at order creation to `NOW() + RESTAURANT_ACCEPT_TIMEOUT_SECONDS` (see Phase 1 schema)
> - `OrderTimeoutTask` (`@Cron`) in `OrderLifecycleModule` periodically queries `WHERE status IN ('PENDING','PAID') AND expiresAt < NOW()` and transitions matching orders to `CANCELLED` with `triggeredBy = 'system'`, publishing `OrderStatusChangedEvent` for each

**Deliverable:** Full state machine works. History is logged. Events are published.

---

### Phase 6 — Downstream Event Handlers

**Goal:** Other contexts react correctly to Ordering events.

> ⚠️ Note: This phase defines the **events that Ordering publishes** and the **stubs** in other contexts that will receive them. The full implementation of Payment, Delivery, and Notification contexts is out of scope for this proposal.

**Scope:**
- Define event contracts in `shared/events/`:
  - `OrderPlacedEvent` — consumed by Payment, Notification
  - `OrderStatusChangedEvent` — consumed by Notification
  - `OrderReadyForPickupEvent` — consumed by Delivery, Notification
  - `PaymentConfirmedEvent` — published by Payment Context, consumed by Ordering (triggers `PENDING → PAID`)
  - `PaymentFailedEvent` — published by Payment Context, consumed by Ordering (triggers `PENDING → CANCELLED`)
- Create stub event handlers in downstream contexts (empty `@EventsHandler` classes) to confirm the event bus wiring works

**Event Contract Definitions:**

```
OrderPlacedEvent:
  orderId, customerId, restaurantId, restaurantName,
  totalAmount, paymentMethod (cod | vnpay),
  items: [{ menuItemId, name, quantity, unitPrice }],
  deliveryAddress: { ... }

OrderStatusChangedEvent:
  orderId, customerId, restaurantId,
  fromStatus, toStatus,
  triggeredByRole,
  note (optional)

OrderReadyForPickupEvent:
  orderId, restaurantId, restaurantName,
  restaurantAddress,
  customerId, deliveryAddress

PaymentConfirmedEvent:   ← INCOMING (published by Payment Context)
  orderId, customerId,
  paymentMethod,         ← 'vnpay'
  paidAmount,
  paidAt

PaymentFailedEvent:      ← INCOMING (published by Payment Context)
  orderId, customerId,
  paymentMethod,         ← 'vnpay'
  reason,
  failedAt

OrderCancelledAfterPaymentEvent:   ← OUTGOING (published by Ordering)   ← [FIXED][from WARNING]
  orderId, customerId,
  paymentMethod,         ← 'vnpay'
  paidAmount,            ← amount to refund
  cancelledAt,
  cancelledByRole        ← 'customer' | 'restaurant'
```

**Deliverable:** Events are published and received by stub handlers. Event bus wiring confirmed.

---

### Phase 7 — Order History (Read Side)

**Goal:** Customers, Restaurant owners, and Shippers can query their order history.

**Scope:**
- `OrderHistoryRepository` — specialized query methods (no writes)
- `OrderHistoryService` — query orchestration
- `OrderHistoryController` — REST endpoints with pagination
- `OrderHistoryModule`

**REST Endpoints:**
```
GET  /orders/my                       → Customer's own orders (paginated)
GET  /orders/restaurant/:restaurantId → Restaurant's received orders
GET  /orders/assigned                 → Shipper's assigned/completed orders
GET  /orders/:id                      → Single order detail (with items + timeline)
```

**Query Filters:**
- `status` (filter by state)
- `from` / `to` (date range)
- `page` / `limit` (pagination)

**Deliverable:** All actor roles can query order history. Reorder flow can be built on top.

---

## 6. Module Architecture

### 6.1 Ordering Context — Internal Structure **[UPDATED]**

```
src/module/ordering/
├── ordering.module.ts                    ← context root; imports all sub-modules
│
├── common/
│   ├── ordering.constants.ts             ← Redis key prefixes + TTL constants
│   ├── app-settings.schema.ts            ← app_settings Drizzle table + APP_SETTING_KEYS
│   └── app-settings.service.ts           ← AppSettingsService (reads app_settings rows)
│
├── cart/
│   ├── cart.module.ts
│   ├── cart.controller.ts                ← includes checkout endpoint
│   ├── cart.service.ts                   ← Service pattern (D1-C)
│   ├── cart.redis-repository.ts          ← Redis ops only (D2-B)
│   ├── cart.types.ts                     ← Cart, CartItem, SelectedModifier types
│   └── dto/
│       └── cart.dto.ts
│
├── order/
│   ├── order.module.ts
│   ├── order.schema.ts                   ← orders, order_items, order_status_logs tables
│   ├── commands/
│   │   ├── place-order.command.ts        ← D1-C: CQRS command
│   │   └── place-order.handler.ts        ← 13-step checkout flow
│   └── dto/
│       └── checkout.dto.ts               ← CheckoutDto, CheckoutResponseDto
│
├── order-lifecycle/
│   └── order-lifecycle.module.ts         ← Phase 5 placeholder (controller/service/dto not yet created)
│
├── order-history/
│   └── order-history.module.ts           ← Phase 7 placeholder (controller/service/repo/dto not yet created)
│
└── acl/
    ├── acl.module.ts
    ├── acl.controller.ts                 ← diagnostic read endpoints (no auth)
    ├── acl.service.ts
    ├── projections/
    │   ├── menu-item.projector.ts         ← @EventsHandler(MenuItemUpdatedEvent)
    │   ├── restaurant-snapshot.projector.ts ← @EventsHandler(RestaurantUpdatedEvent)
    │   └── delivery-zone-snapshot.projector.ts ← @EventsHandler(DeliveryZoneSnapshotUpdatedEvent) [ADDED]
    ├── repositories/
    │   ├── menu-item-snapshot.repository.ts
    │   ├── restaurant-snapshot.repository.ts
    │   └── delivery-zone-snapshot.repository.ts  [ADDED]
    └── schemas/
        ├── menu-item-snapshot.schema.ts
        ├── restaurant-snapshot.schema.ts
        └── delivery-zone-snapshot.schema.ts      [ADDED]
```

### 6.2 Shared Events Location **[UPDATED]**

```
src/shared/
└── events/
    ├── index.ts                                      ← barrel re-export for all event classes
    ├── menu-item-updated.event.ts                    ← upstream: published by MenuService + ModifiersService
    ├── restaurant-updated.event.ts                   ← upstream: published by RestaurantService
    ├── delivery-zone-snapshot-updated.event.ts       ← upstream: published by ZonesService
    ├── payment-confirmed.event.ts                    ← incoming: published by Payment Context
    ├── payment-failed.event.ts                       ← incoming: published by Payment Context
    ├── order-placed.event.ts                         ← outgoing: published by PlaceOrderHandler
    ├── order-status-changed.event.ts                 ← outgoing: published by OrderLifecycleService
    ├── order-ready-for-pickup.event.ts               ← outgoing: published by OrderLifecycleService
    └── order-cancelled-after-payment.event.ts        ← outgoing: published by OrderLifecycleService
```

### 6.3 Dependency Graph **[UPDATED]**

```
app.module.ts
    │
    ├── RestaurantCatalogModule
    │       ├── RestaurantModule   ──publishes──► RestaurantUpdatedEvent
    │       │       └── ZonesModule ──publishes──► DeliveryZoneSnapshotUpdatedEvent
    │       └── MenuModule         ──publishes──► MenuItemUpdatedEvent
    │
    ├── GeoModule (global)         ← Haversine utilities; injected by ZonesService + PlaceOrderHandler
    │
    └── OrderingModule
            ├── AclModule          ──handles──► MenuItemUpdatedEvent, RestaurantUpdatedEvent,
            │                                   DeliveryZoneSnapshotUpdatedEvent
            ├── CartModule         ──reads──► MenuItemSnapshotRepository (ACL)
            ├── OrderModule        ──reads──► MenuItemSnapshotRepository, RestaurantSnapshotRepository,
            │                                 DeliveryZoneSnapshotRepository
            │                      ──publishes──► OrderPlacedEvent
            ├── OrderLifecycleModule
            │                      ──publishes──► OrderStatusChangedEvent
            │                      ──publishes──► OrderReadyForPickupEvent
            │                      ──publishes──► OrderCancelledAfterPaymentEvent
            │                      ──handles──► PaymentConfirmedEvent, PaymentFailedEvent
            └── OrderHistoryModule ← read-only queries

```

---

## 7. Integration Patterns

### 7.1 Upstream: Restaurant & Catalog → Ordering **[UPDATED]**

```
┌─────────────────────────────────────────────────────────────────────┐
│  UPSTREAM INTEGRATION (Restaurant Catalog → Ordering)               │
│                                                                     │
│  Trigger: Any change in MenuItem, Restaurant, or DeliveryZone state │
│                                                                     │
│  Restaurant Catalog BC          EventBus         Ordering BC        │
│  ─────────────────────       ───────────────  ──────────────────── │
│                                                                     │
│  MenuItem changes:           MenuItemUpdated    MenuItemProjector  │
│  - create, update,    ────►      Event      ────►  .handle()       │
│  - toggleSoldOut                                  upserts snapshot  │
│  - delete (unavail.)          (modifiers=null     (modifiers skipped│
│                                → skip modifiers)   if null)         │
│                                                                     │
│  Restaurant changes:         RestaurantUpdated  RestaurantSnapshot │
│  - create, update,    ────►     Event      ────►  Projector        │
│  - approve, open/close                            .handle()         │
│                                                   upserts snapshot  │
│                                                                     │
│  DeliveryZone changes:   DeliveryZoneSnapshot  DeliveryZoneSnapshot│
│  - create, update,    ────►  UpdatedEvent  ────►  Projector        │
│  - delete                   (isDeleted=true)      .handle()         │
│                               on hard-delete      upsert or         │
│                                                   tombstone         │
└─────────────────────────────────────────────────────────────────────┘
```

**Pattern:** In-process `EventBus` (NestJS CQRS)
**Consistency:** Eventual — milliseconds in same process
**Coupling:** Only via event class in `src/shared/events/`

### 7.2 Downstream: Ordering → Other Contexts

```
┌─────────────────────────────────────────────────────────────────────┐
│  DOWNSTREAM INTEGRATION (Ordering → Other Contexts)                 │
│                                                                     │
│  Event: OrderPlacedEvent                                           │
│  ─────────────────────────────────────────────────────────────────│
│  Ordering ──► Payment Context:    Record COD entry                 │
│               Notification:       Notify customer "Order received"  │
│               Notification:       Notify restaurant "New order"     │
│                                                                     │
│  Event: OrderStatusChangedEvent                                    │
│  ─────────────────────────────────────────────────────────────────│
│  Ordering ──► Notification:       Push to affected actor           │
│                                                                     │
│  Event: OrderReadyForPickupEvent                                   │
│  ─────────────────────────────────────────────────────────────────│
│  Ordering ──► Delivery:           Trigger shipper dispatch         │
│               Notification:       Notify shipper                   │
│                                                                     │
│  Event: PaymentConfirmedEvent (INCOMING)                           │
│  ─────────────────────────────────────────────────────────────────│
│  Payment  ──► Ordering:           Advance PENDING → PAID           │
│                                   (VNPay flow only)                │
│                                   Restaurant then confirms:        │
│                                   PAID → CONFIRMED                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. State Machine Specification

### 8.1 Full State Diagram

```
                              ┌──────────┐
                              │ PENDING  │◄──── Order created (checkout)
                              └────┬─────┘
                                   │
         Customer/Restaurant cancels│
                    ▼              │
               CANCELLED           │
                               ────┤
                                   │
                 ┌─────────────────┴──────────────────┐
                 │                                    │
          COD: Restaurant                     VNPay: PaymentConfirmedEvent
              confirms                              (system)
                 │                                    │
                 ▼                                    ▼
            CONFIRMED ◄──────────────────────── PAID ─── Customer/Restaurant cancels ──► CANCELLED
                 │                               │
                 │ ◄── Restaurant confirms ───────┘
                 │
   Restaurant cancels ──► CANCELLED
                 │
                 │ Restaurant starts cooking
                 ▼
            PREPARING
                 │
                 │ Restaurant marks ready
                 ▼
        READY_FOR_PICKUP
                 │
                 │ Shipper picks up
                 ▼
            PICKED_UP
                 │
                 │ Shipper starts delivery
                 ▼
           DELIVERING
                 │
                 │ Shipper confirms delivery
                 ▼
           DELIVERED ─── Admin refund ──► REFUNDED
```

### 8.2 Actor-State Permission Matrix

| State                | Customer Can       | Restaurant Can                   | Shipper Can    | Admin Can           |
|----------------------|--------------------|----------------------------------|----------------|---------------------|
| PENDING              | Cancel             | Confirm (COD only), Cancel       | —              | Any                 |
| PAID                 | Cancel             | Confirm, Cancel                  | —              | Any                 |
| CONFIRMED            | View only          | Start Preparing, Cancel          | —              | Any                 |
| PREPARING            | View only          | Mark Ready for Pickup            | —              | Any                 |
| READY_FOR_PICKUP     | View only          | —                                | Pick up        | Any                 |
| PICKED_UP            | View only          | —                                | Start Delivery | Any                 |
| DELIVERING           | View only          | —                                | Mark Delivered | Any                 |
| DELIVERED            | View only          | —                                | —              | Refund              |
| CANCELLED            | View only          | —                                | —              | —                   |
| REFUNDED             | View only          | —                                | —              | —                   |

### 8.3 VNPay Payment Flow Impact on State Machine

```
For paymentMethod = 'vnpay':

  Customer places order (POST /carts/my/checkout)   [SYNCED with D2]
         │
         ▼
      PENDING ── Payment Context generates VNPay payment URL
         │       Response: { orderId, vnpayPaymentUrl } returned to client
         │
         │  [Customer is redirected to VNPay gateway and completes payment]
         │
         ▼  PaymentConfirmedEvent received (system-triggered, from Payment Context)
       PAID  ── Append OrderStatusLog(PENDING → PAID)
         │       Publish OrderStatusChangedEvent(PENDING → PAID)
         │       Notification: "Payment successful, awaiting restaurant confirmation"
         │
         │  [Restaurant reviews and confirms order]
         │
         ▼  Restaurant calls PATCH /orders/:id/status { toStatus: 'CONFIRMED' }
    CONFIRMED ── Ordering proceeds normally (PREPARING → ... → DELIVERED)

For paymentMethod = 'cod':

  Customer places order (POST /carts/my/checkout)   [SYNCED with D2]
         │
         ▼
      PENDING ── No payment step required
         │       Notification: "New order received" sent to restaurant
         │
         │  [Restaurant reviews and confirms order]
         │
         ▼  Restaurant calls PATCH /orders/:id/status { toStatus: 'CONFIRMED' }
    CONFIRMED ── Ordering proceeds normally (PREPARING → ... → DELIVERED)

VNPay Payment Failure / Timeout:

      PENDING ── PaymentFailedEvent or TTL expiry
         │
         ▼
    CANCELLED ── Append OrderStatusLog(PENDING → CANCELLED)
                  Publish OrderStatusChangedEvent
                  Notification: "Payment failed, order cancelled"
```

> **Key invariant:** The `PAID` state is **exclusive to VNPay orders**. The `OrderLifecycleService` must enforce that `PENDING → CONFIRMED` is only allowed for `paymentMethod = 'cod'`, and `PENDING → PAID` is only triggered by the `PaymentConfirmedEvent` handler (system role), never by a direct API call from a user.

---

---

## 9. Pricing Model **[ADDED]**

### 9.1 Current Implementation

The current pricing model covers **item costs only**. Shipping fees are architecturally designed for (via delivery zone `baseFee` + `perKmRate`) but **not yet applied to `orders.totalAmount`**.

**Per-line item calculation:**
```
modifiersPrice = sum of all selected option prices for that line
subtotal       = (unitPrice + modifiersPrice) × quantity
```

**Order total:**
```
totalAmount = SUM(subtotal) for all order_items
```

> **No shipping fee in `totalAmount`.** The `deliveryZones` table has `baseFee` and `perKmRate` columns, and `ZonesService.estimateDelivery()` computes delivery fee + ETA for display purposes. However, **checkout does not add any delivery fee to `totalAmount`**. This is an intentional phase decision — shipping fee collection will be added in a future phase.

**Price authority at checkout:**
- `unitPrice` is sourced from `ordering_menu_item_snapshots.price` (ACL snapshot), NOT from the cart's add-time price
- Cart add-time prices are informational only — overwritten by the authoritative snapshot price at checkout
- This prevents stale pricing if the restaurant updates menu prices between add-to-cart and checkout

### 9.2 Delivery Estimate (Available via API, Not in Checkout)

`ZonesService.estimateDelivery()` computes:
```
distanceKm     = GeoService.calculateDistanceKm(restaurant, customer)
eligibleZone   = innermost zone where zone.radiusKm >= distanceKm
deliveryFee    = zone.baseFee + (zone.perKmRate × distanceKm)
etaMinutes     = (distanceKm / zone.avgSpeedKmh) × 60
               + zone.prepTimeMinutes + zone.bufferMinutes
```

Endpoint: `GET /restaurants/:restaurantId/delivery-zones/estimate?latitude=...&longitude=...`

### 9.3 Future: Shipping Fee in Checkout

When shipping fee is added to checkout, the `PlaceOrderCommand` will need to carry the selected zone or customer coordinates, and `PlaceOrderHandler` will compute the delivery fee from `DeliveryZoneSnapshotRepository` data. `totalAmount` will then be:
```
totalAmount = SUM(item subtotals) + deliveryFee
```
A new `deliveryFee` column will be needed on `orders` for receipt display.

---

## 10. Delivery Zone Architecture **[ADDED]**

### 10.1 Source of Truth (Restaurant Catalog BC)

```
restaurants table           delivery_zones table
──────────────────          ────────────────────────────────────────
id (PK)                     id (PK)
latitude  ← geo coords      restaurantId (FK → restaurants.id CASCADE)
longitude                   name
...                         radiusKm        ← coverage radius
                            baseFee         ← NUMERIC(10,2)
                            perKmRate       ← NUMERIC(10,2)
                            avgSpeedKmh     ← for ETA estimate
                            prepTimeMinutes ← for ETA estimate
                            bufferMinutes   ← for ETA estimate
                            isActive
                            createdAt / updatedAt
```

`deliveryRadiusKm` was **[REMOVED]** from `restaurants` table — replaced by per-zone `radiusKm` on `delivery_zones`.

### 10.2 Local Snapshot (Ordering BC)

`ordering_delivery_zone_snapshots` mirrors the upstream `delivery_zones` table with these additions:
- `isDeleted` boolean — tombstone flag for hard-deleted zones (row preserved for event-replay safety)
- `lastSyncedAt` — tracks freshness
- Index on `restaurantId` for fast BR-3 checkout query

### 10.3 BR-3 Delivery Zone Check at Checkout

```
PlaceOrderHandler (Step 6):

if restaurant.latitude is null OR restaurant.longitude is null:
    → SKIP (best-effort — restaurant has no geo configured)

zones = DeliveryZoneSnapshotRepository.findActiveByRestaurantId(restaurantId)
    → returns zones WHERE isActive=true AND isDeleted=false, ordered by radiusKm ASC

if zones.length === 0:
    → SKIP (best-effort — no active zones configured)

if deliveryAddress.latitude is null OR deliveryAddress.longitude is null:
    → SKIP (best-effort — customer provided no coords)

distanceKm = GeoService.calculateDistanceKm(restaurant, deliveryAddress)
eligibleZone = find innermost zone where zone.radiusKm >= distanceKm

if eligibleZone is null:
    → 422 "Your location is X km from the restaurant,
            which is outside all delivery zones."
```

**Best-effort semantics:** The check is skipped rather than failing when coordinates or zones are absent. This allows orders to proceed even when geo data is not fully configured, prioritising availability over strict enforcement in early deployments.

### 10.4 Event Flow for Zone Changes

```
ZonesService.create(dto) → repo.create() → eventBus.publish(DeliveryZoneSnapshotUpdatedEvent { isDeleted: false })
ZonesService.update(dto) → repo.update() → eventBus.publish(DeliveryZoneSnapshotUpdatedEvent { isDeleted: false })
ZonesService.remove()    → repo.remove() → eventBus.publish(DeliveryZoneSnapshotUpdatedEvent { isDeleted: true })
                                                                      ↓
                                               DeliveryZoneSnapshotProjector.handle()
                                                 isDeleted=false → upsert(...)
                                                 isDeleted=true  → markDeleted(zoneId)
```

---

## 11. Event Catalog **[ADDED]**

### 11.1 Incoming Events (Upstream → Ordering)

**`MenuItemUpdatedEvent`** — from `MenuService` + `ModifiersService`
```typescript
interface ModifierOptionSnapshot {
  optionId: string;
  name: string;           // ← 'name', not 'optionName'
  price: number;
  isDefault: boolean;
  isAvailable: boolean;
}

interface MenuItemModifierSnapshot {
  groupId: string;
  groupName: string;
  minSelections: number;
  maxSelections: number;
  options: ModifierOptionSnapshot[];
}

{
  menuItemId: string;
  restaurantId: string;
  name: string;
  price: number;
  status: 'available' | 'unavailable' | 'out_of_stock';
  modifiers: MenuItemModifierSnapshot[] | null;  // null = don't update modifiers column
}
```

**`RestaurantUpdatedEvent`** — from `RestaurantService`
```typescript
{
  restaurantId: string;
  name: string;
  isOpen: boolean;
  isApproved: boolean;
  address: string;
  latitude?: number;
  longitude?: number;
  cuisineType?: string;
}
```

**`DeliveryZoneSnapshotUpdatedEvent`** — from `ZonesService`
```typescript
{
  zoneId: string;
  restaurantId: string;
  name: string;
  radiusKm: number;
  baseFee: number;
  perKmRate: number;
  avgSpeedKmh: number;
  prepTimeMinutes: number;
  bufferMinutes: number;
  isActive: boolean;
  isDeleted: boolean;  // true = tombstone the snapshot row
}
```

**`PaymentConfirmedEvent`** — from Payment Context → triggers PENDING → PAID
```typescript
{
  orderId: string;
  customerId: string;
  paymentMethod: 'vnpay';
  paidAmount: number;
  paidAt: Date;
}
```

**`PaymentFailedEvent`** — from Payment Context → triggers PENDING → CANCELLED
```typescript
{
  orderId: string;
  customerId: string;
  paymentMethod: 'vnpay';
  reason: string;
  failedAt: Date;
}
```

### 11.2 Outgoing Events (Ordering → Downstream)

**`OrderPlacedEvent`** — consumed by Payment, Notification
```typescript
{
  orderId: string;
  customerId: string;
  restaurantId: string;
  restaurantName: string;
  totalAmount: number;
  paymentMethod: 'cod' | 'vnpay';
  items: Array<{ menuItemId: string; name: string; quantity: number; unitPrice: number }>;
  deliveryAddress: DeliveryAddress;
}
```

**`OrderStatusChangedEvent`** — consumed by Notification
```typescript
{
  orderId: string;
  customerId: string;
  restaurantId: string;
  fromStatus: string;   // e.g. 'pending', 'paid' — lowercase, matches order_status enum
  toStatus: string;     // e.g. 'confirmed', 'preparing'
  triggeredByRole: 'customer' | 'restaurant' | 'shipper' | 'admin' | 'system';
  note?: string;
}
```

**`OrderReadyForPickupEvent`** — consumed by Delivery, Notification
```typescript
{
  orderId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantAddress: string;  // from restaurant snapshot
  customerId: string;
  deliveryAddress: DeliveryAddress;
}
```

**`OrderCancelledAfterPaymentEvent`** — consumed by Payment (trigger refund)
```typescript
{
  orderId: string;
  customerId: string;
  paymentMethod: 'vnpay';
  paidAmount: number;
  cancelledAt: Date;
  cancelledByRole: 'customer' | 'restaurant';
}
```

---

## 12. Phase Roadmap

### 12.1 Phases at a Glance **[UPDATED]**

```
PHASE 0 ✅     PHASE 1 ✅     PHASE 2 ✅     PHASE 3 ✅
─────────      ─────────      ─────────      ─────────
Infra          Domain         Cart           ACL Layer
Setup          Schema         Module         (Projections)

COMPLETE       COMPLETE       COMPLETE       COMPLETE
   │               │               │               │
   ▼               ▼               ▼               ▼
App boots    Tables in DB    Cart CRUD        Snapshots
+ Redis      NUMERIC money   cartItemId       3 projectors
+ GeoModule  + zones table   fingerprint      zones snapshot
+ events     + modifiers     modifiers        tombstone


PHASE 4      PHASE 5 🔲     PHASE 6 🔲     PHASE 7 🔲
─────────      ─────────      ─────────      ─────────
Order          Lifecycle      Downstream     Order
Placement      State          Events         History
               Machine        Stubs          Queries

PARTIAL       PENDING        PENDING        PENDING
   │               │               │               │
   ▼               ▼               ▼               ▼
13-step        Transitions    Events          Paginated
checkout       per actor      reach other     history for
13 fixes       role D6-A      context stubs   all actors
all applied
```

### 12.2 Dependencies Between Phases

```
Phase 0 ──►  Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 (ALL COMPLETE ✅)

Phase 4 ──►  Phase 5 ──► Phase 6
Phase 4 ──►  Phase 7
```

### 12.3 Minimum Viable Ordering (MVO)

```
Phase 0 + Phase 1 + Phase 2 + Phase 4 (partial: create order, no events)
```

This gives: Cart → Checkout → Order created → State = PENDING. ✅ **Already achieved.**

---

## 13. Pre-Implementation Checklist **[UPDATED]**

Phases 0–4 are complete. These checklist items are preserved for reference and future phase planning.

### 13.1 Option Selections (All Confirmed)

- [x] **D1** — ✅ C (Hybrid CQRS): Cart = Service pattern; Order placement = `PlaceOrderHandler` (CQRS `CommandHandler` + `EventBus`)
- [x] **D2** — ✅ B (Redis-only cart): Cart stored in Redis; no `carts`/`cart_items` DB tables
- [x] **D3** — ✅ B (Projections): Validation via `MenuItemProjector`, `RestaurantSnapshotProjector`, `DeliveryZoneSnapshotProjector`; no direct service calls
- [x] **D4** — ✅ B (DB table): Snapshots in `ordering_menu_item_snapshots`, `ordering_restaurant_snapshots`, `ordering_delivery_zone_snapshots` tables
- [x] **D5** — ✅ A + B (both): `X-Idempotency-Key` header (Redis, TTL from `app_settings`) + `UNIQUE(cartId)` on `orders` table
- [x] **D6** — ✅ A (Transition table): Hand-crafted `ALLOWED_TRANSITIONS` map in `OrderLifecycleService`

### 13.2 Restaurant Catalog Blockers Status **[UPDATED]**

| Item | Status |
|------|--------|
| `RestaurantService` must publish `RestaurantUpdatedEvent` | ✅ DONE |
| `MenuService` must publish `MenuItemUpdatedEvent` | ✅ DONE |
| `ZonesService` must publish `DeliveryZoneSnapshotUpdatedEvent` | ✅ DONE |
| ~~Add `deliveryRadiusKm` column to `restaurants` table~~ | **[REMOVED]** — superseded by `delivery_zones` table |
| Add `PATCH /restaurants/:id/approve` endpoint | ✅ DONE |
| Fix return types: `create()` / `update()` return `NewRestaurant` | ✅ DONE |

### 13.3 Infrastructure Verification **[UPDATED]**

- [x] PostgreSQL running and `DB_CONNECTION` configured
- [x] Redis instance available — `redis:7-alpine` in `docker-compose.yml`
- [x] `@nestjs/cqrs ^11.0.3` installed
- [x] `CqrsModule` registered in all publishing/handling modules
- [x] `@nestjs/event-emitter` NOT used — all events use CQRS `EventBus`
- [x] `GeoModule` registered globally — `GeoService` available everywhere

---

## Appendix: Naming Conventions Reference

| Layer      | Convention                                  | Example                              |
|------------|---------------------------------------------|--------------------------------------|
| Schema     | `{entity}.schema.ts`                        | `order.schema.ts`                    |
| Repository | `{entity}.repository.ts`                    | `menu-item-snapshot.repository.ts`   |
| Service    | `{entity}.service.ts`                       | `cart.service.ts`                    |
| Controller | `{entity}.controller.ts`                    | `cart.controller.ts`                 |
| Module     | `{entity}.module.ts`                        | `ordering.module.ts`                 |
| DTOs       | `dto/{entity}.dto.ts`                       | `dto/cart.dto.ts`                    |
| Command    | `commands/{action}-{entity}.command.ts`     | `commands/place-order.command.ts`    |
| Handler    | `commands/{action}-{entity}.handler.ts`     | `commands/place-order.handler.ts`    |
| Projector  | `projections/{entity}.projector.ts`         | `projections/menu-item.projector.ts` |
| Events     | `shared/events/{entity}-{verb}.event.ts`    | `shared/events/order-placed.event.ts`|
