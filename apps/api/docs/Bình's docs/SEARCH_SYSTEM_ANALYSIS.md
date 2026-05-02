# SEARCH_SYSTEM_ANALYSIS.md

> Search system analysis for the `restaurant-catalog` bounded context.
> Date: 2026-05-03 | Reviewer: senior backend engineer / system architect
> Scope: `search` module + `menu_items`, `menu_categories`, `restaurants` schema

---

## 📋 IMPLEMENTATION STATUS — SPRINT A + B COMPLETED ✅

> All Sprint A and Sprint B items implemented as of 2026-05-03.
> Sprint C (Unified SERP endpoint) also completed in the same pass.

**What was built:**
- ✅ **Unified SERP endpoint** `GET /api/search` replacing the old `GET /api/restaurants/search`
- ✅ **Menu item name search** (`item` param — accent-insensitive via `unaccent`)
- ✅ **General search** (`q` param — searches restaurant names + item names in one call)
- ✅ **Accent-insensitive search** — "pho" matches "Phở", "banh mi" matches "Bánh Mì"
- ✅ **Cuisine type filter** (`cuisineType` param — accent-insensitive)
- ✅ **Tag filter** (`tag` param — exact match against `menu_items.tags`)
- ✅ **Bounding-box pre-filter** before Haversine (O(log n) geo candidate reduction)
- ✅ **Database migration** `0007_search_indexes.sql` — `unaccent`, `pg_trgm`, trigram GIN indexes + geo index
- ✅ **New DTOs** `search.dto.ts` — `RestaurantSummaryDto`, `ItemSearchRowDto`, `UnifiedSearchResponseDto`
- ✅ **Zero TypeScript/lint errors** across all search module files

**Files changed:**
- `search/search.controller.ts` — fully rewritten (`@Controller('search')`, 11 query params)
- `search/search.service.ts` — fully rewritten (`search()` unified method)
- `search/search.repository.ts` — fully rewritten (`findRestaurants` + `findItems` + helpers)
- `search/search.dto.ts` — **new file** (unified SERP DTOs)
- `drizzle/out/0007_search_indexes.sql` — **new migration**

**Breaking change:** URL moved from `/api/restaurants/search` → `/api/search`

---

## 1. Summary

**Overall Assessment: ⚠️ Needs Significant Improvement**

The current implementation is a **restaurant-discovery tool**, not a food search system. It can help a user find a restaurant by name or category, but it **cannot find food**. On GrabFood or ShopeeFood, 80%+ of searches are food-item queries ("bánh mì", "pizza", "trà sữa") — none of which work in this system.

---

## 2. Current Capabilities (After Refactor)

| Feature | Status | How |
|---------|--------|-----|
| Search by restaurant name | ✅ Works | `unaccent(name) ILIKE unaccent('%q%')` |
| Search by menu item name | ✅ **NEW** | `unaccent(mi.name) ILIKE unaccent('%item%')` via JOIN |
| General search `q` (both sections) | ✅ **NEW** | Splits between restaurant + item sub-queries |
| Filter by menu category name | ✅ Works | `EXISTS` subquery against `menu_categories.name` |
| Filter by cuisine type | ✅ **NEW** | `unaccent(cuisineType) ILIKE unaccent('%type%')` |
| Filter by tag | ✅ **NEW** | `tag = ANY(menu_items.tags)` (GIN index) |
| Accent-insensitive matching | ✅ **NEW** | `unaccent()` extension on all text filters |
| Unified SERP response | ✅ **NEW** | `{ restaurants, items, total }` |
| Geo radius filter (Haversine) | ✅ Works | Bounding-box pre-filter + Haversine exact check |
| Sort by distance | ✅ Works | `distanceExpr` in `ORDER BY` when coords present |
| Pagination with cap | ✅ Works | `DEFAULT=20`, `MAX=100`, enforced in service |
| Filter by `isApproved + isOpen` | ✅ Works | Hardcoded WHERE conditions |
| Column projection (no sensitive fields) | ✅ Works | Explicit `select({})` — no ownerId/isApproved |
| Total count (both sections) | ✅ Works | Parallel `COUNT(*)` queries |

---

