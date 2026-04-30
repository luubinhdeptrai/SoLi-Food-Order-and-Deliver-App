 # Cart + Modifier System — Full End-to-End Test Plan

**Purpose:** Production-grade, fully reproducible QA plan for the Cart + Modifier system.
Executable from a clean DB (after `pnpm db:seed`). Every dependency is explicitly defined.

---

## 🗺 Dependency Map

```
Cart add with modifiers
  └─ requires ordering_menu_item_snapshots.modifiers ≠ []
       └─ populated by MenuItemUpdatedEvent
            └─ fired automatically on EVERY modifier group/option create/update/delete
                 └─ requires modifier_groups + modifier_options to exist

PATCH /:cartItemId/modifiers
  └─ requires a cart item already added with cartItemId captured

POST /carts/my/checkout
  └─ requires:
       ├─ ordering_restaurant_snapshots (isOpen=true, isApproved=true)
       ├─ ordering_menu_item_snapshots (status=available, modifiers up-to-date)
       └─ Redis cart with at least one item

Snapshot sync:
  ✅ AUTOMATIC — every modifier group/option mutation fires MenuItemUpdatedEvent
     synchronously within the same process (NestJS EventBus).
  ❌ NO separate HTTP call needed.
  ⚠️  Timing: wait for the API response (201/200) — sync has completed by then.
```

---

## 📋 Quick Reference

### Fixed IDs (from `pnpm db:seed`)

```
BASE_URL        = http://localhost:3000

# Users
OWNER_ID        = 11111111-1111-4111-8111-111111111111   ← restaurant owner + admin
CUSTOMER_ID     = 22222222-2222-4222-8222-222222222222   ← customer doing cart ops

# Restaurants
RESTAURANT_OPEN = fe8b2648-2260-4bc5-9acd-d88972148c78   ← Sunset Bistro (open, approved)
RESTAURANT_CLOSED = cccccccc-cccc-4ccc-8ccc-cccccccccccc ← Closed Kitchen (isOpen=false)

# Menu Items (Sunset Bistro)
ITEM_PLAIN      = a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5   ← Caesar Salad   price=9.00
ITEM_MODS       = 4dc7cdfa-5a54-402f-b1a8-2d47de146081   ← Margherita Pizza price=12.50
ITEM_TIRAMISU   = b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6   ← Tiramisu        price=6.50

# Menu Items (Closed Kitchen — cross-restaurant guard testing)
ITEM_CLOSED_R   = c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6   ← Classic Burger
```

### Auth Headers

```
Owner (modifier setup):  x-test-user-id: 11111111-1111-4111-8111-111111111111
Customer (cart + checkout): x-test-user-id: 22222222-2222-4222-8222-222222222222
```

> `DevTestUserMiddleware` is active in dev. No JWT required.
> The default user (no header) is OWNER_ID with `[admin, restaurant]` roles.
> The customer user has `[admin, restaurant]` roles in dev too — the ownership
> check passes because both map to the seeded restaurant owner.

### Captured IDs (set after Global Setup)

```
GROUP_SIZE_ID   = <captured from Global Setup S1 response>
OPT_SMALL_ID    = <captured from Global Setup S2 response>
OPT_LARGE_ID    = <captured from Global Setup S3 response>
GROUP_EXTRA_ID  = <captured from Global Setup S4 response>
OPT_CHEESE_ID   = <captured from Global Setup S5 response>
OPT_BACON_ID    = <captured from Global Setup S6 response>
```

---

## 🚀 Phase 0 — Environment Bootstrap

Run these commands before any tests:

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Wait for Postgres + Redis to be ready (~3s)
# 3. Seed the database
cd apps/api
pnpm db:seed

