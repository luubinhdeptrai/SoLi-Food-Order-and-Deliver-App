# Cross-Boundary Requirements: RestaurantCatalog BC

**Document Type:** Integration Contract  
**Ordering Phase:** 3 — ACL / Snapshot Projectors  
**Status:** Required before Phase 3 begins

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

Until Phase 3, the snapshot tables are empty, so the checkout validation in Phase 4 should have a fallback that allows orders when no snapshot is found (or blocks them — TBD by team).

---

## Summary

| What to do | Where | When |
|------------|-------|------|
| Add `CqrsModule` import to `MenuModule` | `menu.module.ts` | Phase 3 |
| Inject `EventBus` in `MenuService` | `menu.service.ts` | Phase 3 |
| Publish `MenuItemUpdatedEvent` after mutations | `menu.service.ts` | Phase 3 |
| Add `CqrsModule` import to `RestaurantModule` | `restaurant.module.ts` | Phase 3 |
| Inject `EventBus` in `RestaurantService` | `restaurant.service.ts` | Phase 3 |
| Publish `RestaurantUpdatedEvent` after mutations | `restaurant.service.ts` | Phase 3 |
| Confirm `address` field on `restaurants` table | `restaurant.schema.ts` | Phase 3 |
