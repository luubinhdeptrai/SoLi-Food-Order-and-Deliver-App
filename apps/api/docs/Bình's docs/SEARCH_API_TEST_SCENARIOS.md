# Search API — Test Scenarios

**Endpoint**: `GET /api/search`  
**Auth**: `@AllowAnonymous` — no Authorization header required  
**Base URL**: `/api/search`

---

## 1. Endpoint Contract

| Parameter    | Type    | Required | Notes                                         |
|--------------|---------|----------|-----------------------------------------------|
| `q`          | string  | No       | Matches restaurant names AND item names (unaccent ILIKE) |
| `name`       | string  | No       | Matches restaurant name only                  |
| `item`       | string  | No       | Matches item name; restaurant section includes restaurants carrying matching items |
| `category`   | string  | No       | Restaurant must have a category with matching name |
| `cuisineType`| string  | No       | Matches restaurant cuisineType (unaccent ILIKE) |
| `tag`        | string  | No       | Item must have this exact value in its `tags[]` array |
| `lat`        | float   | No       | Must be paired with `lon`                     |
| `lon`        | float   | No       | Must be paired with `lat`                     |
| `radiusKm`   | float   | No       | Defaults to 5 km when lat/lon provided        |
| `offset`     | int     | No       | Default: 0; applies to both sections          |
| `limit`      | int     | No       | Default: 20; capped at 100                   |

**Response shape:**
```json
{
  "restaurants": [ { "id", "name", "address", "cuisineType", "latitude", "longitude", "distanceKm", ... } ],
  "items":       [ { "id", "name", "price", "tags", "categoryName", "restaurant": { "id", "name", ... } } ],
  "total":       { "restaurants": N, "items": N }
}
```

**Key exclusion rules:**
- `isApproved = false` → never returned
- `isOpen = false` → never returned
- `status ≠ 'available'` (for items) → never returned
- Items section is skipped entirely when none of `q`, `item`, `tag` is present

---

## 2. Seed Data Reference

The E2E test suite seeds the following data. IDs use `aa` prefix to avoid collision.

### Restaurants

| ID    | Name                  | Cuisine     | lat / lon              | isOpen | isApproved |
|-------|-----------------------|-------------|------------------------|--------|------------|
| **R1**| Phở Bắc               | Vietnamese  | 10.762622 / 106.660172 | ✅ open | ✅ yes    |
| **R2**| Bếp Đóng Cửa          | Vietnamese  | 10.775000 / 106.701000 | ❌ closed| ✅ yes   |
| **R3**| Cơm Tấm Sài Gòn       | Vietnamese  | 10.768000 / 106.682000 | ✅ open | ✅ yes    |
| **R4**| Seoul BBQ & More      | Korean      | 10.736000 / 106.703000 | ✅ open | ✅ yes    |
| **R5**| Sushi Hana            | Japanese    | 10.802000 / 106.706000 | ✅ open | ✅ yes    |

> R2 is the "closed restaurant" edge case — appears in **no** search result, even when its name/items match.
> R5 has **no delivery zones** but still appears in text and geo searches.

### Menu Categories

| Restaurant | Categories seeded            |
|------------|------------------------------|
| R1         | Noodles, Drinks              |
| R2         | Main Dishes                  |
| R3         | Rice Dishes, Sandwiches      |
| R4         | BBQ, Stews                   |
| R5         | Sushi, Drinks                |

### Menu Items

| ID    | Name                    | Restaurant | Tags                        | Status      |
|-------|-------------------------|------------|-----------------------------|-------------|
| i1    | Phở Bò Tái Nạm          | R1         | beef, soup, noodle          | available   |
| i2    | Phở Gà                  | R1         | chicken, soup, noodle       | available   |
| i3    | Bún Bò Huế              | R1         | **spicy**, beef, soup       | available   |
| i4    | Classic Burger          | R2         | beef, fastfood              | available   |
| i5    | Cơm Tấm Sườn Nướng      | R3         | pork, grilled, rice         | available   |
| i6    | Bánh Mì Thịt Nướng      | R3         | pork, grilled, sandwich     | available   |
| i7    | Cơm Chay                | R3         | **vegetarian**, vegan, rice | available   |
| i8    | Kimchi Jjigae           | R4         | **spicy**, pork, soup       | available   |
| i9    | Bibimbap                | R4         | beef, rice, korean          | available   |
| i10   | Bánh Mì Cá Hồi          | R5         | seafood, sandwich           | available   |
| i11   | Sashimi Cá Ngừ (hidden) | R5         | seafood, japanese           | **out_of_stock** |

