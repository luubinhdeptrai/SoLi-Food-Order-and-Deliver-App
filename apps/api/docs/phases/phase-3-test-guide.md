# Phase 3 Test Guide — ACL Layer (Anti-Corruption Layer)

**Phase:** 3  
**Date:** 2025  
**Status:** Implemented  
**Pre-requisites:** Phase 0, 1, and 2 complete; DB seeded (`pnpm seed`)

---

## Overview

Phase 3 implements the Anti-Corruption Layer (ACL) of the Ordering bounded context:

| Component | File |
|-----------|------|
| `MenuItemProjector` | `src/module/ordering/acl/projections/menu-item.projector.ts` |
| `RestaurantSnapshotProjector` | `src/module/ordering/acl/projections/restaurant-snapshot.projector.ts` |
| `MenuItemSnapshotRepository` | `src/module/ordering/acl/repositories/menu-item-snapshot.repository.ts` |
| `RestaurantSnapshotRepository` | `src/module/ordering/acl/repositories/restaurant-snapshot.repository.ts` |
| `AclService` | `src/module/ordering/acl/acl.service.ts` | <!-- [ADDED] -->
| `AclController` | `src/module/ordering/acl/acl.controller.ts` |
| DTOs | `src/module/ordering/acl/dto/acl.dto.ts` | <!-- [ADDED] -->
| `AclModule` | `src/module/ordering/acl/acl.module.ts` |

**How it works:**
1. `RestaurantService` publishes `RestaurantUpdatedEvent` after any create/update/delete.
2. `MenuService` publishes `MenuItemUpdatedEvent` after any create/update/delete.
3. `RestaurantSnapshotProjector` handles `RestaurantUpdatedEvent` → upserts `ordering_restaurant_snapshots`.
4. `MenuItemProjector` handles `MenuItemUpdatedEvent` → upserts `ordering_menu_item_snapshots`.
5. `AclController` exposes four read-only endpoints (no auth required): <!-- [UPDATED] -->

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ordering/menu-items/:id` | Single menu item snapshot by UUID |
| `GET` | `/api/ordering/menu-items?ids=id1,id2` | Bulk — missing IDs silently omitted |
| `GET` | `/api/ordering/restaurants/:id` | Single restaurant snapshot by UUID |
| `GET` | `/api/ordering/restaurants?ids=id1,id2` | Bulk — missing IDs silently omitted |

---

## Environment Setup

```bash
# Start services
docker compose up -d   # PostgreSQL + Redis

