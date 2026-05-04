# Backend Codebase Analysis - apps/api

## 1. Scope

- This document is based only on the backend files provided in `/apps/api` and its docs.
- I do not expand generated Better Auth endpoints into a concrete list because the exact route list is not declared in the inspected source files.
- I intentionally did not read `/apps/api/.env` values to avoid exposing secrets. Its runtime purpose can still be inferred from `/apps/api/.env.example`.

## 2. Architecture Identification

### Architecture style

- The live backend is a **NestJS modular monolith**.
- Inside each feature module, the code follows a **layered controller -> service -> repository -> schema/database** structure.
- The docs describe a future **bounded-context / public-API / DDD-inspired** structure, but the current runtime code is simpler than the target design.
- This is **not full clean architecture or hexagonal architecture** yet because feature services call other feature services directly, for example `MenuService -> RestaurantService`.

### Visible bounded contexts and modules

- `Auth` support exists through Better Auth schema/config and local guards/decorators.
- `Restaurant Catalog` is the main visible business context.
- Inside `Restaurant Catalog`, the live feature modules are:
  - `RestaurantModule`
  - `MenuModule`

### Layer responsibilities

- **Bootstrap / composition**
  - `/apps/api/src/main.ts`
  - `/apps/api/src/app.module.ts`
  - Starts Nest, wires modules, global prefix, validation, Swagger, Better Auth docs.

- **Controllers / HTTP layer**
  - `/apps/api/src/app.controller.ts`
  - `/apps/api/src/module/restaurant-catalog/restaurant/restaurant.controller.ts`
  - `/apps/api/src/module/restaurant-catalog/menu/menu.controller.ts`
  - Accept requests, bind params/body/query, apply guards, delegate to services.

- **Services / business logic**
  - `/apps/api/src/app.service.ts`
  - `/apps/api/src/module/restaurant-catalog/restaurant/restaurant.service.ts`
  - `/apps/api/src/module/restaurant-catalog/menu/menu.service.ts`
  - Enforce ownership, not-found handling, and business checks before persistence.

- **Repositories / data access**
  - `/apps/api/src/module/restaurant-catalog/restaurant/restaurant.repository.ts`
  - `/apps/api/src/module/restaurant-catalog/menu/menu.repository.ts`
  - Translate service requests into Drizzle queries.

- **Models / schemas / DTOs**
  - Drizzle DB tables:
    - `/apps/api/src/module/auth/auth.schema.ts`
    - `/apps/api/src/module/restaurant-catalog/restaurant/restaurant.schema.ts`
    - `/apps/api/src/module/restaurant-catalog/menu/menu.schema.ts`
  - Request/response DTOs:
    - `/apps/api/src/module/restaurant-catalog/restaurant/dto/restaurant.dto.ts`
    - `/apps/api/src/module/restaurant-catalog/menu/dto/menu.dto.ts`

- **Request pipeline components**
  - Global validation pipe in `/apps/api/src/main.ts`
  - Auth guards and decorators in `/apps/api/src/module/auth/**`
  - No custom Nest middleware, interceptor, or exception filter is visible in the provided files.

### Layered architecture diagram

```text
HTTP Request
  -> main.ts
     -> global prefix /api
     -> ValidationPipe
  -> JwtAuthGuard
  -> RolesGuard (only on endpoints with @Roles)
  -> Controller
  -> Service
  -> Repository
  -> Drizzle ORM
  -> PostgreSQL
  -> JSON response
```

## 3. File-Level Explanation

## 3.1 Bootstrap and root module

