# Search E2E Test — Bug Fix Log

**File under test**: `test/e2e/search.e2e-spec.ts`  
**Test run before fixes**: 27 passed, 41 failed (all HTTP 500)  
**Test run after fixes**: **68 passed, 0 failed**

---

## Summary of Fixes

| # | Root Cause | File Changed | Tests Fixed |
|---|-----------|-------------|-------------|
| 1 | `unaccent` PostgreSQL extension not installed in test DB | `test/setup/db-setup.ts` | All 41 HTTP-500 failures |
| 2 | `findItems()` did not filter items by `cuisineType` | `src/module/restaurant-catalog/search/search.repository.ts` | CM-02, CM-03, CM-04 |
| 3 | SEC-01 assertion was logically incorrect | `test/e2e/search.e2e-spec.ts` | SEC-01 |

---

## Fix 1 — Missing `unaccent` PostgreSQL Extension

### Root Cause

All 41 failing tests returned HTTP 500. Every failure came from search parameters that trigger `unaccent()` SQL calls inside `SearchRepository` (`q`, `name`, `item`, `category`, `cuisineType`). PostgreSQL threw:

```
ERROR: function unaccent(text) does not exist
```

The `unaccent` (and `pg_trgm`) extensions are installed by migration `0007_search_indexes.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

However, the database was bootstrapped via `pnpm db:push` (which pushes the schema directly without running migration files). As a result:
- All tables and columns existed correctly
- But migration `0007` was never executed
- So the `unaccent` function did not exist in PostgreSQL

Tests that passed without this fix only used filters that do **not** call `unaccent()`:
- Browse mode (no parameters)
- `tag=` filter (uses `= ANY(mi.tags)`)
- Geo-only filters (use coordinate arithmetic)

### Fix Applied

**`test/setup/db-setup.ts`**:
- Added `sql` to the `drizzle-orm` import
- Added a new exported function `ensureExtensions()`:

```typescript
export async function ensureExtensions(): Promise<void> {
  const db = getTestDb();
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS unaccent`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
}
```

- Idempotent — safe to call even if extensions are already installed
- Must be called in `beforeAll` of any test suite that exercises text-based search filters

**`test/e2e/search.e2e-spec.ts`**:
- Added `ensureExtensions` to the import from `../setup/db-setup`
- Called `await ensureExtensions()` at the top of `beforeAll`, **before** `resetDb()` and data seeding

### Why This is the Correct Approach

Running `pnpm db:migrate` against the database would also fix the issue, but the code-level fix in `db-setup.ts` is more robust because:
1. It works in any CI environment where migrations haven't been applied
2. Tests are self-contained — no external setup step required
3. `CREATE EXTENSION IF NOT EXISTS` is idempotent, so it never fails on a fully-migrated DB

---

## Fix 2 — `findItems()` Missing `cuisineType` Filter

### Root Cause

When `cuisineType` was combined with a food filter (`q`, `tag`, or `item`), the **items section** returned items from ALL restaurants regardless of their cuisine type. For example:

- `GET /api/search?tag=spicy&cuisineType=Korean` → returned Bún Bò Huế (Vietnamese) alongside Kimchi Jjigae (Korean) ✗
- `GET /api/search?q=pho&cuisineType=Korean` → returned Vietnamese pho items even though cuisineType=Korean ✗
- `GET /api/search?item=banh+mi&cuisineType=Vietnamese` → returned R5's Bánh Mì (Japanese restaurant) ✗

**Affected tests**: CM-02, CM-03, CM-04

### Cause

In `SearchRepository.findItems()`, the conditions array only filtered by:
- `menuItems.status = 'available'`
- `restaurants.isApproved = true`
- `restaurants.isOpen = true`
- Geo radius (when lat/lon provided)
- Item name (`q`, `item`)
- Item tag (`tag`)

The `cuisineType` filter was applied in `findRestaurants()` but **not** in `findItems()`. Since `findItems()` does an `INNER JOIN` with the `restaurants` table, the cuisineType condition can be applied to the joined row.

### Fix Applied

**`src/module/restaurant-catalog/search/search.repository.ts`**

Added a `cuisineType` condition inside `findItems()`, after the `tag` filter block:

```typescript
// When cuisineType is combined with a food filter, items must come from
// restaurants whose cuisine_type matches — the INNER JOIN gives us the
// restaurants row, so we can filter it here exactly as we do in findRestaurants.
if (filters.cuisineType) {
  conditions.push(
    sql`unaccent(${restaurants.cuisineType}) ILIKE unaccent(${'%' + filters.cuisineType + '%'})`,
  );
}
```

This ensures both the `restaurants` section and the `items` section respect the `cuisineType` filter when combining it with food-specific filters.

---

## Fix 3 — SEC-01 Test Assertion Was Logically Incorrect

### Root Cause

The SEC-01 test sends a SQL injection string as the `q` parameter:

```
q='; DROP TABLE restaurants; --
```

The **correct** behavior of a parameterized query is to treat this as a **literal text value** — the search looks for restaurants/items whose name literally contains `'; DROP TABLE restaurants; --`. No records match, so `total.restaurants = 0`.

The original assertion was:
```typescript
expect(res.body.total.restaurants).toBeGreaterThan(0); // WRONG
```

This expected `total.restaurants > 0`, but since the injection string is not a restaurant name, 0 is the correct result of a safe parameterized query. The assertion was inadvertently testing the **wrong** thing — it would only pass if the query had been broken/injected.

### Fix Applied

**`test/e2e/search.e2e-spec.ts`**

Replaced the single request with two requests:

```typescript
// Injection string treated as literal text → 0 results (proves parameterization)
const injRes = await http
  .get("/api/search?q='; DROP TABLE restaurants; --")
  .set(noAuthHeaders());

expect(injRes.status).toBe(200);
expect(injRes.body.total.restaurants).toBe(0); // literal text — no match

// Verify the table was NOT dropped — a clean browse must still return data
const cleanRes = await http.get('/api/search').set(noAuthHeaders());
expect(cleanRes.status).toBe(200);
expect(cleanRes.body.total.restaurants).toBeGreaterThan(0);
```

**Why this is correct**:
1. `injRes.status === 200` — no 500 crash, the query ran safely
2. `injRes.total.restaurants === 0` — the injection string was treated as literal text (parameterization confirmed)
3. `cleanRes.total.restaurants > 0` — the table was NOT dropped (DROP TABLE injection did not execute)

---

## Files Changed

| File | Change Type | Description |
|------|------------|-------------|
| `test/setup/db-setup.ts` | Added function | `ensureExtensions()` — installs `unaccent` + `pg_trgm` extensions idempotently |
| `test/e2e/search.e2e-spec.ts` | Import + `beforeAll` | Added `ensureExtensions` import; called in `beforeAll`; fixed SEC-01 assertion |
| `src/module/restaurant-catalog/search/search.repository.ts` | Bug fix | Added `cuisineType` condition to `findItems()` |

---

## Final Test Results

```
Tests:       68 passed, 0 failed
Test Suites: 1 passed, 1 total
Time:        ~8 s
```

All 14 test sections pass:
- §1 Browse mode (B-01 to B-03)
- §2 Full-text q= (Q-01 to Q-07)
- §3 Restaurant name filter (N-01 to N-05)
- §4 Item name filter (I-01 to I-05)
- §5 Tag filter (T-01 to T-04)
- §6 Cuisine type filter (C-01 to C-06)
- §7 Category filter (CA-01 to CA-05)
- §8 Combined filters (CM-01 to CM-04)
- §9 Geo-radius filter (G-01 to G-08)
- §10 Geo validation (GV-01 to GV-04)
- §11 Pagination (P-01 to P-05)
- §12 Response shape (RS-01 to RS-06)
- §13 Data exclusion rules (EX-01 to EX-03)
- §14 Security (SEC-01 to SEC-03)
