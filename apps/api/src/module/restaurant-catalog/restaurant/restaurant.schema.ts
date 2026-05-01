import {
  boolean,
  customType,
  doublePrecision,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * zoneFeeColumn — NUMERIC(10, 2) stored as a TypeScript `number`.
 *
 * Drizzle's built-in `numeric()` maps to `string` in TypeScript (to avoid
 * floating-point loss). We use `customType` so that TS treats it as `number`
 * while the DB column remains `NUMERIC(10, 2)` for exact decimal arithmetic.
 * This mirrors the `moneyColumn` pattern in order.schema.ts.
 */
const zoneFeeColumn = customType<{ data: number; driverData: string }>({
  dataType() {
    return 'numeric(10, 2)';
  },
  fromDriver(value) {
    return parseFloat(value as string);
  },
  toDriver(value) {
    return String(value);
  },
});

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
  baseFee: zoneFeeColumn('base_fee').notNull().default(0),
  perKmRate: zoneFeeColumn('per_km_rate').notNull().default(0),
  avgSpeedKmh: real('avg_speed_kmh').notNull().default(30),
  prepTimeMinutes: real('prep_time_minutes').notNull().default(15),
  bufferMinutes: real('buffer_minutes').notNull().default(5),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type DeliveryZone = typeof deliveryZones.$inferSelect;
export type NewDeliveryZone = typeof deliveryZones.$inferInsert;
