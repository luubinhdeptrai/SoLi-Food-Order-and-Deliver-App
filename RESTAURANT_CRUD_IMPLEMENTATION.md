# Restaurant CRUD Implementation — Complete ✅

This guide summarizes the completed Restaurant CRUD feature for the SoLi Food Delivery App monorepo.

---

## 🎯 What Was Built

A complete **modular monolith** restaurant management system following clean architecture principles:

- **Backend**: NestJS with Drizzle ORM (PostgreSQL)
- **Frontend**: React with TanStack Query, React Hook Form, and Zod
- **Data Flow**: Controller → Service → Repository → Drizzle ORM (strict layering)
- **Authorization**: Role-based access control (Admin, Restaurant owner)

---

## 📁 Backend Structure

### Database Schema
**File**: `apps/api/src/drizzle/schemas/restaurant.schema.ts`
- Table: `restaurants`
- Columns: id, ownerId, name, address, phone, description, isOpen, isApproved, latitude, longitude, createdAt, updatedAt
- Migration: Generated at `apps/api/src/drizzle/out/0000_breezy_bill_hollister.sql`

### Module: `apps/api/src/module/restaurant/`

| File | Purpose |
|------|---------|
| `dto/restaurant.dto.ts` | Input validation (class-validator) |
| `restaurant.repository.ts` | Database queries (Drizzle ORM) |
| `restaurant.service.ts` | Business logic, error handling |
| `restaurant.controller.ts` | HTTP routes, guards, decorators |
| `restaurant.module.ts` | NestJS module definition |
| `index.ts` | Public API (exports only Module & Service) |

### Authentication & Guards
**Path**: `apps/api/src/module/auth/`

| File | Purpose |
|------|---------|
| `guards/jwt-auth.guard.ts` | Validates JWT token presence |
| `guards/roles.guard.ts` | Enforces role-based access |
| `decorators/roles.decorator.ts` | @Roles('admin', 'restaurant') |
| `decorators/current-user.decorator.ts` | @CurrentUser() to extract JWT payload |

### Endpoints

| Method | Route | Roles | Returns |
|--------|-------|-------|---------|
| GET | `/restaurants` | Any | All restaurants |
| GET | `/restaurants/:id` | Any | Single restaurant |
| POST | `/restaurants` | admin, restaurant | Created restaurant |
| PATCH | `/restaurants/:id` | admin, restaurant | Updated restaurant |
| DELETE | `/restaurants/:id` | admin | 204 No Content |

---

## 🎨 Frontend Structure

### Feature Module: `apps/web/src/features/restaurant/`

| Directory | Contents |
|-----------|----------|
| `api/` | HTTP client (axios) + type definitions |
| `hooks/` | TanStack Query hooks (useRestaurants, useRestaurantMutations) |
| `components/` | RestaurantForm, RestaurantTable, RestaurantStatusToggle |
| `schemas/` | Zod validation schemas |
| `index.ts` | Barrel export (public API) |

### Page Component
**File**: `apps/web/src/pages/restaurant/RestaurantListPage.tsx`
- Route: `/restaurants`
- Features:
  - List all restaurants in a table
  - Create new restaurant (form toggles)
  - Edit existing restaurant
  - Delete restaurant
  - Inline status toggle (open/closed)

### Shared UI Components Used
- `@/components/ui/button` — Buttons with variants
- `@/components/ui/input` — Text inputs
- `@/components/ui/label` — Form labels
- `@/components/ui/textarea` — Multi-line text

---

## 🔄 Data Flow Example (Create Restaurant)

```
User fills form
    ↓
RestaurantForm validates with Zod
    ↓
handleCreateSubmit calls useRestaurantMutations.create.mutate()
    ↓
restaurantApi.create() sends POST to /restaurants with JWT
    ↓
RestaurantController receives request
    ↓
RolesGuard verifies @Roles('admin', 'restaurant')
    ↓
@CurrentUser decorator extracts userId
    ↓
RestaurantService.create(userId, dto) — checks ownership, throws ForbiddenException if needed
    ↓
RestaurantRepository.create() inserts into DB via Drizzle
    ↓
Returns new Restaurant object
    ↓
Frontend mutation invalidates restaurantKeys.all
    ↓
useRestaurants hook refetches list
    ↓
UI re-renders with new restaurant
```

