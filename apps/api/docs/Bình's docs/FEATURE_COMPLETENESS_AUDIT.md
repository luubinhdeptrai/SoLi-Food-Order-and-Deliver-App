# Feature Completeness Audit: `restaurant-catalog`

> Reviewed by: Senior Backend Architect (AI)
> Date: 2026-04-25
> Scope: `apps/api/src/module/restaurant-catalog/**`
> Based on: actual source code (schema, service, controller, dto)

---

## Current State Snapshot

What actually exists in code right now:

**`restaurant` module:**
- `GET /restaurants` — list all
- `GET /restaurants/:id` — get one
- `POST /restaurants` — create (admin/restaurant role)
- `PATCH /restaurants/:id` — update name/address/phone/description/lat/lng/isOpen (admin/restaurant role)
- `DELETE /restaurants/:id` — delete (admin only)

**`menu` module:**
- `GET /menu-items?restaurantId=` — list by restaurant (with optional category filter)
- `GET /menu-items/:id` — get one
- `GET /menu-items/categories` — list category enum
- `POST /menu-items` — create item
- `PATCH /menu-items/:id` — update item
- `PATCH /menu-items/:id/sold-out` — toggle sold-out
- `DELETE /menu-items/:id` — delete item

**Schema fields:**
- Restaurant: `id, ownerId, name, description, address, phone, isOpen, isApproved, latitude, longitude, createdAt, updatedAt`
- MenuItem: `id, restaurantId, name, description, price, sku, category, status, imageUrl, isAvailable, tags, createdAt, updatedAt`

---

## 1. Feature Coverage

### Complete feature map for a production restaurant-catalog:

| Feature Area | Required | Current Status |
|---|---|---|
| Restaurant CRUD | ✅ | ✅ Implemented |
| Restaurant approval flow | ✅ | ❌ No approve endpoint |
| Restaurant open/close toggle | ✅ | ⚠️ In `PATCH /restaurants/:id` — not a dedicated toggle |
| Operating hours schedule | ✅ | ❌ Missing entirely |
| Temporary closure / maintenance | ✅ | ❌ Missing entirely |
| Delivery zone / service radius | ✅ | ❌ Missing entirely |
| Restaurant category / cuisine type | ✅ | ❌ Missing entirely |
| Restaurant cover image / logo | ✅ | ❌ Missing entirely |
| Menu item CRUD | ✅ | ✅ Implemented |
| Menu item sold-out toggle | ✅ | ✅ Implemented |
| Menu item categories | ✅ | ⚠️ Flat enum, no dedicated table |
| Menu item modifiers (size, toppings) | ✅ | ❌ Missing entirely |
| Menu item image upload | ⚠️ | ⚠️ `imageUrl` field only, no upload endpoint |
| Menu item price snapshot for orders | ✅ | ❌ No snapshot mechanism |
| Menu section / grouping | ⚠️ | ❌ No concept of menu sections |
| Search by name | ✅ | ❌ No SearchModule |
| Geo-based search | ✅ | ❌ No SearchModule |
| Filter by cuisine / category | ✅ | ❌ No SearchModule |
| Ordering integration contract | ✅ | ⚠️ `assertOpenAndApproved()` exists but never called |
| Item availability check for Ordering | ✅ | ❌ No `assertItemAvailable()` equivalent |
| Pagination on list endpoints | ✅ | ❌ `findAll()` returns everything |
| Soft delete | ⚠️ | ❌ Hard delete only |

---

## 2. Restaurant Module Completeness

### ✅ Covered

- Basic profile (name, description, address, phone)
- Geo coordinates (latitude, longitude)
- Open/close state (`isOpen`)
- Approval state (`isApproved`)
- Owner linking (`ownerId`)

---

### ❌ Missing: Approval Endpoint

`isApproved` exists in the schema and `assertOpenAndApproved()` checks it, but there is **no HTTP endpoint to set it to `true`**. A restaurant can be created but can never be approved. This makes `assertOpenAndApproved()` permanently broken for new restaurants.

**Fix:**
```typescript
// restaurant.controller.ts
@Patch(':id/approve')
@Roles('admin')
approve(@Param('id', ParseUUIDPipe) id: string) {
  return this.service.approve(id);
}

// restaurant.service.ts
async approve(id: string): Promise<Restaurant> {
  await this.findOne(id);
  return this.repo.update(id, { isApproved: true });
}
```

