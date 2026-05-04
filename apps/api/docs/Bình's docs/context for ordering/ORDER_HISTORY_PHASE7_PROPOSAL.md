# Phase 7 — Order History Queries

> **Document Type:** Architectural Proposal
> **Author Role:** Senior Backend Engineer (DDD / Query Layer)
> **Status:** ✅ IMPLEMENTED
> **Depends On:** Phase 5 (Order Lifecycle), Phase 4 (Order Placement)
> **Target:** `apps/api/src/module/ordering/order-history/`
> **Verified Against:** Full codebase audit — all facts cross-checked with source files

---

## Table of Contents

1. [Overview](#1-overview)
2. [Use Cases](#2-use-cases)
3. [Architecture Options](#3-architecture-options)
4. [API Design](#4-api-design)
5. [Data Model & DTO](#5-data-model--dto)
6. [Repository Design](#6-repository-design)
7. [Performance Strategy](#7-performance-strategy)
8. [Edge Cases](#8-edge-cases)
9. [Integration with Existing Code](#9-integration-with-existing-code)
10. [Final Recommendation](#10-final-recommendation)
11. [Implementation Plan](#11-implementation-plan)

---

## 1. Overview

### What Phase 7 Delivers

Phases 4 and 5 built the complete **write side** of the Ordering context: order creation, checkout, state machine, and event publishing. The read side is currently minimal — only two endpoints exist:

- `GET /orders/:id` — single order detail (implemented in `OrderLifecycleController`)
- `GET /orders/:id/timeline` — audit trail

Phase 7 fills the gap: it implements the **query layer** so customers, restaurants, shippers, and admins can view order history with pagination, filtering, and role-appropriate data shaping.

### What Is Already Available (No New DB Tables Needed)

| Table | Contents |
|---|---|
| `orders` | All order metadata — status, amounts, actors, timestamps |
| `order_items` | Immutable line items — itemName, unitPrice, modifiers, subtotal |
| `order_status_logs` | Full audit trail of every state transition |
| `ordering_restaurant_snapshots` | Restaurant name, address (for context enrichment if needed) |

All query data exists in the write-model tables. Phase 7 does **not** require new DB tables, no event sourcing, and no separate read-model projections — the existing schema is sufficient.

### What Phase 7 Does NOT Deliver

- Real-time push (WebSocket/SSE for live order tracking) — Phase 8+
- Analytics dashboards / aggregation tables — Phase 9+
- Full-text search across notes/items — Phase 9+

---

## 2. Use Cases

### 2.1 Customer Use Cases

| Use Case | Description |
|---|---|
| **List my orders** | Paginated list of all orders placed by the authenticated customer, newest first |
| **Filter by status** | Show only `pending`, `delivered`, `cancelled`, etc. |
| **Filter by date range** | Show orders placed between two dates |
| **View order detail** | Full breakdown: items, modifiers, amounts, timeline, address |
| **Reorder** | Return the item list from a past order (client pre-fills a new cart — server returns the data) |

**Access rule:** Customer sees only their own orders (`WHERE customer_id = :actorId`).

---

### 2.2 Restaurant Use Cases

| Use Case | Description |
|---|---|
| **List orders by restaurant** | Paginated list of all orders for the authenticated restaurant owner's restaurant |
| **Filter by status** | Show only active (`pending`, `confirmed`, `preparing`, `ready_for_pickup`) or historical |
| **Filter by time window** | Today, last 7 days, custom date range |
| **Operational view** | Fast query for the kitchen display: orders in `preparing` or `ready_for_pickup` states only |

**Access rule:** Restaurant owner sees only orders for their own restaurant (`WHERE restaurant_id IN (SELECT restaurant_id FROM ordering_restaurant_snapshots WHERE owner_id = :actorId)`).

---

### 2.3 Shipper Use Cases

| Use Case | Description |
|---|---|
| **Available orders** | Orders in `ready_for_pickup` state — any shipper can claim |
| **My active order** | The single order currently assigned to this shipper and in an in-progress delivery state (`picked_up` or `delivering`) |
| **My delivery history** | Past orders this shipper delivered (`delivered`) — paginated |

**Access rule:** Available orders are public to all shippers. Active + history are filtered by `WHERE shipper_id = :actorId`.

---

### 2.4 Admin Use Cases

| Use Case | Description |
|---|---|
| **Global order list** | Paginated list of all orders in the platform |
| **Filter by status** | Any single status |
| **Filter by restaurant** | All orders for a given `restaurantId` |
| **Filter by customer** | All orders placed by a given `customerId` |
| **Filter by date range** | Any date range |
| **Filter by payment method** | COD vs VNPay |
| **Order detail** | Same as customer detail, no ownership restriction |

**Access rule:** Admin sees all orders; no ownership filter applied.

---

## 3. Architecture Options

### 3.1 Option A — Query Directly from Write-Model Tables

Implement a new `OrderHistoryRepository` that queries `orders` + `order_items` directly, with JOIN for list queries and separate load for item details.

```
GET /orders/my
  → OrderHistoryController
  → OrderHistoryRepository.findByCustomer(customerId, filters, pagination)
  → SELECT o.*, COUNT(oi) ... FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.customer_id = $1
     ORDER BY o.created_at DESC
     LIMIT $2 OFFSET $3
```

**Pros:**
- Zero new tables or projections
- Always consistent — reads committed write-model state
- Existing `orders` and `order_items` tables are well-indexed for the primary access patterns
- Simplest implementation — no synchronization risk
- Fits within Phase 7's scope perfectly

**Cons:**
- Shared DB tables with the write path — heavy analytic queries could impact write latency (acceptable on current VPS scale)
- Complex joins for multi-filter admin queries can be slow without correct indexes
- No out-of-box support for denormalized "last event timestamp" without a subquery or derived column

**Scale ceiling:** Adequate for 100k–10M orders. Above that, read replicas + Option C.

---

### 3.2 Option B — Dedicated Denormalized Read Model (Projection Table)

Create an `order_history_views` table updated on every `OrderStatusChangedEvent`. Queries hit this single table with no JOINs.

```sql
CREATE TABLE order_history_views (
  order_id UUID PRIMARY KEY,
  customer_id UUID,
  restaurant_id UUID,
  restaurant_name TEXT,
  status order_status,
  payment_method order_payment_method,
  total_amount NUMERIC(12,2),
  shipping_fee NUMERIC(12,2),
  item_count INT,
  first_item_name TEXT,          -- "Pho Bo" or "Pho Bo + 2 more"
  created_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ,
  shipper_id UUID
);
```

**Pros:**
- Single-table SELECT with no JOINs for list queries — fastest possible read
- Can add derived columns (e.g., `item_count`, `first_item_name`) without recomputing
- Decoupled read path from write path

**Cons:**
- Requires a new `@EventsHandler` that updates this table on every transition — more code, more failure modes
- Projection can fall out of sync if an event is missed (Phase 6 Section 8.3 explicitly documents that event handlers can fail silently)
- `order_history_views` must be populated retroactively for existing orders
- Adds an `INSERT` / `UPDATE` per transition to every write path
- **Over-engineering for current scale** — the added complexity is not justified until >10M orders or read replicas are needed

**Verdict:** ❌ Do not adopt in Phase 7.

---

### 3.3 Option C — Hybrid (Chosen ✅) (OK I choose this solution)

Use direct table queries (Option A) with:
1. A dedicated `OrderHistoryRepository` separate from the lifecycle `OrderRepository`
2. Efficient query patterns (single JOIN, no N+1)
3. Index coverage for all filter combinations (indexed in migration)
4. A service layer that shapes results per role without duplicating SQL

```
OrderHistoryController
  ├── findByCustomer()  → single SQL with JOIN, paginated
  ├── findByRestaurant()→ same pattern, different WHERE
  ├── findByShipper()   → same pattern
  ├── findAvailable()   → status='ready_for_pickup', no actor filter
  └── findAll()         → admin: all filters composable

                          ↓
                 OrderHistoryRepository
                 (Drizzle ORM, no raw SQL)

                          ↓
             orders JOIN order_items (aggregated)
```

**Why this is correct for Phase 7:**
- Matches the existing codebase pattern (`OrderRepository` in Phase 5 uses the same direct-query approach)
- No new infrastructure, no event projections to maintain
- Fully consistent — reads write model directly
- Index strategy (see Section 7) makes all access patterns O(log n) on `customer_id`, `restaurant_id`, `shipper_id`, `status`, `created_at`

---

## 4. API Design

### 4.1 Customer Endpoints

> **`[IMPLEMENTED]`** All customer endpoints: `controllers/order-history.controller.ts` → `OrderHistoryCustomerController` (`@Controller('orders')`). Service: `services/order-history.service.ts` → `getCustomerOrders`, `getCustomerOrderDetail`, `getCustomerReorderItems`.

```
GET /orders/my
Authorization: Bearer <customer-token>
```

**Query params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `status` | `OrderStatus` | No | Filter by exact status |
| `from` | ISO8601 date | No | Orders created at or after this date |
| `to` | ISO8601 date | No | Orders created at or before this date |
| `limit` | int (1–100) | No | Page size, default 20 |
| `offset` | int ≥ 0 | No | Offset for pagination, default 0 |

**Response:** `OrderListResponseDto` — see Section 5.

> **`[IMPLEMENTED]`** → `getMyOrders()` handler (line ~59). Calls `getCustomerOrders(session.user.id, filters)`. Filter DTO: `OrderHistoryFiltersDto`. `ValidationPipe({ transform: true })` in `main.ts` ensures `limit`/`offset` are numbers.

---

```
GET /orders/my/:id
Authorization: Bearer <customer-token>
```

Returns full order detail including items and timeline. Returns 404 if order does not belong to the authenticated customer.

> **`[IMPLEMENTED]`** → `getMyOrderDetail()` handler. Calls `getCustomerOrderDetail(session.user.id, id)`. Returns 404 (not 403) if order belongs to another customer (info-leak prevention).

---

```
GET /orders/my/:id/reorder
Authorization: Bearer <customer-token>
```

Returns the `items` array from the original order in a format suitable for re-adding to the cart. Does **not** create a new cart or order — the client uses this data to pre-fill. Returns 404 if order does not belong to the customer.

Response: `ReorderItemsDto[]` — see Section 5.3.

---

### 4.2 Restaurant Endpoints

> **`[IMPLEMENTED]`** All restaurant endpoints: `controllers/order-history.controller.ts` → `OrderHistoryRestaurantController` (`@Controller('restaurant')`). Role check: `hasRole(session.user.role, 'restaurant', 'admin')`. Service: `getRestaurantOrders`, `getRestaurantActiveOrders`.

```
GET /restaurant/orders
Authorization: Bearer <restaurant-owner-token>
```

**Query params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `status` | `OrderStatus` | No | Filter by exact status |
| `from` | ISO8601 date | No | Start of time window |
| `to` | ISO8601 date | No | End of time window |
| `limit` | int (1–100) | No | Page size, default 20 |
| `offset` | int ≥ 0 | No | Offset |

**Restaurant resolution:** the restaurant identity is resolved from the authenticated user's ownership via `ordering_restaurant_snapshots WHERE owner_id = actorId`. If no snapshot exists, returns 403.

> **`[IMPLEMENTED]`** → `getRestaurantOrders()` handler. Service calls `restaurantSnapshotRepo.findByOwnerId(ownerId)` → throws `ForbiddenException` if null → calls `findByRestaurantId(snapshot.restaurantId, filters)`.

---

```
GET /restaurant/orders/active
Authorization: Bearer <restaurant-owner-token>
```

Operational kitchen view: returns all orders in `confirmed`, `preparing`, or `ready_for_pickup` for this restaurant, sorted by `created_at ASC` (oldest first = highest priority). No pagination — expected to be a short live list.

> **`[IMPLEMENTED]`** `GET /restaurant/orders/active` → `getRestaurantActiveOrders()` handler. Calls `findActiveByRestaurantId(restaurantId)` with `inArray(status, ['confirmed','preparing','ready_for_pickup'])` and `ORDER BY created_at ASC`. No pagination.

---

### 4.3 Shipper Endpoints

> **`[IMPLEMENTED]`** All shipper endpoints: `controllers/order-history.controller.ts` → `OrderHistoryShipperController` (`@Controller('shipper')`). Role check: `hasRole(session.user.role, 'shipper', 'admin')`. Service: `getAvailableOrders`, `getShipperActiveOrder`, `getShipperHistory`.

```
GET /shipper/orders/available
Authorization: Bearer <shipper-token>
```

Returns all orders in `ready_for_pickup` state, sorted by `created_at ASC`. No actor filter.

> **[FIXED — INCON-6]** "No pagination" does not mean unlimited. This endpoint applies a hard server-side `LIMIT 50` with no offset support. If there are ever more than 50 waiting orders, shippers in a geo-filtered Phase 8+ implementation will see only the nearest ones anyway. Without a cap, a busy platform with hundreds of simultaneous `ready_for_pickup` orders could return a payload that degrades mobile clients. Implementation must enforce this in the repository, not just via DTO.

Returns `OrderListItemDto[]` (plain array — no `OrderListResponseDto` wrapper, since there is no pagination).

> **`[IMPLEMENTED]`** `GET /shipper/orders/available` → `getAvailableOrders()`. Repository: `findAvailableForPickup()` with `eq(status, 'ready_for_pickup')` + `ORDER BY created_at ASC` + `LIMIT 50` (constant `AVAILABLE_FOR_PICKUP_LIMIT = 50`).

---

```
GET /shipper/orders/active
Authorization: Bearer <shipper-token>
```

Returns at most 1 order where `shipper_id = actorId` AND `status IN ('picked_up', 'delivering')`. Returns an empty array if none.

> **`[IMPLEMENTED]`** → `getShipperActiveOrder()`. Repository: `findActiveForShipper(shipperId)` with `LIMIT 1` + `ORDER BY updated_at DESC`. Service returns `rows.map(mapListRow)` → `[]` (empty array) when no active delivery. **(BUG-2 fixed — previously returned `null`)**

---

```
GET /shipper/orders/history
Authorization: Bearer <shipper-token>
```

**Query params:** `limit`, `offset` (same defaults as customer list).

Returns paginated history of `delivered` orders assigned to this shipper (`WHERE shipper_id = :actorId AND status = 'delivered'`).

> **`[IMPLEMENTED]`** `GET /shipper/orders/history` → `getShipperHistory()`. Repository: `findDeliveredByShipper(shipperId, filters)` — status is hardcoded to `'delivered'` (caller-supplied `status` stripped via `{ ...filters, status: undefined }` before passing to `buildDateAndStatusConditions`).

---

### 4.4 Admin Endpoints

> **`[IMPLEMENTED]`** All admin endpoints: `controllers/order-history.controller.ts` → `OrderHistoryAdminController` (`@Controller('admin')`). Role check: `hasRole(session.user.role, 'admin')`. Service: `getAllOrders`, `getAnyOrderDetail`.

```
GET /admin/orders
Authorization: Bearer <admin-token>
```

**Query params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `status` | `OrderStatus` | No | Filter by status |
| `restaurantId` | UUID | No | Filter by restaurant |
| `customerId` | UUID | No | Filter by customer |
| `shipperId` | UUID | No | Filter by shipper |
| `paymentMethod` | `'cod' \| 'vnpay'` | No | Filter by payment method |
| `from` | ISO8601 date | No | Start date |
| `to` | ISO8601 date | No | End date |
| `limit` | int (1–100) | No | Default 20 |
| `offset` | int ≥ 0 | No | Default 0 |
| `sortBy` | `'created_at' \| 'updated_at' \| 'total_amount'` | No | Default `created_at` |
| `sortOrder` | `'asc' \| 'desc'` | No | Default `desc` |

---

```
GET /admin/orders/:id
Authorization: Bearer <admin-token>
```

Full detail for any order. No ownership restriction.

> **`[IMPLEMENTED]`** `GET /admin/orders` → `getAllOrders()` with `AdminOrderFiltersDto` (composable: `restaurantId`, `customerId`, `shipperId`, `paymentMethod`, `sortBy`, `sortOrder`). `GET /admin/orders/:id` → `getAnyOrderDetail(id)` — no ownership check, 404 only if order doesn't exist.

---

### 4.5 Routing Note

All customer endpoints are under `/orders/my` (not `/orders` globally) to avoid collision with the existing `GET /orders/:id` and `GET /orders/:id/timeline` routes in `OrderLifecycleController`. The existing routes remain unchanged — they are write-side endpoints.

> **[FIXED — INCON-2] ⚠️ Critical NestJS routing conflict — module import order matters**
>
> Both `OrderLifecycleController` and `OrderHistoryController` use `@Controller('orders')` as their base path. In NestJS with the Express adapter, when routes from **different controllers** share the same path prefix, they are matched in **module registration order**, not by specificity. Static segments (e.g., `my`) only take priority over dynamic parameters (`:id`) when they are declared in the **same controller**.
>
> `OrderingModule` currently imports:
> ```typescript
> imports: [CqrsModule, AclModule, CartModule, OrderModule, OrderLifecycleModule, OrderHistoryModule]
> ```
> Because `OrderLifecycleModule` is registered **before** `OrderHistoryModule`, `GET /orders/:id` from `OrderLifecycleController` is mounted first. Express would then match `GET /orders/my` with `id = 'my'`, and `ParseUUIDPipe` throws `400 Bad Request` before the history controller is even reached.
>
> **Required fix (enforced in Step 5 of Implementation Plan):** `OrderHistoryModule` MUST be imported **before** `OrderLifecycleModule` in `OrderingModule`:
> ```typescript
> // ordering.module.ts — correct import order
> imports: [CqrsModule, AclModule, CartModule, OrderModule, OrderHistoryModule, OrderLifecycleModule]
> ```
> This ensures `GET /orders/my` (and all `/orders/my/:id` subroutes) are registered first, making them match before the dynamic `:id` routes.

> **[ADDED — INCON-7] Note on Phase 5 ownership gap:**
> The existing Phase 5 `GET /orders/:id` in `OrderLifecycleController` has **no ownership check** — the `session` parameter is declared as `_session` (unused). Any authenticated user can retrieve any order by UUID. Phase 7's `GET /orders/my/:id` intentionally adds ownership enforcement (returns 404 if the order belongs to a different customer). The Phase 5 endpoint remains unchanged — it serves the lifecycle write-side and can be restricted in a future security hardening pass.

The new `OrderHistoryController` is registered in `OrderHistoryModule` and mounted at the path level shown. See Section 9 for module wiring and the corrected import order.

---

## 5. Data Model & DTO

> **`[IMPLEMENTED]`** All DTOs: `dto/order-history.dto.ts` — all classes below are fully implemented with `@ApiProperty` Swagger decorators and class-validator decorators.

### 5.1 Order List Item DTO

Used in all list responses.

```typescript
// src/module/ordering/order-history/dto/order-history.dto.ts

export class OrderListItemDto { ... }
export class OrderListResponseDto { ... }
```

> **`[IMPLEMENTED]`** `OrderListItemDto` + `OrderListResponseDto` — exact field match. `totalAmount`, `shippingFee` mapped with `Number()` coercion in `mapListRow()` (service). `firstItemName` defaults to `''` when null. `estimatedDeliveryMinutes` is `number | null`.

**`itemCount` and `firstItemName` implementation strategy:**

These are computed via a sub-SELECT or lateral join — not a separate N+1 query:

```sql
SELECT
  o.*,
  (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
  (SELECT MIN(oi.item_name) FROM order_items oi WHERE oi.order_id = o.id) AS first_item_name
FROM orders o
WHERE o.customer_id = $1
ORDER BY o.created_at DESC
LIMIT $2 OFFSET $3
```

With Drizzle ORM, this is implemented using `db.select({...}).from(orders)` with `sql\`...\`` correlated scalar subqueries — no raw SQL required.

> **`[IMPLEMENTED]`** `listQueryWithAggregates()` in repository uses two correlated scalar subqueries via `sql\`(SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = ${orders.id})\`` and `sql\`(SELECT MIN(oi.item_name) FROM order_items oi WHERE oi.order_id = ${orders.id})\``. `MIN(item_name)` used for deterministic ordering. **(BUG-3 fixed — original used `ORDER BY oi.id LIMIT 1` which was UUID/random)**

---

### 5.2 Order Detail DTO

Used by `GET /orders/my/:id`, `GET /admin/orders/:id`.

> **`[IMPLEMENTED]`** `OrderItemResponseDto`, `OrderModifierResponseDto`, `OrderStatusLogEntryDto`, `DeliveryAddressResponseDto`, `OrderDetailDto` — all in `dto/order-history.dto.ts`. Mapped in `mapOrderToDetail()`, `mapItem()`, `mapModifier()`, `mapStatusLog()` (private helpers in service). `deliveryAddress` cast from Drizzle JSON column via `order.deliveryAddress as OrderDetailDto['deliveryAddress']`.

```typescript
export class OrderItemDto {
  orderItemId: string;
  menuItemId: string;
  itemName: string;             // frozen snapshot
  unitPrice: number;            // frozen snapshot
  modifiersPrice: number;
  quantity: number;
  subtotal: number;
  modifiers: OrderModifierDto[];
}

export class OrderModifierDto {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  price: number;
}

// [FIXED — INCON-5] Added triggeredBy (actor UUID) — matches order_status_logs.triggered_by
// The existing GET /orders/:id/timeline (Phase 5 OrderRepository.findTimeline) returns this
// field in the raw OrderStatusLog. Omitting it from the Phase 7 DTO would lose actor identity
// in the admin detail view (e.g. "which customer cancelled?").
export class OrderStatusLogEntryDto {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  triggeredBy: string | null;   // UUID of actor — null for system-triggered transitions (cron, payment event)
  triggeredByRole: TriggeredByRole;
  note: string | null;
  createdAt: string;
}

export class OrderDetailDto {
  orderId: string;
  status: OrderStatus;
  restaurantId: string;
  restaurantName: string;
  paymentMethod: 'cod' | 'vnpay';
  totalAmount: number;
  shippingFee: number;
  estimatedDeliveryMinutes: number | null;
  note: string | null;
  // [FIXED — INCON-3] paymentUrl added — orders.payment_url stores the VNPay redirect URL.
  // A customer viewing a 'pending' VNPay order needs this to complete payment.
  // null for COD orders and for orders whose payment URL has expired.
  paymentUrl: string | null;
  deliveryAddress: {
    street: string;
    district: string;
    city: string;
    latitude?: number;
    longitude?: number;
  };
  shipperId: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItemDto[];
  timeline: OrderStatusLogEntryDto[];
}
```

**Loading strategy:** `OrderDetailDto` is assembled from three queries:

1. `SELECT * FROM orders WHERE id = $1` — the aggregate
2. `SELECT * FROM order_items WHERE order_id = $1` — items
3. `SELECT * FROM order_status_logs WHERE order_id = $1 ORDER BY created_at ASC` — timeline

These run in parallel via `Promise.all([ ... ])` — not sequentially. This avoids any latency stacking and is not N+1 (fixed 3 queries for any order, regardless of item count or log depth).

> **`[IMPLEMENTED]`** `findDetailById(orderId)` in repository uses `Promise.all([orderQuery, itemsQuery, timelineQuery])`. Returns `null` when order not found. Service throws `NotFoundException` on null; ownership checked before returning detail.

---

### 5.3 Reorder DTO

```typescript
export class ReorderItemDto {
  menuItemId: string;
  itemName: string;         // display name at time of original order
  quantity: number;
  selectedModifiers: Array<{
    groupId: string;
    optionId: string;
  }>;
}
```

The client uses `ReorderItemDto[]` to pre-fill `AddItemToCartDto` requests. The server does **not** validate item availability here — that happens when the client re-adds items via `POST /carts/my/items` (Phase 2 validation path). This keeps the reorder endpoint stateless and fast.

> **`[IMPLEMENTED]`** `ReorderItemDto` + `ReorderModifierDto` in `dto/order-history.dto.ts`. Mapping in `getCustomerReorderItems()` (service): projects `item.modifiers` (JSON column) to `{ groupId, optionId }` pairs. No price re-validation at this endpoint.

---

### 5.4 Filter Query DTO (shared base)

```typescript
export class OrderHistoryFiltersDto {
  @IsOptional() @IsEnum(orderStatusEnum.enumValues)
  status?: OrderStatus;

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;

  @IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number)
  limit?: number = 20;

  @IsOptional() @IsInt() @Min(0) @Type(() => Number)
  offset?: number = 0;
}

export class AdminOrderFiltersDto extends OrderHistoryFiltersDto {
  @IsOptional() @IsUUID()
  restaurantId?: string;

  @IsOptional() @IsUUID()
  customerId?: string;

  @IsOptional() @IsUUID()
  shipperId?: string;

  @IsOptional() @IsEnum(['cod', 'vnpay'])
  paymentMethod?: 'cod' | 'vnpay';

  @IsOptional() @IsEnum(['created_at', 'updated_at', 'total_amount'])
  sortBy?: string = 'created_at';

  @IsOptional() @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
```

---

## 6. Repository Design

### 6.1 New: `OrderHistoryRepository`

> **`[IMPLEMENTED]`** `repositories/order-history.repository.ts` — `@Injectable()` class with `@Inject(DB_CONNECTION) private readonly db: NodePgDatabase<typeof schema>`. Exports `OrderListRow` (= `Order & { itemCount: number; firstItemName: string }`) and `OrderDetailBundle` types. It is **separate** from the existing `OrderRepository` in `OrderLifecycleModule`. This separation is deliberate:

- `OrderRepository` (Phase 5): write-side reads — load-by-id for transition validation, find-expired for cron. Optimized for low-latency single-row lookups.
- `OrderHistoryRepository` (Phase 7): read-side queries — paginated lists, filter combinations, aggregations. Optimized for read throughput with proper indexes.

The two repositories query the **same underlying tables** but serve different purposes and have different query shapes. Keeping them separate avoids coupling the lifecycle's tight SLA to the history query's potentially longer execution.

```typescript
// src/module/ordering/order-history/repositories/order-history.repository.ts

@Injectable()
export class OrderHistoryRepository {
  // findByCustomer(customerId, filters)  → paginatedListQuery()
  // findByRestaurantId(restaurantId, filters)  → paginatedListQuery()
  // findActiveByRestaurantId(restaurantId)  → listQueryWithAggregates()
  // findAvailableForPickup()  → listQueryWithAggregates() + LIMIT 50
  // findActiveForShipper(shipperId)  → listQueryWithAggregates() + LIMIT 1
  // findDeliveredByShipper(shipperId, filters)  → paginatedListQuery()
  // findAll(filters: AdminOrderFiltersDto)  → paginatedListQuery() + composable sort
  // findDetailById(orderId)  → Promise.all([order, items, timeline])
  // private: paginatedListQuery()  → Promise.all([listQuery, countQuery])
  // private: listQueryWithAggregates()  → core SELECT with correlated subqueries
  // private: buildDateAndStatusConditions()  → reusable WHERE conditions
}
```

> **[FIXED — INCON-4] `RestaurantSnapshotRepository` missing `findByOwnerId()`**
>
> The existing `RestaurantSnapshotRepository` (in `acl/repositories/`) exposes:
> - `findById(restaurantId)`
> - `findManyByIds(restaurantIds[])`
> - `findByRestaurantIdAndOwnerId(restaurantId, ownerId)` — checks both fields
> - `upsert(data)`
>
> There is **no** `findByOwnerId(ownerId)` method. This method is needed to resolve the owner's `restaurantId` before querying orders. It must be added to `RestaurantSnapshotRepository` as part of Phase 7:
> ```typescript
> // Add to RestaurantSnapshotRepository
> async findByOwnerId(ownerId: string): Promise<OrderingRestaurantSnapshot | null> {
>   const result = await this.db
>     .select()
>     .from(orderingRestaurantSnapshots)
>     .where(eq(orderingRestaurantSnapshots.ownerId, ownerId))
>     .limit(1);
>   return result[0] ?? null;
> }
> ```
> `OrderHistoryService` calls this before querying orders: if `null`, throw `ForbiddenException('No restaurant found for your account.')` (see EDGE-6).

### 6.2 Pagination Pattern

> **`[IMPLEMENTED]`** `paginatedListQuery(where, filters, orderBy)` — private method. Runs `Promise.all([listQueryWithAggregates(...), db.select({ value: count() }).from(orders).where(where)])`. Default `orderBy = desc(orders.createdAt)`. Returns `{ data: OrderListRow[], total: number }`.

All paginated methods execute **two queries** per call:

1. `SELECT ... LIMIT $limit OFFSET $offset` — the data page
2. `SELECT COUNT(*) ... ` (same WHERE clause, no JOIN) — total count

Both run in `Promise.all()`. This is the standard offset-pagination pattern, consistent with the existing `restaurant-catalog` search endpoints in the codebase.

**Why not cursor pagination?** Offset pagination is simpler and works well for order history where:
- Customers have at most a few hundred orders
- Restaurant operators view daily/weekly windows, not infinite scroll
- The list is not real-time (no need for stable cursor after concurrent inserts)

Cursor pagination is appropriate in Phase 8+ if shipper assignment requires stable infinite-scroll through thousands of available orders.

### 6.3 Drizzle ORM Query Construction

> **`[IMPLEMENTED]`** `buildDateAndStatusConditions(filters)` — private method returning `[statusCondition | undefined, fromCondition | undefined, toCondition | undefined] as const`. Spread into `and(...)`. `findAll()` uses composable ternary conditions for `restaurantId`, `customerId`, `shipperId`, `paymentMethod` filters + dynamic sort column resolution.

The repository builds queries dynamically using Drizzle's `and(...)` with optional conditions:

```typescript
const conditions = and(
  eq(orders.customerId, customerId),
  filters.status ? eq(orders.status, filters.status) : undefined,
  filters.from ? gte(orders.createdAt, new Date(filters.from)) : undefined,
  filters.to ? lte(orders.createdAt, new Date(filters.to)) : undefined,
);
```

The aggregation for `itemCount` and `firstItemName` uses a lateral subquery via Drizzle `sql` tag — this avoids a separate N+1 round-trip for item counts on list pages.

---

## 7. Performance Strategy

### 7.1 Index Strategy

> **`[IMPLEMENTED]`** `src/drizzle/out/0010_phase7_order_history_indexes.sql` — 7 indexes. Note: manually applied migration (follows existing convention of `0005_`–`0009_` files not registered in `_journal.json`).

The following indexes are required for Phase 7 queries to be O(log n):

```sql
-- Customer list (primary access pattern)
CREATE INDEX idx_orders_customer_id_created_at
  ON orders (customer_id, created_at DESC);

-- Restaurant list
CREATE INDEX idx_orders_restaurant_id_created_at
  ON orders (restaurant_id, created_at DESC);

-- Shipper history
CREATE INDEX idx_orders_shipper_id_status
  ON orders (shipper_id, status)
  WHERE shipper_id IS NOT NULL;

-- Available for pickup (shipper available orders)
CREATE INDEX idx_orders_status_created_at
  ON orders (status, created_at ASC)
  WHERE status = 'ready_for_pickup';

-- Admin multi-filter: status + created_at is most common
CREATE INDEX idx_orders_status_created_at_full
  ON orders (status, created_at DESC);

-- [FIXED — INCON-1] order_items detail load
-- REQUIRED — NOT optional. PostgreSQL creates indexes automatically only for PRIMARY KEYs
-- and UNIQUE constraints. A FOREIGN KEY constraint (order_items.order_id → orders.id)
-- does NOT auto-create an index on the child (FK) column. Without this index, every
-- detail load does a full sequential scan of order_items filtered by order_id.
CREATE INDEX idx_order_items_order_id ON order_items (order_id);

-- [FIXED — INCON-1] order_status_logs timeline load
-- REQUIRED — same reason as above. The FK constraint on order_status_logs.order_id
-- does NOT auto-create an index on this column.
CREATE INDEX idx_order_status_logs_order_id ON order_status_logs (order_id);
```

> **Note:** `orders.customer_id` and `orders.restaurant_id` do not have FK constraints (they are cross-context plain UUIDs), so PostgreSQL does not auto-create indexes for them. They MUST be added explicitly in the Phase 7 migration.

### 7.2 N+1 Prevention

| Pattern | How N+1 Is Prevented |
|---|---|
| List page `itemCount` | Lateral aggregate subquery — 1 SQL per list, not 1 per row |
| List page `firstItemName` | Same lateral aggregate subquery |
| Detail page items | Single `SELECT * FROM order_items WHERE order_id = $1` |
| Detail page timeline | Single `SELECT * FROM order_status_logs WHERE order_id = $1` |
| Detail + items + timeline | `Promise.all([findOrder, findItems, findTimeline])` — 3 parallel queries, not sequential |

### 7.3 Large Dataset Handling

For a customer with 1,000+ orders:
- `LIMIT 20 OFFSET 0` returns the 20 most recent: with `idx_orders_customer_id_created_at`, this is a fast index scan
- `OFFSET 500` becomes slower (PostgreSQL must scan and discard 500 rows) — acceptable for order history where users rarely paginate past page 5

For admin queries with no filters returning 100k+ rows:
- Always require `limit` (default 20, max 100)
- Force `ORDER BY created_at DESC` — always descending on indexed column
- For analytic exports (> 100 rows), a dedicated export endpoint (Phase 9+) using streaming cursors is the right answer, not offset pagination

### 7.4 Read vs Write Contention

`OrderLifecycleController` performs `UPDATE orders SET status=... WHERE id=... AND version=...` at high frequency during peak order flow. The history queries are `SELECT` only — they hold no locks and cannot block writes. PostgreSQL MVCC guarantees that concurrent reads and writes do not block each other. No additional isolation is required.

---

## 8. Edge Cases

### EDGE-1 — Large Order History (100k+ orders for one customer)

Unlikely in a food delivery context (a power user placing 3 orders/day for 90 years = 100k), but must be handled. Mitigations:
- `LIMIT` cap at 100 rows — enforced by DTO validation, not just a default
- Index on `(customer_id, created_at DESC)` ensures no full table scan
- Consider adding a filter hint in Swagger: "Use `from`/`to` to narrow large history"

### EDGE-2 — Missing Snapshot Data in Response

`orders.restaurant_name` is a snapshot stored at order creation time (Phase 4, `PlaceOrderHandler` Step 7). This value is **immutable** — it does not change even if the restaurant is renamed later. No join to `ordering_restaurant_snapshots` is needed in list responses. The snapshot is already on the `orders` row.

`order_items.item_name` is similarly immutable. No N+1 lookup to snapshot tables is needed.

**What is missing:** restaurant address in list view. This is intentionally excluded — the detail view uses `order.deliveryAddress` (customer's address) which is always present. Restaurant address is available in `ordering_restaurant_snapshots` but is not needed for order history display.

### EDGE-3 — Concurrent Update Visibility

`OrderLifecycleModule` uses optimistic locking (`version` column). While a `PATCH /orders/:id/confirm` is being committed, a concurrent `GET /orders/my` may return `status='pending'`. This is expected and correct — PostgreSQL's read-committed isolation level guarantees the client will see the latest committed state on the next request. No special handling is needed.

### EDGE-4 — Pagination Consistency During Active Orders

If a customer is on page 1 of their order history and places a new order, the new order appears at the top on the next page refresh. This is correct behavior for `ORDER BY created_at DESC OFFSET 0`. It does not cause duplicates or gaps because order history is an append-only workload (orders are created, never deleted). Cursor-based pagination would eliminate this entirely but adds complexity not justified at this scale.

### EDGE-5 — Shipper Active Order (Expected: 0 or 1)

`GET /shipper/orders/active` returns at most 1 order. The DB query uses `LIMIT 1`. This is a business assumption: a shipper handles one delivery at a time. If Phase 8 introduces concurrent deliveries, this endpoint becomes a list — the change is isolated to the query and DTO, not the controller signature.

### EDGE-6 — Restaurant Without Snapshot

`GET /restaurant/orders` requires looking up the authenticated user's restaurant via `ordering_restaurant_snapshots WHERE owner_id = :actorId`. If no snapshot exists (restaurant was deleted, or projector hasn't synced yet), return `403 Forbidden` with message "No restaurant found for your account." Do not return an empty list — an empty list implies the restaurant exists but has no orders.

### EDGE-7 — `offset` Beyond Total Count

`SELECT ... LIMIT 20 OFFSET 10000` where total is 5 rows returns an empty `data: []` array with `total: 5`. This is correct — the client should check `total` vs `offset + limit` to detect the end of the list. Do not return 404.

---

## 9. Integration with Existing Code

### 9.1 Module Wiring

`OrderHistoryModule` is already registered in `OrderingModule` (verified in `ordering.module.ts`). Phase 7 fills in its implementation:

```typescript
// src/module/ordering/order-history/order-history.module.ts

@Module({
  imports: [DatabaseModule],
  controllers: [OrderHistoryController],
  providers: [
    OrderHistoryService,
    OrderHistoryRepository,
    // RestaurantSnapshotRepository needed to resolve ownerId → restaurantId
    // Declared directly (same pattern as OrderModule, OrderLifecycleModule)
    // AclModule exports this repo but importing AclModule here would register
    // the projector event handlers, which OrderHistoryModule does not need.
    RestaurantSnapshotRepository,
  ],
})
export class OrderHistoryModule {}
```

`CqrsModule` is **not** needed here — Phase 7 is pure read, no commands or events.

> **[FIXED — INCON-2] ⚠️ `OrderingModule` import order must change**
>
> `OrderHistoryModule` MUST be imported **before** `OrderLifecycleModule` in `OrderingModule`. Without this, `GET /orders/:id` (registered by `OrderLifecycleController`) intercepts `GET /orders/my` because NestJS routes from first-registered controllers win over later-registered ones for the same base path. See Section 4.5 for full explanation.
>
> ```typescript
> // src/module/ordering/ordering.module.ts — REQUIRED CHANGE
> @Module({
>   imports: [
>     CqrsModule,
>     AclModule,
>     CartModule,
>     OrderModule,
>     OrderHistoryModule,      // ← BEFORE OrderLifecycleModule
>     OrderLifecycleModule,    // ← AFTER OrderHistoryModule
>   ],
> })
> export class OrderingModule {}
> ```

### 9.2 BC Boundary Compliance

| Rule | Status |
|---|---|
| No direct import from `restaurant-catalog` | ✅ — restaurant data comes from `ordering_restaurant_snapshots` (ACL snapshot), not RestaurantModule |
| No cross-BC service calls at query time | ✅ — all data is in `orders`, `order_items`, `order_status_logs` |
| No new events published | ✅ — read-side only |
| No write operations | ✅ — all `GET` endpoints |

### 9.3 Reuse of Existing Infrastructure

| Component | How Reused |
|---|---|
| `DB_CONNECTION` injection token | Same pattern as `OrderRepository`, `RestaurantSnapshotRepository` |
| `DatabaseModule` | Same import as all other Drizzle-using modules |
| `Session` / `UserSession` from `@thallesp/nestjs-better-auth` | Same auth pattern as `OrderLifecycleController` |
| `hasRole()` from `auth/role.util` | Same role check as `OrderLifecycleController` |
| `ParseUUIDPipe` | Same as existing controllers |

### 9.4 No Coupling to OrderLifecycleModule

`OrderHistoryModule` does **not** import `OrderLifecycleModule` or reuse `OrderRepository` from Phase 5. This is intentional:

- `OrderRepository` (Phase 5) is scoped to `OrderLifecycleModule` and is not exported
- `OrderHistoryRepository` (Phase 7) queries the same tables independently
- This prevents a situation where the read-side inherits the lifecycle module's providers (e.g., cron tasks, event handlers) unnecessarily

---

## 10. Final Recommendation

### ✅ Chosen Approach: Option C (Hybrid — Direct Query with Proper Indexes)

```
Chosen approach: C
Reason:
  1. The existing write-model schema (orders, order_items, order_status_logs) already
     contains all data needed for every query use case. No new tables are required.
  2. Option B (denormalized projection) adds synchronization complexity and failure
     modes (projection drift) that are not justified at current scale.
  3. All required access patterns can be served efficiently by a single lateral-join
     query (list) or 3 parallel point-lookups (detail) — with appropriate indexes.
  4. The approach is consistent with existing patterns in the codebase (OrderRepository,
     RestaurantSnapshotRepository use the same direct-Drizzle-query style).
  5. When scale demands it (>10M orders, read replica), the only change is pointing
     OrderHistoryRepository's DB_CONNECTION to the replica. The architecture supports
     this without refactoring.
```

### What MUST Be Done Before Implementation

| Priority | Action |
|---|---|
| MUST | Add migration with indexes listed in Section 7.1 (without these, list queries will full-scan) |
| MUST | Implement `OrderHistoryRepository` with lateral aggregate for itemCount/firstItemName |
| MUST | Implement `OrderHistoryService` for role-based routing and response shaping |
| MUST | Implement `OrderHistoryController` for all 10 endpoints |
| MUST | Write E2E tests for the 4 actor scenarios (customer, restaurant, shipper, admin) |
| SHOULD | Add `GET /orders/my/:id/reorder` as a convenience endpoint |
| NICE | Add `GET /restaurant/orders/active` for kitchen operational view |

---

## 11. Implementation Plan

```
Step 1: Add Drizzle migration with 7 indexes (Section 7.1)  [IMPLEMENTED]
Step 2: Create OrderHistoryRepository with all query methods  [IMPLEMENTED]
Step 3: Create OrderHistoryService (role resolution, response mapping)  [IMPLEMENTED]
Step 4: Create OrderHistoryController (10 endpoints across 4 controllers)  [IMPLEMENTED]
Step 5: Wire OrderHistoryModule (DatabaseModule + RestaurantSnapshotRepository)  [IMPLEMENTED]
Step 6: Write DTOs (OrderListItemDto, OrderDetailDto, ReorderItemDto, filter DTOs)  [IMPLEMENTED]
Step 7: Write E2E tests — 4 actor groups × primary scenarios
Step 8: Verify no existing Phase 4/5 tests break
```

> **[IMPLEMENTED — Phase 7 Code]**
> Files created/modified:
> - `src/module/ordering/order-history/dto/order-history.dto.ts` — all DTOs (Steps 1–6)
> - `src/module/ordering/order-history/repositories/order-history.repository.ts` — full repository
> - `src/module/ordering/order-history/services/order-history.service.ts` — service with ownership checks
> - `src/module/ordering/order-history/controllers/order-history.controller.ts` — 4 controllers (Customer, Restaurant, Shipper, Admin)
> - `src/module/ordering/order-history/order-history.module.ts` — expanded from stub
> - `src/module/ordering/acl/repositories/restaurant-snapshot.repository.ts` — added `findByOwnerId()` [INCON-4]
> - `src/module/ordering/ordering.module.ts` — `OrderHistoryModule` now imported before `OrderLifecycleModule` [INCON-2]
> - `src/drizzle/out/0010_phase7_order_history_indexes.sql` — 7 performance indexes

### Folder Structure

```
src/module/ordering/order-history/
├── order-history.module.ts          ← expand existing stub
├── controllers/
│   └── order-history.controller.ts
├── services/
│   └── order-history.service.ts
├── repositories/
│   └── order-history.repository.ts
└── dto/
    └── order-history.dto.ts
```

### E2E Test Coverage (Minimum)

| Test | Scenario |
|---|---|
| Customer list | Returns only own orders, pagination works |
| Customer filter | `status=delivered` returns only delivered |
| Customer detail | Returns items + timeline, 404 for other's order |
| Customer reorder | Returns item list from past order |
| Restaurant list | Returns only own restaurant's orders |
| Restaurant active | Returns only `confirmed/preparing/ready_for_pickup` |
| Shipper available | Returns `ready_for_pickup` orders, no actor filter |
| Shipper active | Returns shipper's current in-progress delivery |
| Admin list | Returns all orders with no filter |
| Admin multi-filter | `status + restaurantId + from/to` works together |

---

## Self-Review Checklist

- [x] No BC boundary violations — all data read from Ordering-owned tables + ACL snapshots
- [x] No coupling to restaurant-catalog module
- [x] N+1 eliminated — lateral aggregate for list, parallel Promise.all for detail
- [x] Pagination: offset-based with total count, limit capped at 100
- [x] Index strategy covers all primary access patterns
- [x] Role-based access: customer sees own, restaurant sees own, shipper sees own + available, admin sees all
- [x] Edge cases documented: large history, missing snapshot, concurrent visibility, empty offset
- [x] Reorder endpoint returns data only — no side effects, no cart mutation
- [x] `OrderHistoryModule` does not import `OrderLifecycleModule` (no circular dependency risk)
- [x] `CqrsModule` not needed — pure read side, no commands or events
- [x] Consistent with existing code patterns (same DB injection, same auth, same repository style)
- [x] **[FIXED — INCON-1]** FK index comments corrected — `idx_order_items_order_id` and `idx_order_status_logs_order_id` are REQUIRED (PostgreSQL does NOT auto-index FK child columns)
- [x] **[FIXED — INCON-2]** Route conflict documented — `OrderHistoryModule` must be imported before `OrderLifecycleModule` in `OrderingModule` (§4.5, §9.1)
- [x] **[FIXED — INCON-3]** `paymentUrl: string | null` added to `OrderDetailDto` (VNPay payment recovery)
- [x] **[FIXED — INCON-4]** `RestaurantSnapshotRepository.findByOwnerId()` documented as a required addition for Phase 7 (§6.1)
- [x] **[FIXED — INCON-5]** `triggeredBy: string | null` added to `OrderStatusLogEntryDto` (matches `order_status_logs.triggered_by` schema)
- [x] **[FIXED — INCON-6]** `GET /shipper/orders/available` hard-capped at LIMIT 50 (§4.3)
- [x] **[FIXED — INCON-7]** Phase 5 ownership gap documented — `GET /orders/:id` has no ownership check; Phase 7's `GET /orders/my/:id` correctly adds it (§4.5)
