# E2E Testing Playbook — Menu + Modifier Modules

> **Audience**: Backend engineers and AI coding agents working on new modules (cart, ordering, delivery, etc.).
> **Purpose**: A single, self-contained reference that explains _how_ E2E tests are structured, _why_ decisions were made, and _how to extend_ this setup to any new module — without re-reading the entire codebase.
>
> **Last verified against codebase**: All 52 tests passing (4 suites). Auth system fully dynamic — no hardcoded tokens.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Project Test Architecture](#2-project-test-architecture)
3. [Environment Setup](#3-environment-setup)
4. [Authentication Handling in E2E](#4-authentication-handling-in-e2e)
5. [Data Seeding Strategy](#5-data-seeding-strategy)
6. [Writing E2E Tests — The Standard Pattern](#6-writing-e2e-tests--the-standard-pattern)
7. [Snapshot Testing Strategy](#7-snapshot-testing-strategy)
8. [Covered Test Scenarios](#8-covered-test-scenarios)
9. [Common Pitfalls & Lessons Learned](#9-common-pitfalls--lessons-learned)
10. [How to Extend for Other Modules](#10-how-to-extend-for-other-modules)
11. [Best Practices](#11-best-practices)

---

## 1. Overview

### Why E2E Tests?

Unit tests and integration tests validate individual functions and service layers in isolation. E2E tests validate the **full request lifecycle** — HTTP routing, guards, pipes, service logic, ORM queries, database writes, and cross-module side-effects — in one shot.

For this project, E2E tests are _mandatory_ because:

- **CQRS projections**: A menu item update fires an internal event. The ordering snapshot must be updated as a side-effect. Only E2E tests can verify the projection actually ran.
- **Auth guards**: The `@thallesp/nestjs-better-auth` guard validates real JWT tokens via the Better Auth service. Mocking this at the test level is unreliable (see [Section 9](#9-common-pitfalls--lessons-learned)).
- **Cross-module contracts**: The `ordering` BC reads from `ordering_menu_item_snapshots` which is _written_ by the `restaurant-catalog` BC. E2E tests are the only way to verify the handshake works.
- **Validation pipeline**: DTO validation (`class-validator` + `ValidationPipe`) is only exercised through HTTP.

### Scope of Current E2E Coverage

| Module                                           | Status                               |
| ------------------------------------------------ | ------------------------------------ |
| `restaurant-catalog` → Menu Items                | ✅ Covered (`menu.e2e-spec.ts`)      |
| `restaurant-catalog` → Modifier Groups & Options | ✅ Covered (`modifiers.e2e-spec.ts`) |
| `ordering` → Snapshot Projection                 | ✅ Covered (`snapshot.e2e-spec.ts`)  |
| `ordering` → Cart                                | ⬜ Not yet covered                   |
| `ordering` → Orders                              | ⬜ Not yet covered                   |
| `auth`                                           | ⬜ Not yet covered                   |
| `delivery`                                       | ⬜ Not yet covered                   |

---

## 2. Project Test Architecture

### Folder Structure

```
apps/api/
├── test/
│   ├── jest-e2e.json            # Jest configuration for E2E
│   ├── app.e2e-spec.ts          # Smoke test for root endpoint (GET /)
│   │
│   ├── e2e/                     # One spec per feature domain
│   │   ├── menu.e2e-spec.ts
│   │   ├── modifiers.e2e-spec.ts
│   │   └── snapshot.e2e-spec.ts
│   │
│   ├── helpers/                 # Shared test utilities
│   │   ├── auth.ts              # Header factories (ownerHeaders, otherUserHeaders, noAuthHeaders)
│   │   ├── test-auth.ts         # TestAuthManager — dynamic sign-up + role grant
│   │   └── db.ts                # Direct DB query helpers (getSnapshot, etc.)
│   │
│   └── setup/
│       ├── app-factory.ts       # Boots NestJS app; mirrors main.ts setup
│       ├── db-setup.ts          # DB connection, reset, seed utilities, email constants
│       └── env-setup.ts         # Loads .env.test (or .env) before Jest runs
```

### How the NestJS App Is Bootstrapped

`test/setup/app-factory.ts` creates a _real_ NestJS application using the same `AppModule` as production. There are **no module mocks**:

```typescript
// test/setup/app-factory.ts
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule], // Real AppModule — all guards, pipes, modules live
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.setGlobalPrefix('api'); // Must match production prefix

  await app.init();
  return app;
}

export async function teardownTestApp(app: INestApplication): Promise<void> {
  await app.close(); // Closes HTTP server + all module connections
}
```

**Key design decision**: `app.setGlobalPrefix('api')` is repeated here explicitly because `Test.createTestingModule` does _not_ inherit the prefix from `main.ts`. All test requests use `/api/...` paths.

### How Supertest Interacts with the App

```typescript
const http = request(app.getHttpServer()); // Supertest wraps the Node HTTP server

// Usage in a test:
const res = await http
  .post('/api/menu-items')
  .set(ownerHeaders()) // Authorization: Bearer <token>
  .send({ name: 'Pizza', price: 12 });

expect(res.status).toBe(201);
```

`request(app.getHttpServer())` binds Supertest directly to the NestJS HTTP server without starting it on a port. No ports, no `localhost`, no network.

### How the DB Is Accessed Inside Tests

There are two DB access patterns in tests:

| Pattern              | When to use                                                         | How                              |
| -------------------- | ------------------------------------------------------------------- | -------------------------------- |
| **Via HTTP**         | When the operation fires events / updates projections               | `await http.post('/api/...')`    |
| **Direct ORM query** | When asserting state not exposed by the API (e.g. snapshot columns) | `getTestDb()` from `db-setup.ts` |

```typescript
// Direct DB assertion — test/helpers/db.ts
import { getTestDb } from '../setup/db-setup';

export async function getSnapshot(menuItemId: string) {
  const db = getTestDb();
  const rows = await db
    .select()
    .from(orderingMenuItemSnapshots)
    .where(eq(orderingMenuItemSnapshots.menuItemId, menuItemId))
    .limit(1);
  return rows[0] ?? null;
}
```

**Rule**: Always create/update data through the HTTP API (so projections fire). Only use direct DB queries for _reading_ state in assertions.

---

## 3. Environment Setup

### Environment Variables

| Variable             | Required | Description                                              |
| -------------------- | -------- | -------------------------------------------------------- |
| `DATABASE_URL`       | ✅       | PostgreSQL connection string for app + migrations        |
| `TEST_DATABASE_URL`  | Optional | Separate test DB; falls back to `DATABASE_URL`           |
| `BETTER_AUTH_SECRET` | ✅       | Secret for JWT signing (Better Auth)                     |
| `BETTER_AUTH_URL`    | ✅       | Base URL for Better Auth (e.g. `http://localhost:3000`)  |
| `REDIS_HOST`         | ✅       | Redis host (used by OrderingModule for cart/idempotency) |
| `REDIS_PORT`         | ✅       | Redis port (default: `6379`)                             |

### .env Resolution Order

`test/setup/env-setup.ts` runs as a Jest `setupFile` (before any test file executes):

```typescript
// Loaded via setupFiles in jest-e2e.json
const envTest = path.join(root, '.env.test');
const envDev = path.join(root, '.env');

if (fs.existsSync(envTest)) {
  dotenv.config({ path: envTest, override: true }); // preferred
} else if (fs.existsSync(envDev)) {
  dotenv.config({ path: envDev, override: true }); // fallback
}
```

**To use a dedicated test database**, create `.env.test` with a different `DATABASE_URL` pointing to `food_order_test`. If `.env.test` does not exist, tests run against the dev database — **dangerous in CI** but acceptable locally.

### Running Migrations for the Test DB

`drizzle.config.ts` reads `DATABASE_URL` from the environment. To migrate the test DB:

```powershell
# Set TEST DB as target, then migrate
$env:DATABASE_URL = "postgresql://food_order:foodordersecret@localhost:5433/food_order_test"
pnpm db:migrate
```

Or in `.env.test`:

```
DATABASE_URL=postgresql://food_order:foodordersecret@localhost:5433/food_order_test
```

### Docker Services

```yaml
# docker-compose.yml (relevant services)
postgres:
  container_name: food_order_db
  ports: ['5433:5432'] # host:container — always use 5433 on localhost

redis:
  container_name: food_order_redis
  ports: ['6379:6379']
```

Both must be running before tests execute. Start with: `docker compose up -d`

### Jest ESM Configuration

The auth library (`@thallesp/nestjs-better-auth`) ships `.mjs` files. Jest requires explicit ESM support:

```json
// test/jest-e2e.json (key settings)
{
  "preset": "ts-jest/presets/default-esm",
  "extensionsToTreatAsEsm": [".ts"],
  "transform": {
    "^.+\\.tsx?$": [
      "ts-jest",
      { "useESM": true, "tsconfig": { "module": "esnext" } }
    ]
  }
}
```

The test script in `package.json` must include the experimental flag:

```json
"test:e2e": "node --experimental-vm-modules node_modules/jest/bin/jest.js --config ./test/jest-e2e.json"
```

---

## 4. Authentication Handling in E2E

### Authentication Stack

The app uses `@thallesp/nestjs-better-auth` v2.5.3 with the `bearer` plugin enabled. Every guarded endpoint calls `auth.api.getSession()` internally, which validates the Bearer token and re-reads the current `user` row from the DB on every request.

**Key property**: Because sessions are DB-backed (not JWT-stateless), a role change takes effect on the _next_ request without requiring a new sign-in.

### Token Acquisition — `TestAuthManager`

**There are no hardcoded tokens.** Tokens are obtained dynamically at the start of each test suite via `test/helpers/test-auth.ts`.

```typescript
// test/helpers/test-auth.ts
export class TestAuthManager {
  get ownerToken(): string { ... }   // throws if not initialized
  get otherToken(): string { ... }
  get ownerUserId(): string { ... }  // real UUID assigned by Better Auth

  async initialize(http: ReturnType<typeof request<App>>): Promise<void> {
    // 1. Sign up both users in parallel via POST /api/auth/sign-up/email
    // 2. Directly update user.role = 'restaurant' via Drizzle for both users
  }
}
```

**Sign-up endpoint**: `POST /api/auth/sign-up/email`

```json
// Request body
{ "email": "e2e-owner@test.soli", "password": "TestAuth1234!", "name": "E2E Owner" }

// Response (Better Auth + bearer() plugin)
{ "token": "<session-token>", "user": { "id": "<uuid>", ... } }
```

The `token` field is a Better Auth **session token** (opaque string, not a JWT). Used as `Authorization: Bearer <token>`. No expiry concern within a single test run.

### Why Two Users?

| User                  | Role         | Restaurant ownership             | Expected result                   |
| --------------------- | ------------ | -------------------------------- | --------------------------------- |
| `e2e-owner@test.soli` | `restaurant` | `user.id === restaurant.ownerId` | 200/201 on writes                 |
| `e2e-other@test.soli` | `restaurant` | `user.id ≠ restaurant.ownerId`   | 403 on ownership-protected writes |

Both users need the `restaurant` role to **reach** the ownership check. Without the role, the request would get a 403 from the role guard — not from the ownership check — making 403 ownership tests semantically wrong. Role is granted via direct Drizzle UPDATE after sign-up:

```typescript
await db
  .update(user)
  .set({ role: 'restaurant' })
  .where(inArray(user.id, userIds));
```

### Test Email Constants

Defined in `test/setup/db-setup.ts` (NOT in `test-auth.ts`) to prevent a circular import:

```typescript
// db-setup.ts imports getTestDb; test-auth.ts imports from db-setup
// If emails lived in test-auth.ts, db-setup importing them → circular
export const TEST_OWNER_EMAIL = 'e2e-owner@test.soli';
export const TEST_OTHER_EMAIL = 'e2e-other@test.soli';
export const TEST_USER_EMAILS = [TEST_OWNER_EMAIL, TEST_OTHER_EMAIL] as const;
```

Password lives only in `test-auth.ts`: `export const TEST_PASSWORD = 'TestAuth1234!'`.

### Header Factories — `test/helpers/auth.ts`

```typescript
let _manager: TestAuthManager | null = null;

// Called once in beforeAll() after testAuth.initialize()
export function setAuthManager(mgr: TestAuthManager): void {
  _manager = mgr;
}

// Authenticated owner — passes @Roles guard AND ownership check → 200/201
export function ownerHeaders(): TestHeaders {
  return { Authorization: `Bearer ${_manager!.ownerToken}` };
}

// Authenticated non-owner — passes @Roles guard, FAILS ownership check → 403
export function otherUserHeaders(): TestHeaders {
  return { Authorization: `Bearer ${_manager!.otherToken}` };
}

// Alias for ownerHeaders() — emphasises role rather than ownership
export function restaurantRoleHeaders(): TestHeaders {
  return ownerHeaders();
}

// No Authorization header → triggers 401
export function noAuthHeaders(): TestHeaders {
  return {};
}
```

`_manager` starts as `null` in every spec file (Jest module isolation). If any header factory is called before `setAuthManager()`, it throws a descriptive error.

### The Full `beforeAll` Pattern (All Specs)

```typescript
beforeAll(async () => {
  app = await createTestApp();
  http = request(app.getHttpServer());

  // 1. Wipe DB — deletes test users (by email), snapshots, restaurants
  await resetDb();

  // 2. Sign up fresh users, get real tokens, grant 'restaurant' role
  const testAuth = new TestAuthManager();
  await testAuth.initialize(http);

  // 3. Wire the module-level _manager in auth.ts
  setAuthManager(testAuth);

  // 4. Seed the restaurant with the owner's REAL UUID
  //    restaurant.ownerId must equal session.user.id for ownership checks to work
  await seedBaseRestaurant(testAuth.ownerUserId);

  // 5. (spec-dependent) Create additional entities via HTTP
  //    e.g. menu items, modifier groups
});
```

### Attaching Headers with Supertest

```typescript
// Guarded write — authenticated owner
const res = await http
  .post('/api/menu-items')
  .set(ownerHeaders()) // { Authorization: 'Bearer <token>' }
  .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Pizza', price: 10 });

// Public read — no auth required
const res = await http
  .get(`/api/menu-items?restaurantId=${TEST_RESTAURANT_ID}`)
  .set(noAuthHeaders()); // {} — no header set at all
```

Always use `.set()` — never `.auth()` — to attach headers.

---

## 5. Data Seeding Strategy

### Philosophy

> **Create entities via the HTTP API, not direct DB inserts — unless the entity is infrastructure (e.g. the restaurant itself).**

Creating via the API ensures that all domain events fire, projections update, and the system state is consistent. Direct DB inserts bypass this and cause snapshot/projection divergence.

**Exception**: The parent restaurant is inserted directly because:

1. It has no projection side-effects relevant to menu tests.
2. It requires an `ownerId` that must equal the authenticated user's real user ID — only known after `TestAuthManager.initialize()`.

### Fixed UUIDs

Only the restaurant uses a fixed UUID. User UUIDs are assigned dynamically by Better Auth at sign-up time.

```typescript
// test/setup/db-setup.ts
// Restaurant ID is fixed — used in URL paths throughout all test suites
export const TEST_RESTAURANT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

// User IDs are NOT fixed — obtained at runtime from TestAuthManager.ownerUserId
// TEST_OWNER_ID and TEST_OTHER_USER_ID no longer exist
```

`TEST_RESTAURANT_ID` is intentionally different from `src/drizzle/seeds/seed.ts` values to prevent collisions when tests run against the same DB as development.

### Seeding Flow (Per Suite)

Every `*.e2e-spec.ts` follows this pattern in `beforeAll`:

```typescript
beforeAll(async () => {
  app = await createTestApp();
  http = request(app.getHttpServer());

  // 1. Wipe DB (snapshots + restaurants + test users)
  await resetDb();

  // 2. Sign up fresh users, get tokens, grant 'restaurant' role
  const testAuth = new TestAuthManager();
  await testAuth.initialize(http);
  setAuthManager(testAuth);

  // 3. Insert the base restaurant using the owner's REAL UUID
  await seedBaseRestaurant(testAuth.ownerUserId);

  // 4. Create module-specific entities via HTTP (fires domain events)
  const itemRes = await http
    .post('/api/menu-items')
    .set(ownerHeaders())
    .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Test Item', price: 10 });
  menuItemId = itemRes.body.id as string;
});
```

### `resetDb()` Delete Order

```typescript
// test/setup/db-setup.ts
export async function resetDb(): Promise<void> {
  const db = getTestDb();
  // 1. ordering_menu_item_snapshots — no FK, must go before restaurant cascade
  await db.delete(orderingMenuItemSnapshots);
  // 2. restaurants — cascade-deletes menu_items, modifier_groups, modifier_options
  await db.delete(restaurants);
  // 3. test users (by email) — cascade-deletes their sessions + accounts
  await resetUsers(); // deletes rows WHERE email IN (TEST_OWNER_EMAIL, TEST_OTHER_EMAIL)
}
```

Targeting users by email (not `DELETE ALL`) makes `resetDb()` safe to run against a shared dev database that may have real accounts.

### `seedBaseRestaurant(ownerId: string)`

```typescript
export async function seedBaseRestaurant(ownerId: string): Promise<void> {
  const db = getTestDb();
  await db.insert(restaurants).values({
    id: TEST_RESTAURANT_ID,
    ownerId, // ← dynamic UUID from TestAuthManager.ownerUserId
    name: 'E2E Test Restaurant',
    description: 'Seeded for automated E2E tests',
    address: '1 Test Street, Ho Chi Minh City',
    phone: '+84-000-000-0000',
    isOpen: true,
    isApproved: true,
  });
}
```

**Critical**: `ownerId` must equal `session.user.id` for the signed-in owner. This is guaranteed by passing `testAuth.ownerUserId` (the UUID that Better Auth assigned during sign-up). If they differ, ownership checks produce wrong results (403 where 200 is expected, or vice versa).

---

## 6. Writing E2E Tests — The Standard Pattern

Every test follows **Arrange → Act → Assert (HTTP) → Assert (DB)**.

### Full Example: Create + Snapshot Assertion

```typescript
describe('POST /api/menu-items', () => {
  it('creates a menu item and its ordering snapshot', async () => {
    // ─── Arrange ─────────────────────────────────────────────────────────
    // (data already seeded in beforeAll: restaurant exists, DB is clean)

    // ─── Act ─────────────────────────────────────────────────────────────
    const res = await http.post('/api/menu-items').set(ownerHeaders()).send({
      restaurantId: TEST_RESTAURANT_ID,
      name: 'Margherita Pizza',
      price: 12.5,
    });

    // ─── Assert: HTTP response ────────────────────────────────────────────
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      restaurantId: TEST_RESTAURANT_ID,
      name: 'Margherita Pizza',
      price: 12.5,
      status: 'available',
    });
    expect(res.body.id).toBeDefined();

    // ─── Assert: DB state ─────────────────────────────────────────────────
    const snapshot = await getSnapshot(res.body.id);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.modifiers).toEqual([]); // empty array, never null
  });
});
```

### Security Test Pattern (401)

```typescript
it('returns 401 when unauthenticated', async () => {
  const res = await http
    .post('/api/menu-items')
    .set(noAuthHeaders()) // {} = no Authorization header
    .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Hack', price: 1 });

  expect(res.status).toBe(401);
  // No DB assertion needed — the guard fires before any DB interaction
});
```

### Cascade Delete Pattern

```typescript
it('cascade-deletes the child option when parent group is deleted', async () => {
  // Delete the parent (group)
  await http
    .delete(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
    .set(ownerHeaders());

  // Assert child (option) is gone via the API
  const optionRes = await http
    .get(
      `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
    )
    .set(noAuthHeaders());

  expect(optionRes.status).toBe(404);

  // Also assert DB-level state if needed
  const snapshot = await getSnapshot(menuItemId);
  const groupIds = (snapshot!.modifiers as { groupId: string }[]).map(
    (g) => g.groupId,
  );
  expect(groupIds).not.toContain(groupId);
});
```

### Nested `beforeAll` Pattern for Stateful Tests

Tests within a `describe` block that share state use a local `beforeAll`:

```typescript
describe('PATCH /api/menu-items/:id', () => {
  let itemId: string; // scoped to this describe block

  beforeAll(async () => {
    const res = await http
      .post('/api/menu-items')
      .set(ownerHeaders())
      .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Tiramisu', price: 6.5 });
    itemId = res.body.id as string;
  });

  it('updates name', async () => {
    /* ... uses itemId */
  });
  it('returns 401 unauthenticated', async () => {
    /* ... uses itemId */
  });
});
```

**Warning**: Tests inside a `describe` block run sequentially but **share state**. If one test mutates `itemId`'s resource, subsequent tests in the same block see that mutation. Design tests so they don't interfere with each other's shared state.

---

## 7. Snapshot Testing Strategy

### What Is `ordering_menu_item_snapshots`?

It is a **read model** (projection) in the `ordering` bounded context. When the `restaurant-catalog` BC mutates a menu item or its modifiers, it publishes a domain event. The `ordering` BC handles that event and writes/updates a row in `ordering_menu_item_snapshots`.

The row structure:

```
ordering_menu_item_snapshots {
  menuItemId   UUID      (references menu_items.id — logical FK, no DB constraint)
  name         text
  price        decimal
  status       enum('available', 'out_of_stock', 'unavailable')
  modifiers    jsonb     -- array of { groupId, name, minSelections, maxSelections, options: [...] }
  lastSyncedAt timestamp
}
```

### Why DB-Level Assertions?

The snapshot contents are **not exposed** by the `restaurant-catalog` API. The only way to verify the projection updated correctly is to query the `ordering` BC's table directly:

```typescript
const snapshot = await getSnapshot(menuItemId);
expect(snapshot!.modifiers).not.toBeNull();
```

### The Core Invariant

**Non-modifier updates must preserve existing modifier data.**

When a menu item's `name` or `price` changes, the snapshot projector must merge the new field into the existing snapshot — it must **NOT** overwrite `modifiers` with `[]`.

Only modifier-specific events (`createGroup`, `deleteGroup`, `createOption`, etc.) are allowed to change the `modifiers` column.

This was the primary bug class driving the snapshot test suite:

```typescript
// snapshot.e2e-spec.ts — Section 2.1
it('snapshot modifiers are unchanged after name update', async () => {
  await http
    .patch(`/api/menu-items/${menuItemId}`)
    .set(ownerHeaders())
    .send({ name: 'Updated Name' });

  const snapshot = await getSnapshot(menuItemId);
  // Must still contain the Size group with Large + Small options
  await assertSizeGroupPresent('after name update');
});
```

### Tombstone on Delete

When a menu item is deleted, the snapshot is NOT removed. Instead it is **tombstoned**:

```
status    = 'unavailable'
modifiers = []             ← intentional clear
```

This allows the ordering BC to gracefully handle carts that still reference the deleted item.

### `lastSyncedAt` Invariant

Every mutation must advance `lastSyncedAt`. This verifies the projector is actually running (not a cached/stale result):

```typescript
const before = await getSnapshot(menuItemId);
await http
  .patch(`/api/menu-items/${menuItemId}`)
  .set(ownerHeaders())
  .send({ name: 'New Name' });
const after = await getSnapshot(menuItemId);
expect(after!.lastSyncedAt.getTime()).toBeGreaterThan(
  before!.lastSyncedAt.getTime(),
);
```

---

## 8. Covered Test Scenarios

### `menu.e2e-spec.ts` — Menu Item CRUD

| #   | Scenario                               | Method + Path                          | Expected                         |
| --- | -------------------------------------- | -------------------------------------- | -------------------------------- |
| 1.1 | Create item (authenticated owner)      | `POST /api/menu-items`                 | 201 + item body                  |
| 1.2 | Create item (unauthenticated)          | `POST /api/menu-items`                 | 401                              |
| 1.3 | Create item (non-owner user)           | `POST /api/menu-items`                 | 403                              |
| 2.1 | List items by restaurantId (public)    | `GET /api/menu-items?restaurantId=...` | 200 + array                      |
| 2.2 | Get single item by id (public)         | `GET /api/menu-items/:id`              | 200 + item                       |
| 3.1 | Update item name (owner)               | `PATCH /api/menu-items/:id`            | 200 + updated body               |
| 3.2 | Update item (unauthenticated)          | `PATCH /api/menu-items/:id`            | 401                              |
| 3.3 | Update item (non-owner)                | `PATCH /api/menu-items/:id`            | 403                              |
| 4.1 | Toggle sold-out → out_of_stock         | `PATCH /api/menu-items/:id/sold-out`   | 200 + status                     |
| 4.2 | Toggle sold-out → available            | `PATCH /api/menu-items/:id/sold-out`   | 200 + status                     |
| 5.1 | Delete item                            | `DELETE /api/menu-items/:id`           | 204                              |
| 5.2 | Fetch deleted item                     | `GET /api/menu-items/:id`              | 404                              |
| 5.3 | Snapshot tombstoned after delete       | DB assertion                           | status=unavailable, modifiers=[] |
| 6.1 | New item snapshot has modifiers=[]     | DB assertion                           | modifiers is `[]` not `null`     |
| 6.2 | After price update, modifiers stays [] | DB assertion                           | modifiers still `[]`             |

### `modifiers.e2e-spec.ts` — Modifier Groups & Options

| #    | Scenario                               | Method + Path                         | Expected                         |
| ---- | -------------------------------------- | ------------------------------------- | -------------------------------- |
| 3.1  | Create modifier group                  | `POST .../modifier-groups`            | 201 + group body                 |
| 3.2  | Update group with valid min/max        | `PATCH .../modifier-groups/:id`       | 200                              |
| 3.3  | Update group with min > max            | `PATCH .../modifier-groups/:id`       | 400                              |
| 3.4  | Partial update (maxSelections only)    | `PATCH .../modifier-groups/:id`       | 200, minSelections unchanged     |
| 3.5  | Delete group + cascade options         | `DELETE .../modifier-groups/:id`      | 204; option returns 404          |
| 3.6  | Create modifier option                 | `POST .../options`                    | 201 + option body                |
| 3.7  | Update option price + availability     | `PATCH .../options/:id`               | 200; snapshot reflects new price |
| 3.8  | Delete option                          | `DELETE .../options/:id`              | 204                              |
| 4.1  | GET single group with embedded options | `GET .../modifier-groups/:id`         | 200 + options array              |
| 4.2  | GET flat options list                  | `GET .../modifier-groups/:id/options` | 200 + flat array                 |
| 4.3  | GET single option                      | `GET .../options/:optionId`           | 200 + option body                |
| 4.4  | GET group with wrong menuItemId        | `GET /wrong-id/modifier-groups/:id`   | 404                              |
| 4.5  | GET option with wrong groupId          | `GET .../wrong-group/options/:id`     | 404                              |
| 5.2a | Create group with min=0, max=0         | `POST .../modifier-groups`            | 201 (optional group)             |
| 5.2b | Create group with min > max            | `POST .../modifier-groups`            | 400                              |
| 5.3  | Empty group in snapshot has options=[] | DB assertion                          | emptyGroup.options = []          |
| 5.4  | Write without auth                     | `POST .../modifier-groups`            | 401                              |
| 5.5  | Write by non-owner                     | `POST .../modifier-groups`            | 403                              |
| 5.6  | Non-UUID string as groupId param       | `GET .../modifier-groups/options`     | 400 (ParseUUIDPipe)              |

### `snapshot.e2e-spec.ts` — Modifier Preservation Invariants

| #        | Scenario                                            | Assert | Expected                                 |
| -------- | --------------------------------------------------- | ------ | ---------------------------------------- |
| baseline | Snapshot has Size group (Large + Small) after setup | DB     | modifiers populated                      |
| 2.1      | Update name → modifiers unchanged                   | DB     | Size group still present                 |
| 2.2      | Update price → modifiers unchanged, price updated   | DB     | snapshot.price=15.99, modifiers intact   |
| 2.3a     | First sold-out toggle → modifiers unchanged         | DB     | status=out_of_stock, modifiers intact    |
| 2.3b     | Second sold-out toggle → modifiers unchanged        | DB     | status=available, modifiers intact       |
| inv      | lastSyncedAt advances on every mutation             | DB     | after.lastSyncedAt > before.lastSyncedAt |
| 2.4      | Delete item → snapshot tombstoned                   | DB     | status=unavailable, modifiers=[]         |
| 2.4b     | Deleted item returns 404 from API                   | HTTP   | 404                                      |

---

## 9. Common Pitfalls & Lessons Learned

### ❌ Pitfall 1: `MockAuthGuard` Cannot Override `@thallesp/nestjs-better-auth`

**What happened**: All attempts to override the global guard in tests returned 401 despite the mock being registered.

**Root cause**: The library registers its guard internally in a way that is not replaced by `overrideProvider(APP_GUARD)`, `overrideModule(AuthModule)`, or `app.useGlobalGuards()` in the testing module.

**Lesson**: For auth libraries that register guards at module level (not via `APP_GUARD` token in `AppModule`), you cannot reliably override them in NestJS testing. Use real tokens instead.

**Solution**: Obtain a real Bearer token via the live auth endpoint and embed it in `test/helpers/auth.ts`.

---

### ❌ Pitfall 2: Missing `app.setGlobalPrefix('api')` in Test App

**What happened**: Requests to `/api/menu-items` returned 404.

**Root cause**: `Test.createTestingModule` does not read `main.ts`. The global prefix must be set again in `app-factory.ts`.

**Lesson**: Always replicate the production `main.ts` setup in the test factory — prefix, global pipes, etc.

---

### ❌ Pitfall 3: `__dirname` Not Defined in ESM

**What happened**: `env-setup.ts` crashed with `ReferenceError: __dirname is not defined`.

**Root cause**: The Jest config uses `ts-jest/presets/default-esm`, which processes files as ES Modules. `__dirname` is a CommonJS global and does not exist in ESM.

**Solution**:

```typescript
import { fileURLToPath } from 'url';
import * as path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

---

### ❌ Pitfall 4: Running Migrations Against the Wrong Database

**What happened**: `pnpm db:migrate` ran against the dev DB because `DATABASE_URL` in `.env` was still pointing there.

**Root cause**: `drizzle.config.ts` reads `process.env.DATABASE_URL` directly. If `.env.test` is not loaded first, the wrong DB is targeted.

**Lesson**: When migrating the test DB, either set `DATABASE_URL` in your shell session explicitly, or create `.env.test` with the test DB URL and run migrations in that environment.

---

### ❌ Pitfall 5: `Jest expect()` Takes at Most One Argument

**What happened**: `expect(value, 'message').toBe(x)` caused Jest to throw.

**Root cause**: Jest 30.x `expect()` does not accept a second "message" argument. The signature is `expect(value)` only.

**Solution**: Move the context message to a `// comment` above the assertion:

```typescript
// [after name update] Size group must still be present
expect(sizeGroup).toBeDefined();
```

---

### ❌ Pitfall 6: Tests Hang After Completion (`Jest did not exit`)

**What happened**: Tests passed but Jest never exited, leaving the process hanging.

**Root cause**: Open connections — Drizzle's `node-postgres` connection pool and Redis client in `OrderingModule` are not explicitly closed.

**Mitigation**: `app.close()` in `afterAll` closes NestJS modules (including `onModuleDestroy` hooks). If Redis or DB connections are not properly destroyed in their modules' `onModuleDestroy`, they keep the process alive.

**Current status**: Acceptable for local development. For CI, add `--forceExit` flag or implement `onModuleDestroy` in `RedisModule` and `DatabaseModule`.

---

### ❌ Pitfall 7: Snapshot Null vs `[]` Confusion

**What happened**: After creating a plain menu item (no modifiers), the test assumed `modifiers` would be `null`. It should be `[]`.

**Root cause**: The projector initialises `modifiers = []` on create, not `null`. The distinction matters for ordering-side queries that might do `WHERE modifiers IS NOT NULL`.

**Lesson**: Always assert `toEqual([])` not `toBeNull()` for an item with no modifier groups.

---

### ❌ Pitfall 8: Single Hardcoded Token Made 403 Tests Impossible

**What happened**: `ownerHeaders()`, `otherUserHeaders()`, and `restaurantRoleHeaders()` all returned the same hardcoded token (`BEARER_TOKEN = 'daloudQTcguMbPPnZNWziXsBLPuh5wD0'`). Ownership-check 403 tests returned 201 instead of 403.

**Root cause**: A single token resolves to one user. That user owned the test restaurant. `otherUserHeaders()` was semantically identical to `ownerHeaders()`, so the ownership check always passed.

**Fix**: Replaced with `TestAuthManager` — two real users signed up dynamically, both granted `restaurant` role, restaurant seeded with the owner's real UUID. See Section 4 for full details.

**Key lesson**: For ownership-check 403 tests to work, you need:

1. Two separate users with different user IDs
2. Both must have the role required by the guard (so both reach the ownership check)
3. The test restaurant's `ownerId` must be set to the owner's actual UUID (not a hardcoded constant)

---

### ❌ Pitfall 9: Async Event Handler Causes Race Condition in Snapshot Assertions

**What happened**: Tests that read the snapshot immediately after an HTTP mutation (within the same `it()` block) found `null` or stale data.

**Root cause**: `EventBus.publish()` in NestJS CQRS is synchronous — the event is dispatched — but the `@EventsHandler` decorator registers an **async** handler. `await` on the service call only awaits up to the `eventBus.publish()` call, not the handler's DB write.

Affected tests: those that call `getSnapshot()` in the **same `it()` block** as the mutation.

**Fix**: Add a small delay after the mutation to let the projector complete:

```typescript
// After any mutation that triggers MenuItemProjector:
await new Promise((r) => setTimeout(r, 100));

const snapshot = await getSnapshot(menuItemId);
```

**When you do NOT need the delay**: Snapshot assertions in a **separate `it()` block** from the mutation — Jest runs `it()` blocks sequentially; the mutation's `it()` fully completes (including async side-effects that Node has time to flush) before the next `it()` starts.

**Affected files** (delay applied): `menu.e2e-spec.ts` section 6, `modifiers.e2e-spec.ts` section 5.3, `snapshot.e2e-spec.ts` `lastSyncedAt` invariant test.

---

### ❌ Pitfall 10: `@Min(1)` on `maxSelections` Rejected `max=0`

**What happened**: Test `5.2a — min=0, max=0 is accepted (optional group)` returned 400 instead of 201.

**Root cause**: `CreateModifierGroupDto` had `@Min(1)` on `maxSelections`. The order-placement handler already handles `maxSelections=0` as "no upper limit" (condition: `if (group.maxSelections > 0 && count > group.maxSelections)`). The DTO constraint was inconsistent with the domain logic.

**Fix**: Changed `@Min(1)` → `@Min(0)` on `maxSelections` in `modifiers.dto.ts`.

---

### ❌ Pitfall 11: `GET /` Returned 401 in `app.e2e-spec.ts`

**What happened**: The NestJS root endpoint `GET /` returned 401 because the Better Auth guard was applied globally and the route lacked `@AllowAnonymous()`.

**Fix**: Added `@AllowAnonymous()` decorator to `AppController.getHello()`.

---

## 10. How to Extend for Other Modules

### General Recipe

To add E2E tests for a new module (e.g., `cart`, `ordering`, `delivery`):

#### Step 1: Create the spec file

```
apps/api/test/e2e/<module>.e2e-spec.ts
```

#### Step 2: Copy the boilerplate

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, teardownTestApp } from '../setup/app-factory';
import {
  resetDb,
  seedBaseRestaurant,
  TEST_RESTAURANT_ID,
} from '../setup/db-setup';
import {
  setAuthManager,
  ownerHeaders,
  otherUserHeaders,
  noAuthHeaders,
} from '../helpers/auth';
import { TestAuthManager } from '../helpers/test-auth';

describe('<Module> (E2E)', () => {
  let app: INestApplication<App>;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    await resetDb();
    const testAuth = new TestAuthManager();
    await testAuth.initialize(http);
    setAuthManager(testAuth);
    await seedBaseRestaurant(testAuth.ownerUserId);
    // ... seed module-specific entities via HTTP
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  // ... tests
});
```

#### Step 3: Update `resetDb()` if your module has new tables

If the new module writes to tables not currently deleted by `resetDb()`, add deletions in the correct FK order:

```typescript
// test/setup/db-setup.ts
export async function resetDb(): Promise<void> {
  const db = getTestDb();
  await db.delete(orderingMenuItemSnapshots);
  await db.delete(cartItems); // ← add new tables here (child first)
  await db.delete(carts);
  await db.delete(restaurants); // cascade-deletes menu items
  await resetUsers(); // deletes by email — safe on shared DB
}
```

#### Step 4: Add DB assertion helpers if needed

```typescript
// test/helpers/db.ts
export async function getCart(cartId: string) {
  const db = getTestDb();
  const rows = await db
    .select()
    .from(carts)
    .where(eq(carts.id, cartId))
    .limit(1);
  return rows[0] ?? null;
}
```

---

### Cart Module

**Dependencies**: Menu items must exist before cart items can be added.

**Seeding flow**:

1. `resetDb()` → `TestAuthManager.initialize()` → `setAuthManager()` → `seedBaseRestaurant(ownerUserId)`
2. Create menu item via `POST /api/menu-items`
3. Create modifier group + options via `POST .../modifier-groups` and `POST .../options`
4. Then test cart operations

**Key scenarios to cover**:

- `POST /api/cart` — create/get cart (authenticated user)
- `POST /api/cart/items` — add item with modifiers
- `GET /api/cart` — retrieve cart with totals
- `PATCH /api/cart/items/:id` — update quantity
- `DELETE /api/cart/items/:id` — remove item
- Add item that references a deleted menu item (snapshot `status=unavailable`) → expect error

**New tables to add to `resetDb()`**:

- `cart_items` (before `carts`)
- `carts`

---

### Ordering Module (Orders)

**Dependencies**: Cart must be non-empty; payment intent may be required.

**Seeding flow**:

1. Full menu + modifier setup (as above)
2. Create and populate a cart
3. Submit order

**Key scenarios to cover**:

- `POST /api/orders` — checkout from cart
- `GET /api/orders/:id` — retrieve order with items
- `PATCH /api/orders/:id/status` — update order status (admin/restaurant only)
- Verify `ordering_menu_item_snapshots` are copied into order line items (snapshot isolation)

**New tables to add to `resetDb()`**:

- `order_items` (before `orders`)
- `orders`

---

### Module Dependency Graph

```
restaurant (seed via DB)
  └── menu_item (via HTTP)
        └── modifier_group (via HTTP)
              └── modifier_option (via HTTP)
                    └── ordering_menu_item_snapshots (auto via projector)

cart (seed via HTTP)
  └── cart_item → references menu_item snapshot

order (seed via HTTP from cart)
  └── order_item → snapshot of cart_item at checkout time
```

**Rule**: Always build the dependency chain bottom-up: restaurant → menu → modifiers → snapshot → cart → order.

---

## 11. Best Practices

### Test Isolation

- **One `describe` file per feature domain** — don't mix menu and modifier assertions in the same file unless they're testing a cross-cutting concern.
- **`beforeAll` + `resetDb()` at the top level** — wipes all test data before each spec runs. This makes specs independent of each other.
- **Never rely on test execution order across spec files** — Jest with `maxWorkers: 1` runs specs sequentially, but the order is not guaranteed.

### Avoiding Flaky Tests

- **Use HTTP to create data, never direct DB inserts for domain entities** — otherwise events won't fire and snapshots will be stale.
- **Do not use `Date.now()` directly in assertions** — use `toBeGreaterThan(before)` for timestamp comparisons.
- **For timestamp assertions**, add a small `await new Promise(r => setTimeout(r, 10))` between the "before" snapshot and the mutation to guarantee a measurable time difference.
- **Avoid `toContain` for UUID arrays when order matters** — use `find()` + `toBeDefined()`.

### Reusable Helpers

| Helper                        | Location                    | Purpose                                        |
| ----------------------------- | --------------------------- | ---------------------------------------------- |
| `ownerHeaders()`              | `test/helpers/auth.ts`      | Standard auth header                           |
| `noAuthHeaders()`             | `test/helpers/auth.ts`      | Empty header for 401 tests                     |
| `getSnapshot(id)`             | `test/helpers/db.ts`        | Assert ordering snapshot state                 |
| `createTestApp()`             | `test/setup/app-factory.ts` | Boot NestJS app                                |
| `teardownTestApp()`           | `test/setup/app-factory.ts` | Shut down cleanly                              |
| `resetDb()`                   | `test/setup/db-setup.ts`    | Wipe all test data                             |
| `seedBaseRestaurant(ownerId)` | `test/setup/db-setup.ts`    | Insert test restaurant with dynamic owner UUID |
| `TestAuthManager`             | `test/helpers/test-auth.ts` | Sign up users, get tokens, grant roles         |
| `setAuthManager(mgr)`         | `test/helpers/auth.ts`      | Wire token manager before first header call    |
| `otherUserHeaders()`          | `test/helpers/auth.ts`      | Non-owner auth header for 403 tests            |

Add new helpers to `test/helpers/db.ts` when you need to assert DB state not exposed by any API. Keep HTTP-level assertions inside the spec files.

### Keeping Tests Deterministic

- **Use fixed UUIDs** for seeded data — no `crypto.randomUUID()` in seeds. Fixed UUIDs appear clearly in logs and can be filtered.
- **Test one thing per `it` block** — an `it` block that checks both HTTP status AND DB state is fine; an `it` block that also seeds data for the next test is not.
- **Declare `let id: string` at the `describe` level**, not at the `it` level, when the ID needs to be shared between sibling tests.
- **Use `toMatchObject` for partial body checks** — avoids fragility when the API adds new optional fields.

### CI Considerations

For continuous integration:

1. Add `--forceExit` to the `test:e2e` script if connections don't close cleanly.
2. Ensure the test DB and test `DATABASE_URL` are configured in CI environment variables.
3. Run `docker compose up -d` in the CI pipeline before running tests.
4. Run migrations for the test DB before the test suite: `pnpm db:migrate`.
5. Use a dedicated test database to avoid interfering with dev data.

```yaml
# Example GitHub Actions step
- name: Run E2E Tests
  env:
    DATABASE_URL: postgresql://food_order:foodordersecret@localhost:5433/food_order_test
    BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
    BETTER_AUTH_URL: http://localhost:3000
    REDIS_HOST: localhost
    REDIS_PORT: 6379
  run: |
    cd apps/api
    pnpm db:migrate
    pnpm test:e2e --forceExit
```
