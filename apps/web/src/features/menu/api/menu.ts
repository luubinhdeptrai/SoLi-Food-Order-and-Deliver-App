import type { MenuItem, MenuOverview } from "@/features/menu/types";

// Mock menu items — replace with real API calls
export const mockMenuItems: MenuItem[] = [
  {
    id: "1",
    name: "Heirloom Tomato & Basil Salad",
    description: "Farm-picked heirloom tomatoes with aged balsamic.",
    price: 14.5,
    sku: "HTB-001",
    category: "salads",
    status: "available",
    isAvailable: true,
    tags: ["Seasonal", "Popular"],
    imageUrl:
      "https://images.unsplash.com/photo-1592417817098-8fd3d9eb14a5?w=400&q=80",
  },
  {
    id: "2",
    name: "Summer Wild Berry Tart",
    description: "Shortcrust pastry with organic berries and lime zest.",
    price: 8.0,
    sku: "WBT-042",
    category: "desserts",
    status: "available",
    isAvailable: true,
    tags: ["New"],
    imageUrl:
      "https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=400&q=80",
  },
  {
    id: "3",
    name: "Stone-Ground Artisan Sourdough",
    description: "48-hour fermented loaf, locally milled grains.",
    price: 6.5,
    sku: "SGA-019",
    category: "breads",
    status: "out_of_stock",
    isAvailable: false,
    imageUrl:
      "https://images.unsplash.com/photo-1549931319-a545dcf3bc73?w=400&q=80",
  },
];

export const mockMenuOverview: MenuOverview = {
  totalItems: 3,
  availableItems: 2,
  outOfStockItems: 1,
  categories: [
    { id: "salads", label: "Salads", count: 1 },
    { id: "desserts", label: "Desserts", count: 1 },
    { id: "breads", label: "Breads", count: 1 },
  ],
};

export async function fetchMenuItems(): Promise<MenuItem[]> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return mockMenuItems;
}

export async function fetchMenuOverview(): Promise<MenuOverview> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return mockMenuOverview;
}
