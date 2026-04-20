import { useCallback } from "react";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { OrderBoardHeader } from "@/features/orders/components/OrderBoardHeader";
import { OrderKanbanColumn } from "@/features/orders/components/OrderKanbanColumn";
import { NewOrderToast } from "@/features/orders/components/NewOrderToast";
import { useOrderStore } from "@/features/orders/stores/orderStore";
import { Separator } from "@/components/ui/separator";
import { OrderCard } from "@/features/orders/components/OrderCard";
import type { OrderStatus } from "@/features/orders/types/order.types";

const COLUMN_ORDER: OrderStatus[] = ["requesting", "todo", "in_progress", "done"];

export function OrdersPage() {
  const handleDragEvent = useOrderStore((s) => s.handleDragEvent);
  const orders = useOrderStore((s) => s.orders);

  const handleDragOver = useCallback(
    (e: any) => {
      // For cross-column sorting, we update state immediately on drag over
      handleDragEvent(e);
    },
    [handleDragEvent]
  );

  const handleDragEnd = useCallback(
    (e: any) => {
      if (e.canceled) return;
      handleDragEvent(e);
    },
    [handleDragEvent]
  );

  return (
    // Negate MainLayout's padding so the grey Kanban background bleeds full-width
    <DragDropProvider onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div
        className="-m-4 lg:-m-6 flex flex-col bg-[#F4F5F7] overflow-hidden"
        style={{ height: "calc(100vh - 4rem)" }}
      >
        {/* Board header */}
        <div className="p-6 pb-0 flex-shrink-0">
          <OrderBoardHeader />
        </div>

        {/* Kanban columns */}
        <div className="flex-1 flex gap-4 overflow-x-auto overflow-y-hidden px-6 pb-6 min-h-0">
          {COLUMN_ORDER.map((columnId, index) => (
            <div key={columnId} className="flex gap-4 h-full flex-shrink-0">
              <OrderKanbanColumn columnId={columnId} />
              {/* shadcn Separator between columns */}
              {index < COLUMN_ORDER.length - 1 && (
                <Separator
                  orientation="vertical"
                  className="self-stretch my-4 h-auto opacity-40"
                />
              )}
            </div>
          ))}
        </div>

        <NewOrderToast />

        <DragOverlay>
          {(source) => {
            const order = source?.data as Order | undefined;
            if (!order) return null;
            return <OrderCard order={order} isOverlay />;
          }}
        </DragOverlay>
      </div>
    </DragDropProvider>
  );
}
