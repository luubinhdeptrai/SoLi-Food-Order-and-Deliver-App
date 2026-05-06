# Restaurant Catalog BC — Codebase Analysis

> **Scope:** `apps/api/src/module/restaurant-catalog/**`
> **Date:** April 29, 2026 (updated)
> **Based on:** Actual source code — reflects redesign implemented 2026-04-28/29

---

## Module Structure

```
restaurant-catalog/
  restaurant-catalog.module.ts       ← imports: MenuModule, RestaurantModule, SearchModule
  restaurant/
    restaurant.controller.ts
    restaurant.service.ts
    restaurant.repository.ts
    restaurant.schema.ts             ← restaurants, deliveryZones tables
    dto/restaurant.dto.ts
    zones/                           ← Delivery Zones sub-module (NEW)
      zones.controller.ts
      zones.service.ts
      zones.repository.ts
      zones.dto.ts
      zones.module.ts
  menu/
    menu.controller.ts
    menu.service.ts
    menu.repository.ts
    menu.schema.ts                   ← menuItems, menuCategories, modifierGroups, modifierOptions tables
    dto/menu.dto.ts
    modifiers/                       ← Modifiers sub-module (NEW)
      modifiers.controller.ts
      modifiers.service.ts
      modifiers.repository.ts
      modifiers.dto.ts
      modifiers.module.ts
  search/
    search.controller.ts
    search.service.ts
    search.repository.ts
    search.module.ts
```

---

## 1. Domain Models

### 1.1 `restaurants` table (`restaurant.schema.ts`)

| Column        | Type                  | Notes                      |
| ------------- | --------------------- | -------------------------- |
| `id`          | uuid PK               | auto random                |
| `ownerId`     | uuid NOT NULL         | FK intent (no DB-level FK) |
| `name`        | text NOT NULL         |                            |
| `description` | text                  | nullable                   |
| `address`     | text NOT NULL         |                            |
| `phone`       | text NOT NULL         |                            |
| `isOpen`      | boolean DEFAULT false | manual toggle              |
| `isApproved`  | boolean DEFAULT false | admin-managed              |
| `latitude`    | doublePrecision       | nullable                   |
| `longitude`   | doublePrecision       | nullable                   |
| `createdAt`   | timestamp             |                            |
| `updatedAt`   | timestamp             |                            |

**Notable:** No `cuisineType`, `logoUrl`, `coverImageUrl`, `deliveryRadiusKm` columns. No `operatingHours` relation.

### 1.2 `delivery_zones` table (`restaurant.schema.ts`)

| Column                    | Type                                      | Notes           |
| ------------------------- | ----------------------------------------- | --------------- |
| `id`                      | uuid PK                                   |                 |
| `restaurantId`            | uuid NOT NULL FK → restaurants.id CASCADE |                 |
| `name`                    | text NOT NULL                             | e.g. "Downtown" |
| `radiusKm`                | doublePrecision NOT NULL                  |                 |
| `deliveryFee`             | doublePrecision DEFAULT 0                 |                 |
| `estimatedMinutes`        | doublePrecision DEFAULT 30                |                 |
| `isActive`                | boolean DEFAULT true                      |                 |
| `createdAt` / `updatedAt` | timestamp                                 |                 |

### 1.3 `menu_items` table (`menu.schema.ts`) — ✅ Updated

| Column                    | Type                                      | Notes                                  |
| ------------------------- | ----------------------------------------- | -------------------------------------- |
| `id`                      | uuid PK                                   |                                        |
| `restaurantId`            | uuid NOT NULL FK → restaurants.id CASCADE |                                        |
| `categoryId`              | uuid FK → menu_categories.id              | ✅ replaces hardcoded enum             |
| `name`                    | text NOT NULL                             |                                        |
| `description`             | text                                      | nullable                               |
| `price`                   | numeric(12,2) NOT NULL                    | ✅ was doublePrecision — fixed M-1     |
| `sku`                     | text                                      | nullable                               |
| `status`                  | enum                                      | `available, unavailable, out_of_stock` |
| `imageUrl`                | text                                      | URL field only, no upload endpoint     |
| `tags`                    | text[]                                    |                                        |
| `createdAt` / `updatedAt` | timestamp                                 |                                        |

