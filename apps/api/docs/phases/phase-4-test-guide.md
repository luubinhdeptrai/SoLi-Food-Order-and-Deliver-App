# Phase 4 Test Guide — Checkout → Order Placement

**Phase:** 4  
**Status:** Implemented — All post-review issues fixed (C-1, C-2, M-1, M-2, M-3)  
**Pre-requisites:** Phase 0, 1, 2, and 3 complete; Docker services running; DB seeded

---

## Overview

Phase 4 implements the **order placement flow** using D1-C Hybrid CQRS:

```
POST /carts/my/checkout
    │
    ▼  Validate X-Idempotency-Key format (controller, M-2 fix)
    │
    ▼  (CartController dispatches)
PlaceOrderCommand
    │
    ▼  (CommandBus routes to)
PlaceOrderHandler
    │
    ├─ 1. D5-A: Redis idempotency check
    ├─ 2. Cart lock (SET NX)
    ├─ 3. Load cart from Redis
    ├─ 4. Load ACL snapshots
    ├─ 5. Validate restaurant + items + restaurantId per-item (C-2 fix)
    ├─ 6. BR-3: Delivery radius (optional)
    ├─ 7. Snapshot prices → order_items
    ├─ 8. Calculate total
    ├─ 9. DB transaction: orders + order_items + order_status_logs
    ├─ 10. Save idempotency key to Redis (C-1 fix — BEFORE cart delete)
    ├─ 11. Publish OrderPlacedEvent
    └─ 12. Clear Redis cart (best-effort, .catch() wrapped)
```

### New Files

| Component | Path |
|-----------|------|
| `PlaceOrderCommand` | `src/module/ordering/order/commands/place-order.command.ts` |
| `PlaceOrderHandler` | `src/module/ordering/order/commands/place-order.handler.ts` |
| `CheckoutDto` / `CheckoutResponseDto` | `src/module/ordering/order/dto/checkout.dto.ts` |
| `AppSettingsService` | `src/module/ordering/common/app-settings.service.ts` |

### Modified Files

| File | Change |
|------|--------|
| `cart/cart.controller.ts` | Added `POST /carts/my/checkout` endpoint, injected `CommandBus` |
| `cart/cart.module.ts` | Added `CqrsModule`, exports `CartRedisRepository` |
| `order/order.module.ts` | Registered `PlaceOrderHandler`, `AppSettingsService`, snapshot repos, `CartRedisRepository` |

---

## Environment Setup

```powershell
# Start infrastructure
docker compose up -d   # PostgreSQL + Redis

# From apps/api/
pnpm seed              # Clear + reseed all tables (includes app_settings rows)
pnpm start:dev         # Start API server (port 3000)
```

### Seeded IDs (used in every test below)

| Resource | ID |
|----------|----|
| **Customer 1 (default test user)** | `11111111-1111-4111-8111-111111111111` |
| **Customer 2** | `22222222-2222-4222-8222-222222222222` |
| **Sunset Bistro** (open + approved) | `fe8b2648-2260-4bc5-9acd-d88972148c78` |
| **Closed Kitchen** (closed) | `cccccccc-cccc-4ccc-8ccc-cccccccccccc` |
| **Margherita Pizza** (available, R1) | `4dc7cdfa-5a54-402f-b1a8-2d47de146081` |
| **Caesar Salad** (available, R1) | `a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5` |
| **Classic Burger** (available, R2) | `c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6` |

> All write endpoints use `x-test-user-id` header (DevTestUserMiddleware active in dev).
> No real JWT required.

---

## Shared Request Fragments

```http
# ── helpers ──────────────────────────────────────────────────────────────────
# Valid delivery address (used in multiple scenarios)
# (no GPS coords — BR-3 skipped gracefully since snapshot has no radius either)
@deliveryAddress = {
  "street": "123 Le Loi St",
  "district": "District 1",
  "city": "Ho Chi Minh City"
}
```

---

## Test Scenarios

---

### Scenario 1 — Normal Checkout (Happy Path)

**Goal:** Full successful checkout with a valid cart, all snapshots present.

#### Step 1.1 — Add item to cart

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 2
}
```

**Expected 201:** Cart with 1 item, qty=2.

#### Step 1.2 — Add second item

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "menuItemId": "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Caesar Salad",
  "unitPrice": 8.00,
  "quantity": 1
}
```

