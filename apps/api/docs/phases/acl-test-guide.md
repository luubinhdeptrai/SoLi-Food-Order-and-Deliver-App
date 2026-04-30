# ACL Layer (Menu Item Snapshots) — Test Guide

> **Scope**: `module/ordering/acl/` — `MenuItemProjector` + `MenuItemSnapshotRepository`.
> The projector consumes `MenuItemUpdatedEvent` (in-process EventBus) and upserts `ordering_menu_item_snapshots`.

---

## Prerequisites

1. Run `pnpm db:push` to apply the latest schema (includes `modifiers jsonb` column).
2. Run `pnpm db:seed` — seeds `ordering_menu_item_snapshots` for all 4 menu items with `modifiers: []`.
3. Start the API: `pnpm --filter api dev`.

---

## Fixed UUIDs

| Alias | Value |
|---|---|
| `PIZZA_ITEM` | `4dc7cdfa-5a54-402f-b1a8-2d47de146081` |
| `SALAD_ITEM` | `a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5` |
| `RESTAURANT_1` | `fe8b2648-2260-4bc5-9acd-d88972148c78` |

---

## 1. Seed verification

### 1.1 Check seed snapshot exists
Query the DB directly:
```sql
SELECT menu_item_id, name, price, status, modifiers
FROM ordering_menu_item_snapshots
WHERE menu_item_id = '4dc7cdfa-5a54-402f-b1a8-2d47de146081';
```
**Expected**: row with `modifiers = []` (empty JSONB array).

---

## 2. Event → Snapshot projection (no modifiers)

### 2.1 Update a menu item and verify snapshot sync
```http
PATCH /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081
Authorization: Bearer any-token
Content-Type: application/json

{ "price": 13.00, "status": "out_of_stock" }
```
Then query the snapshot:
```sql
SELECT price, status, modifiers FROM ordering_menu_item_snapshots
WHERE menu_item_id = '4dc7cdfa-5a54-402f-b1a8-2d47de146081';
```
**Expected**: `price = 13.00`, `status = 'out_of_stock'`, `modifiers = []`.

### 2.2 Idempotency — replaying the same event
Publish the same `MenuItemUpdatedEvent` twice (e.g., update `price` to the same value twice). The snapshot must remain consistent — no duplicate rows, no constraint error.

---

## 3. Event → Snapshot projection (with modifiers)

### 3.1 Setup: add modifier groups and options to PIZZA_ITEM
```http
POST /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups
Authorization: Bearer any-token
Content-Type: application/json

{ "name": "Toppings", "minSelections": 0, "maxSelections": 3, "displayOrder": 1 }
```
Save response `id` as `GROUP_ID`.

```http
POST /menu-items/4dc7cdfa-5a54-402f-b1a8-2d47de146081/modifier-groups/{GROUP_ID}/options
Authorization: Bearer any-token
Content-Type: application/json

{ "name": "Extra Cheese", "price": 1.50, "isDefault": false, "displayOrder": 1 }
```

### 3.2 Verify snapshot updated with modifier tree
```sql
SELECT modifiers FROM ordering_menu_item_snapshots
WHERE menu_item_id = '4dc7cdfa-5a54-402f-b1a8-2d47de146081';
```
**Expected** (JSONB):
```json
[
  {
    "groupId": "{GROUP_ID}",
    "groupName": "Toppings",
    "minSelections": 0,
    "maxSelections": 3,
    "options": [
      {
        "optionId": "{OPTION_ID}",
        "name": "Extra Cheese",
        "price": 1.50,
        "isDefault": false
      }
    ]
  }
]
```

### 3.3 Add second option — snapshot reflects full tree
Add another option (`Mushrooms, price: 0.80`). Query snapshot → `modifiers[0].options` now has 2 entries.

### 3.4 Delete an option — snapshot reflects removal
```http
DELETE /menu-items/{PIZZA_ITEM}/modifier-groups/{GROUP_ID}/options/{OPTION_ID}
```
Query snapshot → `modifiers[0].options` has 1 entry.

### 3.5 Delete the group — snapshot reverts to `[]`
```http
DELETE /menu-items/{PIZZA_ITEM}/modifier-groups/{GROUP_ID}
```
Query snapshot → `modifiers = []`.

---

## 4. Snapshot schema correctness

### 4.1 Verify new column exists
```sql
\d ordering_menu_item_snapshots
```
Must include `modifiers jsonb NOT NULL DEFAULT '[]'`.

### 4.2 Verify old snapshots default to empty array
After `pnpm db:push` on an existing DB with old rows:
```sql
SELECT menu_item_id, modifiers FROM ordering_menu_item_snapshots;
```
All rows must show `modifiers = []` (not NULL).

---

## 5. MenuItemSnapshotRepository unit

### 5.1 `findById` returns null for unknown ID
Call `snapshotRepo.findById('00000000-0000-4000-8000-000000000000')` → returns `null`.

### 5.2 `findManyByIds` returns only matching rows
Call with `[PIZZA_ITEM, '00000000-0000-4000-8000-000000000000']` → returns 1 row (PIZZA_ITEM only).

### 5.3 `upsert` with modifiers round-trips correctly
Upsert with `modifiers: [{ groupId: 'x', groupName: 'y', minSelections: 1, maxSelections: 1, options: [] }]`, then `findById` → JSONB parses back to same structure.
