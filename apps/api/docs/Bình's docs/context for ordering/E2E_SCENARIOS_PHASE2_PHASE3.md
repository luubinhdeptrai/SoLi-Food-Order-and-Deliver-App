# E2E Test Scenarios — Phase 2 (Cart) & Phase 3 (ACL Layer)

> **Purpose**: Human-readable specification of every E2E test case for the Cart module (Phase 2)
> and the ACL / Snapshot projection layer (Phase 3).  
> **Format**: Follows the [E2E_TESTING_PLAYBOOK.md](../E2E_TESTING_PLAYBOOK.md) standard —
> Arrange → Act → Assert (HTTP) → Assert (DB) per scenario.  
> **Status**: Scenarios only — no code yet. Implement against `test/e2e/cart.e2e-spec.ts`
> and `test/e2e/acl.e2e-spec.ts`.

---

## Conventions

| Symbol               | Meaning                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ownerHeaders()`     | `Authorization: Bearer <ownerToken>` — authenticated owner (`restaurant.ownerId === session.user.id`)          |
| `otherUserHeaders()` | `Authorization: Bearer <otherToken>` — authenticated non-owner                                                 |
| `noAuthHeaders()`    | `{}` — no Authorization header → 401 on guarded endpoints                                                      |
| `TEST_RESTAURANT_ID` | `'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'` — fixed UUID seeded via `seedBaseRestaurant()`                        |
| `await delay(100)`   | `await new Promise(r => setTimeout(r, 100))` — give in-process EventBus time to propagate before DB assertions |
| **→ 404**            | Assert `res.status === 404`                                                                                    |
| `CartResponseDto`    | `{ cartId, customerId, restaurantId, restaurantName, items[], totalAmount, createdAt, updatedAt }`             |

### Shared `beforeAll` Template (both cart.e2e-spec.ts and acl.e2e-spec.ts)

```
app = createTestApp()
http = request(app.getHttpServer())
resetDb()
testAuth = new TestAuthManager()
testAuth.initialize(http)           // signs up ownerUser + otherUser, grants 'restaurant' role
setAuthManager(testAuth)
seedBaseRestaurant(testAuth.ownerUserId)
// then spec-specific HTTP seeding
```

### Common Test Fixture Data

```
MENU_ITEM_A = {
  restaurantId: TEST_RESTAURANT_ID,
  name: 'Margherita Pizza',
  price: 12.50,
}

MENU_ITEM_B_NO_MODIFIERS = {
  restaurantId: TEST_RESTAURANT_ID,
  name: 'Garlic Bread',
  price: 5.00,
}

MENU_ITEM_WITH_REQUIRED_GROUP = {
  restaurantId: TEST_RESTAURANT_ID,
  name: 'Custom Burger',
  price: 15.00,
}

MODIFIER_GROUP_REQUIRED = {
  menuItemId: <from HTTP>,
  name: 'Choose Sauce',
  minSelections: 1,
  maxSelections: 1,
}

MODIFIER_OPTION_DEFAULT = {
  groupId: <from HTTP>,
  name: 'BBQ',
  price: 0,
  isDefault: true,
  isAvailable: true,
}

MODIFIER_OPTION_NON_DEFAULT = {
  groupId: <from HTTP>,
  name: 'Sriracha',
  price: 0.50,
  isDefault: false,
  isAvailable: true,
}

MODIFIER_GROUP_OPTIONAL = {
  menuItemId: <from HTTP>,
  name: 'Extra Toppings',
  minSelections: 0,
  maxSelections: 2,
}

