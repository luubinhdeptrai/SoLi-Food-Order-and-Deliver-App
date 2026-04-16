import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/features/orders/types/order.types";
import { OrderCard } from "@/features/orders/components/OrderCard";
import { useOrderStore } from "@/features/orders/stores/orderStore";

type ColumnConfig = {
  id: OrderStatus;
  label: string;
  icon: string;
  style: {
    container: string;
    headerText: string;
    countText: string;
    border?: string;
  };
};

const COLUMN_CONFIGS: ColumnConfig[] = [
  {
    id: "requesting",
    label: "REQUESTING",
    icon: "hourglass_empty",
    style: {
      container: "bg-[#e2e2e2]/60 border-2 border-dashed border-[#bfcaba]",
      headerText: "text-[#40493d]",
      countText: "text-[#707a6c]",
    },
  },
  {
    id: "todo",
    label: "TO DO",
    icon: "checklist",
    style: {
      container: "bg-[#EBECF0]",
      headerText: "text-[#40493d]",
      countText: "text-[#707a6c]",
    },
  },
  {
    id: "in_progress",
    label: "IN PROGRESS",
    icon: "sync",
    style: {
      container: "bg-[#EBECF0]",
      headerText: "text-[#40493d]",
      countText: "text-[#707a6c]",
    },
  },
  {
    id: "done",
    label: "DONE",
    icon: "check_circle",
    style: {
      container: "bg-[#EBECF0]",
      headerText: "text-[#40493d]",
      countText: "text-[#707a6c]",
    },
  },
];

type OrderKanbanColumnProps = {
  columnId: OrderStatus;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetStatus: OrderStatus) => void;
  onDragStart: (e: React.DragEvent, orderId: string) => void;
};

export function OrderKanbanColumn({
  columnId,
  onDragOver,
  onDrop,
  onDragStart,
}: OrderKanbanColumnProps) {
  const getOrdersByStatus = useOrderStore((s) => s.getOrdersByStatus);
  const orders = getOrdersByStatus(columnId);
  const config = COLUMN_CONFIGS.find((c) => c.id === columnId)!;

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg min-h-full min-w-[300px] max-w-[360px] flex-shrink-0",
        config.style.container
      )}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, columnId)}
    >
      {/* Column header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3
            className={cn(
              "text-xs font-bold uppercase tracking-wider font-['Plus_Jakarta_Sans']",
              config.style.headerText
            )}
          >
            {config.label}
          </h3>
          <span className={cn("text-xs font-bold", config.style.countText)}>
            {orders.length}
          </span>
        </div>
        <span className="material-symbols-outlined text-[#707a6c] text-sm">
          {config.icon}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 px-2 space-y-3 overflow-y-auto pb-4">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} onDragStart={onDragStart} />
        ))}

        {orders.length === 0 && (
          <div className="text-center py-8 text-[#707a6c] text-xs font-medium opacity-60">
            No orders
          </div>
        )}
      </div>
    </div>
  );
}
