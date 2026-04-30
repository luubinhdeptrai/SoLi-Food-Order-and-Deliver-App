# Modifier Groups & Options — Test Guide

> **Scope**: `module/restaurant-catalog/menu/modifiers/` — full Group + Option CRUD with ownership enforcement.
> Run: `jest modifiers` or `pnpm --filter api test`.

---

## Fixed UUIDs (from `seed.ts`)

| Alias | Value |
|---|---|
| `OWNER_ID` | `11111111-1111-4111-8111-111111111111` |
| `CUSTOMER_ID` | `22222222-2222-4222-8222-222222222222` |
| `PIZZA_ITEM` | `4dc7cdfa-5a54-402f-b1a8-2d47de146081` |
| `SALAD_ITEM` | `a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5` |

> Groups and options are created during tests — no seeds exist for them.

---

## Authentication header

All write endpoints require:
```
Authorization: Bearer any-token   → resolves to OWNER_ID
```

---

## 1. Modifier Groups

### 1.1 List groups (empty at start)
```http
GET /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups
```
**Expected 200** — empty array `[]`.

### 1.2 Create a modifier group
```http
POST /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups
Authorization: Bearer any-token
Content-Type: application/json

{
  "name": "Toppings",
  "minSelections": 0,
  "maxSelections": 3,
  "displayOrder": 1
}
```
**Expected 201** — group with `id` UUID, `menuItemId`, `minSelections: 0`, `maxSelections: 3`.

> Save the returned `id` as `GROUP_ID` for subsequent tests.

### 1.3 Create group — minSelections > maxSelections → 400
```json
{ "name": "Size", "minSelections": 5, "maxSelections": 2, "displayOrder": 1 }
```
**Expected 400 Bad Request** with message about min/max constraint.

### 1.4 Create group — required `name` missing → 400
```json
{ "minSelections": 0, "maxSelections": 1, "displayOrder": 1 }
```
**Expected 400**.

### 1.5 Create group — wrong owner → 403 (S-1 fix)
Create a second user token (or manipulate dev middleware) that resolves to `CUSTOMER_ID`. Try:
```http
POST /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups
Authorization: Bearer customer-token
```
**Expected 403 Forbidden** — `assertMenuItemOwnership` now calls `restaurantService.findOne()` and compares real `ownerId`.

> **Before the S-1 fix**, this returned 403 for ALL users including the real owner — because `getRestaurantForItem` was a stub returning `{ ownerId: restaurantId }` (a UUID compared to a user UUID). Verify the owner CAN create groups after the fix.

### 1.6 Update a group
```http
PATCH /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{GROUP_ID}
Authorization: Bearer any-token
Content-Type: application/json

{ "name": "Extra Toppings", "maxSelections": 5 }
```
**Expected 200** — updated group.

### 1.7 Delete a group
```http
DELETE /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{GROUP_ID}
Authorization: Bearer any-token
```
**Expected 204**. Follow-up `GET` must return `[]`.

### 1.8 List groups — includes nested options
After adding options (section 2 below), `GET /modifier-groups` should return each group with an `options: []` array populated.

---

## 2. Modifier Options

> Assumes `GROUP_ID` was created in test 1.2 above.

### 2.1 Add an option to a group
```http
POST /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{GROUP_ID}/options
Authorization: Bearer any-token
Content-Type: application/json

{
  "name": "Extra Cheese",
  "price": 1.50,
  "isDefault": false,
  "displayOrder": 1
}
```
**Expected 201** — option with `id`, `groupId`, `price: 1.5` (numeric precision).

> Save `OPTION_ID` for subsequent tests.

### 2.2 Add default option (free)
```json
{ "name": "None", "price": 0.00, "isDefault": true, "displayOrder": 0 }
```
**Expected 201** — `isDefault: true`, `price: 0`.

### 2.3 Add option — negative price → 400
```json
{ "name": "Discount", "price": -2.00, "isDefault": false, "displayOrder": 1 }
```
**Expected 400**.

### 2.4 Update an option — mark unavailable
```http
PATCH /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{GROUP_ID}/options/{OPTION_ID}
Authorization: Bearer any-token
Content-Type: application/json

{ "isAvailable": false }
```
**Expected 200** — `isAvailable: false`.

### 2.5 Update option — wrong owner → 403
**Expected 403**.

### 2.6 Delete an option
```http
DELETE /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{GROUP_ID}/options/{OPTION_ID}
Authorization: Bearer any-token
```
**Expected 204**.

### 2.7 Option belongs to a different item → 404 / 403
Try to address an option via a `menuItemId` that doesn't own its group:
```http
PATCH /menu-items/{SALAD_ITEM}/modifier-groups/{GROUP_ID}/options/{OPTION_ID}
```
**Expected 404** (group not found on that item).

---

## 3. Event publishing after modifier changes (I-1 fix)

After any modifier write (`POST/PATCH/DELETE` on groups or options), a `MenuItemUpdatedEvent` must be published with the **full current modifier tree**.

Verification:
1. Create group + 2 options for `PIZZA_ITEM`.
2. Check ordering snapshot: `GET /ordering-snapshots/PIZZA_ITEM` (or query DB).
3. Snapshot `modifiers` JSONB must contain the group + both options with their prices.
4. Delete one option → snapshot updates with one fewer option.
5. Delete the group → snapshot `modifiers` is `[]`.

---

## 4. Schema integrity (D-1 fix)

The old `menu_item_modifiers` table is gone. Verify via `drizzle-studio` or `psql`:
```sql
\d menu_item_modifiers
-- Should return: "Did not find any relation named 'menu_item_modifiers'"
```
New tables exist:
```sql
\d modifier_groups
\d modifier_options
```