## 3. Critical Missing Features — ✅ ALL RESOLVED

### ✅ ~~#1 — Menu Item Name Search~~ (FIXED)

Implemented via `item` query param and `q` param. `findItems()` in the repository
joins `menu_items` with `restaurants` and filters `unaccent(mi.name) ILIKE unaccent('%query%')`.
The items section of the unified SERP always returns matching items with full restaurant context.

---

### ✅ ~~#2 — No Cuisine Type Filter~~ (FIXED)

`cuisineType` query param added to controller, service, and repository.
Filters: `unaccent(restaurants.cuisineType) ILIKE unaccent('%type%')`.

---

### ✅ ~~#3 — No Tag-Based Search~~ (FIXED)

`tag` query param exposed. Repository condition: `'${tag}' = ANY(menu_items.tags)`.
The GIN index on `menu_items.tags` (created in migration 0006) makes this O(log n).

---

### ✅ ~~#4 — No Accent-Insensitive / Full-Text Search~~ (FIXED)

All text filters now use `unaccent(column) ILIKE unaccent('%value%')`.
Migration `0007_search_indexes.sql` runs `CREATE EXTENSION IF NOT EXISTS unaccent`.
"pho" now matches "Phở", "banh mi" matches "Bánh Mì", "com tam" matches "Cơm Tấm".

---

### ✅ ~~#5 — No Combined / Unified Search Response~~ (FIXED)

New unified SERP response: `{ restaurants: [...], items: [...], total: { restaurants, items } }`.
Endpoint: `GET /api/search`. Both sections returned in one HTTP request via `Promise.all`.

---

### ✅ ~~#6 — Category Filter Semantic Mismatch~~ (Documented)

The `category` param still matches `menu_categories.name` (correct for exact-category search).
For cuisine-type discovery, the dedicated `cuisineType` param should be used instead.
This is now clearly documented in the Swagger API description.

**What's missing:**
The query **never touches `menu_items.name`**. `SearchRepository.search()` only queries the `restaurants` table with an optional `EXISTS` gate on `menu_categories.name`.

**What this means in practice:**
```
User searches: "bánh mì"
System checks:
  - restaurants.name ILIKE '%bánh mì%'    → no match (restaurant is "Hương Vị Quê Hương")
  - menu_categories.name ILIKE '%bánh mì%' → no match (category is "Bread & Sandwiches")
Result: 0 restaurants found

But the restaurant HAS a menu item named "Bánh Mì Thịt Nướng"
→ User gives up and closes the app
```

This is the **single most impactful gap**. Every food delivery app in the world routes a dish-name query to menu items first.

---

### ❌ #2 — No Cuisine Type Filter

