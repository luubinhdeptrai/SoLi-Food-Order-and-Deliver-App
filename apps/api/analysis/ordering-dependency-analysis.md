# Ordering BC — Dependency Analysis on RestaurantCatalog

> **Scope:** What `ordering` BC requires from `restaurant-catalog` BC
> **Reference document:** `docs/Những yêu cầu cho các BC/restaurant-catalog.md`
> **Date:** April 28, 2026
> **Based on:** Actual source code only

---

## 1. Required Events and Current Status

### 1.1 `MenuItemUpdatedEvent`

**Required by contract:** Yes — triggers `MenuItemProjector` in Ordering ACL layer

**Required payload fields:**

| Field          | Required | Provided   | Notes                                               |
| -------------- | -------- | ---------- | --------------------------------------------------- |
| `menuItemId`   | ✅       | ✅         | Published correctly                                 |
| `restaurantId` | ✅       | ✅         | Published correctly                                 |
| `name`         | ✅       | ✅         | Snapshot-frozen at checkout                         |
| `price`        | ✅       | ✅         | Published (but as float — see issue below)          |
| `status`       | ✅       | ✅         | Correct enum `available\|unavailable\|out_of_stock` |
| `isAvailable`  | Excluded | ✅ Omitted | Contract says omit; event correctly omits it        |

**Trigger coverage:**

| Trigger                        | Required                    | Status                        |
| ------------------------------ | --------------------------- | ----------------------------- |
| `MenuService.createMenuItem()` | ✅                          | ✅ Fires event                |
| `MenuService.updateMenuItem()` | ✅                          | ✅ Fires event                |
| `MenuService.toggleSoldOut()`  | ✅                          | ✅ Fires event                |
| `MenuService.deleteMenuItem()` | ✅ (`status='unavailable'`) | ✅ Fires with `'unavailable'` |

**Status: ✅ Fully compliant**

---

### 1.2 `RestaurantUpdatedEvent`

**Required by contract:** Yes — triggers `RestaurantSnapshotProjector` in Ordering ACL layer

**Required payload fields:**

| Field              | Required    | Provided               | Notes                                                  |
| ------------------ | ----------- | ---------------------- | ------------------------------------------------------ |
| `restaurantId`     | ✅          | ✅                     |                                                        |
| `name`             | ✅          | ✅                     |                                                        |
| `isOpen`           | ✅          | ✅                     |                                                        |
| `isApproved`       | ✅          | ✅                     |                                                        |
| `address`          | ✅          | ✅                     | `restaurants.address` is NOT NULL                      |
| `deliveryRadiusKm` | ⏳ Optional | ❌ Always `undefined`  | `restaurants` table has no `delivery_radius_km` column |
| `latitude`         | ⏳ Optional | ✅ Included (nullable) | `restaurants.latitude` exists                          |
| `longitude`        | ⏳ Optional | ✅ Included (nullable) | `restaurants.longitude` exists                         |

**Trigger coverage:**

| Trigger                                                         | Required          | Status                                                                           |
| --------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `RestaurantService.create()`                                    | ✅                | ✅ Fires event                                                                   |
| `RestaurantService.update()`                                    | ✅                | ✅ Fires event                                                                   |
| `RestaurantService.remove()`                                    | ✅ (invalidation) | ✅ Fires with `isOpen=false, isApproved=false`                                   |
| `RestaurantService.setApproved()` (approve/unapprove endpoints) | ✅                | ❌ **NOT firing event**                                                          |
| `RestaurantService.openRestaurant()` / `closeRestaurant()`      | ✅                | ⚠️ No dedicated toggle — isOpen changed via generic `update()` which fires event |

**Status: ⚠️ Partial — `setApproved` does not fire event**

---

## 2. Required Data / Schema Fields

### 2.1 `delivery_radius_km` — MISSING

**Contract says:** Add `delivery_radius_km` to `restaurants` table; include `deliveryRadiusKm` in `RestaurantUpdatedEvent`.

**Current state:**