| File                              | Purpose                                                                                                                                                                                                        | Imports                                                                                                                    | Used by                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/apps/api/src/main.ts`           | Runtime entry point. Creates the Nest app, applies `ValidationPipe`, sets global prefix to `/api`, merges Nest Swagger with Better Auth OpenAPI, exposes `/api-spec.json` and `/docs`, listens on port `3000`. | `NestFactory`, Swagger helpers, `auth`, `AppModule`, Scalar API reference, Express types, `ValidationPipe`                 | Executed by Nest start scripts from `/apps/api/package.json`                                  |
| `/apps/api/src/app.module.ts`     | Root Nest module. Registers config, DB, restaurant catalog, and Better Auth integration.                                                                                                                       | `Module`, `AppController`, `AppService`, `ConfigModule`, `DatabaseModule`, `AuthModule`, `auth`, `RestaurantCatalogModule` | Imported by `/apps/api/src/main.ts` and `/apps/api/test/app.e2e-spec.ts`                      |
| `/apps/api/src/app.controller.ts` | Minimal root controller with one `GET /` handler.                                                                                                                                                              | `Controller`, `Get`, `AppService`                                                                                          | Registered in `/apps/api/src/app.module.ts`, tested by `/apps/api/src/app.controller.spec.ts` |
| `/apps/api/src/app.service.ts`    | Minimal service returning `Hello World!`.                                                                                                                                                                      | `Injectable`                                                                                                               | Injected into `/apps/api/src/app.controller.ts`                                               |

### Root dependency diagram

```text
main.ts
  -> AppModule
     -> ConfigModule
     -> DatabaseModule
     -> RestaurantCatalogModule
     -> Better Auth Nest module

AppController -> AppService
```

## 3.2 Database and infrastructure

| File                                         | Purpose                                                                                                  | Imports                              | Used by                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| `/apps/api/src/drizzle/drizzle.constants.ts` | Defines the `DB_CONNECTION` DI token.                                                                    | none                                 | Used by `drizzle.module.ts`, `restaurant.repository.ts`, `menu.repository.ts`     |
| `/apps/api/src/drizzle/db.ts`                | Creates a shared Drizzle database object directly from `DATABASE_URL`. This path is used by Better Auth. | `dotenv/config`, `drizzle`           | Imported by `/apps/api/src/lib/auth.ts`                                           |
| `/apps/api/src/drizzle/drizzle.module.ts`    | Nest DI wrapper around Drizzle. Throws if `DATABASE_URL` is missing.                                     | `Module`, `drizzle`, `DB_CONNECTION` | Imported by `AppModule`, `RestaurantModule`, `MenuModule`                         |
| `/apps/api/src/drizzle/schema.ts`            | Barrel file that re-exports auth, restaurant, and menu schemas.                                          | schema re-exports                    | Imported by `/apps/api/src/lib/auth.ts` and both repositories for typed DB access |
| `/apps/api/drizzle.config.ts`                | Drizzle Kit CLI config for migration generation, push, migrate, and studio.                              | `dotenv/config`, `defineConfig`      | Used by DB scripts in `/apps/api/package.json`                                    |

### DB infrastructure note

- There are **two DB access entry points**:
  - `db.ts` for Better Auth
  - `drizzle.module.ts` for Nest DI repositories
- Both depend on the same `DATABASE_URL`, so runtime behavior is consistent as long as the environment is configured correctly.

## 3.3 Auth support files

| File                                                             | Purpose                                                                                                   | Imports                                                       | Used by                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/apps/api/src/lib/auth.ts`                                      | Configures Better Auth with Drizzle adapter, email/password auth, generated UUIDs, and OpenAPI plugin.    | `better-auth`, `drizzleAdapter`, `db`, `openAPI`, `schema`    | Imported by `/apps/api/src/main.ts` and `/apps/api/src/app.module.ts`                |
| `/apps/api/src/module/auth/auth.schema.ts`                       | Drizzle tables for Better Auth persistence: `user`, `session`, `account`, `verification`, plus relations. | Drizzle schema builders and `relations`                       | Re-exported by `/apps/api/src/drizzle/schema.ts`; consumed indirectly by Better Auth |
| `/apps/api/src/module/auth/decorators/current-user.decorator.ts` | Extracts `request.user` from the current HTTP request. Also declares a local `JwtPayload` interface.      | `createParamDecorator`, `ExecutionContext`, Express `Request` | Used by `restaurant.controller.ts` and `menu.controller.ts`                          |
| `/apps/api/src/module/auth/decorators/roles.decorator.ts`        | Stores required roles in route metadata.                                                                  | `SetMetadata`                                                 | Used by `restaurant.controller.ts` and `menu.controller.ts`                          |
| `/apps/api/src/module/auth/guards/jwt-auth.guard.ts`             | Guard that checks for a `Bearer` header and attaches a placeholder user object to `request.user`.         | Nest guard types, `UnauthorizedException`, Express `Request`  | Applied to restaurant and menu controllers                                           |
| `/apps/api/src/module/auth/guards/roles.guard.ts`                | Reads `@Roles` metadata and checks `request.user.roles`. Throws `ForbiddenException` on mismatch.         | Nest guard types, `Reflector`, Express `Request`              | Applied to restaurant and menu controllers                                           |
| `/apps/api/src/module/auth/interfaces/jwt-payload.interface.ts`  | Standalone JWT payload interface.                                                                         | none                                                          | No visible runtime usage in the provided files                                       |