# 4. Start the API server
pnpm start:dev
# Wait for "Application is running on: http://[::1]:3000"
```

**Verify seed worked:**
```http
GET http://localhost:3000/api/ordering/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081
```
Expected `200` with `"name": "Margherita Pizza"`, `"modifiers": []`.

---

## 🔧 Global Setup — Create Modifier Data

> **Run once after `pnpm db:seed`.** All test cases that use modifiers depend on this.
> All requests use OWNER_ID header (restaurant owner role).
> Snapshot sync is automatic after each call — no extra step needed.

---

### S1 — Create "Size" group on Margherita Pizza

```http
POST http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "name": "Size",
  "minSelections": 1,
  "maxSelections": 1,
  "displayOrder": 0
}
```

**Expected:** `201 Created`
```json
{
  "id": "<GROUP_SIZE_ID>",
  "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "name": "Size",
  "minSelections": 1,
  "maxSelections": 1,
  "displayOrder": 0
}
```
**→ Save `id` as `GROUP_SIZE_ID`.**

---

### S2 — Create "Small" option (default, free)

```http
POST http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{{GROUP_SIZE_ID}}/options
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "name": "Small",
  "price": 0,
  "isDefault": true,
  "isAvailable": true,
  "displayOrder": 0
}
```

**Expected:** `201 Created`
```json
{
  "id": "<OPT_SMALL_ID>",
  "groupId": "{{GROUP_SIZE_ID}}",
  "name": "Small",
  "price": 0,
  "isDefault": true,
  "isAvailable": true
}
```
**→ Save `id` as `OPT_SMALL_ID`.**

---

### S3 — Create "Large" option (+10,000 VND, non-default)

```http
POST http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{{GROUP_SIZE_ID}}/options
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "name": "Large",
  "price": 10000,
  "isDefault": false,
  "isAvailable": true,
  "displayOrder": 1
}
```

**Expected:** `201 Created`
```json
{
  "id": "<OPT_LARGE_ID>",
  "groupId": "{{GROUP_SIZE_ID}}",
  "name": "Large",
  "price": 10000,
  "isDefault": false,
  "isAvailable": true
}
```
**→ Save `id` as `OPT_LARGE_ID`.**

---

### S4 — Create "Extras" group (optional, multi-select)

```http
POST http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "name": "Extras",
  "minSelections": 0,
  "maxSelections": 2,
  "displayOrder": 1
}
```

**Expected:** `201 Created`
**→ Save `id` as `GROUP_EXTRA_ID`.**

---

### S5 — Create "Cheese" option (+5,000 VND)

```http
POST http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{{GROUP_EXTRA_ID}}/options
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "name": "Cheese",
  "price": 5000,
  "isDefault": false,
  "isAvailable": true,
  "displayOrder": 0
}
```

**Expected:** `201 Created`
**→ Save `id` as `OPT_CHEESE_ID`.**

---

### S6 — Create "Bacon" option (+8,000 VND)

```http
POST http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{{GROUP_EXTRA_ID}}/options
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "name": "Bacon",
  "price": 8000,
  "isDefault": false,
  "isAvailable": true,
  "displayOrder": 1
}
```

**Expected:** `201 Created`
**→ Save `id` as `OPT_BACON_ID`.**

---

### S7 — Verify snapshot was propagated

```http
GET http://localhost:3000/api/ordering/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081
```

**Expected:** `200 OK` — `modifiers` must NOT be `[]`:
```json
{
  "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "modifiers": [
    {
      "groupId": "{{GROUP_SIZE_ID}}",
      "groupName": "Size",
      "minSelections": 1,
      "maxSelections": 1,
      "options": [
        { "optionId": "{{OPT_SMALL_ID}}", "name": "Small", "price": 0,     "isDefault": true,  "isAvailable": true },
        { "optionId": "{{OPT_LARGE_ID}}", "name": "Large", "price": 10000, "isDefault": false, "isAvailable": true }
      ]
    },
    {
      "groupId": "{{GROUP_EXTRA_ID}}",
      "groupName": "Extras",
      "minSelections": 0,
      "maxSelections": 2,
      "options": [
        { "optionId": "{{OPT_CHEESE_ID}}", "name": "Cheese", "price": 5000, "isAvailable": true },
        { "optionId": "{{OPT_BACON_ID}}",  "name": "Bacon",  "price": 8000, "isAvailable": true }
      ]
    }
  ]
}
```

> ✅ Global Setup complete. Now run the test cases below.
> ⚠️  Clear customer Redis cart before each case: `DEL cart:22222222-2222-4222-8222-222222222222`
>     Or use `DELETE http://localhost:3000/api/carts/my` with customer header.

---

## 🧪 Test Cases

---

## Case 1 — Add item with no modifiers

**Dependencies:** None beyond seed data. `ITEM_PLAIN` (Caesar Salad) has no modifier groups.

**Pre-condition:** Customer cart is empty.

### Reset

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

### Test API

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Caesar Salad",
  "unitPrice": 9.00,
  "quantity": 2,
  "selectedOptions": []
}
```

### Expected Result

**Status:** `201 Created`
```json
{
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "items": [
    {
      "cartItemId": "<non-empty UUID>",
      "menuItemId": "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
      "itemName": "Caesar Salad",
      "unitPrice": 9,
      "quantity": 2,
      "selectedModifiers": []
    }
  ]
}
```

### Assert

- `cartItemId` is a valid UUID (not empty, not null).
- `selectedModifiers` is `[]`.
- `quantity` is `2`.

### Notes

`selectedOptions` can be omitted entirely — it is optional in `AddItemToCartDto`.

---

## Case 2 — Add item with a valid single-choice modifier

**Dependencies:** Global Setup S1–S3 (Size group + Small + Large options on Margherita Pizza).

### Reset

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

### Test API

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_LARGE_ID}}" }
  ]
}
```

