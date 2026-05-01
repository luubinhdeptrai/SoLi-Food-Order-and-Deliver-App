# TEST RUN GUIDE

## Prerequisites

| Tool | Where it runs |
|------|---------------|
| Docker Desktop | Local machine (starts PostgreSQL + Redis) |
| Node.js ≥ 20 | Local machine |
| pnpm | Local machine (`npm i -g pnpm`) |

---

## 1. Start infrastructure

The API depends on PostgreSQL and Redis, both provided by Docker Compose.

```bash
# From the repo root
docker compose up -d
```

Verify both containers are healthy:

```bash
docker ps
# Expected: food_order_db (port 5433) and food_order_redis (port 6379) are Up
```

---

## 2. Configure the test database

E2E tests wipe and re-seed data on every run.  
**Strongly recommended**: use a dedicated test database so your dev data is safe.

### Option A — Dedicated test database (recommended)

Connect to the running Postgres container and create the database:

```bash
docker exec -it food_order_db psql -U food_order -c "CREATE DATABASE food_order_test;"
```

Create `apps/api/.env.test` with the test DB URL:

```env
TEST_DATABASE_URL=postgresql://food_order:foodordersecret@localhost:5433/food_order_test
BETTER_AUTH_SECRET=any-secret-value-for-tests
BETTER_AUTH_URL=http://localhost:3000
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Option B — Share the dev database (quick start, destructive)

If you don't mind test runs clearing your dev data, skip `.env.test`.  
Tests will fall back to `DATABASE_URL` from `apps/api/.env`.

---

## 3. Run database migrations

Migrations must be applied to the test database before the first run.

```bash
cd apps/api

# Run against the default DATABASE_URL (dev DB)
pnpm db:migrate

# To run against the test DB, prefix with the TEST_DATABASE_URL
TEST_DATABASE_URL=postgresql://food_order:foodordersecret@localhost:5433/food_order_test \
  DATABASE_URL=postgresql://food_order:foodordersecret@localhost:5433/food_order_test \
  pnpm db:migrate
```

> **Note**: `drizzle.config.ts` reads `DATABASE_URL`. The simplest approach is to
> temporarily set `DATABASE_URL` to the test DB URL when running migrations for the
> first time, then reset it back.

---

## 4. Install dependencies

```bash
# From the repo root (pnpm workspace)
pnpm install
```

---

## 5. Run the E2E tests

```bash
cd apps/api

# Run all E2E tests
pnpm test:e2e

# Run a single spec file
pnpm test:e2e --testPathPattern=modifiers

# Run with verbose output
pnpm test:e2e --verbose
```

The command that runs is:
```
jest --config ./test/jest-e2e.json
```

Tests run sequentially (`maxWorkers: 1`) because each suite resets the database.

---

## 6. What happens during a test run

```
1. env-setup.ts loads .env.test (or .env as fallback)
2. Each test spec:
   a. createTestApp()   → boots the full NestJS app with MockAuthGuard
   b. resetDb()          → deletes ordering snapshots + restaurants (cascades)
   c. seedBaseRestaurant() → inserts one restaurant owned by the test user
   d. Tests run (create data via HTTP, assert via HTTP + DB helpers)
   e. teardownTestApp()  → closes the NestJS app
```

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `DATABASE_URL is not defined` | No .env file loaded | Create `apps/api/.env` or `.env.test` |
| `connect ECONNREFUSED 127.0.0.1:5433` | PostgreSQL not running | `docker compose up -d` |
| `relation "restaurants" does not exist` | Migrations not applied | Run `pnpm db:migrate` against the test DB |
| `ECONNREFUSED 127.0.0.1:6379` | Redis not running | `docker compose up -d` |
| **All tests get 401 Unauthorized** | MockAuthGuard not overriding real guard | See Authentication Override issue below |
| Tests conflict with each other | Running in parallel | `maxWorkers: 1` is set in `jest-e2e.json` — should be sequential |

### Known Issue: Authentication Override

**Problem:**  
The `@thallesp/nestjs-better-auth` guard cannot be fully overridden in the test environment, causing all authenticated requests to fail with 401.

**Root Cause:**  
The auth module registers its guard in a way that bypasses standard NestJS provider override mechanisms. This is particularly challenging in ESM + testing module context.

**Current Workarounds:**

1. **Temporarily disable auth in the API** (during development):
   - Remove `@Guard(AuthGuard)` decorators from controller methods you want to test
   - Or set a feature flag in the AppModule to skip auth registration
   - **Not recommended for production test verification**

2. **Run tests against a deployed instance with real auth** (CI/production):
   - Deploy the API to a test environment
   - Obtain real JWT tokens via the auth flow
   - Pass tokens in `Authorization: Bearer <token>` headers instead of mock headers
   - Update the test helper functions to use real tokens

3. **Switch to Keycloak or mock-server for auth** (longer term):
   - Replace `@thallesp/nestjs-better-auth` with a more test-friendly auth library
   - Or use a dedicated mock OAuth2 server that Jest can communicate with

**Recommended Solution (Next Step):**  
Create a feature flag (`TEST_MODE_DISABLE_AUTH` env var) in `AppModule` that allows you to conditionally skip `AuthModule` registration during tests. Then update `app-factory.ts` to set this flag and manually register a simple mock auth service instead of importing `AppModule` directly.

---

## 8. CI integration

```yaml
# Example GitHub Actions step
- name: Start infrastructure
  run: docker compose up -d

- name: Wait for Postgres
  run: |
    for i in {1..30}; do
      docker exec food_order_db pg_isready -U food_order && break
      sleep 1
    done

- name: Run migrations
  working-directory: apps/api
  env:
    DATABASE_URL: postgresql://food_order:foodordersecret@localhost:5433/food_order_test
  run: pnpm db:migrate

- name: Run E2E tests
  working-directory: apps/api
  env:
    TEST_DATABASE_URL: postgresql://food_order:foodordersecret@localhost:5433/food_order_test
    BETTER_AUTH_SECRET: ci-secret
    BETTER_AUTH_URL: http://localhost:3000
    REDIS_HOST: localhost
    REDIS_PORT: 6379
  run: pnpm test:e2e
```