DELIVERY_ADDRESS = {
  street: '123 Nguyen Hue Blvd',
  district: 'District 1',
  city: 'Ho Chi Minh City',
}
```

---

## Part A — Phase 2: Cart Module

### §1 Cart Read

---

#### [C-01] Scenario 1 — GET /carts/my returns null when no cart exists

**Description:**  
A freshly authenticated customer has no cart in Redis. The endpoint returns HTTP 200 with a `null` body.

**Arrange:**

- `resetDb()` + `testAuth.initialize(http)` — clean state, no cart for ownerUser
- No items added to cart

**Act:**

- `GET /api/carts/my` with `ownerHeaders()`

**Assert (HTTP):**

- Status: `200`
- Body: `null`

**Assert (DB):**

- N/A (Redis only — no DB assertion needed)

---

#### [C-02] Scenario 2 — GET /carts/my returns full CartResponseDto shape after item is added

**Description:**  
Verify all fields of the `CartResponseDto` are present and correctly typed after adding one item.

**Arrange:**

- Seed a menu item via `POST /api/menu-items` → get `menuItemId`
- Add item to cart via `POST /api/carts/my/items`

**Act:**

- `GET /api/carts/my` with `ownerHeaders()`

**Assert (HTTP):**

- Status: `200`
- Body shape:
  ```
  {
    cartId: <uuid>,
    customerId: <ownerUserId>,
    restaurantId: TEST_RESTAURANT_ID,
    restaurantName: 'E2E Test Restaurant',
    items: [{
      cartItemId: <uuid>,
      menuItemId: <seeded menuItemId>,
      itemName: 'Margherita Pizza',
      unitPrice: 12.50,
      quantity: 1,
      subtotal: 12.50,
      selectedModifiers: [],
    }],
    totalAmount: 12.50,
    createdAt: <ISO string>,
    updatedAt: <ISO string>,
  }
  ```

**Assert (DB):**

- N/A (Redis only)

---

#### [C-03] Scenario 3 — cartId is stable across all mutations

**Description:**  
The `cartId` UUID is generated once on first item add and must not change on subsequent adds, patches, or deletes.

**Arrange:**

- Add item A to cart → capture `cartId`
- Add item B to cart
- PATCH item A quantity

**Act:**

- `GET /api/carts/my` with `ownerHeaders()`

**Assert (HTTP):**

- Status: `200`
- `body.cartId === <captured cartId>` (exact same value throughout all operations)

**Assert (DB):**

- N/A

---

### §2 Add Item — Merge Logic

---

#### [C-04] Scenario 4 — Add item (no modifiers) → creates cart, returns 201

**Description:**  
First item add initializes the cart with a new `cartId`, sets `restaurantId`, and returns the full cart.

**Arrange:**

- Clean state: no cart in Redis for ownerUser
- Menu item seeded via `POST /api/menu-items` → `menuItemId`

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body:
  ```json
  {
    "menuItemId": "<menuItemId>",
    "restaurantId": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    "restaurantName": "E2E Test Restaurant",
    "itemName": "Margherita Pizza",
    "unitPrice": 12.5,
    "quantity": 1
  }
  ```

**Assert (HTTP):**

- Status: `201`
- `body.cartId` is a non-null UUID
- `body.restaurantId === TEST_RESTAURANT_ID`
- `body.items.length === 1`
- `body.items[0].quantity === 1`
- `body.items[0].selectedModifiers` is `[]`
- `body.totalAmount === 12.50`

**Assert (DB):**

- N/A

---

#### [C-05] Scenario 5 — Add same item again (no modifiers) → merges quantity into existing line

**Description:**  
Two calls to `POST /api/carts/my/items` with the same `menuItemId` and no modifiers must produce
a single cart line item with combined quantity, not two separate lines.
`modifierFingerprint` is `''` for both → same identity → merge.

**Arrange:**

- Add menuItemA with `quantity: 2` → line L1

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Same `menuItemId`, same body, `quantity: 1`

**Assert (HTTP):**

- Status: `201`
- `body.items.length === 1` (one line item, not two)
- `body.items[0].quantity === 3` (2 + 1 merged)
- `body.items[0].cartItemId === <L1.cartItemId>` (same stable line-item ID)
- `body.totalAmount === 37.50` (3 × 12.50)

**Assert (DB):**

- N/A

---

#### [C-06] Scenario 6 — Add same menuItemId with different modifier selections → appends new line

**Description:**  
Same `menuItemId` but with a different modifier selection yields a different `modifierFingerprint`.
The service must **append** a new line item rather than merge.

**Arrange:**

- Seed menu item with one optional modifier group (minSelections=0), two options: `OPT-1` (no-charge), `OPT-2` ($1.00)
- Event propagates → snapshot row created (use `await delay(100)`)
- Add item with `selectedOptions: [{ groupId, optionId: OPT-1 }]` → line L1

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Same `menuItemId`, `quantity: 1`, `selectedOptions: [{ groupId, optionId: OPT-2 }]`

**Assert (HTTP):**

- Status: `201`
- `body.items.length === 2`
- `body.items[0].cartItemId !== body.items[1].cartItemId`
- Each line has `quantity === 1`
- Line with OPT-1: `selectedModifiers[0].optionId === OPT-1`
- Line with OPT-2: `selectedModifiers[0].optionId === OPT-2`, `selectedModifiers[0].price === 1.00`
- `body.totalAmount === 12.50 + 13.50` (prices: base + modifier)

**Assert (DB):**

- N/A

---

#### [C-07] Scenario 7 — totalAmount is sum of all line subtotals including modifier prices

**Description:**  
Verify the `totalAmount` and per-item `subtotal` calculations:  
`subtotal = (unitPrice + Σ modifier.price) × quantity`.  
`totalAmount = Σ subtotals`.

**Arrange:**

- Seed item (price 10.00) with one optional modifier (price 2.50)
- `await delay(100)` for snapshot
- Add item with modifier, `quantity: 3`

**Act:**

- `GET /api/carts/my` with `ownerHeaders()`

**Assert (HTTP):**

- Status: `200`
- `body.items[0].subtotal === 37.50` ((10.00 + 2.50) × 3)
- `body.totalAmount === 37.50`

**Assert (DB):**

- N/A

---

### §3 PATCH — Update Quantity

---

#### [C-08] Scenario 8 — PATCH quantity sets absolute value → returns 200 with updated cart

**Description:**  
`PATCH /carts/my/items/:cartItemId` sets the absolute quantity, not increments it.
The response is the full updated cart.

**Arrange:**

- Add item with `quantity: 1` → capture `cartItemId`

**Act:**

- `PATCH /api/carts/my/items/<cartItemId>` with `ownerHeaders()`  
  Body: `{ "quantity": 5 }`

**Assert (HTTP):**

- Status: `200`
- `body.items[0].quantity === 5`
- `body.items[0].cartItemId === <cartItemId>` (same line, unchanged)
- `body.items[0].selectedModifiers` is unchanged (PATCH qty NEVER touches modifiers)

**Assert (DB):**

- N/A

---

#### [C-09] Scenario 9 — PATCH quantity=0 removes the item; returns 204 when cart becomes empty

**Description:**  
`quantity=0` is equivalent to `DELETE /carts/my/items/:cartItemId`.
When the last item is removed, the cart is deleted from Redis and the endpoint returns `204 No Content`.

**Arrange:**

- Add one item → capture `cartItemId`

**Act:**

- `PATCH /api/carts/my/items/<cartItemId>` with `ownerHeaders()`  
  Body: `{ "quantity": 0 }`

**Assert (HTTP):**

- Status: `204`
- Body is empty

**Follow-up assertion:**

- `GET /api/carts/my` → Status `200`, body `null`

**Assert (DB):**

- N/A

---

#### [C-10] Scenario 10 — PATCH quantity=0 on non-last item removes that line, cart remains with others

**Description:**  
When the cart has two lines and PATCH quantity=0 targets one of them, only that line is removed.
The remaining line is returned in a `200` response body.

**Arrange:**

- Add item A (line L1), add item B (line L2) → capture `L1.cartItemId`

**Act:**

- `PATCH /api/carts/my/items/<L1.cartItemId>` with `ownerHeaders()`  
  Body: `{ "quantity": 0 }`

**Assert (HTTP):**

- Status: `200`
- `body.items.length === 1`
- `body.items[0].menuItemId === <itemB menuItemId>`

**Assert (DB):**

- N/A

---

#### [C-11] Scenario 11 — PATCH quantity never modifies selectedModifiers

**Description:**  
Updating quantity must not alter the `selectedModifiers` of the targeted line item.
This guards the Section 4.2 anti-pattern (Case 15 regression prevention).

**Arrange:**

- Seed item with optional modifier group, snapshot ready
- Add item with modifier OPT-1 selected → capture `cartItemId` and `selectedModifiers`

**Act:**

- `PATCH /api/carts/my/items/<cartItemId>` with `ownerHeaders()`  
  Body: `{ "quantity": 4 }`

**Assert (HTTP):**

- Status: `200`
- `body.items[0].quantity === 4`
- `body.items[0].selectedModifiers` is identical to pre-patch value (same optionId, price, groupName)

**Assert (DB):**

- N/A

---

### §4 PATCH — Update Modifiers

---

#### [C-12] Scenario 12 — PATCH modifiers replaces entire modifier set, quantity unchanged

**Description:**  
`PATCH /carts/my/items/:cartItemId/modifiers` replaces `selectedModifiers` in full (replace semantics).
The item's `quantity` must be unchanged. The `modifierFingerprint` updates internally.

**Arrange:**

- Seed item with optional modifier group (2 options: OPT-1, OPT-2)
- Snapshot ready (`await delay(100)`)
- Add item with OPT-1 selected, `quantity: 3` → capture `cartItemId`

**Act:**

- `PATCH /api/carts/my/items/<cartItemId>/modifiers` with `ownerHeaders()`  
  Body: `{ "selectedOptions": [{ "groupId": <gId>, "optionId": <OPT-2 id> }] }`

**Assert (HTTP):**

- Status: `200`
- `body.items[0].quantity === 3` (unchanged)
- `body.items[0].selectedModifiers.length === 1`
- `body.items[0].selectedModifiers[0].optionId === <OPT-2 id>` (replaced)
- No trace of OPT-1 in `selectedModifiers`

**Assert (DB):**

- N/A

---

#### [C-13] Scenario 13 — PATCH modifiers with [] clears all modifiers (optional-only item)

**Description:**  
Sending `selectedOptions: []` on an item whose modifier groups all have `minSelections=0`
results in an empty `selectedModifiers` array.

**Arrange:**

- Seed item with one optional group (minSelections=0), one option selected
- Add item with modifier selected → capture `cartItemId`

**Act:**

- `PATCH /api/carts/my/items/<cartItemId>/modifiers` with `ownerHeaders()`  
  Body: `{ "selectedOptions": [] }`

**Assert (HTTP):**

- Status: `200`
- `body.items[0].selectedModifiers === []`

**Assert (DB):**

- N/A

---

#### [C-14] Scenario 14 — PATCH modifiers updates fingerprint; subsequent add with new set merges correctly

**Description:**  
After updating modifiers, the internal `modifierFingerprint` changes. A subsequent `POST /carts/my/items`
with the NEW modifier set must merge into the updated line (same fingerprint now).

**Arrange:**

- Seed item with optional group (OPT-1, OPT-2)
- Add with OPT-1 → line L1
- PATCH modifiers of L1 to OPT-2

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()` — same menuItemId, `selectedOptions: [OPT-2]`, `quantity: 1`

**Assert (HTTP):**

- Status: `201`
- `body.items.length === 1` (merged, not appended)
- `body.items[0].quantity === 2` (merged)
- `body.items[0].selectedModifiers[0].optionId === <OPT-2 id>`

**Assert (DB):**

- N/A

---

#### [C-15] Scenario 15 — After PATCH modifiers, add with OLD modifier set creates new separate line

**Description:**  
After updating line L1 from OPT-1 to OPT-2, adding the same item with OPT-1 again produces
a second line (different fingerprint now).

**Arrange:**