### Expected Result

**Status:** `201 Created`
```json
{
  "items": [
    {
      "cartItemId": "<UUID_A>",
      "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
      "quantity": 1,
      "selectedModifiers": [
        {
          "groupId":    "{{GROUP_SIZE_ID}}",
          "groupName":  "Size",
          "optionId":   "{{OPT_LARGE_ID}}",
          "optionName": "Large",
          "price":      10000
        }
      ]
    }
  ]
}
```

### Assert

- `price` in `selectedModifiers[0]` is `10000` — resolved from ACL snapshot, NOT from request.
- `unitPrice` in cart item is the base price only (12.50) — modifiers are NOT baked in.
- **Save `cartItemId` as `CART_ITEM_A_WITH_LARGE`** for use in Cases 12, 14, 15, 16.

---

## Case 3 — Re-add same item with same modifiers → quantity merges

**Dependencies:** Global Setup S1–S3. Case 2 already ran (cart has ITEM_MODS + Large).

**Pre-condition:** Cart has one line item for Margherita Pizza + Large (from Case 2).

### Test API (add again — same item, same modifier)

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_LARGE_ID}}" }
  ]
}
```

### Expected Result

**Status:** `200 OK`
```json
{
  "items": [
    {
      "cartItemId": "<SAME UUID_A as before>",
      "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
      "quantity": 2,
      "selectedModifiers": [{ "optionName": "Large", "price": 10000 }]
    }
  ]
}
```

### Assert

- Cart has **one** line item (not two).
- `cartItemId` is identical to the one from Case 2.
- `quantity` is `2` (1 + 1 merged).

---

## Case 4 — Re-add same item with different modifiers → separate line items

**Dependencies:** Global Setup S1–S3.

### Reset

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

### Step A — Add with Small

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_SMALL_ID}}" }
  ]
}
```

**Expected:** `201` — `cartItemId = UUID_A`, `selectedModifiers[0].optionName = "Small"`.

### Step B — Add with Large (different modifier)

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_LARGE_ID}}" }
  ]
}
```

**Expected:** `201` — response has **two** items.

### Assert

- Cart has exactly **2** line items.
- `items[0].cartItemId ≠ items[1].cartItemId`.
- `items[0].selectedModifiers[0].optionName = "Small"`.
- `items[1].selectedModifiers[0].optionName = "Large"`.

---

## Case 5 — Add with invalid groupId → 400

**Dependencies:** Global Setup S1–S3 (snapshot with Size group must exist).

### Reset

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

### Test API

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1,
  "selectedOptions": [
    {
      "groupId":  "00000000-dead-beef-cafe-000000000000",
      "optionId": "{{OPT_LARGE_ID}}"
    }
  ]
}
```

### Expected Result

**Status:** `400 Bad Request`
```json
{
  "statusCode": 400,
  "message": "Modifier group ... does not exist on \"Margherita Pizza\""
}
```

### Assert

- Cart remains empty (no item was added).

---

## Case 6 — Add with invalid optionId within a valid group → 400

**Dependencies:** Global Setup S1–S3.

### Reset

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

### Test API

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1,
  "selectedOptions": [
    {
      "groupId":  "{{GROUP_SIZE_ID}}",
      "optionId": "00000000-dead-beef-cafe-000000000000"
    }
  ]
}
```

### Expected Result

**Status:** `400 Bad Request`
```json
{
  "statusCode": 400,
  "message": "Option ... does not exist in group \"Size\""
}
```

---

## Case 7 — Add with `isAvailable=false` option → 400

**Dependencies:** Global Setup S4–S6 (Extras group + Bacon option).

### Setup — Mark Bacon as unavailable

```http
PATCH http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{{GROUP_EXTRA_ID}}/options/{{OPT_BACON_ID}}
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "isAvailable": false
}
```

**Expected:** `200 OK`. Snapshot auto-updated synchronously.

### Reset Cart

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

### Test API

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "{{GROUP_EXTRA_ID}}", "optionId": "{{OPT_BACON_ID}}" }
  ]
}
```

### Expected Result

**Status:** `400 Bad Request`
```json
{
  "statusCode": 400,
  "message": "Modifier option \"Bacon\" is not currently available"
}
```

### Teardown — Restore Bacon availability (required for Case 19 setup)