### Auth dependency diagram

```text
JwtAuthGuard -> request.user
CurrentUser decorator -> request.user
Roles decorator -> route metadata
RolesGuard -> Reflector -> route metadata + request.user.roles

restaurant.controller.ts -> JwtAuthGuard + RolesGuard + CurrentUser + Roles
menu.controller.ts       -> JwtAuthGuard + RolesGuard + CurrentUser + Roles
```

### Important auth reality from the live code

- `JwtAuthGuard` is currently a **placeholder**, not a real JWT verifier.
- Any request with a bearer token string passes the guard and gets this hard-coded user:
  - `sub: 'user-id'`
  - `email: 'user@example.com'`
  - `roles: ['user']`
- Because of that:
  - read endpoints without `@Roles(...)` are effectively protected only by the presence of a bearer token string
  - write endpoints that require `admin` or `restaurant` will fail `RolesGuard` unless the guard is changed

## 3.4 Restaurant catalog context

| File                                                                          | Purpose                                                                                                                | Imports                                                                                            | Used by                                                                                                              |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/apps/api/src/module/restaurant-catalog/restaurant-catalog.module.ts`        | Context-level aggregator for `MenuModule` and `RestaurantModule`.                                                      | `MenuModule`, `RestaurantModule`                                                                   | Imported by `/apps/api/src/app.module.ts`                                                                            |
| `/apps/api/src/module/restaurant-catalog/restaurant/restaurant.module.ts`     | Nest feature module for restaurant CRUD. Exports `RestaurantService` so other modules can depend on it.                | `RestaurantController`, `RestaurantService`, `RestaurantRepository`, `DatabaseModule`              | Imported by `RestaurantCatalogModule` and `MenuModule`                                                               |
| `/apps/api/src/module/restaurant-catalog/restaurant/restaurant.controller.ts` | HTTP API for `/api/restaurants`. Applies auth and role checks, delegates to `RestaurantService`.                       | Nest decorators, `RestaurantService`, DTOs, auth guards/decorators, Swagger decorators             | Registered by `restaurant.module.ts`                                                                                 |
| `/apps/api/src/module/restaurant-catalog/restaurant/restaurant.service.ts`    | Restaurant business logic: fetches restaurants, handles not-found, owner/admin update rule, open/approved gate.        | Nest exceptions, `RestaurantRepository`, DTOs, schema types                                        | Used by `restaurant.controller.ts` and `menu.service.ts`                                                             |
| `/apps/api/src/module/restaurant-catalog/restaurant/restaurant.repository.ts` | Drizzle queries for `restaurants` table: list, find, create, update, delete.                                           | Nest DI, Drizzle `eq`, restaurant schema, DTOs, `DB_CONNECTION`, typed schema barrel               | Used by `restaurant.service.ts`                                                                                      |
| `/apps/api/src/module/restaurant-catalog/restaurant/restaurant.schema.ts`     | Drizzle table definition for `restaurants`.                                                                            | Drizzle PG column helpers                                                                          | Used by `restaurant.repository.ts`, re-exported by `/apps/api/src/drizzle/schema.ts`, referenced by `menu.schema.ts` |
| `/apps/api/src/module/restaurant-catalog/restaurant/dto/restaurant.dto.ts`    | Request DTOs and response contract for restaurant endpoints.                                                           | Swagger decorators, `PartialType`, `class-validator` decorators                                    | Used by `restaurant.controller.ts`, `restaurant.service.ts`, `restaurant.repository.ts`                              |
| `/apps/api/src/module/restaurant-catalog/menu/menu.module.ts`                 | Nest feature module for menu CRUD. Imports `RestaurantModule` because menu ownership checks require restaurant lookup. | `MenuController`, `MenuService`, `MenuRepository`, `DatabaseModule`, `RestaurantModule`            | Imported by `RestaurantCatalogModule`                                                                                |
| `/apps/api/src/module/restaurant-catalog/menu/menu.controller.ts`             | HTTP API for `/api/menu-items`. Applies auth/roles and delegates to `MenuService`. Also exposes a categories route.    | Nest decorators, `MenuService`, menu DTOs/constants, auth guards/decorators, Swagger decorators    | Registered by `menu.module.ts`                                                                                       |
| `/apps/api/src/module/restaurant-catalog/menu/menu.service.ts`                | Menu business logic: ensures restaurant exists, checks ownership, toggles sold-out state, delegates to repository.     | Nest exceptions, `MenuRepository`, menu DTO types/constants, menu schema type, `RestaurantService` | Used by `menu.controller.ts`                                                                                         |
| `/apps/api/src/module/restaurant-catalog/menu/menu.repository.ts`             | Drizzle queries for `menu_items`: list by restaurant/category, find, create, update, delete.                           | Nest DI, Drizzle `eq` and `and`, menu schema, DTOs, `DB_CONNECTION`, schema barrel                 | Used by `menu.service.ts`                                                                                            |
| `/apps/api/src/module/restaurant-catalog/menu/menu.schema.ts`                 | Drizzle enum and table definition for `menu_items`. Has a foreign key to `restaurants.id` with cascade delete.         | Drizzle PG builders, `restaurants` schema                                                          | Used by `menu.repository.ts`, re-exported by `/apps/api/src/drizzle/schema.ts`                                       |
| `/apps/api/src/module/restaurant-catalog/menu/dto/menu.dto.ts`                | Menu request DTOs, query DTO, response DTO, and allowed category/status constants.                                     | Swagger helpers, `PartialType`, `OmitType`, `class-validator` decorators                           | Used by `menu.controller.ts`, `menu.service.ts`, `menu.repository.ts`                                                |

### Restaurant catalog dependency diagram

```text
RestaurantCatalogModule
  -> RestaurantModule
     -> RestaurantController
     -> RestaurantService
     -> RestaurantRepository
     -> restaurants table

  -> MenuModule
     -> MenuController
     -> MenuService
        -> MenuRepository
        -> RestaurantService
     -> menu_items table
