# Phase 0 — Infrastructure Setup: Verification Guide

**Phase:** 0 — Infrastructure Setup  
**Status:** Implemented  
**Goal:** Confirm the app boots cleanly with `OrderingModule` and `RedisModule` registered.

---

## Prerequisites

1. Redis is running locally (or via Docker):
   ```bash
   docker compose up redis -d
   ```

2. `.env` contains `REDIS_HOST` and `REDIS_PORT` (copy from `.env.example`):
   ```env
   REDIS_HOST=localhost
   REDIS_PORT=6379
   ```

3. All dependencies are installed:
   ```bash
   cd apps/api
   pnpm install
   ```

---

## Verification Steps

### 1 — Build Check (TypeScript)

```bash
cd apps/api
pnpm build
```

**Expected:** No TypeScript errors. Build succeeds in `dist/`.

---

### 2 — App Boot (Dev Mode)

```bash
cd apps/api
pnpm start:dev
```

**Expected log lines:**

```
[RedisModule] Redis connected
[NestApplication] Nest application successfully started
```

**Not expected:** Any `Cannot find module`, `Symbol not found`, or `No provider for REDIS_CLIENT` errors.

---

### 3 — Redis Ping

Start the app then run:
```bash
curl http://localhost:3000/api/health
# or just confirm the Redis log line appears on boot
```

Alternatively, connect directly:
```bash
redis-cli ping
# Expected: PONG
```

---

### 4 — Module Registration Check

In `app.module.ts`, confirm both imports are present:

```typescript
import { RedisModule } from './lib/redis/redis.module';
import { OrderingModule } from './module/ordering/ordering.module';

@Module({
  imports: [
    ...
    RedisModule,
    OrderingModule,
    ...
  ],
})
```

---

### 5 — Dependency Audit

```bash
cd apps/api
pnpm list @nestjs/cqrs ioredis
```

**Expected:**
```
@nestjs/cqrs  ^11.0.3
ioredis       ^5.10.1
```

---

## File Checklist

| File | Status |
|------|--------|
| `src/module/ordering/ordering.module.ts` | ✅ Created |
| `src/module/ordering/cart/cart.module.ts` | ✅ Created |
| `src/module/ordering/order/order.module.ts` | ✅ Created |
| `src/module/ordering/order-lifecycle/order-lifecycle.module.ts` | ✅ Created |
| `src/module/ordering/order-history/order-history.module.ts` | ✅ Created |
| `src/module/ordering/acl/.gitkeep` | ✅ Created (placeholder) |
| `src/module/ordering/common/ordering.constants.ts` | ✅ Created |
| `src/lib/redis/redis.constants.ts` | ✅ Created |
| `src/lib/redis/redis.module.ts` | ✅ Created |
| `src/lib/redis/redis.service.ts` | ✅ Created |
| `src/shared/events/index.ts` | ✅ Created |
| `src/shared/events/menu-item-updated.event.ts` | ✅ Created |
| `src/shared/events/restaurant-updated.event.ts` | ✅ Created |
| `src/shared/events/order-placed.event.ts` | ✅ Created |
| `src/shared/events/order-status-changed.event.ts` | ✅ Created |
| `src/shared/events/order-ready-for-pickup.event.ts` | ✅ Created |
| `src/shared/events/order-cancelled-after-payment.event.ts` | ✅ Created |
| `src/shared/events/payment-confirmed.event.ts` | ✅ Created |
| `src/shared/events/payment-failed.event.ts` | ✅ Created |
| `src/app.module.ts` | ✅ Updated — imports `RedisModule`, `OrderingModule` |
| `apps/api/.env.example` | ✅ Updated — `REDIS_HOST`, `REDIS_PORT` added |
| `docker-compose.yml` | ✅ Updated — `redis:7-alpine` service added |

---

## Known Notes

- `@types/ioredis` is a deprecated stub (ioredis ships its own types). Non-fatal.
- `RedisModule` is decorated `@Global()` — `RedisService` is injectable in any module without re-importing.
- Cart keys (`cart:<customerId>`) and idempotency keys (`idempotency:order:<key>`) are defined in `ordering.constants.ts`. No logic is wired yet — that is Phase 2 (cart) and Phase 4 (idempotency).

---

## Next Phase

Phase 1 — Domain Schema (Drizzle Tables).
See `ORDERING_CONTEXT_PROPOSAL.md` → Phase 1.