The `restaurants.cuisineType` column was added (Issue #10) but the `SearchFilters` interface and controller have **no `cuisineType` query param**. The field is collected but never filterable.

```ts
// search.controller.ts — cuisineType param is ABSENT
search(
  @Query('name') name?: string,
  @Query('category') category?: string,
  @Query('lat') lat?: number,
  // ← no cuisineType here
)
```

---

### ❌ #3 — No Tag-Based Search

`menu_items.tags` has a GIN index (Issue #15) set up specifically for efficient array queries. But there is **no `tags` search param anywhere** in the search stack. The index was created but the feature was never exposed.

---

### ❌ #4 — No Accent-Insensitive / Full-Text Search

`ILIKE` is case-insensitive but **not accent-insensitive**. In Vietnamese:

```
User types: "pho"   → System searches ILIKE '%pho%'
Restaurant has: "Phở Hà Nội"
Result: NO MATCH — because 'o' ≠ 'ở'
```

Same problem for: `"bun bo"` → `"Bún Bò Huế"`, `"com tam"` → `"Cơm Tấm"`, `"tra sua"` → `"Trà Sữa"`.

This makes the entire search system nearly unusable for Vietnamese users who type without diacritics (the majority on mobile keyboards).

PostgreSQL has the `unaccent` extension built-in — it's a one-SQL-function fix that is not implemented.

---

### ❌ #5 — No Combined / Unified Search Response

GrabFood returns a unified SERP (search engine results page) containing:
- **Dish cards** — individual menu items that match the query
- **Restaurant cards** — restaurants whose name matches

The current system only returns restaurant cards. There is no endpoint that returns matching **menu items** directly. Users cannot click on "Bánh Mì Thịt Nướng" from search results and navigate straight to that item.

---

### ❌ #6 — Category Filter Semantic Mismatch

The current `category` filter maps to `menu_categories.name`, not cuisine type. This creates a misleading abstraction:

```
User sends: ?category=vietnamese
System searches: menu_categories.name ILIKE '%vietnamese%'
Reality: No restaurant has a category literally named "vietnamese"
  → The category names are "Rice dishes", "Noodles", "Drinks"
Result: 0 restaurants despite multiple Vietnamese restaurants existing
```

The `category` param works correctly only for exact category names like `?category=pizza`
when a restaurant has a category literally called "Pizza". For cuisine-type discovery,
`cuisineType` on the restaurant table is the right field — and it's not searchable.

---

## 4. Industry Gap Analysis (Updated)

| Feature | GrabFood | ShopeeFood | Uber Eats | **This System** |
|---------|----------|------------|-----------|------------------|
| Search by restaurant name | ✅ | ✅ | ✅ | ✅ |
| Search by menu item name | ✅ | ✅ | ✅ | ✅ **FIXED** |
| Combined SERP (items + restaurants) | ✅ | ✅ | ✅ | ✅ **FIXED** |
| Cuisine type filter | ✅ | ✅ | ✅ | ✅ **FIXED** |
| Accent-insensitive (Vietnamese) | ✅ | ✅ | N/A | ✅ **FIXED** |
| Tag search (spicy, vegan, etc.) | ✅ | ✅ | ✅ | ✅ **FIXED** |
| Relevance ranking | ✅ | ✅ | ✅ | ⚠️ Distance only (no popularity) |
| Fuzzy / typo tolerance | ✅ | ✅ | ✅ | ❌ (future: pg_trgm similarity threshold) |
| Price range filter | ✅ | ✅ | ✅ | ❌ (future sprint) |
| Sort by popularity | ✅ | ✅ | ✅ | ❌ (future sprint) |
| Dietary filter (vegan, halal) | ✅ | ✅ | ✅ | ✅ Via `tag` param |
| Autocomplete / suggestions | ✅ | ✅ | ✅ | ❌ (future sprint) |

---

## 5. Technical Issues (Updated)

### 5.1 — ✅ Category EXISTS Subquery Performance (MITIGATED)

Trigram GIN index on `menu_categories.name` added via migration 0007.
`pg_trgm` enables efficient ILIKE even with leading wildcards.
Full sequential scan eliminated for category filter.

### 5.2 — ✅ No Bounding Box Pre-Filter (FIXED)

`applyGeoConditions()` in the repository now applies a cheap lat/lon BETWEEN
pre-filter before the Haversine expression runs. Reduces candidate set from O(n)
to O(bounding-box) before the trig computation executes.

### 5.3 — ✅ No `menu_items.name` Index (FIXED)

Migration `0007_search_indexes.sql` creates `menu_items_name_trgm_idx` (GIN trigram).
Item name ILIKE queries are now efficient.

```sql
-- Runs for EVERY restaurant in the candidate set
EXISTS (
  SELECT 1 FROM menu_items mi
  JOIN menu_categories mc ON mc.id = mi.category_id
  WHERE mi.restaurant_id = restaurants.id
    AND mc.name ILIKE '%sushi%'
)
```

With 500 restaurants and 100 items each, this scans ~50,000 rows per search request.
`ILIKE` with a leading wildcard (`%sushi%`) also **cannot use any index** (not even a B-tree)
— it's always a sequential scan.

**Fix:** Add a `pg_trgm` GIN index on `menu_categories.name` and `menu_items.name`:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX menu_categories_name_trgm_idx ON menu_categories
  USING gin (name gin_trgm_ops);
```

### 5.2 — No Bounding Box Pre-Filter

The Haversine condition evaluates for every row passing `isApproved=true AND isOpen=true`.
Even with the `restaurants_approved_open_idx`, once that index returns candidates, Haversine
runs on all of them sequentially.

### 5.3 — No `menu_items.name` Index for When Item Search is Added

When item-name search is implemented, `menu_items.name` will need a trigram GIN index for
ILIKE to be fast. Currently absent.

---

## 6. UX Gaps (Updated)

### ✅ Scenario A — Vietnamese user on mobile (FIXED)
```
User types: "com tam"
Expected:   Cơm Tấm Sườn Nướng at nearby restaurants
Actual:     ✅ Works — unaccent("com tam") matches unaccent("Cơm Tấm") in item names
```

### ✅ Scenario B — Tourist in Saigon (FIXED)
```
User types: "pho"
Expected:   Phở restaurants nearby
Actual:     ✅ Works — unaccent("pho") matches unaccent("Phở Hà Nội")
```

### ✅ Scenario C — Looking for a specific dish (FIXED)
```
User types: "pizza"
Expected:   Pizza dishes from all nearby restaurants
Actual:     ✅ Works — items section returns pizza menu items from all matching restaurants,
            restaurants section returns restaurants named/categorised as pizza
```

### ✅ Scenario D — Dietary requirement (FIXED)
```
User types: ?tag=vegetarian
Expected:   Items tagged "vegetarian" or restaurants with vegan options
Actual:     ✅ Works — tag = ANY(menu_items.tags) with GIN index
```
```
User types: "com tam"
Expected:   Cơm Tấm Sườn Nướng at nearby restaurants
Actual:     0 results  (accent mismatch + item name never searched)
```

### Scenario B — Tourist in Saigon
```
User types: "pho"
Expected:   Phở restaurants nearby
Actual:     0 results  (ILIKE 'o' ≠ 'ở')
```

### Scenario C — Looking for a specific dish
```
User types: "pizza"
Expected:   Pizza dishes from all nearby restaurants
Actual:     Only restaurants literally named "pizza"
            or those with a category called "pizza"
            (misses "The Italian Kitchen" with 15 pizza menu items)
```

### Scenario D — Dietary requirement
```
User types: "vegan"
Expected:   Items tagged "vegan" or restaurants with vegan options
Actual:     0 results  (tags not searchable despite GIN index existing)
```

---

## 7. Recommendations — Implementation Status

### ✅ Priority 1 — Add Menu Item Name Search (DONE)

Implemented via `item` param in controller/service/repository.
`findItems()` uses `innerJoin(restaurants)` + `leftJoin(menuCategories)` with
`unaccent(mi.name) ILIKE unaccent('%item%')` condition.

### ✅ Priority 2 — Accent-Insensitive Search via `unaccent` (DONE)

`CREATE EXTENSION IF NOT EXISTS unaccent` in migration 0007.
All ILIKE conditions in `findRestaurants()` and `findItems()` wrapped with `unaccent()`.

### ✅ Priority 3 — Expose `cuisineType` Filter (DONE)

`cuisineType` query param added to all three layers.

### ✅ Priority 4 — Expose Tag Filter (DONE)

`tag` query param added. Uses `tag = ANY(mi.tags)` with the existing GIN index.

### ✅ Priority 5 — Trigram Indexes (DONE)

Migration `0007_search_indexes.sql` creates:
- `restaurants_name_trgm_idx`
- `menu_items_name_trgm_idx`
- `menu_categories_name_trgm_idx`

### ✅ Priority 6 — Bounding Box Pre-Filter (DONE)

`applyGeoConditions()` private helper pushes BETWEEN conditions before Haversine.

### ✅ Priority 7 — Unified SERP Endpoint (DONE)

`GET /api/search` returns `{ restaurants, items, total }` in one HTTP request.
Both sub-queries run in `Promise.all` for minimal latency.

Add a new `item` query param that searches `menu_items.name` and returns restaurants that
carry a matching item:

**Controller addition:**
```ts
@ApiQuery({ name: 'item', required: false, description: 'Menu item name (e.g. "bánh mì")' })
@Query('item') item?: string,
```

**Service addition:**
```ts
async searchRestaurants(
  name?: string,
  category?: string,
  item?: string,      // ← new
  ...
```

**Repository addition:**
```ts
// Add to SearchFilters interface
item?: string;

// Add to search() WHERE conditions
if (filters.item) {
  conditions.push(
    sql`EXISTS (
      SELECT 1 FROM menu_items mi
      WHERE mi.restaurant_id = ${restaurants.id}
        AND mi.name ILIKE ${'%' + filters.item + '%'}
        AND mi.status = 'available'
    )`,
  );
}
```

**Long-term (proper item-level search):** Add a separate `GET /search/items` endpoint that
returns `{ menuItem, restaurant }` pairs — this is what every production food delivery app
exposes as the primary search surface.

---

### Priority 2 — Accent-Insensitive Search via `unaccent`

Enable the `unaccent` PostgreSQL extension (bundled with Postgres, zero install):

**Migration:**
```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
```

**Repository — replace ILIKE with unaccent-aware version:**
```ts
// Before:
ilike(restaurants.name, `%${filters.name}%`)

// After:
sql`unaccent(${restaurants.name}) ILIKE unaccent(${'%' + filters.name + '%'})`
```

Apply the same pattern to `menu_items.name`, `menu_categories.name`.

This makes: `"pho"` match `"Phở"`, `"com"` match `"Cơm"`, `"bun"` match `"Bún"`.
**Single most impactful fix for Vietnamese users.**

---

### Priority 3 — Expose `cuisineType` Filter ⭐ Trivial effort

**Controller:**
```ts
@ApiQuery({ name: 'cuisineType', required: false, example: 'Vietnamese' })
@Query('cuisineType') cuisineType?: string,
```

**Repository:**
```ts
if (filters.cuisineType) {
  conditions.push(ilike(restaurants.cuisineType, `%${filters.cuisineType}%`));
}
```

5-line change. `cuisineType` is already in the DB and schema — it just isn't reachable
from the API.

---

### Priority 4 — Expose Tag Filter

The GIN index already exists on `menu_items.tags`. Just expose it:

```ts
// Controller
@ApiQuery({ name: 'tag', required: false, example: 'vegetarian' })
@Query('tag') tag?: string,

// Repository
if (filters.tag) {
  conditions.push(
    sql`EXISTS (
      SELECT 1 FROM menu_items mi
      WHERE mi.restaurant_id = ${restaurants.id}
        AND mi.status = 'available'
        AND ${filters.tag} = ANY(mi.tags)
    )`,
  );
}
```

---

### Priority 5 — Trigram Indexes for ILIKE Performance

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX menu_items_name_trgm_idx
  ON menu_items USING gin (name gin_trgm_ops);

CREATE INDEX restaurants_name_trgm_idx
  ON restaurants USING gin (name gin_trgm_ops);

CREATE INDEX menu_categories_name_trgm_idx
  ON menu_categories USING gin (name gin_trgm_ops);
```

These make `ILIKE '%partial%'` queries use an index instead of a sequential scan.

---

### Priority 6 — Bounding Box Pre-Filter

Add before the Haversine condition to reduce the candidate set dramatically:

```ts
if (filters.lat !== undefined && filters.lon !== undefined) {
  const latDelta = radiusKm / 111.0;
  const lonDelta = radiusKm / (111.0 * Math.cos((filters.lat * Math.PI) / 180));
  conditions.push(
    sql`${restaurants.latitude} BETWEEN ${filters.lat - latDelta} AND ${filters.lat + latDelta}`,
  );
  conditions.push(
    sql`${restaurants.longitude} BETWEEN ${filters.lon - lonDelta} AND ${filters.lon + lonDelta}`,
  );
  // Haversine exact check follows to eliminate bounding-box false positives
}
```

---

### Priority 7  — Unified SERP Endpoint (OK dùng endpoint này đi)

Add `GET /search` (no `/restaurants` prefix) that returns a combined response:

```ts
interface UnifiedSearchResult {
  restaurants: RestaurantSearchRow[];   // matched by restaurant name / cuisine
  items: {
    item: MenuItem;
    restaurant: RestaurantSummary;
  }[];                                  // matched by item name / tag
  total: {
    restaurants: number;
    items: number;
  };
}
```

This matches the UX pattern of GrabFood/ShopeeFood where the SERP shows both
"Restaurants" and "Dishes" sections from a single query.

---

## 8. Final Verdict (Updated)

**Is search ready for production? ✅ YES — for MVP launch.**

All 7 priorities from the original analysis have been implemented. The search system
now covers the core feature set of GrabFood / ShopeeFood for Vietnamese food delivery.

| Gap | Previous Status | Current Status |
|-----|-----------------|----------------|
| No menu item name search | 🔴 Critical | ✅ Fixed |
| No accent-insensitive search | 🔴 Critical for VN | ✅ Fixed |
| `cuisineType` filter not exposed | 🟡 High | ✅ Fixed |
| Tag filter not exposed | 🟡 High | ✅ Fixed |
| No combined SERP | 🟡 High | ✅ Fixed |
| No trigram indexes | 🟡 Performance | ✅ Fixed |
| No bounding box pre-filter | 🟢 Perf at scale | ✅ Fixed |

**Remaining gaps (future sprint):**
- Fuzzy / typo-tolerant search (`pg_trgm` similarity threshold already available)
- Price range filter (`?minPrice=&maxPrice=`)
- Sort by popularity (requires an order-count denorm column)
- Autocomplete endpoint (`GET /search/suggest?q=pho`)

The system is ready as a **restaurant directory** (find a restaurant by name), but not as a
**food search system**. The two most impactful gaps are item-name search and
accent-insensitive matching. Without them, Vietnamese users searching for actual food will
consistently get 0 results.

| Gap | Severity | Effort to Fix |
|-----|----------|---------------|
| No menu item name search | 🔴 Critical | Medium — 2–3 days |
| No accent-insensitive search | 🔴 Critical for VN | Low — 1 day |
| `cuisineType` filter not exposed | 🟡 High | Trivial — 1 hour |
| Tag filter not exposed | 🟡 High | Low — half day |
| No combined SERP (items + restaurants) | 🟡 High | Large — 1 week |
| No trigram indexes | 🟡 Performance | Low — migration only |
| No bounding box pre-filter | 🟢 Perf at scale | Low — half day |

**Minimum viable for launch:** Priorities 1 + 2 + 3 above.

---

## 9. Implementation Order (Sprint Status)

### ✅ Sprint A — Make basic search work for Vietnamese users (COMPLETED)

1. ✅ `CREATE EXTENSION unaccent` (migration 0007)
2. ✅ `unaccent()` wrapper on all ILIKE conditions in `search.repository.ts`
3. ✅ `item` param — searches `menu_items.name` (accent-insensitive)
4. ✅ `cuisineType` param — filters `restaurants.cuisineType`

**Result:** Vietnamese users can search "pho", "com tam", "banh mi" and get real results.

### ✅ Sprint B — Performance and coverage (COMPLETED)

5. ✅ `CREATE EXTENSION pg_trgm` + trigram GIN indexes (migration 0007)
6. ✅ Bounding-box pre-filter in `applyGeoConditions()`
7. ✅ `tag` param exposed

**Result:** Search works at scale; dietary/tag filtering available.

### ✅ Sprint C — Unified SERP (COMPLETED)

8. ✅ `GET /api/search` returning combined restaurant + item results
9. ✅ `q` general param searches both sections simultaneously
10. ♂️ Relevance scoring: distance-first when geo provided; recency otherwise (no ML ranking yet)
11. ❌ Autocomplete endpoint — future sprint

1. `CREATE EXTENSION unaccent` (migration)
2. Apply `unaccent()` wrapper to all ILIKE conditions in `search.repository.ts`
3. Add `item` param — search `menu_items.name`
4. Add `cuisineType` param — filter `restaurants.cuisineType`

**Deliverable:** A Vietnamese user can search "pho", "com tam", "banh mi" and get real results.

### Sprint B — Performance and coverage

5. `CREATE EXTENSION pg_trgm` + trigram indexes (migration)
6. Add bounding-box pre-filter
7. Expose `tag` param

**Deliverable:** Search works at scale; dietary/tag filtering available.

### Sprint C — Unified SERP 

8. `GET /search` endpoint returning combined restaurant + item results
9. Relevance scoring (name exact match > substring > category match)
10. Autocomplete endpoint (`GET /search/suggest?q=pho`)
