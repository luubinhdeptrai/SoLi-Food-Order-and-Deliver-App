import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const restaurants = pgTable(
  'restaurants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    address: text('address').notNull(),
    phone: text('phone').notNull(),
    isOpen: boolean('is_open').notNull().default(false),
    isApproved: boolean('is_approved').notNull().default(false),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    // Catalog enrichment fields (Issue #10): cuisine type for filtering/search,
    // logo and cover images for UI display.
    cuisineType: text('cuisine_type'),
    logoUrl: text('logo_url'),
    coverImageUrl: text('cover_image_url'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Composite index speeds up the most common public query:
    // WHERE is_approved = true AND is_open = true (Issue #14).
    index('restaurants_approved_open_idx').on(table.isApproved, table.isOpen),
  ],
);

export type Restaurant = typeof restaurants.$inferSelect;
export type NewRestaurant = typeof restaurants.$inferInsert;

export const deliveryZones = pgTable('delivery_zones', {
  id: uuid('id').defaultRandom().primaryKey(),
  restaurantId: uuid('restaurant_id')
    .notNull()
    .references(() => restaurants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  radiusKm: doublePrecision('radius_km').notNull(),
  // Fees stored as integer VND (no fractional currency in Vietnam).
  baseFee: integer('base_fee').notNull().default(0),
  perKmRate: integer('per_km_rate').notNull().default(0),
  avgSpeedKmh: real('avg_speed_kmh').notNull().default(30),
  prepTimeMinutes: real('prep_time_minutes').notNull().default(15),
  bufferMinutes: real('buffer_minutes').notNull().default(5),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type DeliveryZone = typeof deliveryZones.$inferSelect;
export type NewDeliveryZone = typeof deliveryZones.$inferInsert;
