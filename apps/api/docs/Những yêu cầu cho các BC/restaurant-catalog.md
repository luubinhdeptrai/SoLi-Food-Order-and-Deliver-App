# Cross-Boundary Requirements: RestaurantCatalog BC

**Document Type:** Integration Contract  
**Ordering Phase:** 3 — ACL / Snapshot Projectors  
**Status:** ✅ IMPLEMENTED — Phase 3 complete

---

## Overview

The Ordering bounded context consumes data from the `RestaurantCatalog` bounded context in **read-only mode**. It does so entirely through **domain events** — never through direct service imports or shared database tables.

This document lists what `RestaurantCatalogModule` (and its sub-modules) must provide to the Ordering BC.

---

## 1. Events to Publish (REQUIRED)

### 1.1 `MenuItemUpdatedEvent` → `src/shared/events/menu-item-updated.event.ts`

**Triggers:**
- `MenuService.createMenuItem(...)` — after DB insert
- `MenuService.updateMenuItem(...)` — after DB update  
- `MenuService.toggleSoldOut(...)` — after status change
- `MenuService.deleteMenuItem(...)` — publish with `status = 'unavailable'`

**How to publish** (in `MenuService`):
```typescript
// Inject EventBus from @nestjs/cqrs
constructor(
  private readonly eventBus: EventBus,
  ...
) {}

// After mutation:
this.eventBus.publish(new MenuItemUpdatedEvent(
  item.id,
  item.restaurantId,
  item.name,
  item.price,
  item.status,   // use `status` field only — NOT `isAvailable`
));
```

> ⚠️ **Note on `isAvailable` vs `status`:** The `menu_items` table has BOTH fields.
> The Ordering context uses `status` as the single source of truth.
> Do NOT set `isAvailable` in the event payload.

**Import CqrsModule** in `MenuModule`:
```typescript
// menu.module.ts
import { CqrsModule } from '@nestjs/cqrs';

@Module({
  imports: [DatabaseModule, RestaurantModule, CqrsModule],
  ...
})
```

---

### 1.2 `RestaurantUpdatedEvent` → `src/shared/events/restaurant-updated.event.ts`

**Triggers:**
- `RestaurantService.createRestaurant(...)` — after DB insert
- `RestaurantService.updateRestaurant(...)` — after DB update
- `RestaurantService.approveRestaurant(...)` — after approval status change
- `RestaurantService.openRestaurant()` / `closeRestaurant()` — after open/closed toggle

**How to publish** (in `RestaurantService`):
```typescript
constructor(
  private readonly eventBus: EventBus,
  ...
) {}

this.eventBus.publish(new RestaurantUpdatedEvent(
  restaurant.id,
  restaurant.name,
  restaurant.isOpen,
  restaurant.isApproved,
  restaurant.address,   // full address string — used in OrderReadyForPickupEvent
));
```

**Import CqrsModule** in `RestaurantModule`:
```typescript
// restaurant.module.ts
import { CqrsModule } from '@nestjs/cqrs';

@Module({
  imports: [DatabaseModule, CqrsModule],
  providers: [RestaurantService, RestaurantRepository],
  exports: [RestaurantService],
})
```

---

## 2. Data Fields Required in Events

### For `MenuItemUpdatedEvent`

| Field | Source in DB | Notes |
|-------|-------------|-------|
| `menuItemId` | `menu_items.id` | UUID |
| `restaurantId` | `menu_items.restaurant_id` | UUID |
| `name` | `menu_items.name` | Snapshot frozen into order_items at checkout |
| `price` | `menu_items.price` | Numeric — frozen at checkout |
| `status` | `menu_items.status` | `'available' \| 'unavailable' \| 'out_of_stock'` |

### For `RestaurantUpdatedEvent`

| Field | Source in DB | Notes |
|-------|-------------|-------|
| `restaurantId` | `restaurants.id` | UUID |
| `name` | `restaurants.name` | For display in order summary |
| `isOpen` | `restaurants.is_open` | Checked at checkout time |
| `isApproved` | `restaurants.is_approved` | Checked at checkout time |
| `address` | `restaurants.address` | Stored in snapshot; used in pickup notification |

> If `address` does not yet exist on the `restaurants` table, it must be added in Phase 3 before snapshot projectors are written.

---

## 3. What RestaurantCatalog Does NOT Need to Do

- Does **not** need to know about orders
- Does **not** need to import `OrderingModule`
- Does **not** need to read from `ordering_*` tables
- Does **not** need to change any existing query/command methods except for injecting `EventBus` and calling `.publish()`

---

## 4. Validation Gates (Ordering Side)

