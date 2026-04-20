export type OrderStatus = "requesting" | "todo" | "in_progress" | "done";

export type OrderPriority = "high" | "normal" | "review";

export type OrderTag = {
  label: string;
  variant: "unaccepted" | "review" | "high_priority" | "delivery" | "preparing" | "ready" | "ready_pickup";
};

export type OrderItemModifier = {
  label: string;
};

export type OrderItem = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  imageUrl?: string;
  modifiers?: OrderItemModifier[];
};

export type OrderHistoryStep = "completed" | "current" | "pending";

export type OrderHistoryEvent = {
  label: string;
  time: string;
  step: OrderHistoryStep;
};

export type OrderTotals = {
  subtotal: number;
  serviceFee: number;
  deliveryFee: number;
  tax: number;
};

export type OrderDetail = {
  customer: {
    name: string;
    phone: string;
    address: string;
    gateCode?: string;
  };
  paymentMethod: string;
  totals: OrderTotals;
  items: OrderItem[];
  history: OrderHistoryEvent[];
  kitchenNotes?: string;
  placedAt: string;
  deliveryLocation?: string;
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
  detail?: OrderDetail;
};

export type KanbanColumn = {
  id: OrderStatus;
  label: string;
  icon: string;
  orders: Order[];
};