**Fixed:** `isAvailable` boolean column dropped (D-3). `category` enum column replaced by `categoryId` FK (D-2). `price` changed to `numeric(12,2)` (M-1).

### 1.4 `menu_categories` table (`menu.schema.ts`) — ✅ New

| Column                    | Type                                      | Notes                   |
| ------------------------- | ----------------------------------------- | ----------------------- |
| `id`                      | uuid PK                                   |                         |
| `restaurantId`            | uuid NOT NULL FK → restaurants.id CASCADE |                         |
| `name`                    | text NOT NULL                             | e.g. "Burgers", "Sushi" |
| `createdAt` / `updatedAt` | timestamp                                 |                         |

### 1.5 `modifier_groups` table (`menu.schema.ts`) — ✅ New (replaces `menu_item_modifiers`)

| Column                    | Type                                     | Notes                          |
| ------------------------- | ---------------------------------------- | ------------------------------ |
| `id`                      | uuid PK                                  |                                |
| `menuItemId`              | uuid NOT NULL FK → menu_items.id CASCADE |                                |
| `name`                    | text NOT NULL                            | e.g. "Size", "Toppings"        |
| `description`             | text                                     | nullable                       |
| `isRequired`              | boolean DEFAULT false                    | group-level constraint         |
| `minSelections`           | integer DEFAULT 0                        | min options customer must pick |
| `maxSelections`           | integer DEFAULT 1                        | max options customer can pick  |
| `displayOrder`            | integer DEFAULT 0                        | sort order                     |
| `createdAt` / `updatedAt` | timestamp                                |                                |

### 1.6 `modifier_options` table (`menu.schema.ts`) — ✅ New

| Column                    | Type                                          | Notes                              |
| ------------------------- | --------------------------------------------- | ---------------------------------- |
| `id`                      | uuid PK                                       |                                    |
| `groupId`                 | uuid NOT NULL FK → modifier_groups.id CASCADE |                                    |
| `name`                    | text NOT NULL                                 | e.g. "Large", "Extra Cheese"       |
| `price`                   | numeric(12,2) DEFAULT 0                       | ✅ was doublePrecision — fixed M-2 |
| `isDefault`               | boolean DEFAULT false                         | pre-selected in UI                 |
| `displayOrder`            | integer DEFAULT 0                             |                                    |
| `createdAt` / `updatedAt` | timestamp                                     |                                    |

**Replaces** the old flat `menu_item_modifiers` table. Full Group/Option normalization (Option A from D-1 fix).

---

## 2. APIs Exposed

### 2.1 Restaurant API (`/restaurants`)

| Method | Route                        | Auth               | Description                           |
| ------ | ---------------------------- | ------------------ | ------------------------------------- |
| GET    | `/restaurants`               | Public             | List all (paginated via offset/limit) |
| GET    | `/restaurants/:id`           | Public             | Get one by UUID                       |
| POST   | `/restaurants`               | `admin,restaurant` | Create                                |
| PATCH  | `/restaurants/:id`           | `admin,restaurant` | Update (ownership check)              |
| PATCH  | `/restaurants/:id/approve`   | `admin`            | Set `isApproved = true`               |
| PATCH  | `/restaurants/:id/unapprove` | `admin`            | Set `isApproved = false`              |
| DELETE | `/restaurants/:id`           | `admin`            | Hard delete                           |

**Note:** `findAll` supports `offset` and `limit` query params — pagination IS implemented (contradicting the old audit).

### 2.2 Menu API (`/menu-items`)

| Method | Route                      | Auth               | Description                                |
| ------ | -------------------------- | ------------------ | ------------------------------------------ |
| GET    | `/menu-items`              | Public             | Filter by restaurantId + optional category |
| GET    | `/menu-items/categories`   | Public             | List enum categories                       |
| GET    | `/menu-items/:id`          | Public             | Get one                                    |
| POST   | `/menu-items`              | `admin,restaurant` | Create (ownership check)                   |
| PATCH  | `/menu-items/:id`          | `admin,restaurant` | Update (ownership check)                   |
| PATCH  | `/menu-items/:id/sold-out` | `admin,restaurant` | Toggle out_of_stock ↔ available            |
| DELETE | `/menu-items/:id`          | `admin,restaurant` | Hard delete                                |