- Add item with OPT-1 → line L1 (fingerprint = FP-OPT1)
- PATCH L1 modifiers → OPT-2 (fingerprint = FP-OPT2)

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()` — same menuItemId, `selectedOptions: [OPT-1]`, `quantity: 1`

**Assert (HTTP):**

- Status: `201`
- `body.items.length === 2` (new line added)
- One line has OPT-2, the other has OPT-1
- Both have `quantity: 1`

**Assert (DB):**

- N/A

---

### §5 Remove & Clear

---

#### [C-16] Scenario 16 — DELETE /carts/my/items/:cartItemId removes line; returns 200 with remaining items

**Description:**  
When cart has two lines and one is deleted by `cartItemId`, the remaining line is returned in the body.

**Arrange:**

- Add item A (line L1), add item B (line L2) → capture `L1.cartItemId`

**Act:**

- `DELETE /api/carts/my/items/<L1.cartItemId>` with `ownerHeaders()`

**Assert (HTTP):**

- Status: `200`
- `body.items.length === 1`
- `body.items[0].menuItemId === <itemB.menuItemId>`
- L1 is absent from the response

**Assert (DB):**

- N/A

---

#### [C-17] Scenario 17 — DELETE last item returns 204; subsequent GET returns null

**Description:**  
Removing the last line item deletes the Redis key entirely. The response is `204 No Content`,
and a subsequent GET returns `null`.

**Arrange:**

- Add one item → capture `cartItemId`

**Act:**

- `DELETE /api/carts/my/items/<cartItemId>` with `ownerHeaders()`

**Assert (HTTP):**

- Status: `204`
- Body is empty

**Follow-up assertion:**

- `GET /api/carts/my` → Status `200`, body `null`

**Assert (DB):**

- N/A

---

#### [C-18] Scenario 18 — DELETE /carts/my clears entire cart; returns 204

**Description:**  
`DELETE /carts/my` removes the entire cart from Redis regardless of how many items it contains.

**Arrange:**

- Add two items (L1, L2)

**Act:**

- `DELETE /api/carts/my` with `ownerHeaders()`

**Assert (HTTP):**

- Status: `204`
- Body is empty

**Follow-up assertion:**

- `GET /api/carts/my` → Status `200`, body `null`

**Assert (DB):**

- N/A

---

#### [C-19] Scenario 19 — DELETE /carts/my is idempotent when no cart exists

**Description:**  
Calling `DELETE /carts/my` when no cart exists must not throw. It is a no-op, still returning `204`.

**Arrange:**

- Clean state (no cart for ownerUser)

**Act:**

- `DELETE /api/carts/my` with `ownerHeaders()`

**Assert (HTTP):**

- Status: `204`

**Assert (DB):**

- N/A

---

### §6 Business Rule BR-2 — Single-Restaurant Cart

---

#### [C-20] Scenario 20 — Adding item from a different restaurant returns 409 Conflict

**Description:**  
BR-2: all items in a cart must belong to the same restaurant. Attempting to add an item with
`restaurantId` different from the existing cart's `restaurantId` must return `409 Conflict`.

**Arrange:**

- Add item A with `restaurantId: TEST_RESTAURANT_ID` → cart established for TEST_RESTAURANT_ID

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body has `restaurantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'` (a different restaurant ID)

**Assert (HTTP):**

- Status: `409`
- `body.message` contains text about "different restaurant" or "Clear your cart"

**Assert (DB):**

- N/A

---

#### [C-21] Scenario 21 — After clearing cart, items from a different restaurant can be added (201)

**Description:**  
BR-2 only blocks during an active cart. After `DELETE /carts/my`, the cart is gone and
a new item from any restaurant must succeed.

**Arrange:**

- Add item from TEST_RESTAURANT_ID → cart established
- `DELETE /api/carts/my` → 204

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body has `restaurantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'` (different restaurant)

**Assert (HTTP):**

- Status: `201`
- `body.restaurantId === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'`

**Assert (DB):**

- N/A

---

### §7 Modifier Validation

---

#### [C-22] Scenario 22 — Auto-inject default when required group has no explicit selection

**Description:**  
When a modifier group has `minSelections=1` and one of its options has `isDefault=true, isAvailable=true`,
and the client sends no selection for that group, the server auto-injects the default option.
The cart line must contain the default option in `selectedModifiers`.

**Arrange:**

- Seed item, add required modifier group (minSelections=1, maxSelections=1), add two options:
  - DEFAULT option (isDefault=true, isAvailable=true, price 0.00)
  - OTHER option (isDefault=false, isAvailable=true, price 1.00)
- `await delay(100)` for snapshot propagation

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body includes `selectedOptions: []` (no explicit selection)

**Assert (HTTP):**

- Status: `201`
- `body.items[0].selectedModifiers.length === 1`
- `body.items[0].selectedModifiers[0].optionId === <DEFAULT option id>`
- `body.items[0].selectedModifiers[0].price === 0.00`

**Assert (DB):**

- N/A

---

#### [C-23] Scenario 23 — minSelections not met and no default available → 400

**Description:**  
When a required group (minSelections=1) has no options marked `isDefault=true` (or none available),
and the client sends no selection, the server cannot auto-inject → must return `400`.

**Arrange:**

- Seed item with required modifier group (minSelections=1), one option with `isDefault=false`
- `await delay(100)` for snapshot

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body includes `selectedOptions: []`

**Assert (HTTP):**

- Status: `400`
- `body.message` mentions the group name and "requires at least 1 selection"

**Assert (DB):**

- N/A

---

#### [C-24] Scenario 24 — maxSelections exceeded → 400

**Description:**  
Sending more options for a group than `maxSelections` allows returns `400`.

**Arrange:**

- Seed item with optional group (minSelections=0, maxSelections=2), three options (OPT-1, OPT-2, OPT-3)
- `await delay(100)` for snapshot

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body includes all three options selected: `selectedOptions: [OPT-1, OPT-2, OPT-3]`

**Assert (HTTP):**

- Status: `400`
- `body.message` mentions the group name and "allows at most 2"

**Assert (DB):**

- N/A

---

#### [C-25] Scenario 25 — Invalid groupId → 400

**Description:**  
Sending a `groupId` that does not exist on the menu item's snapshot returns `400`.

**Arrange:**

- Seed item (no modifier groups), snapshot ready

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body includes `selectedOptions: [{ groupId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', optionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }]`

**Assert (HTTP):**

- Status: `400`
- `body.message` mentions "does not exist on this menu item"

**Assert (DB):**

- N/A

---

#### [C-26] Scenario 26 — Valid groupId but invalid optionId → 400

**Description:**  
A `groupId` that exists on the item but an `optionId` that is not in that group returns `400`.

**Arrange:**

- Seed item with one optional group (one option OPT-1), snapshot ready

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body: `selectedOptions: [{ groupId: <valid gId>, optionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }]`

**Assert (HTTP):**

- Status: `400`
- `body.message` mentions "does not exist in group"

**Assert (DB):**

- N/A

---

#### [C-27] Scenario 27 — Unavailable modifier option (isAvailable=false) → 400

**Description:**  
Case 11 fix: selecting a modifier option where `isAvailable=false` in the snapshot must be rejected.

**Arrange:**

- Seed item with optional group, add two options: OPT-AVAIL (isAvailable=true) and OPT-UNAVAIL (isAvailable=false)
- `await delay(100)` for snapshot

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body: `selectedOptions: [{ groupId: <gId>, optionId: <OPT-UNAVAIL id> }]`

**Assert (HTTP):**

- Status: `400`
- `body.message` mentions "currently unavailable"

**Assert (DB):**

- N/A

---

#### [C-28] Scenario 28 — selectedOptions sent but no snapshot exists → 400

**Description:**  
Case 2 fix: if the client sends modifier selections but the menu item has no snapshot row
(projector not yet run), the server cannot validate → must return `400`.

**Arrange:**

- Do NOT create the menu item via the API (no event fired, no snapshot row)
- Use a freshly-generated UUID as `menuItemId`

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body includes `selectedOptions: [{ groupId: <uuid>, optionId: <uuid> }]`

**Assert (HTTP):**

- Status: `400`
- `body.message` mentions "no local snapshot"

**Assert (DB):**

- N/A

---

#### [C-29] Scenario 29 — No snapshot + no selectedOptions → 201 (trusts client)

**Description:**  
When no snapshot exists but `selectedOptions` is absent (or empty), the server trusts the
client-supplied item name and price and adds the item. This is the Phase 2 fallback behavior.

**Arrange:**

- Use a freshly-generated UUID as `menuItemId` (no snapshot)

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body includes `menuItemId: <new uuid>`, no `selectedOptions` field

**Assert (HTTP):**

