# MENU & MODIFIER API TEST SCENARIOS

> **Date:** 2026-05-01  
> **Purpose:** Validate all fixes from MENU_MODIFIER_REVIEW.md  
> **Base URL:** `http://localhost:3000` (adjust to your env)  
> **Auth:** JWT Bearer token. Restaurant-role token = `$RESTAURANT_TOKEN`, Admin token = `$ADMIN_TOKEN`

---

## Section 1: Setup & Seed Data

### 1.1 Required seed state

Before running tests ensure the DB has:

| Entity | ID (example) | Notes |
|---|---|---|
| Restaurant | `11111111-1111-1111-1111-111111111111` | `ownerId` must match `$RESTAURANT_USER_ID` |
| Menu item | `22222222-2222-2222-2222-222222222222` | `restaurantId` = restaurant above, `status = available` |
| Modifier group | `33333333-3333-3333-3333-333333333333` | `menuItemId` = item above, `name = "Size"`, min=1, max=1 |
| Modifier option | `44444444-4444-4444-4444-444444444444` | `groupId` = group above, `name = "Large"`, `price = 5.00` |
| Modifier option | `55555555-5555-5555-5555-555555555555` | `groupId` = group above, `name = "Small"`, `price = 0.00`, `isDefault = true` |

The seeds can be run via `pnpm db:seed`. Verify with:

```http
GET /menu-items?restaurantId=11111111-1111-1111-1111-111111111111
```

Expected: returns item `22222222-2222-2222-2222-222222222222`.

```http
GET /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups
```

Expected: returns group `33333333-3333-3333-3333-333333333333` with 2 options embedded.

### 1.2 Snapshot verification helper

After any event-triggering operation, check the Ordering BC snapshot directly via DB or ACL endpoint (if exposed):

```sql
SELECT menu_item_id, name, price, status, modifiers, last_synced_at
FROM ordering_menu_item_snapshots
WHERE menu_item_id = '22222222-2222-2222-2222-222222222222';
```

---

## Section 2: Critical Bug Verification — Modifier Data Preservation

> **Tests for Issue 2.2 fix:** updating a menu item must NOT wipe the `modifiers` column in the snapshot.

### 2.1 Update menu item name — modifiers must survive

**Step 1 — Record current snapshot modifiers (before update)**

```sql
SELECT modifiers FROM ordering_menu_item_snapshots
WHERE menu_item_id = '22222222-2222-2222-2222-222222222222';
-- Expected: JSON array with 1 group ("Size") and 2 options
```

**Step 2 — Update the item's name**

```http
PATCH /menu-items/22222222-2222-2222-2222-222222222222
Authorization: Bearer $RESTAURANT_TOKEN
Content-Type: application/json

{
  "name": "Updated Burger"
}
```

Expected HTTP response: `200 OK`  
Expected body: item with `name = "Updated Burger"`

**Step 3 — Verify snapshot modifiers unchanged**

```sql
SELECT modifiers FROM ordering_menu_item_snapshots
WHERE menu_item_id = '22222222-2222-2222-2222-222222222222';
-- Expected: SAME JSON array as Step 1 — NOT empty array []
```

✅ Pass if modifiers still contain the "Size" group with "Large" and "Small" options.  
❌ Fail if modifiers is `[]` or `null`.

---

### 2.2 Update menu item price — modifiers must survive

```http
PATCH /menu-items/22222222-2222-2222-2222-222222222222
Authorization: Bearer $RESTAURANT_TOKEN
Content-Type: application/json

{
  "price": 15.99
}
```

Expected: `200 OK`, item with `price = 15.99`.

```sql
SELECT price, modifiers FROM ordering_menu_item_snapshots
WHERE menu_item_id = '22222222-2222-2222-2222-222222222222';
-- price: 15.99, modifiers: [non-empty array]
```

✅ Pass if `modifiers` is non-empty AND `price` updated to `15.99`.

---