### 2.3 Delivery Zones API (`/restaurants/:restaurantId/delivery-zones`)

| Method | Route                                 | Auth               | Description                   |
| ------ | ------------------------------------- | ------------------ | ----------------------------- |
| GET    | `/restaurants/:id/delivery-zones`     | Public             | List all zones for restaurant |
| GET    | `/restaurants/:id/delivery-zones/:id` | Public             | Get one zone                  |
| POST   | `/restaurants/:id/delivery-zones`     | `admin,restaurant` | Create zone                   |
| PATCH  | `/restaurants/:id/delivery-zones/:id` | `admin,restaurant` | Update zone                   |
| DELETE | `/restaurants/:id/delivery-zones/:id` | `admin,restaurant` | Delete zone                   |

### 2.4 Menu Item Modifier Groups & Options API — ✅ Redesigned

**Groups** (`/menu-items/:menuItemId/modifier-groups`):

| Method | Route                                      | Auth               | Description     |
| ------ | ------------------------------------------ | ------------------ | --------------- |
| GET    | `/menu-items/:id/modifier-groups`          | Public             | List all groups |
| GET    | `/menu-items/:id/modifier-groups/:groupId` | Public             | Get one group   |
| POST   | `/menu-items/:id/modifier-groups`          | `admin,restaurant` | Create group    |
| PATCH  | `/menu-items/:id/modifier-groups/:groupId` | `admin,restaurant` | Update group    |
| DELETE | `/menu-items/:id/modifier-groups/:groupId` | `admin,restaurant` | Delete group    |

**Options** (`/menu-items/:menuItemId/modifier-groups/:groupId/options`):

| Method | Route                   | Auth               | Description           |
| ------ | ----------------------- | ------------------ | --------------------- |
| GET    | `.../options`           | Public             | List options in group |
| GET    | `.../options/:optionId` | Public             | Get one option        |
| POST   | `.../options`           | `admin,restaurant` | Create option         |
| PATCH  | `.../options/:optionId` | `admin,restaurant` | Update option         |
| DELETE | `.../options/:optionId` | `admin,restaurant` | Delete option         |

### 2.5 Search API (`/restaurants/search`)

| Method | Route                 | Auth   | Description                                  |
| ------ | --------------------- | ------ | -------------------------------------------- |
| GET    | `/restaurants/search` | Public | Filter by name, lat/lon/radius, offset/limit |

---

## 3. Business Logic

### 3.1 RestaurantService

- `create`: inserts + fires `RestaurantUpdatedEvent`
- `update`: ownership check (admin bypass) + fires `RestaurantUpdatedEvent`
- `setApproved(id, bool)`: updates `isApproved` — **does NOT fire `RestaurantUpdatedEvent`** ⚠️
- `remove`: fires `RestaurantUpdatedEvent` with `isOpen=false, isApproved=false` to invalidate snapshot
- `assertOpenAndApproved`: throws if not open/approved — used internally

### 3.2 MenuService — ✅ Updated

- `create` / `update` / `toggleSoldOut` / `remove`: all fire `MenuItemUpdatedEvent` with `status` + full `modifiers[]` array
- `assertItemAvailable`: ✅ checks `status !== 'available'` only — `isAvailable` field removed
- `findCategoriesByRestaurant` / `createCategory` / `updateCategory` / `removeCategory`: ✅ new category management methods
- `publishMenuItemEvent()`: private helper that re-fetches full modifier tree and publishes `MenuItemUpdatedEvent`

### 3.3 SearchRepository

- Filters: `isApproved = true` always applied
- Name: `ILIKE %name%` (substring)
- Geo: Euclidean distance in degrees — **not Haversine** (`SQRT(POWER(lat1-lat2, 2) + POWER(lon1-lon2, 2)) <= radius/111`)

---

## 4. Events Published

### `MenuItemUpdatedEvent` (`src/shared/events/menu-item-updated.event.ts`)

