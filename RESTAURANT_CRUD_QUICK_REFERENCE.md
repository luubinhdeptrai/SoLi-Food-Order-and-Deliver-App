# Restaurant CRUD — Quick Reference

## 🎯 Files Created (15 Backend + 9 Frontend)

### Backend (15 files)
```
apps/api/src/
├── drizzle/
│   ├── drizzle.service.ts                    ✅ NEW
│   ├── schemas/
│   │   └── restaurant.schema.ts              ✅ NEW
│   └── drizzle.module.ts                     ✏️  MODIFIED
├── module/
│   ├── auth/
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts             ✅ NEW
│   │   │   └── roles.guard.ts                ✅ NEW
│   │   ├── decorators/
│   │   │   ├── roles.decorator.ts            ✅ NEW
│   │   │   └── current-user.decorator.ts     ✅ NEW
│   │   └── interfaces/
│   │       └── jwt-payload.interface.ts      ✅ NEW
│   └── restaurant/
│       ├── dto/
│       │   └── restaurant.dto.ts             ✅ NEW
│       ├── restaurant.repository.ts          ✅ NEW
│       ├── restaurant.service.ts             ✅ NEW
│       ├── restaurant.controller.ts          ✅ NEW
│       ├── restaurant.module.ts              ✅ NEW
│       └── index.ts                          ✅ NEW
├── app.module.ts                             ✏️  MODIFIED
├── drizzle/schema.ts                         ✏️  MODIFIED
└── tsconfig.json                             ✏️  MODIFIED
```

### Frontend (9 files)
```
apps/web/src/
├── features/restaurant/
│   ├── api/
│   │   ├── restaurant.api.ts                 ✅ NEW
│   │   └── restaurant.types.ts               ✅ NEW
│   ├── hooks/
│   │   ├── useRestaurants.ts                 ✅ NEW
│   │   └── useRestaurantMutations.ts         ✅ NEW
│   ├── components/
│   │   ├── RestaurantForm.tsx                ✅ NEW
│   │   ├── RestaurantTable.tsx               ✅ NEW
│   │   └── RestaurantStatusToggle.tsx        ✅ NEW
│   ├── schemas/
│   │   └── restaurant.schema.ts              ✅ NEW
│   └── index.ts                              ✅ NEW
├── pages/restaurant/
│   └── RestaurantListPage.tsx                ✅ NEW
└── app/router.tsx                            ✏️  MODIFIED
```

---

## 🔑 Key Commands

### Build
```bash
pnpm --filter api build      # ✅ Passes
pnpm --filter web build      # ✅ Passes
```

### Database
```bash
pnpm --filter api db:generate   # Already done
pnpm --filter api db:migrate    # Run when DB needed
pnpm --filter api db:studio     # GUI for database
```

### Development
```bash
pnpm dev:api                 # Starts API on :3000
pnpm dev:web                 # Starts Web on :5173
pnpm dev                     # Starts both
```

---

## 📊 API Endpoints

| Endpoint | Method | Auth | Response |
|----------|--------|------|----------|
| `/restaurants` | GET | - | Restaurant[] |
| `/restaurants/:id` | GET | - | Restaurant |
| `/restaurants` | POST | ✅ admin, restaurant | Restaurant |
| `/restaurants/:id` | PATCH | ✅ admin, restaurant | Restaurant |
| `/restaurants/:id` | DELETE | ✅ admin | 204 |

---

## 🧠 Architecture Checklist

| Rule | Status |
|------|--------|
| Layer order (Controller → Service → Repo → Drizzle) | ✅ |
| No ResourceRepository direct imports in Controller | ✅ |
| Module exports only Service | ✅ |
| DTOs with class-validator decorators | ✅ |
| No cross-context DB joins | ✅ |
| Mutating endpoints have @Roles guard | ✅ |
| All :id params use ParseUUIDPipe | ✅ |
| Frontend imports via barrel exports | ✅ |
| Zod schema independent from API | ✅ |
| Query keys from factory function | ✅ |

---

## 🚨 Important Notes

1. **Authentication**: JWT guards are placeholders. Connect to real auth provider in production.
2. **Database**: Migrations generated but not yet applied. Run `db:push` when ready.
3. **Environment**: `.env` configured with dev credentials (not secure for production).
4. **Type Safety**: Full TypeScript coverage, no `any` types.
5. **Modularity**: RestaurantModule can be imported by OrderingModule or other modules that need to validate restaurants.

---

## 🔗 Documentation Files

- **[SETUP.md](./SETUP.md)** — Project setup & configuration guide
- **[RESTAURANT_CRUD_IMPLEMENTATION.md](./RESTAURANT_CRUD_IMPLEMENTATION.md)** — Full implementation details
- **[restaurant-crud-instructions.md](./restaurant-crud-instructions.md)** — Architecture requirements & patterns

---

## ✅ Status

- ✅ All files created
- ✅ API builds without errors
- ✅ Web builds without errors
- ✅ Database schema defined
- ✅ Routes integrated
- ✅ Type safety enforced
- ✅ Architecture rules enforced
- ⏳ Database connection & migration (manual step)
- ⏳ Real authentication (integration needed)

**Ready to**: Start dev servers, test endpoints, integrate real auth, extend with additional modules.