- Status: `201`
- `body.items[0].selectedModifiers === []`
- `body.items[0].itemName === <client-supplied name>`
- `body.items[0].unitPrice === <client-supplied price>`

**Assert (DB):**

- N/A

---

#### [C-30] Scenario 30 — Item snapshot status=unavailable → 409

**Description:**  
If the menu item's ACL snapshot shows `status=unavailable` (deleted item), the server rejects
the add with `409`.

**Arrange:**

- Seed item via HTTP → snapshot created (status=available)
- Delete the item via `DELETE /api/menu-items/:id` → snapshot becomes status=unavailable
- `await delay(100)` for snapshot update

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body: `menuItemId: <deleted item id>`, no selectedOptions

**Assert (HTTP):**

- Status: `409`
- `body.message` mentions "not available" or snapshot status

**Assert (DB):**

- N/A

---

#### [C-31] Scenario 31 — Item snapshot status=out_of_stock → 409

**Description:**  
If the snapshot shows `status=out_of_stock`, the server rejects the add.

**Arrange:**

- Seed item via HTTP → snapshot (status=available)
- Toggle sold-out via `PATCH /api/menu-items/:id/sold-out` → snapshot becomes out_of_stock
- `await delay(100)`

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body: `menuItemId: <toggled item id>`, no selectedOptions

**Assert (HTTP):**

- Status: `409`
- `body.message` mentions the item is "not available" and its `status`

**Assert (DB):**

- N/A

---

#### [C-32] Scenario 32 — snapshot.restaurantId mismatch → 409

**Description:**  
If the snapshot's `restaurantId` does not match the `restaurantId` field in the request body,
the item cannot be trusted as belonging to that restaurant → `409`.

**Arrange:**

- Seed menu item under TEST_RESTAURANT_ID → snapshot.restaurantId = TEST_RESTAURANT_ID
- `await delay(100)`

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body: `menuItemId: <real item id>`, but `restaurantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'` (wrong restaurant)

**Assert (HTTP):**

- Status: `409`
- `body.message` mentions the item "does not belong to restaurant"

**Assert (DB):**

- N/A

---

#### [C-33] Scenario 33 — Quantity merge overflow (existing 90 + new 15 > 99) → 400

**Description:**  
When merging quantities would push a line item past the maximum of 99, the server must reject
with `400` before writing to Redis.

**Arrange:**

- Add item with `quantity: 90` → line L1

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Same item, `quantity: 15` (would total 105)

**Assert (HTTP):**

- Status: `400`
- `body.message` mentions "exceed the maximum of 99"

**Assert (DB):**

- N/A

---

### §8 Edge Cases — 404 and 400 Guards

---

#### [C-34] Scenario 34 — PATCH quantity for non-existent cartItemId → 404

**Arrange:**

- Add one item → cart with one line (L1)

**Act:**

- `PATCH /api/carts/my/items/ffffffff-ffff-4fff-8fff-ffffffffffff` with `ownerHeaders()`  
  Body: `{ "quantity": 2 }`

**Assert (HTTP):**

- Status: `404`

**Assert (DB):** N/A

---

#### [C-35] Scenario 35 — PATCH quantity with no cart at all → 404

**Arrange:**

- Clean state: no cart

**Act:**

- `PATCH /api/carts/my/items/ffffffff-ffff-4fff-8fff-ffffffffffff` with `ownerHeaders()`

**Assert (HTTP):**

- Status: `404`
- Body message mentions "No active cart"

---

#### [C-36] Scenario 36 — PATCH modifiers for non-existent cartItemId → 404

**Arrange:**

- Add one item

**Act:**

- `PATCH /api/carts/my/items/ffffffff-ffff-4fff-8fff-ffffffffffff/modifiers` with `ownerHeaders()`  
  Body: `{ "selectedOptions": [] }`

**Assert (HTTP):**

- Status: `404`

---

#### [C-37] Scenario 37 — DELETE non-existent cartItemId → 404

**Arrange:**

- Add one item

**Act:**

- `DELETE /api/carts/my/items/ffffffff-ffff-4fff-8fff-ffffffffffff` with `ownerHeaders()`

**Assert (HTTP):**

- Status: `404`

---

#### [C-38] Scenario 38 — PATCH/DELETE with malformed (non-UUID) cartItemId → 400

**Description:**  
`ParseUUIDPipe` rejects non-UUID path parameters before the service is called.

**Arrange:**

- Any cart state

**Act (two sub-cases):**

1. `PATCH /api/carts/my/items/not-a-uuid` with `ownerHeaders()`, body `{ "quantity": 1 }`
2. `DELETE /api/carts/my/items/not-a-uuid` with `ownerHeaders()`

**Assert (HTTP):**

- Status: `400` for both

---

#### [C-39] Scenario 39 — PATCH modifiers: selectedOptions field missing → 400

**Description:**  
`UpdateCartItemModifiersDto.selectedOptions` is a required `@IsArray()` field.
Sending a body without it triggers NestJS `ValidationPipe` rejection.

**Arrange:**

- Add one item → capture `cartItemId`

**Act:**

- `PATCH /api/carts/my/items/<cartItemId>/modifiers` with `ownerHeaders()`  
  Body: `{}` (missing selectedOptions)

**Assert (HTTP):**

- Status: `400`

---

### §9 Auth Guards — All Cart Endpoints

---

#### [C-40] Scenario 40 — All /carts/my endpoints return 401 with noAuthHeaders

**Description:**  
Every cart endpoint requires a valid session. Sending no `Authorization` header must return `401`.

**Arrange:**

- Clean state (cart may or may not exist)

**Act (one it() per endpoint):**

1. `GET /api/carts/my` with `noAuthHeaders()`
2. `POST /api/carts/my/items` with `noAuthHeaders()`
3. `PATCH /api/carts/my/items/<any-uuid>` with `noAuthHeaders()`
4. `PATCH /api/carts/my/items/<any-uuid>/modifiers` with `noAuthHeaders()`
5. `DELETE /api/carts/my/items/<any-uuid>` with `noAuthHeaders()`
6. `DELETE /api/carts/my` with `noAuthHeaders()`
7. `POST /api/carts/my/checkout` with `noAuthHeaders()`

**Assert (HTTP):**

- Status: `401` for every case

**Assert (DB):** N/A

---

### §10 Checkout — Basic Contract

---

#### [C-41] Scenario 41 — Checkout with no cart → 400

**Description:**  
Calling `POST /carts/my/checkout` when no active cart exists in Redis returns `400`.

**Arrange:**

- Clean state: no cart

**Act:**

- `POST /api/carts/my/checkout` with `ownerHeaders()`  
  Body: `{ deliveryAddress: DELIVERY_ADDRESS, paymentMethod: 'cod' }`

**Assert (HTTP):**

- Status: `400`

---

#### [C-42] Scenario 42 — Checkout with missing deliveryAddress fields → 400

**Description:**  
`DeliveryAddressDto` has three required fields (`street`, `district`, `city`). Omitting any returns `400`.

**Arrange:**

- Cart has items

**Act:**

- `POST /api/carts/my/checkout` with `ownerHeaders()`  
  Body: `{ deliveryAddress: { street: '123 St' }, paymentMethod: 'cod' }` (missing district + city)

**Assert (HTTP):**

- Status: `400`

---

#### [C-43] Scenario 43 — Checkout with invalid paymentMethod → 400

**Description:**  
`paymentMethod` is `@IsEnum(['cod', 'vnpay'])`. Any other value returns `400`.

**Arrange:**

- Cart has items

**Act:**

- `POST /api/carts/my/checkout` with `ownerHeaders()`  
  Body: `{ deliveryAddress: DELIVERY_ADDRESS, paymentMethod: 'bitcoin' }`

**Assert (HTTP):**

- Status: `400`

---

#### [C-44] Scenario 44 — Checkout with malformed X-Idempotency-Key → 400

**Description:**  
The M-2 fix in `cart.controller.ts` validates the idempotency key: must be 8–64 hex characters
(with optional hyphens). A key that fails this regex returns `400` before any order logic runs.

**Arrange:**

- Cart has items

**Act (two sub-cases):**