- `restaurant.schema.ts` — no such column on `restaurants` table
- `RestaurantUpdatedEvent` — constructor param exists as optional but is always passed `undefined`
- `ordering_restaurant_snapshots.delivery_radius_km` — nullable column exists, always null

**Impact:** BR-3 (delivery radius check at checkout) in `PlaceOrderHandler` cannot enforce distance constraint. The handler silently skips the radius check when `deliveryRadiusKm` is null.

**Note:** `delivery_zones` table exists as a richer alternative (multi-zone per restaurant with fee + ETA). However, `RestaurantUpdatedEvent` does not carry zone data and the Ordering snapshot only has a single `deliveryRadiusKm` field. These two systems are not connected.

### 2.2 `address` field — ✅ Present

`restaurants.address` is `text NOT NULL`. `RestaurantUpdatedEvent.address` is always populated. `ordering_restaurant_snapshots.address` is `text NOT NULL`. This chain is complete.

### 2.3 `latitude` / `longitude` — ✅ Present (nullable)

Both columns exist on `restaurants` table (`doublePrecision`, nullable). Published in `RestaurantUpdatedEvent` as optional. Stored in snapshot as `real`, nullable. Haversine calculation in `PlaceOrderHandler` uses them when present.

---

## 3. CqrsModule Integration

### 3.1 `MenuModule`

**File:** `src/module/restaurant-catalog/menu/menu.module.ts`

```typescript
imports: [DatabaseModule, RestaurantModule, ModifiersModule, CqrsModule];
```

✅ `CqrsModule` imported. `EventBus` injected in `MenuService`.

### 3.2 `RestaurantModule`

**File:** `src/module/restaurant-catalog/restaurant/restaurant.module.ts`

```typescript
imports: [DatabaseModule, ZonesModule, CqrsModule];
```

✅ `CqrsModule` imported. `EventBus` injected in `RestaurantService`.

---

## 4. Integration Gaps

| Gap                                    | Severity   | Description                                                                                   | Required By                |
| -------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- | -------------------------- |
| `setApproved` missing event            | **High**   | Ordering snapshot never updates when admin approves/unapproves a restaurant                   | Phase 3 contract           |
| `delivery_radius_km` missing           | **Medium** | BR-3 checkout radius enforcement silently skipped                                             | Phase 4 — BR-3             |
| `price` as float in `menu_items`       | **Medium** | Monetary precision loss; Ordering BC snapshots use `numeric(12,2)` — mismatch at ACL boundary | Snapshot accuracy          |
| `isAvailable` not synced with `status` | **Low**    | `assertItemAvailable()` checks both; event omits `isAvailable`; snapshot only stores `status` | Consistency                |
| Modifier data not in events            | **Low**    | `MenuItemUpdatedEvent` has no modifier payload; ordering cannot snapshot modifier prices      | Future — modifier ordering |
| Delivery zones not in events           | **Low**    | `RestaurantUpdatedEvent` has no zone payload; ordering cannot check per-zone radius/fee       | Future — BR-3 variant      |

---

## 5. Contracts Required for Ordering

### 5.1 What Ordering reads from snapshot tables

| Snapshot Table                  | Key Fields Used                             | Where Used                                |
| ------------------------------- | ------------------------------------------- | ----------------------------------------- |
| `ordering_restaurant_snapshots` | `isOpen`, `isApproved`                      | `PlaceOrderHandler` step 5                |
| `ordering_restaurant_snapshots` | `deliveryRadiusKm`, `latitude`, `longitude` | `PlaceOrderHandler` step 6 (BR-3)         |
| `ordering_restaurant_snapshots` | `address`                                   | Future `OrderReadyForPickupEvent` Phase 6 |
| `ordering_menu_item_snapshots`  | `status`, `price`, `name`                   | `PlaceOrderHandler` steps 5, 7            |

### 5.2 What Ordering does NOT import

Per architecture decision D3-B:

- Does **not** import `RestaurantService`, `MenuService`
- Does **not** join `restaurants` or `menu_items` tables
- All catalog data flows only via events → snapshot projectors → local read models