```http
PATCH http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{{GROUP_EXTRA_ID}}/options/{{OPT_BACON_ID}}
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "isAvailable": true
}
```

---

## Case 8 — Add with `minSelections` violated, no default option → 400

**Dependencies:** Global Setup S1. `OPT_SMALL_ID` must be set to `isDefault=false`.

### Setup — Remove default from Small option

```http
PATCH http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{{GROUP_SIZE_ID}}/options/{{OPT_SMALL_ID}}
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "isDefault": false
}
```

**Expected:** `200 OK`. Snapshot auto-updated.

### Reset Cart

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

### Test API — Send empty selectedOptions (Size group requires 1, no default)

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1,
  "selectedOptions": []
}
```

### Expected Result

**Status:** `400 Bad Request`
```json
{
  "statusCode": 400,
  "message": "Group \"Size\" requires at least 1 selection"
}
```

### Teardown — Restore Small as default

```http
PATCH http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{{GROUP_SIZE_ID}}/options/{{OPT_SMALL_ID}}
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "isDefault": true
}
```

---

## Case 9 — Required group with default option → auto-inject on empty selectedOptions

**Dependencies:** Global Setup S1–S3. `OPT_SMALL_ID.isDefault=true` (restored in Case 8 teardown).

### Reset Cart

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

### Test API — Empty selectedOptions, Size group has isDefault=true Small option

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 2,
  "selectedOptions": []
}
```

### Expected Result

**Status:** `201 Created`
```json
{
  "items": [
    {
      "cartItemId": "<UUID>",
      "quantity": 2,
      "selectedModifiers": [
        {
          "groupId":    "{{GROUP_SIZE_ID}}",
          "groupName":  "Size",
          "optionId":   "{{OPT_SMALL_ID}}",
          "optionName": "Small",
          "price":      0
        }
      ]
    }
  ]
}
```

### Assert

- `selectedModifiers` is NOT empty — "Small" was auto-injected.
- `quantity` is `2` — unchanged.
- NO error thrown despite `selectedOptions: []`.

---

## Case 10 — `maxSelections` exceeded → 400

**Dependencies:** Global Setup S1–S3. "Size" group has `maxSelections=1`.

### Reset Cart

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

### Test API — Send both Small and Large for the same Size group

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_SMALL_ID}}" },
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_LARGE_ID}}" }
  ]
}
```

### Expected Result

**Status:** `400 Bad Request`
```json
{
  "statusCode": 400,
  "message": "Group \"Size\" allows at most 1 selection"
}
```

---

## Case 11 — Snapshot absent with non-empty selectedOptions → 400

**Dependencies:** None (uses a non-existent menuItemId).

> **Why no snapshot exists:** The UUID below has never been created via the menu API,
> so `ordering_menu_item_snapshots` has no row for it. No setup is needed — just use
> any UUID that is not in the seed data.

### Reset Cart

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

### Test A — No snapshot + selectedOptions non-empty → 400

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "ffffffff-ffff-4fff-8fff-ffffffffffff",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Ghost Item",
  "unitPrice": 5.00,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_LARGE_ID}}" }
  ]
}
```

**Expected:** `400 Bad Request`
```json
{ "statusCode": 400, "message": "Menu item snapshot not found ..." }
```

### Test B — No snapshot + selectedOptions empty → 201 (graceful degradation) (BỎ TEST CÁI NÀY)

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "ffffffff-ffff-4fff-8fff-ffffffffffff",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Ghost Item",
  "unitPrice": 5.00,
  "quantity": 1,
  "selectedOptions": []
}
```

**Expected:** `201 Created` — item added with `selectedModifiers: []`.

### Notes

Test B covers the graceful degradation path: no snapshot required when no modifiers
are requested. The cart accepts it; the checkout validation will reject it later if
the ACL snapshot is still missing at that point.

---

## Case 12 — PATCH modifiers — change option within a group

**Dependencies:** Global Setup S1–S3. Requires a cart item with Large selected.

### Setup — Add item with Large

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 3,
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_LARGE_ID}}" }
  ]
}
```

→ Capture `items[0].cartItemId` as `CART_ITEM_ID`.

### Test API — Change from Large to Small

```http
PATCH http://localhost:3000/api/carts/my/items/{{CART_ITEM_ID}}/modifiers
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_SMALL_ID}}" }
  ]
}
```

### Expected Result

**Status:** `200 OK`
```json
{
  "items": [
    {
      "cartItemId": "{{CART_ITEM_ID}}",
      "quantity": 3,
      "selectedModifiers": [
        { "optionName": "Small", "price": 0 }
      ]
    }
  ]
}
```