# From apps/api/
pnpm seed              # Clear + reseed all tables
pnpm start:dev         # Start API server (port 3000)
```

**Seeded IDs** (from `seed.ts`):

| Name | ID |
|------|----|
| Sunset Bistro (restaurant1, open+approved) | `fe8b2648-2260-4bc5-9acd-d88972148c78` |
| Closed Kitchen (restaurant2, closed) | `cccccccc-cccc-4ccc-8ccc-cccccccccccc` |
| Margherita Pizza (menu item 1, R1) | `4dc7cdfa-5a54-402f-b1a8-2d47de146081` |
| Caesar Salad (menu item 2, R1) | `a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5` |
| Tiramisu (menu item 3, R1) | `b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6` |
| Classic Burger (menu item 4, R2) | `c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6` |

> No auth headers required for the ACL snapshot endpoints — they have no guards.
> The setup steps (POST/PATCH/DELETE on restaurants and menu items) require `x-test-user-id` because those controllers use `JwtAuthGuard` with the test middleware active.

---

## Test Scenarios

### T1 — Verify seed populated snapshots correctly

After `pnpm seed`, verify both snapshot tables are populated:

```http
GET http://localhost:3000/api/ordering/restaurants/fe8b2648-2260-4bc5-9acd-d88972148c78
```

**Expected 200:**
```json
{
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "name": "Sunset Bistro",
  "isOpen": true,
  "isApproved": true,
  "address": "123 Main St, District 1, Ho Chi Minh City",
  "deliveryRadiusKm": null,
  "latitude": 10.762622,
  "longitude": 106.660172,
  "lastSyncedAt": "<timestamp>"
}
```

```http
GET http://localhost:3000/api/ordering/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081
```

**Expected 200:**
```json
{
  "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "name": "Margherita Pizza",
  "price": 12.5,
  "status": "available",
  "lastSyncedAt": "<timestamp>"
}
```

---

### T2 — RestaurantUpdatedEvent triggers snapshot upsert (create path)

Create a new restaurant and verify a snapshot is automatically created:

```http
POST http://localhost:3000/api/restaurants
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "name": "Test Restaurant ACL",
  "address": "789 Test Ave, District 7, HCMC",
  "phone": "+84-28-0000-0001",
  "description": "Created to test Phase 3 ACL projection"
}
```

Copy the `id` from the response, then:

```http
GET http://localhost:3000/api/ordering/restaurants/<new-restaurant-id>
```

**Expected 200:** Snapshot matches the newly created restaurant (isOpen=false, isApproved=false).

---

### T3 — RestaurantUpdatedEvent upserts on update (idempotency)

Update the restaurant name from T2:

```http
PATCH http://localhost:3000/api/restaurants/<new-restaurant-id>
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "name": "Test Restaurant ACL — Updated"
}
```

```http
GET http://localhost:3000/api/ordering/restaurants/<new-restaurant-id>
```

**Expected 200:** Snapshot `name` reflects the updated value. `lastSyncedAt` is newer than T2.

---

### T4 — MenuItemUpdatedEvent triggers snapshot upsert (create path)

Create a new menu item and verify a snapshot is created:

```http
POST http://localhost:3000/api/menu-items
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "name": "Garlic Bread",
  "price": 4.5,
  "category": "breads",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78"
}
```

Copy the `id` from the response:

```http
GET http://localhost:3000/api/ordering/menu-items/<new-item-id>
```

**Expected 200:** Snapshot `name=Garlic Bread`, `price=4.5`, `status=available`.

---

### T5 — MenuItemUpdatedEvent upserts on update (price change)

Update the menu item price from T4:

```http
PATCH http://localhost:3000/api/menu-items/<new-item-id>
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "price": 5.0
}
```

```http
GET http://localhost:3000/api/ordering/menu-items/<new-item-id>
```

**Expected 200:** Snapshot `price` is `5.0`. `lastSyncedAt` is updated.

---

### T6 — toggleSoldOut publishes event and updates snapshot status

```http
POST http://localhost:3000/api/menu-items/<new-item-id>/toggle-sold-out
x-test-user-id: 11111111-1111-4111-8111-111111111111
```

```http
GET http://localhost:3000/api/ordering/menu-items/<new-item-id>
```

**Expected 200:** Snapshot `status` is `out_of_stock`.

Toggle again:

```http
POST http://localhost:3000/api/menu-items/<new-item-id>/toggle-sold-out
x-test-user-id: 11111111-1111-4111-8111-111111111111
```

**Expected 200:** Snapshot `status` is back to `available`.

---

### T7 — Delete menu item marks snapshot as unavailable

```http
DELETE http://localhost:3000/api/menu-items/<new-item-id>
x-test-user-id: 11111111-1111-4111-8111-111111111111
```

```http
GET http://localhost:3000/api/ordering/menu-items/<new-item-id>
```

**Expected 200:** Snapshot `status` is `unavailable` (the upstream item is gone but the snapshot remains as a tombstone for order history).

---

### T8 — Delete restaurant marks snapshot as closed + unapproved

> **Background:** `RestaurantService.remove()` now publishes `RestaurantUpdatedEvent` with
> `isOpen=false, isApproved=false` before deleting the row. The projector upserts those values
> into `ordering_restaurant_snapshots`, so Phase 4 checkout will reject any order placed
> against the deleted restaurant.

**Step 1 — Create a throwaway restaurant:**

```http
POST http://localhost:3000/api/restaurants
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "name": "Restaurant To Delete",
  "address": "999 Delete Ave, District 9, HCMC",
  "phone": "+84-28-0000-0099",
  "description": "Will be deleted in T8"
}
```

Copy the `id` from the response as `<delete-id>`.

**Step 2 — Verify snapshot was created (isOpen=false, isApproved=false by default):**

```http
GET http://localhost:3000/api/ordering/restaurants/<delete-id>
```

**Expected 200:**
```json
{
  "restaurantId": "<delete-id>",
  "name": "Restaurant To Delete",
  "isOpen": false,
  "isApproved": false,
  "address": "999 Delete Ave, District 9, HCMC",
  "deliveryRadiusKm": null,
  "latitude": null,
  "longitude": null,
  "lastSyncedAt": "<timestamp>"
}
```

**Step 3 — Approve and open the restaurant so the snapshot has `isOpen=true, isApproved=true` before deletion:**

```http
PATCH http://localhost:3000/api/restaurants/<delete-id>
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "isOpen": true,
  "isApproved": true
}
```

Confirm snapshot updated:

```http
GET http://localhost:3000/api/ordering/restaurants/<delete-id>
```

**Expected 200:** `isOpen=true`, `isApproved=true`.

**Step 4 — Delete the restaurant:**

```http
DELETE http://localhost:3000/api/restaurants/<delete-id>
x-test-user-id: 11111111-1111-4111-8111-111111111111
```

**Expected 204 No Content.**

**Step 5 — Verify the snapshot was invalidated (NOT deleted — tombstoned):**

```http
GET http://localhost:3000/api/ordering/restaurants/<delete-id>
```

**Expected 200:**
```json
{
  "restaurantId": "<delete-id>",
  "name": "Restaurant To Delete",
  "isOpen": false,
  "isApproved": false,
  "address": "999 Delete Ave, District 9, HCMC",
  "deliveryRadiusKm": null,
  "latitude": null,
  "longitude": null,
  "lastSyncedAt": "<timestamp newer than Step 3>"
}
```

> ⚠️ The snapshot row **must still exist** (the projector upserts, never deletes).
> `isOpen` and `isApproved` must both be `false`. `lastSyncedAt` must be newer than Step 3.

**DB verification:**

```sql
-- Row must exist with both flags false
SELECT restaurant_id, name, is_open, is_approved, last_synced_at
FROM ordering_restaurant_snapshots
WHERE restaurant_id = '<delete-id>';
-- Expected: 1 row, is_open=false, is_approved=false

