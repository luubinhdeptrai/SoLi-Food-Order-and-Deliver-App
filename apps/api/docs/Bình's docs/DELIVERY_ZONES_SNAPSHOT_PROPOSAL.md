# DELIVERY_ZONES_SNAPSHOT_PROPOSAL.md

> Snapshot `delivery_zones` from `restaurant-catalog BC` into `ordering BC` via domain events.

---

## 1. Overview

### Problem

The `ordering BC` (`PlaceOrderHandler`, step 6) currently **queries `delivery_zones` directly** from
the `restaurant-catalog` Drizzle schema at checkout. This is a **hard violation of D3-B**
("Ordering BC never calls RestaurantCatalog services or tables at runtime"). If the two BCs are ever
split into separate services, step 6 breaks completely.

### Solution

Mirror the existing `MenuItemUpdatedEvent → MenuItemProjector → ordering_menu_item_snapshots`
pattern exactly:

```
ZonesService (restaurant-catalog BC)
  │  emits DeliveryZoneSnapshotUpdatedEvent on create / update / remove
  ▼
EventBus (in-process, @nestjs/cqrs)
  ▼
DeliveryZoneSnapshotProjector (ordering BC)
  │  upserts / tombstones rows
  ▼
ordering_delivery_zone_snapshots  ← new table
  ▼
DeliveryZoneSnapshotRepository (ordering BC)
  ▼
PlaceOrderHandler.step6  ← replaces direct deliveryZones query
```

---

## 2. Current System Analysis

### 2.1 Existing event + projector pattern

| Component  | MenuItems                      | Restaurants                     |
| ---------- | ------------------------------ | ------------------------------- |
| Event      | `MenuItemUpdatedEvent`         | `RestaurantUpdatedEvent`        |
| Projector  | `MenuItemProjector`            | `RestaurantSnapshotProjector`   |
| Schema     | `ordering_menu_item_snapshots` | `ordering_restaurant_snapshots` |
| Repository | `MenuItemSnapshotRepository`   | `RestaurantSnapshotRepository`  |

Both follow the same contract:

- One event class in `src/shared/events/`
- Projector in `ordering/acl/projections/` annotated with `@EventsHandler`
- Schema in `ordering/acl/schemas/` — Drizzle pgTable, no FK to upstream tables
- Repository in `ordering/acl/repositories/` — `upsert`, `findById`, `findManyByIds`
- Module wiring in `AclModule`

### 2.2 delivery_zones upstream schema

Located in `restaurant-catalog/restaurant/restaurant.schema.ts`:

```ts
export const deliveryZones = pgTable('delivery_zones', {
  id              : uuid.primaryKey(),
  restaurantId    : uuid.references(restaurants.id, onDelete:cascade),
  name            : text.notNull(),
  radiusKm        : doublePrecision.notNull(),
  baseFee         : numeric(10,2).notNull().default(0),
  perKmRate       : numeric(10,2).notNull().default(0),
  avgSpeedKmh     : real.notNull().default(30),
  prepTimeMinutes : real.notNull().default(15),
  bufferMinutes   : real.notNull().default(5),
  isActive        : boolean.notNull().default(true),
  createdAt       : timestamp,
  updatedAt       : timestamp,
});
```

### 2.3 D3-B violation in PlaceOrderHandler

```ts
// place-order.handler.ts — Step 6 (VIOLATION)
import { deliveryZones } from '@/drizzle/schema'; // ← imports restaurant-catalog table!

const activeZones = await this.db
  .select({ radiusKm: deliveryZones.radiusKm })
  .from(deliveryZones)
  .where(
    and(
      eq(deliveryZones.restaurantId, cart.restaurantId),
      eq(deliveryZones.isActive, true),
    ),
  );
```

This is the primary motivation for this proposal.

### 2.4 What ZonesService currently does NOT do

`ZonesService` (create / update / remove) does not inject `EventBus` and emits **no domain events**.
`ZonesModule` does not import `CqrsModule`.

---

## 3. Proposed Design

### 3.1 New file map

