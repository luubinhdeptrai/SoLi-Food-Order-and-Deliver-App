# Project Structure

This web app follows a layered structure that keeps shared code separate from feature code and keeps application wiring at the top level. The goal is to make the codebase easy to scale without turning the `src` folder into a flat collection of unrelated files.

## Core Directory Structure (`src`)

Most of the code lives in `src` and is organized like this:

```text
src/
├── app/                  # application shell: providers, router, and route composition
│   ├── app.tsx           # app entry component that wires providers and the router
│   ├── provider.tsx      # global providers such as React Query
│   ├── router.tsx        # route definitions for the application
│   └── routes/           # route-level components rendered by the router
├── components/           # shared UI components used across features
├── features/             # domain-specific modules
│   ├── cart/             # cart state and cart-specific logic
│   │   └── stores/
│   └── menu/             # menu data and menu-specific logic
│       └── api/
├── hooks/                # shared hooks used across the app
├── lib/                  # reusable library helpers and utilities
├── stores/               # global state stores that do not belong to a single feature
├── api/                  # optional shared API layer for cross-feature requests
└── index.css             # global styles
```

## Application Layer

The `app/` folder is responsible for application composition, not business logic.

- `app/app.tsx` composes global providers and the router.
- `app/provider.tsx` owns app-wide providers such as `QueryClientProvider`.
- `app/router.tsx` defines route registration with React Router.
- `app/routes/` contains route-level components such as `HomePage`, `CartPage`, and `RootLayout`.

Route files should stay thin. They should render the page UI and coordinate feature modules, but avoid placing feature logic directly in the route layer when that logic can live in a feature folder.

## Feature Module Pattern

Most business logic should live inside `src/features`. Each feature acts like a self-contained module for one domain.

Recommended internal structure:

```text
src/features/<feature-name>/
├── api/                  # async request functions and data fetchers
├── components/           # feature-specific UI components
├── hooks/                # feature-specific hooks, including query wrappers
├── stores/               # feature-specific client state
├── types/                # feature-specific TypeScript types
└── utils/                # feature-specific helpers
```

Not every feature needs every folder. Add only what the feature actually uses.

Current examples in this app:

- `src/features/menu/api/menu.ts` contains the menu data fetcher and menu item type.
- `src/features/cart/stores/cartStore.ts` contains the cart Zustand store.

## Shared Code

Shared code is for reusable pieces that are not tied to a single domain.

- `components/` should hold reusable UI primitives and shared presentation components.
- `hooks/` should hold hooks that are reused in multiple parts of the app.
- `lib/` should hold generic utilities and helpers.
- `stores/` should be reserved for truly global client state.
- `api/` can be used for shared API helpers or cross-feature request utilities if the app grows beyond feature-local fetchers.

## Data Management Strategy

This app uses two main state categories:

### Server State

Use TanStack Query for backend data such as menus, orders, profiles, or other remote resources.

- Keep fetchers in `features/<feature>/api/` or in a shared `api/` folder when several features reuse the same request.
- Wrap request usage in feature-level hooks when the logic starts to repeat or needs caching behavior.

### Client State

Use Zustand for local UI state and ephemeral app state such as cart contents, filters, or toggles.

- Keep feature-scoped stores inside `features/<feature>/stores/` when the state belongs to one domain.
- Use the top-level `stores/` folder only for truly global state.

## Routing and Composition

The router should compose features at the application level instead of letting features import across each other.

- `src/app/router.tsx` should decide which route renders which feature or page component.
- Features should depend on shared code, but should not import from other features unless the dependency is intentionally shared and documented.
- Keep route components focused on layout and composition rather than mixing multiple domain concerns in one file.

## Import Direction

Follow a one-way flow for dependencies:

```text
shared code -> features -> app
```

That means:

- `components/`, `hooks/`, `lib/`, `stores/`, and `api/` can be used by features and app code.
- `features/` can be used by `app/`.
- `app/` should not be imported by feature code.

This keeps the architecture predictable and reduces cross-module coupling.

## Naming and File Conventions

- Use `PascalCase` for React component files.
- Use descriptive folder names for feature domains such as `cart`, `menu`, `orders`, or `auth`.
- Keep route files and component files direct and readable, avoiding unnecessary barrel files unless they clearly improve maintainability.

## Practical Rule of Thumb

When adding new code, ask these questions:

1. Is this UI or logic reusable across the whole app? Put it in `components/`, `hooks/`, `lib/`, or `stores/`.
2. Is this tied to a specific business domain? Put it in `features/<feature>/`.
3. Is this part of route composition or app setup? Put it in `app/`.

Keeping that separation clear will make the app easier to maintain as more features are added.
