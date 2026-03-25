# 🏗️ Technical Architecture Specification: Food Delivery App

## 1. Executive Summary

As a Food Delivery application grows, the primary challenge is managing cross-cutting concerns (like Authentication and Maps) alongside domain-specific logic (like Cart Management and Order Tracking). This architecture utilizes **Domain-Driven Design (DDD)** principles to encapsulate logic within feature modules, reducing the "ripple effect" of code changes and improving developer velocity.

---

## 2. Core Directory Structure (`/src`)

The root of the application logic resides in the `/src` directory to separate source code from project configurations (EAS, Metro, etc.).

```text
src/
├── api/                  # Global network configuration (Axios/Fetch instances)
├── app/                  # Expo Router (Routing layer only)
│   ├── (auth)/           # Authentication routes
│   ├── (customer)/       # Main marketplace & ordering routes
│   └── (delivery)/       # Real-time tracking & driver logistics
├── components/           # Atomic UI (Design system/Global components)
├── constants/            # Immutable values (Theme, API endpoints, Config)
├── features/             # THE CORE: Domain-specific modules
│   ├── auth/             # Session management, OTP, user profile logic
│   ├── cart/             # Cart persistence, pricing, checkout flow
│   ├── map/              # GIS logic, route polyline rendering
│   ├── orders/           # Real-time tracking, history, push notifications
│   └── restaurants/      # Catalog, menu management, search/filters
├── hooks/                # Global stateful logic (e.g., useOnlineStatus)
├── services/             # Third-party SDKs (Stripe, Firebase, Google Maps)
├── store/                # Client-side state (Zustand/Redux for UI/Cart)
├── types/                # Global TypeScript declarations
└── utils/                # Stateless helpers (Formatting, Validations)
```

---

## 3. The "Feature" Module Pattern

The `features/` directory is the most critical component of this architecture. Each subdirectory acts as a **micro-application** for a specific business domain.

### Internal Feature Anatomy

Every feature folder should strictly follow this internal structure:

- **`api/`**: Pure asynchronous fetcher functions (e.g., `get-restaurant-menu.ts`).
- **`hooks/`**: TanStack Query wrappers (e.g., `use-menu.ts`) and local state logic.
- **`components/`**: UI components exclusive to this domain (e.g., `MenuListItem.tsx`).
- **`types/`**: Interfaces and types specific to the feature data models.
- **`screen/`**: A feature oriented screen assemble from components (e.g., `RestaurantDetailScreen.tsx`).
  > **Rule of Thumb:** If a component is used in both `restaurants` and `orders`, move it to the global `src/components/` folder. Otherwise, keep it localized within the feature.

---

## 4. Data Management Strategy

In a 2026 React Native environment, state is divided into two distinct categories:

### A. Server State (Managed by TanStack Query)

Used for all data originating from the backend (Menus, Order History, User Profile).

- **Location:** `src/features/[feature]/hooks/`
- **Benefit:** Provides out-of-the-box caching, background refetching, and "stale-while-revalidate" logic essential for mobile performance.

### B. Client State (Managed by Zustand)

Used for ephemeral, local-only data (Items in Cart, UI toggles, current search filters).

- **Location:** `src/store/`
- **Benefit:** Lightweight and optimized for React Native's bridge-less architecture (New Architecture/TurboModules).

---

## 5. Routing vs. Implementation

Following Expo Router best practices, the `app/` directory should remain **declarative**.

- **Logic-Light Routes:** Route files should primarily handle parameter parsing (e.g., `id`) and pass data to a Screen component.
- **Screen Delegation:** UI implementation resides in the `features/` folder.
  - _Example:_ `src/app/(customer)/restaurant/[id].tsx` simply imports and renders `<RestaurantDetailScreen id={id} />` from the restaurants feature.

---

## 6. Coding Standards & Scalability

| Category          | Standard                                                                                      |
| :---------------- | :-------------------------------------------------------------------------------------------- |
| **Naming**        | Use `kebab-case` for file names and `PascalCase` for React components.                        |
| **Imports**       | Use **Path Aliasing** (`@/features/...`) to avoid relative path nesting.                      |
| **Encapsulation** | Use **Barrel Exports** (`index.ts`) in each folder to expose only necessary APIs.             |
| **Platform**      | Use `.ios.tsx` and `.android.tsx` for platform-specific hardware logic (e.g., Haptics, Maps). |