```

### Cross-feature coupling visible in live code

- `MenuModule` imports `RestaurantModule`.
- `MenuService` calls `RestaurantService` directly.
- This is practical and simple, but it is less strict than the `public-api-pattern.md` target architecture.

## 3.5 Config, docs, and tests

| File                                                    | Purpose                                                                               | Imports / content                                                                  | Used by                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------- |
| `/apps/api/package.json`                                | Backend scripts, dependencies, and Jest config.                                       | Nest, Drizzle, Better Auth, Swagger, Jest, ESLint, TypeScript                      | Used by developers, CI, package manager |
| `/apps/api/.env.example`                                | Documents required env vars: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`. | plain env values                                                                   | Used by developers to create `.env`     |
| `/apps/api/.env`                                        | Local secret-bearing runtime env file.                                                | not inspected directly                                                             | Used by runtime and CLIs                |
| `/apps/api/.gitignore`                                  | Ignores dist, node_modules, logs, coverage, IDE files, and env files.                 | plain ignore patterns                                                              | Used by Git                             |
| `/apps/api/.prettierrc`                                 | Formatting rules: single quotes and trailing commas.                                  | JSON config                                                                        | Used by Prettier                        |
| `/apps/api/eslint.config.mjs`                           | ESLint config with TypeScript type-aware linting and Prettier integration.            | `@eslint/js`, `typescript-eslint`, `globals`, `eslint-plugin-prettier/recommended` | Used by `pnpm lint`                     |
| `/apps/api/nest-cli.json`                               | Nest CLI config with `src` as source root and `deleteOutDir`.                         | JSON config                                                                        | Used by Nest CLI                        |
| `/apps/api/tsconfig.json`                               | Base TS config for runtime code. Enables decorators and sets `@/*` path alias.        | JSON config                                                                        | Used by TypeScript, Nest, ts-jest       |
| `/apps/api/tsconfig.build.json`                         | Build-specific TS config. Excludes tests and writes build info under `dist`.          | extends `tsconfig.json`                                                            | Used by Nest build                      |
| `/apps/api/tsconfig.test.json`                          | Test-specific TS config with Jest types.                                              | extends `tsconfig.json`                                                            | Used by unit/e2e tests                  |
| `/apps/api/README.md`                                   | Default Nest starter readme, not project-specific architecture documentation.         | static markdown                                                                    | Used by humans                          |
| `/apps/api/docs/bounded-context.md`                     | Target-state architecture note for a much larger delivery platform.                   | static markdown                                                                    | Used by humans                          |
| `/apps/api/docs/folder-structure.md`                    | Target folder organization for a modular monolith with bounded contexts.              | static markdown                                                                    | Used by humans                          |
| `/apps/api/docs/public-api-pattern.md`                  | Design rule for strict cross-context interaction through public APIs only.            | static markdown                                                                    | Used by humans                          |
| `/apps/api/docs/Bình's docs/MONOREPO_CODEBASE_GUIDE.md` | Prior codebase guide with broader repo observations.                                  | static markdown                                                                    | Used by humans                          |
| `/apps/api/docs/Bình's docs/Plan_ordering.md`           | Ordering module design notes and open questions.                                      | static markdown                                                                    | Used by humans                          |
| `/apps/api/src/app.controller.spec.ts`                  | Unit test for `AppController.getHello()`.                                             | Nest testing helpers, `AppController`, `AppService`                                | Run by Jest unit tests                  |
| `/apps/api/test/app.e2e-spec.ts`                        | E2E test that boots `AppModule` and asserts `GET /` returns `Hello World!`.           | Nest testing helpers, `supertest`, `AppModule`                                     | Run by `pnpm test:e2e`                  |
| `/apps/api/test/jest-e2e.json`                          | Jest config for e2e tests.                                                            | JSON config                                                                        | Used by `pnpm test:e2e`                 |