1. `POST /api/carts/my/checkout` with `ownerHeaders()`, header `X-Idempotency-Key: <a string of 65 chars>`
2. `POST /api/carts/my/checkout` with `ownerHeaders()`, header `X-Idempotency-Key: hello world!` (spaces/special chars)

**Assert (HTTP):**

- Status: `400` for both
- `body.message` mentions "UUID string" and character constraints

---

#### [C-45] Scenario 45 — Checkout with valid UUID idempotency key in correct format → not rejected at validation layer

**Description:**  
A well-formed UUID key (`xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx`) passes the regex validation.
The request proceeds past the validation check (may fail downstream at order-placement level
if restaurant/zone data is incomplete, but must not fail with 400 from key validation).

**Arrange:**

- Cart has items

**Act:**

- `POST /api/carts/my/checkout` with `ownerHeaders()`  
  Header: `X-Idempotency-Key: 12345678-1234-4123-8123-123456789012`  
  Body: valid checkout DTO

**Assert (HTTP):**

- Status is NOT `400` (passes key validation — any other status is acceptable here)

---

---

## Part B — Phase 3: ACL Layer

### §11 Menu Item Snapshot — Projection via HTTP

---

#### [A-01] Scenario 1 — Create menu item → snapshot row created with status=available, modifiers=[]

**Description:**  
`POST /api/menu-items` fires `MenuItemUpdatedEvent` with `status=available` and `modifiers=[]`.
`MenuItemProjector` upserts a row in `ordering_menu_item_snapshots`.
Verifies the E2E event pipeline end-to-end.

**Arrange:**

- `resetDb()` + `testAuth.initialize()` + `seedBaseRestaurant()`

**Act:**

- `POST /api/menu-items` with `ownerHeaders()`  
  Body: `{ restaurantId: TEST_RESTAURANT_ID, name: 'Test Pizza', price: 11.00 }`  
  → capture `menuItemId`
- `await delay(100)` (allow EventBus projection to run)

**Assert (HTTP):**

- Status: `201`
- `body.id` is a UUID → use as `menuItemId`

**Assert (DB):**

- `getSnapshot(menuItemId)` returns non-null
- `snapshot.menuItemId === menuItemId`
- `snapshot.restaurantId === TEST_RESTAURANT_ID`
- `snapshot.name === 'Test Pizza'`
- `snapshot.price === 11.00`
- `snapshot.status === 'available'`
- `snapshot.modifiers` is `[]` (empty array, NOT null)
- `snapshot.lastSyncedAt` is a recent timestamp (within last 5 seconds)

---

#### [A-02] Scenario 2 — Update menu item name/price → snapshot updated; modifiers preserved

**Description:**  
`PATCH /api/menu-items/:id` fires `MenuItemUpdatedEvent` with `modifiers=null` (non-modifier update).
The projector MUST NOT overwrite the `modifiers` column with `null` — it must preserve existing modifiers.

**Arrange:**

- Create menu item, add a modifier group (so `modifiers` column is non-empty after group add)
- `await delay(100)` — snapshot has `modifiers=[{groupId, ...}]`
- Capture `snapshot.modifiers` before update

**Act:**

- `PATCH /api/menu-items/<menuItemId>` with `ownerHeaders()`  
  Body: `{ name: 'Updated Pizza', price: 13.00 }`
- `await delay(100)`

**Assert (HTTP):**

- Status: `200`

**Assert (DB):**

- `snapshot.name === 'Updated Pizza'`
- `snapshot.price === 13.00`
- `snapshot.modifiers` is identical to the pre-update value (NOT null, NOT [])

---

#### [A-03] Scenario 3 — Add modifier group → snapshot.modifiers updated to include the group

**Description:**  
`POST /api/menu-items/modifiers/groups` fires `MenuItemUpdatedEvent` with the full modifier tree.
The snapshot's `modifiers` column is replaced with the new tree.

**Arrange:**

- Create menu item → snapshot has `modifiers=[]`
- `await delay(100)`

**Act:**

- `POST /api/menu-items/modifiers/groups` with `ownerHeaders()`  
  Body: `{ menuItemId, name: 'Choose Size', minSelections: 1, maxSelections: 1 }`
- `await delay(100)`

**Assert (HTTP):**

- Status: `201`
- Response has `id` → capture `groupId`

**Assert (DB):**

- `snapshot.modifiers` is an array with 1 element
- `snapshot.modifiers[0].groupId === groupId`
- `snapshot.modifiers[0].groupName === 'Choose Size'`
- `snapshot.modifiers[0].minSelections === 1`
- `snapshot.modifiers[0].maxSelections === 1`
- `snapshot.modifiers[0].options` is `[]`

---

#### [A-04] Scenario 4 — Add modifier option → snapshot.modifiers includes the new option

**Description:**  
`POST /api/menu-items/modifiers/options` fires an event with the updated modifier tree.
The snapshot must reflect the new option inside the existing group.

**Arrange:**

- Create item, create modifier group → snapshot has `modifiers=[group with options=[]]`

**Act:**

- `POST /api/menu-items/modifiers/options` with `ownerHeaders()`  
  Body: `{ groupId, name: 'Small', price: 0, isDefault: true, isAvailable: true }`
- `await delay(100)`

**Assert (HTTP):**

- Status: `201`
- Response has `id` → capture `optionId`

**Assert (DB):**

- `snapshot.modifiers[0].options.length === 1`
- `snapshot.modifiers[0].options[0].optionId === optionId`
- `snapshot.modifiers[0].options[0].name === 'Small'`
- `snapshot.modifiers[0].options[0].price === 0`
- `snapshot.modifiers[0].options[0].isDefault === true`
- `snapshot.modifiers[0].options[0].isAvailable === true`

---

#### [A-05] Scenario 5 — Update modifier option → snapshot.modifiers reflects updated option

**Description:**  
`PATCH /api/menu-items/modifiers/options/:id` fires an event. The projector replaces the entire
`modifiers` column with the updated tree.

**Arrange:**

- Create item, group, option (`name: 'Small'`, `price: 0`)
- `await delay(100)`

**Act:**

- `PATCH /api/menu-items/modifiers/options/<optionId>` with `ownerHeaders()`  
  Body: `{ name: 'Medium', price: 1.50 }`
- `await delay(100)`

**Assert (HTTP):**

- Status: `200`

**Assert (DB):**

- `snapshot.modifiers[0].options[0].name === 'Medium'`
- `snapshot.modifiers[0].options[0].price === 1.50`

---

#### [A-06] Scenario 6 — Delete modifier group → snapshot.modifiers no longer contains that group

**Arrange:**

- Create item, create two modifier groups (G1, G2), `await delay(100)`

**Act:**

- `DELETE /api/menu-items/modifiers/groups/<G1-id>` with `ownerHeaders()`
- `await delay(100)`

**Assert (HTTP):**

- Status: `204`

**Assert (DB):**

- `snapshot.modifiers.length === 1`
- `snapshot.modifiers[0].groupId === <G2 id>` (only G2 remains)

---

#### [A-07] Scenario 7 — Toggle sold-out → snapshot.status = out_of_stock

**Arrange:**

- Create item → snapshot `status=available`

**Act:**

- `PATCH /api/menu-items/<menuItemId>/sold-out` with `ownerHeaders()`
- `await delay(100)`

**Assert (HTTP):**

- Status: `200`

**Assert (DB):**

- `snapshot.status === 'out_of_stock'`

---

#### [A-08] Scenario 8 — Toggle sold-out again → snapshot.status = available

**Arrange:**

- Item is currently `out_of_stock` (from Scenario 7 setup)

**Act:**

- `PATCH /api/menu-items/<menuItemId>/sold-out` with `ownerHeaders()` (second toggle)
- `await delay(100)`

**Assert (HTTP):**

- Status: `200`

**Assert (DB):**

- `snapshot.status === 'available'`

---

#### [A-09] Scenario 9 — Delete menu item → snapshot tombstoned: status=unavailable, modifiers=[]