---

### ❌ Missing: Operating Hours

Currently `isOpen` is a manual boolean that restaurant owners toggle by hand. In production, restaurants open and close on a schedule. A customer checking at 2am should see the restaurant as closed automatically.

**What you need:**
```typescript
// operating_hours table
{
  id, restaurantId,
  dayOfWeek: 0-6,     // 0 = Sunday
  openTime: '08:00',  // string HH:mm
  closeTime: '22:00',
  isClosed: boolean,  // explicit day-off
}
```

**Service method:**
```typescript
// Called by a cron job or lazily on read
async isCurrentlyOpen(restaurantId: string): Promise<boolean>
```

Without this, `isOpen` is unreliable — restaurant owners must manually open/close every day.

---

### ❌ Missing: Restaurant Category / Cuisine Type

The bounded context doc mentions this context is responsible for **search/discovery**, but there is no `cuisineType` or `category` on the restaurant. A customer cannot filter restaurants by "Vietnamese", "Pizza", "Burgers", etc.

**Fix — add to schema:**
```typescript
cuisineTypes: text('cuisine_types').array(), // ['vietnamese', 'fast_food']
```

Or a proper join table if categories need to be admin-managed.

---

### ❌ Missing: Cover Image / Logo URL

`MenuItem` has `imageUrl`, but `Restaurant` has none. The customer-facing catalog shows restaurant logos and banners. Without this, the UI cannot display branded restaurant cards.

**Fix — add to schema:**
```typescript
logoUrl: text('logo_url'),
coverImageUrl: text('cover_image_url'),
```

---

### ❌ Missing: Delivery Zone / Service Radius

`latitude` and `longitude` exist but there is no delivery zone definition. Ordering context needs to know if a customer's address is within the restaurant's delivery area before allowing an order. Currently, any customer can order from any restaurant regardless of distance.

**Options:**

1. **Simple:** Add `deliveryRadiusKm: real` to the restaurant table. Ordering checks Haversine distance.
2. **Advanced:** Separate `service_zones` table with polygon geometry (PostGIS).

For MVP, option 1 is sufficient:
```typescript
deliveryRadiusKm: real('delivery_radius_km').notNull().default(5),
```

---

### ⚠️ Missing: Dedicated Open/Close Toggle Endpoint

Currently `isOpen` is changed via the generic `PATCH /restaurants/:id` endpoint with `{ isOpen: true }` in the body. This is functional but has two problems:

1. The restaurant owner can accidentally change other fields while toggling open state
2. No audit trail for open/close events

**Fix — add dedicated endpoint:**
```typescript
@Patch(':id/toggle-open')
@Roles('admin', 'restaurant')
toggleOpen(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
  return this.service.toggleOpen(id, user.sub, user.roles?.includes('admin'));
}
```

---

### ❌ Missing: Temporary Closure / Maintenance Mode

`isOpen` is a binary flag. There is no way to express:
- "Closed today for a holiday"
- "Under maintenance until 6pm"
- "Suspended by admin due to violation"

A `closureReason` + `closedUntil` pattern is needed:

```typescript
// Add to restaurant schema
temporarilyClosed: boolean('temporarily_closed').notNull().default(false),
closedUntil: timestamp('closed_until'),        // null = indefinite
closureReason: text('closure_reason'),          // 'holiday', 'maintenance', 'admin_suspended'
```

---

## 3. Menu Module Completeness

### ✅ Covered

- Menu item CRUD
- Categories (flat enum: salads, desserts, breads, mains, drinks, sides)
- Sold-out toggle (`toggleSoldOut`)
- Status enum (`available`, `unavailable`, `out_of_stock`)
- Price field
- Tags array
- Image URL field

---

### ❌ Missing: Item Modifiers / Options

This is the biggest gap in the menu module. Almost every food delivery app supports:
- Size: Small / Medium / Large (different prices)
- Add-ons: Extra cheese (+10k), extra sauce (+5k)
- Remove ingredients: No onion, no cilantro

Without modifiers, the menu cannot represent how real restaurants sell food. An order for "Pho" is meaningless if you cannot specify "large bowl + extra beef".

**Minimum viable modifier schema:**
```typescript
// modifier_groups table
{
  id, menuItemId, name: 'Size', required: boolean, maxSelect: number
}

// modifier_options table
{
  id, groupId, name: 'Large', priceAdjustment: 5000, isDefault: boolean
}
```