## 4. Request Lifecycle

## 4.1 Runtime bootstrap lifecycle

1. `/apps/api/src/main.ts` creates the Nest app from `AppModule`.
2. It installs `ValidationPipe` globally.
3. It sets the global prefix to `/api`.
4. It builds Swagger docs for Nest controllers.
5. It asks Better Auth to generate OpenAPI schema and merges those auth routes into the same document.
6. It exposes docs at `/docs` and OpenAPI JSON at `/api-spec.json`.
7. It listens on port `3000`.

## 4.2 Example request flow: `GET /api/restaurants/:id`

```text
Client
  -> /api/restaurants/:id
  -> JwtAuthGuard
  -> RestaurantController.findOne(id)
  -> RestaurantService.findOne(id)
  -> RestaurantRepository.findById(id)
  -> Drizzle select from restaurants
  -> service throws NotFoundException if missing
  -> controller returns restaurant row
```

### Step by step

1. Request hits `RestaurantController` because the controller path is `restaurants` and `main.ts` applies the `/api` prefix.
2. `JwtAuthGuard` requires a bearer token string in the header.
3. `ParseUUIDPipe` validates `:id`.
4. `RestaurantController.findOne()` calls `RestaurantService.findOne(id)`.
5. `RestaurantService.findOne()` asks `RestaurantRepository.findById(id)`.
6. `RestaurantRepository` runs a Drizzle `select` on the `restaurants` table.
7. If no row is found, `RestaurantService` throws `NotFoundException`.
8. If found, the row is returned as JSON.

## 4.3 Example request flow: `POST /api/menu-items`

```text
Client
  -> /api/menu-items
  -> JwtAuthGuard
  -> RolesGuard (admin or restaurant)
  -> ValidationPipe on CreateMenuItemDto
  -> MenuController.create(user, dto)
  -> MenuService.create(requesterId, isAdmin, dto)
  -> RestaurantService.findOne(dto.restaurantId)
  -> ownership check
  -> MenuRepository.create(dto)
  -> Drizzle insert into menu_items
  -> created row returned
```

