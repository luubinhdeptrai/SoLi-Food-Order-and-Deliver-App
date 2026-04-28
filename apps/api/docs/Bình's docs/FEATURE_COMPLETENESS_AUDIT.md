# Feature Completeness Audit: `restaurant-catalog`

> Reviewed by: Senior Backend Architect (AI)
> Date: 2026-04-28 *(updated — re-audited against current codebase)*
> Scope: `apps/api/src/module/restaurant-catalog/**`
> Based on: actual source code (schema, service, controller, dto)

---

## Current State Snapshot

What actually exists in code right now:

**`restaurant` module:**
- `GET /restaurants` — list all (paginated: `?offset=&limit=`)
- `GET /restaurants/:id` — get one
- `POST /restaurants` — create (admin/restaurant role)
- `PATCH /restaurants/:id` — update name/address/phone/description/lat/lng/isOpen (admin/restaurant role)
- `PATCH /restaurants/:id/approve` — set `isApproved = true` (admin only) ✅ NEW
- `PATCH /restaurants/:id/unapprove` — set `isApproved = false` (admin only) ✅ NEW
- `DELETE /restaurants/:id` — delete (admin only)

**`delivery-zones` sub-module** ✅ NEW — `restaurants/:restaurantId/delivery-zones`:
- Full CRUD: `GET`, `GET /:id`, `POST`, `PATCH /:id`, `DELETE /:id`
- Schema: `id, restaurantId, name, radiusKm, deliveryFee, estimatedMinutes, isActive`

**`menu` module:**
- `GET /menu-items?restaurantId=` — list by restaurant (with optional category filter)
- `GET /menu-items/:id` — get one
- `GET /menu-items/categories` — list category enum
- `POST /menu-items` — create item
- `PATCH /menu-items/:id` — update item
- `PATCH /menu-items/:id/sold-out` — toggle sold-out
- `DELETE /menu-items/:id` — delete item

**`modifiers` sub-module** ✅ NEW — `/menu-items/:menuItemId/modifiers`:
- Full CRUD: `GET`, `GET /:id`, `POST`, `PATCH /:id`, `DELETE /:id`
- Schema: `id, menuItemId, name, description, price, isRequired` (single price per modifier)

**`search` module** ✅ NEW — `/restaurants/search`:
- `GET /restaurants/search?name=&lat=&lon=&radiusKm=&offset=&limit=`
- Filters: name (ILIKE), geo (Euclidean approximation), offset/limit pagination
- Always filters `isApproved = true`

**Schema fields:**
- Restaurant: `id, ownerId, name, description, address, phone, isOpen, isApproved, latitude, longitude, createdAt, updatedAt`
- DeliveryZone: `id, restaurantId, name, radiusKm, deliveryFee, estimatedMinutes, isActive, createdAt, updatedAt`
- MenuItem: `id, restaurantId, name, description, price, sku, category, status, imageUrl, isAvailable, tags, createdAt, updatedAt`
- MenuItemModifier: `id, menuItemId, name, description, price, isRequired, createdAt, updatedAt`

**Events published:**
- `MenuItemUpdatedEvent` — on create/update/toggleSoldOut/delete (status only, no isAvailable)
- `RestaurantUpdatedEvent` — on create/update/delete (⚠️ NOT on approve/unapprove)

---

## 1. Feature Coverage

### Complete feature map for a production restaurant-catalog:

| Feature Area | Required | Current Status |
|---|---|---|
| Restaurant CRUD | ✅ | ✅ Implemented |
| Restaurant approval flow | ✅ | ✅ `PATCH /approve` + `PATCH /unapprove` (admin only) — ⚠️ `setApproved()` does NOT fire `RestaurantUpdatedEvent` |
| Restaurant open/close toggle | ✅ | ⚠️ Via `PATCH /restaurants/:id { isOpen }` — no dedicated toggle endpoint |
| Operating hours schedule | ✅ | ❌ Missing entirely |
| Temporary closure / maintenance | ✅ | ❌ Missing entirely |
| Delivery zone / service radius | ✅ | ✅ `delivery_zones` table + full Zones CRUD sub-module — ⚠️ NOT connected to `RestaurantUpdatedEvent` or Ordering snapshot |
| Restaurant category / cuisine type | ✅ | ❌ Missing entirely |
| Restaurant cover image / logo | ✅ | ❌ Missing entirely |
| Menu item CRUD | ✅ | ✅ Implemented |
| Menu item sold-out toggle | ✅ | ✅ Implemented |
| Menu item categories | ✅ | ⚠️ Flat global enum, no dedicated table |
| Menu item modifiers (size, toppings) | ✅ | ⚠️ `menu_item_modifiers` table + full CRUD — simplified (single price, no groups/options model, no isDefault) |
| Menu item image upload | ⚠️ | ⚠️ `imageUrl` field only, no upload endpoint |
| Menu item price snapshot for orders | ✅ | ✅ Handled by Ordering BC ACL projectors via `MenuItemUpdatedEvent` |
| Menu section / grouping | ⚠️ | ❌ No concept of menu sections |
| Search by name | ✅ | ✅ `SearchModule` with `GET /restaurants/search?name=` (ILIKE) |
| Geo-based search | ✅ | ⚠️ Euclidean approximation, not Haversine — `radius/111` degree conversion |
| Filter by cuisine / category | ✅ | ❌ `category` param accepted but silently ignored (always `undefined` passed) |
| Ordering integration contract | ✅ | ✅ Fully wired: `MenuItemUpdatedEvent` + `RestaurantUpdatedEvent` + snapshot projectors |
| Item availability check for Ordering | ✅ | ✅ `MenuService.assertItemAvailable()` implemented |
| Pagination on `/restaurants` list | ✅ | ✅ `offset` + `limit` query params supported |
| Pagination on `/menu-items` list | ✅ | ❌ `findByRestaurant()` returns all items — no offset/limit |
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

### ✅ DONE: Approval Endpoints

`PATCH /restaurants/:id/approve` and `PATCH /restaurants/:id/unapprove` are implemented (admin only).

**⚠️ Remaining issue:** `RestaurantService.setApproved()` — the underlying method — does **not fire `RestaurantUpdatedEvent`**. The Ordering BC snapshot will not reflect approval changes until this is fixed.

**Fix needed (`restaurant.service.ts`):**
```typescript
async setApproved(id: string, isApproved: boolean): Promise<Restaurant> {
  const restaurant = await this.findOne(id);
  const updated = await this.repo.update(id, { isApproved });
  this.eventBus.publish(new RestaurantUpdatedEvent(
    updated.id!, updated.name, updated.isOpen ?? false, isApproved,
    updated.address, undefined, updated.latitude ?? null, updated.longitude ?? null,
  ));
  return updated;
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

### ✅ DONE (partial): Delivery Zones

The `delivery_zones` table and full CRUD sub-module (`ZonesModule`) are implemented. Each restaurant can have multiple named zones with `radiusKm`, `deliveryFee`, and `estimatedMinutes`.

**⚠️ Remaining integration gap:**
- `RestaurantUpdatedEvent` does not carry zone data — the Ordering BC cannot read per-zone delivery fees or ETA at checkout
- `restaurants` table still lacks a `delivery_radius_km` column — BR-3 (simple radius enforcement at checkout) requires this simpler field to be added separately
- The two radius approaches (delivery_zones vs delivery_radius_km) are not connected

**Fix needed for BR-3:** Add `delivery_radius_km` column to `restaurants` table and publish it in `RestaurantUpdatedEvent`:
```typescript
// restaurant.schema.ts
deliveryRadiusKm: real('delivery_radius_km'),  // nullable
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

### ✅ DONE (simplified): Item Modifiers

`menu_item_modifiers` table and full `ModifiersModule` CRUD are implemented.

Current modifier schema:
```typescript
{ id, menuItemId, name, description, price, isRequired }
```

**⚠️ Remaining limitations:**
- Single flat modifier (e.g. "Large") — no modifier groups ("Size: Small/Medium/Large")
- No `maxSelect` / `minSelect` — cannot model "choose exactly one size"
- No `isDefault` flag
- `price` is the additional price for this modifier (not a price adjustment relative to a group)
- Modifier prices are NOT included in `MenuItemUpdatedEvent` — Ordering BC snapshots do not know about modifier prices

**⚠️ Security bug in `ModifiersService.getRestaurantForItem()`:**
```typescript
// WRONG — returns restaurantId as ownerId:
private async getRestaurantForItem(restaurantId: string) {
  return { ownerId: restaurantId }; // any restaurant-role user can mutate any modifier
}
```
Fix: call `RestaurantService.findOne(restaurantId)` to get the real `ownerId`.

---

### ✅ DONE: Price Snapshot for Ordering

