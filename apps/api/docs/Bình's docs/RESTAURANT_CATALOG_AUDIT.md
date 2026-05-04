# RESTAURANT_CATALOG_AUDIT.md

> Deep audit of the `restaurant-catalog` bounded context.
> Date: 2026-05-02 | Reviewer: senior backend architect
> Architecture: Modular Monolith — NestJS + PostgreSQL + Drizzle ORM

---

## 📋 STATUS — ALL ISSUES FIXED & VERIFIED ✅

**Overall verdict:** Production-ready (with noted caveats for future optimization).

- ✅ **All 19 original issues:** Implemented and verified correct
- ✅ **4 additional issues (V-1 to V-4):** Found during verification and fixed immediately
- ✅ **Zero TypeScript/lint errors** across all affected files
- ✅ **Verification report:** [`RESTAURANT_CATALOG_POST_FIX_REVIEW.md`](./RESTAURANT_CATALOG_POST_FIX_REVIEW.md)

**Key fixes applied:**

1. **Search:** `ParseIntPipe` → `ParseFloatPipe` on coordinates (Issue #1)
2. **Approval event:** `setApproved()` now emits `RestaurantUpdatedEvent` (Issue #2)
3. **Category filter:** Implemented as `EXISTS` subquery (Issue #3)
4. **Listing filter:** `approvedOnly=true` enforced (Issue #4)
5. **Pagination:** Default limit 20, max 100 across all services (Issue #5)
6. **Search filter:** `isOpen=true` added to conditions (Issue #6)
7. **Deprecated field:** `deliveryRadiusKm` removed from all 5 layers (Issue #9)
8. **Enrichment fields:** `cuisineType`, `logoUrl`, `coverImageUrl` added (Issue #10)

**Type-safety fixes:**

- `RestaurantRepository.update()` return type corrected to `Promise<Restaurant | undefined>` (V-1)
- Misleading comment in `setApproved()` corrected (V-2)
- Unnecessary `restaurant.id!` assertion removed (V-3)
- Unnecessary cast in `zoneFeeColumn.fromDriver()` removed (V-4)

---

## 1. Overview

The `restaurant-catalog` BC is structurally sound at the module boundary level. Core DDD disciplines (no cross-BC imports at runtime, event-driven integration with the ordering BC) are correctly implemented.

**This audit identified 19 functional issues in initial implementation, all of which have now been corrected:**

**Critical bugs (now fixed):**

- ✅ `ParseIntPipe` on float coordinates → corrected to `ParseFloatPipe`
- ✅ `setApproved()` missing event emission → now emits `RestaurantUpdatedEvent`
- ✅ `category` filter dead code → implemented as `EXISTS` subquery
- ✅ Public listing returning unapproved restaurants → filter enforced
- ✅ Menu item listing lacking pagination → `offset`/`limit` added

**Additional improvements:**

- ✅ Type-safety enhancements (4 issues found during verification)
- ✅ Indexes added for performance (`is_approved`, `is_open`, GIN on tags)
- ✅ Unique constraints added to prevent category duplication
- ✅ Product enrichment fields added (`cuisineType`, `logoUrl`, `coverImageUrl`)
- ✅ Distance-based sorting implemented for geo search
- ✅ Pagination and total counts added to all endpoints

The BC is now **production-ready**. See "Remaining Risks" section in the verification report for design-level optimizations planned for future sprints.

---

## 2. Issues List — All Resolved ✅

> **Note:** All 19 issues listed below have been implemented and verified correct as of 2026-05-03.
> See [verification report](./RESTAURANT_CATALOG_POST_FIX_REVIEW.md) for detailed verification results.

---

### 🔴 Issue #1 — `ParseIntPipe` Truncates Float Coordinates

**Problem:**
`SearchController.search()` uses `ParseIntPipe` on `lat`, `lon`, and `radiusKm`.
`ParseIntPipe` converts `"10.762622"` → `10`, discarding all decimal places.
Vietnam sits at ~10–21°N and 102–109°E — every geo query returns wildly incorrect results
or matches the wrong set of restaurants entirely.

**Impact:**
Geo search is **completely broken for any customer using floating-point coordinates**, which
is every real-world request. A customer at `lat=10.762622,lon=106.660172` is effectively
searching from `lat=10,lon=106`.

**Evidence:**

```ts
// search.controller.ts
@Query('lat', new ParseIntPipe({ optional: true })) lat?: number,
@Query('lon', new ParseIntPipe({ optional: true })) lon?: number,
@Query('radiusKm', new ParseIntPipe({ optional: true })) radiusKm?: number,
```

**Solution:**
Replace `ParseIntPipe` with `ParseFloatPipe` for all three parameters:

```ts
@Query('lat', new ParseFloatPipe({ optional: true })) lat?: number,
@Query('lon', new ParseFloatPipe({ optional: true })) lon?: number,
@Query('radiusKm', new ParseFloatPipe({ optional: true })) radiusKm?: number,
```

`ParseFloatPipe` is built into `@nestjs/common` — zero new dependencies.

---

### 🔴 Issue #2 — `setApproved()` Does Not Emit `RestaurantUpdatedEvent`

**Problem:**
`RestaurantService.setApproved()` writes `isApproved` to the database but **publishes no
domain event**. The ordering BC's `ordering_restaurant_snapshots` table is populated by
`RestaurantSnapshotProjector` which only fires on `RestaurantUpdatedEvent`. After an admin
approves or unapproves a restaurant, the snapshot retains the old `isApproved` value forever
until the next unrelated restaurant update.

**Impact:**

- A freshly approved restaurant cannot receive orders because the ordering BC still sees
  `isApproved=false` in its snapshot → `PlaceOrderHandler` throws 422.
- A unapproved restaurant continues to accept orders if it was previously approved and is
  then unapproved — the snapshot is never invalidated.
- This is a **silent data integrity failure** — no error is thrown, the system simply
  behaves incorrectly.

**Evidence:**

```ts
// restaurant.service.ts
async setApproved(id: string, isApproved: boolean): Promise<Restaurant> {
  await this.findOne(id);
  return this.repo.update(id, { isApproved }); // ← no eventBus.publish()
}
```

Compare with `create()` and `update()` which both call `this.eventBus.publish(new RestaurantUpdatedEvent(...))`.

**Solution:**
Emit `RestaurantUpdatedEvent` after the DB write:

```ts
async setApproved(id: string, isApproved: boolean): Promise<Restaurant> {
  const updated = await this.repo.update(id, { isApproved });
  this.eventBus.publish(
    new RestaurantUpdatedEvent(
      updated.id,
      updated.name,
      updated.isOpen ?? false,
      updated.isApproved ?? false,
      updated.address,
      undefined,
      updated.latitude ?? null,
      updated.longitude ?? null,
    ),
  );
  return updated;
}
```

`findOne` first — which is already implicit since `repo.update` follows `findOne`. Use the
returned `updated` record so the event always reflects the persisted state.

---

### 🔴 Issue #3 — `category` Filter Accepted But Never Applied

**Problem:**
`SearchService.searchRestaurants()` and `SearchRepository.search()` both accept a
`category` parameter. The controller signature includes it (`undefined`). But inside
`SearchRepository.search()` there is **zero code that uses `filters.category`** — no JOIN,
no WHERE condition, nothing. The filter is silently discarded.

Additionally, the controller hardcodes `undefined` as the category argument:

```ts
return this.service.searchRestaurants(
  name,
  undefined, // ← category is never read from query params
  lat,
  lon,
  radiusKm,
  offset,
  limit,
);
```

There is also no `@ApiQuery({ name: 'category' })` decorator — so customers have no way
to pass it at all. This is dead code at every layer.

**Impact:**

- Category-based restaurant discovery is completely absent from the customer experience.
- The Swagger API doc makes no mention of category filtering, misleading API consumers.
- The dead parameter silently pollutes all three layers (controller → service → repository).

**Evidence:**

```ts
// search.repository.ts — SearchFilters has category but it's never used
export interface SearchFilters {
  name?: string;
  category?: string;   // ← declared but unused in query
  ...
}

// search.controller.ts — controller never reads the query param
return this.service.searchRestaurants(
  name,
  undefined,  // ← hardcoded
  ...
);
```

**Solution (Implement category search properly):** (OK I agree)
`menu_categories` is per-restaurant, not a global enum. "Category" in a restaurant search
context means: _show restaurants that have at least one menu item in a category matching
the query_. This requires a JOIN:

```sql
SELECT DISTINCT r.*
FROM restaurants r
JOIN menu_items mi ON mi.restaurant_id = r.id
JOIN menu_categories mc ON mc.id = mi.category_id
WHERE mc.name ILIKE '%Burgers%'
  AND r.is_approved = true
```

---

### 🔴 Issue #4 — Public `GET /restaurants` Returns Unapproved Restaurants

**Problem:**
`RestaurantRepository.findAll()` has no `isApproved = true` filter. The public list
endpoint returns all restaurants including pending, rejected, and unapproved ones.

**Impact:**

- Customers see restaurants they cannot order from (checkout will fail with 422).
- Unapproved restaurants get free exposure — business logic violation.

**Evidence:**

```ts
// restaurant.repository.ts
async findAll(offset?: number, limit?: number): Promise<Restaurant[]> {
  const query = this.db.select().from(restaurants).orderBy(restaurants.createdAt);
  // ← no isApproved filter
  ...
}
```

**Solution:**
Add a filter for public listing. Keep an admin-facing unfiltered endpoint if needed:

```ts
// repository: add optional filter
async findAll(opts: { offset?: number; limit?: number; approvedOnly?: boolean }): Promise<Restaurant[]> {
  const conditions = opts.approvedOnly ? [eq(restaurants.isApproved, true)] : [];
  ...
}
```

The public `GET /restaurants` controller should pass `approvedOnly: true`. A future
admin-only `GET /admin/restaurants` can pass `approvedOnly: false`.

---

### 🔴 Issue #5 — No Default Limit on Search / Restaurant Listing

**Problem:**
Neither `SearchRepository.search()` nor `RestaurantRepository.findAll()` enforces a
default or maximum `limit`. A request with no `limit` query param returns the **entire
table** in one response.

**Impact:**

- DoS risk: a single unauthenticated request to `GET /restaurants/search` fetches every
  row in `restaurants`.
- Memory pressure: 10 000 restaurants × full row → hundreds of MB in a single HTTP response.

**Evidence:**

```ts
// search.repository.ts
const withLimit =
  filters.limit !== undefined ? withOffset.limit(filters.limit) : withOffset; // ← no cap
```

**Solution:**
Apply a default and a ceiling in the service layer:

```ts
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const safeLimit = Math.min(limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
```

---

### 🔴 Issue #6 — `isOpen` Not Filtered in Search Results

**Problem:**
The search endpoint returns closed restaurants. A customer who gets search results and
tries to place an order from a closed restaurant gets a 422 error from the ordering BC —
a confusing UX failure that should have been prevented at the catalog layer.

**Evidence:**

```ts
// search.repository.ts — only isApproved is filtered
const conditions = [sql`${restaurants.isApproved} = true`];
// ← no isOpen filter
```

**Solution:**
Add `isOpen = true` to the default search conditions, or expose an optional `isOpen` filter
param (so future admin tooling can search closed restaurants too). For the customer-facing
search endpoint the default should be `isOpen = true`.

---

### 🟡 Issue #7 — Menu Item Listing Has No Pagination

**Problem:**
`GET /menu-items?restaurantId=<uuid>` returns all menu items for a restaurant with no
offset/limit support. A large restaurant with 200+ items returns every row.

**Impact:**

- Mobile clients load hundreds of items on initial render.
- Query performance degrades linearly with item count.

**Evidence:**

```ts
// menu.repository.ts
return await this.db
  .select()
  .from(menuItems)
  .where(and(...conditions))
  .orderBy(menuItems.createdAt); // ← no offset/limit
```

**Solution:**
Add optional `offset`/`limit` to `findByRestaurant()` and `QueryMenuItemDto`. Mirror
the pattern in `RestaurantRepository.findAll()`.

---

### 🟡 Issue #8 — Menu Item Listing Returns All Statuses by Default

**Problem:**
`GET /menu-items?restaurantId=<uuid>` (public, `@AllowAnonymous`) returns items with
status `unavailable`, `out_of_stock`, and `available` — no filter applied. Customers
see items they cannot add to cart.

**Impact:**

- UX degradation: "Unavailable" items visible on the public menu.
- Front-end must implement client-side filtering, duplicating backend logic.

**Evidence:**

```ts
// menu.repository.ts — no status filter in findByRestaurant
const conditions = [eq(menuItems.restaurantId, restaurantId)];
if (categoryId) {
  conditions.push(eq(menuItems.categoryId, categoryId));
}
// ← no status filter
```

**Solution — (Query param):**
Expose `?status=available|unavailable|out_of_stock|all` on the public endpoint. Default
to `available` when absent.

---

### 🟡 Issue #9 — `deliveryRadiusKm` Not Fully Removed

**Problem:**
`deliveryRadiusKm` was deprecated in favour of `delivery_zones` (Phase 4), but three
artefacts still reference it:

1. `ordering_restaurant_snapshots` table still has the column (marked `@deprecated` in
   code comment — but never removed from schema).
2. `RestaurantUpdatedEvent` still declares `deliveryRadiusKm?: number | null` as the 6th
   constructor parameter.
3. `RestaurantSnapshotProjector` still reads `deliveryRadiusKm` from the event and writes
   it to the DB.

All three call sites in `RestaurantService` already pass `undefined` for this parameter.

**Impact:**

- Schema carries a dead column consuming storage.
- Event contract carries a misleading nullable field.
- Code reviewers/new engineers must understand the `@deprecated` annotation to know it's
  inert.
- Migration risk: future code may accidentally use `deliveryRadiusKm` from the snapshot
  instead of querying `ordering_delivery_zone_snapshots`.

**Evidence:**

```ts
// restaurant-updated.event.ts — parameter still present
public readonly deliveryRadiusKm?: number | null,

// ordering_restaurant_snapshots — column still exists
/** @deprecated ... */
deliveryRadiusKm: real('delivery_radius_km'),

// restaurant.service.ts — always passed as undefined
new RestaurantUpdatedEvent(id, name, isOpen, isApproved, address, undefined, lat, lon)
```

**Solution:**

1. Remove `deliveryRadiusKm` from `RestaurantUpdatedEvent` constructor.
2. Remove `deliveryRadiusKm` column from `ordering_restaurant_snapshots` schema + migration.
3. Remove `deliveryRadiusKm` from `RestaurantSnapshotProjector.handle()` and `RestaurantSnapshotRepository.upsert()`.
4. Update all `RestaurantUpdatedEvent` call sites (5 in `RestaurantService`) to remove the argument.

---

### 🟡 Issue #10 — No `cuisineType`, `logoUrl`, `coverImageUrl` on Restaurant

**Problem:**
The `restaurants` table has no cuisine type, logo, or cover image fields. These are
standard restaurant-catalog attributes used in every food delivery app.

**Impact:**

- Mobile/web UI cannot show restaurant branding.
- Search cannot filter by cuisine (Vietnamese, Italian, etc.) — critical for UX.
- Without `cuisineType`, category-based discovery requires menu item joins (heavier queries).

**Evidence:**

```ts
// restaurant.schema.ts — fields absent
export const restaurants = pgTable('restaurants', {
  id,
  ownerId,
  name,
  description,
  address,
  phone,
  isOpen,
  isApproved,
  latitude,
  longitude,
  createdAt,
  updatedAt,
  // ← no cuisineType, logoUrl, coverImageUrl
});
```

**Solution:**
Add to the schema and migration:

```ts
cuisineType: text('cuisine_type'),          // e.g. 'Vietnamese', 'Italian'
logoUrl:     text('logo_url'),
coverImageUrl: text('cover_image_url'),
```

Also update `CreateRestaurantDto`, `UpdateRestaurantDto`, `RestaurantResponseDto`, and
`RestaurantUpdatedEvent` to carry `cuisineType` so the ordering BC snapshot and search can
use it.

---

### 🟡 Issue #11 — Search Results Not Sorted by Distance

**Problem:**
`SearchRepository.search()` always `ORDER BY restaurants.created_at` — even when the
client provides coordinates. A geo search should sort results by distance from the user,
not by creation date.

**Impact:**
The nearest restaurant to the user may appear last in the result set. This is the core
UX expectation of proximity-based search.

**Evidence:**

```ts
// search.repository.ts
const baseQuery = this.db
  .select()
  .from(restaurants)
  .where(and(...conditions))
  .orderBy(restaurants.createdAt); // ← always createdAt, never distance
```

**Solution:**
When `lat` and `lon` are provided, add the Haversine distance expression as an ORDER BY:

```ts
if (filters.lat !== undefined && filters.lon !== undefined) {
  const distanceExpr = sql`(2 * 6371 * ASIN(SQRT(
    POWER(SIN(RADIANS(${restaurants.latitude} - ${filters.lat}) / 2), 2) +
    COS(RADIANS(${filters.lat})) * COS(RADIANS(${restaurants.latitude})) *
    POWER(SIN(RADIANS(${restaurants.longitude} - ${filters.lon}) / 2), 2)
  )))`;
  return baseQuery.orderBy(distanceExpr);
}
```

---

### 🟡 Issue #12 — No Total Count in Paginated Responses

**Problem:**
`GET /restaurants`, `GET /menu-items`, and `GET /restaurants/search` return plain arrays.
There is no `total`, `page`, or `hasMore` in the response. Clients cannot render pagination
controls or know when they have fetched all data.

**Impact:**

- Mobile infinite-scroll relies on knowing when to stop fetching.
- Admin dashboards cannot show "Page 3 of 12".

**Solution:**: (minimal):\*_ Return `{ data: [...], total: N }` — requires a `COUNT(_)` query alongside the data query. (I agree this solution)

---

### 🟡 Issue #13 — `menu_categories` Allows Duplicate Names Per Restaurant

**Problem:**
The `menu_categories` table has no `UNIQUE(restaurant_id, name)` constraint. A restaurant
can end up with two "Burgers" categories — one for display, one orphaned from a previous
data entry.

**Impact:**

- Data integrity violation; category de-duplication becomes the UI's problem.
- Items assigned to either "Burgers" category cannot be easily consolidated.

**Evidence:**

```ts
// menu.schema.ts
export const menuCategories = pgTable('menu_categories', {
  id: uuid(...).primaryKey(),
  restaurantId: ...,
  name: ...,
  // ← no unique constraint on (restaurant_id, name)
});
```

**Solution:**
Add a unique constraint:

```ts
import { uniqueIndex } from 'drizzle-orm/pg-core';

export const menuCategories = pgTable('menu_categories', { ... }, (table) => [
  uniqueIndex('menu_categories_restaurant_name_uidx').on(table.restaurantId, table.name),
]);
```

Handle the conflict in `createCategory` as a `ConflictException`.

---

### 🟡 Issue #14 — No Index on `restaurants.is_approved` + `restaurants.is_open`

**Problem:**
The Haversine search query filters on `isApproved = true`. Both the search endpoint and
the public listing filter on or could filter on `isOpen`. There are no partial indexes
for these columns on the `restaurants` table.

**Impact:**
Every search query does a sequential scan of the entire `restaurants` table before
applying the Haversine radius filter.

**Solution (Drizzle + PostgreSQL):**

```ts
// restaurant.schema.ts
import { index } from 'drizzle-orm/pg-core';

export const restaurants = pgTable('restaurants', { ... }, (table) => [
  index('restaurants_approved_open_idx')
    .on(table.isApproved, table.isOpen),
]);
```

A partial index `WHERE is_approved = true AND is_open = true` would be even faster for
the customer search path.

---

### 🟡 Issue #15 — `menuItems.tags` Has No GIN Index

**Problem:**
`menuItems.tags` is a `text[]` (PostgreSQL array). Searching or filtering on array
contents (e.g., `WHERE 'vegetarian' = ANY(tags)`) requires a sequential scan without a
GIN index.

**Impact:**
Tag-based search (a common food-delivery feature) cannot be efficient at scale.

**Solution:**

```ts
// menu.schema.ts
import { index } from 'drizzle-orm/pg-core';

export const menuItems = pgTable('menu_items', { ... }, (table) => [
  index('menu_items_tags_gin_idx').using('gin', table.tags),
]);
```

---

### 🟢 Issue #16 — `events/index.ts` Missing New `DeliveryZoneSnapshotUpdatedEvent`

**Problem:**
`src/shared/events/index.ts` does not export `delivery-zone-snapshot-updated.event.ts`
(added in the previous implementation task). Any consumer that imports from the barrel
file `@/shared/events` will not find the new event.

**Evidence:**

```ts
// shared/events/index.ts — missing entry
export * from './menu-item-updated.event';
export * from './restaurant-updated.event';
// ← delivery-zone-snapshot-updated.event is absent
```

**Solution:**
Add:

```ts
export * from './delivery-zone-snapshot-updated.event';
```

---

### 🟢 Issue #17 — Swagger `@ApiUnauthorizedResponse` on Public Search Endpoint

**Problem:**
`SearchController.search()` is decorated with `@AllowAnonymous` (no auth required) but
also with `@ApiUnauthorizedResponse`. The unauthorized response can never be returned for
this endpoint, misleading API consumers reading the Swagger docs.

**Evidence:**

```ts
// search.controller.ts
@AllowAnonymous()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' }) // ← never fires
```

**Solution:**
Remove `@ApiUnauthorizedResponse` from all `@AllowAnonymous` endpoints. The same issue
exists on `RestaurantController.findAll()` and `RestaurantController.findOne()`.

---

### 🟢 Issue #18 — No Validation That Both `lat` and `lon` Are Provided Together

**Problem:**
If a client passes `?lat=10.76` but omits `lon`, the geo condition is silently skipped
(the `if (filters.lat !== undefined && filters.lon !== undefined)` check prevents the
crash). However, no error is returned to the client — the search simply falls back to
name-only without warning.

**Impact:**
Subtle UX confusion: the client believes it sent a geo search but got name-only results.

**Solution:**
Add a guard in `SearchService`:

```ts
if ((lat !== undefined) !== (lon !== undefined)) {
  throw new BadRequestException(
    'lat and lon must both be provided for geo search',
  );
}
```

---

### 🟢 Issue #19 — `SearchRepository` Selects `*` Including Sensitive Fields

**Problem:**
`SearchRepository` selects every column from `restaurants`, including `ownerId`,
`isApproved`, internal timestamps, etc. This leaks internal fields to the customer-facing
search endpoint.

**Solution:**
Use a typed select projection:

```ts
this.db.select({
  id: restaurants.id,
  name: restaurants.name,
  description: restaurants.description,
  address: restaurants.address,
  isOpen: restaurants.isOpen,
  latitude: restaurants.latitude,
  longitude: restaurants.longitude,
}).from(restaurants)...
```

Alternatively, create a `RestaurantSummaryDto` response and map on the service layer.

---

## 3. Search Module Deep Dive

### 3.1 Current Capabilities

| Feature                               | Status                                     |
| ------------------------------------- | ------------------------------------------ |
| Search by restaurant name (substring) | ✅ Works                                   |
| Geo radius filter (Haversine)         | ⚠️ Formula correct; broken by ParseIntPipe |
| Filter by `isApproved`                | ✅ Applied                                 |
| Filter by `isOpen`                    | ❌ Missing                                 |
| Filter by category/cuisine            | ❌ Dead code (never applied)               |
| Sort by distance                      | ❌ Always `createdAt`                      |
| Pagination limit enforcement          | ❌ No default/max                          |
| Total count in response               | ❌ Missing                                 |
| Search by menu item name              | ❌ Not implemented                         |
| Search by tag                         | ❌ Not implemented                         |

### 3.2 Critical Bug: ParseIntPipe on Float Coordinates

This alone makes the geo search feature non-functional. See Issue #1.

### 3.3 Performance Risks

**Full-table scan on every search request:**
The Haversine SQL expression is computed for every row in `restaurants` before the
radius filter eliminates non-matching rows. With 10,000 restaurants:

- No index is used for the distance calculation (PostgreSQL cannot use a B-tree on a
  computed expression by default).
- The `isApproved = true` condition has no index (Issue #14), so the filter scan is
  sequential.

**Recommended fix:**

1. Add index on `(is_approved, is_open)` (Issue #14).
2. Add a bounding-box pre-filter before the Haversine expression to dramatically reduce
   the candidate set:

```sql
WHERE latitude  BETWEEN :lat - (:radiusKm / 111.0) AND :lat + (:radiusKm / 111.0)
  AND longitude BETWEEN :lon - (:radiusKm / (111.0 * COS(RADIANS(:lat))))
                    AND :lon + (:radiusKm / (111.0 * COS(RADIANS(:lat))))
```

This uses simple arithmetic the planner can index-scan on, then the Haversine exact check
runs only on the (much smaller) bounding-box candidates.

3. Long-term: consider PostGIS `ST_DWithin` with a geography index for O(log n) distance
   queries. This is the industry standard.

### 3.4 Missing Search Features (Priority Order)

1. **Sort by distance** (Issue #11) — most critical UX gap.
2. **Filter `isOpen=true`** (Issue #6) — prevents broken order flow from search.
3. **Default limit** (Issue #5) — prevents DoS.
4. **Cuisine type filter** — requires schema change (Issue #10).
5. **Menu item name search** — JOIN with `menu_items` on `name ILIKE '%query%'`.
6. **Tag search** — filter restaurants that have items with matching tags (GIN index, Issue #15).

### 3.5 Response Shape

The search returns raw `Restaurant` DB rows. A dedicated `RestaurantSearchResultDto` should
be returned that:

- Excludes `ownerId`, `isApproved` (internal fields).
- Includes a computed `distanceKm` field (when geo search is used).
- Includes `cuisineType`, `logoUrl`, `coverImageUrl` (once added, Issue #10).

---

## 4. Architecture & Design Issues

### 4.1 `SearchRepository` Directly Imports `restaurant.schema.ts`

The search repository imports the schema from the restaurant sub-module path:

```ts
import { restaurants } from '@/module/restaurant-catalog/restaurant/restaurant.schema';
```

This is acceptable within the same BC (intra-BC import). However, if `SearchModule` ever
needs to join across `menu_items` (for menu-item search), it will also need to import
`menu.schema.ts`. The existing pattern allows this — it is fine as long as it stays
within `restaurant-catalog`.

### 4.2 `setApproved()` is a Bypass of the Main Update Path

`setApproved()` calls `this.repo.update(id, { isApproved })` directly, bypassing the
event-publishing logic in `update()`. This is an architectural smell: whenever approval
status changes, the event must be emitted, but the code structure allows adding new
approval-path callers that forget to publish. Centralizing the event in `repo.update()` or
using a domain entity pattern would eliminate this class of bug.

### 4.3 No Separation Between Admin and Customer-Facing Restaurant Queries

`RestaurantRepository.findAll()` serves both the admin dashboard (needs unapproved
restaurants) and the customer list (needs only approved+open). A single method with an
`approvedOnly` flag is sufficient, but currently neither path filters correctly.

### 4.4 `ModifiersService` Has Excessive `eslint-disable` Comments in `MenuService`

`menu.service.ts` has 5 `@ts-ignore`-style `eslint-disable` pragmas at the top. These
mask underlying typing issues rather than fixing them. The root cause is the
`fromDriver` function in the `moneyColumn` custom type using `parseFloat(value)` without
explicit typing — a one-line fix.

---

## 5. Priority Recommendations

> **Status:** All critical and important items completed as of 2026-05-03.
> This section documents the original audit recommendations. See [Fix Summary](#-fix-summary-post-implementation--post-verification) for completed work.

### 🔴 Critical (must fix before production) — ✅ ALL COMPLETED

| #   | Issue                                         | File                                           |
| --- | --------------------------------------------- | ---------------------------------------------- |
| 1   | ParseIntPipe on float coordinates             | search.controller.ts                           |
| 2   | setApproved() missing event emit              | restaurant.service.ts                          |
| 3   | Category filter dead code                     | search.repository.ts, search.controller.ts     |
| 4   | Public listing returns unapproved restaurants | restaurant.repository.ts                       |
| 5   | No default page limit                         | search.repository.ts, restaurant.repository.ts |
| 6   | isOpen not filtered in search                 | search.repository.ts                           |

### 🟡 Important (fix within next sprint) — ✅ ALL COMPLETED

| #   | Issue                                               | File                                                   |
| --- | --------------------------------------------------- | ------------------------------------------------------ |
| 7   | Menu item listing — no pagination                   | menu.repository.ts                                     |
| 8   | Menu item listing — all statuses returned           | menu.repository.ts                                     |
| 9   | deliveryRadiusKm not cleaned up                     | restaurant-updated.event.ts, snapshot schema/projector |
| 10  | Missing cuisineType / logoUrl / coverImageUrl       | restaurant.schema.ts                                   |
| 11  | Search not sorted by distance                       | search.repository.ts                                   |
| 12  | No total count in paginated responses               | all repositories                                       |
| 13  | menu_categories missing unique(restaurant_id, name) | menu.schema.ts                                         |
| 14  | No index on is_approved / is_open                   | restaurant.schema.ts                                   |
| 15  | No GIN index on menu_items.tags                     | menu.schema.ts                                         |

### 🟢 Nice-to-have (backlog) — ✅ MOSTLY COMPLETED

| #   | Issue                                                  | Status       |
| --- | ------------------------------------------------------ | ------------ |
| 16  | events/index.ts missing new event export               | ✅ Completed |
| 17  | Incorrect @ApiUnauthorizedResponse on public endpoints | ✅ Completed |
| 18  | No validation: lat+lon must be provided together       | ✅ Completed |
| 19  | Search returns all DB columns incl. sensitive fields   | ✅ Completed |

---

## 6. Suggested Roadmap

**Status:** Sprints 1–3 completed as of 2026-05-03. All critical bug fixes, UX improvements, and schema hardening done. Sprint 4 items remain as backlog enhancements.

### Sprint 1 — Bug Fixes (breaks existing functionality) — ✅ COMPLETED

1. **Fix `ParseIntPipe` → `ParseFloatPipe`** (Issue #1) — one-line change, immediate impact.
2. **Add `RestaurantUpdatedEvent` to `setApproved()`** (Issue #2) — 8 lines, critical for ordering BC.
3. **Remove dead `category` parameter** from service + repository (Issue #3, Option A first).
4. **Add `isApproved=true` filter to `findAll()`** (Issue #4) — 1 WHERE clause.
5. **Add default limit (20) and ceiling (100)** to search + listing (Issue #5).
6. **Add `isOpen=true` to search conditions** (Issue #6).

### Sprint 2 — UX Improvements — ✅ COMPLETED

7. Add `offset`/`limit` to menu item listing (Issue #7).
8. Default to `status='available'` in public menu item queries (Issue #8).
9. Remove `deliveryRadiusKm` from event, schema, projector (Issue #9).
10. Add `cuisineType`, `logoUrl`, `coverImageUrl` to restaurant schema (Issue #10).
11. Sort search results by distance when coords provided (Issue #11).

### Sprint 3 — Schema Hardening & Performance — ✅ COMPLETED

12. Add total count to paginated responses (Issue #12).
13. Add unique constraint `(restaurant_id, name)` to `menu_categories` (Issue #13).
14. Add indexes: `(is_approved, is_open)` on restaurants, GIN on `menu_items.tags` (Issues #14, #15).
15. Add bounding-box pre-filter to geo search for performance.

### Sprint 4 — Catalog Enrichment

16. Implement actual category-based restaurant search (Issue #3, Option B).
17. Add cuisine-type search filter.
18. Add menu item name search (JOIN with `menu_items`).
19. Design `RestaurantSearchResultDto` with `distanceKm` field.
20. Export `DeliveryZoneSnapshotUpdatedEvent` from barrel (Issue #16).

## ✅ Fix Summary (Post-Implementation + Post-Verification)

> All 19 original issues implemented. Post-fix verification completed 2026-05-02.
> 4 additional issues found and corrected during verification (V-1 through V-4).
> Zero lint errors remain across all affected files.

### Original 19 Issues — Verification Status

| #   | Issue                                                | Verified   | Notes                                                          |
| --- | ---------------------------------------------------- | ---------- | -------------------------------------------------------------- |
| 1   | ParseIntPipe on float coordinates                    | ✅ Correct | `ParseFloatPipe` applied on all three params                   |
| 2   | `setApproved()` missing event publish                | ✅ Correct | `publishRestaurantEvent()` helper called after `repo.update()` |
| 3   | Category filter dead code                            | ✅ Correct | `EXISTS` subquery against `menu_categories`                    |
| 4   | Unapproved restaurants in public listing             | ✅ Correct | `approvedOnly: true` passed from service                       |
| 5   | No default/max page limit                            | ✅ Correct | `DEFAULT_PAGE_SIZE=20`, `MAX_PAGE_SIZE=100` in all services    |
| 6   | `isOpen` not filtered in search                      | ✅ Correct | Condition added to search WHERE clause                         |
| 7   | Menu items — no pagination                           | ✅ Correct | `offset`/`limit` wired through all layers                      |
| 8   | Menu items — all statuses returned                   | ✅ Correct | Defaults to `status='available'`; `'all'` bypasses filter      |
| 9   | `deliveryRadiusKm` deprecated field cleanup          | ✅ Correct | Removed from event, schema, projector, repository, ACL DTO     |
| 10  | Missing `cuisineType`/`logoUrl`/`coverImageUrl`      | ✅ Correct | Added to all layers including Ordering BC snapshot             |
| 11  | Search not sorted by distance                        | ✅ Correct | Haversine `distanceExpr` in `ORDER BY` when coords provided    |
| 12  | No total count in paginated responses                | ✅ Correct | Parallel `COUNT(*)` queries; `{ data, total }` response shape  |
| 13  | Duplicate category names per restaurant              | ✅ Correct | `uniqueIndex` + `ConflictException` on PG error `23505`        |
| 14  | No composite index on `is_approved`/`is_open`        | ✅ Correct | `restaurants_approved_open_idx` in schema + migration          |
| 15  | No GIN index on `menu_items.tags`                    | ✅ Correct | `menu_items_tags_gin_idx` GIN index in schema + migration      |
| 16  | `events/index.ts` missing export                     | ✅ Correct | `delivery-zone-snapshot-updated.event` now exported            |
| 17  | False `@ApiUnauthorizedResponse` on public endpoints | ✅ Correct | Removed from all `@AllowAnonymous` handlers                    |
| 18  | `lat`/`lon` co-validation missing                    | ✅ Correct | `BadRequestException` thrown when only one is provided         |
| 19  | Search returns all DB columns                        | ✅ Correct | Explicit projection; `ownerId`/`isApproved` excluded           |

### Additional Issues Found and Fixed During Verification

| #   | Issue                                                                                                                                                | Severity | Files Fixed                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| V-1 | `RestaurantRepository.update()` return type declared `Promise<Restaurant>` but can return `undefined` — type safety gap in callers                   | Medium   | `restaurant.repository.ts` — return type → `Promise<Restaurant \| undefined>`; `restaurant.service.ts update()` — defensive null guard added |
| V-2 | Misleading comment in `setApproved()` claimed "`findOne` is called implicitly by `update`" — false; `repo.update()` never calls `findOne` internally | Minor    | `restaurant.service.ts` — comment corrected                                                                                                  |
| V-3 | Unnecessary non-null assertion `restaurant.id!` in `publishRestaurantEvent()` — `id` is a primary key and always non-null                            | Minor    | `restaurant.service.ts` — `!` removed                                                                                                        |
| V-4 | Unnecessary type cast `parseFloat(value as string)` in `zoneFeeColumn.fromDriver()` — cast not required                                              | Minor    | `restaurant.schema.ts` — cast removed                                                                                                        |

### Migration

`apps/api/src/drizzle/out/0006_catalog_enrichment.sql` applies:

- `restaurants.cuisine_type`, `restaurants.logo_url`, `restaurants.cover_image_url`
- `restaurants_approved_open_idx` composite index
- Drops `ordering_restaurant_snapshots.delivery_radius_km`
- Adds `ordering_restaurant_snapshots.cuisine_type`
- `menu_categories_restaurant_name_uidx` unique index
- `menu_items_tags_gin_idx` GIN index

### Lint / Type Check

All files in the `restaurant-catalog` BC and `ordering/acl` pass with **zero errors** after verification fixes.
