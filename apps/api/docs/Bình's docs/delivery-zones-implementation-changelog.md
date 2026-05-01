# Delivery Zones + Haversine — Implementation Changelog

> **Phase:** Dynamic Pricing Implementation  
> **Based on:** `delivery-zones-haversine-proposal.md`  
> **Schema migration:** `src/drizzle/out/0005_delivery_zones_dynamic_pricing.sql` (applied via `pnpm db:push`, exit 0)

---

## Summary

This document records every file changed or created during the implementation of the delivery-zones dynamic pricing feature, the key decisions made, and the known deviations from the original proposal that need follow-up.

---

## Files Created

### `src/lib/geo/geo.service.ts` ✅ NEW

Pure Haversine math service. No DB access.

- Exports `Coordinates` interface `{ latitude: number; longitude: number }`
- `calculateDistanceKm(from, to)` — Haversine great-circle distance; constants `EARTH_RADIUS_KM = 6_371`, `DEGREES_TO_RADIANS = Math.PI / 180`
- `isWithinRadius(origin, destination, radiusKm)` — convenience boolean wrapper

### `src/lib/geo/geo.module.ts` ✅ NEW

`@Global()` NestJS module. Registers `GeoService` once in the root app. Any module can inject `GeoService` without importing `GeoModule` explicitly.

### `src/drizzle/out/0005_delivery_zones_dynamic_pricing.sql` ✅ NEW

Migration applied to development database:
- `DROP COLUMN IF EXISTS delivery_fee`
- `DROP COLUMN IF EXISTS estimated_minutes`
- `ADD COLUMN IF NOT EXISTS base_fee NUMERIC(10,2) DEFAULT 0`
- `ADD COLUMN IF NOT EXISTS per_km_rate NUMERIC(10,2) DEFAULT 0`
- `ADD COLUMN IF NOT EXISTS avg_speed_kmh REAL DEFAULT 20` ← see deviation §1
- `ADD COLUMN IF NOT EXISTS prep_time_minutes REAL DEFAULT 15`
- `ADD COLUMN IF NOT EXISTS buffer_minutes REAL DEFAULT 5`
- `CHECK` constraints on all new columns
- 3 new indexes: `idx_delivery_zones_restaurant_id`, `idx_delivery_zones_restaurant_active` (partial), `idx_delivery_zones_restaurant_radius` (partial, sorted)

---

## Files Modified

### `src/module/restaurant-catalog/restaurant/restaurant.schema.ts`

**Changes:**
- Added `zoneFeeColumn` custom type (`customType<{ data: number; driverData: string }>`) — uses `NUMERIC(10,2)` with `fromDriver: parseFloat` + `toDriver: String`. Avoids Drizzle's built-in `numeric()` which returns `string` from the driver.
- Replaced flat `deliveryFee` + `estimatedMinutes` columns with:
  - `baseFee: zoneFeeColumn('base_fee').notNull().default(0)`
  - `perKmRate: zoneFeeColumn('per_km_rate').notNull().default(0)`
  - `avgSpeedKmh: real('avg_speed_kmh').notNull().default(30)`
  - `prepTimeMinutes: real('prep_time_minutes').notNull().default(15)`
  - `bufferMinutes: real('buffer_minutes').notNull().default(5)`
- `DeliveryZone` and `NewDeliveryZone` inferred types updated automatically.

---

### `src/module/restaurant-catalog/restaurant/zones/zones.dto.ts`

**Changes (full rewrite of relevant sections):**

| Class | What changed |
|---|---|
| `CreateDeliveryZoneDto` | Added `baseFee` (required), `perKmRate` (required), `avgSpeedKmh?`, `prepTimeMinutes?`, `bufferMinutes?` |
| `UpdateDeliveryZoneDto` | Extends `PartialType(CreateDeliveryZoneDto)` — inherits all new optional fields + `isActive?` |
| `DeliveryZoneResponseDto` | Added all new columns |
| `DeliveryEstimateQueryDto` | **NEW** — `lat` + `lon` with `@Type(() => Number)` (critical for string→number coercion from query params), `@IsLatitude()`, `@IsLongitude()`, `@IsNumber()` |
| `DeliveryFeeBreakdownDto` | **NEW** — `baseFee`, `distanceFee`, `prepTimeMinutes`, `travelTimeMinutes`, `bufferMinutes` |
| `DeliveryEstimateResponseDto` | **NEW** — `restaurantId`, `distanceKm`, `zone: {id, name, radiusKm}`, `deliveryFee`, `estimatedMinutes`, `breakdown` |

---

### `src/module/restaurant-catalog/restaurant/zones/zones.repository.ts`

**Changes:**

