# TEST ARCHITECTURE

## Overview

```
apps/api/test/
├── setup/
│   ├── env-setup.ts        ← Load .env.test before Jest runs
│   ├── app-factory.ts      ← NestJS app + MockAuthGuard
│   └── db-setup.ts         ← Drizzle connection, DB reset, base seed
├── helpers/
│   ├── auth.ts             ← HTTP header factories for auth scenarios
│   └── db.ts               ← Direct DB query helpers for assertions
└── e2e/
    ├── menu.e2e-spec.ts    ← Menu item CRUD + null-vs-[] snapshot invariant
    ├── modifiers.e2e-spec.ts ← Modifier CRUD, GET endpoints, security
    └── snapshot.e2e-spec.ts  ← Modifier preservation on non-modifier updates
```

---

## Why each file exists

### `setup/env-setup.ts`
Loaded via `setupFiles` in `jest-e2e.json`.  Runs in every Jest worker **before** any test code executes.  Loads `.env.test` (or falls back to `.env`) so that `process.env.DATABASE_URL` is set when NestJS modules initialise.

### `setup/app-factory.ts`
Wraps `Test.createTestingModule({ imports: [AppModule] })` and overrides `APP_GUARD` with `MockAuthGuard`.

**Why a mock guard?**  
The real `AuthGuard` from `@thallesp/nestjs-better-auth` calls `auth.api.getSession()` against the Better Auth database, which requires a real JWT.  Creating real sessions in E2E tests would require registering users, logging in, and managing tokens — adding unnecessary complexity.  The `MockAuthGuard` is a faithful drop-in that:
- Sets `request.session = { user: { id, role } }` so `@Session()` in controllers works correctly  
- Respects `@AllowAnonymous()` (public routes)
- Enforces `@Roles()` via the test-supplied `x-test-role` header
- Simulates 401 via `x-test-unauthenticated: true` header

**Everything else in `AppModule` is real**: Drizzle ORM, PostgreSQL, Redis, CqrsModule events, projectors, repositories.

### `setup/db-setup.ts`
Provides a shared Drizzle client and two helpers:
- `resetDb()` — deletes ordering snapshots, then restaurants (which cascades to all menu/modifier data via FK `ON DELETE CASCADE`)
- `seedBaseRestaurant()` — inserts one restaurant owned by `TEST_OWNER_ID`

All operations use the ORM.  No `psql` CLI, no shell scripts.

### `helpers/auth.ts`
Factories for the four identity scenarios every test needs:
- `ownerHeaders()` — admin role, default owner
- `restaurantRoleHeaders()` — restaurant role, same owner (for ownership checks)
- `otherUserHeaders()` — restaurant role, different user (triggers 403)
- `noAuthHeaders()` — signals unauthenticated (triggers 401)

### `helpers/db.ts`
`getSnapshot(menuItemId)` — reads `ordering_menu_item_snapshots` directly.  Used when the API does not expose the exact field being asserted (e.g., verifying the raw `modifiers` JSONB, `lastSyncedAt`, or `status` after a delete).

---

## Test lifecycle

```
Jest worker starts
  └─ env-setup.ts: load .env.test → process.env populated

  describe block (e.g. menu.e2e-spec.ts)
    beforeAll:
      1. createTestApp()         → NestJS boots with real DB, mock guard
      2. resetDb()               → clean slate (no leftover state from other suites)
      3. seedBaseRestaurant()    → insert test restaurant

    tests run (HTTP via supertest + DB assertions via helpers)

    afterAll:
      teardownTestApp()          → close HTTP server + DB connections
```

`maxWorkers: 1` in `jest-e2e.json` ensures spec files run **sequentially** so DB resets don't race each other.

---

## Why real app, mock guard?

| Concern | Approach |
|---------|----------|
| Test what users actually experience | Real NestJS HTTP stack (Express + NestJS) |
| Test DB persistence | Real PostgreSQL via Docker |
| Test cross-BC event flow | Real CqrsModule EventBus → real MenuItemProjector |
| Avoid JWT complexity | MockAuthGuard: identity via simple headers |
| Deterministic data | `resetDb()` in every `beforeAll` |
| No `psql` dependency | Drizzle ORM for all DB operations |

---

## Spec file responsibilities

| File | Sections covered |
|------|-----------------|
| `menu.e2e-spec.ts` | Menu CRUD, delete-tombstones snapshot, null-vs-[] invariant (§5.1), 401/403 |
| `modifiers.e2e-spec.ts` | Group/option CRUD (§3), new GET endpoints (§4), min/max validation (§5.2), empty group snapshot (§5.3), 401/403/ParseUUID guard (§5.4–5.6) |
| `snapshot.e2e-spec.ts` | Modifier preservation on name/price/status updates (§2.1–2.3), intentional clear on delete (§2.4), `lastSyncedAt` advances (§6) |
