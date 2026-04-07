Project Structure Guide

This web app uses a layered structure that keeps route pages thin, feature logic isolated, and shared code reusable. The goal is to make the codebase easy to scale without turning `src` into a flat pile of unrelated files.

## Core Directory Structure (`src`)

Most of the code lives in `src` and is organized like this:

```text
src/
├── app/                  # application shell: providers, router, and route composition
│   ├── app.tsx           # app entry component that wires providers and the router
│   ├── provider.tsx      # global providers such as React Query
│   ├── router.tsx        # route definitions for the application
│   └── routes/           # route-level page components
│       ├── RootLayout.tsx
│       ├── HomePage.tsx
│       ├── MenuPage.tsx
│       ├── CartPage.tsx
│       ├── CheckoutPage.tsx
│       └── auth/
│           ├── LoginPage.tsx
│           └── RegisterPage.tsx
├── components/           # shared UI components used across features
├── features/             # domain-specific modules
│   ├── auth/
│   ├── cart/
│   ├── checkout/
│   ├── menu/
│   └── orders/
├── hooks/                # shared hooks used across the app
├── lib/                  # reusable library helpers and utilities
├── stores/               # global state stores that do not belong to a single feature
├── api/                  # optional shared API layer for cross-feature requests
└── index.css             # global styles
```

---

## Application Layer

The `app/` folder is responsible for application composition, not business logic.

- `app/app.tsx` composes global providers and the router.
- `app/provider.tsx` owns app-wide providers such as `QueryClientProvider`.
- `app/router.tsx` defines route registration with React Router.
- `app/routes/` contains route-level page components such as `HomePage`, `CartPage`, and `RootLayout`.

Route files should stay thin. They should mainly assemble layouts and feature components for that screen. They should not contain feature-specific business logic when that logic belongs in a feature folder.

### What belongs in a page file?

A page file should answer one question:

**“What should this route render?”**

That means a page can:

- compose feature components
- define route-level layout
- pass page-specific props
- handle route-only UI concerns

It should not:

- fetch and transform domain data directly
- manage feature state that belongs elsewhere
- duplicate logic already owned by a feature

---

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

### Example features

- `src/features/menu/` for menu data and menu UI
- `src/features/cart/` for cart state and cart interactions
- `src/features/auth/` for login, register, and session logic
- `src/features/checkout/` for payment and order confirmation flow

### Example responsibilities

- `features/menu/api/menu.ts` contains the menu fetcher and menu item types.
- `features/cart/stores/cartStore.ts` contains the cart Zustand store.
- `features/auth/components/LoginForm.tsx` contains the login form UI.
- `features/checkout/hooks/useCheckout.ts` contains checkout workflow logic.

---

## Shared Code

Shared code is for reusable pieces that are not tied to a single domain.

- `components/` should hold reusable UI primitives and shared presentation components.
- `hooks/` should hold hooks that are reused in multiple parts of the app.
- `lib/` should hold generic utilities and helpers.
- `stores/` should be reserved for truly global client state.
- `api/` can be used for shared API helpers or cross-feature request utilities if the app grows beyond feature-local fetchers.

Examples of shared code:

- a common `Button`
- a reusable `Modal`
- a `useDebounce` hook
- date formatting helpers
- authentication token storage helpers
- an API client wrapper

Shared code should stay generic. If something belongs to one business domain, move it into that feature.

---

## Page Organization

Pages live in `src/app/routes/`.

A page should usually be a thin composition layer that combines feature components, shared UI, and layout. For example:

```text
src/app/routes/
├── HomePage.tsx
├── MenuPage.tsx
├── CartPage.tsx
├── CheckoutPage.tsx
└── auth/
    ├── LoginPage.tsx
    └── RegisterPage.tsx
```

### Typical page patterns

#### Home page

- hero section
- featured menu
- promotions
- call-to-action blocks

#### Menu page

- menu filters
- menu list
- pagination or infinite scroll

