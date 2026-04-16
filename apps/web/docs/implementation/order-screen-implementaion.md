# Order Screen — Implementation Document

## Overview

This document describes the implementation of the **Order Management Board** screen for the Restaurant App. The screen is a Kanban-style board that visualises restaurant orders across four lifecycle stages: **Requesting → To Do → In Progress → Done**. It also features a live new-order notification toast.

The implementation sources its visual design from the Stitch project screen _"Order Board (Consistent Nav)"_ (`projects/9909505044612959912/screens/d0b10674fbd54e0d899bb1352603668d`) and a reference HTML prototype provided at implementation time.

---

## Route

```
/orders
```

Rendered inside `MainLayout` (which provides the AppSidebar and breadcrumb header). The Kanban board overrides the layout's default padding via negative margin (`-m-4 lg:-m-6`) so the grey board background bleeds edge-to-edge without restructuring the shared layout.

---

## File Structure

```
src/
├── app/
│   ├── pages/
│   │   └── orders/
│   │       └── OrdersPage.tsx          # Route-level page (thin composition layer)
│   └── router.tsx                      # Added /orders route
│
└── features/
    └── orders/
        ├── types/
        │   └── order.types.ts          # Domain types
        ├── stores/
        │   └── orderStore.ts           # Zustand client state store
        └── components/
            ├── OrderCard.tsx           # Individual Kanban card
            ├── OrderKanbanColumn.tsx   # Column container (one per status)
            ├── OrderBoardHeader.tsx    # Board title + search filter + actions
            └── NewOrderToast.tsx       # Incoming order notification overlay
```

> [!NOTE]
> This structure follows the project's **Feature Module Pattern** documented in `docs/project-structure.md`. `OrdersPage` is intentionally thin — it only wires drag state and assembles feature components. All business logic and UI live inside `features/orders/`.

---

## Architecture

```
router.tsx
  └─ MainLayout              (shared sidebar + header)
        └─ OrdersPage        (drag state, column layout)
              ├─ OrderBoardHeader   (search, Release btn, more-options)
              ├─ OrderKanbanColumn  ×4  (one per OrderStatus)
              │     └─ OrderCard    ×n  (individual order card)
              └─ NewOrderToast      (overlay, accept/dismiss)
```

### Data flow

```
useOrderStore (Zustand)
  │
  ├── orders[]           → read by OrderKanbanColumn via getOrdersByStatus()
  ├── searchQuery        → read/written by OrderBoardHeader
  ├── newOrderToast      → read by NewOrderToast
  ├── moveOrder()        → called by OrdersPage on drop
  ├── acceptOrder()      → called by NewOrderToast on "Accept"
  └── dismissToast()     → called by NewOrderToast on "Later"
```

---

## Types (`order.types.ts`)

```typescript
type OrderStatus = "requesting" | "todo" | "in_progress" | "done";

type OrderTag = {
  label: string;
  variant:
    | "unaccepted"
    | "review"
    | "high_priority"
    | "delivery"
    | "preparing"
    | "ready"
    | "ready_pickup";
};

type Order = {
  id: string;
  orderNumber: string; // e.g. "#8245"
  title: string;
  status: OrderStatus;
  tag: OrderTag;
  timestamp: string;
  assignedTo?: string; // avatar URL when a chef is assigned
  statusAction?: string; // e.g. "Hand Over" for done orders
};
```

`tag.variant` drives both the `Badge` colour variant and the status icon in `OrderCard`.

---

## State Management (`orderStore.ts`)

Implemented with **Zustand**. Chosen over local `useState` because order state is shared across multiple sibling `OrderKanbanColumn` instances without prop drilling.

### Key actions

| Action                      | Description                                                    |
| --------------------------- | -------------------------------------------------------------- |
| `getOrdersByStatus(status)` | Derived selector — filters by status and applies `searchQuery` |
| `moveOrder(id, newStatus)`  | Mutates an order's status (used after drag-and-drop)           |
| `acceptOrder(id)`           | Moves order from `requesting` → `todo`; clears toast           |
| `dismissToast()`            | Hides the new-order notification without moving the order      |
| `setSearchQuery(q)`         | Updates the live search filter string                          |

The store ships with **16 mock orders** spread across all four statuses, matching the reference design.

---

## Drag-and-Drop

The board uses **`@dnd-kit/react`** along with **`@dnd-kit/helpers`** to manage smooth cross-column list sorting and visual overlays.

Drag state is managed globally by the `<DragDropProvider>` mounted inside `OrdersPage`. It captures drop interactions (via `onDragEnd`) and passes the telemetry objects natively to the store.

### Reordering Logic (`move` Helper)

Instead of manually calculating visual offsets inside lists, we delegate the math directly to `@dnd-kit/helpers`'s `move()` function inside `orderStore.ts`:
1. The flat `orders` array is temporarily grouped into an object keyed by `OrderStatus`.
2. `move(groupedOrders, event)` processes the collision telemetry, mutating the grouped arrays precisely based on how far the item was dragged past another item.
3. We flatten the result back out, explicitly updating the order's `.status` property if it ended up dropping into a different column object.

---

## Components

### `OrderCard`

The individual item rendered inside each column.

**Visual logic uses lookup maps — no inline conditionals:**

| Map                 | Key                      | Output                            |
| ------------------- | ------------------------ | --------------------------------- |
| `TAG_BADGE_VARIANT` | `tag.variant`            | `Badge` variant string            |
| `getStatusConfig()` | `status` + `tag.variant` | Material icon name + colour class |
| `getBorderAccent()` | `status`                 | Left-border Tailwind class        |

