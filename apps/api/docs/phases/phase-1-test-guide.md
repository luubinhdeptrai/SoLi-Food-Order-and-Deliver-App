# Phase 1 — Domain Schema: Test & Verification Guide

**Phase:** 1 — Domain Schema  
**Status:** Implemented  
**Prerequisite:** Phase 0 infrastructure running (Docker Compose up, `.env` configured)

---

## 1. Prerequisites

```bash
# Start infrastructure
docker compose up -d

# Confirm DB is reachable
pnpm --filter api db:push
```

Expected output — no errors, Drizzle reports:

```
[✓] Changes applied
```

---

## 2. Tables Created

Verify all Phase 1 tables exist in PostgreSQL:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'orders',
    'order_items',
    'order_status_logs',
    'ordering_menu_item_snapshots',
    'ordering_restaurant_snapshots',
    'app_settings'
  )
ORDER BY table_name;
```

**Expected result (6 rows):**

| table_name                     |
|-------------------------------|
| app_settings                  |
| order_items                   |
| order_status_logs             |
| ordering_menu_item_snapshots  |
| ordering_restaurant_snapshots |
| orders                        |

---

## 3. Enum Types Created

```sql
SELECT typname
FROM pg_type
WHERE typname IN (
  'order_status',
  'order_payment_method',
  'order_triggered_by_role',
  'ordering_menu_item_status'
)
ORDER BY typname;
```

**Expected result (4 rows):**

| typname                    |
|---------------------------|
| order_payment_method      |
| order_status              |
| order_triggered_by_role   |
| ordering_menu_item_status |

---

## 4. Constraints Verification

### 4.1 orders.cart_id UNIQUE constraint

```sql
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'orders'
  AND constraint_type = 'UNIQUE';
```

**Expected:** One row with `orders_cart_id_unique` (or similar).

### 4.2 order_items.order_id FK → orders.id

```sql
SELECT
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name  AS referenced_table,
  ccu.column_name AS referenced_column,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.table_name IN ('order_items', 'order_status_logs')
  AND tc.constraint_type = 'FOREIGN KEY';
```

**Expected:** 2 rows — one for `order_items → orders` and one for
`order_status_logs → orders`, both with `DELETE RULE = CASCADE`.

---

## 5. Insert Test: Happy Path

### 5.1 Insert an order

```sql
INSERT INTO orders (
  id, customer_id, restaurant_id, restaurant_name,
  cart_id, status, total_amount, payment_method,
  delivery_address, expires_at
)
VALUES (
  gen_random_uuid(),
  gen_random_uuid(),   -- customer (cross-context UUID, no FK)
  gen_random_uuid(),   -- restaurant (cross-context UUID, no FK)
  'Test Restaurant',
  gen_random_uuid(),   -- cart ID
  'pending',
  125000,
  'cod',
  '{"street":"123 Nguyen Hue","district":"District 1","city":"Ho Chi Minh City"}'::jsonb,
  NOW() + INTERVAL '10 minutes'
)
RETURNING id, status, payment_method, total_amount;
```

**Expected:** 1 row returned with the values above.

### 5.2 Insert order items

```sql
-- Replace <order_id> with the ID returned above
INSERT INTO order_items (id, order_id, menu_item_id, item_name, unit_price, quantity, subtotal)
VALUES
  (gen_random_uuid(), '<order_id>', gen_random_uuid(), 'Phở Bò', 75000, 1, 75000),
  (gen_random_uuid(), '<order_id>', gen_random_uuid(), 'Cơm Tấm', 50000, 1, 50000)