### Assert

- `cartItemId` is unchanged.
- `quantity` is still `3` — modifier PATCH never touches quantity.
- `selectedModifiers[0].optionName` is now `"Small"`.

---

## Case 13 — PATCH modifiers — clear optional modifiers

**Dependencies:** Global Setup S1–S6. Requires item with Cheese extra selected.

### Setup — Add item with Cheese extra

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}",  "optionId": "{{OPT_SMALL_ID}}" },
    { "groupId": "{{GROUP_EXTRA_ID}}", "optionId": "{{OPT_CHEESE_ID}}" }
  ]
}
```

→ Capture `items[0].cartItemId` as `CART_ITEM_ID`.

### Test API — Clear extras (keep Size via required selection)

```http
PATCH http://localhost:3000/api/carts/my/items/{{CART_ITEM_ID}}/modifiers
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_SMALL_ID}}" }
  ]
}
```

### Expected Result

**Status:** `200 OK`
```json
{
  "items": [
    {
      "cartItemId": "{{CART_ITEM_ID}}",
      "quantity": 1,
      "selectedModifiers": [
        { "groupName": "Size", "optionName": "Small", "price": 0 }
      ]
    }
  ]
}
```

### Assert

- Cheese extra is GONE from `selectedModifiers`.
- Item is NOT removed from cart (item remains with `quantity=1`).

---

## Case 14 — PATCH quantity — modifiers unchanged

**Dependencies:** Case 12 or 13 setup (any cart item with modifiers).

> **Re-use cart from Case 13** if running cases sequentially.

### Test API — Update quantity only

```http
PATCH http://localhost:3000/api/carts/my/items/{{CART_ITEM_ID}}
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "quantity": 4
}
```

### Expected Result

**Status:** `200 OK`
```json
{
  "items": [
    {
      "cartItemId": "{{CART_ITEM_ID}}",
      "quantity": 4,
      "selectedModifiers": [
        { "optionName": "Small", "price": 0 }
      ]
    }
  ]
}
```

### Assert

- `quantity` updated to `4`.
- `selectedModifiers` is unchanged from previous state.
- `cartItemId` is unchanged.

---

## Case 15 — PATCH quantity to 0 → item removed

**Dependencies:** Any cart item.

> **Re-use cart from Case 14.**

### Test API

```http
PATCH http://localhost:3000/api/carts/my/items/{{CART_ITEM_ID}}
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "quantity": 0
}
```

### Expected Result

**Status:** `204 No Content` (cart is now empty)
OR `200 OK` with `{ "items": [] }` if other items remain.

### Assert

- Subsequent `GET /api/carts/my` returns `null` or `{ "items": [] }`.
- The item with `CART_ITEM_ID` is absent.

---

## Case 16 — DELETE cart item

**Dependencies:** Any cart item exists.

### Setup

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Caesar Salad",
  "unitPrice": 9.00,
  "quantity": 1
}
```

→ Capture `items[0].cartItemId` as `CART_ITEM_ID`.

### Test API

```http
DELETE http://localhost:3000/api/carts/my/items/{{CART_ITEM_ID}}
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

### Expected Result

**Status:** `204 No Content` (cart empty) or `200 OK` if other items remain.

### Assert

```http
GET http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```
→ Returns `null` or empty `items` array.

---

## Case 17 — Checkout: correct pricing (base + modifiers) × quantity

**Dependencies:** Global Setup S1–S3.

**Pricing formula:** `totalAmount = (unitPrice + modifiersPrice) × quantity`
- Margherita Pizza base price from ACL snapshot: **12.50**
- Large modifier price from ACL snapshot: **10,000** (VND — note the price unit mismatch here; use whatever your test currency is)
- quantity: **2**

> **Note:** For a clean pricing test, use prices that are easy to verify.
> Margherita Pizza (snapshot price = 12.50) + Large (+10,000) is only meaningful if
> your currency unit is consistent. If prices are in VND cents, use Tiramisu (price=6.50)
> with Large (+10000) → (6.50 + 10000) × 2 = 20013.00. Adjust based on your actual
> price unit.

### Reset + Setup Cart (2x Margherita + Large)

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 2,
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_LARGE_ID}}" }
  ]
}
```