### 2.3 Toggle sold-out — modifiers must survive

**Step 1 — Toggle to `out_of_stock`**

```http
PATCH /menu-items/22222222-2222-2222-2222-222222222222/sold-out
Authorization: Bearer $RESTAURANT_TOKEN
```

Expected: `200 OK`, `status = "out_of_stock"`.

**Step 2 — Check snapshot**

```sql
SELECT status, modifiers FROM ordering_menu_item_snapshots
WHERE menu_item_id = '22222222-2222-2222-2222-222222222222';
-- status: out_of_stock, modifiers: [non-empty]
```

✅ Pass if `modifiers` still contains the "Size" group.

**Step 3 — Toggle back to `available`**

```http
PATCH /menu-items/22222222-2222-2222-2222-222222222222/sold-out
Authorization: Bearer $RESTAURANT_TOKEN
```

Expected: `200 OK`, `status = "available"`.

```sql
SELECT status, modifiers FROM ordering_menu_item_snapshots
WHERE menu_item_id = '22222222-2222-2222-2222-222222222222';
-- status: available, modifiers: [non-empty]
```

✅ Pass if modifiers are still present after both toggles.

---

### 2.4 Delete menu item — modifiers should be cleared (intentional)

```http
DELETE /menu-items/22222222-2222-2222-2222-222222222222
Authorization: Bearer $RESTAURANT_TOKEN
```

Expected: `204 No Content`

```sql
SELECT status, modifiers FROM ordering_menu_item_snapshots
WHERE menu_item_id = '22222222-2222-2222-2222-222222222222';
-- status: unavailable, modifiers: []
```

✅ Pass if `status = 'unavailable'` AND `modifiers = []`.  
This is the **intentional** behavior — `remove()` explicitly passes `[]` to signal the item is gone.

> **Note:** Re-create the item and its modifiers for subsequent tests.

---

## Section 3: Modifier Group & Option CRUD

### 3.1 Create modifier group

```http
POST /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups
Authorization: Bearer $RESTAURANT_TOKEN
Content-Type: application/json

{
  "name": "Spice Level",
  "minSelections": 0,
  "maxSelections": 1,
  "displayOrder": 1
}
```

Expected: `201 Created`  
Expected body contains: `id`, `menuItemId = "22222222..."`, `name = "Spice Level"`, `minSelections = 0`, `maxSelections = 1`

Store returned `id` as `$NEW_GROUP_ID` for subsequent tests.

**Verify snapshot updated with new empty group:**

```sql
SELECT modifiers FROM ordering_menu_item_snapshots
WHERE menu_item_id = '22222222-2222-2222-2222-222222222222';
-- modifiers should now contain 2 groups: "Size" and "Spice Level" (Spice Level has options: [])
```

---

### 3.2 Update modifier group — valid min/max

```http
PATCH /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups/$NEW_GROUP_ID
Authorization: Bearer $RESTAURANT_TOKEN
Content-Type: application/json

{
  "minSelections": 1,
  "maxSelections": 3
}
```

Expected: `200 OK`, `minSelections = 1`, `maxSelections = 3`.

---

### 3.3 Update modifier group — invalid min > max (should fail)

```http
PATCH /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups/$NEW_GROUP_ID
Authorization: Bearer $RESTAURANT_TOKEN
Content-Type: application/json

{
  "minSelections": 10
}
```

Expected: `400 Bad Request`  
Expected body: `{ "message": "maxSelections (3) must be ≥ minSelections (10)" }` (or similar)

✅ Pass if 400 is returned — this validates the `validateMinMax` fix in `updateGroup`.  
❌ Fail if 200 is returned (would mean invalid DB state was written).

> **Important:** The current `maxSelections` for `$NEW_GROUP_ID` is 3 (from test 3.2). Sending only `minSelections: 10` should be caught by merging the existing `maxSelections = 3` with the new `minSelections = 10`.

---