> i11 is seeded as `out_of_stock` to test the status exclusion rule.

### Geo distances from search origin (10.77 / 106.67)

| Restaurant | Approx distance | Within 3 km? | Within 10 km? |
|------------|-----------------|--------------|---------------|
| R1         | ~1.35 km        | ✅ yes       | ✅ yes        |
| R3         | ~1.33 km        | ✅ yes       | ✅ yes        |
| R4         | ~5.2 km         | ❌ no        | ✅ yes        |
| R5         | ~5.3 km         | ❌ no        | ✅ yes        |
| R2         | ~3.5 km         | ❌ no (closed too) | — (closed) |

---

## 3. Test Scenarios

### 3.1 Browse Mode — No Parameters

| # | Request | Expected restaurants | Expected items | Notes |
|---|---------|----------------------|----------------|-------|
| B-01 | `GET /api/search` | R1, R3, R4, R5 | `[]`, total.items=0 | All open+approved; items always empty with no food filter |
| B-02 | `total.restaurants` | 4 | — | R2 excluded (closed) |

### 3.2 Full-Text Search (`?q=...`)

`q` applies accent-insensitive ILIKE against **restaurant name** (for restaurants section) and against **item name** (for items section). Both sections are populated.

| # | Request | Expected restaurants | Expected items | Notes |
|---|---------|----------------------|----------------|-------|
| Q-01 | `?q=pho` | R1 ("Phở Bắc") | Phở Bò Tái Nạm, Phở Gà | unaccent("pho") matches "Phở" |
| Q-02 | `?q=Pho` | R1 | Phở Bò Tái Nạm, Phở Gà | Case-insensitive |
| Q-03 | `?q=PHO` | R1 | Phở Bò Tái Nạm, Phở Gà | All-caps still works |
| Q-04 | `?q=banh+mi` | `[]` | Bánh Mì Thịt Nướng (R3), Bánh Mì Cá Hồi (R5) | No restaurant name matches; 2 items from 2 different restaurants |
| Q-05 | `?q=bun+bo` | `[]` | Bún Bò Huế (R1) | Accent insensitive: "bun bo" → "Bún Bò" |
| Q-06 | `?q=com+tam` | R3 ("Cơm Tấm Sài Gòn") | Cơm Tấm Sườn Nướng | Restaurant name match + item name match |
| Q-07 | `?q=seoul` | R4 ("Seoul BBQ & More") | `[]` | Restaurant name matches; no item name matches "seoul" |
| Q-08 | `?q=sushi` | R5 ("Sushi Hana") | Sushi Cá Hồi(?) | R5 appears in restaurants; item depends on `i11` exclusion |
| Q-09 | `?q=nonexistent_xyz_abc` | `[]` | `[]` | No matches → empty both sections |
| Q-10 | `?q=` (empty string) | All 4 open restaurants | `[]` | Empty string matches everything via ILIKE '%' = same as no filter |

> **Note on Q-04**: The `q` filter for the restaurant section only checks `restaurants.name`, NOT whether the restaurant carries a matching item. The `item` param handles that.

### 3.3 Restaurant Name Filter (`?name=...`)

`name` applies only to restaurant names. Items section is **always empty** when only `name` is provided (no food filter).

| # | Request | Expected restaurants | Expected items | Notes |
|---|---------|----------------------|----------------|-------|
| N-01 | `?name=Seoul` | R4 | `[]` | Exact partial match |
| N-02 | `?name=seoul` | R4 | `[]` | Case-insensitive |
| N-03 | `?name=bac` | R1 ("Phở Bắc") | `[]` | Accent-insensitive: "bac" → "Bắc" |
| N-04 | `?name=pho` | R1 | `[]` | "pho" matches "Phở Bắc" |
| N-05 | `?name=nonexistent` | `[]` | `[]` | No match |
| N-06 | `?name=bep` | `[]` | `[]` | "Bếp Đóng Cửa" matches name BUT is closed → excluded |

