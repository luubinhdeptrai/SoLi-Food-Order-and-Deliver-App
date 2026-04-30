# Cart + Modifier System — Test Scenarios

**Purpose:** End-to-end HTTP test cases covering every edge case in the Cart + Modifier
implementation. Each scenario specifies the request, expected status, and what to assert
in the response body or database.

**Prerequisites:**
- Docker containers running (`docker compose up -d`)
- A seeded restaurant and menu item with known IDs
- A valid JWT for a customer (set `X-Dev-User-Id` header in dev mode)
- Redis running and empty (or use a fresh customerId per scenario)

---

## Setup Reference

```
RESTAURANT_ID  = <uuid of a seeded restaurant>
ITEM_PLAIN     = <uuid of menu item with NO modifier groups>
ITEM_MODS      = <uuid of menu item with modifier groups>
GROUP_SIZE_ID  = <uuid of a "Size" group (minSelections=1, maxSelections=1)>
OPT_SMALL_ID   = <uuid of "Small" option, price=0, isDefault=true>
OPT_LARGE_ID   = <uuid of "Large" option, price=10000, isDefault=false>
GROUP_EXTRA_ID = <uuid of an optional "Extras" group (minSelections=0, maxSelections=2)>
OPT_CHEESE_ID  = <uuid of "Cheese" option, price=5000>
OPT_BACON_ID   = <uuid of "Bacon" option, price=8000>
```

---

## 1. Add item with no modifiers

**Scenario:** Plain item that has no modifier groups.

```http
POST /api/carts/my/items
Authorization: Bearer <token>
Content-Type: application/json

{
  "restaurantId": "{{RESTAURANT_ID}}",
  "menuItemId":   "{{ITEM_PLAIN}}",
  "quantity":     2,
  "selectedOptions": []
}
```

**Expected:** `201 Created`
```json
{
  "items": [
    {
      "cartItemId":        "<uuid>",
      "menuItemId":        "{{ITEM_PLAIN}}",
      "quantity":          2,
      "selectedModifiers": []
    }
  ]
}
```
- `cartItemId` is a non-empty UUID — clients must store this for PATCH/DELETE.
- `selectedModifiers` is an empty array.

---

## 2. Add item with a valid single-choice modifier

**Scenario:** Required "Size" group, customer picks "Large".

```http
POST /api/carts/my/items
Content-Type: application/json

{
  "restaurantId": "{{RESTAURANT_ID}}",
  "menuItemId":   "{{ITEM_MODS}}",
  "quantity":     1,
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_LARGE_ID}}" }
  ]
}
```

**Expected:** `201 Created`
```json
{
  "items": [
    {
      "cartItemId": "<uuid>",
      "selectedModifiers": [
        {
          "groupId":   "{{GROUP_SIZE_ID}}",
          "groupName": "Size",
          "optionId":  "{{OPT_LARGE_ID}}",
          "optionName":"Large",
          "price":     10000
        }
      ]
    }
  ]
}
```
- `price` comes from the ACL snapshot, NOT from the request payload.
- `unitPrice` in the cart item reflects the base item price only (modifiers are additive, stored separately).

---

## 3. Re-add same item with SAME modifiers → quantity merges

**Scenario:** Item already in cart; add again with identical modifier selection.

1. `POST /api/carts/my/items` with `ITEM_MODS` + Large → `201`, quantity=1, cartItemId=A
2. `POST /api/carts/my/items` with `ITEM_MODS` + Large → `200`, quantity=2, cartItemId=A (same)

**Expected:**
- Cart has **one** line item, not two.
- `cartItemId` is unchanged.
- `quantity` incremented to 2.
- `modifierFingerprint` is identical (merge identity is `menuItemId + fingerprint`).

---

## 4. Re-add same item with DIFFERENT modifiers → separate line items

**Scenario:** Add `ITEM_MODS` + Small, then add `ITEM_MODS` + Large.

1. `POST` with `OPT_SMALL_ID` → `201`, cartItemId=A
2. `POST` with `OPT_LARGE_ID` → `201`, cartItemId=B

**Expected:**
- Cart has **two** line items (A and B).
- Each has distinct `cartItemId` and `selectedModifiers`.
- They do NOT merge because `modifierFingerprint` differs.

---

## 5. Add with invalid groupId → 400

**Scenario:** `groupId` does not exist in the snapshot for this item.

```json
{
  "restaurantId": "{{RESTAURANT_ID}}",
  "menuItemId":   "{{ITEM_MODS}}",
  "quantity":     1,
  "selectedOptions": [
    { "groupId": "00000000-0000-0000-0000-000000000000", "optionId": "{{OPT_LARGE_ID}}" }
  ]
}
```

**Expected:** `400 Bad Request`
```json
{ "message": "Modifier group ... does not exist on ..." }
```

---

## 6. Add with invalid optionId within a valid group → 400

**Scenario:** `groupId` is valid but `optionId` doesn't belong to it.

```json
{
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "00000000-0000-0000-0000-000000000000" }
  ]
}
```