#### Step 1.3 — Checkout

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "deliveryAddress": {
    "street": "123 Le Loi St",
    "district": "District 1",
    "city": "Ho Chi Minh City"
  },
  "paymentMethod": "cod",
  "note": "Extra napkins please"
}
```

**Expected 201:**
```json
{
  "orderId": "<uuid>",
  "status": "pending",
  "totalAmount": 33.0,
  "paymentMethod": "cod",
  "paymentUrl": null,
  "createdAt": "<ISO timestamp>"
}
```

> `totalAmount = (12.50 × 2) + (8.00 × 1) = 33.00`  
> Price is taken from ACL snapshot, NOT from the cart values.

#### Step 1.4 — Verify cart is cleared

```http
GET http://localhost:3000/api/carts/my
x-test-user-id: 11111111-1111-4111-8111-111111111111
```

**Expected:** `null` (cart deleted from Redis after checkout).

#### Step 1.5 — Verify DB records

```sql
-- Order created
SELECT id, customer_id, status, total_amount, payment_method, cart_id
FROM orders
ORDER BY created_at DESC
LIMIT 1;

-- Expected: 1 row with status='pending', total_amount=33.00

-- Order items (immutable price snapshot)
SELECT item_name, unit_price, quantity, subtotal
FROM order_items
WHERE order_id = '<orderId from above>';

-- Expected: 2 rows:
--   Margherita Pizza, 12.50, 2, 25.00
--   Caesar Salad,      8.00, 1,  8.00

-- Initial status log (null → PENDING)
SELECT from_status, to_status, triggered_by_role, note
FROM order_status_logs
WHERE order_id = '<orderId>';

-- Expected: 1 row, from_status=NULL, to_status='pending', triggered_by_role='customer'
```

**Explanation:** The handler atomically inserted orders + order_items + order_status_logs in a single DB transaction, then cleared the cart.

---

### Scenario 2 — Duplicate Request (Same Idempotency Key)

**Goal:** D5-A — Redis idempotency key prevents duplicate order creation.

#### Step 2.1 — Add items (fresh cart)

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1
}
```

#### Step 2.2 — First checkout with idempotency key

> **⚠️ M-2 FIX:** The `X-Idempotency-Key` header is now validated against `/^[0-9a-fA-F-]{8,64}$/`.
> Only **UUID-format keys** (hex digits + hyphens, 8–64 chars) are accepted. Keys containing non-hex
> letters (e.g. `test-idem-key-abc123` — contains `t`, `s`, `i`, `m`, `k`, `y`) will be rejected
> with `400 Bad Request`. Use a proper UUID string as shown below.

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111
X-Idempotency-Key: a1b2c3d4-e5f6-4a7b-8c9d-000000000001

{
  "deliveryAddress": { "street": "5 Tran Hung Dao", "district": "D1", "city": "HCMC" },
  "paymentMethod": "cod"
}
```

Note the `orderId` from the response.

#### Step 2.3 — Retry with same idempotency key (simulating network retry)

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111
X-Idempotency-Key: a1b2c3d4-e5f6-4a7b-8c9d-000000000001

{
  "deliveryAddress": { "street": "5 Tran Hung Dao", "district": "D1", "city": "HCMC" },
  "paymentMethod": "cod"
}
```

**Expected 201:** Same `orderId` as Step 2.2. **No new DB row created.**

> **C-1 fix note:** The idempotency key is saved to Redis **immediately after the DB transaction commits** (Step 10) — before cart deletion (Step 12). This means even if the cart delete failed during Step 2.2 and the client retried, the idempotency cache would still be populated and Step 2.3 would correctly return the cached `orderId` rather than hitting the `UNIQUE(cartId)` constraint.

#### Verify (SQL)

```sql
SELECT COUNT(*) FROM orders WHERE customer_id = '11111111-1111-4111-8111-111111111111';
-- Expected: 1 (not 2)
```

**Explanation:** Step 2.3 hits Redis key `idempotency:order:a1b2c3d4-e5f6-4a7b-8c9d-000000000001`, finds the cached `orderId`, fetches it from DB, and returns immediately. The cart was already deleted after Step 2.2, so no new order is attempted.

---

### Scenario 2b — Invalid Idempotency Key (M-2 fix)

**Goal:** Confirm that malformed `X-Idempotency-Key` values are rejected at the controller layer, before any Redis or DB work begins.

