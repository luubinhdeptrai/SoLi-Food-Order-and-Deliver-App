export type OrderStatus = "requesting" | "todo" | "in_progress" | "done";

/** Branded ISO-8601 date-time string for compile-time safety. */
export type ISOString = string & { readonly _brand: unique symbol };

/** Priority levels – does NOT include review state (see OrderReviewStatus). */
export type OrderPriority = "high" | "normal";

/** Separate status for orders requiring a manual review step. */
export type OrderReviewStatus = "review";

export type OrderTag = {
  label: string;
  variant: "unaccepted" | "review" | "high_priority" | "delivery" | "preparing" | "ready" | "ready_pickup";
};

export type OrderItemModifier = {
  label: string;
  /** Additional cost of this modifier, in the order's currency units. */
  price: number;
};

export type OrderItem = {
  id: string;
  name: string;
  quantity: number;
  /** Cost per single unit of this item. */
  unitPrice: number;
  /** Total cost for this line (unitPrice × quantity). Computed or pre-populated. */
  totalPrice?: number;
  imageUrl?: string;
  modifiers?: OrderItemModifier[];
};

export type OrderHistoryStep = "completed" | "current" | "pending";

export type OrderHistoryEvent = {
  label: string;
  /** ISO-8601 date-time string when this event occurred (or a human label for pending). */
  time: ISOString | string;
  step: OrderHistoryStep;
};

export type OrderTotals = {
  subtotal: number;
  serviceFee: number;
  deliveryFee: number;
  tax: number;
  /** Grand total: subtotal + serviceFee + deliveryFee + tax. */
  total: number;
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
  /** ISO-8601 date-time string when the order was placed. */
  placedAt: ISOString | string;
  deliveryLocation?: string;
};

export type Order = {
  id: string;
  orderNumber: string;
  title: string;
  status: OrderStatus;
  tag: OrderTag;
  /** ISO-8601 date-time or relative label (e.g. "Just now", "5m ago"). */
  timestamp: ISOString | string;
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