### 3.4 Item Name Filter (`?item=...`)

`item` finds restaurants that **carry** a matching available item AND returns those items in the items section.

| # | Request | Expected restaurants | Expected items | Notes |
|---|---------|----------------------|----------------|-------|
| I-01 | `?item=kimchi` | R4 | Kimchi Jjigae | Single restaurant + single item |
| I-02 | `?item=banh+mi` | R3, R5 | Bánh Mì Thịt Nướng, Bánh Mì Cá Hồi | Cross-restaurant item search |
| I-03 | `?item=com+chay` | R3 | Cơm Chay | Accent-insensitive |
| I-04 | `?item=burger` | `[]` | `[]` | R2 has Classic Burger but R2 is closed → excluded |
| I-05 | `?item=sashimi` | `[]` | `[]` | Sashimi Cá Ngừ is `out_of_stock` → excluded |

### 3.5 Tag Filter (`?tag=...`)

`tag` requires an **exact** match in `tags[]` array. Both the restaurant section (EXISTS sub-query) and item section (direct match) use the same filter.

| # | Request | Expected restaurants | Expected items | Notes |
|---|---------|----------------------|----------------|-------|
| T-01 | `?tag=spicy` | R1, R4 | Bún Bò Huế, Kimchi Jjigae | Both restaurants have spicy items |
| T-02 | `?tag=vegetarian` | R3 | Cơm Chay | Only R3 has vegetarian-tagged item |
| T-03 | `?tag=seafood` | R5 | Bánh Mì Cá Hồi | Sashimi (out_of_stock) excluded; Bánh Mì Cá Hồi matches |
| T-04 | `?tag=beef` | R1, R4 | Phở Bò Tái Nạm, Bún Bò Huế, Bibimbap | Multiple items per restaurant |
| T-05 | `?tag=SPICY` | `[]` | `[]` | Tags are case-sensitive (`ANY` match) — "SPICY" ≠ "spicy" |
| T-06 | `?tag=nonexistent` | `[]` | `[]` | No item has this tag |

### 3.6 Cuisine Type Filter (`?cuisineType=...`)

Applies only to the restaurant section. Items section always empty.

| # | Request | Expected restaurants | Expected items | Notes |
|---|---------|----------------------|----------------|-------|
| C-01 | `?cuisineType=Korean` | R4 | `[]` | Exact case |
| C-02 | `?cuisineType=korean` | R4 | `[]` | Case-insensitive (unaccent ILIKE) |
| C-03 | `?cuisineType=Vietnamese` | R1, R3 | `[]` | R2 excluded (closed); 2 open Vietnamese restaurants |
| C-04 | `?cuisineType=Japanese` | R5 | `[]` | Only R5 |
| C-05 | `?cuisineType=Viet` | R1, R3 | `[]` | Partial match (ILIKE '%Viet%') |
| C-06 | `?cuisineType=Italian` | `[]` | `[]` | No Italian restaurants |

### 3.7 Category Filter (`?category=...`)

Restaurant must have ≥1 menu category whose name matches. Items section always empty.

| # | Request | Expected restaurants | Expected items | Notes |
|---|---------|----------------------|----------------|-------|
| CA-01 | `?category=Noodles` | R1 | `[]` | R1 has "Noodles" category |
| CA-02 | `?category=Drinks` | R1, R3, R4, R5 | `[]` | All open restaurants have "Drinks" category |
| CA-03 | `?category=noodles` | R1 | `[]` | Case-insensitive |
| CA-04 | `?category=BBQ` | R4 | `[]` | Exact category match |
| CA-05 | `?category=Nonexistent` | `[]` | `[]` | No match |
| CA-06 | `?category=Main Dishes` | `[]` | `[]` | "Main Dishes" belongs to R2 (closed) → excluded |

### 3.8 Combined Filters