> **What was fixed (M-2):** The controller now validates the header against `/^[0-9a-fA-F-]{8,64}$/`. Keys containing non-hex characters, empty strings, or keys longer than 64 characters are rejected with `400 Bad Request`. This prevents Redis key injection and oversized keys from reaching the handler.

#### Step 2b.1 — Send checkout with non-hex idempotency key

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111
X-Idempotency-Key: test-idem-key-abc123

{
  "deliveryAddress": { "street": "5 Tran Hung Dao", "district": "D1", "city": "HCMC" },
  "paymentMethod": "cod"
}
```

**Expected 400 Bad Request:**
```json
{
  "statusCode": 400,
  "message": "X-Idempotency-Key must be a UUID string (8–64 hexadecimal characters with optional hyphens)."
}
```

**Explanation:** `test-idem-key-abc123` contains non-hex letters (`t`, `s`, `i`, `m`, `k`, `y`). The controller rejects it before dispatching `PlaceOrderCommand`. No cart read, no Redis idempotency check, no DB work.

#### Step 2b.2 — Send checkout with oversized idempotency key (> 64 chars)

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111
X-Idempotency-Key: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c

{
  "deliveryAddress": { "street": "5 Tran Hung Dao", "district": "D1", "city": "HCMC" },
  "paymentMethod": "cod"
}
```

**Expected 400 Bad Request** (key is 65 hex chars — exceeds 64-char limit).

#### Step 2b.3 — Send checkout with whitespace-only idempotency key

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111
X-Idempotency-Key:    

{
  "deliveryAddress": { "street": "5 Tran Hung Dao", "district": "D1", "city": "HCMC" },
  "paymentMethod": "cod"
}
```

**Expected:** Treated as no key provided (whitespace trimmed to `undefined`). Checkout proceeds normally without idempotency caching. **No 400.**

#### Step 2b.4 — Send checkout with valid UUID key (should succeed)

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111
X-Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

{
  "deliveryAddress": { "street": "5 Tran Hung Dao", "district": "D1", "city": "HCMC" },
  "paymentMethod": "cod"
}
```

**Expected 201:** Order created normally. Key passes validation (standard UUID v4 format — 36 chars, all hex + hyphens).

---

### Scenario 2c — Cross-Restaurant Cart Integrity (C-2 fix)

**Goal:** Confirm that `assertAllItemsAreAvailable()` rejects a checkout where an item's ACL snapshot belongs to a different restaurant than the cart's `restaurantId`.

> **What was fixed (C-2):** The handler now passes `cart.restaurantId` to `assertAllItemsAreAvailable()` and checks `snapshot.restaurantId !== expectedRestaurantId` per item. This prevents a tampered Redis payload from mixing items across restaurants.

> **Note:** This scenario cannot be triggered via the public API under normal conditions because `CartService.addItem()` enforces the single-restaurant constraint (BR-2). The attack vector requires direct Redis manipulation (e.g., `redis-cli SET cart:<customerId> '...'` with a tampered payload). The steps below simulate it via Redis CLI.

#### Step 2c.1 — Add a legitimate item to cart

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1
}
```

#### Step 2c.2 — Tamper cart in Redis: inject item from a different restaurant

```powershell
# Connect to Redis CLI
docker exec -it <redis-container-name> redis-cli

# Overwrite the cart with a tampered payload where:
#  - cart.restaurantId = "fe8b2648-..." (Sunset Bistro)
#  - but one item's menuItemId belongs to Classic Burger (restaurant 2)
SET cart:11111111-1111-4111-8111-111111111111 '{
  "cartId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "customerId": "11111111-1111-4111-8111-111111111111",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "items": [
    {
      "menuItemId": "c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6",
      "itemName": "Classic Burger",
      "unitPrice": 10.00,
      "quantity": 1
    }
  ],
  "createdAt": "2026-01-01T00:00:00.000Z"
}'
```

#### Step 2c.3 — Attempt checkout

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "deliveryAddress": { "street": "99 Ly Tu Trong", "district": "D1", "city": "HCMC" },
  "paymentMethod": "cod"
}
```

**Expected 422 Unprocessable Entity:**
```json
{
  "statusCode": 422,
  "message": "Menu item \"Classic Burger\" does not belong to the selected restaurant. Cart integrity violation — please clear your cart and try again."
}
```