This is a significant amount of work but it is **required before any real orders can be placed**.

---

### ❌ Missing: Price Snapshot for Ordering

This is architecturally critical. The `bounded-context.md` explicitly states:

> **Snapshot Rule:** OrderItem stores item name + price at order time. Never depend on MenuService after order created.

But there is no snapshot mechanism in this context. When `OrderModule` creates an order, it must copy `MenuItem.price`, `MenuItem.name`, and any modifier prices into `OrderItem`. If a restaurant updates its prices, existing orders must NOT be affected.

Currently nothing enforces or facilitates this. The Ordering context will directly read `MenuItem.price` at creation time — which is acceptable — but this must be documented as a contract.

**What to add in this context:**
```typescript
// menu.service.ts — new method for Ordering to call
async getItemSnapshot(id: string): Promise<MenuItemSnapshot> {
  const item = await this.findOne(id);
  if (item.status !== 'available') {
    throw new UnprocessableEntityException(`Item ${id} is not available`);
  }
  return {
    menuItemId: item.id,
    name: item.name,
    price: item.price,
    snapshotAt: new Date(),
  };
}
```

This makes the snapshot contract explicit in the catalog context.

---

### ❌ Missing: `assertItemAvailable()` for Ordering

`assertOpenAndApproved()` exists for restaurant-level checks. But there is **no equivalent for menu items**. The Ordering context needs to verify that an item is still available before accepting it into a cart/order.

**Add to `MenuService`:**
```typescript
async assertItemAvailable(id: string): Promise<MenuItem> {
  const item = await this.findOne(id);
  if (item.status === 'out_of_stock') {
    throw new UnprocessableEntityException(`Item "${item.name}" is out of stock`);
  }
  if (item.status === 'unavailable') {
    throw new UnprocessableEntityException(`Item "${item.name}" is not available`);
  }
  return item;
}
```

---

### ⚠️ Partially Implemented: Category System

Categories are a flat enum hardcoded in the schema:
```typescript
'salads', 'desserts', 'breads', 'mains', 'drinks', 'sides'
```

**Problems:**
1. Cannot add new categories without a schema migration
2. All restaurants share the same categories — a "Pho restaurant" and a "Pizza restaurant" have the same options
3. No per-restaurant custom sections (e.g., "Lunch Special", "Chef's Recommendation")

For MVP this is acceptable. For production, categories should be a separate table per restaurant:
```typescript
// menu_categories table
{ id, restaurantId, name, displayOrder }
```

---

### ❌ Missing: Pagination

`findByRestaurant()` returns ALL menu items with no limit. A restaurant with 200+ items will send a huge payload.

**Fix:**
```typescript
async findByRestaurant(
  restaurantId: string,
  category?: MenuItemCategory,
  page = 1,
  limit = 50,
): Promise<{ items: MenuItem[]; total: number }>
```

---

## 4. Search & Discovery

### ❌ Entirely Missing

Your `bounded-context.md` explicitly lists `SearchModule` as part of this context. It does not exist at all.

The current `findAll()` in RestaurantService returns every restaurant in the database with no filtering, no ranking, no search.

**What is needed:**

#### Minimum viable search endpoint:
```
GET /restaurants/search?q=pizza&lat=10.76&lng=106.66&radius=5
```

Backed by:
```typescript
// restaurant.repository.ts
async search(params: {
  query?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  cuisineTypes?: string[];
  isOpenNow?: boolean;
  page: number;
  limit: number;
}): Promise<{ restaurants: Restaurant[]; total: number }>
```

For **geo search**, PostgreSQL supports this natively:

```sql
-- Haversine distance in km
6371 * acos(
  cos(radians($lat)) * cos(radians(latitude)) *
  cos(radians(longitude) - radians($lng)) +
  sin(radians($lat)) * sin(radians(latitude))
) AS distance_km
```

No PostGIS needed for simple radius search.

**Do you need a separate `SearchModule`?** For a monolith, a `search` method inside `RestaurantRepository` is sufficient. A separate `SearchModule` only makes sense when you introduce Elasticsearch/Algolia. Keep it simple for now.

---

## 5. Data & Domain Concerns

### Missing Entities

