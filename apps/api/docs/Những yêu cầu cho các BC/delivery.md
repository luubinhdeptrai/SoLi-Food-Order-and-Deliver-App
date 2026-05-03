# Required Changes — Delivery Context

**Document Type:** Integration Contract  
**Ordering Phase Dependency:** Phase 4 (Order Placement), Phase 5 (Order Lifecycle), Phase 6 (Downstream Events)  
**Status:** Phase 4 delivery data now available in `OrderPlacedEvent` — Delivery BC integration pending

---

## Overview

The Ordering bounded context integrates with the Delivery context via **domain events only**.

Two key touchpoints:
1. **`OrderPlacedEvent`** (Phase 4) — carries pre-computed `distanceKm` and `estimatedDeliveryMinutes`
   so the Delivery BC can pre-warm shipper dispatch without redundant Haversine calculations.
2. **`OrderReadyForPickupEvent`** (Phase 5) — triggers shipper assignment.

---

## 1. Events the Delivery Context Must Consume

### 1.1 `OrderPlacedEvent` (optional — for pre-warming dispatch)

**File:** `src/shared/events/order-placed.event.ts`

**Published when:** Customer successfully places an order.

**Delivery BC can optionally consume this** to record delivery task metadata ahead of
`READY_FOR_PICKUP`, reducing latency when actual dispatch is triggered.

**Relevant fields for Delivery BC:**
```typescript
{
  orderId: string,
  restaurantId: string,
  customerId: string,
  deliveryAddress: { street, district, city, latitude?, longitude? },
  distanceKm?: number,               // [Phase 4] pre-computed Haversine distance
  estimatedDeliveryMinutes?: number, // [Phase 4] pre-computed ETA
  shippingFee: number,               // [Phase 4] delivery fee agreed at checkout
}
```

**Note:** `distanceKm` and `estimatedDeliveryMinutes` are `undefined` when either
the restaurant or delivery address is missing GPS coordinates. Delivery BC must
handle this gracefully (null-safe).

---

### 1.2 `OrderReadyForPickupEvent`

**File:** `src/shared/events/order-ready-for-pickup.event.ts`

**Published when:** Restaurant marks an order as `READY_FOR_PICKUP` (Ordering state machine).

**Consumed by:** Delivery context — dispatch a shipper.

**Required payload:**
```typescript
export class OrderReadyForPickupEvent {
  constructor(
    public readonly orderId: string,           // UUID
    public readonly restaurantId: string,      // UUID
    public readonly restaurantName: string,    // snapshot
    public readonly restaurantAddress: string, // from ordering_restaurant_snapshots.address
    public readonly customerId: string,        // UUID
    public readonly deliveryAddress: {         // from orders.delivery_address
      street: string;
      district: string;
      city: string;
      latitude?: number;
      longitude?: number;
    },
  ) {}
}
```

---

### 1.3 `OrderStatusChangedEvent` (secondary — for tracking)

**File:** `src/shared/events/order-status-changed.event.ts`

**Published on every state transition** by the Ordering context.

The Delivery context may optionally consume this to track order state changes
(e.g. to handle customer cancellations after shipper pickup).

**Relevant transitions for Delivery context:**

| Transition                       | Meaning for Delivery                              |
|----------------------------------|---------------------------------------------------|
| `READY_FOR_PICKUP → PICKED_UP`   | Shipper has collected the order                  |
| `PICKED_UP → DELIVERING`         | Shipper is en route                              |
| `DELIVERING → DELIVERED`         | Order delivered — close delivery task            |
| Any `→ CANCELLED`                | Cancel pending shipper assignment if exists      |

---

## 2. Events the Delivery Context Must Publish (Future)

These are not required for Phase 6 stubs but are needed for full Delivery integration:

| Event                     | Trigger                             | Consumed By |
|---------------------------|-------------------------------------|-------------|
| `ShipperAssignedEvent`    | Shipper accepts delivery task       | Notification (push to customer/restaurant) |
| `DeliveryLocationUpdated` | Shipper GPS update                  | Customer mobile app (real-time) |

These events are out of scope for the Ordering context — they are internal to Delivery.

---

## 3. Schema Requirements in Ordering

### 3.1 `ordering_restaurant_snapshots` — fields for Delivery context

| Field       | Type   | Source               | Used In                             |
|-------------|--------|----------------------|-------------------------------------|
| `address`   | TEXT   | restaurants.address  | `OrderReadyForPickupEvent.restaurantAddress` |
| `latitude`  | REAL   | restaurants.latitude | BR-3 Haversine + distanceKm computation |
| `longitude` | REAL   | restaurants.longitude| BR-3 Haversine + distanceKm computation |

> **Note:** `delivery_radius_km` has been removed from `ordering_restaurant_snapshots`.
> Delivery radius enforcement is now handled via `ordering_delivery_zone_snapshots` (multi-zone).

### 3.2 `orders` — fields for Delivery context

| Field                        | Type          | Purpose                                             |
|------------------------------|---------------|-----------------------------------------------------|
| `delivery_address`           | JSONB         | Delivery destination (street, district, city, lat, lon) |
| `shipping_fee`               | NUMERIC(12,2) | [Phase 4] Fee agreed at checkout — used in shipper payout |
| `estimated_delivery_minutes` | REAL          | [Phase 4] ETA computed at checkout — shown to customer |

### 3.3 `ordering_delivery_zone_snapshots` — zone data

The `ordering_delivery_zone_snapshots` table stores all zone data needed for the
Delivery BC to understand coverage areas. Fields of interest:

| Field              | Type     | Purpose                                  |
|--------------------|----------|------------------------------------------|
| `zone_id`          | UUID     | Delivery zone identifier                 |
| `restaurant_id`    | UUID     | Which restaurant this zone covers        |
| `radius_km`        | FLOAT8   | Zone coverage radius                     |
| `avg_speed_kmh`    | REAL     | Used for ETA computation                 |
| `prep_time_minutes`| REAL     | Kitchen prep time added to ETA           |
| `buffer_minutes`   | REAL     | Buffer added to ETA                      |

---

## 4. Phase Dependency

| Phase | Dependency on Delivery Context                                       |
|-------|----------------------------------------------------------------------|
| Phase 4 | `OrderPlacedEvent` now carries `distanceKm` + `estimatedDeliveryMinutes` — Delivery can consume optionally |
| Phase 5 | Ordering publishes `OrderReadyForPickupEvent` — Delivery must have a stub handler |
| Phase 6 | Full event stubs wired, Delivery stub acknowledges the event         |

All fields are nullable to remain forward-compatible until upstream provides them.

---

## 4. Missing Upstream Data

### 4.1 `restaurants.delivery_radius_km` (MISSING)

The Delivery context ultimately enforces whether delivery is possible to a given
address. However, in the current design, this check occurs at **checkout time in
the Ordering context** (BR-3).

The `ordering_restaurant_snapshots.delivery_radius_km` column is present and nullable.
It cannot be populated until the restaurant-catalog BC adds the column.

**Impact:** BR-3 (delivery radius validation) cannot be enforced until:
1. `restaurants` table gains `delivery_radius_km` column
2. `RestaurantUpdatedEvent` includes `deliveryRadiusKm` in payload
3. `RestaurantSnapshotProjector` maps it into the snapshot

→ See: `docs/Những yêu cầu cho các BC/restaurant-catalog.md`

---

## 5. Phase Dependency

| Phase | Dependency on Delivery Context                                       |
|-------|----------------------------------------------------------------------|
| Phase 5 | Ordering publishes `OrderReadyForPickupEvent` — Delivery must have a stub handler |
| Phase 6 | Full event stubs wired, Delivery stub acknowledges the event         |