**Explanation:** The `ordering_menu_item_snapshots` row for `c3d4e5f6-...` (Classic Burger) has `restaurantId` pointing to restaurant 2, not `fe8b2648-...`. The C-2 fix detects this mismatch and throws before any DB writes occur.

---

### Scenario 3 — Duplicate Checkout (Same CartId, D5-B)

**Goal:** D5-B — DB `UNIQUE(cart_id)` prevents a second order from the same cart,
even if the Redis lock is bypassed (e.g., lock expired due to prolonged latency).

This scenario is hard to trigger manually because the lock protects it. Here we verify
the DB constraint is in place.

#### Verify DB constraint exists

```sql
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'orders'::regclass
  AND conname = 'orders_cart_id_unique';

-- Expected: 1 row — UNIQUE constraint present
```

#### Manual constraint test (direct SQL)

```sql
-- After placing an order in Scenario 1, note the cart_id from orders:
SELECT cart_id FROM orders ORDER BY created_at DESC LIMIT 1;

-- Attempt to insert a second order with the same cart_id:
INSERT INTO orders (id, customer_id, restaurant_id, restaurant_name, cart_id,
                    status, total_amount, payment_method, delivery_address)
VALUES (
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  'fe8b2648-2260-4bc5-9acd-d88972148c78',
  'Sunset Bistro',
  '<cart_id from above>',   -- same cart_id
  'pending', 10.0, 'cod',
  '{"street":"x","district":"y","city":"z"}'::jsonb
);

-- Expected: ERROR 23505 unique_violation (orders_cart_id_unique)
```

**Explanation:** Even if two requests somehow both reach the DB transaction step, only one succeeds. The second receives a 409 Conflict from the handler's error catch clause.

---

### Scenario 4 — Item Unavailable

**Goal:** Reject checkout when a menu item in the cart has `status != 'available'`.

#### Step 4.1 — Mark Margherita Pizza as out_of_stock

```http
PATCH http://localhost:3000/api/restaurants/fe8b2648-2260-4bc5-9acd-d88972148c78/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/sold-out
x-test-user-id: 11111111-1111-4111-8111-111111111111
```

This triggers `MenuItemUpdatedEvent` → `MenuItemProjector` → updates `ordering_menu_item_snapshots.status = 'out_of_stock'`.

#### Step 4.2 — Add the out-of-stock item to cart

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1
}
```

(Cart service does not re-validate availability; that check is at checkout time.)

#### Step 4.3 — Attempt checkout

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "deliveryAddress": { "street": "10 Nguyen Trai", "district": "D5", "city": "HCMC" },
  "paymentMethod": "cod"
}
```

**Expected 422 Unprocessable Entity:**
```json
{
  "statusCode": 422,
  "message": "Menu item \"Margherita Pizza\" is currently out of stock. Please remove it from your cart and try again."
}
```

**Explanation:** `PlaceOrderHandler.assertAllItemsAreAvailable()` reads `ordering_menu_item_snapshots` and finds `status = 'out_of_stock'`. No DB writes occurred.

#### Cleanup

```http
PATCH http://localhost:3000/api/restaurants/fe8b2648-2260-4bc5-9acd-d88972148c78/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/sold-out
x-test-user-id: 11111111-1111-4111-8111-111111111111
```

(Toggles back to available.)

---

### Scenario 5 — Restaurant Closed

**Goal:** Reject checkout when the restaurant's snapshot has `isOpen = false`.

The seed already includes **Closed Kitchen** (`cccccccc-cccc-4ccc-8ccc-cccccccccccc`) which is closed.

#### Step 5.1 — Add a Closed Kitchen item to cart (using customer 2 for isolation)

First, you need a snapshot for Closed Kitchen. If the seed doesn't auto-populate it,
manually upsert via the ACL endpoint, or trigger via the restaurant API.

Alternatively, close Sunset Bistro temporarily:

```http
POST http://localhost:3000/api/restaurants/fe8b2648-2260-4bc5-9acd-d88972148c78/close
x-test-user-id: 11111111-1111-4111-8111-111111111111
```

#### Step 5.2 — Add Sunset Bistro item to cart

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1
}
```

#### Step 5.3 — Attempt checkout

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "deliveryAddress": { "street": "7 Hoang Dieu", "district": "D4", "city": "HCMC" },
  "paymentMethod": "cod"
}
```