```
src/shared/events/
  delivery-zone-snapshot-updated.event.ts      ← NEW event

src/module/ordering/acl/
  schemas/
    delivery-zone-snapshot.schema.ts           ← NEW snapshot table
  repositories/
    delivery-zone-snapshot.repository.ts       ← NEW repository
  projections/
    delivery-zone-snapshot.projector.ts        ← NEW projector

src/module/restaurant-catalog/restaurant/zones/
  zones.service.ts                             ← MODIFIED (emit events)
  zones.module.ts                              ← MODIFIED (import CqrsModule)

src/module/ordering/acl/
  acl.module.ts                               ← MODIFIED (register new providers)

src/module/ordering/order/commands/
  place-order.handler.ts                      ← MODIFIED (use snapshot repo)

src/drizzle/schema.ts                         ← MODIFIED (export new snapshot)
```

---

## 4. Event Strategy

### 4.1 Decision: New dedicated event

**Choice: Create `DeliveryZoneSnapshotUpdatedEvent` (one event per zone mutation).**

**Rejected: Extend `RestaurantUpdatedEvent`.**

Justification:

- Zone CRUD is triggered independently of restaurant metadata changes. Bundling them
  would force every restaurant update to carry a full zone array — high payload overhead
  and a misleading contract.
- `MenuItemUpdatedEvent` is per-item, not per-restaurant. We follow the same granularity.
- A dedicated event is a cleaner, version-independent contract between BCs.
- Per-zone granularity makes the projector simpler (upsert one row vs. replace-all logic).

### 4.2 Event payload

```ts
export class DeliveryZoneSnapshotUpdatedEvent {
  constructor(
    public readonly zoneId: string,
    public readonly restaurantId: string,
    public readonly name: string,
    public readonly radiusKm: number,
    public readonly baseFee: number,
    public readonly perKmRate: number,
    public readonly avgSpeedKmh: number,
    public readonly prepTimeMinutes: number,
    public readonly bufferMinutes: number,
    public readonly isActive: boolean,
    /** true when the zone was hard-deleted — projector must tombstone the row */
    public readonly isDeleted: boolean,
  ) {}
}
```

### 4.3 Emission triggers

| Operation | `isDeleted` | `isActive`        |
| --------- | ----------- | ----------------- |
| `create`  | `false`     | `true` (default)  |
| `update`  | `false`     | value from DTO    |
| `remove`  | `true`      | preserved from DB |

All three operations in `ZonesService` emit the event **after** the DB write succeeds.

---

## 5. Snapshot Design

### 5.1 Table name

`ordering_delivery_zone_snapshots`

### 5.2 Schema

```
zoneId          uuid  PK          — upstream delivery_zones.id, NOT a FK
restaurantId    uuid  NOT NULL    — indexed; used for BR-3 lookup by restaurant
name            text  NOT NULL
radiusKm        float NOT NULL
baseFee         numeric(10,2) NOT NULL
perKmRate       numeric(10,2) NOT NULL
avgSpeedKmh     real  NOT NULL
prepTimeMinutes real  NOT NULL
bufferMinutes   real  NOT NULL
isActive        bool  NOT NULL
isDeleted       bool  NOT NULL DEFAULT false  — tombstone for hard-deleted zones
lastSyncedAt    timestamp NOT NULL
```

### 5.3 Relationship with restaurant snapshot

`ordering_delivery_zone_snapshots.restaurantId` is a plain UUID. It is **not a FK** to
`ordering_restaurant_snapshots` — the Ordering BC never enforces referential integrity
between its own snapshots (orphan zone rows are harmless and will be filtered by `isActive`
and `isDeleted`).

### 5.4 Indexing

```sql
-- Primary lookup: all active non-deleted zones for a restaurant (BR-3 at checkout)
CREATE INDEX ordering_delivery_zone_snapshots_restaurant_idx
  ON ordering_delivery_zone_snapshots (restaurant_id)
  WHERE is_active = true AND is_deleted = false;
```

Drizzle: set as `index` on `restaurantId` (Drizzle partial-index syntax for simple cases).

---

## 6. Projector Design

### 6.1 Idempotency

`ON CONFLICT (zone_id) DO UPDATE` — replaying the same event is safe.

### 6.2 Deletion handling

When `event.isDeleted = true`, the projector calls `repository.markDeleted(zoneId)` which
sets `isDeleted = true`, `isActive = false`, `lastSyncedAt = now`. The row is kept as a
tombstone (not physically deleted) to allow event replay without loss.

### 6.3 Out-of-order events