At checkout time, the Ordering BC will:
1. Check `ordering_restaurant_snapshots.is_open = true` for the restaurant
2. Check `ordering_restaurant_snapshots.is_approved = true` for the restaurant
3. Check `ordering_menu_item_snapshots.status = 'available'` for each item in the cart

These checks read from the **Ordering BC's own snapshot tables** — NOT via `RestaurantService` or `MenuService`.

---

## 5. Timing

These changes to `RestaurantCatalogModule` are **not required for Phase 1 or Phase 2**.  
They are needed **before Phase 3 begins**, to populate snapshot tables via projectors.

Until Phase 3, the snapshot tables are empty. **Decided (Phase 2):** absent snapshot → cart `addItem` is permitted, client-supplied values are trusted (BR-PRICE-TRUST). Blocking on absent snapshot is Phase 3+ behaviour once `MenuItemProjector` is live.

---

## Summary

| What to do | Where | When | Status |
|------------|-------|------|--------|
| Add `CqrsModule` import to `MenuModule` | `menu.module.ts` | Phase 3 | ✅ Done |
| Inject `EventBus` in `MenuService` | `menu.service.ts` | Phase 3 | ✅ Done |
| Publish `MenuItemUpdatedEvent` after mutations | `menu.service.ts` | Phase 3 | ✅ Done |
| Add `CqrsModule` import to `RestaurantModule` | `restaurant.module.ts` | Phase 3 | ✅ Done |
| Inject `EventBus` in `RestaurantService` | `restaurant.service.ts` | Phase 3 | ✅ Done |
| Publish `RestaurantUpdatedEvent` after mutations | `restaurant.service.ts` | Phase 3 | ✅ Done |
| Confirm `address` field on `restaurants` table | `restaurant.schema.ts` | Phase 3 | ✅ Done |
| **Add `delivery_radius_km` column** | `restaurant.schema.ts` | Phase 4 | ⏳ Pending |
| **Include `deliveryRadiusKm` in `RestaurantUpdatedEvent`** | `restaurant.service.ts` | Phase 4 | ⏳ Pending (event field added as optional) |
| **Include `latitude`/`longitude` in `RestaurantUpdatedEvent`** | `restaurant.service.ts` | Phase 4 | ✅ Done (optional fields added) |

---

## 6. Missing Fields — Required for Phase 4 (BR-3 Delivery Radius)

> ⚠️ These fields are **not yet present** in `restaurant.schema.ts`. They are needed
> for BR-3 (delivery radius enforcement at checkout). Phase 4 is blocked until resolved.

### 6.1 `delivery_radius_km` — MISSING

**What it is:** The maximum distance (in km) from the restaurant within which the platform
accepts delivery orders.

**Where it is missing:** `restaurants` table in `restaurant.schema.ts` — no such column.

**What Ordering expects:**
```typescript
// In RestaurantUpdatedEvent payload:
deliveryRadiusKm?: number;  // nullable — restaurants may not set a radius
```

**What to add in `restaurant.schema.ts`:**
```typescript
deliveryRadiusKm: real('delivery_radius_km'),  // nullable
```

**Impact if missing:**
- `ordering_restaurant_snapshots.delivery_radius_km` will always be `null`
- BR-3 (Phase 4 checkout validation) cannot enforce the delivery area constraint
- All orders will be accepted regardless of delivery distance (silently skips radius check)

---

### 6.2 `latitude` / `longitude` in `RestaurantUpdatedEvent`

**What they are:** Geospatial coordinates of the restaurant location.

**Current status:** `restaurants.latitude` and `restaurants.longitude` **exist** in
`restaurant.schema.ts` (`real` type, nullable). However, they are NOT included in
`RestaurantUpdatedEvent` yet (event does not exist yet as of Phase 1).

**What Ordering expects in `RestaurantUpdatedEvent`:**
```typescript
latitude?: number;   // from restaurants.latitude
longitude?: number;  // from restaurants.longitude
```

**These are stored in `ordering_restaurant_snapshots` for the Haversine distance
calculation at checkout (BR-3).**

---

### 6.3 `isAvailable` field on `menu_items` — DEPRECATE

**Current status:** `menu_items` table has BOTH `status` (enum) and `is_available` (boolean).

**Required action:** The Ordering context uses `status` as the single source of truth
(per ORDERING_CONTEXT_PROPOSAL §3 decision). The `isAvailable` boolean creates ambiguity.

**Recommended:** Remove `is_available` from `menu_items` table (or keep as derived column
populated from `status === 'available'` for backward compatibility with existing API clients).

**The `MenuItemUpdatedEvent` must NOT include `isAvailable`** — only `status` enum.
