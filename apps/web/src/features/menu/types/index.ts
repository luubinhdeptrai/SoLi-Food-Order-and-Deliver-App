export type MenuItemCategory =
  | 'salads'
  | 'desserts'
  | 'breads'
  | 'mains'
  | 'drinks'
  | 'sides';

export type MenuItemStatus = 'available' | 'unavailable' | 'out_of_stock';

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  sku: string;
  category: MenuItemCategory;
  status: MenuItemStatus;
  imageUrl?: string;
  /** Whether the item is currently visible on the storefront */
  isAvailable: boolean;
  /** Tags like "New", "Popular", "Seasonal" */
  tags?: string[];
}

export interface MenuCategory {
  id: MenuItemCategory;
  label: string;
  count: number;
}

export interface MenuOverview {
  totalItems: number;
  availableItems: number;
  outOfStockItems: number;
  categories: MenuCategory[];
}