**Expected 422 Unprocessable Entity:**
```json
{
  "statusCode": 422,
  "message": "Restaurant \"Sunset Bistro\" is currently closed. Please try again later."
}
```

**Explanation:** `assertRestaurantIsAcceptingOrders()` reads `ordering_restaurant_snapshots.isOpen = false` and throws before any DB write.

#### Cleanup (reopen)

```http
POST http://localhost:3000/api/restaurants/fe8b2648-2260-4bc5-9acd-d88972148c78/open
x-test-user-id: 11111111-1111-4111-8111-111111111111
```

---

### Scenario 6 — Empty Cart

**Goal:** Reject checkout when the cart is empty (or does not exist).

#### Step 6.1 — Ensure cart is empty (or skip if already cleared)

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 11111111-1111-4111-8111-111111111111
```

#### Step 6.2 — Attempt checkout

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "deliveryAddress": { "street": "1 Ben Nghe", "district": "D1", "city": "HCMC" },
  "paymentMethod": "cod"
}
```

**Expected 400 Bad Request:**
```json
{
  "statusCode": 400,
  "message": "No active cart found for customer 11111111-1111-4111-8111-111111111111. Add items before checking out."
}
```

**Explanation:** `assertCartIsValid()` returns 400 immediately. No ACL reads or DB writes.

---

### Scenario 7 — Snapshot Price Divergence (Price Changed After Add-to-Cart)

**Goal:** Confirm that the ACL snapshot price (not the cart price) is used for `order_items`.

This tests the immutability guarantee: if the restaurant changes a price after the
customer added it to cart, the checkout uses the **current ACL snapshot price**.

#### Step 7.1 — Note the current ACL snapshot price

```http
GET http://localhost:3000/api/ordering/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081
```

Note: `price: 12.50` (from seed).

#### Step 7.2 — Add item to cart at the old price

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 2
}
```

#### Step 7.3 — Update the menu item price (simulates restaurant raising price)

```http
PATCH http://localhost:3000/api/restaurants/fe8b2648-2260-4bc5-9acd-d88972148c78/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{ "price": 15.00 }
```

This triggers `MenuItemUpdatedEvent` → ACL snapshot price becomes `15.00`.

#### Step 7.4 — Checkout

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "deliveryAddress": { "street": "88 Vo Thi Sau", "district": "D3", "city": "HCMC" },
  "paymentMethod": "cod"
}
```

**Expected 201:** `totalAmount = 30.00` (15.00 × 2 — ACL snapshot price, NOT cart price 12.50 × 2).

#### Verify

```sql
SELECT unit_price, quantity, subtotal
FROM order_items
WHERE order_id = '<orderId>';

-- Expected: unit_price=15.00, quantity=2, subtotal=30.00
```

**Explanation:** `buildOrderItemsFromSnapshots()` explicitly reads `snapshot.price` and ignores `cartItem.unitPrice`. The cart price is informational only at checkout time.

---

### Scenario 8 — Redis Failure (Graceful Error)

**Goal:** Verify that a Redis connection failure results in a clean 500 error, not a data-corrupt state.

> **Note:** This scenario requires temporarily stopping Redis.

```powershell
# Stop Redis (from docker-compose)
docker compose stop redis
```

#### Step 8.1 — Attempt checkout (Redis down)

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "deliveryAddress": { "street": "1 Le Thanh Ton", "district": "D1", "city": "HCMC" },
  "paymentMethod": "cod"
}
```

**Expected 500 or 503:** The cart load step (`cartRepo.findByCustomerId`) throws a Redis connection error, which propagates up as an unhandled exception → NestJS global exception filter returns 500.

**No DB writes** occur because the handler fails before reaching the transaction step.

```powershell
# Restart Redis
docker compose start redis
```

**Explanation:** The cart lock acquisition (`redis.setNx`) is the first Redis call. If Redis is down, it throws before any DB writes. If Redis goes down after lock acquisition but before cart load, the `finally` block's `redis.del(lockKey)` also fails — but this is acceptable because the lock TTL is 30s and will self-expire.

---

### Scenario 9 — DB Failure (Transaction Rollback)

**Goal:** Verify that a DB failure during transaction does not leave partial data.

> **Note:** This is validated by design — Drizzle's `.transaction()` automatically rolls back on exception.

#### Verify atomicity with a SQL test

```sql
-- Start a transaction and deliberately fail it:
BEGIN;
INSERT INTO orders (id, customer_id, restaurant_id, restaurant_name, cart_id,
                    status, total_amount, payment_method, delivery_address)