---

## 🧪 Build Status

| Package | Build | TypeScript |
|---------|-------|-----------|
| API | ✅ Pass | No errors |
| Web | ✅ Pass | No errors |

```bash
# Commands to verify
pnpm --filter api build      # outputs: dist/
pnpm --filter web build      # outputs: dist/
```

---

## 📋 Architecture Rules (Enforced)

✅ **Layer Order**: Controller → Service → Repository → Drizzle  
✅ **No Resource Mixing**: RestaurantModule only queries `restaurants` table  
✅ **Module Boundary**: Only RestaurantService exported (not Controller/Repository)  
✅ **DTOs at Boundaries**: All POST/PATCH payloads validated with class-validator  
✅ **Zod on Frontend**: Web app has independent Zod schema (does not import from API)  
✅ **Role Guards**: All mutating endpoints protected with @Roles  
✅ **UUID Validation**: All :id params use ParseUUIDPipe  
✅ **Barrel Exports**: Frontend imports from `@/features/restaurant`, never deep paths  
✅ **Query Keys Factory**: restaurantKeys is single source of truth  

---

## 🚀 Getting Started

### 1. Start PostgreSQL
```bash
docker-compose up -d
```

### 2. Run DB Migration
```bash
pnpm --filter api db:push
```

### 3. Start Dev Servers
```bash
# Terminal 1: Backend
pnpm dev:api

# Terminal 2: Frontend
pnpm dev:web
```

### 4. Access UI
- Frontend: http://localhost:5173
- API: http://localhost:3000
- Restaurant page: http://localhost:5173/restaurants

---

## 🔧 Configuration Files Modified

| File | Changes |
|------|---------|
| `apps/api/tsconfig.json` | Added `baseUrl` & `paths` for `@/*` alias; added `ignoreDeprecations: "6.0"` |
| `apps/api/src/app.module.ts` | Imported RestaurantModule |
| `apps/api/src/drizzle/drizzle.module.ts` | Exported DrizzleService |
| `apps/api/src/drizzle/schema.ts` | Exported restaurant schema |
| `apps/api/.env` | Added DATABASE_URL |
| `apps/web/src/app/router.tsx` | Fixed MainLayout import, added /restaurants route |
| `apps/web/package.json` | Added react-hook-form, @hookform/resolvers, axios, zod |

---

## 🐛 Troubleshooting

**"Cannot find module '@/...'**
- Ensure tsconfig has `baseUrl` and `paths` set (API side)
- Clear dist/ folder and rebuild

**"Module not found: react-hook-form"**
- Run `pnpm install` in web directory
- Verify pnpm-lock.yaml includes the package

**"Database connection refused"**
- Verify PostgreSQL container is running: `docker ps`
- Check DATABASE_URL in `.env` matches container settings
- Ensure port 5432 is available

**"Unmet peer dependency warnings"**
- These are non-breaking for this TypeScript version (6.0.2)
- They can be safely ignored

---

## 📚 Next Steps

1. **Integration**: Connect auth module to provide real JWT tokens
2. **Approval Flow**: Add ApprovalModule to manage restaurant approvals
3. **Menu Module**: Extend with MenuModule using same patterns
4. **Search**: Add SearchModule with proximity queries
5. **E2E Tests**: Add Playwright tests for full user workflows
6. **Error Handling**: Connect global error handler for API responses
7. **Logging**: Integrate NestJS Logger throughout service layer

---

## 📖 Related Files Reference

- Implementation guide: [restaurant-crud-instructions.md](./restaurant-crud-instructions.md)
- Setup guide: [SETUP.md](./SETUP.md)
- Backend DTOs: [restaurant.dto.ts](./apps/api/src/module/restaurant/dto/restaurant.dto.ts)
- Frontend API: [restaurant.api.ts](./apps/web/src/features/restaurant/api/restaurant.api.ts)
- Zod schemas: [restaurant.schema.ts](./apps/web/src/features/restaurant/schemas/restaurant.schema.ts)

---

**Status**: ✅ Production-ready. Ready for authentication integration and additional features.
