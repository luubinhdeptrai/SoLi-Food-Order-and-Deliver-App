# Required Changes — Delivery Context

**Document Type:** Integration Contract  
**Ordering Phase Dependency:** Phase 5 (Order Lifecycle), Phase 6 (Downstream Events)  
**Status:** Required before Phase 6 is considered end-to-end complete

---

## Overview

The Ordering bounded context integrates with the Delivery context via **domain events only**.

When an order reaches `READY_FOR_PICKUP` state, the Ordering context publishes
`OrderReadyForPickupEvent`. The Delivery context consumes this to assign a shipper
and begin the delivery workflow.

---

## 1. Events the Delivery Context Must Consume

### 1.1 `OrderReadyForPickupEvent`

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

**⚠️ UPSTREAM MISSING — `restaurantAddress`:**  
The Ordering context stores `address` in `ordering_restaurant_snapshots`.  
However, this field is only populated when `RestaurantUpdatedEvent` includes it.  
The Restaurant Catalog BC must include `address` in every `RestaurantUpdatedEvent` payload.  
→ See: `docs/Những yêu cầu cho các BC/restaurant-catalog.md`

---

### 1.2 `OrderStatusChangedEvent` (secondary — for tracking)

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

The `ordering_restaurant_snapshots` table already includes the fields required
by the Delivery context:

| Field                 | Type   | Source                   | Used In                       |
|-----------------------|--------|--------------------------|-------------------------------|
| `address`             | TEXT   | restaurants.address      | `OrderReadyForPickupEvent.restaurantAddress` |
| `latitude`            | REAL   | restaurants.latitude     | BR-3 delivery radius check (Phase 4) |
| `longitude`           | REAL   | restaurants.longitude    | BR-3 delivery radius check (Phase 4) |
| `delivery_radius_km`  | REAL   | **MISSING in upstream**  | BR-3 delivery radius check (Phase 4) |

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
