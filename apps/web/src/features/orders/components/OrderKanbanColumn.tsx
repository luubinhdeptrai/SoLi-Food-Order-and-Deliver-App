import { useDroppable } from "@dnd-kit/react";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/features/orders/types/order.types";
import { OrderCard } from "@/features/orders/components/OrderCard";
import { useOrderStore } from "@/features/orders/stores/orderStore";

// ── Column visual configuration ───────────────────────────────────────────────
type ColumnConfig = {
  id: OrderStatus;
  label: string;
  icon: string;
  containerClass: string;
};

const COLUMN_CONFIGS: ColumnConfig[] = [
  {
    id: "requesting",
    label: "REQUESTING",
    icon: "hourglass_empty",
    // Dashed border with slightly darker surface to signal "pending" state
    containerClass:
      "bg-surface-container-high/60 border-2 border-dashed border-outline-variant/60",
  },
  {
    id: "todo",
    label: "TO DO",
    icon: "checklist",
    containerClass: "bg-surface-container",
  },
  {
    id: "in_progress",
    label: "IN PROGRESS",
    icon: "sync",
    containerClass: "bg-surface-container",
  },
  {
    id: "done",
    label: "DONE",
    icon: "check_circle",
    containerClass: "bg-surface-container",
  },
];

// ── Component ────────────────────────────────────────────────────────────────
type OrderKanbanColumnProps = {
  columnId: OrderStatus;
};

export function OrderKanbanColumn({ columnId }: OrderKanbanColumnProps) {
  const getOrdersByStatus = useOrderStore((s) => s.getOrdersByStatus);
  const orders = getOrdersByStatus(columnId);
  const config = COLUMN_CONFIGS.find((c) => c.id === columnId)!;

  const { ref, isDropTarget } = useDroppable({ id: columnId });

  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-col rounded-lg h-full w-[300px] xl:w-[340px] flex-shrink-0 transition-all duration-200",
        config.containerClass,
        isDropTarget && "ring-2 ring-primary ring-offset-2 ring-offset-[#F4F5F7] opacity-90"
      )}
    >
      {/* Column header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant font-headline">
            {config.label}
          </h3>
          <span className="text-xs font-bold text-muted-foreground">
            {orders.length}
          </span>
        </div>
        <span
          className="material-symbols-outlined text-muted-foreground text-sm"
          aria-hidden="true"
        >
          {config.icon}
        </span>
      </div>

      {/* Scrollable card list */}
      <div className="flex-1 px-2 pb-2 space-y-2.5 overflow-y-auto min-h-0">
        {orders.map((order, index) => (
          <OrderCard key={order.id} order={order} index={index} />
        ))}

        {orders.length === 0 && (
          <p className="text-center py-8 text-muted-foreground text-xs font-medium opacity-60">
            No orders
          </p>
        )}
      </div>
    </div>
  );
}