### Step by step

1. Request hits `MenuController.create()`.
2. `JwtAuthGuard` checks the bearer token and populates `request.user`.
3. `RolesGuard` checks `@Roles('admin', 'restaurant')`.
4. `ValidationPipe` validates the request body against `CreateMenuItemDto`.
5. `@CurrentUser()` extracts the user payload from `request.user`.
6. `MenuService.create()` fetches the restaurant using `RestaurantService.findOne(dto.restaurantId)`.
7. If the caller is not admin and does not own the restaurant, it throws `ForbiddenException`.
8. `MenuRepository.create()` inserts into `menu_items`.
9. The created DB row is returned.

## 5. API Mapping

### Concrete routes declared in the inspected files

| Method   | Path                                            | Handler                           | Service                        | Repository / DB                                 |
| -------- | ----------------------------------------------- | --------------------------------- | ------------------------------ | ----------------------------------------------- |
| `GET`    | `/api`                                          | `AppController.getHello`          | `AppService.getHello`          | none                                            |
| `GET`    | `/api/restaurants`                              | `RestaurantController.findAll`    | `RestaurantService.findAll`    | `RestaurantRepository.findAll -> restaurants`   |
| `GET`    | `/api/restaurants/:id`                          | `RestaurantController.findOne`    | `RestaurantService.findOne`    | `RestaurantRepository.findById -> restaurants`  |
| `POST`   | `/api/restaurants`                              | `RestaurantController.create`     | `RestaurantService.create`     | `RestaurantRepository.create -> restaurants`    |
| `PATCH`  | `/api/restaurants/:id`                          | `RestaurantController.update`     | `RestaurantService.update`     | `RestaurantRepository.update -> restaurants`    |
| `DELETE` | `/api/restaurants/:id`                          | `RestaurantController.remove`     | `RestaurantService.remove`     | `RestaurantRepository.remove -> restaurants`    |
| `GET`    | `/api/menu-items/categories`                    | `MenuController.getCategories`    | `MenuService.getCategories`    | none                                            |
| `GET`    | `/api/menu-items?restaurantId=...&category=...` | `MenuController.findByRestaurant` | `MenuService.findByRestaurant` | `MenuRepository.findByRestaurant -> menu_items` |
| `GET`    | `/api/menu-items/:id`                           | `MenuController.findOne`          | `MenuService.findOne`          | `MenuRepository.findById -> menu_items`         |
| `POST`   | `/api/menu-items`                               | `MenuController.create`           | `MenuService.create`           | `MenuRepository.create -> menu_items`           |
| `PATCH`  | `/api/menu-items/:id`                           | `MenuController.update`           | `MenuService.update`           | `MenuRepository.update -> menu_items`           |
| `PATCH`  | `/api/menu-items/:id/sold-out`                  | `MenuController.toggleSoldOut`    | `MenuService.toggleSoldOut`    | `MenuRepository.update -> menu_items`           |
| `DELETE` | `/api/menu-items/:id`                           | `MenuController.remove`           | `MenuService.remove`           | `MenuRepository.remove -> menu_items`           |

### Auth route note

- `/apps/api/src/main.ts` merges Better Auth OpenAPI routes under `/api/auth/*`.
- The exact route list is generated dynamically by Better Auth and is not explicitly declared in the provided files, so I am not enumerating those endpoints here.

## 6. Database and Data Flow

### ORM and database

- ORM: **Drizzle ORM** with `drizzle-orm/node-postgres`
- Database: **PostgreSQL**
- Migration / schema tooling: **drizzle-kit**

### Tables visible in the provided files

- Auth tables from `/apps/api/src/module/auth/auth.schema.ts`
  - `user`
  - `session`
  - `account`
  - `verification`

- Business tables
  - `restaurants` from `/apps/api/src/module/restaurant-catalog/restaurant/restaurant.schema.ts`
  - `menu_items` from `/apps/api/src/module/restaurant-catalog/menu/menu.schema.ts`

### Relationships and enums

- `menu_items.restaurant_id -> restaurants.id`
  - delete behavior: `onDelete: 'cascade'`
- Menu enums:
  - `menu_item_category`
  - `menu_item_status`