| # | Request | Expected restaurants | Expected items | Notes |
|---|---------|----------------------|----------------|-------|
| CM-01 | `?q=pho&cuisineType=Vietnamese` | R1 | Phở Bò, Phở Gà | Both filters applied (AND) |
| CM-02 | `?q=pho&cuisineType=Korean` | `[]` | `[]` | "pho" doesn't match Korean restaurants, no Korean pho items |
| CM-03 | `?tag=spicy&cuisineType=Korean` | R4 | Kimchi Jjigae | Both filters narrow results |
| CM-04 | `?q=pho&tag=spicy` | `[]` | Bún Bò Huế | q+tag combined: restaurant "Phở Bắc" loses because tag=spicy required; item matches both |
| CM-05 | `?item=banh+mi&cuisineType=Vietnamese` | R3 | Bánh Mì Thịt Nướng | R5 excluded by cuisineType (Japanese) |
| CM-06 | `?name=Seoul&tag=beef` | R4 | `[]` | name limits restaurants to R4; tag doesn't trigger items |

> **CM-04 note**: `?q=pho&tag=spicy` is an AND condition: restaurant must match BOTH q and tag. R1 matches q=pho (name) but its spicy item (Bún Bò) doesn't contain "pho". For the items section, the item must match BOTH q AND tag — only Bún Bò matches tag=spicy; its name "Bún Bò Huế" does NOT contain "pho". Verify actual behavior vs. expectation.

### 3.9 Geo Filters

Search origin: `lat=10.77, lon=106.67`

| # | Request | Expected restaurants | Expected items | Notes |
|---|---------|----------------------|----------------|-------|
| G-01 | `?lat=10.77&lon=106.67&radiusKm=3` | R1, R3 | `[]` | R4 (~5.2km) and R5 (~5.3km) outside radius |
| G-02 | `?lat=10.77&lon=106.67&radiusKm=10` | R1, R3, R4, R5 | `[]` | All open restaurants within 10km |
| G-03 | `?lat=10.77&lon=106.67` | R1, R3, R4, R5 | `[]` | Default radius 5km; R4 and R5 at ~5.2/5.3km - right at boundary; depends on exact Haversine |
| G-04 | `?lat=10.77&lon=106.67&radiusKm=3&q=pho` | R1 | Phở Bò, Phở Gà | Geo + text combined; R1 in radius + matches "pho" |
| G-05 | `?lat=10.77&lon=106.67&radiusKm=3&tag=spicy` | R1 | Bún Bò Huế | Geo + tag; R4 out of radius so excluded |
| G-06 | `?lat=10.77&lon=106.67&radiusKm=0.1` | `[]` | `[]` | Tiny radius; no restaurant exactly at origin |
| G-07 | `?lat=10.77&lon=106.67&radiusKm=3` | distanceKm is a number | — | `distanceKm` field populated in response |
| G-08 | `GET /api/search` (no geo) | distanceKm is null | — | `distanceKm` null when no lat/lon |

### 3.10 Geo Validation Errors

| # | Request | Expected status | Notes |
|---|---------|-----------------|-------|
| GV-01 | `?lat=10.77` (no lon) | `400 Bad Request` | Service throws BadRequestException |
| GV-02 | `?lon=106.67` (no lat) | `400 Bad Request` | Service throws BadRequestException |
| GV-03 | `?lat=abc&lon=106.67` | `400 Bad Request` | ParseFloatPipe rejects non-numeric |
| GV-04 | `?lat=10.77&lon=abc` | `400 Bad Request` | ParseFloatPipe rejects non-numeric |

### 3.11 Pagination

| # | Request | Expected | Notes |
|---|---------|----------|-------|
| P-01 | `?q=pho&limit=1` | 1 item max in each section | Items = 1; `total.items` = 2 (full count) |
| P-02 | `?q=pho&limit=1&offset=1` | Next page | Items = Phở Gà (page 2) |
| P-03 | `?limit=200` | Capped at 100 items max | `total` still reflects real count |
| P-04 | `GET /api/search&offset=9999` | `restaurants: []`, `total.restaurants: 4` | High offset returns empty; total unaffected |
| P-05 | `GET /api/search` | default limit | Restaurants up to 20; no crash |
| P-06 | `?q=pho&offset=0&limit=0` | behavior TBD | limit=0 → check if service clamps to 0 or handles gracefully |

### 3.12 Response Shape Validation

