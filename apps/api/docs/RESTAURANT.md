# Restaurant Module

Bounded context responsible for managing restaurant profiles within the SoLi platform. Covers creation, retrieval, update, and deletion of restaurants, along with ownership enforcement and operational-status gating used by downstream modules (e.g. orders, menus).

---

## Module Structure

```
module/restaurant/
├── restaurant.module.ts      # NestJS module declaration — wires providers, imports, exports
├── restaurant.controller.ts  # HTTP layer — maps routes to service calls, applies guards
├── restaurant.service.ts     # Business logic — ownership checks, approval/open gating
├── restaurant.repository.ts  # Data access — Drizzle queries against the restaurants table
├── index.ts                  # Barrel export (RestaurantModule, RestaurantService)
└── dto/
    └── restaurant.dto.ts     # CreateRestaurantDto, UpdateRestaurantDto (class-validator)
```

**Schema** lives outside the module boundary to support Drizzle's central schema export:

```
drizzle/schemas/restaurant.schema.ts   # Table definition + inferred TypeScript types
```

---

## Database Schema

Table: `restaurants`

| Column        | Type        | Constraints | Default             |
| ------------- | ----------- | ----------- | ------------------- |
| `id`          | `uuid`      | Primary key | `gen_random_uuid()` |
| `owner_id`    | `uuid`      | Not null    | —                   |
| `name`        | `text`      | Not null    | —                   |
| `description` | `text`      | Nullable    | —                   |
| `address`     | `text`      | Not null    | —                   |
| `phone`       | `text`      | Not null    | —                   |
| `is_open`     | `boolean`   | Not null    | `false`             |
| `is_approved` | `boolean`   | Not null    | `false`             |
| `latitude`    | `real`      | Nullable    | —                   |
| `longitude`   | `real`      | Nullable    | —                   |
| `created_at`  | `timestamp` | Not null    | `now()`             |
| `updated_at`  | `timestamp` | Not null    | `now()`             |

Drizzle infers `Restaurant` (select) and `NewRestaurant` (insert) types directly from this definition.

---

## API Endpoints

Base path: `/api/restaurants`  
All routes require a valid JWT (`JwtAuthGuard` + `RolesGuard` applied at controller level).

| Method   | Path   | Roles required         | Description                                    |
| -------- | ------ | ---------------------- | ---------------------------------------------- |
| `GET`    | `/`    | Any authenticated user | List all restaurants (ordered by `created_at`) |
| `GET`    | `/:id` | Any authenticated user | Get a single restaurant by UUID                |
| `POST`   | `/`    | `admin`, `restaurant`  | Create a new restaurant (owner = caller)       |
| `PATCH`  | `/:id` | `admin`, `restaurant`  | Update a restaurant (owner or admin)           |
| `DELETE` | `/:id` | `admin`                | Delete a restaurant — returns `204`            |

### Request Bodies

**POST `/`** — `CreateRestaurantDto`

```json
{
  "name": "string (min 2 chars, required)",
  "address": "string (required)",
  "phone": "string (required)",
  "description": "string (optional)",
  "latitude": "number (optional)",
  "longitude": "number (optional)"
}
```

**PATCH `/:id`** — `UpdateRestaurantDto` (all fields optional, extends `CreateRestaurantDto`)

```json
{
  "name": "string?",
  "address": "string?",
  "phone": "string?",
  "description": "string?",
  "latitude": "number?",
  "longitude": "number?",
  "isOpen": "boolean?"
}
```

> `isOpen` is only settable via `PATCH`; it is not exposed on `POST`.

---

## Business Rules

Enforced in `restaurant.service.ts`:

1. **Existence check** — `findOne` and `remove` throw `NotFoundException` if the record does not exist.

2. **Ownership check on update** — Non-admin callers may only update restaurants they own (`ownerId === requesterId`). Violation throws `ForbiddenException`.

3. **`assertOpenAndApproved(id)`** — Public guard for downstream modules. Throws `ForbiddenException` if:
   - `isApproved` is `false` — restaurant has not been approved by an admin.
   - `isOpen` is `false` — restaurant is currently closed.

   Other modules (e.g. orders) must call this before accepting operations on a restaurant.

---

## Module Dependencies

```
RestaurantModule
  imports:     DatabaseModule          (provides DrizzleService)
  controllers: RestaurantController
  providers:   RestaurantService, RestaurantRepository
  exports:     RestaurantService       (public API for other modules)
```

Other modules that need restaurant data **must import `RestaurantModule`** and inject `RestaurantService`. Direct repository access or raw DB queries against the `restaurants` table from outside this module are not allowed — that would violate the module boundary.

---

## Architectural Notes

This module follows the **modular monolith** pattern used across the API:

- The public surface is `RestaurantService` (exported). Consumers depend on the service, not the repository or schema.
- `assertOpenAndApproved` is the designated integration point for order and menu modules.
- The DTO layer decouples the HTTP contract from the Drizzle entity type — controllers never expose `Restaurant` directly from the ORM; they return the result of service methods.
- When this module needs to emit side-effects to other bounded contexts (e.g. "restaurant approved" event), introduce a domain event via the NestJS `EventEmitter2` module rather than adding direct service-to-service calls.