### Data movement across layers

```text
Request body / params / query
  -> DTO validation
  -> Controller method
  -> Service rule checks
  -> Repository query
  -> Drizzle schema/table mapping
  -> PostgreSQL row(s)
  -> Service return value
  -> JSON response
```

### Business rules currently enforced in services

- `RestaurantService.findOne()` throws if a restaurant does not exist.
- `RestaurantService.update()` allows admins to edit any restaurant, but restaurant users only their own.
- `RestaurantService.assertOpenAndApproved()` enforces approval/open status.
- `MenuService.create()` verifies the restaurant exists and checks ownership.
- `MenuService.toggleSoldOut()` flips status between `available` and `out_of_stock`.
- `MenuService.assertOwnership()` fetches both the menu item and its restaurant to validate ownership.

## 7. Visual Diagrams

### Request flow diagram

```text
HTTP request
  -> main.ts runtime config
  -> guard(s)
  -> controller
  -> service
  -> repository
  -> Drizzle ORM
  -> PostgreSQL
  -> response
```

### Restaurant update flow

```text
PATCH /api/restaurants/:id
  -> JwtAuthGuard
  -> RolesGuard(admin, restaurant)
  -> ParseUUIDPipe + ValidationPipe
  -> RestaurantController.update
  -> RestaurantService.findOne
  -> owner/admin check
  -> RestaurantRepository.update
  -> restaurants table
  -> updated row
```

### Menu ownership flow

```text
MenuController.update/remove/toggleSoldOut
  -> MenuService.assertOwnership(itemId, requesterId, isAdmin)
     -> MenuService.findOne(itemId)
        -> MenuRepository.findById
     -> RestaurantService.findOne(item.restaurantId)
        -> RestaurantRepository.findById
     -> owner check
  -> MenuRepository.update/remove
```

## 8. Code Navigation Guide

### Open these files first

1. `/apps/api/src/main.ts`
   - This explains how the app really runs in development and production.
2. `/apps/api/src/app.module.ts`
   - This shows what the live system actually wires together.
3. `/apps/api/src/module/restaurant-catalog/restaurant/restaurant.controller.ts`
   - Fastest way to see the restaurant API surface.
4. `/apps/api/src/module/restaurant-catalog/restaurant/restaurant.service.ts`
   - Shows ownership rules and exception behavior.
5. `/apps/api/src/module/restaurant-catalog/restaurant/restaurant.repository.ts`
   - Shows the real DB operations.
6. `/apps/api/src/module/restaurant-catalog/menu/menu.controller.ts`
   - Shows the menu API and its write actions.
7. `/apps/api/src/module/restaurant-catalog/menu/menu.service.ts`
   - Most important file if you want to add business rules around menus.
8. `/apps/api/src/lib/auth.ts`
   - Shows how Better Auth is mounted.
9. `/apps/api/src/module/auth/guards/jwt-auth.guard.ts`
   - Critical because the current auth behavior is placeholder logic.
10. `/apps/api/docs/public-api-pattern.md`
    - Use this if you want new modules to follow the intended architecture rather than the current shortcut.

### Most important practical reading order

```text
main.ts
  -> app.module.ts
  -> restaurant.controller.ts
  -> restaurant.service.ts
  -> restaurant.repository.ts
  -> menu.controller.ts
  -> menu.service.ts
  -> menu.repository.ts
  -> schema files
```

## 9. Feature Implementation Guidance

### If you add a new endpoint inside an existing feature

Modify these layers in this order:

1. DTO file
   - Restaurant: `/apps/api/src/module/restaurant-catalog/restaurant/dto/restaurant.dto.ts`
   - Menu: `/apps/api/src/module/restaurant-catalog/menu/dto/menu.dto.ts`
2. Controller
   - Add the route method, params/body/query binding, guards, and Swagger docs.
3. Service
   - Add business rules, ownership checks, and exception behavior.
4. Repository
   - Add the Drizzle query.
5. Schema and migration config if persistence changes are needed
   - Update the Drizzle schema file and run the DB workflow.

### If you add a new persisted field

Update these files together:

1. Schema file
   - `/apps/api/src/module/restaurant-catalog/restaurant/restaurant.schema.ts`
   - or `/apps/api/src/module/restaurant-catalog/menu/menu.schema.ts`
