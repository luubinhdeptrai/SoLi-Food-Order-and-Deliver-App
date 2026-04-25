# Food Delivery Platform — Modular Monolith Architecture

## Overview

- **Contexts:** 7
- **Modules:** 24
- **Roles:** Customer, Restaurant, Shipper, Admin
- **Order States:** 10

---

## Bounded Contexts

### 1. IAM (Shared Kernel)

**Purpose:** Identity, auth, roles (used by all contexts)

**Modules**

- AuthModule — JWT, OAuth, session
- UserModule — user profiles
- ApprovalModule — registration approval
- RBACModule — roles & permissions

**Entities**
User, Session, OAuthAccount, ApprovalRequest, Role, Permission

---

### 2. Restaurant & Catalog

**Purpose:** Manage supply side (restaurants, menus)

**Modules**

- RestaurantModule — profile, hours, service zone
- MenuModule — categories, items, pricing
- SearchModule — discovery (name, category, geo)

**Entities**
Restaurant, MenuCategory, MenuItem, OperatingHours, ServiceZone

---

### 3. Ordering (Core Domain)

**Purpose:** Full order lifecycle orchestration

**Modules**

- CartModule — cart (single restaurant), Redis persistence
- OrderModule — place order, address, COD
- OrderLifecycleModule — state machine
- OrderHistoryModule — query past orders

**Order State Flow**

```
PENDING → PAID → CONFIRMED → PREPARING → READY_FOR_PICKUP
→ PICKED_UP → DELIVERING → DELIVERED
→ CANCELLED / REFUNDED
```

**Entities**
Order, OrderItem, Cart, CartItem, DeliveryAddress, OrderStatusLog

---

### 4. Delivery

**Purpose:** Shipper management + dispatch

**Modules**

- ShipperModule — profile, availability
- DispatchModule — assign orders
- LocationModule — real-time GPS (Redis + WebSocket)

**Entities**
ShipperProfile, DispatchRequest, ShipperLocation, DeliveryAssignment

---

### 5. Payment

**Purpose:** Payment + commission

**Modules**

- CODModule — cash on delivery
- GatewayModule — VNPay/MoMo (future)
- RefundModule — refunds
- CommissionModule — platform fee

**Entities**
PaymentRecord, Transaction, Refund, CommissionEntry

---

### 6. Notification

**Purpose:** Push + real-time updates

**Modules**

- PushModule — APNs, FCM
- WebSocketModule — real-time events
- NotificationTemplateModule — templates

**Entities**
DeviceToken, NotificationLog, WebSocketRoom, NotificationTemplate

---

### 7. Analytics

**Purpose:** Read-side aggregation (admin only)

**Modules**

- DashboardModule — KPIs
- OrderReportModule — order stats
- FinancialReportModule — revenue, commission
- UserReportModule — registrations

**Entities**
DailyOrderSummary, RestaurantRevenueSummary, UserRegistrationReport

---

## Integration Patterns

### Domain Events (Primary)

- Ordering → Payment: `OrderPlaced`
- Ordering → Notification: `OrderStatusChanged`
- Ordering → Delivery: `OrderReadyForPickup`
- Delivery → Notification: `ShipperUpdated`
- Payment → Ordering: `PaymentConfirmed`

### Other Patterns

- **Domain Service Call**
  - Ordering → Restaurant: validate availability

- **Read-side Query**
  - Ordering → Analytics: OrderStatusLog
  - Payment → Analytics: CommissionEntry

- **Shared Kernel**
  - IAM → All: identity, roles, JWT

- **Anti-corruption Layer**
  - Snapshot MenuItem into OrderItem (price isolation)

---

## Architecture Rules (Important)

### 1. Core Domain

- Ordering owns business flow
- Other contexts must NOT control order lifecycle

### 2. Communication

- Prefer **Domain Events**
- Avoid direct cross-context calls unless necessary

### 3. Data Ownership

- Each context owns its database
- No direct DB access across contexts

### 4. Snapshot Rule

- OrderItem stores:
  - item name
  - price at order time

- Never depend on MenuService after order created

### 5. IAM Usage

- JWT resolved at API Gateway
- Contexts trust claims (no re-auth calls)

### 6. Real-time

- Redis → caching + location
- WebSocket → live updates

---

## Tech Stack (Guideline)

- Redis — cart, location
- WebSocket (Socket.io) — real-time
- REST API — sync communication
- Event Bus — async (recommended)

---

## Mental Model

- **Ordering = brain**
- **Restaurant = data source**
- **Delivery = executor**
- **Payment = validator**
- **Notification = messenger**
- **Analytics = observer**
- **IAM = identity layer**