-- Source restaurant must be gone
SELECT id FROM restaurants WHERE id = '<delete-id>';
-- Expected: 0 rows
```

**What this test guards against:**
- If the event were missing, the snapshot would still show `isOpen=true, isApproved=true`.
- Phase 4 `PlaceOrderHandler` queries `ordering_restaurant_snapshots` — it would then allow
  a checkout against a non-existent restaurant, creating an order with no fulfilment path.

---

### T9 — 404 for non-existent snapshot + 400 for malformed UUID [UPDATED]

**Case A — valid UUID format, no matching row → 404:**

```http
GET http://localhost:3000/api/ordering/menu-items/00000000-0000-4000-8000-000000000000
```

**Expected 404:**
```json
{
  "statusCode": 404,
  "message": "Menu item snapshot not found: 00000000-0000-4000-8000-000000000000",
  "error": "Not Found"
}
```

```http
GET http://localhost:3000/api/ordering/restaurants/00000000-0000-4000-8000-000000000000
```

**Expected 404:**
```json
{
  "statusCode": 404,
  "message": "Restaurant snapshot not found: 00000000-0000-4000-8000-000000000000",
  "error": "Not Found"
}
```

**Case B — malformed UUID (not a valid UUID format) → 400:** [ADDED]

> `ParseUUIDPipe` rejects the request before it reaches the service. This is a 400, NOT a 404.

```http
GET http://localhost:3000/api/ordering/menu-items/not-a-uuid
```

**Expected 400:**
```json
{
  "statusCode": 400,
  "message": "Validation failed (uuid is expected)",
  "error": "Bad Request"
}
```

```http
GET http://localhost:3000/api/ordering/restaurants/not-a-uuid
```

**Expected 400** (same shape).

---

### T10 — Snapshot idempotency (replay same update twice)

Send the same update twice in a row:

```http
PATCH http://localhost:3000/api/restaurants/fe8b2648-2260-4bc5-9acd-d88972148c78
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "name": "Sunset Bistro"
}
```

Send again immediately.

```http
GET http://localhost:3000/api/ordering/restaurants/fe8b2648-2260-4bc5-9acd-d88972148c78
```

**Expected:** No duplicate rows, no 500 error. Snapshot `name` is `Sunset Bistro`. Only one row exists in the DB.

**DB verification:**
```sql
SELECT COUNT(*) FROM ordering_restaurant_snapshots
WHERE restaurant_id = 'fe8b2648-2260-4bc5-9acd-d88972148c78';
-- Expected: 1
```

---

### T11 — Seeded closed restaurant snapshot is correct

```http
GET http://localhost:3000/api/ordering/restaurants/cccccccc-cccc-4ccc-8ccc-cccccccccccc
```

**Expected 200:**
```json
{
  "restaurantId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "name": "Closed Kitchen",
  "isOpen": false,
  "isApproved": true,
  "address": "456 Side St, District 3, Ho Chi Minh City",
  "deliveryRadiusKm": null,
  "latitude": 10.775,
  "longitude": 106.701,
  "lastSyncedAt": "<timestamp>"
}
```

This will be used by Phase 4 `PlaceOrderHandler` to reject checkout (BR-8: restaurant closed).

---

### T12 — Bulk fetch menu item snapshots (`GET /api/ordering/menu-items?ids=...`) [ADDED]

**Case A — all IDs exist:**

```http
GET http://localhost:3000/api/ordering/menu-items?ids=4dc7cdfa-5a54-402f-b1a8-2d47de146081,a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5
```

**Expected 200** — array of 2 snapshots:
```json
[
  {
    "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
    "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
    "name": "Margherita Pizza",
    "price": 12.5,
    "status": "available",
    "lastSyncedAt": "<timestamp>"
  },
  {
    "menuItemId": "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
    "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
    "name": "Caesar Salad",
    "price": "<price>",
    "status": "available",
    "lastSyncedAt": "<timestamp>"
  }
]
```

**Case B — mix of existing and non-existing IDs (missing IDs are silently omitted):**

```http
GET http://localhost:3000/api/ordering/menu-items?ids=4dc7cdfa-5a54-402f-b1a8-2d47de146081,00000000-0000-4000-8000-000000000000
```

**Expected 200** — array of 1 (the unknown ID is absent, no error):
```json
[
  {
    "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
    "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
    "name": "Margherita Pizza",
    "price": 12.5,
    "status": "available",
    "lastSyncedAt": "<timestamp>"
  }
]
```

**Case C — all IDs unknown:**

```http
GET http://localhost:3000/api/ordering/menu-items?ids=00000000-0000-4000-8000-000000000000,11111111-0000-4000-8000-000000000000
```

**Expected 200** — empty array (no 404):
```json
[]
```

**Case D — `?ids=` empty or omitted:**

```http
GET http://localhost:3000/api/ordering/menu-items?ids=
```

**Expected 200** — empty array:
```json
[]
```

> `parseIds('')` filters out empty segments → no DB query is made.

---

### T13 — Bulk fetch restaurant snapshots (`GET /api/ordering/restaurants?ids=...`) [ADDED]

**Case A — all IDs exist:**

```http
GET http://localhost:3000/api/ordering/restaurants?ids=fe8b2648-2260-4bc5-9acd-d88972148c78,cccccccc-cccc-4ccc-8ccc-cccccccccccc
```

**Expected 200** — array of 2 snapshots:
```json
[
  {
    "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
    "name": "Sunset Bistro",
    "isOpen": true,
    "isApproved": true,
    "address": "123 Main St, District 1, Ho Chi Minh City",
    "deliveryRadiusKm": null,
    "latitude": 10.762622,
    "longitude": 106.660172,
    "lastSyncedAt": "<timestamp>"
  },
  {
    "restaurantId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "name": "Closed Kitchen",
    "isOpen": false,
    "isApproved": true,
    "address": "456 Side St, District 3, Ho Chi Minh City",
    "deliveryRadiusKm": null,
    "latitude": 10.775,
    "longitude": 106.701,
    "lastSyncedAt": "<timestamp>"
  }
]
```

**Case B — mix of existing and non-existing (missing silently omitted):**

```http
GET http://localhost:3000/api/ordering/restaurants?ids=fe8b2648-2260-4bc5-9acd-d88972148c78,00000000-0000-4000-8000-000000000000
```

**Expected 200** — array of 1.

**Case C — all IDs unknown → 200 `[]`:**

```http
GET http://localhost:3000/api/ordering/restaurants?ids=00000000-0000-4000-8000-000000000000
```

**Expected 200:**
```json
[]
```

**Case D — `?ids=` empty:**

```http
GET http://localhost:3000/api/ordering/restaurants?ids=
```

**Expected 200 `[]`.**

---

## DB Verification Queries

```sql
-- Count snapshots
SELECT COUNT(*) FROM ordering_restaurant_snapshots;   -- should be ≥ 2
SELECT COUNT(*) FROM ordering_menu_item_snapshots;    -- should be ≥ 4