VALUES (gen_random_uuid(), '11111111-1111-4111-8111-111111111111',
        'fe8b2648-2260-4bc5-9acd-d88972148c78', 'Sunset Bistro',
        gen_random_uuid(), 'pending', 10.0, 'cod',
        '{"street":"x","district":"y","city":"z"}'::jsonb)
RETURNING id;

-- Note the order id above, then fail the transaction
ROLLBACK;

-- Verify the order does NOT exist
SELECT id FROM orders WHERE customer_id = '11111111-1111-4111-8111-111111111111'
ORDER BY created_at DESC LIMIT 1;
-- Expected: 0 rows from the rolled-back insert
```

**Explanation:** Drizzle wraps all inserts inside `db.transaction(async (tx) => { ... })`. Any error in `order_items` or `order_status_logs` inserts causes an automatic `ROLLBACK`, leaving the DB in a clean state. The handler catches the DB error and re-throws as 500.

---

### Scenario 10 — Concurrency (Two Simultaneous Checkouts)

**Goal:** Confirm that only one order is created when two requests arrive simultaneously for the same cart.

**Protection layers:**
1. **Layer 1 — Redis SET NX lock:** The first request acquires `cart:<customerId>:lock`; the second gets `lockAcquired = false` → **immediately returns 409** before any DB work.
2. **Layer 2 — DB UNIQUE(cartId):** If both requests somehow pass the lock (e.g., lock expired mid-flight), only one DB transaction commits; the second fails with a `23505` constraint error → **409 Conflict**.

#### Manual simulation (sequential — represents near-simultaneous requests)

```http
# Request A — first checkout
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "deliveryAddress": { "street": "2 Dinh Tien Hoang", "district": "D1", "city": "HCMC" },
  "paymentMethod": "cod"
}
# Expected: 201 Created — order placed
```

```http
# Request B — immediate retry (cart already cleared by Request A)
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "deliveryAddress": { "street": "2 Dinh Tien Hoang", "district": "D1", "city": "HCMC" },
  "paymentMethod": "cod"
}
# Expected: 400 Bad Request — cart is empty (cleared after Request A succeeded)
```

#### For true concurrent test (PowerShell)

```powershell
# Populate cart first
Invoke-RestMethod -Method POST `
  -Uri "http://localhost:3000/api/carts/my/items" `
  -Headers @{ "Content-Type"="application/json"; "x-test-user-id"="11111111-1111-4111-8111-111111111111" } `
  -Body '{"menuItemId":"4dc7cdfa-5a54-402f-b1a8-2d47de146081","restaurantId":"fe8b2648-2260-4bc5-9acd-d88972148c78","restaurantName":"Sunset Bistro","itemName":"Margherita Pizza","unitPrice":12.50,"quantity":1}'

$body = '{"deliveryAddress":{"street":"2 Dinh","district":"D1","city":"HCMC"},"paymentMethod":"cod"}'
$headers = @{ "Content-Type"="application/json"; "x-test-user-id"="11111111-1111-4111-8111-111111111111" }

# Fire two requests concurrently
$job1 = Start-Job { Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/carts/my/checkout" -Headers $using:headers -Body $using:body }
$job2 = Start-Job { Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/carts/my/checkout" -Headers $using:headers -Body $using:body }

$r1 = Receive-Job -Job $job1 -Wait
$r2 = Receive-Job -Job $job2 -Wait

Write-Host "Request 1: $($r1 | ConvertTo-Json)"
Write-Host "Request 2: $($r2 | ConvertTo-Json)"
```

**Expected:** One request returns 201 with an `orderId`; the other returns 409 ("checkout in progress") or 400 (cart empty).

#### Verify

```sql
SELECT COUNT(*) FROM orders WHERE customer_id = '11111111-1111-4111-8111-111111111111';
-- Expected: 1 (not 2)
```

**Explanation:**
- Redis lock (30s TTL) ensures only one checkout runs at a time per customer.
- The lock is released in a `finally` block so it is always cleaned up, even on error.
- If the lock somehow expires mid-execution (> 30s), the DB `UNIQUE(cartId)` is the fallback.

