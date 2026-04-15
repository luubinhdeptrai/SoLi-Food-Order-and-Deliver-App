# 📘 Modular Monolith — Public API Communication Guide (NestJS)

## 1. Purpose

This document defines how modules (bounded contexts) communicate using the **Public API pattern**.

Goals:

- Enforce **strict boundaries between bounded contexts**
- Prevent **accidental coupling**
- Keep the system **easy to refactor into microservices later**
- Ensure **predictable, boring, maintainable code**

---

## 2. Core Rule (Non-Negotiable)

> A module MUST ONLY interact with another bounded context through its **public API module**.

❌ Forbidden:

- Importing another module’s service directly
- Importing entities from another bounded context
- Accessing another module’s database/repository

✅ Allowed:

- Importing a **public API module**
- Calling **interfaces (ports)** exposed by that module
- Using **DTOs / snapshots** defined in that public API

---

## 3. Folder Structure Convention

Every bounded context MUST follow this structure:

```
<bounded-context>/

├── public-api/              ← ONLY thing other modules can import
│   ├── <feature>.port.ts
│   ├── <feature>.dto.ts
│   ├── <feature>.snapshot.ts
│   └── <bc>-public-api.module.ts

├── application/
│   └── *.service.ts

├── domain/
│   └── *.entity.ts

├── infrastructure/ (optional)
│   └── *.repository.ts

└── <bc>.module.ts           ← root module
```

---

## 4. Public API Design Rules

### 4.1 Port (Interface)

- MUST be defined using an **interface**
- MUST be exported via a **Symbol token**
- MUST be implemented internally

```ts
export const MENU_CATALOG_PORT = Symbol('MENU_CATALOG_PORT');

export interface MenuCatalogPort {
  getItemsByIds(ids: string[]): Promise<MenuItemSnapshot[]>;
}
```

---

### 4.2 DTO / Snapshot Rules

- MUST be **plain objects only**
- MUST NOT contain behavior (no methods)
- MUST represent a **read model**, not domain entity

```ts
export interface MenuItemSnapshot {
  id: string;
  name: string;
  unitPrice: number;
  currency: 'VND';
  isAvailable: boolean;
}
```

---

### 4.3 Public API Module

- MUST export ONLY:
  - ports (via DI tokens)
  - DTOs / snapshots

```ts
@Module({
  providers: [
    MenuCatalogService,
    {
      provide: MENU_CATALOG_PORT,
      useExisting: MenuCatalogService,
    },
  ],
  exports: [MENU_CATALOG_PORT],
})
export class MenuPublicApiModule {}
```

---

## 5. Dependency Rules

### Allowed dependency direction

```
Ordering  ───────▶  Menu (via public API only)
```

### Forbidden

```
Ordering  ───────▶  MenuService ❌
Ordering  ───────▶  MenuEntity ❌
Ordering  ───────▶  MenuRepository ❌
```

---

## 6. Naming Conventions (Strict)

Inspired by Shopify: **clear, explicit, boring names > clever names**

### 6.1 Files

| Type     | Format                  | Example                 |
| -------- | ----------------------- | ----------------------- |
| Port     | `<feature>.port.ts`     | `menu-catalog.port.ts`  |
| Snapshot | `<feature>.snapshot.ts` | `menu-item.snapshot.ts` |
| DTO      | `<action>.dto.ts`       | `place-order.dto.ts`    |
| Service  | `<feature>.service.ts`  | `order.service.ts`      |
| Module   | `<feature>.module.ts`   | `order.module.ts`       |

---

### 6.2 Classes / Interfaces

| Type     | Convention          |
| -------- | ------------------- |
| Port     | `<Feature>Port`     |
| Service  | `<Feature>Service`  |
| Entity   | `<Aggregate>Entity` |
| DTO      | `<Action>Dto`       |
| Snapshot | `<Entity>Snapshot`  |

---

### 6.3 Variables

- Use **full words**, no abbreviations
- Avoid generic names like `data`, `item`, `obj`

```ts
const menuItems = ...
const orderItems = ...
const subtotal = ...
```

---

### 6.4 Functions

Use **verb-first naming**

```ts
getItemsByIds();
placeOrder();
calculateSubtotal();
```

---

## 7. Implementation Rules

### 7.1 Application Services

- MUST contain business logic
- MUST NOT expose themselves outside the module
- MUST implement ports when needed

---

### 7.2 Domain Entities

- MUST stay inside the bounded context
- MUST NOT be exported outside
- MUST contain business rules

---

### 7.3 Controllers

- MUST call application services only
- MUST NOT call other modules

---

## 8. Cross-Module Flow (Example)

### Order → Menu

1. `OrderService` receives request
2. Calls `MenuCatalogPort`
3. Receives `MenuItemSnapshot`
4. Creates `OrderItem` with:
   - name snapshot
   - price snapshot

5. Calculates total
6. Saves order

---

## 9. Anti-Corruption Rule (Critical)

When consuming another context:

> ALWAYS copy external data into your own model

Example:

```ts
new OrderItem(
  menuItem.id,
  menuItem.name, // snapshot
  menuItem.unitPrice, // snapshot
  quantity,
);
```

NEVER store references to external models.

---

## 10. Error Handling Rules

- Validate external data immediately
- Fail fast

```ts
if (!menuItem.isAvailable) {
  throw new BadRequestException('Item unavailable');
}
```

---

## 11. Testing Rules

- Mock **ports**, not services

```ts
const mockMenuCatalog: MenuCatalogPort = {
  getItemsByIds: jest.fn(),
};
```

- NEVER mock internal implementation of another module

---

## 12. Code Style Principles (Shopify-inspired)

- Prefer **clarity over abstraction**
- Prefer **duplication over wrong abstraction**
- Keep functions **small and predictable**
- Avoid “smart” patterns unless necessary
- Make boundaries **obvious in code structure**

---

## 13. When to Use Public API Pattern

Use this when:

- You need **fresh, real-time data**
- You want **simple implementation**
- You accept **runtime coupling**

---

## 14. When NOT to Use It

Do NOT use this when:

- You need **high autonomy between modules**
- You want **event-driven architecture**
- You need **resilience to module failure**

---

## 15. Summary Rule

> Each bounded context is a **black box**.
> The only way in is through its **public API**.
