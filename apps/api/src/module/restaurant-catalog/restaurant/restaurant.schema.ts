import {
  boolean,
  doublePrecision,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const restaurants = pgTable('restaurants', {
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Restaurant = typeof restaurants.$inferSelect;
export type NewRestaurant = typeof restaurants.$inferInsert;

export const deliveryZones = pgTable('delivery_zones', {
  id: uuid('id').defaultRandom().primaryKey(),
  restaurantId: uuid('restaurant_id')
    .notNull()
    .references(() => restaurants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  radiusKm: doublePrecision('radius_km').notNull(),
  deliveryFee: doublePrecision('delivery_fee').notNull().default(0),
  estimatedMinutes: doublePrecision('estimated_minutes').notNull().default(30),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type DeliveryZone = typeof deliveryZones.$inferSelect;
export type NewDeliveryZone = typeof deliveryZones.$inferInsert;