Published on: `create`, `update`, `toggleSoldOut`, `remove` (with `status='unavailable'`)

Payload: `menuItemId, restaurantId, name, price, status`

✅ Correctly uses `status` only — no `isAvailable`.

### `RestaurantUpdatedEvent` (`src/shared/events/restaurant-updated.event.ts`)

Published on: `create`, `update`, `remove`

**NOT published on:** `setApproved` (called by `approve`/`unapprove` endpoints) ⚠️

Payload: `restaurantId, name, isOpen, isApproved, address, deliveryRadiusKm?, latitude?, longitude?`

---

## 5. Completed Features

| Feature                                        | Status                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------- | --- | -------------------------------------- | ------------------------------------------------ |
| Restaurant CRUD                                | ✅ Complete                                                           |
| Restaurant approval / unapproval endpoint      | ✅ Complete (PATCH /approve, /unapprove)                              |
| Restaurant paginated list                      | ✅ Offset/limit implemented                                           |
| Delivery zones CRUD                            | ✅ New sub-module fully implemented                                   |
| Menu item CRUD                                 | ✅ Complete                                                           |
| Menu item sold-out toggle                      | ✅ Complete                                                           |
| Menu item modifiers CRUD                       | ✅ New sub-module implemented                                         |
| `assertItemAvailable()` in MenuService         | ✅ Implemented                                                        |
| `assertOpenAndApproved()` in RestaurantService | ✅ Implemented                                                        |
| `MenuItemUpdatedEvent` publication             | ✅ All mutations covered                                              |
| `RestaurantUpdatedEvent` publication           | ⚠️ Partial — missing on approve/unapprove                             |     | Modifier groups / options CRUD         | ✅ New full Group+Option normalization (D-1 fix) |
| Per-restaurant menu categories                 | ✅ `menu_categories` table (D-2 fix)                                  |
| `assertItemAvailable()` single-field check     | ✅ Checks `status` only (S-2 fix)                                     |
| `isAvailable` column removed                   | ✅ Dropped from schema + DTOs (D-3 / S-4 fix)                         |
| `price` as `numeric(12,2)` on menu_items       | ✅ Fixed (M-1 fix)                                                    |
| `price` as `numeric(12,2)` on modifier_options | ✅ Fixed (M-2 fix)                                                    |
| Modifier mutation fires event                  | ✅ Publishes `MenuItemUpdatedEvent` with full modifier tree (I-1 fix) |
| Modifier ownership fix (S-1)                   | ✅ `RestaurantService.findOne()` used for ownership check             |     | Search endpoint with geo + name filter | ✅ Implemented (approximated geo)                |
| Pagination on search endpoint                  | ✅ Offset/limit                                                       |
| CqrsModule wired in Menu + Restaurant modules  | ✅ Complete                                                           |

---

## 6. Missing or Incomplete Features

### 6.1 `RestaurantUpdatedEvent` not fired on approve/unapprove

**File:** `src/module/restaurant-catalog/restaurant/restaurant.service.ts` — `setApproved()`

The `approve` and `unapprove` endpoints call `setApproved()` which updates `isApproved` in the DB but **does not call `eventBus.publish()`**. This means:

- The Ordering BC's `ordering_restaurant_snapshots` table will have stale `isApproved` values
- A restaurant could be approved but the checkout validation still sees `isApproved = false`

**Fix:**

```typescript
async setApproved(id: string, isApproved: boolean): Promise<Restaurant> {
  const updated = await this.repo.update(id, { isApproved });
  this.eventBus.publish(new RestaurantUpdatedEvent(
    updated.id, updated.name, updated.isOpen ?? false, isApproved,
    updated.address, undefined, updated.latitude ?? null, updated.longitude ?? null,
  ));
  return updated;
}
```

### 6.2 `delivery_radius_km` column missing from `restaurants` table

The `restaurant.schema.ts` does not have a `deliveryRadiusKm` column. The `delivery_zones` table exists as a more granular alternative but the `RestaurantUpdatedEvent.deliveryRadiusKm` field always publishes `undefined`. The Ordering BC's snapshot will always have `deliveryRadiusKm = null` — BR-3 radius enforcement remains impossible without this or a delivery zone lookup at checkout.