The snapshot mechanism is fully implemented in the Ordering BC's ACL layer via event-driven projectors:
- `MenuItemUpdatedEvent` published on every mutation carries `name`, `price`, `status`
- `MenuItemProjector` in `ordering/acl/projections/` upserts `ordering_menu_item_snapshots`
- `PlaceOrderHandler` reads from the local snapshot table — never calls `MenuService`

**⚠️ Remaining type mismatch:** `menu_items.price` is `doublePrecision` (float) but `ordering_menu_item_snapshots.price` is `numeric(12,2)`. Float-to-numeric conversion happens at the ACL boundary. Recommend changing `menu_items.price` to `numeric(12,2)` to eliminate precision discrepancy.

---

### ✅ DONE: `assertItemAvailable()` for Ordering

`MenuService.assertItemAvailable()` is implemented (`menu.service.ts`).

**⚠️ Minor inconsistency:** The implementation checks the `isAvailable` boolean AND the `status` enum:
```typescript
if (!item.isAvailable) throw ConflictException('Item is not available for ordering');
if (item.status === 'out_of_stock') throw ConflictException(...);
if (item.status === 'unavailable') throw ConflictException(...);
```
The contract (`restaurant-catalog.md`) says `status` should be the **single source of truth** and `isAvailable` should be deprecated. `toggleSoldOut()` only updates `status`, not `isAvailable` — these two can get out of sync.

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

### ❌ Still Missing: Pagination on Menu Items

`MenuRepository.findByRestaurant()` still returns ALL menu items with no limit. `RestaurantRepository.findAll()` now supports `offset`/`limit` — the same pattern needs to be applied to the menu.

**Fix:**
```typescript
async findByRestaurant(
  restaurantId: string,
  category?: MenuItemCategory,
  offset?: number,
  limit?: number,
): Promise<MenuItem[]>
```

---

## 4. Search & Discovery

### ✅ DONE (partial): SearchModule implemented

`SearchModule` is now present with `GET /restaurants/search`.

**What works:**
- Name filter: `ILIKE %name%` substring match
- Geo filter: lat/lon/radiusKm with offset/limit pagination
- Always filters `isApproved = true`

**⚠️ Remaining issues:**

1. **Euclidean distance, not Haversine** — `SearchRepository` uses:
   ```typescript
   SQRT(POWER(lat1-lat2, 2) + POWER(lon1-lon2, 2)) <= radius / 111
   ```
   The `/ 111` km-to-degree conversion is a flat-earth approximation. For Vietnam (~10° N) the error is small (~0.4%) but this is not standard. Haversine via SQL is:
   ```sql
   6371 * acos(
     cos(radians($lat)) * cos(radians(latitude)) *
     cos(radians(longitude) - radians($lon)) +
     sin(radians($lat)) * sin(radians(latitude))
   ) <= $radiusKm
   ```

2. **Cuisine/category filter silently ignored** — `SearchController` always passes `undefined` for the category parameter:
   ```typescript
   return this.service.searchRestaurants(name, undefined, lat, lon, ...);
   //                                         ^^^^^^^^^ always undefined
   ```
   The `SearchService` and `SearchRepository` accept the parameter but it never arrives.

3. **No `isOpenNow` filter** — results include closed restaurants.

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
| Check if restaurant is open & approved | `ordering_restaurant_snapshots` (via `RestaurantUpdatedEvent`) | ✅ Fully wired — checked in `PlaceOrderHandler` step 5 |
| Check if menu item is available | `ordering_menu_item_snapshots.status` (via `MenuItemUpdatedEvent`) | ✅ Fully wired — checked in `PlaceOrderHandler` step 5 |
| Get item price at order creation time | `ordering_menu_item_snapshots.price` | ✅ Snapshot projector keeps it in sync |
| Check if item is within delivery radius | `ordering_restaurant_snapshots.delivery_radius_km` | ❌ Always null — `restaurants` table lacks `delivery_radius_km` column |
| Get item with modifiers for cart | `menu_item_modifiers` (but no event published) | ⚠️ Modifier CRUD exists but not included in `MenuItemUpdatedEvent`; Ordering cannot snapshot modifier prices |
| Approve/unapprove snapshot sync | `RestaurantUpdatedEvent` from `setApproved()` | ❌ Missing — `setApproved()` does not fire the event |

**Verdict:** Core Ordering flow (Phase 4) is operational. Two remaining blockers for full correctness: (1) `setApproved` not firing event, (2) `delivery_radius_km` missing from restaurant schema.

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
