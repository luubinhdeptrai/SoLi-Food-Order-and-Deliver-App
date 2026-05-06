# Authentication & Authorization Analysis

> **Scope:** `apps/api/src`
> **Date:** April 28, 2026
> **Status:** Active codebase analysis — only what exists in code

---

## 1. Authentication Implementation

### 1.1 Library: `better-auth` (via `@thallesp/nestjs-better-auth`)

**File:** `src/lib/auth.ts`

```
betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: true },
  plugins: [openAPI(), bearer(), admin({ defaultRole: 'user', adminRoles: ['admin'] })],
})
```

**What is active:**

- Email + password authentication
- Bearer token (session-based, stored in DB) via `bearer()` plugin
- OpenAPI auto-generated docs for auth endpoints (`/api/auth/**`)
- Admin plugin manages user roles, banning, and impersonation

**Session storage:** PostgreSQL `session` table (token, expiresAt, userId FK, ipAddress, userAgent, impersonatedBy).

**Account / Identity table:** `account` table supports `accessToken`, `refreshToken`, `idToken` — OAuth providers can be added without schema changes.

---

### 1.2 Auth Schema

**File:** `src/module/auth/auth.schema.ts`

| Table          | Purpose                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| `user`         | Identity: email, name, image, `role` (text), banned, banReason, banExpires |
| `session`      | Active sessions, FK to user, TTL via `expiresAt`                           |
| `account`      | OAuth accounts linked to a user                                            |
| `verification` | Email verification / password reset tokens                                 |

**Roles stored as text column** on `user.role`. Not an enum — `admin` plugin parses it as comma-separated.

---

### 1.3 Role Definitions

**File:** `src/lib/auth.ts`

```typescript
export const APP_ROLES = ['admin', 'restaurant', 'shipper', 'user'] as const;
```

**File:** `src/module/auth/role.util.ts`

```typescript
export function hasRole(
  role: string | string[] | undefined | null,
  ...required: string[]
): boolean;
```

Splits comma-separated roles, case-insensitive comparison.

---

### 1.4 Global Guard Configuration

**File:** `src/app.module.ts`

```typescript
AuthModule.forRoot({
  auth,
  disableGlobalAuthGuard: true, // ← Global guard is DISABLED
  ...
})
```

**Critical:** `disableGlobalAuthGuard: true` — **no route is protected by default**. Every route is public unless explicitly decorated.

---

### 1.5 DEV/TEST Middleware (ACTIVE IN PRODUCTION CONFIG)

**File:** `src/lib/dev-test-user.middleware.ts`

```typescript
consumer.apply(DevTestUserMiddleware).forRoutes('*'); // in app.module.ts
```

This middleware:

- Reads `x-test-user-id` header or falls back to `11111111-1111-4111-8111-111111111111`
- Sets `req.user = { sub, email, roles: ['admin', 'restaurant'] }` on EVERY request
- Applied to ALL routes via `forRoutes('*')` — **this runs in production unless removed**

---

## 2. Authorization Implementation

### 2.1 `@Roles()` Decorator (via `@thallesp/nestjs-better-auth`)

Used in controllers: `RestaurantController`, `MenuController`, `ZonesController`, `ModifiersController`

```typescript
@Roles(['admin', 'restaurant'])  // guards POST/PATCH/DELETE mutation endpoints
```

Routes with `@Roles()`:

- `POST /restaurants` → `['admin', 'restaurant']`
- `PATCH /restaurants/:id` → `['admin', 'restaurant']`
- `PATCH /restaurants/:id/approve` → `['admin']`
- `PATCH /restaurants/:id/unapprove` → `['admin']`
- `DELETE /restaurants/:id` → `['admin']`
- `POST /menu-items` → `['admin', 'restaurant']`
- `PATCH /menu-items/:id` → `['admin', 'restaurant']`
- `PATCH /menu-items/:id/sold-out` → `['admin', 'restaurant']`
- `DELETE /menu-items/:id` → `['admin', 'restaurant']`
- All delivery zone mutations → `['admin', 'restaurant']`
- All modifier mutations → `['admin', 'restaurant']`

### 2.2 Ownership Checks (in-service)

**RestaurantService** (`restaurant.service.ts`):

```typescript
if (!isAdmin && restaurant.ownerId !== requesterId) throw ForbiddenException;
```

**MenuService** (`menu.service.ts`): `assertOwnership()` — checks `restaurant.ownerId !== requesterId`

**ZonesService** (`zones.service.ts`): inline ownership check on every mutation

**ModifiersService** (`modifiers.service.ts`): **BUG — broken ownership check**:

```typescript
private async getRestaurantForItem(restaurantId: string) {
  return { ownerId: restaurantId }; // ← returns restaurantId AS ownerId — always wrong
}
```

This means any `restaurant`-role user can modify any restaurant's modifiers.

### 2.3 `@Session()` Decorator (for role extraction)

Used in `RestaurantController`, `MenuController`, `ZonesController`:

```typescript
create(@Session() session: UserSession, @Body() dto: ...) {
  return this.service.create(session.user.id, hasRole(session.user.role, 'admin'), dto);
}
```

### 2.4 `@CurrentUser()` + `JwtAuthGuard` — MISSING FILES

