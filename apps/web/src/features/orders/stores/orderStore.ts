import { create } from "zustand";
import { move } from "@dnd-kit/helpers";
import type { Order, OrderStatus } from "@/features/orders/types/order.types";

const initialOrders: Order[] = [
  // Requesting
  {
    id: "1",
    orderNumber: "#8245",
    title: "Farmhouse Breakfast Platter",
    status: "requesting",
    tag: { label: "Unaccepted", variant: "unaccepted" },
    timestamp: "Just now",
  },
  {
    id: "2",
    orderNumber: "#8244",
    title: "Berry Smoothie Bowl x 2",
    status: "requesting",
    tag: { label: "Review Required", variant: "review" },
    timestamp: "1m ago",
  },

  // To Do
  {
    id: "3",
    orderNumber: "#8241",
    title: "Artisan Veggie Box Selection",
    status: "todo",
    tag: { label: "High Priority", variant: "high_priority" },
    timestamp: "2m ago",
  },
  {
    id: "4",
    orderNumber: "#8240",
    title: "Morning Harvest Bundle",
    status: "todo",
    tag: { label: "Delivery", variant: "delivery" },
    timestamp: "5m ago",
  },
  {
    id: "5",
    orderNumber: "#8239",
    title: "Seasonal Fruit Basket",
    status: "todo",
    tag: { label: "High Priority", variant: "high_priority" },
    timestamp: "7m ago",
  },
  {
    id: "6",
    orderNumber: "#8237",
    title: "Cold Brew Coffee Set",
    status: "todo",
    tag: { label: "Delivery", variant: "delivery" },
    timestamp: "10m ago",
  },

  // In Progress
  {
    id: "7",
    orderNumber: "#8238",
    title: "Cheese Board Kit & Wine",
    status: "in_progress",
    tag: { label: "Preparing", variant: "preparing" },
    timestamp: "12m ago",
    assignedTo:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuBMSpJfhErzfUb1xgNiGE6gMadfDP45egaVaIuxwq7JlVkPAwKfF0DT4wflzvItJSgP6GphNviAKQcZlNENi6hJe2gZYZ9wBkvxghtyUl3DFPRG_c2z07rFwz18OAKkPDI6ci-vzmtIPVZPAUxRo2qkuh9lCykLH9VAF2Ug3jB-rp_jMQu4WuPCjsrrQmbfX6pC3XNS5y1V5EkUQu2p8dBPKv1xYndCp-g0OIPgzutS0hNKhyyV31j-ZHrVdWYlJST_yhkPwGkYdlg",
  },
  {
    id: "8",
    orderNumber: "#8235",
    title: "Organic Grain Bowl",
    status: "in_progress",
    tag: { label: "Preparing", variant: "preparing" },
    timestamp: "15m ago",
  },

  // Done
  {
    id: "9",
    orderNumber: "#8230",
    title: "Sourdough Loaf x 4",
    status: "done",
    tag: { label: "Ready for Pickup", variant: "ready_pickup" },
    timestamp: "20m ago",
    statusAction: "Hand Over",
  },
  {
    id: "10",
    orderNumber: "#8228",
    title: "Greek Yogurt Selection",
    status: "done",
    tag: { label: "Ready", variant: "ready" },
    timestamp: "25m ago",
  },
  {
    id: "11",
    orderNumber: "#8225",
    title: "Handmade Pasta Bundle",
    status: "done",
    tag: { label: "Ready", variant: "ready" },
    timestamp: "30m ago",
  },
  {
    id: "12",
    orderNumber: "#8220",
    title: "Farm Fresh Eggs x 2 doz",
    status: "done",
    tag: { label: "Ready", variant: "ready" },
    timestamp: "35m ago",
  },
  {
    id: "13",
    orderNumber: "#8218",
    title: "Artisan Honey Collection",
    status: "done",
    tag: { label: "Ready", variant: "ready" },
    timestamp: "40m ago",
  },
  {
    id: "14",
    orderNumber: "#8215",
    title: "Heritage Tomato Medley",
    status: "done",
    tag: { label: "Ready", variant: "ready" },
    timestamp: "45m ago",
  },
  {
    id: "15",
    orderNumber: "#8212",
    title: "Seasonal Cheese Platter",
    status: "done",
    tag: { label: "Ready", variant: "ready" },
    timestamp: "50m ago",
  },
  {
    id: "16",
    orderNumber: "#8210",
    title: "Wild Mushroom Basket",
    status: "done",
    tag: { label: "Ready", variant: "ready" },
    timestamp: "55m ago",
  },
];

type OrderStore = {
  orders: Order[];
  searchQuery: string;
  newOrderToast: Order | null;
  setSearchQuery: (q: string) => void;
  moveOrder: (orderId: string, newStatus: OrderStatus) => void;
  handleDragEvent: (event: any) => void;
  acceptOrder: (orderId: string) => void;
  dismissToast: () => void;
  getOrdersByStatus: (status: OrderStatus) => Order[];
};

export const useOrderStore = create<OrderStore>((set, get) => ({
  orders: initialOrders,
  searchQuery: "",
  newOrderToast: initialOrders[0],

  setSearchQuery: (q) => set({ searchQuery: q }),

  moveOrder: (orderId, newStatus) =>
    set((state) => {
      const orders = [...state.orders];
      const index = orders.findIndex((o) => o.id === orderId);
      if (index === -1) return state;
      const [order] = orders.splice(index, 1);
      order.status = newStatus;
      orders.push(order);
      return { orders };
    }),

  handleDragEvent: (event) =>
    set((state) => {
      // 1. Group records for dnd-kit helper
      const grouped: Record<OrderStatus, Order[]> = {
        requesting: [],
        todo: [],
        in_progress: [],
        done: [],
      };

      state.orders.forEach((o) => {
        grouped[o.status].push(o);
      });

      // 2. Compute spatial move logic automatically
      const newGrouped = move(grouped, event) as Record<OrderStatus, Order[]>;

      // 3. Un-group back into flat store format
      const newOrders: Order[] = [];
      const statuses: OrderStatus[] = ["requesting", "todo", "in_progress", "done"];
      
      statuses.forEach((status) => {
        if (!newGrouped[status]) return;
        newGrouped[status].forEach((order) => {
          if (order.status !== status) {
            newOrders.push({ ...order, status });
          } else {
            newOrders.push(order);
          }
        });
      });

      return { orders: newOrders };
    }),

  acceptOrder: (orderId) =>
    set((state) => ({
      orders: state.orders.map((o) =>
        o.id === orderId
          ? {
              ...o,
              status: "todo",
              tag: { label: "High Priority", variant: "high_priority" },
            }
          : o,
      ),
      newOrderToast: null,
    })),

  dismissToast: () => set({ newOrderToast: null }),

  getOrdersByStatus: (status) => {
    const { orders, searchQuery } = get();
    return orders
      .filter((o) => o.status === status)
      .filter(
        (o) =>
          !searchQuery ||
          o.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          o.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()),
      );
  },
}));
