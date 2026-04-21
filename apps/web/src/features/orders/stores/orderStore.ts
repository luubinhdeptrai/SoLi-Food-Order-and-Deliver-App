import { create } from "zustand";
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
    detail: {
      placedAt: "Oct 24, 2023 at 12:45 PM",
      deliveryLocation: "Springfield, IL",
      customer: {
        name: "Eleanor Fant",
        phone: "+1 (555) 0123-4567",
        address: "742 Evergreen Terrace,\nSpringfield, IL 62704",
        gateCode: "4421",
      },
      paymentMethod: "Apple Pay",
      totals: {
        subtotal: 40.50,
        serviceFee: 2.50,
        deliveryFee: 5.00,
        tax: 3.24,
      },
      items: [
        {
          id: "i1",
          name: "Artisan Harvest Bowl",
          quantity: 1,
          price: 18.50,
          imageUrl:
            "https://lh3.googleusercontent.com/aida-public/AB6AXuB_6de9BlayCYkFZbOqwnDlYdW17oavkPJci0V0UXEXsc58yRshLHsPQIUdwvXlBaQ6wYlmWwQZw6qbxjzS3omSMrIvnRrM4E0z521IvuAorxT0k1zaRs8hcNxBw-SB86RFBzyEq2TwNajUcwMgPk5LsX9OoAJ2g3lDdVn0HqrZC-AQ2TlvtFVqnCZlRg2GSYEgj48AJntpzz4iGCV1KmxT0q0W7W9HdNK--SAqWdipfn84MVK87b1H7_dxqlGXMRK4Ly-W0m6bvpI",
          modifiers: [
            { label: "Extra Avocado" },
            { label: "No Onions" },
          ],
        },
        {
          id: "i2",
          name: "Atelier Signature Burger",
          quantity: 1,
          price: 22.00,
          imageUrl:
            "https://lh3.googleusercontent.com/aida-public/AB6AXuCLwognIewT16blipkHMQ75p51XiTWYdONu2SXE-lrsqYGTVVHEgRMm_ATEDkx0x7xOXaRPhElrvjBlWiOT9n2epH96QulHG-VxXvMuSLvWcmesPiysWLkH6GwTWUDto03Jp6hWYR9N09YzdM-AY2pgXVC8e37sBS3ymU0lUlxEeskBPY1E5VH4W3tHmu77lNYpT1bHxTlm5TmxByN2CoL3C65539enP5SaJwW6cKC47RiuXZKyTCtEj26lRcMrBOaUf_GyQsQ0Prc",
          modifiers: [
            { label: "Medium Rare" },
            { label: "Truffle Fries Upgrade" },
          ],
        },
      ],
      history: [
        { label: "Order Placed", time: "Oct 24, 12:45 PM", step: "completed" },
        { label: "Order Accepted", time: "Oct 24, 12:48 PM", step: "completed" },
        { label: "Preparing Food", time: "Estimated 10-15 mins", step: "current" },
        { label: "Ready for Pickup", time: "Pending", step: "pending" },
      ],
      kitchenNotes:
        "Customer requested double wrapping for the burger to keep it warm. Please include extra napkins and a set of bamboo cutlery.",
    },
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
    detail: {
      placedAt: "Oct 24, 2023 at 12:30 PM",
      deliveryLocation: "Portland, OR",
      customer: {
        name: "Marco Bellini",
        phone: "+1 (555) 0198-7654",
        address: "18 Harvest Lane, Portland, OR 97201",
      },
      paymentMethod: "Credit Card",
      totals: { subtotal: 65.00, serviceFee: 3.00, deliveryFee: 5.00, tax: 5.85 },
      items: [
        { id: "i1", name: "Artisan Cheese Board", quantity: 1, price: 35.00 },
        { id: "i2", name: "House Red Wine", quantity: 1, price: 18.00 },
        { id: "i3", name: "Charcuterie Selection", quantity: 2, price: 12.00 },
      ],
      history: [
        { label: "Order Placed", time: "Oct 24, 12:30 PM", step: "completed" },
        { label: "Order Accepted", time: "Oct 24, 12:33 PM", step: "completed" },
        { label: "Preparing Food", time: "In progress", step: "current" },
        { label: "Ready for Pickup", time: "Pending", step: "pending" },
      ],
    },
  },
  {
    id: "8",
    orderNumber: "#8235",
    title: "Organic Grain Bowl",
    status: "in_progress",
    tag: { label: "Preparing", variant: "preparing" },
    timestamp: "15m ago",
    detail: {
      placedAt: "Oct 24, 2023 at 12:27 PM",
      deliveryLocation: "Chicago, IL",
      customer: {
        name: "Priya Sharma",
        phone: "+1 (555) 0234-5678",
        address: "290 Cedar St, Chicago, IL 60614",
      },
      paymentMethod: "Google Pay",
      totals: { subtotal: 16.00, serviceFee: 1.50, deliveryFee: 4.00, tax: 1.78 },
      items: [
        { id: "i1", name: "Organic Grain Bowl", quantity: 1, price: 16.00, modifiers: [{ label: "No Onions" }] },
      ],
      history: [
        { label: "Order Placed", time: "Oct 24, 12:27 PM", step: "completed" },
        { label: "Order Accepted", time: "Oct 24, 12:29 PM", step: "completed" },
        { label: "Preparing Food", time: "In progress", step: "current" },
        { label: "Ready for Pickup", time: "Pending", step: "pending" },
      ],
    },
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