### Test API — Checkout

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "deliveryAddress": {
    "street":   "123 Nguyen Hue Blvd",
    "district": "District 1",
    "city":     "Ho Chi Minh City"
  },
  "paymentMethod": "cod"
}
```

### Expected Result

**Status:** `201 Created`
```json
{
  "orderId": "<UUID>",
  "status": "pending",
  "totalAmount": <(12.50 + 10000) × 2>,
  "paymentMethod": "cod"
}
```

### DB Assertion

```sql
SELECT unit_price, modifiers_price, quantity, subtotal
FROM order_items
WHERE order_id = '<orderId from response>';
```

Expected row:
```
unit_price      = 12.5     ← base price from ACL snapshot (NOT inflated by modifier)
modifiers_price = 10000    ← Large option price from ACL snapshot
quantity        = 2
subtotal        = 20025    ← (12.5 + 10000) × 2 = 20025.00
```

### Notes

- `unit_price` must equal the ACL snapshot price (12.50), NOT the client-supplied `unitPrice`.
- `modifiers_price` is separate — the original bug (Case 13 fix) baked modifier prices into `unitPrice`.

---

## Case 18 — Checkout: `order_items.modifiers` contains modifier snapshot

**Dependencies:** Case 17 ran (or re-run Case 17 setup).

### Test API (same as Case 17)

Run Case 17. After `201`:

### DB Assertion

```sql
SELECT modifiers FROM order_items WHERE order_id = '<orderId>';
```

**Expected JSONB:**
```json
[
  {
    "groupId":   "{{GROUP_SIZE_ID}}",
    "groupName": "Size",
    "optionId":  "{{OPT_LARGE_ID}}",
    "optionName": "Large",
    "price":     10000
  }
]
```

### Assert

- `modifiers` is NOT `[]` — it contains the snapshot of what was selected.
- `price` in the JSONB matches the ACL snapshot price (not what the cart stored at add-time).
- Data was re-resolved from ACL at checkout (Case 14 fix) — not copied from the Redis cart.

---

## Case 19 — Checkout: stale modifier option (deleted after cart add) → 422

**Dependencies:** Global Setup S4–S6 (Extras group + Bacon).

### Setup A — Add item with Bacon extra to cart

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}",  "optionId": "{{OPT_SMALL_ID}}" },
    { "groupId": "{{GROUP_EXTRA_ID}}", "optionId": "{{OPT_BACON_ID}}" }
  ]
}
```

**Expected:** `201 Created`. Cart now has Bacon in `selectedModifiers`.

### Setup B — Delete Bacon option (simulates merchant removing it)

```http
DELETE http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{{GROUP_EXTRA_ID}}/options/{{OPT_BACON_ID}}
x-test-user-id: 11111111-1111-4111-8111-111111111111
```

**Expected:** `204 No Content`. Snapshot auto-updated — Bacon is gone from ACL.

### Test API — Attempt checkout with stale Bacon in cart

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "deliveryAddress": {
    "street": "123 Nguyen Hue Blvd",
    "district": "District 1",
    "city": "Ho Chi Minh City"
  },
  "paymentMethod": "cod"
}
```

### Expected Result

**Status:** `422 Unprocessable Entity`
```json
{
  "statusCode": 422,
  "message": "Modifier option \"Bacon\" no longer exists. Please update your cart."
}
```

### Assert

- No order row created in `orders` table.
- Redis cart is NOT cleared.

### Teardown — Re-create Bacon option for subsequent tests

```http
POST http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{{GROUP_EXTRA_ID}}/options
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "name": "Bacon",
  "price": 8000,
  "isDefault": false,
  "isAvailable": true,
  "displayOrder": 1
}
```

→ Update `OPT_BACON_ID` with the new `id` from the response.

---

## Case 20 — Checkout: modifier option `isAvailable=false` at checkout → 422

**Dependencies:** Global Setup S1–S3 (Large option). Cart must have Large selected.

### Setup A — Add item with Large to cart

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_LARGE_ID}}" }
  ]
}
```

**Expected:** `201 Created`.

### Setup B — Mark Large as unavailable (snapshot auto-updates)

```http
PATCH http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{{GROUP_SIZE_ID}}/options/{{OPT_LARGE_ID}}
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "isAvailable": false
}
```

**Expected:** `200 OK`.

### Test API

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "deliveryAddress": {
    "street": "123 Nguyen Hue Blvd",
    "district": "District 1",
    "city": "Ho Chi Minh City"
  },
  "paymentMethod": "cod"
}
```

### Expected Result

**Status:** `422 Unprocessable Entity`
```json
{
  "statusCode": 422,
  "message": "Modifier option \"Large\" is no longer available. Please update your cart."
}
```

### Teardown — Restore Large availability

```http
PATCH http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{{GROUP_SIZE_ID}}/options/{{OPT_LARGE_ID}}
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "isAvailable": true
}
```

---

## Case 21 — Checkout: `minSelections` raised after cart add → 422

**Dependencies:** Global Setup S4 (Extras group, currently minSelections=0).

### Setup A — Add item with only Size selected (no Extras)

```http
DELETE http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