-- View all restaurant snapshots
SELECT restaurant_id, name, is_open, is_approved, last_synced_at
FROM ordering_restaurant_snapshots
ORDER BY last_synced_at DESC;

-- View all menu item snapshots
SELECT menu_item_id, restaurant_id, name, price, status, last_synced_at
FROM ordering_menu_item_snapshots
ORDER BY last_synced_at DESC;

-- Verify no orphan snapshots (snapshot without source restaurant)
-- NOTE: after T8 there will be 1 orphan (deleted restaurant) — this is expected.
-- The snapshot is kept as a tombstone (isOpen=false, isApproved=false).
SELECT r.restaurant_id, r.name, r.is_open, r.is_approved
FROM ordering_restaurant_snapshots r
LEFT JOIN restaurants src ON src.id = r.restaurant_id
WHERE src.id IS NULL;
-- Before T8: 0 rows
-- After  T8: 1 row  (the deleted restaurant, is_open=false, is_approved=false)

-- T8-specific: confirm tombstone values after delete
SELECT restaurant_id, is_open, is_approved, last_synced_at
FROM ordering_restaurant_snapshots
WHERE restaurant_id = '<delete-id>';
-- Expected: is_open=false, is_approved=false
```

---

## What Phase 3 Enables

Phase 3 fully unblocks the following Phase 4 validations in `PlaceOrderHandler`:

| Business Rule | Source Data |
|--------------|------------|
| BR-8: Restaurant must be open | `ordering_restaurant_snapshots.is_open` |
| BR-8: Restaurant must be approved | `ordering_restaurant_snapshots.is_approved` |
| BR-6: All items must be available | `ordering_menu_item_snapshots.status = 'available'` |
| BR-7: Price freeze at checkout | `ordering_menu_item_snapshots.price` (snapshot value) |
| BR-3: Delivery radius check (Phase 4+) | `ordering_restaurant_snapshots.delivery_radius_km` (nullable until upstream ready) |

---

## Notes

- All projections are **idempotent** — safe to replay events without duplicate rows.
- The `lastSyncedAt` field tracks when each snapshot was last updated.
- `deliveryRadiusKm` is `null` until the upstream `restaurants` table gains a `delivery_radius_km` column (Phase 4 upstream requirement — see `docs/Những yêu cầu cho các BC/restaurant-catalog.md`).
- No auth/guards on any ACL query endpoint (`/api/ordering/menu-items/:id`, `/api/ordering/menu-items?ids=...`, `/api/ordering/restaurants/:id`, `/api/ordering/restaurants?ids=...`) — these are internal diagnostic endpoints. <!-- [UPDATED] -->
- Bulk endpoints (`?ids=`) silently omit IDs with no matching snapshot row. They never return 404 — an all-unknown set returns `200 []`.
- `ParseUUIDPipe` on the `/:id` routes means a malformed (non-UUID) path param returns **400**, not 404.
