# Cart Module — Test Guide

> **Scope**: `module/ordering/cart/` — Redis-backed cart with modifier selection and validation.
> Run: `jest cart` or `pnpm --filter api test`.

---

## Prerequisites

1. Redis running: `docker-compose up redis -d`
2. `pnpm db:seed` — populates `ordering_menu_item_snapshots`
3. Start API: `pnpm --filter api dev`
4. All requests require `Authorization: Bearer any-token` (resolves to `CUSTOMER_ID` via dev middleware)

---

## Fixed UUIDs

| Alias | Value |
|---|---|
| `CUSTOMER_ID` | `22222222-2222-4222-8222-222222222222` |
| `RESTAURANT_1` | `fe8b2648-2260-4bc5-9acd-d88972148c78` |
| `RESTAURANT_2` | `cccccccc-cccc-4ccc-8ccc-cccccccccccc` |
| `PIZZA_ITEM` | `4dc7cdfa-5a54-402f-b1a8-2d47de146081` |
| `SALAD_ITEM` | `a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5` |
| `TIRAMISU_ITEM` | `b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6` |

> For modifier tests, you must first create modifier groups/options via `modifier-test-guide.md` and note the returned `GROUP_ID` and `OPTION_ID`.

---

## 1. Basic Cart (no modifiers)

### 1.1 Get empty cart
```http
GET /carts/my
Authorization: Bearer any-token
```
**Expected 200 or null** when cart does not exist.

### 1.2 Add an item
```http
POST /carts/my/items
Authorization: Bearer any-token
Content-Type: application/json

{
  "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 2,
  "selectedOptions": []
}
```
**Expected 201** — cart with 1 item, `quantity: 2`, `subtotal: 25.00`.

### 1.3 Add same item — quantities merge
Repeat the same request with `quantity: 1`.
**Expected 201** — `quantity: 3`, `subtotal: 37.50`.

### 1.4 Get cart — verify `selectedModifiers` field exists
```http
GET /carts/my
```
**Expected 200** — each item has `selectedModifiers: []`.

### 1.5 Update quantity
```http
PATCH /carts/my/items/4dc7cdfa-5a54-402f-b1a8-2d47de146081
Authorization: Bearer any-token
Content-Type: application/json

{ "quantity": 1 }
```
**Expected 200** — `quantity: 1`, `subtotal: 12.50`.

### 1.6 Set quantity to 0 — removes item
```http
PATCH /carts/my/items/4dc7cdfa-5a54-402f-b1a8-2d47de146081
Authorization: Bearer any-token
Content-Type: application/json

{ "quantity": 0 }
```
**Expected 200 with empty cart** or `null` (cart deleted when last item removed).

### 1.7 Remove specific item
Add PIZZA then:
```http
DELETE /carts/my/items/4dc7cdfa-5a54-402f-b1a8-2d47de146081
Authorization: Bearer any-token
```
**Expected 200 (null cart)**.

### 1.8 Clear entire cart
```http
DELETE /carts/my
Authorization: Bearer any-token
```
**Expected 204**. Follow-up `GET /carts/my` returns `null`.

---

## 2. Business Rule — Single-Restaurant Cart (BR-2)

### 2.1 Add item from second restaurant to existing cart → 409
1. Add `PIZZA_ITEM` (RESTAURANT_1) to cart.
2. Try to add `CLASSIC_BURGER` (RESTAURANT_2):
```http
POST /carts/my/items
{
  "menuItemId": "c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6",
  "restaurantId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ...
}
```
**Expected 409 Conflict** with message about restaurant mismatch.

### 2.2 Clearing cart allows switching restaurants
1. `DELETE /carts/my` → 204
2. Add burger (RESTAURANT_2) → **201**

---

## 3. Phase 3 Snapshot Validation

> These tests require the `ordering_menu_item_snapshots` table to be populated (via seed or projector).

### 3.1 Item status `out_of_stock` → 409
1. Set `PIZZA_ITEM` to `out_of_stock` via `PATCH /menu-items/{PIZZA_ITEM}` (wait for snapshot update).
2. Try to add PIZZA to cart.
**Expected 409** — "Menu item is currently not available".