---

## 6. What Needs to be Added to `restaurant-catalog`

### 6.1 Fire `RestaurantUpdatedEvent` in `setApproved` [REQUIRED]

**File:** `src/module/restaurant-catalog/restaurant/restaurant.service.ts`

```typescript
async setApproved(id: string, isApproved: boolean): Promise<Restaurant> {
  const restaurant = await this.findOne(id);
  const updated = await this.repo.update(id, { isApproved });
  this.eventBus.publish(
    new RestaurantUpdatedEvent(
      updated.id!,
      updated.name,
      updated.isOpen ?? false,
      isApproved,
      updated.address,
      undefined,
      updated.latitude ?? null,
      updated.longitude ?? null,
    ),
  );
  return updated;
}
```

### 6.2 Add `delivery_radius_km` to `restaurants` table [REQUIRED for BR-3]

**File:** `src/module/restaurant-catalog/restaurant/restaurant.schema.ts`

```typescript
import { real } from 'drizzle-orm/pg-core';

// In restaurants table:
deliveryRadiusKm: real('delivery_radius_km'), // nullable
```

**File:** `src/lib/auth.ts` — no change needed.

**File:** `src/module/restaurant-catalog/restaurant/dto/restaurant.dto.ts`

```typescript
// Add to CreateRestaurantDto + UpdateRestaurantDto:
@ApiPropertyOptional({ description: 'Maximum delivery radius in km', example: 5 })
@IsOptional()
@IsNumber()
@Min(0)
deliveryRadiusKm?: number;
```

**File:** `src/module/restaurant-catalog/restaurant/restaurant.service.ts`

```typescript
// In create() and update(), pass deliveryRadiusKm to RestaurantUpdatedEvent:
new RestaurantUpdatedEvent(
  restaurant.id!,
  restaurant.name,
  restaurant.isOpen ?? false,
  restaurant.isApproved ?? false,
  restaurant.address,
  restaurant.deliveryRadiusKm ?? null, // ← add this
  restaurant.latitude ?? null,
  restaurant.longitude ?? null,
);
```

### 6.3 Fix `menu_items.price` type [RECOMMENDED]

Change `doublePrecision` to `numeric(12,2)` to match the Ordering BC's snapshot precision:

```typescript
// menu.schema.ts
import { numeric } from 'drizzle-orm/pg-core';
price: numeric('price', { precision: 12, scale: 2 }).notNull(),
```

This eliminates precision discrepancy at the ACL boundary.

### 6.4 Deprecate / remove `isAvailable` from `menu_items` [RECOMMENDED]

The `status` enum is the single source of truth per the contract. `isAvailable` creates contradictions. Either:

- Remove the column (requires migration)
- Or generate it as a computed/virtual column: `isAvailable = (status = 'available')`

---

## 7. Summary Status Table

| Contract Item                                      | Status           | Action Needed          |
| -------------------------------------------------- | ---------------- | ---------------------- |
| `CqrsModule` in `MenuModule`                       | ✅ Done          | —                      |
| `CqrsModule` in `RestaurantModule`                 | ✅ Done          | —                      |
| `EventBus` in `MenuService`                        | ✅ Done          | —                      |
| `EventBus` in `RestaurantService`                  | ✅ Done          | —                      |
| `MenuItemUpdatedEvent` on all mutations            | ✅ Done          | —                      |
| `RestaurantUpdatedEvent` on create/update/delete   | ✅ Done          | —                      |
| `RestaurantUpdatedEvent` on approve/unapprove      | ❌ Missing       | Fix `setApproved()`    |
| `address` in `RestaurantUpdatedEvent`              | ✅ Done          | —                      |
| `latitude`/`longitude` in `RestaurantUpdatedEvent` | ✅ Done          | —                      |
| `delivery_radius_km` column on `restaurants`       | ❌ Missing       | Add column + migration |
| `deliveryRadiusKm` in `RestaurantUpdatedEvent`     | ❌ Not populated | Requires column first  |