#### Cart page

- cart item list
- summary panel
- checkout button

#### Checkout page

- shipping or delivery details
- order summary
- payment form

#### Auth pages

- login form
- register form
- forgot password flow

### When a page becomes large

If a page has several route-specific pieces, create a folder for that route:

```text
src/app/routes/cart/
├── CartPage.tsx
├── CartHeader.tsx
├── CartSidebar.tsx
└── CartEmptyState.tsx
```

This keeps route-specific UI together without moving business logic out of the feature layer.

---

## Data Management Strategy

This app uses two main state categories.

### Server State

Use TanStack Query for backend data such as menus, orders, profiles, or other remote resources.

- Keep fetchers in `features/<feature>/api/` or in a shared `api/` folder when several features reuse the same request.
- Wrap request usage in feature-level hooks when the logic starts to repeat or needs caching behavior.

Examples:

- `useMenuQuery`
- `useOrderQuery`
- `useProfileQuery`

### Client State

Use Zustand for local UI state and ephemeral app state such as cart contents, filters, or toggles.

- Keep feature-scoped stores inside `features/<feature>/stores/` when the state belongs to one domain.
- Use the top-level `stores/` folder only for truly global state.

Examples:

- cart contents
- selected filters
- drawer open/close state
- theme toggle if it is app-wide

---

## Routing and Composition

The router should compose pages and layouts at the application level instead of letting features import across each other.

- `src/app/router.tsx` should decide which route renders which page component.
- Pages should compose feature modules, not own feature logic.
- Features should depend on shared code, but should not import from other features unless the dependency is intentional and clearly shared.
- Keep route components focused on layout and composition rather than mixing multiple domain concerns in one file.

### Good flow

```text
router -> page -> feature -> shared components
```

This keeps responsibilities clear and prevents cross-module coupling.

---

## Import Direction

Follow a one-way flow for dependencies:

```text
shared code -> features -> app
```

That means:

- `components/`, `hooks/`, `lib/`, `stores/`, and `api/` can be used by features and app code.
- `features/` can be used by `app/`.
- `app/` should not be imported by feature code.

This keeps the architecture predictable and easier to maintain as the app grows.

---

## Naming and File Conventions

- Use `PascalCase` for React component files.
- Use descriptive folder names for feature domains such as `cart`, `menu`, `orders`, or `auth`.
- Keep route files direct and readable.
- Avoid unnecessary barrel files unless they clearly improve maintainability.

### Recommended naming examples

```text
src/app/routes/HomePage.tsx
src/app/routes/CartPage.tsx
src/features/cart/components/CartList.tsx
src/features/menu/api/menu.ts
src/features/auth/components/LoginForm.tsx
```

---

## Practical Rule of Thumb

When adding new code, ask these questions:

1. Is this UI or logic reusable across the whole app? Put it in `components/`, `hooks/`, `lib/`, or `stores/`.
2. Is this tied to a specific business domain? Put it in `features/<feature>/`.
3. Is this part of route composition or app setup? Put it in `app/`.

If the answer is “this screen shows some feature UI,” put the page in `app/routes/` and keep the actual logic in the relevant feature folder.

---

## Example at a Glance

For a food ordering app, a clean structure might look like this:

```text
src/
├── app/
│   ├── app.tsx
│   ├── provider.tsx
│   ├── router.tsx
│   └── routes/
│       ├── RootLayout.tsx
│       ├── HomePage.tsx
│       ├── MenuPage.tsx
│       ├── CartPage.tsx
│       ├── CheckoutPage.tsx
│       └── auth/
│           ├── LoginPage.tsx
│           └── RegisterPage.tsx
├── components/
├── features/
│   ├── auth/
│   ├── cart/
│   ├── checkout/
│   ├── menu/
│   └── orders/
├── hooks/
├── lib/
├── stores/
├── api/
└── index.css
```

This structure keeps the app scalable, easy to navigate, and clear about where each kind of code belongs.