**File:** `src/module/ordering/cart/cart.controller.ts` imports:

```typescript
import {
  CurrentUser,
  type JwtPayload,
} from '@/module/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/module/auth/guards/jwt-auth.guard';
```

**Neither file exists.** The `src/module/auth/` directory contains only:

- `auth.schema.ts`
- `role.util.ts`

This causes **TypeScript compile errors** on `cart.controller.ts` and means `CartController` has **no working auth guard** at runtime. The `DevTestUserMiddleware` masks this during development.

---

## 3. Summary of Status

| Feature                            | Status                          | File                                                                  |
| ---------------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| Email/password auth                | ✅ Implemented                  | `src/lib/auth.ts`                                                     |
| Bearer session tokens              | ✅ Implemented                  | `src/lib/auth.ts`                                                     |
| Role definitions                   | ✅ Implemented                  | `src/lib/auth.ts`, `src/module/auth/role.util.ts`                     |
| `@Roles()` guard on catalog routes | ✅ Implemented                  | `restaurant.controller.ts`, `menu.controller.ts`                      |
| Ownership checks                   | ✅ Implemented (with one bug)   | `restaurant.service.ts`, `menu.service.ts`                            |
| Global auth guard                  | ❌ Disabled                     | `src/app.module.ts` (`disableGlobalAuthGuard: true`)                  |
| `JwtAuthGuard`                     | ❌ Missing file                 | `src/module/auth/guards/jwt-auth.guard.ts` does not exist             |
| `@CurrentUser()` decorator         | ❌ Missing file                 | `src/module/auth/decorators/current-user.decorator.ts` does not exist |
| Dev middleware bypassing auth      | ⚠️ Risk                         | Applied to ALL routes via `forRoutes('*')`                            |
| Modifier ownership check           | ⚠️ Broken                       | `modifiers.service.ts` — `getRestaurantForItem` returns wrong ownerId |
| OAuth providers                    | ⚠️ Schema ready, not configured | `account` table exists; no OAuth plugin wired                         |
| Refresh token rotation             | ⚠️ Not configured               | `account.refreshToken` exists but not used                            |
| Rate limiting                      | ❌ Missing                      | No throttling on auth endpoints                                       |
| Token revocation                   | ❌ Not implemented              | Session delete = logout, but no blacklist                             |

---

## 4. Risks

### R-1 (CRITICAL): Dev middleware running in all environments

`DevTestUserMiddleware` is applied to `forRoutes('*')` in `AppModule`. In production:

- Any caller can set `x-test-user-id` to any UUID and impersonate any user
- No environment guard (`process.env.NODE_ENV !== 'production'`) — it always runs
- Every request gets `roles: ['admin', 'restaurant']` injected even without credentials

**Fix:** Wrap in `process.env.NODE_ENV !== 'production'` guard:

```typescript
if (process.env.NODE_ENV !== 'production') {
  consumer.apply(DevTestUserMiddleware).forRoutes('*');
}
```

### R-2 (CRITICAL): Missing auth files cause compile errors + no runtime protection

`cart.controller.ts` imports `JwtAuthGuard` and `CurrentUser` from paths that do not exist. The entire `CartController` (cart management + checkout) relies on these for authentication — without them there is no real auth on the ordering surface.

**Fix:** Create `src/module/auth/guards/jwt-auth.guard.ts` and `src/module/auth/decorators/current-user.decorator.ts` as adapters wrapping `better-auth`'s session extraction.

### R-3 (MEDIUM): `disableGlobalAuthGuard: true`

All routes are public by default. Read endpoints (`GET /restaurants`, `GET /menu-items`, `GET /restaurants/search`) require no authentication. This may be intentional for a food catalog but should be documented as a deliberate decision.

### R-4 (MEDIUM): Broken modifier ownership (`modifiers.service.ts`)

`getRestaurantForItem(restaurantId)` returns `{ ownerId: restaurantId }` — it uses the restaurant UUID as the owner ID, which will never match a real user UUID. Any `restaurant`-role user can bypass ownership and mutate any restaurant's modifiers.

### R-5 (LOW): No rate limiting on `/api/auth/sign-in`

`better-auth` has built-in rate limiting via its config, but none is configured here. Brute-force on email/password login is unrestricted.

---

## 5. Recommendations

| Priority | Action                                                             | File                          |
| -------- | ------------------------------------------------------------------ | ----------------------------- |
| P0       | Restrict `DevTestUserMiddleware` to `NODE_ENV !== 'production'`    | `app.module.ts`               |
| P0       | Create `jwt-auth.guard.ts` wrapping better-auth session validation | `src/module/auth/guards/`     |
| P0       | Create `current-user.decorator.ts` extracting `req.user`           | `src/module/auth/decorators/` |
| P1       | Fix `getRestaurantForItem` in `ModifiersService` to query the DB   | `modifiers.service.ts`        |
| P1       | Add `rateLimit` config to `better-auth` for sign-in endpoint       | `src/lib/auth.ts`             |
| P2       | Document intentional public read endpoints                         | README or Swagger             |
| P2       | Add refresh token rotation via `better-auth` config                | `src/lib/auth.ts`             |
