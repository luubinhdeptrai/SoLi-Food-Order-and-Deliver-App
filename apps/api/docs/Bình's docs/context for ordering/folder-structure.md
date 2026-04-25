Reference Folder Structure for Modular Monolith Architecture

src/
├── main.ts
├── app.module.ts # imports all _context modules only_

├── common/
├── config/
├── infrastructure/

# ========================

# IAM (Shared Kernel)

# ========================

├── iam/
│ ├── auth/
│ ├── user/
│ ├── approval/
│ ├── rbac/
│ └── iam.module.ts # ✅ context module

# ========================

# RESTAURANT & CATALOG

# ========================

├── restaurant-catalog/
│ ├── restaurant/
│ │ ├── application/
│ │ ├── domain/
│ │ ├── infrastructure/
│ │ └── restaurant.module.ts
│
│ ├── menu/
│ │ ├── application/
│ │ ├── domain/
│ │ ├── infrastructure/
│ │ └── menu.module.ts
│
│ ├── search/
│ │ ├── application/
│ │ ├── infrastructure/
│ │ └── search.module.ts
│
│ └── restaurant-catalog.module.ts # ✅ context module

# ========================

# ORDERING (CORE)

# ========================

├── ordering/
│ ├── cart/
│ │ └── cart.module.ts
│
│ ├── order/
│ │ └── order.module.ts
│
│ ├── order-lifecycle/
│ │ └── order-lifecycle.module.ts
│
│ ├── order-history/
│ │ └── order-history.module.ts
│
│ ├── events/
│ ├── acl/
│
│ └── ordering.module.ts # ✅ context module

# ========================

# DELIVERY

# ========================

├── delivery/
│ ├── shipper/
│ │ └── shipper.module.ts
│
│ ├── dispatch/
│ │ └── dispatch.module.ts
│
│ ├── location/
│ │ └── location.module.ts
│
│ └── delivery.module.ts # ✅ context module

# ========================

# PAYMENT

# ========================

├── payment/
│ ├── cod/
│ │ └── cod.module.ts
│
│ ├── gateway/
│ │ └── gateway.module.ts
│
│ ├── refund/
│ │ └── refund.module.ts
│
│ ├── commission/
│ │ └── commission.module.ts
│
│ ├── events/
│ └── payment.module.ts # ✅ context module

# ========================

# NOTIFICATION

# ========================

├── notification/
│ ├── push/
│ │ └── push.module.ts
│
│ ├── websocket/
│ │ └── websocket.module.ts
│
│ ├── template/
│ │ └── template.module.ts
│
│ └── notification.module.ts # ✅ context module

# ========================

# ANALYTICS

# ========================

├── analytics/
│ ├── dashboard/
│ │ └── dashboard.module.ts
│
│ ├── order-report/
│ │ └── order-report.module.ts
│
│ ├── financial-report/
│ │ └── financial-report.module.ts
│
│ ├── user-report/
│ │ └── user-report.module.ts
│
│ └── analytics.module.ts # ✅ context module