2. DTO file for input and response
3. Repository create/update query shape
4. Swagger docs via DTO metadata or response schema
5. Drizzle migration workflow through `/apps/api/drizzle.config.ts`

### If you add a new feature module following the current code style

Create a new folder like:

```text
/apps/api/src/module/<context>/<feature>/
  <feature>.module.ts
  <feature>.controller.ts
  <feature>.service.ts
  <feature>.repository.ts
  <feature>.schema.ts
  dto/
```

Then wire it in:

1. Export schema from `/apps/api/src/drizzle/schema.ts`
2. Import the new module into its context aggregator or directly into `/apps/api/src/app.module.ts`
3. If another feature needs it, decide whether to follow the current direct-service style or the stricter `public-api-pattern.md` design

### Validation, error handling, and edge cases to include

- Use DTO validation with `class-validator`.
- Use `ParseUUIDPipe` for path ids.
- Throw `NotFoundException` when referenced records do not exist.
- Throw `ForbiddenException` for ownership and approval rules.
- Throw `UnauthorizedException` only for auth failures.
- Check these edge cases before writing new code:
  - restaurant does not exist
  - menu item does not exist
  - caller does not own the restaurant
  - restaurant is closed or not approved
  - delete restaurant should also remove dependent menu items because of cascade delete
  - query parameters may be missing or malformed

### Practical implementation playbook for this repo

```text
new route
  -> define DTO
  -> add controller method
  -> add service method with exception rules
  -> add repository query
  -> update schema if needed
  -> add Swagger docs
  -> add unit/e2e coverage
```

## 10. Impact and Safety

### What could break if you modify this code

- **Auth behavior is currently stubbed**
  - Replacing `JwtAuthGuard` with real JWT verification will change every protected endpoint's behavior.

- **Role-protected write endpoints are effectively blocked right now**
  - The current guard only injects `roles: ['user']`, so endpoints requiring `admin` or `restaurant` will fail.

- **The runtime prefix is `/api`**
  - Any client, test, or reverse proxy that calls unprefixed routes will break in the real app.

- **Tests do not mirror `main.ts` bootstrap behavior**
  - `/apps/api/test/app.e2e-spec.ts` creates `AppModule` directly, so the global prefix and validation pipe from `main.ts` are not applied there.

- **Cross-feature coupling exists**
  - `MenuService` depends directly on `RestaurantService`, so restaurant API changes can indirectly affect menu writes.

- **Cascade delete exists from restaurant to menu items**
  - Deleting a restaurant removes its menu items automatically at the DB level.

- **Docs describe a broader future architecture than the live code**
  - If you implement features by following only `bounded-context.md`, you may build modules the runtime app does not yet wire in.

### What you should test after changes

1. Controller-level happy path and error path.
2. Ownership and role checks.
3. Validation failures for malformed DTOs.
4. Repository query correctness against the real schema.
5. E2E behavior with the real `/api` prefix.
6. Auth flow if you touch `lib/auth.ts` or the guards.
7. Cascade delete behavior if you touch restaurant removal or menu foreign keys.

## 11. High-Value Observations

- The **live implemented domain is smaller** than the design docs suggest. Right now the visible business backend is mostly restaurant and menu management plus auth persistence.
- The **current auth guard is the most important caveat** in the codebase because it changes how you should reason about security and even whether write endpoints can be exercised.
- The **best template for adding a safe feature** is to copy the restaurant or menu slice pattern: controller, service, repository, DTO, schema, module.
- The **most reusable business rule location** is the service layer, not the controller.
- The **strict public API pattern exists only as documentation today**, not as the main runtime enforcement mechanism.

## 12. Recommended Next File To Open

- If your next task is API behavior: open `/apps/api/src/module/restaurant-catalog/menu/menu.service.ts`
- If your next task is auth/security: open `/apps/api/src/module/auth/guards/jwt-auth.guard.ts`
- If your next task is schema changes: open `/apps/api/src/module/restaurant-catalog/menu/menu.schema.ts`
- If your next task is adding a new module the right way: open `/apps/api/docs/public-api-pattern.md`
