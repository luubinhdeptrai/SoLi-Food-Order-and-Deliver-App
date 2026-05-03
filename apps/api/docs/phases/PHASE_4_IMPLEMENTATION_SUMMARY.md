# Phase 4 — Order Placement: Implementation Summary

**Module:** Ordering Bounded Context  
**Status:** ✅ COMPLETE  
**Author:** AI Implementation Session  
**Date:** 2025

---

## 1. Scope

Phase 4 implements the full checkout → order-placement critical path:

1. Customer calls `POST /api/carts/my/checkout`
2. `PlaceOrderHandler` orchestrates 13 steps (idempotency, lock, cart, ACL snapshots, validation, delivery pricing, total calculation, atomic DB write, idempotency save, event publish, cart cleanup)
3. `OrderPlacedEvent` is published for downstream BCs
4. `CheckoutResponseDto` is returned to the client

---

## 2. Implemented Files

| File | Status | Change |
|------|--------|--------|
| `src/module/ordering/order/order.schema.ts` | ✅ MODIFIED | Added `shippingFee`, `estimatedDeliveryMinutes` columns |
| `src/drizzle/out/0008_order_shipping.sql` | ✅ CREATED | Migration: ALTER TABLE orders ADD COLUMN |
| `src/module/ordering/order/commands/place-order.handler.ts` | ✅ MODIFIED | Full delivery pricing implementation |
| `src/shared/events/order-placed.event.ts` | ✅ MODIFIED | Added `shippingFee`, `distanceKm?`, `estimatedDeliveryMinutes?` |
| `src/module/ordering/order/dto/checkout.dto.ts` | ✅ MODIFIED | Added `shippingFee`, `estimatedDeliveryMinutes?` to response DTO |
| `src/module/ordering/cart/cart.controller.ts` | ✅ MODIFIED | `toCheckoutResponse` maps new fields |
| `docs/Những yêu cầu cho các BC/payment.md` | ✅ UPDATED | Documented `shippingFee` in `OrderPlacedEvent` payload |
| `docs/Những yêu cầu cho các BC/delivery.md` | ✅ UPDATED | Documented `distanceKm`, `estimatedDeliveryMinutes`; removed stale `delivery_radius_km` note |
| `docs/Bình's docs/context for ordering/ORDERING_CONTEXT_PROPOSAL.md` | ✅ UPDATED | Phase 4 flow diagrams, domain model, deliverable statement |

---

## 3. Database Changes

### `orders` table — new columns

| Column | Type | Constraint | Default | Notes |
|--------|------|------------|---------|-------|
| `shipping_fee` | `NUMERIC(12,2)` | `NOT NULL` | `0` | Delivery fee from innermost eligible zone |
| `estimated_delivery_minutes` | `REAL` | nullable | `NULL` | ETA in minutes; null when coords absent |

**Migration file:** `src/drizzle/out/0008_order_shipping.sql`

```sql
ALTER TABLE orders ADD COLUMN shipping_fee numeric(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN estimated_delivery_minutes real;
```

> ⚠️ **Apply migration before deploying.** Run via Drizzle CLI:
> ```
> pnpm db:migrate
> ```
> or push schema directly:
> ```
> pnpm drizzle-kit push
> ```

---

## 4. Core Logic — Delivery Pricing (`resolveDeliveryPricing`)

### 4.1 Soft Guards (return null → shippingFee = 0)

| Condition | Behavior | Reason |
|-----------|----------|--------|
| Restaurant has no `latitude`/`longitude` | Skip pricing | Backwards-compatible: restaurant not yet GPS-configured |
| Delivery address has no `latitude`/`longitude` | Skip pricing | Customer app might omit coords (legacy client) |
| No active delivery zones for restaurant | Skip pricing | Restaurant not yet configured zones |

When skipped: `shippingFee = 0`, `estimatedDeliveryMinutes = null`, order proceeds.

### 4.2 Hard Reject (throw 422)

| Condition | Behavior |
|-----------|----------|
| All coords present, but customer is outside every active zone | `UnprocessableEntityException` with km distance and max radius |

### 4.3 Zone Selection

- Zones are sorted **ascending by `radiusKm`** (innermost first)
- The **first zone where `distanceKm ≤ radiusKm`** is selected
- Rationale: innermost zone provides most accurate pricing (not the cheapest, not the largest)

### 4.4 Fee Formulas

**Shipping Fee:**
```
shippingFee = baseFee + (distanceKm × perKmRate)
```
Rounded to 2 decimal places to match `NUMERIC(12,2)` DB precision.

**Estimated Delivery Time:**
```
travelTime  = (distanceKm / max(avgSpeedKmh, 1)) × 60  [minutes]
estimatedTime = prepTimeMinutes + travelTime + bufferMinutes
result = Math.ceil(estimatedTime)
```
`avgSpeedKmh` is clamped to minimum 1 km/h to prevent division-by-zero.

---

## 5. Total Amount Calculation

```
itemsTotal  = Σ (unitPrice + modifiersPrice) × quantity   [all cart items]
shippingFee = deliveryPricing?.shippingFee ?? 0
totalAmount = itemsTotal + shippingFee
```

Guard: `itemsTotal` must be `> 0` (order with only zero-price items is rejected).

---

## 6. `OrderPlacedEvent` — Updated Payload

