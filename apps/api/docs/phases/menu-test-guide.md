# Menu Module — Test Guide

> **Scope**: `module/restaurant-catalog/menu/` — CRUD for menu items and per-restaurant categories.
> Run all tests with: `pnpm --filter api test` or target a single file with `jest menu`.

---

## Fixed UUIDs (from `seed.ts`)

| Alias | Value |
|---|---|
| `OWNER_ID` | `11111111-1111-4111-8111-111111111111` |
| `CUSTOMER_ID` | `22222222-2222-4222-8222-222222222222` |
| `RESTAURANT_1` | `fe8b2648-2260-4bc5-9acd-d88972148c78` |
| `RESTAURANT_2` | `cccccccc-cccc-4ccc-8ccc-cccccccccccc` |
| `PIZZA_ITEM` | `4dc7cdfa-5a54-402f-b1a8-2d47de146081` |
| `SALAD_ITEM` | `a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5` |
| `TIRAMISU_ITEM` | `b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6` |
| `CATEGORY_MAINS` | `aaaa0001-0000-4000-8000-000000000001` |

---

## Authentication header

All write endpoints require:
```
Authorization: Bearer any-token
```
The dev middleware maps any Bearer token to `OWNER_ID` by default.

---

## 1. Menu Categories (per-restaurant)

### 1.1 List categories for a restaurant
```http
GET /menu-items/categories?restaurantId=fe8b2648-2260-4bc5-9acd-d88972148c78
```
**Expected 200** — returns seed categories: Mains, Salads, Desserts.

### 1.2 List categories — unknown restaurant
```http
GET /menu-items/categories?restaurantId=00000000-0000-4000-8000-000000000000
```
**Expected 200** — empty array `[]`.

### 1.3 Create a category
```http
POST /menu-items/categories
Authorization: Bearer any-token
Content-Type: application/json

{
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "name": "Drinks",
  "displayOrder": 4
}
```
**Expected 201** — category object with `id` UUID.

### 1.4 Create category — missing name → 400
```http
POST /menu-items/categories
Authorization: Bearer any-token
Content-Type: application/json

{ "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78" }
```
**Expected 400 Bad Request**.

### 1.5 Update a category
```http
PATCH /menu-items/categories/aaaa0001-0000-4000-8000-000000000001
Authorization: Bearer any-token
Content-Type: application/json

{ "name": "Main Courses" }
```
**Expected 200** — `name` updated.

### 1.6 Delete a category
```http
DELETE /menu-items/categories/aaaa0003-0000-4000-8000-000000000003
Authorization: Bearer any-token
```
**Expected 204**. Verify: `GET /menu-items?restaurantId=RESTAURANT_1` — Tiramisu `categoryId` is now null (ON DELETE SET NULL).

### 1.7 Delete non-existent category → 404
```http
DELETE /menu-items/categories/00000000-0000-4000-8000-000000000099
Authorization: Bearer any-token
```
**Expected 404 Not Found**.

---

## 2. Menu Items — Read

### 2.1 List all items for a restaurant
```http
GET /menu-items?restaurantId=fe8b2648-2260-4bc5-9acd-d88972148c78
```
**Expected 200** — array with 3 items (Pizza, Salad, Tiramisu). Each item has `categoryId`, no `isAvailable`, no `category` enum.

### 2.2 Filter by category UUID
```http
GET /menu-items?restaurantId=fe8b2648-2260-4bc5-9acd-d88972148c78&categoryId=aaaa0001-0000-4000-8000-000000000001
```
**Expected 200** — only Margherita Pizza.

### 2.3 Get single item
```http
GET /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081
```
**Expected 200** — full item object with `price` as decimal string/number (NOT float garbage).

### 2.4 Get non-existent item → 404
```http
GET /menu-items/00000000-0000-4000-8000-000000000000
```
**Expected 404**.

---

## 3. Menu Items — Write

### 3.1 Create a menu item
```http
POST /menu-items
Authorization: Bearer any-token
Content-Type: application/json

{
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "name": "Grilled Chicken",
  "description": "Herb-marinated, served with fries.",
  "price": 14.50,
  "categoryId": "aaaa0001-0000-4000-8000-000000000001",
  "status": "available"
}
```
**Expected 201** — item with `id`, `price: 14.50` (numeric precision preserved).

### 3.2 Create item — price = 0 → 400 (M-1 fix: min is 0.01)
```json
{ ..., "price": 0 }
```
**Expected 400 Bad Request**.

### 3.3 Create item — negative price → 400
```json
{ ..., "price": -5 }
```
**Expected 400**.

### 3.4 Create item — old `isAvailable` field is silently ignored (not a breaking change)
Sending `"isAvailable": true` in the body should not cause a validation error — but the field will not be persisted.

### 3.5 Update item — change status to `out_of_stock`
```http
PATCH /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081
Authorization: Bearer any-token
Content-Type: application/json

{ "status": "out_of_stock" }
```
**Expected 200** — `status: "out_of_stock"`.

### 3.6 Toggle sold-out (convenience endpoint)
```http
PATCH /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/sold-out
Authorization: Bearer any-token
```
**Expected 200** — status toggles between `available` ↔ `out_of_stock`.

### 3.7 Delete a menu item
```http
DELETE /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081
Authorization: Bearer any-token
```
**Expected 204**.

### 3.8 Update item — wrong owner → 403
Log in as `CUSTOMER_ID` and try to update a restaurant item.
**Expected 403 Forbidden** (checked via `assertMenuItemOwnership`).

---

## 4. Price precision regression (M-1 / M-2)

### 4.1 Verify `numeric(12,2)` round-trip
```http
POST /menu-items
...
{ "price": 9.99 }
```
`GET /menu-items/:id` → `price` must return exactly `9.99`, not `9.990000000001` or similar.

### 4.2 Verify 12-digit support
```http
{ "price": 99999999.99 }
```
**Expected**: price stored and returned as `99999999.99`.

---

## 5. Event publishing (I-1 — integration check)

After any write operation (`POST/PATCH/DELETE`), verify that a `MenuItemUpdatedEvent` was published (check `MenuItemProjector` log or ordering snapshot). The event must include `modifiers: []` even when no modifiers exist.

> Use the ACL test guide for the snapshot verification steps.