### 3.4 Update modifier group — partial update only maxSelections

```http
PATCH /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups/$NEW_GROUP_ID
Authorization: Bearer $RESTAURANT_TOKEN
Content-Type: application/json

{
  "maxSelections": 2
}
```

Expected: `200 OK`. Resulting state: `minSelections = 1` (unchanged), `maxSelections = 2`.

---

### 3.5 Delete modifier group

```http
DELETE /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups/$NEW_GROUP_ID
Authorization: Bearer $RESTAURANT_TOKEN
```

Expected: `204 No Content`

```sql
SELECT COUNT(*) FROM modifier_groups WHERE id = '$NEW_GROUP_ID';
-- Expected: 0 (cascade deletes options too)
```

Verify snapshot no longer contains the deleted group:

```sql
SELECT modifiers FROM ordering_menu_item_snapshots
WHERE menu_item_id = '22222222-2222-2222-2222-222222222222';
-- Expected: array with only the "Size" group remaining
```

---

### 3.6 Create modifier option

```http
POST /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups/33333333-3333-3333-3333-333333333333/options
Authorization: Bearer $RESTAURANT_TOKEN
Content-Type: application/json

{
  "name": "Medium",
  "price": 2.50,
  "isDefault": false,
  "displayOrder": 1
}
```

Expected: `201 Created`  
Store returned `id` as `$NEW_OPTION_ID`.

---

### 3.7 Update modifier option

```http
PATCH /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups/33333333-3333-3333-3333-333333333333/options/$NEW_OPTION_ID
Authorization: Bearer $RESTAURANT_TOKEN
Content-Type: application/json

{
  "price": 3.00,
  "isAvailable": false
}
```

Expected: `200 OK`, `price = 3.00`, `isAvailable = false`.

Verify snapshot reflects updated price:

```sql
SELECT modifiers FROM ordering_menu_item_snapshots
WHERE menu_item_id = '22222222-2222-2222-2222-222222222222';
-- The "Medium" option in the "Size" group should now have price=3.00, isAvailable=false
```

---

### 3.8 Delete modifier option

```http
DELETE /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups/33333333-3333-3333-3333-333333333333/options/$NEW_OPTION_ID
Authorization: Bearer $RESTAURANT_TOKEN
```

Expected: `204 No Content`

```sql
SELECT COUNT(*) FROM modifier_options WHERE id = '$NEW_OPTION_ID';
-- Expected: 0
```

---

## Section 4: New GET Endpoints (Issue 2.1 Fix Validation)

> All three endpoints should return `200 OK` without authentication.

### 4.1 GET single modifier group (with options)

```http
GET /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups/33333333-3333-3333-3333-333333333333
```

Expected: `200 OK`  
Expected body:
```json
{
  "id": "33333333-3333-3333-3333-333333333333",
  "menuItemId": "22222222-2222-2222-2222-222222222222",
  "name": "Size",
  "minSelections": 1,
  "maxSelections": 1,
  "displayOrder": 0,
  "options": [
    { "id": "55555555-...", "name": "Small", "price": 0, "isDefault": true, "isAvailable": true },
    { "id": "44444444-...", "name": "Large", "price": 5, "isDefault": false, "isAvailable": true }
  ]
}
```

✅ Pass if returns 200 with group + embedded options.  
❌ Fail if returns 404 or 400.

---

### 4.2 GET options list for a group

```http
GET /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups/33333333-3333-3333-3333-333333333333/options
```

Expected: `200 OK`  
Expected body: array of `ModifierOptionResponseDto`, e.g.:
```json
[
  { "id": "55555555-...", "name": "Small", "price": 0, "isDefault": true },
  { "id": "44444444-...", "name": "Large", "price": 5, "isDefault": false }
]
```

✅ Pass if returns flat array (not nested inside a group object).

---

### 4.3 GET single modifier option

