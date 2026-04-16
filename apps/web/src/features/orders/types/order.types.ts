export type OrderStatus = "requesting" | "todo" | "in_progress" | "done";

export type OrderPriority = "high" | "normal" | "review";

export type OrderTag = {
  label: string;
  variant: "unaccepted" | "review" | "high_priority" | "delivery" | "preparing" | "ready" | "ready_pickup";
};

export type Order = {
  id: string;
  orderNumber: string;
  title: string;
  status: OrderStatus;
  tag: OrderTag;
  timestamp: string;
  assignedTo?: string;
  statusAction?: string;
};

export type KanbanColumn = {
  id: OrderStatus;
  label: string;
  icon: string;
  orders: Order[];
};
