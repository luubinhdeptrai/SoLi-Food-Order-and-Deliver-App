import { useCallback, useRef } from "react";
import { OrderBoardHeader } from "@/features/orders/components/OrderBoardHeader";
import { OrderKanbanColumn } from "@/features/orders/components/OrderKanbanColumn";
import { NewOrderToast } from "@/features/orders/components/NewOrderToast";
import { useOrderStore } from "@/features/orders/stores/orderStore";
import type { OrderStatus } from "@/features/orders/types/order.types";

const COLUMN_ORDER: OrderStatus[] = ["requesting", "todo", "in_progress", "done"];

export function OrdersPage() {
  const moveOrder = useOrderStore((s) => s.moveOrder);
  const draggingId = useRef<string | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent, orderId: string) => {
      draggingId.current = orderId;
      e.dataTransfer.effectAllowed = "move";
    },
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetStatus: OrderStatus) => {
      e.preventDefault();
      if (draggingId.current) {
        moveOrder(draggingId.current, targetStatus);
        draggingId.current = null;
      }
    },
    [moveOrder]
  );

  return (
    // Negate the MainLayout parent padding so full-bleed background works,
    // then re-apply our own layout inside.
    <div className="-m-4 lg:-m-6 flex flex-col bg-[#F4F5F7] overflow-hidden" style={{ height: "calc(100vh - 4rem)" }}>
      <div className="p-6 pb-0 flex-shrink-0">
        <OrderBoardHeader />
      </div>

      {/* Kanban board */}
      <div className="flex-1 flex gap-4 overflow-x-auto overflow-y-hidden px-6 pb-6 min-h-0">
        {COLUMN_ORDER.map((columnId, index) => (
          <>
            <OrderKanbanColumn
              key={columnId}
              columnId={columnId}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            />
            {index < COLUMN_ORDER.length - 1 && (
              <div
                key={`sep-${columnId}`}
                className="w-px bg-[#bfcaba]/40 self-stretch my-4 flex-shrink-0"
              />
            )}
          </>
        ))}
      </div>

      {/* New order toast overlay */}
      <NewOrderToast />
    </div>
  );
}
