import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  index,
  uniqueIndex,
  timestamp,
  customType,
} from 'drizzle-orm/pg-core';
import { restaurants } from '../restaurant/restaurant.schema';

// ---------------------------------------------------------------------------
// Monetary column helper (M-1/M-2 fix — numeric(12,2) instead of float)
// ---------------------------------------------------------------------------
const moneyColumn = customType<{ data: number; driverData: string }>({
  dataType() {
    return 'numeric(12, 2)';
  },
  fromDriver(value) {
    return parseFloat(value);
  },
  toDriver(value) {
    return String(value);
  },
});

// ---------------------------------------------------------------------------
// Status enum (kept — canonical availability field)
// ---------------------------------------------------------------------------
export const menuItemStatusEnum = pgEnum('menu_item_status', [
  'available',
  'unavailable',
  'out_of_stock',
]);

// ---------------------------------------------------------------------------
// menu_categories — per-restaurant categories (D-2 fix, replaces global enum)
// ---------------------------------------------------------------------------
export const menuCategories = pgTable(
  'menu_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Prevent duplicate category names within the same restaurant (Issue #13).
    // The service layer catches the resulting DB error and maps it to a 409.
    uniqueIndex('menu_categories_restaurant_name_uidx').on(
      table.restaurantId,
      table.name,
    ),
  ],
);

export type MenuCategory = typeof menuCategories.$inferSelect;
export type NewMenuCategory = typeof menuCategories.$inferInsert;

// ---------------------------------------------------------------------------
// menu_items — isAvailable removed (D-3/S-2 fix); price is numeric(12,2)
// ---------------------------------------------------------------------------
export const menuItems = pgTable(
  'menu_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    price: moneyColumn('price').notNull(),
    sku: text('sku'),
    /** FK to menu_categories — nullable; items without a category are allowed */
    categoryId: uuid('category_id').references(() => menuCategories.id, {
      onDelete: 'set null',
    }),
    status: menuItemStatusEnum('status').notNull().default('available'),
    imageUrl: text('image_url'),
    tags: text('tags').array(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // GIN index enables efficient array-contains queries on tags, e.g.
    // WHERE 'vegetarian' = ANY(tags) (Issue #15).
    index('menu_items_tags_gin_idx').using('gin', table.tags),
  ],
);

export type MenuItem = typeof menuItems.$inferSelect;
export type NewMenuItem = typeof menuItems.$inferInsert;

// ---------------------------------------------------------------------------
// modifier_groups — replaces flat menu_item_modifiers (D-1 fix, full normalization)
// ---------------------------------------------------------------------------
export const modifierGroups = pgTable('modifier_groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  menuItemId: uuid('menu_item_id')
    .notNull()
    .references(() => menuItems.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Minimum number of options customer must select */
  minSelections: integer('min_selections').notNull().default(0),
  /** Maximum number of options customer can select */
  maxSelections: integer('max_selections').notNull().default(1),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type ModifierGroup = typeof modifierGroups.$inferSelect;
export type NewModifierGroup = typeof modifierGroups.$inferInsert;

// ---------------------------------------------------------------------------
// modifier_options — individual choices within a modifier group
// ---------------------------------------------------------------------------
export const modifierOptions = pgTable('modifier_options', {
  id: uuid('id').defaultRandom().primaryKey(),
  groupId: uuid('group_id')
    .notNull()
    .references(() => modifierGroups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  price: moneyColumn('price').notNull().default(0),
  isDefault: boolean('is_default').notNull().default(false),
  displayOrder: integer('display_order').notNull().default(0),
  isAvailable: boolean('is_available').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type ModifierOption = typeof modifierOptions.$inferSelect;
export type NewModifierOption = typeof modifierOptions.$inferInsert;
