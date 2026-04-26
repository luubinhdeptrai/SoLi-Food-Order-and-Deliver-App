# Ordering Context — Architectural Proposal

> **Document Type:** Design Proposal (No Code)
> **Author Role:** Senior Software Architect
> **Status:** Decisions Finalized — Ready for Implementation
> **Target Project:** `SoLi-Food-Order-and-Deliver-App` / `apps/api`

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
9. [Phase Roadmap](#9-phase-roadmap)
10. [Pre-Implementation Checklist](#10-pre-implementation-checklist)

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

### 3.1 Entities & Value Objects

```
┌────────────────────────────────────────────────────────────────────────┐
│ ORDERING CONTEXT — Domain Model                                        │
│                                                                        │
│  ┌─────────────┐  1        N  ┌──────────────┐                        │
│  │    Cart     │ ──────────── │   CartItem   │  ← Redis-only (D2-B)  │
│  │─────────────│              │──────────────│  No DB tables.        │
│  │ id (uuid)   │              │ menuItemId   │  Stored as JSON at    │
│  │ customerId  │              │ quantity     │  cart:<customerId>    │
│  │ restaurantId│              │ unitPrice    │  ← snapshotted at add  │
│  │ items[]     │              │ itemName     │  ← snapshotted at add  │
│  └─────────────┘              └──────────────┘                        │
│                                                                        │
│  ┌─────────────────┐  1    N  ┌──────────────┐                        │
│  │     Order       │ ──────── │  OrderItem   │                        │
│  │─────────────────│          │──────────────│                        │
│  │ id (PK)         │          │ id (PK)      │                        │
│  │ customerId      │          │ orderId (FK) │                        │
│  │ restaurantId    │          │ menuItemId   │                        │
│  │ restaurantName  │◄─────    │ itemName     │  ← price snapshot      │
│  │ status (enum)   │ snapshot │ unitPrice    │  ← immutable           │
│  │ totalAmount     │          │ quantity     │                        │
│  │ paymentMethod   │          │ subtotal     │                        │
│  │ deliveryAddress │          └──────────────┘                        │
│  │ note            │                                                   │
│  │ createdAt       │  1    N  ┌──────────────────┐                    │
│  │ updatedAt       │ ──────── │  OrderStatusLog  │                    │
│  └─────────────────┘          │──────────────────│                    │
│                                │ id (PK)          │                    │
│  ┌──────────────────┐          │ orderId (FK)     │                    │
│  │  DeliveryAddress │          │ fromStatus       │                    │
│  │──────────────────│          │ toStatus         │                    │
│  │ street           │          │ triggeredBy      │  ← userId          │
│  │ district         │          │ triggeredByRole  │                    │
│  │ city             │          │ note             │                    │
│  │ latitude         │          │ createdAt        │                    │
│  │ longitude        │          └──────────────────┘                    │
│  └──────────────────┘                                                  │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Local Read Models (Projections — ACL Layer)

These are **owned by the Ordering context**, kept in sync via domain events from upstream:

```
┌─────────────────────────────────────────────────────────┐
│ ordering.menu_item_snapshots  (Projection Table — PostgreSQL, D4-B)    │   [SYNCED with D4]
│─────────────────────────────────────────────────────────│
│ menuItemId     ← from Restaurant Catalog                │
│ restaurantId                                            │
│ name                                                    │
│ price                                                   │
│ status         ← available | unavailable | out_of_stock │
│ lastSyncedAt                                            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ ordering.restaurant_snapshots  (Projection Table — PostgreSQL, D4-B)   │   [SYNCED with D4]
│─────────────────────────────────────────────────────────│
│ restaurantId   ← from Restaurant Catalog                │
│ name                                                    │
│ isOpen                                                  │
│ isApproved                                              │
│ address        ← [FIXED][from MISSING]                  │
│ deliveryRadiusKm  (if available)                        │
│ lastSyncedAt                                            │
└─────────────────────────────────────────────────────────┘
```

> ⚠️ **[WARNING]** `deliveryRadiusKm` does **not exist** in the current `restaurants` table (`restaurant.schema.ts` confirmed: no such column). BR-3 delivery-radius enforcement at checkout (Phase 4) is **unimplementable as specified** until `deliveryRadiusKm` is added to the `restaurants` schema and a migration is run. Add this column to the catalog schema **before** Phase 4 begins.

> 🔵 **[MISSING]** The `ordering_restaurant_snapshots` table is missing an `address` field. `OrderReadyForPickupEvent` (Phase 6) requires `restaurantAddress` but the snapshot has no address column. Add `address: text` to this projection table (sourced from `restaurants.address`).

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
- Requires Redis infrastructure (already in docker-compose? confirm) (chưa có Redis trong docker-compose)
- Additional complexity: sync between Redis and DB
- Not yet used in the current codebase — new pattern to establish

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
const ALLOWED_TRANSITIONS = {
  PENDING:           ['PAID', 'CONFIRMED', 'CANCELLED'],
  // PAID: reachable only for VNPay orders via PaymentConfirmedEvent (system-triggered)
  // CONFIRMED: reachable directly for COD orders via restaurant confirmation
  PAID:              ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:         ['PREPARING', 'CANCELLED'],
  PREPARING:         ['READY_FOR_PICKUP'],
  READY_FOR_PICKUP:  ['PICKED_UP'],
  PICKED_UP:         ['DELIVERING'],
  DELIVERING:        ['DELIVERED'],
  DELIVERED:         ['REFUNDED'],
  CANCELLED:         [],
  REFUNDED:          [],
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

### Phase 0 — Infrastructure Setup

**Goal:** Prepare the Ordering context skeleton without any domain logic.

**Scope:**
- Install `@nestjs/cqrs` — required (D1-C selected)   [SYNCED with D1]
- Create context folder structure `src/module/ordering/`
- Create `ordering.module.ts` (empty context module)
- Register `OrderingModule` in `app.module.ts`
- Create `src/shared/events/` directory (or `src/module/ordering/events/`)
- Create placeholder module files: `cart.module.ts`, `order.module.ts`, `order-lifecycle.module.ts`, `order-history.module.ts`
- Document Redis key schema for idempotency (used in Phase 4):   ← [FIXED][from RISK]
  - Key pattern: `idempotency:order:<X-Idempotency-Key>` → stores `orderId`
  - TTL value: read from `app_settings` table (`ORDER_IDEMPOTENCY_TTL_SECONDS`) — see Phase 1
  - Set with `SET ... EX <ttl> NX`

> ⚠️ **[WARNING — Confirmed Decision]** `@nestjs/cqrs` is **not** present in `apps/api/package.json`. Phase 0 **must** install it before any event or command handler is written. `@nestjs/event-emitter` is **not required** — all events (catalog-level and ordering-level) will use the single CQRS `EventBus`.
>
> **Implication for Phase 3:** Because only `EventBus` is used, both publishers and subscribers must use `@nestjs/cqrs` conventions:
> - Publishers (e.g., `MenuService`, `RestaurantService`): inject `EventBus` and call `this.eventBus.publish(new MenuItemUpdatedEvent(...))`
> - Subscribers (e.g., `MenuItemProjector`, `RestaurantSnapshotProjector`): decorate with `@EventsHandler(MenuItemUpdatedEvent)` and implement `IEventHandler<MenuItemUpdatedEvent>`
>
> This is the correct, simpler approach — one bus, one contract. Ensure `CqrsModule` is imported in every module that publishes or handles events.

**Folder Structure:**
```
src/module/ordering/
├── ordering.module.ts              ← context entry point
├── cart/
│   ├── cart.module.ts
├── order/
│   ├── order.module.ts
├── order-lifecycle/
│   ├── order-lifecycle.module.ts
├── order-history/
│   ├── order-history.module.ts
└── acl/                            ← required (D3-B selected)   [SYNCED with D3]
    └── (projectors / facades)
```

**Deliverable:** App boots with `OrderingModule` registered and no errors.

---

### Phase 1 — Domain Schema (Drizzle Tables)

**Goal:** Define all database tables for the Ordering context.

**Scope:**
- ~~`carts` table~~ — **not needed (D2-B): cart is Redis-only**
- ~~`cart_items` table~~ — **not needed (D2-B): items are embedded in the Redis cart JSON**
- `orders` table
- `order_items` table (immutable price snapshot)
- `order_status_logs` table
- `ordering_menu_item_snapshots` table — required (D4-B selected)   [SYNCED with D4]
- `ordering_restaurant_snapshots` table — required (D3-B + D4-B selected)   [SYNCED with D3][SYNCED with D4]
- `app_settings` table — stores runtime-configurable platform parameters (see Table Overview)
- Export all types
- Register schemas in `drizzle/schema.ts`
- Run migration (`db:push`)

**Table Overview:**

> **Redis Cart Structure (D2-B — no DB tables for cart):**
> ```
> Key:   cart:<customerId>          (one active cart per customer)
> Value: JSON {
>   cartId: uuid,                  ← generated at first item add; used for orders.cartId (D5-B)
>   customerId: string,
>   restaurantId: string,
>   restaurantName: string,        ← snapshotted at first item add
>   items: [
>     { menuItemId, itemName, unitPrice, quantity }  ← price/name snapshotted at add
>   ],
>   createdAt: ISO string
> }
> TTL:   CART_ABANDONED_TTL_SECONDS (e.g. 86400 = 24h)  ← add to app_settings
> ```

| Table                           | Key Fields                                                      |
|---------------------------------|-----------------------------------------------------------------|
| `orders`                        | id, customerId, restaurantId, restaurantName*, **cartId**(UNIQUE for D5-B — sourced from Redis cart.cartId), status(pending/paid/confirmed/preparing/ready_for_pickup/picked_up/delivering/delivered/cancelled/refunded), totalAmount, paymentMethod, deliveryAddress(JSON), note, **paymentUrl** ← [FIXED][from MISSING], **expiresAt** ← [FIXED][from MISSING] |
| `order_items`                   | id, orderId(FK), menuItemId, itemName*, unitPrice*, quantity, subtotal |
| `order_status_logs`             | id, orderId(FK), fromStatus, toStatus, triggeredBy, triggeredByRole, **note**, createdAt |
| `ordering_menu_item_snapshots`  | menuItemId(PK), restaurantId, name, price, status, lastSyncedAt |
| `ordering_restaurant_snapshots` | restaurantId(PK), name, isOpen, isApproved, **address** ← [FIXED][from MISSING], lastSyncedAt |
| `app_settings`                  | key(PK, text), value(text), description(text), updatedAt |

> `*` = snapshotted value (not a FK, stored as plain data)

**`app_settings` seed rows (inserted in migration):**

| key | default value | description |
|-----|---------------|-------------|
| `ORDER_IDEMPOTENCY_TTL_SECONDS` | `300` | How long an idempotency key is retained in Redis before expiry |
| `RESTAURANT_ACCEPT_TIMEOUT_SECONDS` | `600` | How long before an unconfirmed PENDING/PAID order is auto-cancelled by the cron job |
| `CART_ABANDONED_TTL_SECONDS` | `86400` | Redis TTL for inactive carts (24h); cart is auto-evicted by Redis after this duration |

> Runtime changes: update the row value directly in the DB. The `OrderTimeoutTask` (Phase 5) and checkout handler (Phase 4) read these values at startup via `AppSettingsService`. No redeployment required.

> 🔴 **[FIX]** `orders` table: `cartId` (UNIQUE) is sourced from `cart.cartId` UUID stored in Redis — **it is NOT a FK to a `carts` DB table** (no such table exists with D2-B). The UNIQUE constraint still enforces that a cart can only produce one order. Include this in the Drizzle schema with `.unique()` and no foreign key reference.

> 🔴 **[FIX]** `order_status_logs` table was missing `note` field — present in the Domain Model (Section 3.1) but absent from this table overview. Added above. Without it, state transition notes cannot be persisted.

> 🟢 **[FIXED][from MISSING]** `orders` table: added `paymentUrl text` — stores the VNPay payment URL so the client can retrieve it if the app is closed before payment completes.

> 🟢 **[FIXED][from MISSING]** `orders` table: added `expiresAt timestamptz` — set at order creation to `NOW() + <RESTAURANT_ACCEPT_TIMEOUT_SECONDS from app_settings>`. Used by the auto-cancel cron job (Phase 5) to identify timed-out orders.

**Deliverable:** Tables exist in DB. Types are exported. No logic yet.

---

### Phase 2 — Cart Module

**Goal:** Customers can manage their cart. Single-restaurant constraint is enforced.

**Scope:**
- `CartRedisRepository` — Redis operations: read/write/delete cart JSON at `cart:<customerId>`
- `CartService` — Domain logic:
  - `getOrCreateCart(customerId)` → reads Redis; creates new cart JSON if key absent
  - `addItem(customerId, menuItemId, quantity)` → enforces BR-2 (single-restaurant); snapshots price/name from `MenuItemProjector`
  - `removeItem(customerId, menuItemId)`
  - `updateItemQuantity(customerId, menuItemId, quantity)`
  - `clearCart(customerId)` → deletes Redis key
  - `getCart(customerId)` → returns cart JSON from Redis
- `CartController` — REST endpoints
- `CartModule`

> **No `CartRepository` (DB).** Cart state is never written to PostgreSQL. At checkout, cart data is read from Redis and written to `orders` + `order_items` in one DB transaction. The Redis key is deleted after successful order creation.

**REST Endpoints:**

```
GET    /carts/my                     → get customer's active cart (from Redis)
POST   /carts/my/items               → add item to cart
PATCH  /carts/my/items/:menuItemId   → update quantity
DELETE /carts/my/items/:menuItemId   → remove item
DELETE /carts/my                     → clear cart (delete Redis key)
```

**BR-2 Enforcement Logic:**
```
addItem(customerId, menuItemId):
  1. Load snapshot of menuItemId from MenuItemProjector → get restaurantId, name, price
  2. Load cart JSON from Redis (key: cart:<customerId>)
  3. If cart is empty → set cart.restaurantId = snapshot.restaurantId; assign new cartId UUID
  4. If cart.restaurantId !== snapshot.restaurantId → throw 409 CONFLICT
     "Cart already contains items from [restaurant name]. 
      Clear cart before adding from a different restaurant."
  5. Upsert item in cart.items[]; re-SET the key in Redis (refresh TTL)
```

**Note (D3-B):** Step 1 above uses `MenuItemProjector` (local PostgreSQL snapshot) to resolve `menuItemId → restaurantId, name, price` — no direct call to `MenuModule` or `RestaurantModule`.   [SYNCED with D3][SYNCED with D4]

**Deliverable:** Cart CRUD works end-to-end with single-restaurant constraint.

---

### Phase 3 — ACL Layer (Menu Item & Restaurant Projections)

> **This phase is REQUIRED.** D3-B (Local Projection) is selected — the Ordering context must not import `RestaurantModule` or `MenuModule` directly. All validation uses local PostgreSQL snapshots (D4-B).   [SYNCED with D3][SYNCED with D4]

**Goal:** The Ordering context maintains local, up-to-date snapshots of `MenuItem` and `Restaurant` state. No cross-module service calls at runtime.

**Scope:**

**Part A — Event Contracts (Shared)**
- `MenuItemUpdatedEvent` — published by `MenuService` after any create/update/delete/status-change
- `RestaurantUpdatedEvent` — published by `RestaurantService` after any create/update (isOpen, isApproved changes)

> ⚠️ **[WARNING]** `menu.schema.ts` (confirmed in codebase) has **two** availability fields: `status` (enum: `available | unavailable | out_of_stock`) and `isAvailable` (boolean). The `MenuItemUpdatedEvent` payload below includes **both** fields but the snapshot stores only `status`. Decide and document the canonical field:
> - **Recommendation:** Use `status` enum as the single source of truth. Drop `isAvailable` from the event payload and derive boolean availability in snapshot consumers as `status === 'available'`. Remove the dual-field ambiguity before Phase 3 implementation begins. (I agree to this recommendation, bạn cứ triển khai như giả định sẽ bỏ isAvailable đi, tui sẽ bỏ isAvailable ở restaurant-catalog sau)

**Part B — Restaurant Catalog Changes (Upstream)**
- `MenuService`: publish `MenuItemUpdatedEvent` after `create()`, `update()`, `toggleSoldOut()`
- `RestaurantService`: publish `RestaurantUpdatedEvent` after `create()`, `update()`, status changes

**Part C — Projectors in Ordering Context**
- `MenuItemProjector` — listens to `MenuItemUpdatedEvent`, updates snapshot
- `RestaurantSnapshotProjector` — listens to `RestaurantUpdatedEvent`, updates snapshot

**Sequence: Event Flow for Snapshot Update**
```
Restaurant Catalog BC              Event Bus               Ordering BC
─────────────────────────────────────────────────────────────────────────
MenuService.toggleSoldOut()
    │
    │  persist to DB
    │
    │  eventBus.publish(MenuItemUpdatedEvent {
    │      menuItemId, name, price, status,   ← [FIXED][from WARNING] isAvailable removed; status enum is canonical
    │      restaurantId
    │  })
    │                        ─────────────────────────►
    │                                                  MenuItemProjector
    │                                                  .handle(event)
    │                                                      │
    │                                                      │ update snapshot in DB table   [SYNCED with D4]
    │                                                      │ (ordering_menu_item_snapshots, D4-B)
    │                                                      ▼
    │                                              [snapshot updated]
    ▼
[response returned to client]
```

**Coupling Audit (must pass before Phase 4):**
- [ ] `order.module.ts` does NOT import `RestaurantModule` or `MenuModule`
- [ ] `cart.module.ts` does NOT import `RestaurantModule` or `MenuModule`
- [ ] Only shared artifact is the event class in `shared/events/`

**Deliverable:** Snapshots are populated and stay fresh when menu/restaurant data changes.

---

### Phase 4 — Order Placement (Checkout → Place Order)

**Goal:** A customer can check out their cart and create an Order with a frozen price snapshot.

**Scope:**
- `OrderRepository` — DB operations for orders and order_items
- `PlaceOrderHandler` — CQRS `CommandHandler` (D1-C); dispatched via `CommandBus`   [SYNCED with D1]
- `CheckoutService` — orchestrates checkout flow
- `OrderController` — REST endpoint

**Checkout Flow Sequence:**
```
Client                CartController         PlaceOrderHandler (CQRS)   [SYNCED with D1]
──────────────────────────────────────────────────────────────────────
POST /carts/my/checkout   [SYNCED with D2]
    │
    ▼
Load cart + items
    │
    ▼
Validate restaurant open/approved   ← RestaurantSnapshotProjector lookup (D3-B)   [SYNCED with D3]
    │
    ▼
Validate all items available        ← MenuItemProjector lookup (D3-B)   [SYNCED with D3]
    │
    ▼
Validate delivery address in radius ← BR-3 (see D7 below if implemented)
    │
    ▼
Lock cart in Redis (SET cart:<customerId>:lock 1 EX 30 NX) ← prevent concurrent checkouts
    │  If lock not acquired → throw 409 CONFLICT "Checkout already in progress"
    │
    ▼
Create Order aggregate:
  - orderId = uuid
  - cartId  = cart.cartId (from Redis)          ← written to orders.cartId for D5-B
  - Copy restaurantId, restaurantName (from Redis cart)
  - For each CartItem in Redis:
      orderItem.unitPrice = snapshot.price   ← from MenuItemProjector (re-validated)
      orderItem.itemName  = snapshot.name    ← frozen at this moment
  - Calculate totalAmount
  - Set status = PENDING
  - Set paymentMethod from DTO
    │
    ▼
Persist Order + OrderItems in ONE DB transaction
  (if transaction fails → release Redis lock; customer retries)
    │
    ▼
Delete Redis cart key (cart:<customerId>) + release lock   ← outside DB tx; safe because:
  if API crashes here, D5-B UNIQUE(cartId) prevents duplicate order on retry
    │
    ▼
Append OrderStatusLog(null → PENDING)
    │
    ▼
Publish OrderPlacedEvent {
  orderId, customerId, restaurantId,
  totalAmount, paymentMethod, items[]
}
    │
    ├─── paymentMethod = 'cod' ──────────────────────────────────────►
    │                            Order stays PENDING
    │                            Restaurant can now confirm (PENDING → CONFIRMED)
    │
    └─── paymentMethod = 'vnpay' ────────────────────────────────────►
                                  Payment Context creates VNPay payment link
                                  Store vnpayPaymentUrl → orders.paymentUrl   ← [FIXED][from MISSING]
                                  Return { orderId, vnpayPaymentUrl } to client (201)
                                  Order stays PENDING until PaymentConfirmedEvent
                                      │
                                      │  [Customer completes VNPay payment]
                                      │
                                      ▼
                                  PaymentConfirmedEvent received from Payment Context
                                      │
                                      ▼
                                  Ordering transitions PENDING → PAID
                                  Append OrderStatusLog(PENDING → PAID)
                                  Publish OrderStatusChangedEvent(PENDING → PAID)
                                      │
                                      ▼
                                  Restaurant can now confirm (PAID → CONFIRMED)

                    [PaymentFailedEvent received]   ← [FIXED][from MISSING]
                                      │
                                      ▼
                                  Ordering transitions PENDING → CANCELLED
                                  Restore Redis cart from order data   ← customer can retry
                                    (re-SET cart:<customerId> with original items JSON)
                                  Append OrderStatusLog(PENDING → CANCELLED)
                                  Publish OrderStatusChangedEvent(PENDING → CANCELLED)
```

**REST Endpoints:**
```
POST   /carts/my/checkout           → place order from active cart
GET    /orders/:id                  → get order detail
```

**Idempotency (D5-A + D5-B — both apply):**   [SYNCED with D5]
- D5-B: `UNIQUE(cart_id)` constraint on `orders` table — enforced at DB level via Drizzle `.unique()`
- D5-A: check `X-Idempotency-Key` header before processing; cache result in Redis
  (`idempotency:order:<key>`, TTL from `app_settings.ORDER_IDEMPOTENCY_TTL_SECONDS`)

**Deliverable:** Order is successfully created with frozen prices. `OrderPlacedEvent` is published.

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

### 6.1 Ordering Context — Internal Structure

```
src/module/ordering/
├── ordering.module.ts                    ← imports all sub-modules, exports OrderModule
│
├── cart/
│   ├── cart.module.ts
│   ├── cart.controller.ts
│   ├── cart.service.ts                   ← Service pattern (D1-C); no CommandHandler   [SYNCED with D1]
│   ├── cart.redis-repository.ts          ← Redis ops only (D2-B); no DB repo or schema   [SYNCED with D2]
│   └── dto/
│       └── cart.dto.ts
│
├── order/
│   ├── order.module.ts
│   ├── order.controller.ts
│   │
│   ├── application/                      ← D1-C: CQRS for order placement only   [SYNCED with D1]
│   │   └── commands/
│   │       ├── place-order.command.ts
│   │       └── place-order.handler.ts
│   │
│   ├── order.service.ts                  ← query methods (get order, etc.)   [SYNCED with D1]
│   ├── order.repository.ts
│   ├── order.schema.ts
│   └── dto/
│       └── order.dto.ts
│
├── order-lifecycle/
│   ├── order-lifecycle.module.ts
│   ├── order-lifecycle.controller.ts
│   ├── order-lifecycle.service.ts        ← state machine logic
│   └── dto/
│       └── transition.dto.ts
│
├── order-history/
│   ├── order-history.module.ts
│   ├── order-history.controller.ts
│   ├── order-history.service.ts
│   ├── order-history.repository.ts
│   └── dto/
│       └── order-history-query.dto.ts
│
└── acl/                                  ← required (D3-B selected)   [SYNCED with D3]
    ├── projectors/
    │   ├── menu-item.projector.ts
    │   └── restaurant-snapshot.projector.ts
    └── schemas/                            ← Drizzle schemas for snapshot tables (D4-B)   [SYNCED with D4]
        ├── menu-item-snapshot.schema.ts
        └── restaurant-snapshot.schema.ts
```

### 6.2 Shared Events Location

```
src/shared/
└── events/
    ├── menu-item-updated.event.ts              ← published by Restaurant Catalog
    ├── restaurant-updated.event.ts             ← published by Restaurant Catalog
    ├── order-placed.event.ts                   ← published by Ordering
    ├── order-status-changed.event.ts           ← published by Ordering
    ├── order-ready-for-pickup.event.ts         ← published by Ordering
    └── order-cancelled-after-payment.event.ts  ← published by Ordering   ← [FIXED][from WARNING]
```

### 6.3 Dependency Graph

```
app.module.ts
    │
    ├── RestaurantCatalogModule
    │       ├── RestaurantModule   ──publishes──► RestaurantUpdatedEvent
    │       └── MenuModule         ──publishes──► MenuItemUpdatedEvent
    │
    └── OrderingModule
            ├── CartModule         ──reads──► MenuItemProjector (ACL)
            ├── OrderModule        ──reads──► MenuItemProjector, RestaurantProjector
            │                      ──publishes──► OrderPlacedEvent
            ├── OrderLifecycleModule
            │                      ──publishes──► OrderStatusChangedEvent
            │                      ──publishes──► OrderReadyForPickupEvent
            └── OrderHistoryModule
```

---

## 7. Integration Patterns

### 7.1 Upstream: Restaurant & Catalog → Ordering

```
┌─────────────────────────────────────────────────────────────────────┐
│  UPSTREAM INTEGRATION (Restaurant Catalog → Ordering)               │
│                                                                     │
│  Trigger: Any change in MenuItem or Restaurant state                │
│                                                                     │
│  Restaurant Catalog BC          EventBus         Ordering BC        │
│  ─────────────────────       ───────────────  ──────────────────── │
│                                                                     │
│  MenuItem changes:                                                  │
│  - create, update,           MenuItemUpdated    MenuItemProjector  │
│  - toggleSoldOut      ────►      Event      ────►  .handle()       │
│  - delete                                         updates snapshot  │
│                                                                     │
│  Restaurant changes:                                                │
│  - create, update,           RestaurantUpdated  RestaurantSnapshot │
│  - approve, open/close ────►     Event      ────►  Projector       │
│                                                    .handle()        │
│                                                    updates snapshot │
└─────────────────────────────────────────────────────────────────────┘

Pattern: Domain Event (in-process EventBus)
Consistency: Eventual (milliseconds in same process)
Coupling: Only via event class (shared contract)
```

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

## 9. Phase Roadmap

### 9.1 Phases at a Glance

```
PHASE 0        PHASE 1        PHASE 2        PHASE 3
─────────      ─────────      ─────────      ─────────
Infra          Domain         Cart           ACL Layer
Setup          Schema         Module         (Projections)

[1-2h]         [2-3h]         [4-6h]         [3-4h]
   │               │               │               │
   ▼               ▼               ▼               ▼
App boots    Tables in DB    Cart CRUD        Snapshots
with empty   Drizzle types   BR-2 enforced    refreshed by
modules      exported        working          events


PHASE 4        PHASE 5        PHASE 6        PHASE 7
─────────      ─────────      ─────────      ─────────
Order          Lifecycle      Downstream     Order
Placement      State          Events         History
               Machine        Stubs          Queries

[5-8h]         [4-5h]         [2-3h]         [3-4h]
   │               │               │               │
   ▼               ▼               ▼               ▼
Order          Transitions    Events          Paginated
created        work per       reach other     history for
with frozen    actor role     context stubs   all actors
price
```

### 9.2 Dependencies Between Phases

```
Phase 0 ──►  Phase 1 ──► Phase 2 ──► Phase 4
                                │
                                └──► Phase 3 ──► Phase 4

Phase 4 ──►  Phase 5 ──► Phase 6
Phase 4 ──►  Phase 7
```

> Phase 3 (ACL) **must complete before** Phase 4 — D3-B (projections) is selected and required.   [SYNCED with D3]

### 9.3 Minimum Viable Ordering (MVO)

If you want the earliest testable end-to-end order flow, the minimum is:

```
Phase 0 + Phase 1 + Phase 2 + Phase 4 (partial: create order, no events)
```

This gives: Cart → Checkout → Order created → State = PENDING.

---

## 10. Pre-Implementation Checklist

Before writing any code, verify these are resolved:

### 10.1 Option Selections (Required)

- [x] **D1** — ✅ C (Hybrid CQRS): Cart = Service pattern; Order placement = `PlaceOrderHandler` (CQRS `CommandHandler` + `EventBus`)   [SYNCED with D1]
- [x] **D2** — ✅ B (Redis+DB): Cart stored in Redis; no `carts`/`cart_items` DB tables   [SYNCED with D2]
- [x] **D3** — ✅ B (Projections): Validation via `MenuItemProjector` + `RestaurantSnapshotProjector`; no direct service calls   [SYNCED with D3]
- [x] **D4** — ✅ B (DB table): Snapshots in `ordering_menu_item_snapshots` + `ordering_restaurant_snapshots` PostgreSQL tables   [SYNCED with D4]
- [x] **D5** — ✅ A + B (both): `X-Idempotency-Key` header (Redis, TTL from `app_settings`) + `UNIQUE(cartId)` on `orders` table   [SYNCED with D5]
- [x] **D6** — ✅ A (Transition table): Hand-crafted `ALLOWED_TRANSITIONS` map in `OrderLifecycleService`   [SYNCED with D6]

### 10.2 Blockers in Restaurant Catalog (Must Fix First)

These items in `restaurant-catalog` are required before implementing the Ordering context:

| Item | Why Needed | Phase Blocked |
|------|-----------|----------------|
| `RestaurantService` must publish `RestaurantUpdatedEvent` | Ordering's restaurant snapshot projector needs this | Phase 3 |
| `MenuService` must publish `MenuItemUpdatedEvent` | Ordering's menu item projector needs this | Phase 3 |
| Add `PATCH /restaurants/:id/approve` endpoint | Admin approval must work before orders can flow | Phase 4 |
| Fix return types: `create()` / `update()` return `NewRestaurant` instead of `Restaurant` | Type safety for downstream consumers | Phase 1 |
| **Add `deliveryRadiusKm` column to `restaurants` table** | BR-3 delivery radius check at checkout requires this field (currently absent) | Phase 4 |



### 10.3 Infrastructure Verification

- [ ] PostgreSQL running and `DB_CONNECTION` configured
- [ ] Redis instance available and configured — **add Redis service to `docker-compose.yml`** (currently only PostgreSQL is defined) — required (D2-B selected)   [SYNCED with D2]
- [ ] `@nestjs/cqrs` installed — **required** (D1-C selected; used for all events across all contexts)
- [ ] `CqrsModule` registered in every module that publishes or handles events (including `RestaurantCatalogModule`)
- [ ] `@nestjs/event-emitter` — **not needed** (all events use CQRS `EventBus` exclusively)

---

## Appendix: Naming Conventions Reference

To maintain consistency with the existing `restaurant-catalog` module:

| Layer      | Convention                                  | Example                          |
|------------|---------------------------------------------|----------------------------------|
| Schema     | `{entity}.schema.ts`                        | `cart.schema.ts`                 |
| Repository | `{entity}.repository.ts`                    | `cart.repository.ts`             |
| Service    | `{entity}.service.ts`                       | `cart.service.ts`                |
| Controller | `{entity}.controller.ts`                    | `cart.controller.ts`             |
| Module     | `{entity}.module.ts`                        | `cart.module.ts`                 |
| DTOs       | `dto/{entity}.dto.ts`                       | `dto/cart.dto.ts`                |
| Command    | `commands/{action}-{entity}.command.ts`     | `commands/place-order.command.ts`|
| Handler    | `commands/{action}-{entity}.handler.ts`     | `commands/place-order.handler.ts`|
| Projector  | `projections/{entity}.projector.ts`         | `projections/menu-item.projector.ts`|
| Events     | `shared/events/{entity}-{verb}.event.ts`    | `shared/events/order-placed.event.ts`|