```http
GET /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups/33333333-3333-3333-3333-333333333333/options/44444444-4444-4444-4444-444444444444
```

Expected: `200 OK`  
Expected body:
```json
{
  "id": "44444444-4444-4444-4444-444444444444",
  "groupId": "33333333-3333-3333-3333-333333333333",
  "name": "Large",
  "price": 5,
  "isDefault": false,
  "isAvailable": true
}
```

---

### 4.4 GET group — wrong menuItemId (security: cross-item access)

```http
GET /menu-items/99999999-9999-9999-9999-999999999999/modifier-groups/33333333-3333-3333-3333-333333333333
```

Expected: `404 Not Found`  
Expected body: `{ "message": "Modifier group not found" }`

✅ Pass if 404 — group `33333333` belongs to item `22222222`, not `99999999`. The service validates the binding.

---

### 4.5 GET option — wrong groupId (security: cross-group access)

```http
GET /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups/33333333-3333-3333-3333-333333333333/options/55555555-5555-5555-5555-555555555555
Authorization: Bearer $RESTAURANT_TOKEN
```

Change the groupId to a random UUID that does NOT own option `55555555`:

```http
GET /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/options/55555555-5555-5555-5555-555555555555
```

Expected: `404 Not Found` — option does not belong to that group.

---

## Section 5: Edge Cases

### 5.1 null vs [] distinction in snapshot

After creating a fresh menu item with NO modifier groups:

```http
POST /menu-items
Authorization: Bearer $RESTAURANT_TOKEN
Content-Type: application/json

{
  "restaurantId": "11111111-1111-1111-1111-111111111111",
  "name": "Plain Item",
  "price": 9.99
}
```

Store returned `id` as `$PLAIN_ITEM_ID`.

```sql
SELECT modifiers FROM ordering_menu_item_snapshots
WHERE menu_item_id = '$PLAIN_ITEM_ID';
-- Expected: [] (empty array, NOT null)
```

Now update it:

```http
PATCH /menu-items/$PLAIN_ITEM_ID
Authorization: Bearer $RESTAURANT_TOKEN
Content-Type: application/json

{ "price": 10.99 }
```

```sql
SELECT modifiers FROM ordering_menu_item_snapshots
WHERE menu_item_id = '$PLAIN_ITEM_ID';
-- Expected: [] (still empty array — null-sentinel preserved the existing [] value)
```

✅ Pass if `modifiers = []` after update (not `null`).

---

### 5.2 min/max edge cases on create

**minSelections = 0, maxSelections = 0 — should this pass?**

```http
POST /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups
Authorization: Bearer $RESTAURANT_TOKEN
Content-Type: application/json

{
  "name": "Optional Note",
  "minSelections": 0,
  "maxSelections": 0
}
```

Current behavior: `validateMinMax(0, 0)` → passes (max >= min).  
Expected: `201 Created`. (This is a valid group where the customer selects nothing — optional free-text style.)

**minSelections = 2, maxSelections = 1 — should fail**

```http
POST /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups
Authorization: Bearer $RESTAURANT_TOKEN
Content-Type: application/json

{
  "name": "Bad Group",
  "minSelections": 2,
  "maxSelections": 1
}
```

Expected: `400 Bad Request` — `maxSelections (1) must be ≥ minSelections (2)`.

---

### 5.3 Group with zero options — snapshot reflects empty options array

Create a group with no options:

```http
POST /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups
Authorization: Bearer $RESTAURANT_TOKEN
Content-Type: application/json

{ "name": "Empty Group", "minSelections": 0, "maxSelections": 1 }
```

Store `$EMPTY_GROUP_ID`.

```sql
SELECT modifiers FROM ordering_menu_item_snapshots
WHERE menu_item_id = '22222222-2222-2222-2222-222222222222';
-- The "Empty Group" entry should appear with options: []
```

✅ Pass if the group appears in the snapshot with `"options": []`.

---

### 5.4 Unauthenticated write — should be rejected

