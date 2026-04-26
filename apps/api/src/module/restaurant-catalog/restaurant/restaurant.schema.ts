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