### 3.2 Wrong restaurantId for item → 409
```json
{ "menuItemId": "PIZZA_ITEM", "restaurantId": "RESTAURANT_2", ... }
```
**Expected 409** — item does not belong to that restaurant.

### 3.3 Snapshot absent — falls back to client values (Phase 2 compatibility)
Delete the snapshot row:
```sql
DELETE FROM ordering_menu_item_snapshots WHERE menu_item_id = '{PIZZA_ITEM}';
```
Add PIZZA to cart → **201** (no snapshot validation, client values trusted).

---

## 4. Modifier Selection (Phase 3)

> Requires `GROUP_ID` and `OPTION_ID` from `modifier-test-guide.md` §3, and the snapshot to be updated.

### 4.1 Add item with valid modifier selection
```http
POST /carts/my/items
Authorization: Bearer any-token
Content-Type: application/json

{
  "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "{GROUP_ID}", "optionId": "{OPTION_ID}" }
  ]
}
```
**Expected 201** — cart item with:
```json
"selectedModifiers": [
  {
    "groupId": "{GROUP_ID}",
    "groupName": "Toppings",
    "optionId": "{OPTION_ID}",
    "optionName": "Extra Cheese",
    "price": 1.50
  }
]
```
`subtotal = (12.50 + 1.50) × 1 = 14.00`

### 4.2 Modifier price comes from snapshot — not client
The client sends `unitPrice: 12.50`. The modifier price `1.50` is taken from the snapshot; the client cannot supply it. Verify `subtotal` is calculated server-side.

### 4.3 Invalid groupId → 400
```json
"selectedOptions": [{ "groupId": "00000000-0000-0000-0000-000000000000", "optionId": "{OPTION_ID}" }]
```
**Expected 400** — group does not exist on item.

### 4.4 Invalid optionId for group → 400
```json
"selectedOptions": [{ "groupId": "{GROUP_ID}", "optionId": "00000000-0000-0000-0000-000000000000" }]
```
**Expected 400** — option does not exist in group.

### 4.5 Exceeding maxSelections → 400
If group `maxSelections = 2`, send 3 options for the same group:
```json
"selectedOptions": [
  { "groupId": "{GROUP_ID}", "optionId": "{OPTION_1}" },
  { "groupId": "{GROUP_ID}", "optionId": "{OPTION_2}" },
  { "groupId": "{GROUP_ID}", "optionId": "{OPTION_3}" }
]
```
**Expected 400** — too many selections for group.

### 4.6 Below minSelections → 400
If group `minSelections = 1` (required choice), send no options:
```json
"selectedOptions": []
```
**Expected 400** — at least 1 selection required for group.

### 4.7 No snapshot — selectedOptions ignored (Phase 2 fallback)
Delete the snapshot for PIZZA. Add with `selectedOptions: [...]` → **201**, `selectedModifiers: []` (no validation, empty result).

---

## 5. Subtotal calculation with modifiers

### 5.1 Multi-option subtotal
Add PIZZA (price 12.50) with 2 modifiers (Extra Cheese: 1.50, Mushrooms: 0.80), quantity 3.
**Expected**: `subtotal = (12.50 + 1.50 + 0.80) × 3 = 44.40`

### 5.2 `totalAmount` reflects all item subtotals
Add PIZZA (with modifiers, qty 1) and SALAD (no modifiers, qty 2):
- PIZZA subtotal: `12.50 + 1.50 = 14.00`
- SALAD subtotal: `9.00 × 2 = 18.00`
- `totalAmount = 32.00`

### 5.3 Default option with price 0 doesn't affect subtotal
Add item with a default option (price 0.00). `subtotal = unitPrice × quantity`.

---

## 6. Cart cartId stability (D5-B idempotency)

### 6.1 cartId is generated once and never changes
1. Add item → note `cartId`.
2. Add more items, update quantities → `GET /carts/my` → same `cartId`.
3. `DELETE /carts/my` → clear cart.
4. Add new item → **new** `cartId` (cart was re-created).

### 6.2 cartId uniqueness across customers
Two different customer tokens must produce different `cartId` values.
