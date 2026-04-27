# SoLi Food Order & Delivery App - Setup Guide

## Project Overview

This is a **monorepo** food delivery platform with three main applications:

| App | Stack | Purpose |
|-----|-------|---------|
| **API** | NestJS, PostgreSQL, Drizzle ORM | Backend server |
| **Web** | React 19, Vite, Tailwind CSS | Admin/Store dashboard |
| **Mobile** | React Native, Expo | Customer app |

Tools: **pnpm** (package manager), **Turbo** (monorepo orchestration), **Docker** (database)

---

## ✅ Setup Status

- ✅ Node.js v22.15.0 installed
- ✅ pnpm v10.32.1 installed globally
- ✅ Dependencies installed (1513 packages)
- ⏳ Environment variables - **NEEDS CONFIGURATION**
- ⏳ Database - **NEEDS SETUP**

---

## 🔧 Environment Configuration

### Create `.env` in `apps/api/`

The `.env` file has been created from the template. You need to set database credentials:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=food_delivery
```

---

## 🗄️ Database Setup

### Option 1: Using Docker Compose (Recommended)

```bash
docker-compose up -d
```

This starts a PostgreSQL container with the credentials configured in `.env`.

### Option 2: Manual PostgreSQL Setup

1. Install PostgreSQL 18
2. Create a database user and database with the credentials from `.env`

### Set up Database Schema

```bash
pnpm --filter api db:push
```

This migrates the Drizzle ORM schema to the database.

---

## 🚀 Development Commands

### Run Everything in Watch Mode
```bash
pnpm dev
```
Starts API, Web, and Mobile dev servers.

### Run Individual Apps
```bash
pnpm dev:api      # Backend: http://localhost:3000
pnpm dev:web      # Web dashboard: http://localhost:5173
pnpm dev:mobile   # Expo dev server
```

### Build All Apps
```bash
pnpm build
```

### Lint Code
```bash
pnpm lint
```

---

## 📁 Project Structure

```
apps/
├── api/              # NestJS backend
│   ├── src/
│   │   ├── drizzle/  # Database setup
│   │   ├── module/   # Feature modules (auth, etc.)
│   │   └── lib/      # Shared utilities
│   └── test/         # E2E tests
├── web/              # React admin dashboard
│   ├── src/
│   │   ├── app/      # Routes & app shell
│   │   ├── pages/    # Page components
│   │   ├── components/ # Shared UI components
│   │   └── features/ # Domain features (auth, cart, menu)
│   └── docs/         # Documentation
└── mobile/           # React Native app
    ├── src/
    │   └── app/      # Routes & screens
    ├── assets/
    └── scripts/

```

---

## 🔑 Key Features

- **Authentication**: better-auth integration
- **State Management**: Zustand (Web & Mobile)
- **Data Fetching**: React Query for server state
- **UI Components**: shadcn/ui, Radix UI
- **Styling**: Tailwind CSS
- **Database**: PostgreSQL with Drizzle ORM
- **Maps**: Leaflet (Web)

---

## 🛠️ Next Steps

1. **Configure Environment**: Edit `apps/api/.env` with your database credentials
2. **Start Database**: Run `docker-compose up -d` (or set up PostgreSQL manually)
3. **Migrate Database**: Run `pnpm --filter api db:push`
4. **Start Development**: Run `pnpm dev` to start all services

---

## 📚 Database Commands

```bash
# Generate new migrations
pnpm --filter api db:generate

# Apply migrations
pnpm --filter api db:migrate

# Open Drizzle Studio (GUI)
pnpm --filter api db:studio

# Push schema to database
pnpm --filter api db:push
```

---

## 🧪 Testing

```bash
# API unit tests
pnpm --filter api test

# API e2e tests
pnpm --filter api test:e2e

# Watch mode
pnpm --filter api test:watch

# Coverage
pnpm --filter api test:cov
```

---

## 📝 Notes

- TypeScript peer dependency warnings are non-breaking and can be safely ignored
- The monorepo uses turbo for task orchestration and caching
- Each app has its own package.json and scripts
- Use `pnpm --filter <app-name>` to run commands for specific apps

---

## 🆘 Troubleshooting

**Port conflicts?**
- API runs on port 3000
- Web runs on port 5173
- Make sure these ports are available

**Database connection errors?**
- Verify `.env` credentials match your PostgreSQL setup
- Check that PostgreSQL is running if using Docker: `docker ps`

**Module not found errors?**
- Run `pnpm install` again to ensure all dependencies are installed
- Check that you're in the correct directory