RETURNING id, item_name, unit_price, subtotal;
```

**Expected:** 2 rows returned.

### 5.3 Insert initial status log (null → PENDING)

```sql
INSERT INTO order_status_logs (
  id, order_id, from_status, to_status,
  triggered_by, triggered_by_role
)
VALUES (
  gen_random_uuid(),
  '<order_id>',
  NULL,              -- no prior state at creation
  'pending',
  gen_random_uuid(), -- customer UUID
  'customer'
)
RETURNING id, from_status, to_status, triggered_by_role;
```

**Expected:** 1 row; `from_status = NULL`, `to_status = pending`.

---

## 6. Constraint Test: Duplicate cartId

```sql
-- Should FAIL with unique constraint violation
INSERT INTO orders (
  id, customer_id, restaurant_id, restaurant_name,
  cart_id, status, total_amount, payment_method, delivery_address
)
VALUES (
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'Another Restaurant',
  '<same_cart_id_from_5.1>',  -- reuse the cart_id from 5.1
  'pending',
  50000,
  'cod',
  '{"street":"456 Le Loi","district":"District 3","city":"Ho Chi Minh City"}'::jsonb
);
```

**Expected error:** `ERROR: duplicate key value violates unique constraint "orders_cart_id_unique"`

---

## 7. Snapshot Tables

### 7.1 Menu item snapshot

```sql
INSERT INTO ordering_menu_item_snapshots
  (menu_item_id, restaurant_id, name, price, status)
VALUES
  (gen_random_uuid(), gen_random_uuid(), 'Phở Bò Đặc Biệt', 85000, 'available')
RETURNING *;
```

**Expected:** 1 row with `status = available`, `last_synced_at` set to now.

### 7.2 Restaurant snapshot (including nullable extension fields)

```sql
INSERT INTO ordering_restaurant_snapshots
  (restaurant_id, name, is_open, is_approved, address, delivery_radius_km, latitude, longitude)
VALUES
  (
    gen_random_uuid(),
    'Phở Hà Nội',
    true,
    true,
    '10 Phan Đình Phùng, Ba Đình, Hà Nội',
    5.0,       -- delivery_radius_km (nullable — upstream pending)
    21.0285,   -- latitude
    105.8542   -- longitude
  )
RETURNING *;
```

**Expected:** 1 row with all fields populated.

---

## 8. Seed: app_settings

Run the seed script to insert default runtime settings:

```bash
cd apps/api
npx ts-node -r tsconfig-paths/register src/drizzle/seeds/app-settings.seed.ts
```

Then verify:

```sql
SELECT key, value, description
FROM app_settings
ORDER BY key;
```

**Expected (3 rows):**

| key                                | value |
|------------------------------------|-------|
| CART_ABANDONED_TTL_SECONDS         | 86400 |
| ORDER_IDEMPOTENCY_TTL_SECONDS      | 300   |
| RESTAURANT_ACCEPT_TIMEOUT_SECONDS  | 600   |

**Re-running the seed must be idempotent** — no duplicate key errors (uses `onConflictDoNothing`).

---

## 9. Column Schema Summary

| Table                           | Notable Columns                                             |
|---------------------------------|-------------------------------------------------------------|
| `orders`                        | `cart_id UNIQUE`, `delivery_address JSONB`, `expires_at TIMESTAMPTZ`, `payment_url TEXT nullable` |
| `order_items`                   | FK → orders (CASCADE), `menu_item_id` no FK (snapshot)     |
| `order_status_logs`             | `from_status` nullable, FK → orders (CASCADE)              |
| `ordering_menu_item_snapshots`  | `menu_item_id` PK no FK, `status` using BC-local enum      |
| `ordering_restaurant_snapshots` | `delivery_radius_km` nullable (upstream missing — see docs) |
| `app_settings`                  | `key` PK TEXT, `value` TEXT, runtime-mutable               |

---

## 10. Clean-up (after testing)

```sql
DELETE FROM order_status_logs;
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM ordering_menu_item_snapshots;
DELETE FROM ordering_restaurant_snapshots;
-- Keep app_settings rows — they are production seed data
```

---

## 11. Phase 2 Readiness Checklist

- [ ] `orders` table accessible by `OrderRepository`
- [ ] `ordering_menu_item_snapshots` accessible by `MenuItemProjector` (Phase 3)
- [ ] `ordering_restaurant_snapshots` accessible by `RestaurantSnapshotProjector` (Phase 3)
- [ ] `app_settings` seeded and readable by `AppSettingsService` (Phase 4)
- [ ] No TypeScript compile errors in schema files: `pnpm --filter api build`