**Expected:** `400 Bad Request`
```json
{ "message": "Modifier option ... does not exist in group ..." }
```

---

## 7. Add with `isAvailable=false` modifier option → 400

**Scenario:** The option exists in the snapshot but `isAvailable` is `false`.

*Setup:* Set `OPT_BACON_ID.isAvailable = false` via the restaurant owner API, then trigger a `MenuItemUpdatedEvent` so the snapshot updates.

```json
{
  "selectedOptions": [
    { "groupId": "{{GROUP_EXTRA_ID}}", "optionId": "{{OPT_BACON_ID}}" }
  ]
}
```

**Expected:** `400 Bad Request`
```json
{ "message": "Modifier option \"Bacon\" is not currently available" }
```

---

## 8. Add with `minSelections` violated and no default → 400

**Scenario:** Required group (minSelections=1) with no default option and customer sends no selection.

*Setup:* Set `GROUP_SIZE_ID.minSelections=1`, ensure `OPT_SMALL_ID.isDefault=false`.

```json
{
  "menuItemId":   "{{ITEM_MODS}}",
  "selectedOptions": []
}
```

**Expected:** `400 Bad Request`
```json
{ "message": "Group \"Size\" requires at least 1 selection" }
```

---

## 9. Add with required group, default option available → auto-inject default

**Scenario:** Required group (minSelections=1), customer sends no selection, `OPT_SMALL_ID.isDefault=true`.

```json
{
  "menuItemId":   "{{ITEM_MODS}}",
  "selectedOptions": []
}
```

**Expected:** `201 Created`
```json
{
  "selectedModifiers": [
    {
      "groupId":   "{{GROUP_SIZE_ID}}",
      "optionName":"Small",
      "price":     0
    }
  ]
}
```
- Default was auto-injected BEFORE `minSelections` check — no 400 error.
- `quantity` from the request is preserved.

---

## 10. Add with `maxSelections` exceeded → 400

**Scenario:** "Size" group has `maxSelections=1` but customer selects both Small and Large.

```json
{
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_SMALL_ID}}" },
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_LARGE_ID}}" }
  ]
}
```

**Expected:** `400 Bad Request`
```json
{ "message": "Group \"Size\" allows at most 1 selection" }
```

---

## 11. Add with snapshot absent but `selectedOptions` non-empty → 400

**Scenario:** Menu item exists in the menu but NOT in `ordering_menu_item_snapshots` (projector has not yet run), and customer passes non-empty modifier selections.

**Expected:** `400 Bad Request`
```json
{ "message": "Menu item snapshot not found ..." }
```
- If `selectedOptions` is empty, the item is still added (graceful degradation — snapshot only required for modifier resolution).

---

## 12. PATCH modifiers — change option within a group

**Setup:** Item in cart with cartItemId=A, currently has `OPT_SMALL_ID` selected.

```http
PATCH /api/carts/my/items/{{cartItemId_A}}/modifiers
Content-Type: application/json

{
  "selectedOptions": [
    { "groupId": "{{GROUP_SIZE_ID}}", "optionId": "{{OPT_LARGE_ID}}" }
  ]
}
```

**Expected:** `200 OK`
```json
{
  "items": [
    {
      "cartItemId": "{{cartItemId_A}}",
      "selectedModifiers": [{ "optionName": "Large", "price": 10000 }],
      "quantity": 1
    }
  ]
}
```
- `quantity` is unchanged (PATCH modifiers does not affect quantity).
- `modifierFingerprint` is updated internally.

---

## 13. PATCH modifiers — clear optional modifiers

**Setup:** Item has optional extras selected. Customer wants to clear them.

```http
PATCH /api/carts/my/items/{{cartItemId}}/modifiers
Content-Type: application/json

{ "selectedOptions": [] }
```

**Expected:** `200 OK` (or `204` if no body)
- `selectedModifiers` is `[]`.
- Item remains in cart (not removed).

---

## 14. PATCH quantity — modifiers unchanged

```http
PATCH /api/carts/my/items/{{cartItemId}}
Content-Type: application/json

{ "quantity": 3 }
```

**Expected:** `200 OK`
- `quantity` updated to 3.
- `selectedModifiers` is unchanged.
- `cartItemId` is unchanged.

---

## 15. PATCH quantity to 0 → item removed

```http
PATCH /api/carts/my/items/{{cartItemId}}
Content-Type: application/json

{ "quantity": 0 }
```

**Expected:** `200 OK` (cart returned without that item) or `204 No Content`.
- Item is removed from the cart entirely.

---

## 16. DELETE cart item

```http
DELETE /api/carts/my/items/{{cartItemId}}
```

**Expected:** `200 OK` or `204 No Content`.
- Item is absent from subsequent `GET /api/carts/my`.

---

## 17. POST checkout — correct pricing with modifiers

**Setup:** Cart has one item (quantity=2), base price=50000, selected modifier price=10000.

```http
POST /api/orders/checkout
Content-Type: application/json

{
  "deliveryAddress": { "street": "123 Test St", "district": "D1", "city": "HCM" },
  "paymentMethod": "cod"
}
```