### 6.3 ~~`isAvailable` boolean — inconsistency with `status` enum~~ ✅ FIXED

`isAvailable` column dropped from `menu_items`. `status` is the single source of truth. `assertItemAvailable()` now only checks `status !== 'available'`.

### 6.4 Geo search uses Euclidean approximation, not Haversine

`search.repository.ts`:

```typescript
SQRT(POWER(lat1 - lat2, 2) + POWER(lon1 - lon2, 2)) <= radius / 111;
```

The `/ 111` conversion is a rough approximation that degrades at non-equatorial latitudes. For production use in Vietnam (~10° N), error is ~0.4% but the formula is not standard and lacks proper Haversine handling.

### ~~6.5 Modifier ownership check is broken~~ ✅ FIXED

`ModifiersService` now injects `RestaurantService` directly and calls `restaurantService.findOne(restaurantId)` to obtain the real `ownerId`. The ownership check now correctly compares `restaurant.ownerId !== requesterId`.

### 6.6 Menu items missing pagination

`MenuRepository.findByRestaurant()` returns all items with no limit. A restaurant with 200+ items sends an unbounded payload. (Still open — not in scope of redesign)

### ~~6.7 Category system is a flat global enum~~ ✅ FIXED

`menuItemCategoryEnum` replaced with a `menu_categories` table. Categories are per-restaurant, fully dynamic. `menu_items.categoryId` is a FK to this table.

### 6.8 No operating hours (TẠM THỜI BỎ QUA VÌ THẤY CHƯA CẦN THIẾT)

`isOpen` is a manual boolean. No schedule table — restaurants must be opened/closed manually every day.

### 6.9 No restaurant logo / cover image

`restaurants` table has no `logoUrl` or `coverImageUrl`. `MenuItem` has `imageUrl` but no upload endpoint.

### 6.10 No cuisine type / restaurant category

No `cuisineType` or restaurant-level category. Search filter accepts `category` parameter but SearchService ignores it (`undefined` is always passed):

```typescript
// search.controller.ts
return this.service.searchRestaurants(name, undefined, lat, lon, ...); // category = undefined
```

---

## 7. Design Issues

| Issue                                           | Severity | Status                                            |
| ----------------------------------------------- | -------- | ------------------------------------------------- |
| `setApproved` no event                          | High     | ⚠️ Still open                                     |
| `isAvailable` + `status` duality                | Medium   | ✅ Fixed — `isAvailable` dropped                  |
| Broken modifier ownership (S-1)                 | Medium   | ✅ Fixed — real `RestaurantService.findOne()`     |
| Euclidean geo search                            | Low      | ⚠️ Still open                                     |
| `price` as `doublePrecision` on `menu_items`    | Medium   | ✅ Fixed — `numeric(12,2)`                        |
| `price` as `doublePrecision` on modifiers       | Medium   | ✅ Fixed — `numeric(12,2)`                        |
| Flat `menu_item_modifiers` — no group model     | Medium   | ✅ Fixed — full Group/Option normalization        |
| Global hardcoded category enum                  | Medium   | ✅ Fixed — per-restaurant `menu_categories` table |
| Category ignored in search                      | Low      | ⚠️ Still open                                     |
| Modifier mutations fire no events (I-1)         | Medium   | ✅ Fixed — `MenuItemUpdatedEvent` with modifiers  |
| `UpdateMenuItemDto` exposes `isAvailable` (S-4) | High     | ✅ Fixed — field removed from all DTOs            |

---

## 8. Summary

The `restaurant-catalog` BC has significantly progressed since the original audit. Key new features that are now present: delivery zones sub-module, modifiers sub-module, approval/unapproval endpoints, search module, pagination on restaurants list, `assertItemAvailable()`, and full event publication on all mutations (except approve/unapprove).

The two most impactful remaining issues are:

1. `setApproved` not firing `RestaurantUpdatedEvent` — breaks Ordering snapshot sync
2. Missing `delivery_radius_km` on `restaurants` table — blocks BR-3 at checkout