| # | Assertion | Notes |
|---|-----------|-------|
| RS-01 | Response has `restaurants`, `items`, `total` keys | Required structure |
| RS-02 | `total` has `restaurants` and `items` keys (numbers) | Required sub-structure |
| RS-03 | Each restaurant has: `id`, `name`, `address` | Always present |
| RS-04 | Restaurants do NOT have `ownerId` | Private field excluded |
| RS-05 | Restaurants do NOT have `isApproved` | Private field excluded |
| RS-06 | `distanceKm` is `null` when no geo params given | Nullable field |
| RS-07 | `distanceKm` is a positive number when geo provided | Geo result |
| RS-08 | Each item has `restaurant` nested object | `{ id, name, address, cuisineType }` |
| RS-09 | Item `restaurant` does NOT have `ownerId` | Private field excluded |
| RS-10 | `total.restaurants` equals `restaurants.length` when result < limit | Count accuracy |
| RS-11 | `total.items` is 0 when no food filter | Item section skip |
| RS-12 | `items[].price` is a numeric value (not null/undefined) | Required field |
| RS-13 | `items[].categoryName` may be a string or null | LEFT JOIN — nullable |

### 3.13 Data Exclusion Rules

| # | Scenario | Expected | Notes |
|---|----------|----------|-------|
| EX-01 | `?cuisineType=Vietnamese` → does R2 appear? | No | R2 (isOpen=false) excluded |
| EX-02 | `?tag=beef` → does Classic Burger appear? | No | R2 is closed |
| EX-03 | `?item=sashimi` → does Sashimi Cá Ngừ appear? | No | Item is `out_of_stock` |
| EX-04 | Any search → does an unapproved restaurant appear? | No | isApproved=false filter always applied |

### 3.14 Security / Injection Tests

| # | Request | Expected status | Notes |
|---|---------|-----------------|-------|
| SEC-01 | `?q='; DROP TABLE restaurants; --` | `200` | Parameterized queries; no data loss |
| SEC-02 | `?q=<script>alert(1)</script>` | `200`, safe JSON | No XSS at API level |
| SEC-03 | `?tag=' OR '1'='1` | `200`, `items: []` | No tag match; safe SQL |
| SEC-04 | `?limit=-1` | `200` | Negative limit handled (becomes 0 or clamped) |
| SEC-05 | `?offset=-1` | `200` | Negative offset handled |

---

## 4. Implementation Notes

### Accent-insensitive matching
PostgreSQL `unaccent` extension (migration 0007) strips diacritics before comparison:
- `"pho"` → matches `"Phở"`, `"Phở Bắc"`, `"Phở Bò Tái Nạm"`
- `"banh mi"` → matches `"Bánh Mì Thịt Nướng"`, `"Bánh Mì Cá Hồi"`
- `"com tam"` → matches `"Cơm Tấm Sài Gòn"`, `"Cơm Tấm Sườn Nướng"`

### Tag matching is NOT accent-insensitive
Tags use `= ANY(mi.tags)` — **exact case-sensitive string match**. Seeded tags use lowercase (`spicy`, `vegetarian`), so queries must use lowercase.

### `q` vs `item` distinction
- `?q=banh+mi` → checks restaurant **names** for "banh mi" → no match; checks item **names** → 2 items
- `?item=banh+mi` → checks if restaurant **carries** a matching item (EXISTS sub-query) → 2 restaurants; also returns those 2 items

### Item section is skipped when no food filter
When none of `q`, `item`, `tag` is provided, `findItems` returns `{ data: [], total: 0 }` immediately.  
Filters `name`, `cuisineType`, `category`, and geo-only never populate the items section.

### Default radius
When `lat`+`lon` are provided but `radiusKm` is omitted, the service defaults to **5 km**.

### Pagination caps
- `MAX_PAGE_SIZE = 100` — any `limit > 100` is silently capped
- `DEFAULT_PAGE_SIZE = 20` — used when `limit` is omitted
- `offset` defaults to 0

---

## 5. File References

| File | Purpose |
|------|---------|
| [search.controller.ts](../../src/module/restaurant-catalog/search/search.controller.ts) | Route, query params, pipes |
| [search.service.ts](../../src/module/restaurant-catalog/search/search.service.ts) | lat/lon validation, limit cap |
| [search.repository.ts](../../src/module/restaurant-catalog/search/search.repository.ts) | SQL queries, Haversine, unaccent |
| [search.dto.ts](../../src/module/restaurant-catalog/search/search.dto.ts) | Response DTOs |
| [test/e2e/search.e2e-spec.ts](../../test/e2e/search.e2e-spec.ts) | E2E implementation |