**Expected:** `201 Created`
```json
{
  "totalAmount": 120000
}
```
Calculation: `(50000 + 10000) × 2 = 120000`

Assert in DB (`order_items` row):
```
unit_price      = 50000   (base only — NOT inflated by modifiers)
modifiers_price = 10000
quantity        = 2
subtotal        = 120000
```

---

## 18. POST checkout — `order_items.modifiers` contains modifier snapshot

After successful checkout, query:
```sql
SELECT modifiers FROM order_items WHERE order_id = '<new_order_id>';
```

**Expected JSONB:**
```json
[
  {
    "groupId":   "{{GROUP_SIZE_ID}}",
    "groupName": "Size",
    "optionId":  "{{OPT_LARGE_ID}}",
    "optionName":"Large",
    "price":     10000
  }
]
```
- This snapshot was re-resolved from the ACL at checkout time (not copied from the cart).

---

## 19. POST checkout — stale modifier option (removed after cart add) → 422

**Setup:**
1. Add item to cart with `OPT_BACON_ID` selected.
2. Restaurant owner deletes `OPT_BACON_ID` via the modifier API (triggers `MenuItemUpdatedEvent` → snapshot updates).
3. Attempt checkout.

**Expected:** `422 Unprocessable Entity`
```json
{ "message": "Modifier option \"Bacon\" no longer exists. Please update your cart." }
```

---

## 20. POST checkout — modifier option `isAvailable=false` at checkout → 422

**Setup:**
1. Add item to cart with `OPT_LARGE_ID` selected.
2. Restaurant owner marks `OPT_LARGE_ID.isAvailable = false` (snapshot updates).
3. Attempt checkout.

**Expected:** `422 Unprocessable Entity`
```json
{ "message": "Modifier option \"Large\" is no longer available. Please update your cart." }
```

---

## 21. POST checkout — `minSelections` raised after cart add → 422

**Setup:**
1. Add item with no modifier (auto-injected default satisfies minSelections=1).
2. Restaurant raises `minSelections` to 2 on "Size" group (snapshot updates).
3. Attempt checkout — cart only has 1 selection.

**Expected:** `422 Unprocessable Entity`
```json
{ "message": "Modifier group \"Size\" now requires at least 2 selection(s)..." }
```

---

## 22. Existing Redis cart back-fill (migration compat)

**Scenario:** Customer has a cart in Redis that was created before `cartItemId` and `modifierFingerprint` were introduced.

**Expected on `GET /api/carts/my`:**
- Each item has a non-empty `cartItemId` (UUID) — back-filled by `CartRedisRepository.findByCustomerId`.
- `selectedModifiers` is unchanged.
- PATCH/DELETE using the back-filled `cartItemId` works correctly.
- The back-filled values are persisted on the next write mutation (not on read — no phantom Redis writes).

---

## Summary Table

| # | Method | Path | Input condition | Expected status |
|---|--------|------|-----------------|-----------------|
| 1 | POST | `/carts/my/items` | No modifiers | 201 |
| 2 | POST | `/carts/my/items` | Valid modifier | 201, price from snapshot |
| 3 | POST | `/carts/my/items` | Same item + same mods | 200, merged |
| 4 | POST | `/carts/my/items` | Same item + diff mods | 201, new line item |
| 5 | POST | `/carts/my/items` | Invalid groupId | 400 |
| 6 | POST | `/carts/my/items` | Invalid optionId | 400 |
| 7 | POST | `/carts/my/items` | `isAvailable=false` | 400 |
| 8 | POST | `/carts/my/items` | minSelections violated, no default | 400 |
| 9 | POST | `/carts/my/items` | Required group, default present | 201, auto-injected |
| 10 | POST | `/carts/my/items` | maxSelections exceeded | 400 |
| 11 | POST | `/carts/my/items` | No snapshot + non-empty selectedOptions | 400 |
| 12 | PATCH | `/carts/my/items/:id/modifiers` | Change option | 200, quantity unchanged |
| 13 | PATCH | `/carts/my/items/:id/modifiers` | Clear optional mods | 200 |
| 14 | PATCH | `/carts/my/items/:id` | quantity update | 200, mods unchanged |
| 15 | PATCH | `/carts/my/items/:id` | quantity=0 | 200/204, item removed |
| 16 | DELETE | `/carts/my/items/:id` | Remove item | 200/204 |
| 17 | POST | `/orders/checkout` | Pricing: (base+mods)×qty | 201, totalAmount correct |
| 18 | POST | `/orders/checkout` | Modifier snapshot in DB | 201, `order_items.modifiers` populated |
| 19 | POST | `/orders/checkout` | Option deleted after cart add | 422 |
| 20 | POST | `/orders/checkout` | Option `isAvailable=false` at checkout | 422 |
| 21 | POST | `/orders/checkout` | minSelections raised after cart add | 422 |
| 22 | GET | `/carts/my` | Old Redis cart (no cartItemId) | 200, back-filled cartItemId |
