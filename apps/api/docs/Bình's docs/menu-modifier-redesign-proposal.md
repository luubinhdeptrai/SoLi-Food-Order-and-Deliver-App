# Menu & Modifiers Module Redesign Proposal

**Author:** Bình  
**Date:** 2026-04-28 (updated 2026-04-29)  
**Scope:** `restaurant-catalog` BC → `MenuModule` + `ModifiersModule`  
**Status:** ✅ IMPLEMENTED — all selected solutions shipped 2026-04-28/29

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Issue Catalogue](#3-issue-catalogue)
4. [Proposed Solutions](#4-proposed-solutions)
5. [Target Design](#5-target-design)
6. [Migration Strategy](#6-migration-strategy)
7. [Impact on Ordering BC](#7-impact-on-ordering-bc)
8. [Open Questions](#8-open-questions)

---

## 1. Executive Summary

> **✅ All issues below have been implemented.** This section is preserved for historical context.

The `menu` and `modifiers` sub-modules within `RestaurantCatalogModule` contained a mix of **critical runtime bugs**, **data integrity risks**, and **missing domain primitives**.

**Critical — ✅ FIXED:**

- **S-1** `ModifiersService.getRestaurantForItem()` stub — fixed: now calls `RestaurantService.findOne(restaurantId)` for real ownership.
- **S-2** `MenuService.assertItemAvailable()` dual-field check — fixed: checks `status !== 'available'` only; `isAvailable` column dropped.

**High — ✅ FIXED:**

- **M-1/M-2** `doublePrecision` prices on `menu_items` and modifier options — fixed: both use `numeric(12,2)` via `moneyColumn` custom type.
- **D-3/S-4** Dual availability fields + `isAvailable` in DTO — fixed: column and DTO field removed entirely.

**Medium — ✅ FIXED:**

- **D-1/M-3** Flat modifier model — fixed: full `modifier_groups` + `modifier_options` normalization (Option A).
- **D-2** Global hardcoded category enum — fixed: `menu_categories` table, per-restaurant dynamic categories (Option A).
- **I-1/I-2** Modifier mutations fired no events — fixed: all mutations publish `MenuItemUpdatedEvent` with full modifier tree (Option C).
- **I-3/I-4** Cart lacked `selectedModifiers` — fixed: `CartItem.selectedModifiers`, `AddItemToCartDto.selectedOptions`, full validation in `CartService`.

**Auth migration — ✅ FIXED (2026-04-29):**

- `CartController` used legacy JWT auth (`@CurrentUser()`, `JwtAuthGuard`) — migrated to `@Session()` / `UserSession` from `@thallesp/nestjs-better-auth`.
- `DevTestUserMiddleware` lacked Express `Request.user` type augmentation — fixed via `declare global namespace Express`.

**High (data integrity / incorrect behavior):**

- Both `menu_items.price` and `menu_item_modifiers.price` use `doublePrecision` (IEEE-754 float). For monetary data this causes rounding errors (e.g., `1.10 + 2.20 = 3.3000000000000003`). The pattern for correct monetary storage (`numeric(12,2)`) is already established in `order.schema.ts` and `ordering_menu_item_snapshots`.
- `UpdateMenuItemDto` exposes `isAvailable` as a writable API field. Any client can set `isAvailable=true` while simultaneously having `status='unavailable'`, permanently contradicting the two fields.

**Medium (missing domain model):**

- The modifier table is a flat list with no concept of **modifier groups** or **options**. Real-world restaurants require grouped choices with min/max selection rules (e.g., "Size: pick exactly 1 of Small / Medium / Large", "Toppings: pick up to 3"). The current flat model cannot express this.
- `menuItemCategoryEnum` is a **global hardcoded enum** of 6 categories. Every restaurant on the platform must categorize their items using only: `salads, desserts, breads, mains, drinks, sides`. A burger joint cannot add a `burgers` category.
- Modifier mutations fire **no events**, so the Ordering BC's snapshot layer has zero knowledge that modifier prices exist.

**Impact if shipped as-is:**

- Restaurant owners cannot manage their own modifiers → modifier management is admin-only forever.
- Menu item availability is governed by two diverging fields → customers may be charged for unavailable items or blocked from buying available ones.
- Float pricing accumulates rounding errors in order totals.
- Modifier pricing is invisible to checkout.

---

## 2. Current State Analysis

### 2.1 Schema: `menu.schema.ts`

```
menu_items
  id                 UUID PK
  restaurant_id      UUID FK → restaurants(id) CASCADE
  name               TEXT NOT NULL
  description        TEXT
  price              DOUBLE PRECISION ← ⚠️ float (monetary risk)
  sku                TEXT
  category           menu_item_category ENUM ← hardcoded 6 values globally
  status             menu_item_status ENUM ('available', 'unavailable', 'out_of_stock')
  image_url          TEXT
  is_available       BOOLEAN NOT NULL DEFAULT true ← ⚠️ redundant with status
  tags               TEXT[]
  created_at         TIMESTAMP
  updated_at         TIMESTAMP

menu_item_modifiers
  id                 UUID PK
  menu_item_id       UUID FK → menu_items(id) CASCADE
  name               TEXT NOT NULL
  description        TEXT
  price              DOUBLE PRECISION DEFAULT 0 ← ⚠️ float (monetary risk)
  is_required        BOOLEAN NOT NULL DEFAULT false ← ambiguous meaning
  created_at         TIMESTAMP
  updated_at         TIMESTAMP
```

**What is missing from `menu_item_modifiers`:**

- No `group` concept — cannot represent "Size" as a group with Small/Medium/Large options
- No `display_order` — cannot control how modifiers are presented to customers
- No `is_default` — cannot pre-select a default option in the UI
- No `min_selections` / `max_selections` on a group level
- `is_required` is a boolean on an individual modifier, ambiguous when the intent is "user must pick at least one from this group"

### 2.2 Service: `menu.service.ts`

| Method                  | Issue                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `assertItemAvailable()` | Checks `!isAvailable` **and** `status`. Double-redundancy with diverging fields          |
| `toggleSoldOut()`       | Only updates `status`; `isAvailable` is never updated → fields drift                     |
| `update()`              | Delegates to `repo.update(id, dto)` which spreads `dto` directly including `isAvailable` |
| `create()`              | Does not verify `restaurant.isApproved` before adding menu items                         |
| All mutations           | Fire `MenuItemUpdatedEvent` with no modifier data                                        |

### 2.3 DTOs: `menu/dto/menu.dto.ts`

| DTO                 | Issue                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| `UpdateMenuItemDto` | Exposes `isAvailable?: boolean` — lets clients diverge the two availability fields |
| `CreateMenuItemDto` | `@Min(0)` on `price` — allows free items (0.00), likely unintentional              |
| `UpdateMenuItemDto` | `@Min(0)` on `price` — same issue                                                  |

### 2.4 Service: `modifiers/modifiers.service.ts`

**The root cause of all modifier ownership bugs:**

```typescript
// Current implementation (BROKEN STUB):
private async getRestaurantForItem(restaurantId: string) {
  return { ownerId: restaurantId };  // returns restaurant's own UUID as ownerId
}

// Ownership check that depends on it:
const restaurant = await this.getRestaurantForItem(item.restaurantId);
if (restaurant.ownerId !== requesterId) {
  throw new ForbiddenException('You do not own this menu item');
}
// restaurant.ownerId === item.restaurantId (a restaurant UUID)
// requesterId === session.user.id (a user UUID)
// These are from different ID spaces — they NEVER match.
// Result: ALL non-admin users always get 403 Forbidden.
```

Additional issues in `ModifiersService`:

- No `EventBus` injection — modifier mutations (create/update/delete) publish **no events**
- `create()`, `update()`, `remove()` each perform 2–3 sequential DB round-trips before performing the actual write (findOne for item + getRestaurantForItem stub + write)
- `findByMenuItem()` calls `menuService.findOne()` then `repo.findByMenuItem()` — the menu item existence check is correct, but the pattern differs from how `MenuService` checks restaurant existence

### 2.5 Events: `shared/events/menu-item-updated.event.ts`

```typescript
class MenuItemUpdatedEvent {
  menuItemId: string;
  restaurantId: string;
  name: string;
  price: number; // item base price
  status: 'available' | 'unavailable' | 'out_of_stock';
  // ❌ NO modifier data — modifier names, prices, options are invisible to Ordering BC
}
```

### 2.6 Ordering BC Integration (current state)

| Layer                          | Current State                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `ordering_menu_item_snapshots` | Stores: `menuItemId, restaurantId, name, price, status`. Zero modifier data.                              |
| `MenuItemProjector`            | Only processes `MenuItemUpdatedEvent` — modifier events don't exist                                       |
| `CartItem`                     | Fields: `menuItemId, itemName, unitPrice, quantity`. No `selectedModifiers`.                              |
| `AddItemToCartDto`             | Fields: `menuItemId, restaurantId, restaurantName, itemName, unitPrice, quantity`. No modifier selection. |
| `PlaceOrderHandler`            | Builds order items from snapshot price. Modifier price never adds to total.                               |
| `OrderPlacedEvent`             | Items array: `{ menuItemId, name, quantity, unitPrice }`. No modifiers.                                   |

**Consequence:** Modifier pricing is completely disconnected from checkout. A restaurant could configure a modifier that costs +50,000 VND but the customer's order total would never include it.

---

## 3. Issue Catalogue

Issues are tagged by ID and severity. Implementation proposals in §4 reference these IDs.

### CRITICAL — ✅ FIXED

| ID      | Module           | Issue                                    | Status                                  |
| ------- | ---------------- | ---------------------------------------- | --------------------------------------- |
| **S-1** | ModifiersService | `getRestaurantForItem()` stub            | ✅ Fixed: `RestaurantService.findOne()` |
| **S-2** | MenuService      | `assertItemAvailable()` dual-field check | ✅ Fixed: `status` only                 |

### HIGH — ✅ FIXED

| ID      | Module           | Issue                                     | Status                          |
| ------- | ---------------- | ----------------------------------------- | ------------------------------- |
| **M-1** | menu.schema      | `menu_items.price: doublePrecision`       | ✅ Fixed: `numeric(12,2)`       |
| **M-2** | modifiers.schema | modifier `price: doublePrecision`         | ✅ Fixed: `numeric(12,2)`       |
| **D-3** | menu.schema      | `isAvailable` + `status` duality          | ✅ Fixed: `isAvailable` dropped |
| **S-4** | menu.dto         | `UpdateMenuItemDto` exposes `isAvailable` | ✅ Fixed: field removed         |

### MEDIUM — ✅ FIXED

| ID      | Module               | Issue                                                   | Status                                              |
| ------- | -------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| **D-1** | modifiers            | No modifier group/option model                          | ✅ Fixed: full Group+Option normalization           |
| **D-2** | menu.schema          | Global `menuItemCategoryEnum`                           | ✅ Fixed: `menu_categories` per-restaurant table    |
| **M-3** | modifiers.schema     | No `display_order`, `is_default`, selection constraints | ✅ Fixed: in `modifier_groups` + `modifier_options` |
| **I-1** | ModifiersService     | No events on modifier mutations                         | ✅ Fixed: `MenuItemUpdatedEvent` with modifier tree |
| **I-2** | MenuItemUpdatedEvent | Event carries no modifier data                          | ✅ Fixed: `modifiers[]` field added                 |
| **I-3** | cart.types           | `CartItem` has no `selectedModifiers`                   | ✅ Fixed: `SelectedModifier` interface + field      |
| **I-4** | cart.dto             | `AddItemToCartDto` has no modifier field                | ✅ Fixed: `SelectedOptionDto` + `selectedOptions`   |

### LOW — Open

| ID      | Module             | Issue                             | Status                                       |
| ------- | ------------------ | --------------------------------- | -------------------------------------------- |
| **S-3** | ModifiersService   | N+1 DB queries on writes          | ⚠️ Partially improved (stub removed)         |
| **S-5** | menu.dto           | `@Min(0)` allows zero-price items | ⚠️ Still open (pending product decision Q-1) |
| **S-6** | MenuService.create | No `restaurant.isApproved` check  | ⚠️ Still open (pending product decision Q-2) |

---

## 4. Proposed Solutions

### Fix S-1: Implement `getRestaurantForItem` correctly

**Root cause:** The stub `getRestaurantForItem(restaurantId)` was never wired to the database.

**Solution:** `ModifiersService` already has `MenuService` injected. `MenuService` already implements `assertOwnership()` which correctly fetches the restaurant and checks `restaurant.ownerId`. The fix is to either:

**Option A (Recommended): Inject `RestaurantService` directly into `ModifiersService`** (OK I choose this solution)

`ModifiersModule` imports `MenuModule`, and `MenuModule` exports `MenuService`. `RestaurantService` can be exported from `RestaurantModule` which `MenuModule` already imports. Wire `RestaurantService` into `ModifiersService`:

```typescript
// modifiers.service.ts — fix
private async getRestaurantForItem(restaurantId: string) {
  return this.restaurantService.findOne(restaurantId);
  // Now returns { ownerId: <actual user UUID>, ... }
}
```

**Option B: Delegate ownership to MenuService**

Extract `MenuService.assertOwnership()` into a public method `MenuService.assertItemOwnership(menuItemId, requesterId, isAdmin)` and call it from `ModifiersService`, eliminating the duplicate lookup pattern.

**Recommendation: Option A** — minimal change, self-contained fix. Option B is a refactor that can follow independently.

---

### Fix S-2 / D-3: Remove `isAvailable`, make `status` the single source of truth

**Root cause:** `isAvailable` was added as a shorthand boolean but `status` already encodes the same information with more granularity. The event contract (`MenuItemUpdatedEvent`) explicitly states `isAvailable` is intentionally omitted — `status` is canonical.

**Option A (Recommended): Drop `isAvailable` column entirely** (OK I choose this solution)

```sql
-- Migration
ALTER TABLE menu_items DROP COLUMN is_available;
```

```typescript
// menu.schema.ts — after
export const menuItems = pgTable('menu_items', {
  // ... remove isAvailable ...
  status: menuItemStatusEnum('status').notNull().default('available'),
  // status is the single source of truth
});
```

```typescript
// menu.service.ts — fix assertItemAvailable
async assertItemAvailable(id: string): Promise<MenuItem> {
  const item = await this.findOne(id);
  if (item.status !== 'available') {
    const reason = item.status === 'out_of_stock' ? 'out of stock' : 'unavailable';
    throw new ConflictException(`Item is ${reason}`);
  }
  return item;
}
```

- Remove `isAvailable` from `UpdateMenuItemDto` and `CreateMenuItemDto`
- Remove `toggleSoldOut` drift (no longer possible — single field)

**Option B: Keep `isAvailable` as a computed view**

Create a database view or a Drizzle computed expression. Not recommended — Drizzle ORM computed columns require raw SQL and add maintenance burden for no benefit.

**Recommendation: Option A.** Migration risk is low. The Ordering BC already ignores `isAvailable`.

---

### Fix M-1 / M-2: Replace `doublePrecision` with `numeric(12,2)` (I agree to this solution)

**Pattern already established** in `order.schema.ts` and `menu-item-snapshot.schema.ts`.

```typescript
// Reuse the same helper:
const moneyColumn = customType<{ data: number; driverData: string }>({
  dataType() { return 'numeric(12, 2)'; },
  fromDriver(value) { return parseFloat(value as string); },
  toDriver(value) { return String(value); },
});

// menu.schema.ts — apply to both tables
price: moneyColumn('price').notNull(),
// menu_item_modifiers:
price: moneyColumn('price').notNull().default(0),
```

```sql
-- Migration
ALTER TABLE menu_items ALTER COLUMN price TYPE numeric(12,2);
ALTER TABLE menu_item_modifiers ALTER COLUMN price TYPE numeric(12,2);
```

**Risk:** Low. PostgreSQL will cast existing float values to numeric. Values like `1.9999999999999998` will round to `2.00` — which is correct.

---

### Fix S-4: Remove `isAvailable` from `UpdateMenuItemDto` (I agree to this solution)

Dependent on Fix D-3 (drop the column). Once `isAvailable` is removed from the schema:

```typescript
// menu.dto.ts — UpdateMenuItemDto
export class UpdateMenuItemDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Min(0.01) price?: number; // also raise min from 0 to 0.01
  @IsOptional() @IsEnum(MENU_ITEM_CATEGORIES) category?: MenuItemCategory;
  @IsOptional()
  @IsEnum(['available', 'unavailable', 'out_of_stock'])
  status?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  // isAvailable removed
}
```

---

### Fix D-1 / M-3: Modifier Group + Option Model (Phase 2+)

This is the most significant structural change. Three options are considered:

#### Option A: Full Group/Option Normalization (Recommended for long-term) (I choose this solution)

Introduce two new tables replacing `menu_item_modifiers`:

```
modifier_groups
  id             UUID PK
  menu_item_id   UUID FK → menu_items(id) CASCADE
  name           TEXT NOT NULL       -- e.g. "Size", "Toppings", "Spice Level"
  description    TEXT
  min_selections INTEGER DEFAULT 1  -- minimum customer must select
  max_selections INTEGER DEFAULT 1  -- maximum customer can select (1 = single choice)
  display_order  INTEGER DEFAULT 0
  created_at     TIMESTAMP
  updated_at     TIMESTAMP

modifier_options
  id             UUID PK
  group_id       UUID FK → modifier_groups(id) CASCADE
  name           TEXT NOT NULL      -- e.g. "Small", "Medium", "Large"
  description    TEXT
  price          numeric(12,2) DEFAULT 0
  is_default     BOOLEAN DEFAULT false
  display_order  INTEGER DEFAULT 0
  is_available   BOOLEAN DEFAULT true  -- individual option can be 86'd
  created_at     TIMESTAMP
  updated_at     TIMESTAMP
```

**Business rule encoding examples:**

- "Size (required, exactly one)": `is_required=true, min_selections=1, max_selections=1`
- "Toppings (optional, pick up to 3)": `is_required=false, min_selections=0, max_selections=3`
- "Spice level (required, pick one)": `is_required=true, min_selections=1, max_selections=1`

**Pro:** Full domain expressiveness. Cart + checkout can validate modifier selections against constraints.  
**Con:** More migration work. Requires new API endpoints (CRUD for groups and options). Breaking change to modifier API.

#### Option B: Additive Columns on Existing Table (Low-risk interim)

Add missing fields to the existing flat `menu_item_modifiers` table without introducing a new table:

```sql
ALTER TABLE menu_item_modifiers
  ADD COLUMN group_name TEXT,         -- e.g. "Size" (denormalized grouping)
  ADD COLUMN display_order INTEGER DEFAULT 0,
  ADD COLUMN is_default BOOLEAN DEFAULT false,
  ADD COLUMN min_selections INTEGER DEFAULT 0,
  ADD COLUMN max_selections INTEGER DEFAULT 1;
```

**Pro:** Zero breaking API changes. Additive migration. Fast to ship.  
**Con:** `group_name` is denormalized (repeated per option, drift-prone). No referential integrity for groups. Weak constraint enforcement. Technical debt accumulates.

#### Option C: JSONB `modifiers` Column on `menu_items`

Store the entire modifier tree as JSONB on the menu item row.

**Pro:** Schema-free, fast iteration.  
**Con:** No column-level queryability. Cannot join or index individual options. Drizzle type safety is lost for modifier fields. Validation moves entirely to application layer. Not recommended.

**Recommendation:** Ship **Option B** as an unblocking interim in the next phase. Plan **Option A** as the target for a dedicated modifiers redesign phase. Document the Option B table as transitional.

---

### Fix D-2: Per-Restaurant Categories

The `menuItemCategoryEnum` PostgreSQL enum is the most constrained option. Two paths:

#### Option A: Replace enum with a `menu_categories` table (Recommended) (OK I choose this solution)

```
menu_categories
  id             UUID PK
  restaurant_id  UUID FK → restaurants(id) CASCADE
  name           TEXT NOT NULL
  display_order  INTEGER DEFAULT 0
  created_at     TIMESTAMP

menu_items.category_id → menu_categories(id)   -- replaces the enum column
```

**Pro:** Each restaurant defines their own categories. No global schema changes per new category.  
**Con:** Requires migration + FK change on `menu_items`. Slightly more complex queries.

#### Option B: Replace enum with a plain `TEXT` column with soft validation

```sql
ALTER TABLE menu_items ALTER COLUMN category TYPE text;
```

Validation moves to `class-validator` in the DTO (`@IsString()`, optionally `@IsIn(ALLOWED_CATEGORIES)`). The global enum constraint is removed.

**Pro:** Zero API changes except removing the enum restriction. Very fast to ship.  
**Con:** No referential integrity. Ad-hoc category values per restaurant without structure.

**Recommendation:** **Option B** in the short term (removes the blocking 6-category constraint). **Option A** in a later phase when the restaurant onboarding flow is built out.

---

### Fix I-1: Modifier Events

Modifier mutations (create/update/remove) must publish events so the Ordering BC can react.

**Option A: Extend `MenuItemUpdatedEvent` to carry modifier snapshot**

```typescript
class MenuItemUpdatedEvent {
  // ... existing fields ...
  modifiers?: Array<{
    id: string;
    name: string;
    price: number;
    isRequired: boolean;
  }>;
}
```

The `MenuItemProjector` upserts the snapshot including modifier prices. The `ordering_menu_item_snapshots` table gains a `modifiers JSONB` column.

**Option B: New `ModifierUpdatedEvent` — fine-grained modifier event**

Each modifier mutation publishes a `ModifierUpdatedEvent(modifierId, menuItemId, name, price)`. The Ordering BC tracks individual modifier snapshots.

**Option C: Publish `MenuItemUpdatedEvent` from `ModifiersService` after any modifier change** (OK I choose this solution) ( (lưu ý là tui đã chọn solution là "#### Option A: Full Group/Option Normalization (Recommended for long-term) (I choose this solution)", vì thế bạn khai báo data của modifiers trong MenuItemUpdatedEvent cho đúng với solution tui đã chọn))

When a modifier is created/updated/deleted, re-fetch the full menu item + all its modifiers and publish a `MenuItemUpdatedEvent` that includes the complete modifier list. The snapshot stores them in a JSONB column.

**Recommendation:** **Option C** in the short term — lowest implementation cost, zero new event types, backward compatible with the existing `MenuItemProjector`. The JSONB column on snapshots stores modifier data without requiring a normalized table in the Ordering BC.

---

## 7. Impact on Ordering BC

### 7.1 What changes automatically after Phase A/B

- **No Ordering BC changes required for Phase A/B.** `ModifiersService` bugs are internal to `RestaurantCatalog`. Fixing them and re-publishing events via the existing `MenuItemUpdatedEvent` (without modifiers) does not affect the Ordering BC.
- Phase A-4 (modifier mutations firing events) causes `MenuItemProjector` to run more frequently. This is **safe and desirable** — snapshot freshness improves.

### 7.2 What the Ordering BC must implement for Phase C

When `MenuItemUpdatedEvent` gains an optional `modifiers` array (Fix C-2):

1. **`ordering_menu_item_snapshots`** gains a `modifiers JSONB` column (Fix C-3).
2. **`MenuItemProjector`** must read `event.modifiers` and persist them into the snapshot's `modifiers` column.
3. **`MenuItemSnapshotRepository.upsert()`** must include `modifiers` in the `onConflictDoUpdate.set`.

No other Ordering BC changes are needed at Phase C. Cart and checkout flows do not yet use modifier data.

### 7.3 What the Ordering BC must implement for Phase D (full modifiers)

This is a significant Ordering BC expansion. Deferred to a dedicated Ordering Phase 5:

| Change                                                  | Location                | Description                                                                                                              |
| ------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Add `selectedModifiers?` to `CartItem`                  | `cart.types.ts`         | Each cart item can carry an array of selected modifier option IDs + snapshotted prices                                   |
| Add `modifiers?` to `AddItemToCartDto`                  | `cart.dto.ts`           | Clients submit selected modifier options when adding to cart                                                             |
| Validate modifier selections in `CartService.addItem()` | `cart.service.ts`       | Cross-check selected options against snapshot: options exist, group constraints satisfied (min/max), option is available |
| Snapshot modifier price at cart-add time                | `CartItem`              | Modifier prices are frozen at add time (not re-validated at checkout — same pattern as item price)                       |
| Include modifier total in cart item price               | `CartItem.unitPrice`    | `unitPrice = item.price + sum(selectedModifiers.price)`                                                                  |
| Persist modifier selections in `order_items`            | `order.schema.ts`       | Add a `selected_modifiers JSONB` column to `order_items`                                                                 |
| Include modifiers in `OrderPlacedEvent`                 | `order-placed.event.ts` | Notification/payment contexts need to display selected modifiers                                                         |

### 7.4 BC Boundary Contract

The Ordering BC must **never** import `menu.schema.ts` or any `restaurant-catalog` module directly. The integration path is strictly:

```
RestaurantCatalog BC
  └── MenuService / ModifiersService
      └── Publishes MenuItemUpdatedEvent (with optional modifiers)
              ↓
         EventBus (in-process)
              ↓
Ordering BC
  └── MenuItemProjector
      └── Upserts ordering_menu_item_snapshots
          └── CartService reads snapshot at add-item time
              └── PlaceOrderHandler re-validates at checkout
```

Modifier data that the Ordering BC stores in its snapshot is a **read-only projection** of the catalog state at event time. The Ordering BC never mutates modifier definitions.

---

## 8. Open Questions

| #       | Question                                                                                                                               | Impact                   | Suggested Answer                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q-1** | Should `price: @Min(0)` allow free items (price = 0)?                                                                                  | Menu DTO validation      | If free items are intentional (e.g., "free dessert with combo"), keep `@Min(0)`. Otherwise change to `@Min(0.01)`. **Decision needed from product team.**        |
| **Q-2** | Can a restaurant add menu items before their account is `isApproved`?                                                                  | Menu creation gate       | Recommend blocking: `if (!restaurant.isApproved) throw ConflictException`. This prevents orphaned catalog data.                                                  |
| **Q-3** | When a modifier is deleted, what happens to carts that contain that item (with the modifier selected)?                                 | Cart integrity (Phase D) | Options: (a) silently drop the modifier from the cart total; (b) invalidate the cart on next read; (c) block modifier deletion if any active cart references it. |
| **Q-4** | Should modifier price be frozen at cart-add time or re-validated at checkout?                                                          | Checkout correctness     | Recommend frozen at add-time (consistent with item price snapshotting). Notify customer if price changed between add and checkout.                               |
| **Q-5** | Is the interim Option B flat modifier table (with added columns) acceptable, or should the team go directly to Option A normalization? | Phase scope              | Option B ships faster but accrues debt. If the modifier model is a P0 customer feature, go directly to Option A.                                                 |
| **Q-6** | Will the `menuItemCategoryEnum` DROP require a coordinated deploy with the mobile/web clients?                                         | Deployment coordination  | Yes — if any client validates category against the 6-enum values, the clients must be updated before or simultaneously with the backend.                         |

---

## Appendix: Issue Quick-Reference

| ID  | Severity | Module               | Summary                                                                                             | Fix Reference                        |
| --- | -------- | -------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------ |
| S-1 | CRITICAL | ModifiersService     | `getRestaurantForItem` stub — all non-admin modifier writes return 403                              | §4 Fix S-1                           |
| S-2 | CRITICAL | MenuService          | `assertItemAvailable` checks both `isAvailable` and `status`; `toggleSoldOut` only updates `status` | §4 Fix S-2                           |
| M-1 | HIGH     | menu.schema          | `menu_items.price: doublePrecision` — float precision on money                                      | §4 Fix M-1/M-2                       |
| M-2 | HIGH     | modifiers.schema     | `menu_item_modifiers.price: doublePrecision` — float precision on money                             | §4 Fix M-1/M-2                       |
| D-3 | HIGH     | menu.schema          | Dual availability fields: `isAvailable` + `status`                                                  | §4 Fix S-2/D-3                       |
| S-4 | HIGH     | menu.dto             | `UpdateMenuItemDto` exposes `isAvailable` as writable                                               | §4 Fix S-4                           |
| D-1 | MEDIUM   | modifiers            | No modifier group/option model — `is_required` is ambiguous                                         | §4 Fix D-1                           |
| D-2 | MEDIUM   | menu.schema          | Global hardcoded `menuItemCategoryEnum` (6 values)                                                  | §4 Fix D-2                           |
| M-3 | MEDIUM   | modifiers.schema     | Missing `display_order`, `is_default`, group selection constraints                                  | §4 Fix D-1                           |
| I-1 | MEDIUM   | ModifiersService     | No events on modifier mutations                                                                     | §4 Fix I-1                           |
| I-2 | MEDIUM   | MenuItemUpdatedEvent | Event carries no modifier data                                                                      | §4 Fix I-1                           |
| I-3 | MEDIUM   | cart.types           | `CartItem` has no `selectedModifiers`                                                               | §7.3                                 |
| I-4 | MEDIUM   | cart.dto             | `AddItemToCartDto` has no modifier selection field                                                  | §7.3                                 |
| S-6 | LOW      | MenuService.create   | No `restaurant.isApproved` check before adding items                                                | §5.2 / Q-2                           |
| S-3 | LOW      | ModifiersService     | N+1 DB queries on every write                                                                       | §4 Fix S-1 (resolved as side effect) |
| S-5 | LOW      | menu.dto             | `@Min(0)` allows zero-price items/modifiers                                                         | Q-1                                  |
