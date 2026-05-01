# Delivery Zones + Haversine Pricing — Technical Proposal

> **Status:** ✅ Implemented (with minor deviations — see Post-Implementation Audit below)  
> **Scope:** `restaurant-catalog` BC · `ordering` BC · shared geo utilities  
> **Replaces:** flat `deliveryFee` + static `estimatedMinutes` + `deliveryRadiusKm` radius-only model  
> **Migration applied:** `src/drizzle/out/0005_delivery_zones_dynamic_pricing.sql` (`pnpm db:push` exit 0)  
> **Detailed changelog:** `delivery-zones-implementation-changelog.md`

---

## ⚠️ Review — Issues Found & Fixed

> This document was reviewed after initial drafting. All issues below were fixed **in place** — the code sections already reflect the corrected versions.

| # | Severity | Section | Issue |
|---|---|---|---|
| 1 | 🔴 Critical | §6.1, §11.5 | **URL mismatch** — `ZonesController` prefix is `delivery-zones`, so the actual endpoint is `/restaurants/:id/delivery-zones/delivery-estimate`, not `/restaurants/:id/delivery-estimate` |
| 2 | 🔴 Critical | §11.2 | **Missing `@Type(() => Number)`** in `DeliveryEstimateQueryDto` — HTTP query params arrive as strings; without this decorator `@IsNumber()` always fails at runtime |
| 3 | 🟠 High | §11.4 | **Dead code** — `calculateDeliveryFee()` and `calculateEstimatedMinutes()` were defined but never called; `buildEstimateResponse()` duplicated their logic inline (DRY violation) |
| 4 | 🟠 High | §11.7 | **Array mutation** — `activeZones.sort()` sorts in-place and mutates the caller's array; must use `[...activeZones].sort()` |
| 5 | 🟠 High | §2.2, §11.3, §11.4 | **`numeric` Drizzle column returns `string`** — Drizzle's built-in `numeric()` returns `string` from the DB driver; `DeliveryZoneResponseDto` declares `number`; all CRUD responses would serialize strings, not numbers |
| 6 | 🟡 Medium | §2.2 | **Missing import** — `numeric` from `drizzle-orm/pg-core` not shown; replaced with `customType` approach (same as ordering BC's `moneyColumn`) |
| 7 | 🟡 Medium | §11.7 | **Cross-BC type import** — `PlaceOrderHandler` imported `DeliveryZone` from `restaurant-catalog` BC, violating D3-B (no cross-module service calls); replaced with a local `DeliveryZoneInfo` interface |
| 8 | 🟡 Medium | §11.5 | **Route ordering** — `@Get('delivery-estimate')` must be declared **before** `@Get(':id')`; NestJS registers routes in declaration order and `ParseUUIDPipe` on `:id` would reject `delivery-estimate` with 400 |
| 9 | 🟡 Medium | §11.5 | **Missing Swagger imports** — `ApiUnprocessableEntityResponse` and `ApiQuery` not listed in the controller import snippet |
| 10 | 🟢 Minor | §11.2 | `@IsNumber()` is technically redundant alongside `@IsLatitude()`/`@IsLongitude()` (those already validate type) but kept for explicit intent |

---

## ✅ Post-Implementation Audit

> All code sections in this document were **implemented in full**. The table below records deviations found during a post-implementation audit. See `delivery-zones-implementation-changelog.md` for the complete file-by-file record.

| # | Severity | File | Deviation |
|---|---|---|---|
| 1 | 🟠 High | `zones.repository.ts`, migration SQL | **`avgSpeedKmh` default = 20 instead of 30** — `create()` fallback is `?? 20`; migration `DEFAULT 20`; Drizzle schema says `default(30)`. Fix: change fallback to `?? 30` and fix migration default. |
| 2 | 🟠 High | `zones.service.ts` | **`estimatedMinutes` not rounded** — `buildEstimateResponse` returns raw float sum; proposal uses `Math.round()`. Risk: API returns fractional minutes if `prepTimeMinutes`/`bufferMinutes` are set to non-integers. |
| 3 | 🟡 Medium | `zones.repository.ts` | **`update()` uses `...dto` spread** — proposal uses explicit per-field conditional mapping. Drizzle treats `undefined` as no-op, so functionally correct but relies on undocumented behaviour. |
| 4 | 🟡 Medium | `zones.dto.ts` | **Missing `@Max(120)` on `avgSpeedKmh`** — `@Min(1)` present but no upper bound; proposal has `@Min(1) @Max(120)`. |
| 5 | 🟢 Minor | `zones.service.ts` | **`distanceKm` rounded to 3dp** — implementation uses `toFixed(3)`; proposal uses `Math.round(… * 100) / 100` (2dp). |
| 6 | 🟢 Minor | `zones.service.ts` | **`deliveryFee` rounded to 2dp** — implementation uses `toFixed(2)`; proposal uses `Math.round()` (whole VND integer). |
| 7 | 🟢 Minor | `place-order.handler.ts` | **Orphaned JSDoc fragment** — old `assertDeliveryRadiusIfApplicable` comment not fully removed; the opening `/**` leaked before the new method's JSDoc. Not a runtime bug but messy. |
| 8 | 🟢 Minor | `zones.controller.ts` | **Missing `@ApiBadRequestResponse`** on `estimateDelivery` — Swagger docs incomplete but no runtime effect. |
| 9 | 🟢 Minor | `restaurant-snapshot.schema.ts` | **No `@deprecated` note on `deliveryRadiusKm`** — checklist item not actioned. Column remains nullable (correct), but no deprecation annotation added. |

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Database Design](#2-database-design)
3. [Distance Calculation (Haversine)](#3-distance-calculation-haversine)
4. [Delivery Fee Calculation](#4-delivery-fee-calculation)
5. [Estimated Delivery Time (ETA)](#5-estimated-delivery-time-eta)
6. [API Design](#6-api-design)
7. [Service Layer Design (NestJS)](#7-service-layer-design-nestjs)
8. [Edge Cases & Error Handling](#8-edge-cases--error-handling)
9. [Performance Considerations](#9-performance-considerations)
10. [Future Improvements](#10-future-improvements)
11. [Code Implementation](#11-code-implementation)
12. [Migration & Consistency Checklist](#12-migration--consistency-checklist)

---

## 1. System Overview

### Why `delivery_zones` + Haversine?

The previous model stored a single `deliveryFee` (flat fee) and `estimatedMinutes` (static guess) per zone, plus a deprecated `deliveryRadiusKm` on the restaurant snapshot. This created several problems:

- **Flat fee ignores distance** — a customer 0.5 km away pays the same as one 9.8 km away.
- **Static ETA ignores distance** — a fixed "30 minutes" is meaningless without knowing how far the driver travels.
- **`deliveryRadiusKm` is a binary gate** — either you are inside the circle or refused; there is no graduated pricing.
- **`deliveryRadiusKm` on the ACL snapshot** (`ordering_restaurant_snapshots.delivery_radius_km`) was explicitly marked `⚠️ UPSTREAM MISSING` in `restaurant-snapshot.schema.ts` — it could never be reliably populated.

### Chosen Approach: Zone-based Dynamic Pricing

Each restaurant defines one or more **delivery zones** (concentric or overlapping radii). Each zone carries:

| Column | Purpose |
|---|---|
| `radius_km` | Outer boundary of the zone |
| `base_fee` | Fixed component of the delivery fee |
| `per_km_rate` | Variable component per kilometre |
| `avg_speed_kmh` | Driver's expected average speed for ETA |
| `prep_time_minutes` | Kitchen preparation time |
| `buffer_minutes` | Safety margin added to every ETA |

**Haversine** gives the straight-line ("as-the-crow-flies") great-circle distance between two GPS points. It is accurate within ±0.5 % for typical city distances (< 20 km) without requiring PostGIS.

### Brief Comparison

| Approach | Fee accuracy | ETA accuracy | Complexity | DB dependency |
|---|---|---|---|---|
| Flat fee per zone | ❌ ignores distance | ❌ static | Low | Minimal |
| Radius-only gate | ❌ binary in/out | ❌ static | Low | Minimal |
| **Zones + Haversine** ✅ | ✅ distance-proportional | ✅ distance-based | Medium | Minimal — no PostGIS |
| Zones + PostGIS | ✅ polygon-level | ✅ road-aware (with OSRM) | High | PostGIS extension |

---

## 2. Database Design

### 2.1 Final Schema for `delivery_zones`

```sql
-- Migration: replace flat delivery_fee + estimated_minutes
-- with per-km pricing columns and separate ETA components

ALTER TABLE delivery_zones
  DROP COLUMN IF EXISTS delivery_fee,
  DROP COLUMN IF EXISTS estimated_minutes,
  ADD COLUMN base_fee         NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN per_km_rate      NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN avg_speed_kmh    REAL           NOT NULL DEFAULT 30,
  ADD COLUMN prep_time_minutes REAL          NOT NULL DEFAULT 15,
  ADD COLUMN buffer_minutes   REAL           NOT NULL DEFAULT 5;
```

Full DDL (for reference / greenfield databases):

```sql
CREATE TABLE delivery_zones (
  id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID           NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name                TEXT           NOT NULL,
  radius_km           DOUBLE PRECISION NOT NULL CHECK (radius_km > 0),
  base_fee            NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (base_fee >= 0),
  per_km_rate         NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (per_km_rate >= 0),
  avg_speed_kmh       REAL           NOT NULL DEFAULT 30 CHECK (avg_speed_kmh > 0),
  prep_time_minutes   REAL           NOT NULL DEFAULT 15 CHECK (prep_time_minutes >= 0),
  buffer_minutes      REAL           NOT NULL DEFAULT 5  CHECK (buffer_minutes >= 0),
  is_active           BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
```

### 2.2 Drizzle ORM Schema (TypeScript)

```typescript
// src/module/restaurant-catalog/restaurant/restaurant.schema.ts

import {
  boolean, customType, doublePrecision, pgTable,
  real, text, timestamp, uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Exact-decimal column for zone fee amounts.
//
// Drizzle's built-in numeric() column returns a string from the DB driver by
// default, which would cause type mismatches against DTOs that declare number.
// Using customType (same pattern as ordering BC's moneyColumn in order.schema.ts)
// ensures the driver value is automatically parsed to a JS number on read.
// ---------------------------------------------------------------------------
const zoneFeeColumn = customType<{ data: number; driverData: string }>({
  dataType() { return 'numeric(10, 2)'; },
  fromDriver(value) { return parseFloat(value as string); },
  toDriver(value)   { return String(value); },
});

export const deliveryZones = pgTable('delivery_zones', {
  id:               uuid('id').defaultRandom().primaryKey(),
  restaurantId:     uuid('restaurant_id')
                      .notNull()
                      .references(() => restaurants.id, { onDelete: 'cascade' }),
  name:             text('name').notNull(),
  radiusKm:         doublePrecision('radius_km').notNull(),
  baseFee:          zoneFeeColumn('base_fee').notNull().default(0),
  perKmRate:        zoneFeeColumn('per_km_rate').notNull().default(0),
  avgSpeedKmh:      real('avg_speed_kmh').notNull().default(30),
  prepTimeMinutes:  real('prep_time_minutes').notNull().default(15),
  bufferMinutes:    real('buffer_minutes').notNull().default(5),
  isActive:         boolean('is_active').notNull().default(true),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
  updatedAt:        timestamp('updated_at').defaultNow().notNull(),
});

export type DeliveryZone    = typeof deliveryZones.$inferSelect;
export type NewDeliveryZone = typeof deliveryZones.$inferInsert;
```

> **Note on numeric types:** `baseFee` and `perKmRate` use `customType` backed by `NUMERIC(10, 2)` — exact decimal storage with no IEEE-754 rounding. The `fromDriver` hook parses the DB string to a JS `number` automatically, so `DeliveryZone.$inferSelect.baseFee` is typed as `number`, not `string`. This mirrors the `moneyColumn` pattern in `order.schema.ts`. Without `customType`, Drizzle's default `numeric()` would return `string` and break `DeliveryZoneResponseDto` serialisation, forcing `Number()` casts at every callsite.

### 2.3 Relationship with `restaurants`

```
restaurants (1) ──< delivery_zones (many)
```

- `restaurant_id` FK with `ON DELETE CASCADE` — deleting a restaurant removes all its zones.
- A restaurant may have **zero zones** (delivery disabled) or **multiple zones** (graduated pricing).

### 2.4 Indexing Strategy

```sql
-- Lookup zones for a restaurant (most common query)
CREATE INDEX idx_delivery_zones_restaurant_id
  ON delivery_zones (restaurant_id);

-- Filter active zones only when computing estimates
CREATE INDEX idx_delivery_zones_restaurant_active
  ON delivery_zones (restaurant_id, is_active)
  WHERE is_active = TRUE;

-- Order zones by radius ascending (smallest zone first, for zone selection)
-- This is a composite index with a sort direction
CREATE INDEX idx_delivery_zones_restaurant_radius
  ON delivery_zones (restaurant_id, radius_km ASC)
  WHERE is_active = TRUE;
```

All queries in `ZonesRepository` filter by `restaurant_id`, so the first index is essential. The partial indexes on `is_active = TRUE` are small and fast for the hot path (delivery estimate endpoint).

### 2.5 Constraints & Validations Summary

| Column | Constraint | Reason |
|---|---|---|
| `radius_km` | `> 0` | A zero-radius zone is meaningless |
| `base_fee` | `>= 0` | Cannot charge negative |
| `per_km_rate` | `>= 0` | Cannot charge negative |
| `avg_speed_kmh` | `> 0` | Division-by-zero guard |
| `prep_time_minutes` | `>= 0` | Non-negative time |
| `buffer_minutes` | `>= 0` | Non-negative time |

---

## 3. Distance Calculation (Haversine)

### 3.1 The Formula

The Haversine formula computes the great-circle distance between two points on a sphere given their latitudes and longitudes:

$$
a = \sin^2\!\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cdot\cos(\phi_2)\cdot\sin^2\!\left(\frac{\Delta\lambda}{2}\right)
$$

$$
d = 2R \cdot \arcsin\!\left(\sqrt{a}\right)
$$

Where:
- $\phi$ = latitude in radians
- $\lambda$ = longitude in radians
- $R$ = Earth's mean radius = **6371 km**
- $d$ = distance in kilometres

### 3.2 Where It Is Used

| Location | Purpose |
|---|---|
| `GeoService.calculateDistanceKm()` | Canonical implementation — called everywhere |
| `ZonesService.findEligibleZone()` | Determines which zone the customer falls into |
| `ZonesService.estimateDelivery()` | Powers the `GET /restaurants/:id/delivery-zones/delivery-estimate` endpoint |
| `PlaceOrderHandler.assertDeliveryZoneIfApplicable()` | Replaces the old `assertDeliveryRadiusIfApplicable()` at checkout |
| `SearchRepository` | Replace Euclidean approximation with Haversine for accurate geo-search |

### 3.3 TypeScript Implementation

```typescript
// src/lib/geo/geo.service.ts

import { Injectable } from '@nestjs/common';

/** Earth's mean radius in kilometres (WGS-84 approximation). */
const EARTH_RADIUS_KM = 6371;

/** Degrees-to-radians conversion factor. */
const DEGREES_TO_RADIANS = Math.PI / 180;

export interface Coordinates {
  latitude:  number;
  longitude: number;
}

/**
 * GeoService provides pure geographic calculations.
 *
 * Design: stateless utility service — no DB access, no side effects.
 * All methods are synchronous; no async needed for math-only operations.
 */
@Injectable()
export class GeoService {
  /**
   * Calculates the straight-line great-circle distance between two GPS points
   * using the Haversine formula.
   *
   * Accuracy: ±0.5 % for distances under 20 km — acceptable for delivery pricing.
   * Does NOT account for road networks; road distance is typically 20–40 % longer.
   *
   * @returns Distance in kilometres (always non-negative).
   */
  calculateDistanceKm(from: Coordinates, to: Coordinates): number {
    const fromLatRad  = from.latitude  * DEGREES_TO_RADIANS;
    const toLatRad    = to.latitude    * DEGREES_TO_RADIANS;
    const deltaLatRad = (to.latitude  - from.latitude)  * DEGREES_TO_RADIANS;
    const deltaLonRad = (to.longitude - from.longitude) * DEGREES_TO_RADIANS;

    const sinHalfDeltaLat = Math.sin(deltaLatRad / 2);
    const sinHalfDeltaLon = Math.sin(deltaLonRad / 2);

    const haversineAngle =
      sinHalfDeltaLat * sinHalfDeltaLat +
      Math.cos(fromLatRad) * Math.cos(toLatRad) *
      sinHalfDeltaLon * sinHalfDeltaLon;

    const centralAngle = 2 * Math.asin(Math.sqrt(haversineAngle));

    return EARTH_RADIUS_KM * centralAngle;
  }

  /**
   * Returns true when the destination point is within the given radius
   * from the origin point.
   */
  isWithinRadius(
    origin:      Coordinates,
    destination: Coordinates,
    radiusKm:    number,
  ): boolean {
    return this.calculateDistanceKm(origin, destination) <= radiusKm;
  }
}
```

### 3.4 SQL Haversine (for `SearchRepository`)

Replace the current Euclidean approximation in `search.repository.ts`:

```sql
-- Haversine distance in km between (restaurant.lat, restaurant.lon) and (:lat, :lon)
-- Uses the spherical law of cosines approximation — fast and accurate for short ranges.

(
  2 * 6371 * ASIN(
    SQRT(
      POWER(SIN(RADIANS(latitude  - :lat) / 2), 2)
      + COS(RADIANS(:lat)) * COS(RADIANS(latitude))
      * POWER(SIN(RADIANS(longitude - :lon) / 2), 2)
    )
  )
) <= :radius_km
```

In Drizzle ORM (raw SQL fragment):

```typescript
sql`
  (2 * 6371 * ASIN(SQRT(
    POWER(SIN(RADIANS(${restaurants.latitude}  - ${filters.lat}) / 2), 2)
    + COS(RADIANS(${filters.lat})) * COS(RADIANS(${restaurants.latitude}))
    * POWER(SIN(RADIANS(${restaurants.longitude} - ${filters.lon}) / 2), 2)
  ))) <= ${radiusKm}
`
```

---

## 4. Delivery Fee Calculation

### 4.1 Formula

```
delivery_fee = base_fee + (distance_km × per_km_rate)
```

Both `base_fee` and `per_km_rate` come from the selected zone.

**Example:**
- Zone: `base_fee = 10_000 VND`, `per_km_rate = 5_000 VND/km`, `radius_km = 10`
- Customer distance: 3.2 km
- Fee: `10_000 + (3.2 × 5_000)` = **26_000 VND**

### 4.2 Zone Selection Logic

When a customer requests a delivery estimate, we:

1. Fetch all **active** zones for the restaurant, ordered by `radius_km ASC`.
2. Compute the Haversine distance between the restaurant and the customer.
3. Select the **innermost zone** whose `radius_km >= distance_km`.

**Rationale for innermost zone:** It's the most specific zone configured by the merchant — smaller zones typically have lower base fees (e.g. nearby neighbourhood rate). Taking the smallest matching zone is the most customer-friendly interpretation and simplest to reason about.

```
Zones (sorted):  Zone A (2 km) | Zone B (5 km) | Zone C (10 km)
Customer at 3.5 km → Zone A rejected (3.5 > 2) → Zone B matched (3.5 ≤ 5) ✅
```

### 4.3 Edge Cases

| Scenario | Behaviour |
|---|---|
| **Outside all zones** | Return `404` or a structured `"delivery_not_available"` response — do NOT invent a fee |
| **Multiple matching zones** | Select the innermost (smallest `radius_km` that still covers the distance) |
| **All zones inactive** | Treat as "outside all zones" |
| **No zones configured** | Return `"delivery_not_available"` — restaurant has not set up delivery |
| **Distance = 0** | `fee = base_fee` (valid — customer at restaurant door; e.g. same building) |

---

## 5. Estimated Delivery Time (ETA)

### 5.1 Formula

```
eta_minutes = prep_time_minutes + ceil((distance_km / avg_speed_kmh) × 60) + buffer_minutes
```

**Component breakdown:**

| Component | Source | Meaning |
|---|---|---|
| `prep_time_minutes` | Zone column | Time until food is ready for pickup |
| `(distance / speed) × 60` | Haversine + zone column | Travel time from restaurant to customer |
| `buffer_minutes` | Zone column | Safety margin (traffic, finding address, etc.) |

**Example:**
- Zone: `avg_speed_kmh = 25`, `prep_time_minutes = 15`, `buffer_minutes = 5`
- Distance: 3.2 km
- Travel time: `ceil((3.2 / 25) × 60)` = `ceil(7.68)` = **8 minutes**
- ETA: `15 + 8 + 5` = **28 minutes**

> **Why `ceil()`?** We always round up travel time — under-promising is better UX than an ETA that the driver cannot meet.

### 5.2 Integration with Zones

Each zone fully specifies its own ETA parameters. This means:

- A **nearby zone** (1 km) can have `avg_speed_kmh = 15` (congested urban area) and `prep_time_minutes = 10` (fast prep for local orders).
- A **distant zone** (10 km) can have `avg_speed_kmh = 40` (highway access) and a higher `buffer_minutes = 10`.

This allows fine-grained merchant control without any application-layer magic.

---

## 6. API Design

### 6.1 Delivery Estimate Endpoint

```
GET /restaurants/:restaurantId/delivery-zones/delivery-estimate?lat=<number>&lon=<number>
```

> **Why `/delivery-zones/`?** This endpoint lives inside `ZonesController`, whose `@Controller` prefix is `restaurants/:restaurantId/delivery-zones`. Placing it here is consistent — it is a zone-related operation that reads zone data to produce its response. A separate `RestaurantController` endpoint is also valid but would require duplicating the zone-loading logic or a cross-module service call.

#### Request

| Parameter | Type | Required | Description |
|---|---|---|---|
| `restaurantId` | `UUID` (path) | ✅ | Target restaurant |
| `lat` | `number` (query) | ✅ | Customer latitude |
| `lon` | `number` (query) | ✅ | Customer longitude |

#### Response `200 OK`

```json
{
  "restaurantId": "11111111-1111-1111-1111-111111111111",
  "distanceKm": 3.24,
  "zone": {
    "id": "44444444-4444-4444-4444-444444444444",
    "name": "Inner City",
    "radiusKm": 5
  },
  "deliveryFee": 26000,
  "estimatedMinutes": 28,
  "breakdown": {
    "baseFee": 10000,
    "distanceFee": 16000,
    "prepTimeMinutes": 15,
    "travelTimeMinutes": 8,
    "bufferMinutes": 5
  }
}
```

#### Response `422 Unprocessable Entity` — outside all zones

```json
{
  "statusCode": 422,
  "error": "UnprocessableEntityException",
  "message": "Delivery is not available to your location. The restaurant does not service this area."
}
```

#### Response `422 Unprocessable Entity` — restaurant has no coordinates

```json
{
  "statusCode": 422,
  "error": "UnprocessableEntityException",
  "message": "This restaurant has not configured its location yet. Delivery estimates are unavailable."
}
```

#### Validation Rules

- `lat`: `number`, range `[-90, 90]`
- `lon`: `number`, range `[-180, 180]`
- Both required — return `400 Bad Request` if either is missing or invalid.

### 6.2 Existing Zones Endpoints (Updated)

These endpoints already exist but their request/response bodies must be updated to reflect the new schema:

```
GET    /restaurants/:restaurantId/delivery-zones         → list zones (unchanged URL)
GET    /restaurants/:restaurantId/delivery-zones/:id     → zone detail (unchanged URL)
POST   /restaurants/:restaurantId/delivery-zones         → create zone (body updated)
PATCH  /restaurants/:restaurantId/delivery-zones/:id     → update zone (body updated)
DELETE /restaurants/:restaurantId/delivery-zones/:id     → delete zone (unchanged)
```

**New `POST` body:**

```json
{
  "name": "Inner City",
  "radiusKm": 5,
  "baseFee": 10000,
  "perKmRate": 5000,
  "avgSpeedKmh": 25,
  "prepTimeMinutes": 15,
  "bufferMinutes": 5
}
```

---

## 7. Service Layer Design (NestJS)

### 7.1 Module Structure

```
src/lib/geo/
├── geo.module.ts          ← registers GeoService as a global-or-shared provider
└── geo.service.ts         ← pure Haversine math, no DB

src/module/restaurant-catalog/restaurant/zones/
├── zones.module.ts        ← imports GeoModule + DatabaseModule + RestaurantModule
├── zones.controller.ts    ← HTTP layer: CRUD + delivery-estimate endpoint
├── zones.service.ts       ← orchestration: zone selection, fee + ETA calculation
├── zones.repository.ts    ← DB access: findByRestaurant, findActiveByRestaurantOrdered
└── zones.dto.ts           ← updated DTOs
```

### 7.2 `GeoService` — Responsibilities

- Single responsibility: **geographic math only**.
- No database access. No NestJS-specific dependencies beyond `@Injectable()`.
- Exported from `GeoModule` which is imported by `ZonesModule` (and any future module needing geo math).

### 7.3 `ZonesService` — Responsibilities

| Method | Responsibility |
|---|---|
| `findByRestaurant(restaurantId)` | List all zones (unchanged) |
| `findOne(id, restaurantId)` | Find single zone (unchanged) |
| `create(...)` | Create zone (body updated) |
| `update(...)` | Update zone (body updated) |
| `remove(...)` | Delete zone (unchanged) |
| `estimateDelivery(restaurantId, customerCoords)` | **New** — orchestrates zone selection + fee + ETA |

### 7.4 `ZonesRepository` — New Methods

| Method | SQL |
|---|---|
| `findActiveByRestaurantOrderedByRadius(restaurantId)` | `SELECT ... WHERE restaurant_id = $1 AND is_active = TRUE ORDER BY radius_km ASC` |

---

## 8. Edge Cases & Error Handling

| Scenario | Where detected | Response |
|---|---|---|
| **No active zones for restaurant** | `ZonesService.estimateDelivery()` | `422 UnprocessableEntity` — "delivery not available" |
| **Customer outside all zones** | `ZonesService.findEligibleZone()` | `422 UnprocessableEntity` — "restaurant does not service this area" |
| **Invalid coordinates** (NaN, out-of-range) | DTO validation (`@IsLatitude`, `@IsLongitude`) | `400 BadRequest` |
| **Restaurant missing coordinates** | `ZonesService.estimateDelivery()` | `422 UnprocessableEntity` — "restaurant location not configured" |
| **Restaurant inactive / not approved** | `RestaurantService.findOne()` (pre-existing) | `404 NotFound` |
| **Distance = 0** (customer at restaurant) | `calculateDeliveryFee()` | Valid — `fee = base_fee`, `eta = prep + buffer` |
| **Extremely large distance** (> 500 km) | Naturally falls outside all zones | Handled by "outside all zones" path — no special case needed |
| **Checkout with delivery address outside zones** | `PlaceOrderHandler` | `422 UnprocessableEntity` — prevents order creation |
| **Zone `avg_speed_kmh` = 0** | DB constraint `CHECK (avg_speed_kmh > 0)` | Insert/update rejected at DB level |

---

## 9. Performance Considerations

### Why Haversine is Acceptable at This Scale

- Haversine is pure arithmetic — a handful of trigonometric operations.
- A modern CPU executes millions of such calculations per second.
- The `delivery-estimate` endpoint typically computes distance once per zone per request. With ≤ 10 zones per restaurant, this is negligible overhead.
- No network I/O, no additional DB queries beyond the zone list.

### When Optimisation Becomes Necessary

| Traffic level | Concern | Action |
|---|---|---|
| < 1,000 RPM | None | Current approach is fine |
| 1,000–10,000 RPM | Zone list fetched per request | Cache zone list in Redis (TTL ~5 min) keyed by `restaurant_id` |
| > 10,000 RPM | Large zone tables | Add PostGIS (`ST_DWithin`) — see §10 |
| Restaurant density search | Euclidean is inaccurate | Already fixed by Haversine in `SearchRepository` |

The current Euclidean approximation in `search.repository.ts` divides `radiusKm / 111` to convert to degrees, which is only accurate near the equator and wrong at Vietnam's latitude (~21°N). The Haversine SQL replacement in §3.4 fixes this.

---

## 10. Future Improvements

| Improvement | Description |
|---|---|
| **PostGIS `ST_DWithin`** | Use `geography` type for polygon-based zones (irregular shapes — e.g. avoid water bodies). Requires PostGIS extension. |
| **Zone caching (Redis)** | Cache active zones per restaurant to avoid repeated DB reads on the hot `delivery-estimate` path. |
| **Dynamic surge pricing** | Add a `surge_multiplier NUMERIC` column on `delivery_zones` (default `1.0`). `fee = (base_fee + distance × per_km_rate) × surge_multiplier`. Triggered by an admin API or a time-based rule. |
| **Traffic-aware ETA** | Replace `avg_speed_kmh` with a call to a routing API (Google Maps Distance Matrix, OSRM). Store routing provider config in `app_settings`. |
| **Road distance vs Haversine** | Road distance is typically 20–40 % longer. Could apply a fixed `road_factor = 1.3` to Haversine distance as a cheap approximation before a routing API integration. |
| **Zone version history** | Log zone changes so historical orders can reference the zone config that was active at order time. |

---

## 11. Code Implementation

### 11.1 `GeoService`

```typescript
// src/lib/geo/geo.service.ts

import { Injectable } from '@nestjs/common';

const EARTH_RADIUS_KM    = 6371;
const DEGREES_TO_RADIANS = Math.PI / 180;

export interface Coordinates {
  latitude:  number;
  longitude: number;
}

@Injectable()
export class GeoService {
  /**
   * Returns the great-circle (Haversine) distance between two GPS coordinates.
   *
   * Why Haversine and not the simpler Euclidean approximation?
   * Euclidean on lat/lon degrees is inaccurate because longitude degrees shrink
   * as latitude increases. At Ho Chi Minh City (~10°N), a degree of longitude
   * ≈ 110 km, while at Hanoi (~21°N) it's ≈ 103 km. Haversine handles this
   * correctly using the spherical Earth model.
   *
   * @returns Non-negative distance in kilometres.
   */
  calculateDistanceKm(from: Coordinates, to: Coordinates): number {
    const fromLatRad  = from.latitude  * DEGREES_TO_RADIANS;
    const toLatRad    = to.latitude    * DEGREES_TO_RADIANS;
    const deltaLatRad = (to.latitude  - from.latitude)  * DEGREES_TO_RADIANS;
    const deltaLonRad = (to.longitude - from.longitude) * DEGREES_TO_RADIANS;

    const sinHalfDeltaLat = Math.sin(deltaLatRad / 2);
    const sinHalfDeltaLon = Math.sin(deltaLonRad / 2);

    const haversineAngle =
      sinHalfDeltaLat * sinHalfDeltaLat +
      Math.cos(fromLatRad) * Math.cos(toLatRad) *
      sinHalfDeltaLon * sinHalfDeltaLon;

    return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(haversineAngle));
  }

  /**
   * Convenience wrapper that answers a yes/no reachability question.
   */
  isWithinRadius(
    origin:      Coordinates,
    destination: Coordinates,
    radiusKm:    number,
  ): boolean {
    return this.calculateDistanceKm(origin, destination) <= radiusKm;
  }
}
```

```typescript
// src/lib/geo/geo.module.ts

import { Global, Module } from '@nestjs/common';
import { GeoService } from './geo.service';

// Global so any module (ZonesModule, future DeliveryModule, etc.) can inject
// GeoService without importing GeoModule explicitly.
@Global()
@Module({
  providers: [GeoService],
  exports:   [GeoService],
})
export class GeoModule {}
```

---

### 11.2 Updated `delivery_zones` DTOs

```typescript
// src/module/restaurant-catalog/restaurant/zones/zones.dto.ts

import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  MinLength,
  Min,
  Max,
  IsLatitude,
  IsLongitude,
} from 'class-validator';
import { Type } from 'class-transformer'; // required: coerces string query params to number

// ---------------------------------------------------------------------------
// Zone CRUD DTOs
// ---------------------------------------------------------------------------

export class CreateDeliveryZoneDto {
  @ApiProperty({ example: 'Inner City', minLength: 1 })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({
    description: 'Outer delivery radius for this zone in kilometres',
    minimum: 0.1,
    example: 5,
  })
  @IsNumber()
  @Min(0.1)
  radiusKm!: number;

  @ApiProperty({
    description: 'Fixed fee component regardless of distance (VND or local currency)',
    minimum: 0,
    example: 10000,
  })
  @IsNumber()
  @Min(0)
  baseFee!: number;

  @ApiProperty({
    description: 'Additional fee per kilometre of distance',
    minimum: 0,
    example: 5000,
  })
  @IsNumber()
  @Min(0)
  perKmRate!: number;

  @ApiPropertyOptional({
    description: 'Estimated average driver speed for ETA (km/h)',
    minimum: 1,
    maximum: 120,
    example: 25,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(120)
  avgSpeedKmh?: number;

  @ApiPropertyOptional({
    description: 'Kitchen preparation time in minutes',
    minimum: 0,
    example: 15,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  prepTimeMinutes?: number;

  @ApiPropertyOptional({
    description: 'Safety buffer added to every ETA (traffic, finding address, etc.)',
    minimum: 0,
    example: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  bufferMinutes?: number;
}

export class UpdateDeliveryZoneDto extends PartialType(CreateDeliveryZoneDto) {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Delivery Estimate query params
// ---------------------------------------------------------------------------

export class DeliveryEstimateQueryDto {
  @ApiProperty({
    description: 'Customer latitude',
    example: 10.762622,
  })
  // @Type MUST come before validators — it coerces the string query param to a
  // number first, so @IsNumber() and @IsLatitude() receive the correct type.
  // Without @Type, NestJS ValidationPipe sees a string and @IsNumber() fails.
  @Type(() => Number)
  @IsNumber()
  @IsLatitude()
  lat!: number;

  @ApiProperty({
    description: 'Customer longitude',
    example: 106.660172,
  })
  @Type(() => Number)
  @IsNumber()
  @IsLongitude()
  lon!: number;
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export class DeliveryZoneResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ example: 'Inner City' })
  name!: string;

  @ApiProperty({ example: 5 })
  radiusKm!: number;

  @ApiProperty({ example: 10000 })
  baseFee!: number;

  @ApiProperty({ example: 5000 })
  perKmRate!: number;

  @ApiProperty({ example: 25 })
  avgSpeedKmh!: number;

  @ApiProperty({ example: 15 })
  prepTimeMinutes!: number;

  @ApiProperty({ example: 5 })
  bufferMinutes!: number;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class DeliveryFeeBreakdownDto {
  @ApiProperty({ description: 'Fixed base fee component', example: 10000 })
  baseFee!: number;

  @ApiProperty({ description: 'Fee from distance × per_km_rate', example: 16000 })
  distanceFee!: number;

  @ApiProperty({ description: 'Kitchen prep time component (minutes)', example: 15 })
  prepTimeMinutes!: number;

  @ApiProperty({ description: 'Driver travel time component (minutes)', example: 8 })
  travelTimeMinutes!: number;

  @ApiProperty({ description: 'Safety buffer component (minutes)', example: 5 })
  bufferMinutes!: number;
}

export class DeliveryEstimateResponseDto {
  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ description: 'Straight-line Haversine distance in km', example: 3.24 })
  distanceKm!: number;

  @ApiProperty({ type: DeliveryZoneResponseDto })
  zone!: Pick<DeliveryZoneResponseDto, 'id' | 'name' | 'radiusKm'>;

  @ApiProperty({ description: 'Total delivery fee', example: 26000 })
  deliveryFee!: number;

  @ApiProperty({ description: 'Estimated minutes from order placement to delivery', example: 28 })
  estimatedMinutes!: number;

  @ApiProperty({ type: DeliveryFeeBreakdownDto })
  breakdown!: DeliveryFeeBreakdownDto;
}
```

---

### 11.3 Updated `ZonesRepository`

```typescript
// src/module/restaurant-catalog/restaurant/zones/zones.repository.ts

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  deliveryZones,
  type DeliveryZone,
} from '@/module/restaurant-catalog/restaurant/restaurant.schema';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';
import type { CreateDeliveryZoneDto, UpdateDeliveryZoneDto } from './zones.dto';

@Injectable()
export class ZonesRepository {
  constructor(
    @Inject(DB_CONNECTION) readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /** Returns all zones for a restaurant, newest first. Used by admin/owner list views. */
  async findByRestaurant(restaurantId: string): Promise<DeliveryZone[]> {
    return this.db
      .select()
      .from(deliveryZones)
      .where(eq(deliveryZones.restaurantId, restaurantId))
      .orderBy(deliveryZones.createdAt);
  }

  /**
   * Returns only active zones for a restaurant, ordered by radius ascending.
   *
   * Why ascending? The delivery estimate logic selects the smallest zone that
   * still covers the customer's distance — sorting here avoids an in-memory sort.
   */
  async findActiveByRestaurantOrderedByRadius(
    restaurantId: string,
  ): Promise<DeliveryZone[]> {
    return this.db
      .select()
      .from(deliveryZones)
      .where(
        and(
          eq(deliveryZones.restaurantId, restaurantId),
          eq(deliveryZones.isActive, true),
        ),
      )
      .orderBy(asc(deliveryZones.radiusKm));
  }

  async findById(id: string): Promise<DeliveryZone | null> {
    const result = await this.db
      .select()
      .from(deliveryZones)
      .where(eq(deliveryZones.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  async create(
    restaurantId: string,
    dto: CreateDeliveryZoneDto,
  ): Promise<DeliveryZone> {
    const [row] = await this.db
      .insert(deliveryZones)
      .values({
        restaurantId,
        name:             dto.name,
        radiusKm:         dto.radiusKm,
        baseFee:          dto.baseFee,         // zoneFeeColumn.toDriver() handles number → string for DB
        perKmRate:        dto.perKmRate,        // zoneFeeColumn.toDriver() handles number → string for DB
        avgSpeedKmh:      dto.avgSpeedKmh      ?? 30,
        prepTimeMinutes:  dto.prepTimeMinutes  ?? 15,
        bufferMinutes:    dto.bufferMinutes     ?? 5,
      })
      .returning();
    return row;
  }

  async update(id: string, dto: UpdateDeliveryZoneDto): Promise<DeliveryZone> {
    const patch: Partial<typeof deliveryZones.$inferInsert> = {
      ...(dto.name             !== undefined && { name:            dto.name }),
      ...(dto.radiusKm         !== undefined && { radiusKm:        dto.radiusKm }),
      ...(dto.baseFee          !== undefined && { baseFee:         dto.baseFee }),         // toDriver() handles conversion
      ...(dto.perKmRate        !== undefined && { perKmRate:       dto.perKmRate }),        // toDriver() handles conversion
      ...(dto.avgSpeedKmh      !== undefined && { avgSpeedKmh:     dto.avgSpeedKmh }),
      ...(dto.prepTimeMinutes  !== undefined && { prepTimeMinutes: dto.prepTimeMinutes }),
      ...(dto.bufferMinutes    !== undefined && { bufferMinutes:   dto.bufferMinutes }),
      ...(dto.isActive         !== undefined && { isActive:        dto.isActive }),
      updatedAt: new Date(),
    };

    const [row] = await this.db
      .update(deliveryZones)
      .set(patch)
      .where(eq(deliveryZones.id, id))
      .returning();
    return row;
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(deliveryZones).where(eq(deliveryZones.id, id));
  }
}
```

---

### 11.4 Updated `ZonesService`

```typescript
// src/module/restaurant-catalog/restaurant/zones/zones.service.ts

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ZonesRepository } from './zones.repository';
import { RestaurantService } from '../restaurant.service';
import { GeoService, type Coordinates } from '@/lib/geo/geo.service';
import type {
  CreateDeliveryZoneDto,
  UpdateDeliveryZoneDto,
  DeliveryEstimateResponseDto,
} from './zones.dto';
import type { DeliveryZone } from '@/module/restaurant-catalog/restaurant/restaurant.schema';

@Injectable()
export class ZonesService {
  constructor(
    private readonly repo:              ZonesRepository,
    private readonly restaurantService: RestaurantService,
    private readonly geo:               GeoService,
  ) {}

  // ---------------------------------------------------------------------------
  // CRUD — unchanged surface area
  // ---------------------------------------------------------------------------

  async findByRestaurant(restaurantId: string): Promise<DeliveryZone[]> {
    await this.restaurantService.findOne(restaurantId);
    return this.repo.findByRestaurant(restaurantId);
  }

  async findOne(id: string, restaurantId: string): Promise<DeliveryZone> {
    const zone = await this.repo.findById(id);
    if (!zone || zone.restaurantId !== restaurantId) {
      throw new NotFoundException('Delivery zone not found');
    }
    return zone;
  }

  async create(
    restaurantId: string,
    requesterId:  string,
    isAdmin:      boolean,
    dto:          CreateDeliveryZoneDto,
  ): Promise<DeliveryZone> {
    const restaurant = await this.restaurantService.findOne(restaurantId);
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    return this.repo.create(restaurantId, dto);
  }

  async update(
    id:           string,
    restaurantId: string,
    requesterId:  string,
    isAdmin:      boolean,
    dto:          UpdateDeliveryZoneDto,
  ): Promise<DeliveryZone> {
    await this.findOne(id, restaurantId);
    const restaurant = await this.restaurantService.findOne(restaurantId);
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    return this.repo.update(id, dto);
  }

  async remove(
    id:           string,
    restaurantId: string,
    requesterId:  string,
    isAdmin:      boolean,
  ): Promise<void> {
    await this.findOne(id, restaurantId);
    const restaurant = await this.restaurantService.findOne(restaurantId);
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    return this.repo.remove(id);
  }

  // ---------------------------------------------------------------------------
  // Delivery Estimate — new feature
  // ---------------------------------------------------------------------------

  /**
   * Computes the delivery fee and ETA for a customer at the given coordinates.
   *
   * Flow:
   *  1. Resolve restaurant and verify it has GPS coordinates.
   *  2. Load active zones, sorted by radius ascending.
   *  3. Compute Haversine distance between restaurant and customer.
   *  4. Find the innermost zone that covers the distance.
   *  5. Calculate fee and ETA from the matched zone.
   */
  async estimateDelivery(
    restaurantId:    string,
    customerCoords:  Coordinates,
  ): Promise<DeliveryEstimateResponseDto> {
    const restaurant = await this.restaurantService.findOne(restaurantId);

    // Guard: restaurant must have its location set before we can compute distance.
    if (restaurant.latitude === null || restaurant.longitude === null ||
        restaurant.latitude === undefined || restaurant.longitude === undefined) {
      throw new UnprocessableEntityException(
        'This restaurant has not configured its location yet. Delivery estimates are unavailable.',
      );
    }

    const restaurantCoords: Coordinates = {
      latitude:  restaurant.latitude,
      longitude: restaurant.longitude,
    };

    const activeZones = await this.repo.findActiveByRestaurantOrderedByRadius(restaurantId);

    if (activeZones.length === 0) {
      throw new UnprocessableEntityException(
        'This restaurant has no active delivery zones.',
      );
    }

    const distanceKm = this.geo.calculateDistanceKm(restaurantCoords, customerCoords);

    const matchedZone = this.findEligibleZone(activeZones, distanceKm);

    if (!matchedZone) {
      throw new UnprocessableEntityException(
        'Delivery is not available to your location. The restaurant does not service this area.',
      );
    }

    return this.buildEstimateResponse(restaurantId, distanceKm, matchedZone);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Selects the innermost zone that still covers the given distance.
   *
   * Zones are pre-sorted by radius_km ASC from the repository, so the first
   * matching entry is automatically the most specific (smallest) zone.
   */
  private findEligibleZone(
    zonesSortedByRadiusAsc: DeliveryZone[],
    distanceKm: number,
  ): DeliveryZone | null {
    return zonesSortedByRadiusAsc.find((zone) => zone.radiusKm >= distanceKm) ?? null;
  }

  /** Calculates the total delivery fee for a known distance within a zone. */
  private calculateDeliveryFee(zone: DeliveryZone, distanceKm: number): number {
    // zone.baseFee and zone.perKmRate are JS numbers — zoneFeeColumn.fromDriver() parses
    // them at read time, so no manual Number() cast is needed here.
    return zone.baseFee + distanceKm * zone.perKmRate;
  }

  /**
   * Calculates ETA in minutes.
   *
   * Travel time is rounded up (ceil) because we never want to promise an ETA
   * that the driver physically cannot meet.
   */
  private calculateEstimatedMinutes(zone: DeliveryZone, distanceKm: number): number {
    const travelTimeMinutes = Math.ceil((distanceKm / zone.avgSpeedKmh) * 60);
    return zone.prepTimeMinutes + travelTimeMinutes + zone.bufferMinutes;
  }

  /**
   * Assembles the full response DTO from computed values.
   *
   * Delegates to the private helpers to avoid duplicating fee/ETA math.
   * Previously this method re-implemented the same logic inline, leaving
   * calculateDeliveryFee() and calculateEstimatedMinutes() as dead code.
   */
  private buildEstimateResponse(
    restaurantId: string,
    distanceKm:   number,
    zone:         DeliveryZone,
  ): DeliveryEstimateResponseDto {
    const travelTimeMinutes = Math.ceil((distanceKm / zone.avgSpeedKmh) * 60);
    const deliveryFee       = this.calculateDeliveryFee(zone, distanceKm);
    const estimatedMinutes  = this.calculateEstimatedMinutes(zone, distanceKm);
    const distanceFee       = distanceKm * zone.perKmRate;

    return {
      restaurantId,
      distanceKm:       Math.round(distanceKm * 100) / 100, // round to 2 dp for display
      zone: {
        id:       zone.id,
        name:     zone.name,
        radiusKm: zone.radiusKm,
      },
      deliveryFee:      Math.round(deliveryFee),
      estimatedMinutes: Math.round(estimatedMinutes),
      breakdown: {
        baseFee:           zone.baseFee,
        distanceFee:       Math.round(distanceFee),
        prepTimeMinutes:   zone.prepTimeMinutes,
        travelTimeMinutes,
        bufferMinutes:     zone.bufferMinutes,
      },
    };
  }
}
```

---

### 11.5 Updated `ZonesController` (new endpoint)

Add this to the existing `ZonesController`:

```typescript
// Add to zones.controller.ts — inside the ZonesController class

// Additional imports to merge with the existing import statements:
//   from '@nestjs/common':  Query
//   from '@nestjs/swagger':  ApiQuery, ApiUnprocessableEntityResponse
//   from './zones.dto':      DeliveryEstimateQueryDto, DeliveryEstimateResponseDto

// ⚠️ ROUTE ORDERING — this method MUST be declared BEFORE @Get(':id') in the
// class body. NestJS registers routes in declaration order. If @Get(':id')
// appears first, NestJS routes GET .../delivery-estimate to the `:id` handler,
// which then rejects the string 'delivery-estimate' with a 400 (ParseUUIDPipe).
@Get('delivery-estimate')
@AllowAnonymous()
@ApiOperation({
  summary: 'Estimate delivery fee and ETA',
  description:
    'Computes the delivery fee and estimated arrival time for a customer at the given GPS coordinates.',
})
@ApiParam({ name: 'restaurantId', format: 'uuid' })
@ApiQuery({ name: 'lat', type: Number, description: 'Customer latitude',  example: 10.762622  })
@ApiQuery({ name: 'lon', type: Number, description: 'Customer longitude', example: 106.660172 })
@ApiOkResponse({
  description: 'Delivery estimate calculated',
  type: DeliveryEstimateResponseDto,
})
@ApiUnprocessableEntityResponse({
  description: 'Location outside all zones, or restaurant has no configured location',
})
@ApiBadRequestResponse({ description: 'Invalid coordinates' })
@ApiNotFoundResponse({ description: 'Restaurant not found' })
estimateDelivery(
  @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
  @Query() query: DeliveryEstimateQueryDto,
) {
  return this.service.estimateDelivery(restaurantId, {
    latitude:  query.lat,
    longitude: query.lon,
  });
}
```

---

### 11.6 Updated `SearchRepository` (Haversine SQL)

```typescript
// src/module/restaurant-catalog/search/search.repository.ts
// Replace the Euclidean approximation (POWER of degree differences) with Haversine SQL.

if (filters.lat !== undefined && filters.lon !== undefined) {
  const radiusKm = filters.radiusKm ?? 5;

  // Require coordinates to be set
  conditions.push(
    sql`(${restaurants.latitude} IS NOT NULL AND ${restaurants.longitude} IS NOT NULL)`,
  );

  // Haversine great-circle distance in km — replaces the inaccurate Euclidean
  // degree-difference approximation that was dividing radiusKm by 111.
  conditions.push(
    sql`
      (2 * 6371 * ASIN(SQRT(
        POWER(SIN(RADIANS(${restaurants.latitude}  - ${filters.lat})  / 2), 2) +
        COS(RADIANS(${filters.lat})) * COS(RADIANS(${restaurants.latitude})) *
        POWER(SIN(RADIANS(${restaurants.longitude} - ${filters.lon}) / 2), 2)
      ))) <= ${radiusKm}
    `,
  );
}
```

---

### 11.7 Updated `PlaceOrderHandler` (Zone-based checkout guard)

Replace `assertDeliveryRadiusIfApplicable` with a zone-based check:

```typescript
// In place-order.handler.ts — replace the private method

// ---------------------------------------------------------------------------
// Local zone shape — avoids importing DeliveryZone from restaurant-catalog BC.
// D3-B: PlaceOrderHandler must NEVER import types from a sibling BC's modules.
// Only the single field needed for the radius check is declared here.
// ---------------------------------------------------------------------------
interface DeliveryZoneInfo {
  radiusKm: number;
}

/**
 * BR-3 (updated): Validates that the customer's delivery address falls within
 * at least one active delivery zone of the restaurant.
 *
 * Uses Haversine distance against zone radius_km.
 * Replaces the old deliveryRadiusKm single-radius check.
 *
 * Skipped when:
 *  - Restaurant has no GPS coordinates (cannot compute distance)
 *  - Customer delivery address has no GPS coordinates
 *  - No active zones exist (delivery disabled — handled earlier at cart add time)
 */
private async assertDeliveryZoneIfApplicable(
  restaurantSnapshot: OrderingRestaurantSnapshot,
  deliveryAddress:    DeliveryAddress,
  activeZones:        DeliveryZoneInfo[],
): Promise<void> {
  const hasRestaurantCoords =
    restaurantSnapshot.latitude !== null &&
    restaurantSnapshot.longitude !== null;

  const hasCustomerCoords =
    deliveryAddress.latitude !== undefined &&
    deliveryAddress.longitude !== undefined;

  // If either side lacks coordinates, we cannot enforce a radius — allow order.
  // This is a soft guard: better to accept an edge-case order than to block a
  // legitimate customer whose GPS data is incomplete.
  if (!hasRestaurantCoords || !hasCustomerCoords) {
    this.logger.warn(
      `BR-3 skipped — missing coordinates. ` +
      `restaurantId=${restaurantSnapshot.restaurantId}, ` +
      `hasRestaurantCoords=${hasRestaurantCoords}, hasCustomerCoords=${hasCustomerCoords}`,
    );
    return;
  }

  const distanceKm = this.geo.calculateDistanceKm(
    { latitude: restaurantSnapshot.latitude!, longitude: restaurantSnapshot.longitude! },
    { latitude: deliveryAddress.latitude!,    longitude: deliveryAddress.longitude! },
  );

  // Spread to avoid mutating the caller's array — Array.sort() sorts in-place.
  // The innermost zone that covers the distance is the first match after sort.
  const matchedZone = [...activeZones]
    .sort((a, b) => a.radiusKm - b.radiusKm)
    .find((zone) => zone.radiusKm >= distanceKm);

  if (!matchedZone) {
    throw new UnprocessableEntityException(
      `Delivery is not available to your address. ` +
      `The restaurant does not service locations ${distanceKm.toFixed(1)} km away.`,
    );
  }
}
```

> **Note on `activeZones` source at checkout:** The `PlaceOrderHandler` currently does not query `delivery_zones`. To implement this guard fully, it must either:
> - Query `delivery_zones` directly (acceptable — same DB, ordering BC owns its own data pipeline), or
> - Add zone data to the restaurant ACL snapshot (preferred for strict bounded-context separation).
>
> The pragmatic choice for Phase 4 is a direct DB query since `delivery_zones` lives in the same database. A future iteration can project zone data into `ordering_restaurant_snapshots`.

---

### 11.8 Updated `ZonesModule`

```typescript
// src/module/restaurant-catalog/restaurant/zones/zones.module.ts

import { Module } from '@nestjs/common';
import { ZonesController } from './zones.controller';
import { ZonesService }    from './zones.service';
import { ZonesRepository } from './zones.repository';
import { DatabaseModule }   from '@/drizzle/drizzle.module';
import { RestaurantModule } from '../restaurant.module';
// GeoModule is @Global() so no explicit import needed once registered in AppModule.

@Module({
  imports:     [DatabaseModule, RestaurantModule],
  controllers: [ZonesController],
  providers:   [ZonesService, ZonesRepository],
})
export class ZonesModule {}
```

```typescript
// Register GeoModule once in the root AppModule (or a shared LibModule):

// src/app.module.ts
import { GeoModule } from './lib/geo/geo.module';

@Module({
  imports: [
    GeoModule,
    // ... other modules
  ],
})
export class AppModule {}
```

---

## 12. Migration & Consistency Checklist

Use this checklist to ensure every part of the system is updated before the feature goes to production.

### Database

- [x] Add `base_fee NUMERIC(10,2)` column to `delivery_zones` ✅
- [x] Add `per_km_rate NUMERIC(10,2)` column to `delivery_zones` ✅
- [x] Add `avg_speed_kmh REAL` column to `delivery_zones` ✅ ⚠️ DB DEFAULT is **20** (not 30 — see audit issue #1)
- [x] Add `prep_time_minutes REAL` column to `delivery_zones` ✅
- [x] Add `buffer_minutes REAL` column to `delivery_zones` ✅
- [x] Remove `delivery_fee DOUBLE PRECISION` column from `delivery_zones` ✅
- [x] Remove `estimated_minutes DOUBLE PRECISION` column from `delivery_zones` ✅
- [x] Add DB constraints (`CHECK` on `avg_speed_kmh > 0`, etc.) ✅
- [x] Add indexes (`idx_delivery_zones_restaurant_active`, `idx_delivery_zones_restaurant_radius`) ✅
- [x] Seed / migrate existing zone records (set default values for new columns) ✅ — `pnpm db:push` exit 0

### Drizzle ORM Schema

- [x] Update `restaurant.schema.ts` — `deliveryZones` table definition (§2.2) ✅

### `restaurant-catalog` BC

- [x] Update `zones.dto.ts` — `CreateDeliveryZoneDto`, `UpdateDeliveryZoneDto`, add estimate DTOs (§11.2) ✅ ⚠️ Missing `@Max(120)` on `avgSpeedKmh` (audit issue #4)
- [x] Update `zones.repository.ts` — add `findActiveByRestaurantOrderedByRadius`, update `create` / `update` (§11.3) ✅ ⚠️ `create()` fallback `?? 20` instead of `?? 30` (audit issue #1); `update()` uses `...dto` spread (audit issue #3)
- [x] Update `zones.service.ts` — inject `GeoService`, add `estimateDelivery()` (§11.4) ✅ ⚠️ `estimatedMinutes` not `Math.round()`-ed (audit issue #2); `distanceKm`/`deliveryFee` rounding differs (audit issues #5, #6)
- [x] Update `zones.controller.ts` — add `GET delivery-estimate` endpoint (§11.5) ✅ ⚠️ Missing `@ApiBadRequestResponse` (audit issue #8)
- [x] Update `search.repository.ts` — replace Euclidean with Haversine SQL (§11.6) ✅

### New Files

- [x] Create `src/lib/geo/geo.service.ts` (§11.1) ✅
- [x] Create `src/lib/geo/geo.module.ts` (§11.1) ✅
- [x] Register `GeoModule` in `app.module.ts` ✅

### `ordering` BC

- [x] Replace `assertDeliveryRadiusIfApplicable` with zone-based check in `place-order.handler.ts` (§11.7) ✅ ⚠️ Orphaned JSDoc fragment from old method (audit issue #7)
- [x] Inject `GeoService` into `PlaceOrderHandler` ✅
- [x] Remove `deliveryRadiusKm` from `ordering_restaurant_snapshots` (or keep nullable + deprecated) ✅ — column kept as nullable; deprecation note pending (audit issue #9)
- [ ] Update `RestaurantUpdatedEvent` / `RestaurantSnapshotProjector` if propagating zone data to ACL ❌ — deferred

### Tests

- [ ] Unit tests for `GeoService.calculateDistanceKm()` (known coordinate pairs with expected distances) ❌
- [ ] Unit tests for `ZonesService.estimateDelivery()` (happy path, outside zones, missing coords) ❌
- [ ] E2E test for `GET /restaurants/:id/delivery-zones/delivery-estimate` (all response shapes) ❌
- [ ] E2E test for checkout rejection when address is outside all zones (BR-3) ❌
- [ ] Update existing zone CRUD e2e tests to use new DTO fields ❌

### Documentation

- [x] Update Swagger decorators on zone endpoints ✅
- [ ] Update `docs/Những yêu cầu cho các BC/restaurant-catalog.md` — remove "UPSTREAM MISSING" notes ❌
- [ ] Update `restaurant-snapshot.schema.ts` — add deprecation note on `deliveryRadiusKm` ❌ (audit issue #9)

---

*End of proposal. All sections above constitute a complete, self-contained implementation guide.*