```http
POST http://localhost:3000/api/carts/my/items
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "menuItemId":   "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_SMALL_ID}}" }
  ]
}
```

**Expected:** `201 Created`. Extras group is optional — no Extras selection is valid.

### Setup B — Raise Extras group to minSelections=1 (snapshot auto-updates)

```http
PATCH http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{{GROUP_EXTRA_ID}}
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "minSelections": 1
}
```

**Expected:** `200 OK`.

### Test API

```http
POST http://localhost:3000/api/carts/my/checkout
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "deliveryAddress": {
    "street": "123 Nguyen Hue Blvd",
    "district": "District 1",
    "city": "Ho Chi Minh City"
  },
  "paymentMethod": "cod"
}
```

### Expected Result

**Status:** `422 Unprocessable Entity`
```json
{
  "statusCode": 422,
  "message": "Modifier group \"Extras\" now requires at least 1 selection(s) for \"Margherita Pizza\". Please update your cart and try again."
}
```

### Teardown — Restore Extras to optional

```http
PATCH http://localhost:3000/api/menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{{GROUP_EXTRA_ID}}
Content-Type: application/json
x-test-user-id: 11111111-1111-4111-8111-111111111111

{
  "minSelections": 0
}
```

---

## Case 22 — Existing Redis cart back-fill (pre-`cartItemId` format)

**Dependencies:** Redis access. This simulates a cart that was stored before the `cartItemId` field was introduced.

### Setup — Inject old-format cart directly into Redis

Use `redis-cli` or the Redis container:

```bash
docker exec -it food_order_redis redis-cli
```

```
SET "cart:da981bba-1a6f-4f18-8aaf-782b98c5e06f" '{
  "cartId": "123e4567-e89b-12d3-a456-426614174000",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "items": [
    {
      "menuItemId": "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
      "itemName": "Caesar Salad",
      "unitPrice": 9.00,
      "quantity": 1,
      "selectedModifiers": []
    }
  ]
}' EX 86400
```

> The old format has NO `cartItemId` and NO `modifierFingerprint` fields on the item.

### Test API — GET the cart (triggers back-fill)

```http
GET http://localhost:3000/api/carts/my
x-test-user-id: 22222222-2222-4222-8222-222222222222
```

### Expected Result

**Status:** `200 OK`
```json
{
  "items": [
    {
      "cartItemId": "<non-empty UUID — back-filled>",
      "menuItemId": "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
      "quantity": 1,
      "selectedModifiers": []
    }
  ]
}
```

### Assert — Use back-filled cartItemId for mutation

```http
PATCH http://localhost:3000/api/carts/my/items/{{cartItemId from response}}
Content-Type: application/json
x-test-user-id: 22222222-2222-4222-8222-222222222222

{
  "quantity": 2
}
```

**Expected:** `200 OK` — confirms back-filled `cartItemId` is usable.

### Assert — Back-fill is persisted on next write

After the PATCH above, inspect Redis:
```bash
GET "cart:22222222-2222-4222-8222-222222222222"
```
The stored JSON should now include `"cartItemId"` and `"modifierFingerprint"` on the item.

---

## 📊 Full Dependency Map

| Case | Requires Global Setup | Requires Specific State Change | Cart State Needed |
|------|-----------------------|-------------------------------|-------------------|
| 1    | None                  | None                          | Empty             |
| 2    | S1–S3 (Size group)    | None                          | Empty             |
| 3    | S1–S3                 | None                          | Has Case 2 item   |
| 4    | S1–S3                 | None                          | Empty             |
| 5    | S1–S3 (snapshot needed) | None                        | Empty             |
| 6    | S1–S3                 | None                          | Empty             |
| 7    | S4–S6 (Extras+Bacon)  | Set Bacon `isAvailable=false` | Empty             |
| 8    | S1–S3                 | Set Small `isDefault=false`   | Empty             |
| 9    | S1–S3                 | Small must be `isDefault=true` | Empty            |
| 10   | S1–S3                 | None                          | Empty             |
| 11   | None                  | None (uses non-existent ID)   | Empty             |
| 12   | S1–S3                 | None                          | Has item w/ Large |
| 13   | S1–S6                 | None                          | Has item w/ Cheese|
| 14   | S1–S3                 | None                          | Has item (any)    |
| 15   | None                  | None                          | Has item (any)    |
| 16   | None                  | None                          | Empty             |
| 17   | S1–S3                 | None                          | Empty             |
| 18   | S1–S3                 | None (re-uses Case 17)        | Empty             |
| 19   | S4–S6                 | Delete Bacon option           | Has Bacon in cart |
| 20   | S1–S3                 | Set Large `isAvailable=false` | Has Large in cart |
| 21   | S1–S6                 | Raise Extras `minSelections`  | Has item, no Extra|
| 22   | None                  | Raw Redis injection           | Injected manually |