**Description:**  
`DELETE /api/menu-items/:id` fires `MenuItemUpdatedEvent` with `status='unavailable'` and `modifiers=[]`.
The projector upserts the tombstone — the row is NOT physically deleted, preserving event-replay safety.
This is required for the cart add-item guard to detect deleted items.

**Arrange:**

- Create item with one modifier group and one option → snapshot has `modifiers=[{...}]`
- `await delay(100)`

**Act:**

- `DELETE /api/menu-items/<menuItemId>` with `ownerHeaders()`
- `await delay(100)`

**Assert (HTTP):**

- Status: `204`

**Assert (DB):**

- `snapshot` row still exists (NOT deleted from DB)
- `snapshot.status === 'unavailable'`
- `snapshot.modifiers` is `[]` (tombstone — modifiers cleared)
- `snapshot.lastSyncedAt` is more recent than before the delete

---

#### [A-10] Scenario 10 — Upsert is idempotent: replaying same event twice produces no duplicate row

**Description:**  
The `ON CONFLICT (menu_item_id) DO UPDATE` upsert means re-processing the same event is safe.
There must be exactly one snapshot row for the menu item after two identical events.

**Arrange:**

- Create menu item → snapshot created
- `await delay(100)`

**Act:**

- Trigger a second update with identical data:  
  `PATCH /api/menu-items/<menuItemId>` with same name and price
- `await delay(100)`

**Assert (HTTP):**

- Status: `200`

**Assert (DB):**

- Query `SELECT COUNT(*) FROM ordering_menu_item_snapshots WHERE menu_item_id = <id>` → `1` (no duplicates)
- `snapshot.name` equals the updated name

---

#### [A-11] Scenario 11 — lastSyncedAt advances on every event write

**Description:**  
Every upsert triggered by `MenuItemUpdatedEvent` must update `lastSyncedAt` to the current timestamp.
Two successive updates must produce an advancing `lastSyncedAt`.

**Arrange:**

- Create item → capture `snapshot1.lastSyncedAt`
- `await delay(50)` (ensure timestamps differ)

**Act:**

- `PATCH /api/menu-items/<menuItemId>` with `ownerHeaders()` — change price
- `await delay(100)`

**Assert (DB):**

- `snapshot2 = getSnapshot(menuItemId)`
- `new Date(snapshot2.lastSyncedAt) > new Date(snapshot1.lastSyncedAt)`

---

#### [A-12] Scenario 12 — Non-modifier PATCH (name only) → modifiers column NOT cleared

**Description:**  
The projector contract for `modifiers=null` in the event: "do not touch the modifiers column".
This is enforced by `MenuItemSnapshotRepository.upsert()`. A name-only update must leave the
`modifiers` column exactly as it was.

**Arrange:**

- Create item, create modifier group with one option → `snapshot.modifiers` has 1 group, 1 option
- `await delay(100)`
- Capture `beforeModifiers = snapshot.modifiers`

**Act:**

- `PATCH /api/menu-items/<menuItemId>` with `ownerHeaders()` — change only `name`
- `await delay(100)`

**Assert (DB):**

- `snapshot.modifiers` deep-equals `beforeModifiers` (no change)
- `snapshot.name` equals the new name

---

### §12 ACL Read API — Menu Items

---

#### [A-13] Scenario 13 — GET /ordering/menu-items/:id → 200 with correct snapshot fields

**Description:**  
`AclService.getMenuItemById()` reads from `ordering_menu_item_snapshots` and returns the full
`MenuItemSnapshotResponseDto`. All fields from the DTO must be present in the response.

**Arrange:**

- Create menu item → snapshot created → `menuItemId`
- `await delay(100)`

**Act:**

- `GET /api/ordering/menu-items/<menuItemId>` with `noAuthHeaders()` (public endpoint)

**Assert (HTTP):**

- Status: `200`
- Body shape:
  ```
  {
    menuItemId: <menuItemId>,
    restaurantId: TEST_RESTAURANT_ID,
    name: 'Test Pizza',
    price: 11.00,
    status: 'available',
    lastSyncedAt: <ISO date string>,
  }
  ```
- `body.lastSyncedAt` is a valid ISO date string

**Assert (DB):** N/A (API assertion is sufficient)

---

#### [A-14] Scenario 14 — GET /ordering/menu-items/:id → 404 when no snapshot exists

**Arrange:**

- A UUID that has never had a menu item created (no snapshot row)

**Act:**

- `GET /api/ordering/menu-items/ffffffff-ffff-4fff-8fff-ffffffffffff` with `noAuthHeaders()`

**Assert (HTTP):**

- Status: `404`
- `body.message` mentions "not found" or the UUID

---

#### [A-15] Scenario 15 — GET /ordering/menu-items/:invalidUUID → 400

**Description:**  
`ParseUUIDPipe` on the `:id` parameter rejects non-UUID values before the service is reached.

**Act:**

- `GET /api/ordering/menu-items/not-a-uuid` with `noAuthHeaders()`

**Assert (HTTP):**

- Status: `400`

---

#### [A-16] Scenario 16 — GET /ordering/menu-items?ids=id1,id2 → returns both snapshots

**Arrange:**

- Create two menu items → `menuItemId1`, `menuItemId2`
- `await delay(100)`

**Act:**

- `GET /api/ordering/menu-items?ids=<menuItemId1>,<menuItemId2>` with `noAuthHeaders()`

**Assert (HTTP):**

- Status: `200`
- `body` is an array of length `2`
- `body.map(s => s.menuItemId)` contains both IDs (order may vary)

---

#### [A-17] Scenario 17 — GET /ordering/menu-items?ids=id1,nonExistent → returns only id1 (silent omit)

**Description:**  
IDs not present in the snapshot table are silently omitted. No 404.

**Arrange:**

- Create one menu item → `menuItemId1`
- `await delay(100)`
- `nonExistentId = 'eeeeeeee-eeee-4eee-8eee-000000000000'` (no row)

**Act:**

- `GET /api/ordering/menu-items?ids=<menuItemId1>,<nonExistentId>` with `noAuthHeaders()`

**Assert (HTTP):**

- Status: `200`
- `body.length === 1`
- `body[0].menuItemId === menuItemId1`

---

#### [A-18] Scenario 18 — GET /ordering/menu-items?ids= (empty string) → returns []

**Act:**

- `GET /api/ordering/menu-items?ids=` with `noAuthHeaders()`

**Assert (HTTP):**

- Status: `200`
- Body: `[]`

---

#### [A-19] Scenario 19 — All /ordering/menu-items\* endpoints are publicly accessible (no auth needed)

**Description:**  
The M-1 fix added `@AllowAnonymous()` at class level on `AclController`. All four ACL endpoints
must return non-401 when called with `noAuthHeaders()`.

**Arrange:**

- Create one menu item and one restaurant snapshot (seeded restaurant)
- `await delay(100)`

**Act (four sub-cases):**

1. `GET /api/ordering/menu-items/<menuItemId>` with `noAuthHeaders()`
2. `GET /api/ordering/menu-items?ids=<menuItemId>` with `noAuthHeaders()`
3. `GET /api/ordering/restaurants/<TEST_RESTAURANT_ID>` with `noAuthHeaders()`
4. `GET /api/ordering/restaurants?ids=<TEST_RESTAURANT_ID>` with `noAuthHeaders()`

**Assert (HTTP):**

- Status for each: NOT `401` (200 or 404 are acceptable — key is authentication does not block)

---

### §13 Restaurant Snapshot — Projection via HTTP

---

#### [A-20] Scenario 20 — Create restaurant via API → snapshot row created

**Description:**  
`POST /api/restaurants` fires `RestaurantUpdatedEvent`. `RestaurantSnapshotProjector` upserts
a row in `ordering_restaurant_snapshots`. This verifies the restaurant-to-snapshot pipeline.

**Arrange:**

- `resetDb()` (no existing snapshots)
- Note: For this test, use a DIFFERENT restaurant than `TEST_RESTAURANT_ID` (seeded directly,
  no event fires for it). Create a second restaurant via HTTP to trigger the event.

**Act:**

- `POST /api/restaurants` with `ownerHeaders()`  
  Body: `{ name: 'Event Restaurant', address: '42 Event St', phone: '+84-111-111-1111' }`
