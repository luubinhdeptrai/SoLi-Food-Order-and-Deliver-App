# Cart Modifier Behavior Audit

> **Audit date:** 2026-04-29  
> **Scope:** `apps/api/src/module/ordering/cart/` + `order/commands/place-order.handler.ts`  
> **Files audited:** `cart.controller.ts`, `cart.service.ts`, `cart.dto.ts`, `cart.types.ts`, `cart.redis-repository.ts`, `place-order.handler.ts`, `menu-item-snapshot.schema.ts`, `menu-item-updated.event.ts`

---

## 1. Summary

### Current Capability

| Layer | What exists |
|---|---|
| Add item | `POST /carts/my/items` — creates cart or merges quantity if `menuItemId` already present |
| Update | `PATCH /carts/my/items/:menuItemId` — **quantity only**, no modifier update |
| Remove item | `DELETE /carts/my/items/:menuItemId` |
| Clear cart | `DELETE /carts/my` |
| Checkout | `POST /carts/my/checkout` — validates restaurant/item availability, builds immutable price snapshot |
| Modifier add-time validation | ✅ groupId exists, ✅ optionId exists, ✅ minSelections, ✅ maxSelections (when snapshot present) |

### Major Missing Features

1. **No way to change modifiers on an existing cart item** — `PATCH` only touches quantity.
2. **Cart item identity ignores modifier selection** — same `menuItemId` with different modifiers silently merges quantity and discards the new modifiers.
3. **Modifier prices excluded from order total at checkout** — `buildOrderItemsFromSnapshots` ignores `cartItem.selectedModifiers`, producing an incorrect `totalAmount`.
4. **Order items do not persist modifier selections** — modifier data is lost permanently after checkout; receipts and order history have no modifier information.
5. **`isAvailable` not carried in `ModifierOptionSnapshot`** — unavailable options can be selected; the event type and JSONB schema both omit the field.
6. **Modifier constraints not re-validated at checkout** — a cart built with valid modifiers whose snapshot subsequently changes passes checkout without re-checking `minSelections`/`maxSelections`.
7. **Default options not auto-applied server-side** — `isDefault: true` options are never auto-injected; the client must send them explicitly.
8. **Re-adding same item with different modifiers creates no separate line item** — there is no `cartItemId` concept; items are keyed solely by `menuItemId`.

### Risk Level