| Method | Change |
|---|---|
| `create()` | Now inserts `baseFee`, `perKmRate`, `avgSpeedKmh ?? 20`, `prepTimeMinutes ?? 15`, `bufferMinutes ?? 5` |
| `update()` | Uses `{ ...dto, updatedAt: new Date() }` spread (simpler than proposal's explicit mapping) |
| `findActiveByRestaurantOrderedByRadius()` | **NEW** — `WHERE is_active = TRUE ORDER BY radius_km ASC` using `and(eq(...), eq(...))` + `asc(deliveryZones.radiusKm)` |

---

### `src/module/restaurant-catalog/restaurant/zones/zones.service.ts`

**Changes:**
- Injected `GeoService`
- Added `estimateDelivery(restaurantId, customerCoords)`:
  1. Loads restaurant → checks `latitude`/`longitude` not null → 422 if missing
  2. Loads active zones (ordered by radius ASC)
  3. 422 if no active zones
  4. Calls `geo.calculateDistanceKm()`
  5. `findEligibleZone()` → 422 if none covers the distance
  6. `buildEstimateResponse()` assembles the full response DTO
- Private helpers: `findEligibleZone()`, `calculateDeliveryFee()`, `calculateEstimatedMinutes()`, `buildEstimateResponse()`
- All helpers are called (no dead code)

---

### `src/module/restaurant-catalog/restaurant/zones/zones.controller.ts`

**Changes:**
- Added `GET delivery-estimate` endpoint **before** `GET :id` (required — NestJS route registration order; `ParseUUIDPipe` would reject the literal string "delivery-estimate" with 400 if `:id` came first)
- `@AllowAnonymous()` on the new endpoint (public — no auth required to estimate delivery)
- Uses `@Query() query: DeliveryEstimateQueryDto` (class-transformer coerces string params to number via `@Type(() => Number)`)
- Added `ApiQuery`, `ApiUnprocessableEntityResponse` Swagger decorators

---

### `src/module/restaurant-catalog/search/search.repository.ts`

**Changes:**
- Replaced Euclidean degree-difference approximation (`POWER(...) <= radiusKm / 111`) with Haversine SQL:

```sql
(2 * 6371 * ASIN(SQRT(
  POWER(SIN(RADIANS(latitude  - :lat) / 2), 2) +
  COS(RADIANS(:lat)) * COS(RADIANS(latitude)) *
  POWER(SIN(RADIANS(longitude - :lon) / 2), 2)
))) <= :radius_km
```

**Why this matters:** At Vietnam's latitudes (~10–21°N), a degree of longitude ≈ 103–110 km. The old `/ 111` constant was wrong above the equator, causing the search radius to be inaccurate by up to 8 % at Hanoi's latitude.

---

### `src/module/ordering/order/commands/place-order.handler.ts`

**Changes:**
- Added imports: `GeoService` from `@/lib/geo/geo.service`, `deliveryZones` from `@/drizzle/schema`, `and` from `drizzle-orm`
- Added local `interface DeliveryZoneInfo { radiusKm: number }` — D3-B compliant (no cross-BC type import)
- Injected `GeoService` in constructor
- Step 6 replaced: queries `delivery_zones` directly (same DB, pragmatic for Phase 4) to get active zones for the restaurant
- Replaced `assertDeliveryRadiusIfApplicable()` with `assertDeliveryZoneIfApplicable()`:
  - Soft guard: skips check with `logger.warn` if either side is missing coordinates
  - Skips if no active zones configured
  - `[...activeZones].sort(...)` — copies array before sort, no mutation ✅
  - `geo.calculateDistanceKm()` — Haversine
  - 422 if customer is outside all zones
- Removed old `haversineDistanceKm` private method (was re-implementing what `GeoService` now provides)

---

### `src/app.module.ts`

**Changes:**
- Added `import { GeoModule } from './lib/geo/geo.module'`
- Added `GeoModule` to the `imports` array (declared before `RestaurantCatalogModule`)

---

## Known Deviations from Proposal

All issues below have been **fixed**. The original description is preserved for context.

### 1. ~~🟠~~ ✅ FIXED — `avgSpeedKmh` default value inconsistency

| Location | Value | Proposal |
|---|---|---|
| `restaurant.schema.ts` — Drizzle `.default()` | `30` | `30` ✅ |
| `0005_...sql` migration — `DEFAULT` | ~~`20`~~ → **`30`** | `30` ✅ |
| `zones.repository.ts` — `create()` fallback `??` | ~~`?? 20`~~ → **`?? 30`** | `30` ✅ |

**Fix applied:**
- `zones.repository.ts`: `avgSpeedKmh ?? 20` → `avgSpeedKmh ?? 30`
- `0005_delivery_zones_dynamic_pricing.sql`: `DEFAULT 20` → `DEFAULT 30`

> ⚠️ The migration has already been applied to the dev DB with `DEFAULT 20`. Run `pnpm db:push` again (or a corrective migration) to update existing rows and the DB column default.

---

### 2. ~~🟠~~ ✅ FIXED — `estimatedMinutes` not rounded in `buildEstimateResponse`

`zones.service.ts` `buildEstimateResponse` now returns `Math.round(estimatedMinutes)` instead of the raw float sum.

---

### 3. ~~🟡~~ ✅ FIXED — `update()` uses `...dto` spread instead of explicit field mapping

`zones.repository.ts` `update()` now builds an explicit `patch` object with per-field conditional spreading:

```typescript
const patch: Partial<typeof deliveryZones.$inferInsert> = {
  ...(dto.name !== undefined && { name: dto.name }),
  // ...each field explicitly
  updatedAt: new Date(),
};
```

---

### 4. ~~🟡~~ ✅ FIXED — Missing `@Max(120)` on `avgSpeedKmh` in `CreateDeliveryZoneDto`

`zones.dto.ts` `CreateDeliveryZoneDto.avgSpeedKmh` now has `@Max(120)` added. Import for `Max` also added.

---

### 5. ~~🟢~~ ✅ FIXED — `distanceKm` rounded to 3 decimal places instead of 2

`zones.service.ts` now uses `Math.round(distanceKm * 100) / 100` (2dp), matching the proposal.

---

### 6. ~~🟢~~ ✅ FIXED — `deliveryFee` rounded with `toFixed(2)` instead of `Math.round()`

`zones.service.ts` now uses `Math.round(deliveryFee)` (whole VND integer), matching the proposal.

---

### 7. ~~🟢~~ ✅ FIXED — Orphaned JSDoc comment in `place-order.handler.ts`

The leftover opening `/**` block from the old `assertDeliveryRadiusIfApplicable` method has been removed. Only the correct JSDoc for `assertDeliveryZoneIfApplicable` remains.

---

### 8. ~~🟢~~ ✅ FIXED — Missing `@ApiBadRequestResponse` on delivery-estimate endpoint

`zones.controller.ts` `estimateDelivery` now includes:
```typescript
@ApiBadRequestResponse({ description: 'Invalid or missing lat/lon query parameters' })
```
`ApiBadRequestResponse` also added to the Swagger import block.

---

### 9. ~~🟢~~ ✅ FIXED — `deliveryRadiusKm` in `restaurant-snapshot.schema.ts` lacks deprecation note

`restaurant-snapshot.schema.ts` `deliveryRadiusKm` column now has a full `@deprecated` JSDoc block explaining that dynamic zones replace it and that the column is no longer populated.

---

## Proposal Checklist Items NOT Yet Implemented

The following §12 items were out of scope for this implementation phase:

### Tests (all pending)
- [ ] Unit tests for `GeoService.calculateDistanceKm()` (known coordinate pairs)
- [ ] Unit tests for `ZonesService.estimateDelivery()` (happy path, outside zones, missing coords)
- [ ] E2E test for `GET /restaurants/:id/delivery-zones/delivery-estimate`
- [ ] E2E test for checkout rejection when address is outside all zones (BR-3)
- [ ] Update existing zone CRUD e2e tests to use new DTO fields

### Downstream / ACL (deferred)
- [ ] `RestaurantUpdatedEvent` / `RestaurantSnapshotProjector` — propagating zone data to ACL (optional, lower priority)
- [ ] `docs/Những yêu cầu cho các BC/restaurant-catalog.md` — remove "UPSTREAM MISSING" notes

---

## Architecture Decisions Made (or Confirmed)

| Decision | Rationale |
|---|---|
| `GeoModule` is `@Global()` | Avoids explicit import in every module that needs geo math (ZonesModule, PlaceOrderHandler's module) |
| `PlaceOrderHandler` queries `delivery_zones` directly | Pragmatic for Phase 4 — same database, avoids ACL complexity. Zone data is not yet projected into `ordering_restaurant_snapshots`. Tracked as future improvement. |
| Local `DeliveryZoneInfo` interface in `PlaceOrderHandler` | Satisfies D3-B (no cross-BC type imports) — only `radiusKm` is needed for the check |
| `@Get('delivery-estimate')` before `@Get(':id')` | NestJS registers routes in declaration order; `ParseUUIDPipe` on `:id` would 400 on the literal string "delivery-estimate" |
| `@Type(() => Number)` on `DeliveryEstimateQueryDto` | HTTP query params are always strings; class-transformer must coerce before class-validator runs numeric checks |
| `zoneFeeColumn` (not `numeric()`) for `baseFee`/`perKmRate` | Drizzle's built-in `numeric()` returns `string` from the node-postgres driver; `customType` with `fromDriver: parseFloat` ensures `DeliveryZone.baseFee` is typed and valued as `number` |