- `await delay(100)`
- Capture `restaurantId` from response

**Assert (HTTP):**

- Status: `201`

**Assert (DB):**

- `getRestaurantSnapshot(restaurantId)` returns non-null  
  _(requires a `getRestaurantSnapshot` helper to be added to `test/helpers/db.ts`)_
- `snapshot.restaurantId === restaurantId`
- `snapshot.name === 'Event Restaurant'`
- `snapshot.isOpen === false` (default — not yet opened)
- `snapshot.isApproved === false` (default — not yet approved)
- `snapshot.address === '42 Event St'`
- `snapshot.cuisineType === null`
- `snapshot.latitude === null`
- `snapshot.longitude === null`
- `snapshot.lastSyncedAt` is recent

---

#### [A-21] Scenario 21 — Update restaurant name → snapshot updated

**Arrange:**

- Create restaurant via HTTP → snapshot ready

**Act:**

- `PATCH /api/restaurants/<restaurantId>` with `ownerHeaders()`  
  Body: `{ name: 'Renamed Restaurant' }`
- `await delay(100)`

**Assert (DB):**

- `snapshot.name === 'Renamed Restaurant'`

---

#### [A-22] Scenario 22 — Approve restaurant → snapshot.isApproved = true

**Arrange:**

- Create restaurant via HTTP (isApproved=false initially)

**Act:**

- `PATCH /api/restaurants/<restaurantId>/approve` (or equivalent admin endpoint) with admin auth
- `await delay(100)`

**Assert (DB):**

- `snapshot.isApproved === true`

---

#### [A-23] Scenario 23 — Open/close restaurant → snapshot.isOpen toggles correctly

**Arrange:**

- Create restaurant via HTTP (isOpen=false initially)

**Act (Part 1 — Open):**

- `PATCH /api/restaurants/<restaurantId>/toggle-open` (or equivalent) with `ownerHeaders()`
- `await delay(100)`

**Assert (DB):**

- `snapshot.isOpen === true`

**Act (Part 2 — Close):**

- Toggle again
- `await delay(100)`

**Assert (DB):**

- `snapshot.isOpen === false`

---

#### [A-24] Scenario 24 — Create restaurant with GPS coordinates → snapshot has lat/long

**Arrange:**

- `resetDb()`

**Act:**

- `POST /api/restaurants` with `ownerHeaders()`  
  Body includes `latitude: 10.762622`, `longitude: 106.660172`
- `await delay(100)`

**Assert (DB):**

- `snapshot.latitude === 10.762622`
- `snapshot.longitude === 106.660172`

---

#### [A-25] Scenario 25 — Create restaurant without GPS coordinates → snapshot lat/long are null

**Act:**

- `POST /api/restaurants` with `ownerHeaders()`  
  Body has NO `latitude` / `longitude` fields
- `await delay(100)`

**Assert (DB):**

- `snapshot.latitude === null`
- `snapshot.longitude === null`

---

#### [A-26] Scenario 26 — Create restaurant without cuisineType → snapshot.cuisineType is null

**Act:**

- `POST /api/restaurants` with `ownerHeaders()`, no `cuisineType` field
- `await delay(100)`

**Assert (DB):**

- `snapshot.cuisineType === null`

---

### §14 ACL Read API — Restaurants

---

#### [A-27] Scenario 27 — GET /ordering/restaurants/:id → 200 with all snapshot fields

**Arrange:**

- Ensure a restaurant snapshot exists (created via HTTP + delay)

**Act:**

- `GET /api/ordering/restaurants/<restaurantId>` with `noAuthHeaders()`

**Assert (HTTP):**

- Status: `200`
- Body shape:
  ```
  {
    restaurantId: <restaurantId>,
    name: <name>,
    isOpen: <bool>,
    isApproved: <bool>,
    address: <string>,
    cuisineType: null | <string>,
    latitude: null | <number>,
    longitude: null | <number>,
    lastSyncedAt: <ISO date string>,
  }
  ```

---

#### [A-28] Scenario 28 — GET /ordering/restaurants/:id → 404 when no snapshot

**Act:**

- `GET /api/ordering/restaurants/ffffffff-ffff-4fff-8fff-ffffffffffff` with `noAuthHeaders()`

**Assert (HTTP):**

- Status: `404`

---

#### [A-29] Scenario 29 — GET /ordering/restaurants/:invalidUUID → 400

**Act:**

- `GET /api/ordering/restaurants/not-a-uuid` with `noAuthHeaders()`

**Assert (HTTP):**

- Status: `400`

---

#### [A-30] Scenario 30 — GET /ordering/restaurants?ids=id1,id2 → returns both snapshots

**Arrange:**

- Two restaurant snapshots exist (two restaurants created via HTTP)

**Act:**

- `GET /api/ordering/restaurants?ids=<id1>,<id2>` with `noAuthHeaders()`

**Assert (HTTP):**

- Status: `200`
- `body.length === 2`
- Both `restaurantId` values are present

---

#### [A-31] Scenario 31 — GET /ordering/restaurants?ids=id1,nonExistent → returns only id1

**Act:**

- `GET /api/ordering/restaurants?ids=<id1>,ffffffff-ffff-4fff-8fff-000000000000` with `noAuthHeaders()`

**Assert (HTTP):**

- Status: `200`
- `body.length === 1`
- `body[0].restaurantId === id1`

---

#### [A-32] Scenario 32 — GET /ordering/restaurants?ids= (empty) → returns []

**Act:**

- `GET /api/ordering/restaurants?ids=` with `noAuthHeaders()`

**Assert (HTTP):**

- Status: `200`
- Body: `[]`

---

### §15 Delivery Zone Snapshot — Projection via HTTP

---

#### [A-33] Scenario 33 — Create delivery zone → zone snapshot upserted

**Description:**  
`POST /api/restaurants/:id/delivery-zones` fires `DeliveryZoneSnapshotUpdatedEvent` with `isDeleted=false`.
The projector upserts a row in `ordering_delivery_zone_snapshots`.

**Arrange:**

- Restaurant exists (TEST_RESTAURANT_ID)

**Act:**

- `POST /api/restaurants/<TEST_RESTAURANT_ID>/delivery-zones` with `ownerHeaders()`  
  Body:
  ```json
  {
    "name": "Inner City Zone",
    "radiusKm": 5.0,
    "baseFee": 15000,
    "perKmRate": 3000,
    "avgSpeedKmh": 25,
    "prepTimeMinutes": 10,
    "bufferMinutes": 5,
    "isActive": true
  }
  ```
- `await delay(100)`
- Capture `zoneId` from response

**Assert (HTTP):**

- Status: `201`

**Assert (DB):**

- `getDeliveryZoneSnapshot(zoneId)` returns non-null  
  _(requires a `getDeliveryZoneSnapshot` helper to be added to `test/helpers/db.ts`)_
- `snapshot.zoneId === zoneId`
- `snapshot.restaurantId === TEST_RESTAURANT_ID`
- `snapshot.name === 'Inner City Zone'`
- `snapshot.radiusKm === 5.0`
- `snapshot.baseFee === 15000`
- `snapshot.isActive === true`
- `snapshot.isDeleted === false`
- `snapshot.lastSyncedAt` is recent

---

#### [A-34] Scenario 34 — Update delivery zone → snapshot fields updated

**Arrange:**

- Zone exists (from Scenario 33 setup)

**Act:**

- `PATCH /api/restaurants/<TEST_RESTAURANT_ID>/delivery-zones/<zoneId>` with `ownerHeaders()`  
  Body: `{ "baseFee": 20000, "radiusKm": 7.0 }`
- `await delay(100)`

**Assert (HTTP):**

- Status: `200`

**Assert (DB):**

- `snapshot.baseFee === 20000`
- `snapshot.radiusKm === 7.0`
- `snapshot.isDeleted === false` (tombstone flag not set on update)

---

#### [A-35] Scenario 35 — Delete delivery zone → snapshot tombstoned (isDeleted=true)

**Description:**  
`DELETE /api/restaurants/:id/delivery-zones/:zoneId` fires `DeliveryZoneSnapshotUpdatedEvent`
with `isDeleted=true`. The projector calls `markDeleted(zoneId)` — physical row is preserved
but flagged so BR-3 queries exclude it.

