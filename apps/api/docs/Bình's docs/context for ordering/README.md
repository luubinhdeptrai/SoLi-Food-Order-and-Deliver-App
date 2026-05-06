# CQRS + Events — Modular Monolith Example

## The problem this solves

> "Order module needs menu item prices, but cannot call the Restaurant module directly."

## Data flow

```
POST /menu  →  CreateMenuItemCommand
                    │
                    ▼
           CreateMenuItemHandler        ← Restaurant module, write side
                    │  persists MenuItem
                    │
                    │  eventBus.publish(MenuItemUpdatedEvent)
                    │
         ┌──────────┘   (same in-process EventBus)
         │
         ▼
  MenuItemProjector                     ← Ordering module, read side
         │  updates local Map/DB table
         │  (name, priceCents, isAvailable)
         │
         │  (later...)
         │
POST /orders  →  PlaceOrderCommand
                    │
                    ▼
           PlaceOrderHandler            ← Ordering module, write side
                    │
                    │  menuItemProjector.findManyByIds(...)
                    │  ← reads LOCAL snapshot, zero cross-module calls
                    │
                    │  calculates total, creates Order
                    │
                    │  eventBus.publish(OrderPlacedEvent)
                    │
         ┌──────────┘
         ▼
  Payment, Notification, Analytics...   ← other modules react
```

## Project structure

```text
.
├── README.md
├── tests/
│   └── cqrs-flow.e2e-spec.ts
└── src/
       ├── main.ts
       ├── app.module.ts
       ├── shared/
       │   └── events/
       │       ├── menu-item-updated.event.ts
       │       └── order-placed.event.ts
       └── modules/
              ├── restaurant/
              │   ├── restaurant.module.ts
              │   └── menu/
              │       ├── menu.controller.ts
              │       ├── menu.module.ts
              │       ├── commands/
              │       │   ├── create-menu-item.command.ts
              │       │   └── create-menu-item.handler.ts
              │       └── domain/
              │           └── menu-item.entity.ts
              ├── ordering/
              │   ├── ordering.module.ts
              │   ├── cart/
              │   │   ├── cart.controller.ts
              │   │   ├── cart.module.ts
              │   │   ├── commands/
              │   │   │   ├── checkout-cart.command.ts
              │   │   │   └── checkout-cart.handler.ts
              │   │   └── domain/
              │   │       └── cart.entity.ts
              │   └── order/
              │       ├── order.controller.ts
              │       ├── order.module.ts
              │       ├── commands/
              │       │   ├── place-order.command.ts
              │       │   └── place-order.handler.ts
              │       ├── domain/
              │       │   └── order.entity.ts
              │       └── projections/
              │           ├── menu-item.projector.ts
              │           └── menu-item.read-model.ts
              └── analytics/
                     ├── analytics.controller.ts
                     ├── analytics.module.ts
                     └── order-stats.projector.ts
```

## Coupling audit

| File                     | Imports from Restaurant?  |
| ------------------------ | ------------------------- |
| `place-order.handler.ts` | ❌ No                     |
| `menu-item.projector.ts` | ❌ No (only shared event) |
| `order.entity.ts`        | ❌ No                     |

The **only** shared artifact is `MenuItemUpdatedEvent` in `src/shared/events/`.
Both modules depend on the contract, never on each other.

## Microservice migration checklist

When you want to extract `OrderingModule` to its own service:

- [ ] Move `OrderingModule` code to a new NestJS app
- [ ] Replace `CqrsModule` EventBus with a Kafka/RabbitMQ consumer in `MenuItemProjector`
- [ ] Replace `eventBus.publish(OrderPlacedEvent)` in `PlaceOrderHandler` with a Kafka producer
- [ ] Split the database — `ordering.*` tables move to the new service
- [ ] Delete `OrderingModule` from `AppModule`

**Zero business logic changes.** All command handlers, projectors, and entities are identical.

## Trade-off to be aware of

`MenuItemProjector` is eventually consistent. Between a price change in the Restaurant module and the projection update in the Ordering module, there is a brief window where Orders would use a stale price.

For most order flows this is imperceptible. If you need price-at-order-time
correctness (you usually do), the current design already handles it correctly: `PlaceOrderHandler` **snapshots** the price into `OrderItem.unitPriceCents`
at the moment of order creation. Future menu price changes do not affect existing orders.
