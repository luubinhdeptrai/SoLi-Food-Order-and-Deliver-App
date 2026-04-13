import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  doublePrecision,
  timestamp,
} from 'drizzle-orm/pg-core';

export const menuItemCategoryEnum = pgEnum('menu_item_category', [
  'salads',
  'desserts',
  'breads',
  'mains',
  'drinks',
  'sides',
]);

export const menuItemStatusEnum = pgEnum('menu_item_status', [
  'available',
  'unavailable',
  'out_of_stock',
]);

export const menuItems = pgTable('menu_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  restaurantId: uuid('restaurant_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  price: doublePrecision('price').notNull(),
  sku: text('sku'),
  category: menuItemCategoryEnum('category').notNull(),
  status: menuItemStatusEnum('status').notNull().default('available'),
  imageUrl: text('image_url'),
  isAvailable: boolean('is_available').notNull().default(true),
  tags: text('tags').array(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type MenuItem = typeof menuItems.$inferSelect;
export type NewMenuItem = typeof menuItems.$inferInsert;