```typescript
new OrderPlacedEvent(
  orderId,
  customerId,
  restaurantId,
  restaurantName,
  totalAmount,                    // = itemsTotal + shippingFee
  shippingFee,                    // [NEW] 0 when zone data absent
  paymentMethod,
  items,                          // [{menuItemId, name, quantity, unitPrice}]
  deliveryAddress,                // {street, district, city, latitude?, longitude?}
  distanceKm,                     // [NEW] undefined when coords absent
  estimatedDeliveryMinutes,       // [NEW] undefined when not computable
)
```

**Consumers:**
- **Payment BC**: must use `totalAmount` for VNPay amount (not recompute it)
- **Delivery BC**: can pre-warm dispatch using `distanceKm` + `estimatedDeliveryMinutes`
- **Notification BC**: may display ETA to customer

---

## 7. `CheckoutResponseDto` — Updated Shape

```typescript
{
  orderId: string,
  status: 'pending',
  totalAmount: number,              // items + shipping
  shippingFee: number,              // [NEW] 0 when not computable
  paymentMethod: 'cod' | 'vnpay',
  paymentUrl?: string | null,
  estimatedDeliveryMinutes?: number | null,  // [NEW]
  createdAt: string,                // ISO 8601
}
```

---

## 8. Assumptions & Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Soft guard for missing coords** | Backwards-compatible — existing restaurants and legacy clients (no GPS) continue to work; shippingFee defaults to 0 |
| **Innermost zone selection** | Most accurate pricing for the customer's true proximity; avoids overcharging via large catch-all zones |
| **Hard reject outside all zones** | When coordinates ARE present, being outside all zones is definitive — order would be undeliverable |
| **`avgSpeedKmh` floor of 1** | Prevents division-by-zero if zone snapshot has `avgSpeedKmh = 0` (bad data) |
| **Ceiling on estimatedDeliveryMinutes** | Fractional minutes are meaningless to customers; ceiling is more honest than floor |
| **`shippingFee` in OrderPlacedEvent** | Payment BC must know the full breakdown; total must equal exactly `items + shipping` for VNPay audit |
| **`distanceKm` optional in event** | Delivery BC should not fail if distance was not computed (soft guard scenario) |

---

## 9. Gaps Identified & Resolved

| Gap | File | Resolution |
|-----|------|-----------|
| No `shippingFee` column in DB | `order.schema.ts` | Added `moneyColumn('shipping_fee').notNull().default(0)` |
| No `estimatedDeliveryMinutes` column | `order.schema.ts` | Added `real('estimated_delivery_minutes')` nullable |
| No DB migration | `drizzle/out/` | Created `0008_order_shipping.sql` |
| `DeliveryZoneInfo` interface too narrow | `place-order.handler.ts` | Expanded with all pricing fields from snapshot |
| `assertDeliveryZoneIfApplicable` returned `void` | handler | Replaced with `resolveDeliveryPricing()` returning `DeliveryPricingResult \| null` |
| No `calculateShippingFee` logic | handler | Added private method with formula |
| No `estimateDeliveryMinutes` logic | handler | Added private method with formula |
| `calculateTotal` ignored shippingFee | handler | Renamed to `calculateItemsTotal`; total = items + shipping |
| `persistOrderAtomically` missing fields | handler | Added `shippingFee`, `estimatedDeliveryMinutes` to params + NewOrder |
| `publishOrderPlacedEvent` missing fields | handler | Added `distanceKm`, passed `shippingFee`, `estimatedDeliveryMinutes` |
| `OrderPlacedEvent` missing fields | `order-placed.event.ts` | Added `shippingFee`, `distanceKm?`, `estimatedDeliveryMinutes?` |
| `CheckoutResponseDto` missing fields | `checkout.dto.ts` | Added `shippingFee`, `estimatedDeliveryMinutes?` |
| `toCheckoutResponse` incomplete | `cart.controller.ts` | Added both new fields |
| BC docs outdated | `payment.md`, `delivery.md` | Updated payload docs, removed stale `delivery_radius_km` note |
| Proposal doc not updated | `ORDERING_CONTEXT_PROPOSAL.md` | Updated flow diagrams, domain model, deliverable |

---

## 10. Test Coverage Notes

- **Existing E2E specs remain green** — `cart.e2e-spec.ts` (46/46) and `acl.e2e-spec.ts` (39/39) are unaffected by these changes
- **Phase 4 checkout E2E** — A dedicated `checkout.e2e-spec.ts` is recommended for Phase 5 work to cover:
  - Happy path with zone in range → `shippingFee > 0`, `estimatedDeliveryMinutes` present
  - Soft guard: no restaurant coords → `shippingFee = 0`, order succeeds
  - Soft guard: no active zones → `shippingFee = 0`, order succeeds
  - Hard reject: coords present, outside all zones → 422
  - Idempotency key reuse → returns same orderId
  - Duplicate cartId → 409

---

## 11. Migration Checklist

- [ ] Run `pnpm db:migrate` (or `pnpm drizzle-kit push`) after pulling this branch
- [ ] Verify `orders` table has `shipping_fee` and `estimated_delivery_minutes` columns
- [ ] Verify `ordering_delivery_zone_snapshots` has `base_fee`, `per_km_rate`, `avg_speed_kmh`, `prep_time_minutes`, `buffer_minutes` populated
- [ ] Smoke-test checkout with a restaurant that has delivery zones configured