**HIGH** — Two of the bugs (#3 and #4) produce silent data corruption in production: orders are created with wrong totals and no modifier history. The rest block UX completeness.

---

## 2. Full Case Matrix

---

### Case 1: Add item with no modifiers

#### Description
Customer adds a plain menu item that has no modifier groups, or sends `selectedOptions: []`.

#### Example

```http
POST /api/carts/my/items
Content-Type: application/json

{
  "menuItemId": "11111111-1111-1111-1111-111111111111",
  "restaurantId": "aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1
}
```

#### Expected Behavior (Correct System)
Item is added; `selectedModifiers: []`; subtotal = `unitPrice × quantity`.

#### Current Backend Status
**IMPLEMENTED** — `selectedOptions` is optional; `validateAndResolveModifiers` returns `[]` when absent or when no snapshot exists.

#### Evidence
`cart.dto.ts` — `selectedOptions` decorated `@IsOptional()`.  
`cart.service.ts:validateAndResolveModifiers` — returns `[]` when `selectedOptions` is empty.

#### If Implemented → How to Test

```http
POST /api/carts/my/items
Authorization: Bearer <token>
Content-Type: application/json

{
  "menuItemId": "11111111-1111-1111-1111-111111111111",
  "restaurantId": "aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "restaurantName": "Sunset Bistro",
  "itemName": "Margherita Pizza",
  "unitPrice": 12.50,
  "quantity": 1
}
```

Expected response: HTTP 201, `items[0].selectedModifiers = []`, `subtotal = 12.50`.

---

### Case 2: Add item with valid single-choice modifier (e.g., Size: Large)

#### Description
Customer selects one option from a single-select modifier group (`maxSelections=1`).

#### Example

```http
POST /api/carts/my/items
Content-Type: application/json

{
  "menuItemId": "22222222-2222-2222-2222-222222222222",
  "restaurantId": "aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "restaurantName": "Sunset Bistro",
  "itemName": "Coffee",
  "unitPrice": 3.00,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "size-group-uuid", "optionId": "large-uuid" }
  ]
}
```

#### Expected Behavior (Correct System)
Modifier resolved from snapshot; `price` taken from snapshot, not client. Cart item has `selectedModifiers` with full group/option names and snapshotted price.

#### Current Backend Status
**IMPLEMENTED** (when snapshot exists) / **PARTIAL** (when snapshot absent — client values trusted, modifier array returned as `[]` — silently drops modifiers).

#### Evidence
`cart.service.ts:validateAndResolveModifiers` — when `snapshot` is `null`, returns `[]`:
```typescript
if (!snapshot) {
  // trust client-supplied values (Phase 2 behaviour)
  return [];
}
```
When snapshot exists, option lookup, groupId/optionId validation, and price resolution all work correctly.

#### If Implemented → How to Test

```http
POST /api/carts/my/items
Authorization: Bearer <token>
Content-Type: application/json

{
  "menuItemId": "<seeded-menu-item-uuid>",
  "restaurantId": "<seeded-restaurant-uuid>",
  "restaurantName": "Sunset Bistro",
  "itemName": "Coffee",
  "unitPrice": 3.00,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "<size-group-uuid>", "optionId": "<large-option-uuid>" }
  ]
}
```

Assert: `items[0].selectedModifiers[0].optionName = "Large"`, `price = <snapshot price>`.

#### Proposed Test Case (snapshot-absent path)

```http
# When no snapshot seeded, selectedModifiers will be [] even if options are sent.
# Bug: modifier data is silently dropped. Should be preserved or rejected.
POST /api/carts/my/items
Authorization: Bearer <token>
Content-Type: application/json

{
  "menuItemId": "non-projected-item-uuid",
  "restaurantId": "aaaa-...",
  "restaurantName": "Bistro",
  "itemName": "Latte",
  "unitPrice": 4.00,
  "quantity": 1,
  "selectedOptions": [{ "groupId": "g1", "optionId": "o1" }]
}
# Expected: 400 Bad Request (option IDs cannot be validated without snapshot)
# Actual: 201 Created with selectedModifiers: []  ← SILENT DATA LOSS
```

---

### Case 3: Change option within the same group (e.g., Size: Large → Small)

#### Description
Customer previously added "Coffee + Size: Large" and now wants to change to "Size: Small" without removing the item.

#### Example

```http
PATCH /api/carts/my/items/22222222-2222-2222-2222-222222222222
Content-Type: application/json

{
  "selectedOptions": [
    { "groupId": "size-group-uuid", "optionId": "small-uuid" }
  ]
}
```

#### Expected Behavior (Correct System)
The modifier selection for that group is replaced. `selectedModifiers` in the cart item now reflects "Small". Price is recalculated.

#### Current Backend Status
**NOT IMPLEMENTED**

#### Evidence
`cart.dto.ts` — `UpdateCartItemQuantityDto` accepts only `quantity`:
```typescript
export class UpdateCartItemQuantityDto {
  @IsInt() @Min(0) @Max(99)
  quantity!: number;
}
```
`cart.controller.ts:updateItemQuantity` — calls `cartService.updateItemQuantity(...)` which updates only `quantity` on the matched `CartItem`:
```typescript
cart.items[itemIndex] = { ...cart.items[itemIndex], quantity: dto.quantity };
```
No `selectedModifiers` mutation is possible through any existing endpoint.

#### ⚠️ Design Rule: Strict Separation of Quantity and Modifiers

> **Never combine `quantity` and `selectedOptions` in the same optional-field endpoint.**
>
> **Concrete bug scenario:**
> 1. User has `Coffee × 3` with Size: Large (`quantity = 3`).
> 2. User taps "Change to Small" — client sends `{ selectedOptions: [{ ...small }] }` with **no `quantity`**.
> 3. BE executes `{ ...existing, quantity: dto.quantity }` → `quantity: undefined`.
> 4. Cart now shows `Coffee × undefined`. Subtotal = `NaN`. Order total = `NaN`.
>
> Even if `quantity` is made **required** in the DTO to prevent `undefined`, the client is then forced to do a GET before every modifier toggle just to echo back the current quantity — unnecessary coupling of two independent concerns.

#### Proposed Design

Use **two strictly separate endpoints**. Each touches exactly one dimension and never reads the other.

**Modifier update only (quantity untouched):**
```
PATCH /api/carts/my/items/:cartItemId/modifiers
```

```json
{
  "selectedOptions": [
    { "groupId": "size-group-uuid", "optionId": "small-uuid" }
  ]
}
```

**Service logic:**
```typescript
async updateItemModifiers(customerId: string, cartItemId: string, dto: UpdateCartItemModifiersDto): Promise<Cart> {
  const cart = await this.requireCart(customerId);
  const itemIndex = cart.items.findIndex(i => i.cartItemId === cartItemId);
  if (itemIndex < 0) throw new NotFoundException(`Cart item ${cartItemId} not found.`);

  const resolved = await this.validateAndResolveModifiers({
    menuItemId: cart.items[itemIndex].menuItemId,
    restaurantId: cart.restaurantId,
    selectedOptions: dto.selectedOptions,
  });

  // quantity is NEVER touched — spread only replaces selectedModifiers
  cart.items[itemIndex] = {
    ...cart.items[itemIndex],
    selectedModifiers: resolved,
  };
  cart.updatedAt = new Date().toISOString();
  await this.cartRepo.save(cart);
  return cart;
}
```

**Quantity update only (modifiers untouched — existing endpoint, updated to use cartItemId):**
```
PATCH /api/carts/my/items/:cartItemId
Body: { "quantity": 3 }   ← required integer, no selectedOptions field
```

**Validation rules (modifier update):**
- Same snapshot-based rules as `addItem` (`minSelections`, `maxSelections`, option existence).
- `quantity` is not in the DTO — cannot be accidentally nulled.
- Reject if `cartItemId` not in cart (`404`).

#### Proposed Test Case

```http
# Precondition: Coffee × 3 (Large) in cart, cartItemId = "abc-123"

# Change modifier only — quantity must stay 3
PATCH /api/carts/my/items/abc-123/modifiers
Authorization: Bearer <token>
Content-Type: application/json

{
  "selectedOptions": [
    { "groupId": "<size-group-uuid>", "optionId": "<small-uuid>" }
  ]
}
```

Expected: HTTP 200; `items[0].selectedModifiers[0].optionName = "Small"`; `items[0].quantity === 3` (unchanged).

---

### Case 4: Remove an option from a group (partial deselect in multi-select group)

#### Description
A multi-select group (e.g., Toppings: Cheese, Mushroom) — customer wants to remove Mushroom while keeping Cheese.

#### Expected Behavior (Correct System)
Provide updated `selectedOptions` without Mushroom; server replaces the modifier array for that item.

#### Current Backend Status
**NOT IMPLEMENTED** — no endpoint to update modifiers.

#### Evidence
Same as Case 3 — no modifier-mutation endpoint exists.

#### Proposed Design

Same `PATCH /api/carts/my/items/:cartItemId/modifiers` endpoint as Case 3. The client sends the **full desired modifier state** — the server replaces `selectedModifiers` entirely and **never reads or writes `quantity`**.

```json
{
  "selectedOptions": [
    { "groupId": "toppings-group-uuid", "optionId": "cheese-uuid" }
  ]
}
```

> **Why not PUT with `{ quantity, selectedOptions }`?**  
> The UI widget for removing a topping has no quantity input field. If `quantity` is omitted and the DTO treats it as optional, the backend receives `dto.quantity === undefined`. Any spread `{ ...existing, quantity: dto.quantity }` silently resets the item quantity — corrupting the cart without any error.

#### Proposed Test Case

```http
# Precondition: Pizza × 2 (Cheese + Mushroom) in cart, cartItemId = "xyz-456"

# Remove Mushroom — send only remaining desired state
PATCH /api/carts/my/items/xyz-456/modifiers
Authorization: Bearer <token>
Content-Type: application/json

{
  "selectedOptions": [
    { "groupId": "<toppings-uuid>", "optionId": "<cheese-uuid>" }
  ]
}
```

Expected: HTTP 200; `selectedModifiers` contains only Cheese; `quantity === 2` (unchanged).

---

### Case 5: Multi-select group — adding options step-by-step

#### Description
Customer opens a UI where they toggle toppings one at a time. Each toggle is a PATCH call. The system must accumulate selected options per group.

#### Expected Behavior (Correct System)
Each PATCH call sends the **full desired modifier state** (not a delta). Server validates against `maxSelections` and replaces entirely. No step-by-step accumulation needed if PUT semantics are used.

#### Current Backend Status
**NOT IMPLEMENTED** — no modifier update endpoint.

#### Evidence
No endpoint exists to update modifiers. The client would be forced to `DELETE` + `POST` the item to change any modifier.

#### Proposed Design

Use `PATCH /api/carts/my/items/:cartItemId/modifiers` each time the UI toggles a topping. The UI maintains the full desired option state client-side and sends it on each call (replace semantics). `quantity` is never part of this payload.

> **Why not `PUT` with `{ quantity, selectedOptions }`?**  
> A topping-toggle UI widget has no quantity input. If the client omits `quantity` and the DTO makes it optional, the server receives `dto.quantity === undefined`. The cart item gets `quantity: undefined`. Even if `quantity` is required, forcing the client to look up and resend the current quantity just to toggle a topping is unnecessary coupling between two independent concerns — it adds a mandatory GET round-trip before every topping change.

#### Proposed Test Case

```http
# Precondition: Burger × 1, no toppings, cartItemId = "cart-item-001"

# Step 1 — Toggle Cheese on
PATCH /api/carts/my/items/cart-item-001/modifiers
Content-Type: application/json
{ "selectedOptions": [{ "groupId": "g1", "optionId": "cheese-uuid" }] }
# quantity stays 1

# Step 2 — Toggle Mushroom on (send full desired state)
PATCH /api/carts/my/items/cart-item-001/modifiers
Content-Type: application/json
{
  "selectedOptions": [
    { "groupId": "g1", "optionId": "cheese-uuid" },
    { "groupId": "g1", "optionId": "mushroom-uuid" }
  ]
}
```

Assert step 2: `selectedModifiers.length === 2`; `quantity === 1` (untouched); maxSelections not exceeded.

---

### Case 6: Violating maxSelections constraint

#### Description
Customer sends 3 options for a group with `maxSelections=2`.

#### Example

```http
POST /api/carts/my/items
Content-Type: application/json

{
  "menuItemId": "...",
  "selectedOptions": [
    { "groupId": "toppings-uuid", "optionId": "opt1" },
    { "groupId": "toppings-uuid", "optionId": "opt2" },
    { "groupId": "toppings-uuid", "optionId": "opt3" }
  ]
}
```

#### Expected Behavior (Correct System)
`400 Bad Request` with message identifying the group and max allowed.

#### Current Backend Status
**IMPLEMENTED** (when snapshot present).

#### Evidence
`cart.service.ts:validateAndResolveModifiers`:
```typescript
const countForGroup = selectionCountByGroup.get(sel.groupId) ?? 0;
if (group.maxSelections > 0 && countForGroup > group.maxSelections) {
  throw new BadRequestException(
    `Modifier group "${group.groupName}" allows at most ${group.maxSelections} selection(s).`
  );
}
```

#### If Implemented → How to Test

```http
POST /api/carts/my/items
Authorization: Bearer <token>
Content-Type: application/json

{
  "menuItemId": "<item-with-max2-group>",
  "restaurantId": "...",
  "restaurantName": "...",
  "itemName": "Pizza",
  "unitPrice": 10.00,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "<toppings-uuid>", "optionId": "<opt1>" },
    { "groupId": "<toppings-uuid>", "optionId": "<opt2>" },
    { "groupId": "<toppings-uuid>", "optionId": "<opt3>" }
  ]
}
```

Expected: HTTP 400, message includes `"allows at most 2 selection(s)"`.

---

### Case 7: Violating minSelections constraint (required group not satisfied)

#### Description
Customer omits a required modifier group (`minSelections=1`), e.g., Size is mandatory.

#### Expected Behavior (Correct System)
`400 Bad Request`.

#### Current Backend Status
**IMPLEMENTED** (when snapshot present).

#### Evidence
`cart.service.ts:validateAndResolveModifiers`:
```typescript
for (const group of snapshotModifiers) {
  if (group.minSelections > 0) {
    const count = selectionCountByGroup.get(group.groupId) ?? 0;
    if (count < group.minSelections) {
      throw new BadRequestException(
        `Modifier group "${group.groupName}" requires at least ${group.minSelections} selection(s), got ${count}.`
      );
    }
  }
}
```

#### If Implemented → How to Test

```http
POST /api/carts/my/items
Authorization: Bearer <token>
Content-Type: application/json

{
  "menuItemId": "<item-with-required-size>",
  "restaurantId": "...",
  "restaurantName": "...",
  "itemName": "Coffee",
  "unitPrice": 3.00,
  "quantity": 1,
  "selectedOptions": []
}
```

Expected: HTTP 400, message includes `"requires at least 1 selection(s)"`.

---

### Case 8: Default options — auto-application

#### Description
A modifier group has `isDefault: true` on an option (e.g., "Medium" is the default size). Customer adds the item without specifying any options for that group.

#### Expected Behavior (Correct System)
Two valid approaches:
- **Server auto-applies**: If group has `minSelections > 0` and the customer sends no selection for that group but a default option exists, auto-inject the default option.
- **Client responsibility**: Client must always send defaults explicitly; server only validates.

The current codebase implies client responsibility (Phase 2 design), but `isDefault` metadata is projected in snapshots with no server enforcement.

#### Current Backend Status
**NOT IMPLEMENTED** — default options are never auto-applied. If a group has `minSelections=1` and a default option, the customer still gets a `400 Bad Request` for not explicitly selecting it.

#### Evidence
`menu-item-updated.event.ts`:
```typescript
export interface ModifierOptionSnapshot {
  optionId: string;
  name: string;
  price: number;
  isDefault: boolean;  // present in snapshot but never used in validation logic
}
```
`validateAndResolveModifiers` iterates only `dto.selectedOptions` — no auto-injection of defaults.

#### Proposed Design

In `validateAndResolveModifiers`, after the `minSelections` check:
```typescript
// Auto-inject default options for required groups with no selection sent
for (const group of snapshotModifiers) {
  if (group.minSelections > 0 && !selectionCountByGroup.has(group.groupId)) {
    const defaultOption = group.options.find(o => o.isDefault);
    if (defaultOption) {
      resolvedModifiers.push({ ...defaultOption, groupId: group.groupId, groupName: group.groupName });
      continue; // skip the minSelections error for this group
    }
    // No default — let minSelections error fire below
  }
}
```

#### Proposed Test Case

```http
POST /api/carts/my/items
Authorization: Bearer <token>
Content-Type: application/json

{
  "menuItemId": "<item-with-default-size>",
  "restaurantId": "...",
  "restaurantName": "...",
  "itemName": "Coffee",
  "unitPrice": 3.00,
  "quantity": 1,
  "selectedOptions": []
}
```

Expected (after fix): HTTP 201; `selectedModifiers` includes the default option automatically.

---

### Case 9: Re-adding same item with DIFFERENT modifiers

#### Description
Customer adds Coffee + Size: Large. Then adds Coffee + Size: Small. The UX expectation is two separate cart lines: one Large, one Small.

#### Example — Second call:

```http
POST /api/carts/my/items
Content-Type: application/json

{
  "menuItemId": "coffee-uuid",
  "restaurantId": "...",
  "restaurantName": "Bistro",
  "itemName": "Coffee",
  "unitPrice": 3.00,
  "quantity": 1,
  "selectedOptions": [
    { "groupId": "size-uuid", "optionId": "small-uuid" }
  ]
}
```

#### Expected Behavior (Correct System)
Two distinct line items in the cart: `Coffee × 1 (Large)` and `Coffee × 1 (Small)`.

#### Current Backend Status
**NOT IMPLEMENTED — critical UX bug**

#### Evidence
`cart.service.ts:addItem`:
```typescript
const existingIndex = cart.items.findIndex(
  (i) => i.menuItemId === dto.menuItemId,  // keyed by menuItemId ONLY
);

if (existingIndex >= 0) {
  // Merges quantity — new modifiers are SILENTLY IGNORED
  cart.items[existingIndex] = { ...existing, quantity: newQty };
}
```
There is no comparison of `selectedModifiers` in the identity check. The second add increments quantity from 1→2 and discards the "Small" modifier. The cart now shows `Coffee × 2 (Large)` with no record of the intended Small.

#### Proposed Design

Change item identity to include modifier fingerprint:

**Option A — Composite identity (recommended):**
Add a `cartItemId` (UUID) to `CartItem`. Items are always appended; merging happens only when `menuItemId` AND `selectedModifiers` fingerprint both match.

```typescript
// Fingerprint: sorted array of "groupId:optionId" pairs
function buildModifierFingerprint(options: SelectedOptionDto[]): string {
  return [...options]
    .sort((a, b) => a.groupId.localeCompare(b.groupId) || a.optionId.localeCompare(b.optionId))
    .map(o => `${o.groupId}:${o.optionId}`)
    .join('|');
}
```

Match condition:
```typescript
const existingIndex = cart.items.findIndex(
  (i) => i.menuItemId === dto.menuItemId &&
         i.modifierFingerprint === buildModifierFingerprint(dto.selectedOptions ?? [])
);
```

**Impact on other endpoints:** `PATCH` and `DELETE` must use `cartItemId` not `menuItemId`, since multiple items with the same `menuItemId` can now exist.

#### Proposed Test Case

```http
# Add Coffee Large
POST /api/carts/my/items
{ "menuItemId": "coffee-uuid", ..., "selectedOptions": [{ "groupId": "g1", "optionId": "large" }] }

# Add Coffee Small
POST /api/carts/my/items
{ "menuItemId": "coffee-uuid", ..., "selectedOptions": [{ "groupId": "g1", "optionId": "small" }] }

# Get cart
GET /api/carts/my
```

Expected: `items.length === 2` with distinct `selectedModifiers`.

---

### Case 10: Re-adding same item with SAME modifiers (quantity merge)

#### Description
Customer adds Coffee + Large twice. Should merge to `quantity: 2`.

#### Expected Behavior (Correct System)
Quantities merge. Single line item `Coffee × 2 (Large)`.

#### Current Backend Status
**IMPLEMENTED** for the current (modifier-ignoring) identity model. After Case 9 fix, merge logic will still work correctly using the fingerprint-based match.

#### Evidence
`cart.service.ts:addItem` merges when `existingIndex >= 0`.

#### If Implemented → How to Test

```http
# Call twice with identical payload:
POST /api/carts/my/items
{ "menuItemId": "coffee-uuid", "quantity": 1, "selectedOptions": [{ "groupId": "g1", "optionId": "large" }] }

GET /api/carts/my
```

Expected: `items.length === 1`, `quantity === 2`.

---

### Case 11: Selecting an unavailable modifier option

#### Description
A modifier option has `isAvailable: false` in the `modifierOptions` table (e.g., "Oat Milk" is sold out). Customer sends its `optionId`.

#### Expected Behavior (Correct System)
`400 Bad Request` — unavailable option cannot be selected.

#### Current Backend Status
**NOT IMPLEMENTED — silent data integrity issue**

#### Evidence
`menu-item-updated.event.ts` — `ModifierOptionSnapshot` does **not** include `isAvailable`:
```typescript
export interface ModifierOptionSnapshot {
  optionId: string;
  name: string;
  price: number;
  isDefault: boolean;
  // isAvailable is ABSENT — never projected into snapshot JSONB
}
```

`cart.service.ts:validateAndResolveModifiers` — the only availability check on options is:
```typescript
if (!option.isDefault && option.price === undefined) {
  // defensive guard — never checks isAvailable
}
```

Even if the event carried `isAvailable`, validation code does not check it.

#### Proposed Design

**Step 1 — Add `isAvailable` to `ModifierOptionSnapshot` in the event:**
```typescript
export interface ModifierOptionSnapshot {
  optionId: string;
  name: string;
  price: number;
  isDefault: boolean;
  isAvailable: boolean; // ADD THIS
}
```

**Step 2 — Populate it in `MenuItemProjector` when handling `MenuItemUpdatedEvent`.**

**Step 3 — Validate in `validateAndResolveModifiers`:**
```typescript
if (!option.isAvailable) {
  throw new BadRequestException(
    `Modifier option "${option.name}" is currently unavailable.`
  );
}
```

#### Proposed Test Case

```http
# With oat-milk option marked isAvailable=false in snapshot:
POST /api/carts/my/items
{ "selectedOptions": [{ "groupId": "milk-uuid", "optionId": "oat-milk-uuid" }] }
```

Expected: HTTP 400, `"Modifier option 'Oat Milk' is currently unavailable."`.

---

### Case 12: Modifier constraints not re-validated at checkout

#### Description
Customer adds an item at 10:00 with valid modifiers. At 10:05, the restaurant changes a modifier group's `maxSelections` from 3 to 1. Customer checks out at 10:10 — the cart has 3 selections for that group.

#### Expected Behavior (Correct System)
Checkout should re-validate modifier constraints against the current snapshot and reject with a descriptive error.

#### Current Backend Status
**NOT IMPLEMENTED**

#### Evidence
`place-order.handler.ts:assertAllItemsAreAvailable` only validates item-level status:
```typescript
if (snapshot.status !== 'available') { ... }
```
There is no re-validation of:
- `minSelections` / `maxSelections` against cart's `selectedModifiers`
- Option availability (`isAvailable`)
- Group existence

`buildOrderItemsFromSnapshots` processes only `unitPrice` and `quantity` — `cartItem.selectedModifiers` is never read in the checkout handler.

#### Proposed Design

Add a `assertModifierConstraintsAtCheckout(cartItems, snapshotMap)` helper in `PlaceOrderHandler` that runs the same group/option validation logic as `validateAndResolveModifiers`.

#### Proposed Test Case

```http
# 1. Add item with 3 toppings (maxSelections=3 at add time)
POST /api/carts/my/items
{ "selectedOptions": [opt1, opt2, opt3] }

# 2. Restaurant reduces maxSelections to 1 (simulate via DB/admin API)

# 3. Checkout
POST /api/carts/my/checkout
{ "deliveryAddress": {...}, "paymentMethod": "cod" }
```

Expected: HTTP 422 with message about maxSelections violation.  
Actual: HTTP 201 (order created with stale modifier data).

---

### Case 13: Modifier prices excluded from order total at checkout — **CRITICAL BUG**

#### Description
Customer adds Coffee (base price $3.00) + Size: Large (+$1.50). Expected total = $4.50 × quantity. Actual order total created = $3.00 × quantity.

#### Expected Behavior (Correct System)
`totalAmount = Σ (basePrice + Σ modifierPrices) × quantity` per item.

#### Current Backend Status
**PRICING BUG — INCORRECT TOTAL**

#### Evidence
`place-order.handler.ts:buildOrderItemsFromSnapshots`:
```typescript
const unitPrice = snapshot!.price;          // base price only
const subtotal = unitPrice * cartItem.quantity;  // modifier prices IGNORED
return { menuItemId, itemName, unitPrice, quantity, subtotal };
```

`cart.controller.ts:toResponse` (CartResponseDto) — correctly includes modifier prices for display:
```typescript
const modifiersTotal = (item.selectedModifiers ?? []).reduce(
  (sum, m) => sum + m.price, 0,
);
subtotal: (item.unitPrice + modifiersTotal) * item.quantity
```

**The cart preview shows the correct price. The actual order is created with the wrong (lower) price. This is a revenue integrity issue.**

#### Proposed Fix

```typescript
private buildOrderItemsFromSnapshots(
  cartItems: CartItem[],
  snapshotMap: Map<string, OrderingMenuItemSnapshot>,
) {
  return cartItems.map((cartItem) => {
    const snapshot = snapshotMap.get(cartItem.menuItemId)!;
    const basePrice = snapshot.price;

    // Re-resolve modifier prices from snapshot (not from cart — fresher source)
    const modifiersTotal = this.resolveModifierPricesFromSnapshot(
      cartItem.selectedModifiers,
      snapshot.modifiers,
    );

    const unitPrice = basePrice + modifiersTotal;
    const subtotal = unitPrice * cartItem.quantity;

    return { menuItemId: cartItem.menuItemId, itemName: snapshot.name, unitPrice, quantity: cartItem.quantity, subtotal };
  });
}
```

#### Proposed Test Case

```http
# 1. Add item with price modifier
POST /api/carts/my/items
{ "menuItemId": "...", "unitPrice": 3.00, "quantity": 1,
  "selectedOptions": [{ "groupId": "size", "optionId": "large" }] }
# (Large option has snapshot price +1.50)

# 2. Checkout
POST /api/carts/my/checkout
{ "deliveryAddress": {...}, "paymentMethod": "cod" }

# Assert order.totalAmount === 4.50, NOT 3.00
GET /api/orders/:orderId
```

---

### Case 14: Modifier selections lost in order items — **CRITICAL BUG**

#### Description
After checkout, the `order_items` table contains no record of modifier selections. Order history, receipts, restaurant KDS display, and dispute resolution all lack modifier data.

#### Expected Behavior (Correct System)
`order_items` should include a `selectedModifiers` JSONB column (or equivalent) that captures the exact modifier selections snapshotted at checkout.

#### Current Backend Status
**NOT IMPLEMENTED**

#### Evidence
`place-order.handler.ts:persistOrderAtomically` inserts `order_items` without modifiers:
```typescript
const newOrderItems: NewOrderItem[] = items.map((item) => ({
  orderId: insertedOrder.id,
  menuItemId: item.menuItemId,
  itemName: item.itemName,
  unitPrice: item.unitPrice,
  quantity: item.quantity,
  subtotal: item.subtotal,
  // selectedModifiers: MISSING
}));
```

`order.schema.ts` (not shown) would need a `modifiers` JSONB column added.

#### Proposed Fix

1. Add `modifiers jsonb` column to `order_items` schema.
2. Pass `cartItem.selectedModifiers` through `buildOrderItemsFromSnapshots` and into `NewOrderItem`.

#### Proposed Test Case

```http
POST /api/carts/my/checkout
{ "deliveryAddress": {...}, "paymentMethod": "cod" }

GET /api/orders/:orderId
```

Expected: `order.items[0].modifiers = [{ groupName: "Size", optionName: "Large", price: 1.50 }]`  
Actual: `order.items[0].modifiers` field does not exist.

---

### Case 15: Using menuItemId as PATCH/DELETE target when multiple lines have same item

#### Description
After Case 9 is fixed (same item with different modifiers = separate lines), `PATCH /carts/my/items/:menuItemId` and `DELETE /carts/my/items/:menuItemId` become ambiguous — they would match the first occurrence.

#### Expected Behavior (Correct System)
Endpoints should use a `cartItemId` (stable UUID per line item) as the route parameter.

#### Current Backend Status
**ARCHITECTURAL GAP** — currently works only because items are keyed by `menuItemId` (Case 9 bug). Fixing Case 9 breaks Case 15 unless route params are updated.

#### Proposed Design

- Add `cartItemId: string` (UUID) to `CartItem` type, generated at append time (`randomUUID()`).
- Change routes to:
  ```
  PATCH  /api/carts/my/items/:cartItemId
  DELETE /api/carts/my/items/:cartItemId
  PUT    /api/carts/my/items/:cartItemId
  ```

---

### Case 16: Invalid groupId or optionId submitted by client

#### Description
Client sends a `groupId` or `optionId` that does not exist on the item's snapshot.

#### Expected Behavior (Correct System)
`400 Bad Request` with clear identification of the invalid ID.

#### Current Backend Status
**IMPLEMENTED** (when snapshot present).

#### Evidence
`cart.service.ts:validateAndResolveModifiers`:
```typescript
const group = groupMap.get(sel.groupId);
if (!group) {
  throw new BadRequestException(`Modifier group ${sel.groupId} does not exist...`);
}
const option = group.options.find((o) => o.optionId === sel.optionId);
if (!option) {
  throw new BadRequestException(`Modifier option ${sel.optionId} does not exist...`);
}
```

#### If Implemented → How to Test

```http
POST /api/carts/my/items
{ "selectedOptions": [{ "groupId": "nonexistent-uuid", "optionId": "any-uuid" }] }
```

Expected: HTTP 400.

---

### Case 17: Adding item from different restaurant mid-cart (BR-2)

#### Description
Cart has items from Restaurant A; customer tries to add an item from Restaurant B.

#### Expected Behavior (Correct System)
`409 Conflict` with message identifying the restaurant mismatch.

#### Current Backend Status
**IMPLEMENTED**.

#### Evidence
`cart.service.ts:addItem`:
```typescript
if (cart.restaurantId !== dto.restaurantId) {
  throw new ConflictException(`Cart already contains items from restaurant "${cart.restaurantName}". ...`);
}
```

---

## 3. Critical Missing Cases (Top Priority)

| Priority | Case | Impact |
|---|---|---|
| **P0** | Case 13 — Modifier prices excluded from order total | Revenue integrity — orders created with wrong totalAmount |
| **P0** | Case 14 — Modifier selections lost in order_items | Data integrity — receipts, KDS, history all broken |
| **P1** | Case 9 — Re-adding same item with different modifiers merges silently | Core UX — "Latte x2" instead of "Hot Latte x1 + Iced Latte x1" |
| **P1** | Case 3 — No endpoint to change modifiers on existing cart item | Core UX — customer must delete + re-add to fix an option |
| **P1** | Case 15 — Route uses menuItemId; ambiguous after Case 9 fix | Architectural pre-req for Case 9 fix |
| **P2** | Case 11 — Unavailable modifier option not blocked | Data integrity — sold-out options can be ordered |
| **P2** | Case 12 — Modifier constraints not re-validated at checkout | Stale constraint bypass |
| **P3** | Case 8 — Default options not auto-applied | UX — client must always send defaults |
| **P3** | Case 2 (partial) — Modifiers silently dropped when no snapshot | Silent data loss in Phase 2 mode |

---

## 4. Recommended API Improvements

### 4.1 Add `cartItemId` to cart items

```typescript
// cart.types.ts
export interface CartItem {
  cartItemId: string;   // NEW — stable UUID per line item
  menuItemId: string;
  modifierFingerprint: string; // NEW — for merge identity
  // ... existing fields
}
```

### 4.2 ⛔ Anti-pattern: Full item replace with combined `quantity` + `selectedOptions`

```
❌ PUT /api/carts/my/items/:cartItemId
   { "quantity": 2, "selectedOptions": [...] }   ← DO NOT USE
```

**Why this is dangerous:**  
A client that only wants to change modifiers (e.g. a topping toggle UI) has no reason to know or resend the current quantity. If `quantity` is optional in the DTO:

```typescript
// Bug: silently resets quantity when dto.quantity is undefined
cart.items[itemIndex] = { ...existing, quantity: dto.quantity, selectedModifiers: resolved };
//                                              ^^^^^^^^^^^^^ → undefined → NaN totals
```

If `quantity` is made required to prevent `undefined`, the client must do a GET before every modifier toggle to echo back the current quantity — unnecessary coupling.

**Use the two dedicated endpoints below instead.**

### 4.3 New endpoint: Modifier-only update (recommended)

```
PATCH /api/carts/my/items/:cartItemId/modifiers
```

**Payload — no `quantity` field:**
```json
{
  "selectedOptions": [
    { "groupId": "size-uuid", "optionId": "large-uuid" }
  ]
}
```

**Behavior:** Replaces the entire `selectedModifiers` array. `quantity` is read-only in this handler — never written. Validates `selectedOptions` against snapshot (same rules as `addItem`).

**DTO:**
```typescript
export class UpdateCartItemModifiersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectedOptionDto)
  selectedOptions!: SelectedOptionDto[];  // required — send [] to clear all modifiers
}
```

### 4.4 Update PATCH and DELETE to use cartItemId

```
PATCH  /api/carts/my/items/:cartItemId   (quantity only — existing behavior)
DELETE /api/carts/my/items/:cartItemId
```

This removes the ambiguity when multiple line items share the same `menuItemId`.

**Quantity-only DTO (unchanged from current):**
```typescript
export class UpdateCartItemQuantityDto {
  @IsInt() @Min(0) @Max(99)
  quantity!: number;   // required — no selectedOptions field; cannot accidentally null modifiers
}
```

### 4.5 Principle: One endpoint, one concern

| Endpoint | Touches | Does NOT touch |
|---|---|---|
| `PATCH /items/:cartItemId` | `quantity` only | `selectedModifiers` — untouched |
| `PATCH /items/:cartItemId/modifiers` | `selectedModifiers` only | `quantity` — untouched |
| `DELETE /items/:cartItemId` | removes line item | — |

This strict separation makes both endpoints safe to call independently without requiring the client to fetch the current cart state first.

---

## 5. Pricing Integrity Check

| Check | Status | Evidence |
|---|---|---|
| Server resolves modifier prices from snapshot | ✅ At add-time | `validateAndResolveModifiers` sets `price: option.price` from snapshot |
| Client-supplied prices are NOT trusted | ✅ At add-time | `AddItemToCartDto` has no `modifierPrice` field; option prices come from snapshot only |
| Base item price trusted from client | ⚠️ PARTIAL | `unitPrice` is client-supplied in `AddItemToCartDto`; snapshot price overrides at checkout only |
| Modifier prices included in `CartResponseDto` subtotal | ✅ | `cart.controller.ts:toResponse` sums `selectedModifiers[*].price` |
| Modifier prices included in `order_items.subtotal` | ❌ **BUG** | `buildOrderItemsFromSnapshots` uses `snapshot.price` only — modifier prices lost |
| Modifier prices recalculated from ACL at checkout | ❌ **MISSING** | Should re-resolve modifier prices from `snapshot.modifiers` at checkout for freshness |
| Price drift possible between add and checkout | ⚠️ YES | Cart stores modifier prices at add-time; if snapshot changes between add and checkout, drift occurs because checkout doesn't re-resolve modifier prices |

### Summary

The cart preview (`CartResponseDto`) shows correct pricing including modifiers. However, the actual `Order` is created with `totalAmount` based on base price only. This means:

- Customer sees `$4.50` in their cart.
- Order is created with `totalAmount = $3.00`.
- Restaurant receives an order totaling less than the customer expects to pay.
- If payment is COD, the driver collects the wrong amount.
- If payment is VNPay, the customer is charged `$3.00` instead of `$4.50`.

This is a **revenue integrity bug** that must be fixed before production.

---

## 6. Final Verdict

### Is the cart system production-ready?

**NO.**

### Must fix before release

| # | Issue | File(s) |
|---|---|---|
| 1 | **Modifier prices must be included in `buildOrderItemsFromSnapshots`** | `place-order.handler.ts` |
| 2 | **`order_items` must persist `selectedModifiers` JSONB** | `order.schema.ts`, `place-order.handler.ts` |
| 3 | **Cart item identity must use `menuItemId` + modifier fingerprint; introduce `cartItemId`** | `cart.types.ts`, `cart.service.ts`, `cart.controller.ts` |
| 4 | **Add `PUT /carts/my/items/:cartItemId` for full item replace including modifiers** | `cart.controller.ts`, `cart.service.ts`, `cart.dto.ts` |
| 5 | **Add `isAvailable` to `ModifierOptionSnapshot` and validate it in `validateAndResolveModifiers`** | `menu-item-updated.event.ts`, `cart.service.ts` |
| 6 | **Re-validate modifier constraints at checkout in `PlaceOrderHandler`** | `place-order.handler.ts` |

### Can be deferred to next iteration

| # | Issue |
|---|---|
| 7 | Auto-inject default options server-side (Case 8) |
| 8 | Modifier constraint re-validation at checkout (Case 12) |
| 9 | Reject unknown `selectedOptions` when no snapshot exists instead of silently dropping (Case 2 partial) |

---

*Audit conducted against commit state as of 2026-04-29. All line references are approximate and should be verified against the current HEAD.*