---

## Idempotency Key Redis Inspection

To verify the idempotency key was stored in Redis after a successful checkout:

> **M-3 fix note:** `IDEMPOTENCY_TTL_FALLBACK_SECONDS` was corrected from `86400` (24 h) to `300` (5 min). When the `app_settings` table is seeded (Phase 1), the runtime TTL comes from `ORDER_IDEMPOTENCY_TTL_SECONDS = 300`. The fallback constant matches this value. Keys expire 5 minutes after the order is placed.

> **M-2 fix note:** Only UUID-format keys (hex + hyphens, 8–64 chars) are accepted. Replace the example below with the actual key used in your test.

```powershell
# Connect to Redis CLI
docker exec -it <redis-container-name> redis-cli

# Look up the key used in Scenario 2 (replace with your actual key)
GET "idempotency:order:a1b2c3d4-e5f6-4a7b-8c9d-000000000001"
# Expected: "<orderId UUID>"

# Check the TTL (should be <= ORDER_IDEMPOTENCY_TTL_SECONDS = 300 — 5 min window)
TTL "idempotency:order:a1b2c3d4-e5f6-4a7b-8c9d-000000000001"
# Expected: some value in [0, 300]
```

---

## DB State After All Scenarios

After running all scenarios with resets in between:

```sql
-- Check orders table
SELECT id, customer_id, status, total_amount, payment_method, cart_id, created_at
FROM orders
ORDER BY created_at DESC;

-- Check order_items for each order
SELECT o.id as order_id, oi.item_name, oi.unit_price, oi.quantity, oi.subtotal
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
ORDER BY o.created_at DESC;

-- Check status logs (should have 1 log per order: NULL → PENDING)
SELECT o.id as order_id, sl.from_status, sl.to_status, sl.triggered_by_role
FROM orders o
JOIN order_status_logs sl ON sl.order_id = o.id
ORDER BY o.created_at DESC;
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `422` "Missing ACL snapshot" | Snapshots not populated | Run `pnpm seed`, or trigger a create/update on the restaurant/menu item via the catalog API |
| `409` "checkout in progress" | Lock from a failed previous request | Wait 30s for lock TTL to expire, or manually `DEL cart:<customerId>:lock` in Redis CLI |
| `500` on checkout | Redis or DB down | Check `docker compose ps`; ensure both are running |
| Total amount is wrong | ACL snapshot price diverged from cart price | Expected behaviour — snapshot price wins. See Scenario 7. |
| Cart not cleared after order | Redis error during cleanup | Check server logs; cart cleanup failure does not roll back the DB transaction (C-1 fix: idempotency key is saved before cleanup, so retries are safe) |
| `400` "X-Idempotency-Key must be a UUID string" | Key contains non-hex chars (e.g. `test-key`) | Use a standard UUID v4 string like `550e8400-e29b-41d4-a716-446655440000` (M-2 fix) |
| `422` "Cart integrity violation" | Redis payload tampered; item belongs to different restaurant | Clear cart (`DELETE /carts/my`) and re-add items normally (C-2 fix) |
| Idempotency key expires unexpectedly fast | `IDEMPOTENCY_TTL_FALLBACK_SECONDS` was wrong | Fixed (M-3): fallback is now 300s (5 min); runtime TTL from `app_settings.ORDER_IDEMPOTENCY_TTL_SECONDS` |

---

## Phase 4 Architecture Notes

### Why Two Idempotency Guards?

| Guard | Layer | Protection |
|-------|-------|-----------|
| `X-Idempotency-Key` (D5-A) | Redis | Fast path for retried network requests; returns cached orderId immediately |
| `UNIQUE(cart_id)` (D5-B) | PostgreSQL | Hard constraint; catches races that slip past the Redis lock |

Both guards are necessary because Redis is eventually consistent and can be bypassed by network partitions, while the DB constraint is always authoritative.

### Why Cart Lock + Both Idempotency Guards?

```
Request A ───► lock acquired ──► validate ──► DB txn ──► cart cleared ──► lock released
Request B ───► lock BLOCKED (returns 409) ─────────────────────────────────►
Request C ──────────────────────────────────────────────────────► cart gone (400)
```

The Redis lock is the first line of defence for concurrent checkouts. It prevents wasted DB work, not just duplicate orders.