**shadcn components used:**

- `Badge` — order status tag (see [Badge Variants](#badge-variants) below)
- `Avatar` / `AvatarImage` / `AvatarFallback` — chef assignment avatar

Cards are configured using `useSortable` (with an explicit `handleRef` over the drag handle icon) and lift on hover via `hover:-translate-y-0.5 hover:shadow-[...]`. While dragging, their `DragOverlay` clones gain `shadow-[0_8px_30px_rgba(0,0,0,0.12)] rotate-2` for a premium physical feel.

---

### `OrderKanbanColumn`

One instance per `OrderStatus`. Each column:

- Reads its orders via `getOrdersByStatus()` (search-filtered) from Zustand
- Applies a column-specific `containerClass` from `COLUMN_CONFIGS`
- The **Requesting** column uses a dashed border to signal "waiting for action"
- Scroll within a column is vertical (`overflow-y-auto`); board scroll is horizontal

---

### `OrderBoardHeader`

**shadcn components used:**

- `Input` — quick filter field (search icon absolutely positioned inside wrapper)
- `Button variant="outline" size="sm"` — Release button
- `Button variant="ghost" size="icon"` — More options (⋯) with `aria-label`

`searchQuery` is wired directly to Zustand — results update in real time across all columns as the user types.

---

### `NewOrderToast`

A fixed overlay (`position: fixed, bottom-6, right-6`) that appears when `newOrderToast` is non-null in the store.

**Animated entry:** A 100ms delayed `opacity`/`translateY` CSS transition produces a slide-up reveal.  
A `subtleBounce` keyframe (defined in `index.css`) provides a recurring gentle bounce.

**Accessibility:** `role="alert"` and `aria-live="assertive"` ensure screen readers announce the incoming order immediately.

**shadcn components used:**

- `Button variant="outline" size="sm"` — Later (dismiss)
- `Button size="sm"` — Accept (moves order to To Do)

---

### `OrdersPage`

Route-level composition component. Responsibilities:

1. Mounts `<DragDropProvider />` to serve as the global context logic provider.
2. Exposes the `onDragEnd` listener that invokes the Zustand `handleDragEvent` handler.
3. Lays out four columns with `Separator` dividers between them
4. Renders `<DragOverlay>` which projects a visually interactive clone of the active `OrderCard` globally attached to the mouse pointer.
5. Renders `NewOrderToast` as a sibling overlay

**shadcn components used:**

- `Separator orientation="vertical"` — column dividers

---

## Badge Variants

`src/components/ui/badge.tsx` was extended with five `order-*` variants so `Badge` can be used directly in `OrderCard` without ad-hoc class strings. All variants are fully typed via `VariantProps<typeof badgeVariants>`.

| Variant           | Bg / Text                                  | Used For                    |
| ----------------- | ------------------------------------------ | --------------------------- |
| `order-neutral`   | `surface-container` / `on-surface-variant` | Unaccepted, Review Required |
| `order-priority`  | `green-100` / `green-800`                  | High Priority               |
| `order-delivery`  | `amber-100` / `amber-700`                  | Delivery                    |
| `order-preparing` | `blue-50` / `blue-600`                     | Preparing                   |
| `order-ready`     | `green-100` / `green-800`                  | Ready, Ready for Pickup     |

All share `uppercase tracking-wide font-black text-[10px]` typography from the reference design.

---

## Design System Alignment

| Rule (from `DESIGN.md`)              | Applied How                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| No 1px opaque borders                | Cards use `box-shadow` for elevation, no solid borders                               |
| Surface hierarchy                    | Cards: `surface-container-lowest`; Columns: `surface-container`; Board bg: `#F4F5F7` |
| Ghost border for accessibility       | Left-border accent uses `border-outline-variant`                                     |
| Typography tokens                    | `font-headline` (Plus Jakarta Sans) for headings; `font-body` (Inter) for metadata   |
| Primary gradient on CTAs             | Toast Accept uses `bg-primary hover:bg-primary/90`                                   |
| Ambient shadow for floating elements | Toast uses `shadow-[0_8px_32px_rgba(0,0,0,0.14)]`                                    |
| Friendly roundness                   | All cards/columns use `rounded-lg`; toast uses `rounded-xl`                          |

---

## Router Registration

```tsx
// src/app/router.tsx
{
  path: "/",
  element: <MainLayout />,
  children: [
    {
      path: "orders",
      element: <OrdersPage />,
      handle: { breadcrumb: "Orders" },
    },
    // ...existing menu routes
  ],
}
```

The `handle.breadcrumb` value is picked up by `MainLayout`'s `useMatches()` breadcrumb logic automatically.

---

## `index.css` Changes

```css
@keyframes subtleBounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}
```

Applied on the toast via `style={{ animation: "subtleBounce 3s ease-in-out infinite" }}`.

---

## Known Limitations / Future Work

| Item                  | Notes                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mock data only**    | `orderStore.ts` holds static orders. Replace with a `useOrdersQuery` TanStack Query hook backed by a real endpoint when the backend is ready. |
| **No persistence**    | State resets on page refresh. Add server sync or `zustand/middleware/persist` if offline resilience is needed.                                |
| **Toast trigger**     | Hardwired to the first mock order on load. Wire `newOrderToast` to a WebSocket event or polling interval for real incoming orders.            |
| **Bundle size**       | The JS bundle exceeds 500 kB. Apply React `lazy()` + `Suspense` on `OrdersPage` at the router level for route-based code splitting.           |