| Entity | Status | Impact |
|--------|--------|--------|
| `OperatingHours` | ❌ Missing | Restaurants cannot auto open/close by schedule |
| `ServiceZone` | ❌ Missing | No delivery area enforcement |
| `MenuCategory` (custom per restaurant) | ❌ Missing | All restaurants share global enum |
| `ModifierGroup` | ❌ Missing | No customization on menu items |
| `ModifierOption` | ❌ Missing | No add-ons or size variants |
| `MenuItemSnapshot` (value object) | ❌ Missing | No price isolation contract for Ordering |
| `RestaurantImage` | ❌ Missing | No logo/cover for catalog display |

### Missing Business Invariants

1. **A restaurant cannot be opened if not approved** — `assertOpenAndApproved()` exists but `isOpen` can still be set to `true` via `PATCH /restaurants/:id` even when `isApproved = false`. The `update()` method does not enforce this.

2. **A menu item cannot be added to an unapproved restaurant** — no check in `MenuService.create()`.

3. **Price must be > 0 for orderable items** — `@Min(0)` allows `price = 0`, which would be a free item. Probably should be `@Min(0.01)`.

---

## 6. Integration Readiness with Ordering

| What Ordering Needs | Available Now | Status |
|---|---|---|
| Check if restaurant is open & approved | `assertOpenAndApproved(id)` | ⚠️ Exists but never called, not integrated |
| Check if menu item is available | nothing | ❌ Missing |
| Get item price at order creation time | `MenuItem.price` direct read | ⚠️ Works but no explicit snapshot contract |
| Check if item is within delivery zone | nothing | ❌ Missing |
| Get item with modifiers for cart | nothing | ❌ Missing (no modifiers exist) |

**Verdict:** Ordering context **cannot be implemented correctly** with the current catalog. At minimum, `assertItemAvailable()` and a clear snapshot contract must be added before Ordering work begins.

---

## 7. Real-world Edge Cases

### Case 1: Restaurant closes during checkout

**Scenario:** User adds items to cart, proceeds to payment, but between cart creation and order confirmation the restaurant owner sets `isOpen = false`.

**Current behavior:** No guard. The order would go through with an effectively closed restaurant.

**Fix:** `assertOpenAndApproved()` must be called at **order confirmation time** by the Ordering context, not just at cart creation. This is a cross-context workflow — the contract must be explicit.

---

### Case 2: Item becomes sold-out after added to cart

**Scenario:** Item `X` is `available` when user adds it to cart. Before checkout, the restaurant marks it `out_of_stock`.

**Current behavior:** No check. The order would be placed for an out-of-stock item.

**Fix:** `assertItemAvailable(itemId)` must be called during order placement. The cart snapshot must store the price at add-to-cart time, not at checkout time.

---

### Case 3: Price changes while user is ordering

**Scenario:** Restaurant owner updates price from 50k to 70k while user has the item in cart.

**Current behavior:** If Ordering reads `MenuItem.price` at order confirmation, the user pays the new price without being warned.

**Fix:** Store price in `CartItem` at add-to-cart time. At checkout, compare `CartItem.price` vs `MenuItem.price`. If different, either reject or warn the user:

```
⚠️ Price for "Margherita Pizza" changed from 50,000₫ to 70,000₫. Proceed?
```

This logic belongs in the **Ordering context's CartModule**, not here. But it requires this context to expose the current price via `getItemSnapshot()`.

---

### Case 4: Restaurant deleted while items are in active carts

**Scenario:** Admin deletes a restaurant. DB cascade deletes all menu items. But some users have those items in their Redis carts.

**Current behavior:** The cart still references deleted item IDs. Next checkout attempt will fail with `NotFoundException`.

**Fix:** Emit a `RestaurantDeleted` domain event. CartModule subscribes and clears affected carts with a user notification.

---

### Case 5: Admin suspends a restaurant mid-operation

**Scenario:** Admin needs to suspend a restaurant for a violation while it has active orders being prepared.

**Current behavior:** `isApproved` is not toggleable (no endpoint). Even if it were, there is no mechanism to notify active orders.

**Fix requires:**
1. Admin `PATCH /restaurants/:id/suspend` endpoint
2. `RestaurantSuspended` domain event
3. OrderModule cancels affected in-flight orders and notifies users

---

## 8. Scalability & Future-proofing

### What will break when splitting to microservices:

| Issue | Why | Fix Now |
|---|---|---|
| `menu.schema.ts` imports `restaurant.schema.ts` directly | DB FK cannot span service boundaries | Remove FK, use soft reference |
| `MenuService` injects `RestaurantService` directly | Becomes a network call with failure risk | Introduce `RestaurantLookupPort` interface |
| DB cascade delete for `restaurant → menu_items` | Cannot do cross-DB cascade | Replace with `RestaurantDeleted` domain event |
| No domain events anywhere | Every integration becomes a synchronous call | Add `EventEmitter2` for internal events now |
| `findAll()` with no pagination | Full table scan at scale | Add cursor/offset pagination now |

### Design now to avoid refactoring later:

1. **Add `ports/` directory** — define interfaces for cross-module dependencies today, even in the monolith.

2. **Add `EventEmitter2`** — emit `restaurant.approved`, `restaurant.closed`, `restaurant.deleted` events now. Let other modules subscribe. When moving to microservices, swap `EventEmitter2` for a real message broker (Kafka, RabbitMQ) with minimal changes.

3. **Design explicit public API contracts** — `getItemSnapshot()`, `assertOpenAndApproved()`, `assertItemAvailable()` should all be in a documented `public-api.ts` file that Ordering depends on.

4. **Do not put search in `RestaurantRepository` long-term** — keep search queries isolated in a `RestaurantSearchRepository` so it can be replaced with Elasticsearch without touching the main repository.

---

## 9. Final Verdict

| Module / Area | Verdict | Summary |
|---|---|---|
| Restaurant CRUD | ✅ Complete | Basic operations are there |
| Restaurant approval flow | ❌ Not production-ready | No approve endpoint — feature is broken |
| Operating hours | ❌ Not production-ready | Manual `isOpen` toggle is not a real schedule |
| Restaurant images | ❌ Not production-ready | No logo/cover — UI cannot render catalog cards |
| Delivery zone | ❌ Not production-ready | No area enforcement — any customer can order from anywhere |
| Restaurant cuisine type | ❌ Not production-ready | No filter/discovery capability |
| Menu item CRUD | ✅ Complete | Solid implementation |
| Menu item sold-out toggle | ✅ Complete | Works correctly |
| Menu item modifiers | ❌ Not production-ready | No size/topping support — cannot model real menus |
| Menu categories | ⚠️ Acceptable for MVP | Flat enum works short-term |
| Price snapshot contract | ⚠️ Missing contract | Works by accident, not by design |
| Ordering integration | ❌ Not production-ready | `assertItemAvailable()` missing, `assertOpenAndApproved()` never called |
| Search & discovery | ❌ Not production-ready | `SearchModule` entirely absent |
| Pagination | ❌ Not production-ready | Full table scan on every list call |
| Domain events | ❌ Not production-ready | No events — all integrations will be synchronous |

### Overall: ⚠️ Missing important features — not ready to start Ordering context yet

---

## Priority Action List

### Before implementing Ordering context (blockers):

1. **Add `PATCH /restaurants/:id/approve`** — without this, `assertOpenAndApproved()` never passes
2. **Add `assertItemAvailable()` to `MenuService`** — Ordering needs this before placing items in an order
3. **Add `getItemSnapshot()` to `MenuService`** — explicit price snapshot contract for OrderItem
4. **Fix return types** — `create()`/`update()` should return `Restaurant`, not `NewRestaurant`

### Short-term (before first users):

5. **Add pagination** to `findAll()` and `findByRestaurant()`
6. **Add restaurant search endpoint** — at minimum filter by `isOpen`, `isApproved`, name substring
7. **Add `cuisineTypes` to restaurant schema** — basic discovery filter
8. **Add `logoUrl` / `coverImageUrl` to restaurant schema** — UI requirement
9. **Add `deliveryRadiusKm` to restaurant schema** — delivery zone enforcement

### Medium-term (before scaling):

10. **Add `operating_hours` table** — replace manual `isOpen` toggle
11. **Add `modifier_groups` / `modifier_options` tables** — real menu support
12. **Add `RestaurantLookupPort` interface** — decouple MenuService from RestaurantService
13. **Add `EventEmitter2` domain events** — `restaurant.approved`, `restaurant.deleted`, `restaurant.closed`
14. **Remove `isAvailable` boolean** — redundant with `status` enum