`lastSyncedAt` is always overwritten on upsert. Because events are emitted in-process via
`EventBus` (synchronous delivery), out-of-order events are extremely unlikely. No vector
clock is needed; this matches the existing projector strategy.

---

## 7. Data Consistency

### 7.1 Eventual consistency

The event bus is in-process and synchronous in the current monolith — events are delivered
before `ZonesService.create/update/remove` returns to the controller. The snapshot is
effectively **immediately consistent** in the monolith phase.

### 7.2 Failure handling

Projector errors are logged at ERROR level and re-thrown (matching existing projectors).
If the projector fails, the upstream DB write already succeeded. The zone exists in the
source-of-truth but not in the snapshot. Operators can re-trigger a backfill (see §8).

### 7.3 Duplicate prevention

`ON CONFLICT (zone_id) DO UPDATE` makes all writes idempotent.

---

## 8. Integration with Ordering

### 8.1 PlaceOrderHandler — step 6

Replace the direct cross-BC DB query with:

```ts
const activeZones =
  await this.deliveryZoneSnapshotRepo.findActiveByRestaurantId(
    cart.restaurantId,
  );
// Returns DeliveryZoneInfo[] (only radiusKm needed by assertDeliveryZoneIfApplicable)
```

The import of `deliveryZones` from `@/drizzle/schema` and the `DeliveryZoneInfo` interface
remain local to `place-order.handler.ts` — only the query source changes.

`DeliveryZoneSnapshotRepository` is injected into `PlaceOrderHandler` via `OrderModule` or
exported from `AclModule` (mirrors `RestaurantSnapshotRepository` pattern).

### 8.2 Validation at checkout

`assertDeliveryZoneIfApplicable` is **unchanged** — it already accepts `DeliveryZoneInfo[]`.
The snapshot repository returns the same shape.

---

## 9. Migration Plan

### 9.1 Schema migration

Run `pnpm db:push` (or Drizzle migration) after adding the new snapshot table.

### 9.2 Backfill existing data

One-time backfill: query all existing `delivery_zones` rows from the source-of-truth and
emit a `DeliveryZoneSnapshotUpdatedEvent` for each. Can be done via:

1. A NestJS CLI command, OR
2. A migration script that inserts directly into `ordering_delivery_zone_snapshots`.

The direct-insert approach is simpler and avoids event bus dependencies in a migration:

```sql
INSERT INTO ordering_delivery_zone_snapshots
  (zone_id, restaurant_id, name, radius_km, base_fee, per_km_rate,
   avg_speed_kmh, prep_time_minutes, buffer_minutes, is_active, is_deleted, last_synced_at)
SELECT
  id, restaurant_id, name, radius_km, base_fee, per_km_rate,
  avg_speed_kmh, prep_time_minutes, buffer_minutes, is_active, false, now()
FROM delivery_zones
ON CONFLICT (zone_id) DO UPDATE SET
  name = EXCLUDED.name,
  radius_km = EXCLUDED.radius_km,
  ...
  last_synced_at = now();
```

### 9.3 Zero-downtime strategy

Because `PlaceOrderHandler` falls back to allowing the order when `activeZones.length === 0`
(soft guard), deploying before the backfill is safe — checkout will skip BR-3 until zones
are populated, matching current behaviour.

---

## 10. Edge Cases

| Scenario                            | Handling                                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Restaurant deleted                  | `RestaurantUpdatedEvent` already sets `isApproved=false, isOpen=false` on delete, blocking checkout. Zone snapshots become orphans but are never queried because the restaurant snapshot blocks first. |
| Zone hard-deleted                   | `remove()` emits `isDeleted=true` → projector sets `isDeleted=true, isActive=false` → excluded from active-zone queries.                                                                               |
| All zones removed                   | `findActiveByRestaurantId` returns `[]` → `assertDeliveryZoneIfApplicable` logs a warning and skips BR-3 (same as today).                                                                              |
| No zones ever created               | Same as above — skips BR-3.                                                                                                                                                                            |
| Zone deactivated (`isActive=false`) | `update()` emits `isActive=false` → projector stores it → excluded from active-zone queries.                                                                                                           |
| Projector fails                     | Error logged + re-thrown. Snapshot row stale. Backfill restores consistency.                                                                                                                           |
| Event replayed                      | `ON CONFLICT DO UPDATE` — idempotent.                                                                                                                                                                  |