All write endpoints require `admin` or `restaurant` role.

```http
POST /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups
Content-Type: application/json

{ "name": "Hack Group" }
```

Expected: `401 Unauthorized`

```http
PATCH /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups/33333333-3333-3333-3333-333333333333
Content-Type: application/json

{ "name": "Hack" }
```

Expected: `401 Unauthorized`

---

### 5.5 Write by non-owner restaurant — should be forbidden

```http
POST /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups
Authorization: Bearer $OTHER_RESTAURANT_TOKEN
Content-Type: application/json

{ "name": "Intrusion" }
```

Expected: `403 Forbidden` — `"You do not own this menu item"`

---

### 5.6 ParseUUID guard — `options` literal as groupId

```http
GET /menu-items/22222222-2222-2222-2222-222222222222/modifier-groups/options
```

Expected: `400 Bad Request` (ParseUUIDPipe rejects the string "options").  
This is acceptable behavior (not ambiguous 404), and the explicit `GET :groupId/options` route now properly handles the real use-case.

---

## Section 6: Expected DB Snapshot State After Modifier Mutations

After all CRUD tests (assuming groups/options are created, not deleted), the snapshot row for item `22222222-2222-2222-2222-222222222222` should look like:

```sql
SELECT
  menu_item_id,
  name,
  price,
  status,
  jsonb_pretty(modifiers) AS modifiers,
  last_synced_at
FROM ordering_menu_item_snapshots
WHERE menu_item_id = '22222222-2222-2222-2222-222222222222';
```

Expected `modifiers` shape:

```json
[
  {
    "groupId": "33333333-3333-3333-3333-333333333333",
    "groupName": "Size",
    "minSelections": 1,
    "maxSelections": 1,
    "options": [
      {
        "optionId": "55555555-5555-5555-5555-555555555555",
        "name": "Small",
        "price": 0,
        "isDefault": true,
        "isAvailable": true
      },
      {
        "optionId": "44444444-4444-4444-4444-444444444444",
        "name": "Large",
        "price": 5,
        "isDefault": false,
        "isAvailable": true
      }
    ]
  }
]
```

### Snapshot invariants to verify

| Invariant | SQL check |
|---|---|
| `modifiers` is never `null` | `SELECT COUNT(*) FROM ordering_menu_item_snapshots WHERE modifiers IS NULL` → 0 |
| After item update (non-modifier), modifiers unchanged | Compare before/after JSON |
| After modifier create/update/delete, modifiers reflects new state | Check group/option count in JSONB |
| After item delete, `status = 'unavailable'` and `modifiers = '[]'` | Direct query |
| `lastSyncedAt` advances on every event | `SELECT last_synced_at` before and after any mutation |

---

## Quick Reference: Endpoint Table

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/menu-items/:id/modifier-groups` | Public | List all groups + options |
| `GET` | `/menu-items/:id/modifier-groups/:groupId` | Public | **[NEW]** Get one group + options |
| `GET` | `/menu-items/:id/modifier-groups/:groupId/options` | Public | **[NEW]** List options for group |
| `GET` | `/menu-items/:id/modifier-groups/:groupId/options/:optionId` | Public | **[NEW]** Get one option |
| `POST` | `/menu-items/:id/modifier-groups` | restaurant/admin | Create group |
| `PATCH` | `/menu-items/:id/modifier-groups/:groupId` | restaurant/admin | Update group |
| `DELETE` | `/menu-items/:id/modifier-groups/:groupId` | restaurant/admin | Delete group (cascades) |
| `POST` | `/menu-items/:id/modifier-groups/:groupId/options` | restaurant/admin | Add option to group |
| `PATCH` | `/menu-items/:id/modifier-groups/:groupId/options/:optionId` | restaurant/admin | Update option |
| `DELETE` | `/menu-items/:id/modifier-groups/:groupId/options/:optionId` | restaurant/admin | Delete option |
