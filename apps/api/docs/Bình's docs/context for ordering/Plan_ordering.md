# 🧠 Ordering Module - Design Notes

## 1. Relationship between Restaurant & Ordering

### 1.1 Data Ownership

- Restaurant owns:
  - MenuItem
  - Price
  - Availability
- Ordering:
  - Uses **snapshot data**
  - Does NOT own menu data

### 1.2 Consistency Model

- Use **eventual consistency**

### 1.3 Interaction Type

- Sync:
  - Validate restaurant open/close
  - Validate item availability at checkout
- Async:
  - No real-time menu sync

### 1.4 Open Questions

- Should Ordering cache menu data? (Danh -> no)
- What happens if price changes after adding to cart?

---

## 2. Ordering API Design

### 2.1 Core Use Cases (IMPORTANT)

- Place order
- Cancel order
- Get order detail
- Track order status
- Reorder

---

### 2.2 Order State Machine

#### States:

- PENDING
- PAID
- CONFIRMED
- PREPARING
- READY_FOR_PICKUP
- PICKED_UP
- DELIVERING
- DELIVERED
- CANCELLED
- REFUNDED

#### Questions:

- Allowed transitions?
- Who triggers each state?
- Can rollback state?

#### Example:

| From             | To        | Triggered by |
| ---------------- | --------- | ------------ |
| PENDING          | CONFIRMED | Restaurant   |
| READY_FOR_PICKUP | PICKED_UP | Shipper      |

---

### 2.3 Data Model (High-level)

- Order
- OrderItem
- Cart
- CartItem
- DeliveryAddress
- OrderStatusLog

---

### 2.4 Idempotency & Consistency

- Prevent duplicate order creation
- Handle retry safely

#### Questions:

- What if user clicks "Place Order" twice?
- How to ensure idempotency?

---

## 3. Upstream & Downstream Integration

### 3.1 Dependencies

- Upstream:
  - Restaurant & Catalog
- Downstream:
  - Payment
  - Delivery
  - Notification
  - Analytics

---

### 3.2 Integration Patterns

| From                    | To           | Pattern |
| ----------------------- | ------------ | ------- |
| Ordering → Restaurant   | Sync call    |
| Ordering → Payment      | Domain Event |
| Ordering → Delivery     | Domain Event |
| Ordering → Notification | Domain Event |

---

### 3.3 Key Questions

- Which flows are sync vs async?
- What events should Ordering publish?
- What if downstream services fail?

---

## 4. Transaction Boundary (CRITICAL)

### Questions:

- What is inside one transaction?
- Should Order + Payment be in one transaction?

### Recommendation:

- Use **event-driven architecture**
- Avoid distributed transaction

---

## 5. Concurrency Handling

### Problems:

- Multiple users order last item
- Restaurant closes during checkout

### Strategy:

- Validation at checkout
- Optional locking or compensation logic

---

## 6. Data Snapshot Strategy

### Must store in Order:

- Item name
- Price
- Quantity
- Restaurant info

### Reason:

- Avoid inconsistency when menu changes later

---

## 7. Failure Handling

### Scenarios:

- Payment success but order fails
- Delivery assignment fails
- Notification fails

### Strategy:

- Retry mechanism
- Compensation (refund, cancel)
- Event-based recovery

---

## 8. Scaling & Performance

### Considerations:

- Cart storage → Redis
- Read-heavy → consider read model (CQRS)

### Questions:

- Do we need CQRS?
- Should we separate write/read DB?

---

## 9. Security & Authorization

### Rules:

- Customer → only their orders
- Restaurant → only their orders
- Shipper → only assigned orders

---

## 10. Observability (Senior-level)

### Logging:

- Track full order lifecycle

### Metrics:

- Order success rate
- Delivery time
- Cancellation rate

### Tracing:

- Trace order across services

---

# 🚀 Summary

## Key Design Mindsets

- State machine thinking
- Event-driven architecture
- Failure-first design
- Data ownership boundaries
- Concurrency handling

---

## Optional Next Steps

- Design full API (NestJS)
- Define DB schema
- Create event flow
- Draw sequence diagram
