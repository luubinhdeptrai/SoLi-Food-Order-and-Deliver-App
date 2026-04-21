import { OrderBoardHeader } from "@/features/orders/components/OrderBoardHeader";
import { OrderKanbanColumn } from "@/features/orders/components/OrderKanbanColumn";
import { NewOrderToast } from "@/features/orders/components/NewOrderToast";
import { Separator } from "@/components/ui/separator";
import type { OrderStatus } from "@/features/orders/types/order.types";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { useOrderStore } from "@/features/orders/stores/orderStore";

const COLUMN_ORDER: OrderStatus[] = [
  "requesting",
  "todo",
  "in_progress",
  "done",
];

export function OrdersPage() {
  const reorderOrder = useOrderStore((s) => s.reorderOrder);

  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    reorderOrder(
      draggableId,
      source.droppableId as OrderStatus,
      destination.droppableId as OrderStatus,
      source.index,
      destination.index
    );
  };

  return (
    // Negate MainLayout's padding so the grey Kanban background bleeds full-width
    <div
      className="-m-4 lg:-m-6 flex flex-col bg-[#F4F5F7] overflow-hidden"
      style={{ height: "calc(100vh - 4rem)" }}
    >
      {/* Board header */}
      <div className="p-6 pb-0 flex-shrink-0">
        <OrderBoardHeader />
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
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
      </DragDropContext>

      <NewOrderToast />
    </div>
  );
}