---

## 📊 Summary Table

| # | Method | Path | Precondition | Expected Status | Key Assertion |
|---|--------|------|--------------|-----------------|---------------|
| 1 | POST | `/carts/my/items` | No modifiers (ITEM_PLAIN) | 201 | `cartItemId` present |
| 2 | POST | `/carts/my/items` | Size group seeded | 201 | price from ACL snapshot |
| 3 | POST | `/carts/my/items` | Same item+mods in cart | 200 | quantity merged, 1 line |
| 4 | POST | `/carts/my/items` | Cart has Small | 201 | 2 separate line items |
| 5 | POST | `/carts/my/items` | Snapshot exists | 400 | invalid groupId rejected |
| 6 | POST | `/carts/my/items` | Snapshot exists | 400 | invalid optionId rejected |
| 7 | POST | `/carts/my/items` | Bacon `isAvailable=false` | 400 | unavailable option rejected |
| 8 | POST | `/carts/my/items` | No default, no selection | 400 | minSelections enforced |
| 9 | POST | `/carts/my/items` | Small `isDefault=true` | 201 | default auto-injected |
| 10 | POST | `/carts/my/items` | Size has maxSelections=1 | 400 | maxSelections enforced |
| 11A | POST | `/carts/my/items` | No snapshot + selectedOptions | 400 | snapshot required for mods |
| 11B | POST | `/carts/my/items` | No snapshot + no selectedOptions | 201 | graceful degradation |
| 12 | PATCH | `/carts/my/items/:id/modifiers` | Cart has item | 200 | modifier changed, qty same |
| 13 | PATCH | `/carts/my/items/:id/modifiers` | Cart has Cheese | 200 | Cheese cleared, item stays |
| 14 | PATCH | `/carts/my/items/:id` | Cart has item w/ mods | 200 | qty updated, mods unchanged |
| 15 | PATCH | `/carts/my/items/:id` | Cart has item | 204 | item removed |
| 16 | DELETE | `/carts/my/items/:id` | Cart has item | 204 | item absent |
| 17 | POST | `/carts/my/checkout` | Cart+snapshots ready | 201 | `totalAmount=(base+mod)×qty` |
| 18 | POST | `/carts/my/checkout` | Same as 17 | 201 | `order_items.modifiers` populated |
| 19 | POST | `/carts/my/checkout` | Bacon deleted after cart add | 422 | stale option rejected |
| 20 | POST | `/carts/my/checkout` | Large `isAvailable=false` | 422 | unavailable at checkout |
| 21 | POST | `/carts/my/checkout` | minSelections raised | 422 | constraint raised rejected |
| 22 | GET | `/carts/my` | Old Redis format injected | 200 | `cartItemId` back-filled |

---

## ⚠️ Broken Assumptions in Original `cart-test-scenarios.md`

| Original Case | Problem | Fix Applied |
|---------------|---------|-------------|
| All cases using `{{ITEM_MODS}}` | No modifier groups existed — snapshot had `modifiers: []` | Global Setup S1–S6 creates them |
| All cases using `{{GROUP_SIZE_ID}}` etc. | IDs were placeholders — no real data | Replaced with real capture-from-response pattern |
| Case 7 `isAvailable=false` test | No setup to actually mark the option unavailable | Added PATCH setup step before test |
| Case 8 no-default test | Small option was `isDefault=true` — would auto-inject, not 400 | Added PATCH to set `isDefault=false` first |
| Case 9 auto-inject test | Required `isDefault=true` but prior test turned it off | Added explicit restore in Case 8 teardown |
| Case 19 stale option test | Bacon needed to be in cart first, then deleted | Added explicit cart-add step before delete |
| Case 20 `isAvailable=false` at checkout | Large needed to be in cart first, then marked unavailable | Added explicit cart-add step before PATCH |
| Case 21 minSelections raised | Extras needed to be in cart without Extras selected | Added explicit cart-add step before group PATCH |
| Case 22 back-fill | Redis key format was not shown | Added raw `SET` command with old-format JSON |
| Pricing in Cases 17/18 | Prices stated as `50000` base + `10000` mod which don't match seed data | Corrected to use seed prices: 12.50 + 10000 |