**Arrange:**

- Zone exists (snapshot row with isDeleted=false)

**Act:**

- `DELETE /api/restaurants/<TEST_RESTAURANT_ID>/delivery-zones/<zoneId>` with `ownerHeaders()`
- `await delay(100)`

**Assert (HTTP):**

- Status: `204`

**Assert (DB):**

- `snapshot` row still exists (not physically deleted)
- `snapshot.isDeleted === true`
- `snapshot.zoneId === zoneId` (same row, tombstoned)

---

#### [A-36] Scenario 36 — Create inactive zone → snapshot.isActive = false

**Arrange:**

- Restaurant exists

**Act:**

- `POST /api/restaurants/<TEST_RESTAURANT_ID>/delivery-zones` with `ownerHeaders()`  
  Body includes `"isActive": false`
- `await delay(100)`

**Assert (DB):**

- `snapshot.isActive === false`
- `snapshot.isDeleted === false`

---

#### [A-37] Scenario 37 — Activate zone → snapshot.isActive = true

**Arrange:**

- Zone exists with `isActive=false`

**Act:**

- `PATCH /api/restaurants/<TEST_RESTAURANT_ID>/delivery-zones/<zoneId>` with `ownerHeaders()`  
  Body: `{ "isActive": true }`
- `await delay(100)`

**Assert (DB):**

- `snapshot.isActive === true`

---

#### [A-38] Scenario 38 — Upsert idempotency: updating zone twice produces one snapshot row

**Arrange:**

- Zone created (one snapshot row)

**Act:**

- `PATCH` zone with `{ "baseFee": 25000 }`
- `PATCH` zone again with `{ "baseFee": 25000 }` (identical)
- `await delay(100)`

**Assert (DB):**

- `SELECT COUNT(*) WHERE zone_id = <zoneId>` → `1`

---

### §16 Cross-BC Integrity Scenarios

---

#### [A-39] Scenario 39 — Cart.addItem uses snapshot price for modifiers, NOT client-supplied prices

**Description:**  
When a snapshot exists, modifier prices must be resolved from the snapshot (not from any
client-provided values). The `selectedModifiers[].price` in the response must match the option
price in the snapshot, even if the client sent a different `unitPrice` in the body.

**Arrange:**

- Seed item (price 10.00), add modifier group with one option (snapshot price 2.50)
- `await delay(100)`

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body: `unitPrice: 999.00` (intentionally wrong), `selectedOptions: [<option id>]`

**Assert (HTTP):**

- Status: `201`
- `body.items[0].unitPrice === 999.00` (client-supplied base price is trusted in Phase 2)
- `body.items[0].selectedModifiers[0].price === 2.50` (modifier price resolved from snapshot, NOT from client)

---

#### [A-40] Scenario 40 — Snapshot tombstone (status=unavailable) blocks cart add

**Description:**  
End-to-end: create item, delete it (fires tombstone event), then attempt to add the deleted item
to the cart. Must be rejected because the snapshot now has `status=unavailable`.

**Arrange:**

- Create menu item → snapshot `status=available`
- `await delay(100)`
- `DELETE /api/menu-items/<menuItemId>` with `ownerHeaders()`
- `await delay(100)` — snapshot now `status=unavailable`

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body: `menuItemId: <deleted id>`, no selectedOptions

**Assert (HTTP):**

- Status: `409`
- `body.message` mentions "not available"

**Assert (DB):**

- `snapshot.status === 'unavailable'` (tombstone row still exists)

---

#### [A-41] Scenario 41 — Out-of-stock item blocks cart add; re-stocking allows add again

**Description:**  
End-to-end: toggle sold-out blocks the cart add (409). Toggling back enables it (201).

**Arrange:**

- Create item → snapshot `status=available`
- `await delay(100)`
- Toggle sold-out → snapshot `status=out_of_stock`
- `await delay(100)`

**Act (Part 1 — blocked):**

- `POST /api/carts/my/items` with `ownerHeaders()` — expect `409`

**Act (Part 2 — re-stock):**

- `PATCH /api/menu-items/<menuItemId>/sold-out` with `ownerHeaders()` — toggle back to available
- `await delay(100)`
- `POST /api/carts/my/items` with `ownerHeaders()` — expect `201`

**Assert (HTTP):**

- Part 1: `409`
- Part 2: `201`

---

#### [A-42] Scenario 42 — Cart modifier validation uses fresh snapshot data after option update

**Description:**  
After updating a modifier option (making it unavailable), subsequent cart add attempts selecting
that option must be rejected using the updated snapshot.

**Arrange:**

- Create item, add modifier group, add option OPT-1 (`isAvailable=true`)
- `await delay(100)` — snapshot reflects available option
- Mark option unavailable: `PATCH /api/menu-items/modifiers/options/<OPT-1>` with `{ isAvailable: false }`
- `await delay(100)` — snapshot reflects unavailable option

**Act:**

- `POST /api/carts/my/items` with `ownerHeaders()`  
  Body: `selectedOptions: [{ groupId, optionId: OPT-1 }]`

**Assert (HTTP):**

- Status: `400`
- `body.message` mentions option is "currently unavailable"

---

---

## Appendix: Required DB Helpers to Add in `test/helpers/db.ts`

The following helper functions do not yet exist and must be created before implementing Phase 3 restaurant/zone snapshot tests:

```
// Get a restaurant snapshot row by restaurantId
export async function getRestaurantSnapshot(restaurantId: string): Promise<OrderingRestaurantSnapshot | null>

// Get a delivery zone snapshot row by zoneId
export async function getDeliveryZoneSnapshot(zoneId: string): Promise<OrderingDeliveryZoneSnapshot | null>
```

Schema imports:

- `orderingRestaurantSnapshots` from `src/module/ordering/acl/schemas/restaurant-snapshot.schema`
- `orderingDeliveryZoneSnapshots` from `src/module/ordering/acl/schemas/delivery-zone-snapshot.schema`

---

## Appendix: Scenario Count Summary

| Section                      | Scenarios       | Key Coverage                                                                                       |
| ---------------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| §1 Cart Read                 | 3               | null state, full shape, cartId stability                                                           |
| §2 Add Item Merge            | 4               | first add, qty merge, fingerprint append, totalAmount                                              |
| §3 PATCH Quantity            | 4               | absolute set, qty=0, non-last remove, modifiers untouched                                          |
| §4 PATCH Modifiers           | 4               | replace, clear, fingerprint update, merge after patch                                              |
| §5 Remove & Clear            | 4               | single remove, last item, clear, idempotent clear                                                  |
| §6 BR-2                      | 2               | cross-restaurant 409, clear then re-add                                                            |
| §7 Modifier Validation       | 12              | auto-inject default, min/max, invalid IDs, unavailable, no snapshot                                |
| §8 Edge Cases                | 6               | 404 guards, ParseUUIDPipe, missing required fields                                                 |
| §9 Auth Guards               | 1 (7 sub-cases) | 401 on all 7 cart endpoints                                                                        |
| §10 Checkout                 | 5               | empty cart, missing fields, bad method, idempotency key                                            |
| **Phase 2 Total**            | **45**          |                                                                                                    |
| §11 Menu Item Projection     | 12              | create, update, modifiers, toggle, delete, idempotency, lastSyncedAt, null-safe                    |
| §12 ACL Read — Menu Items    | 7               | 200, 404, 400, bulk, silent omit, empty, no-auth                                                   |
| §13 Restaurant Projection    | 7               | create, update, approve, open/close, lat/long, null fields                                         |
| §14 ACL Read — Restaurants   | 6               | 200, 404, 400, bulk, silent omit, empty                                                            |
| §15 Delivery Zone Projection | 6               | create, update, tombstone, inactive, activate, idempotency                                         |
| §16 Cross-BC Integrity       | 4               | modifier prices from snapshot, tombstone blocks cart, out-of-stock cycle, option update blocks add |
| **Phase 3 Total**            | **42**          |                                                                                                    |
| **Grand Total**              | **87**          |                                                                                                    |
