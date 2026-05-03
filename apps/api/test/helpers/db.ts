/**
 * db.ts
 *
 * Direct database query helpers for test assertions.
 * Use these when you need to verify state that is not yet exposed via an
 * API endpoint (e.g. confirm a record is truly deleted, or read raw JSONB).
 */

import { eq } from 'drizzle-orm';
import type { OrderingMenuItemSnapshot } from '../../src/module/ordering/acl/schemas/menu-item-snapshot.schema';
import { orderingMenuItemSnapshots } from '../../src/module/ordering/acl/schemas/menu-item-snapshot.schema';
import type { OrderingRestaurantSnapshot } from '../../src/module/ordering/acl/schemas/restaurant-snapshot.schema';
import { orderingRestaurantSnapshots } from '../../src/module/ordering/acl/schemas/restaurant-snapshot.schema';
import type { OrderingDeliveryZoneSnapshot } from '../../src/module/ordering/acl/schemas/delivery-zone-snapshot.schema';
import { orderingDeliveryZoneSnapshots } from '../../src/module/ordering/acl/schemas/delivery-zone-snapshot.schema';
import type { Order, OrderItem } from '../../src/module/ordering/order/order.schema';
import { orders, orderItems } from '../../src/module/ordering/order/order.schema';
import { getTestDb } from '../setup/db-setup';

/**
 * Reads the ordering_menu_item_snapshots row for a given menu item ID.
 * Returns null when the row does not exist.
 */
export async function getSnapshot(
  menuItemId: string,
): Promise<OrderingMenuItemSnapshot | null> {
  const db = getTestDb();
  const rows = await db
    .select()
    .from(orderingMenuItemSnapshots)
    .where(eq(orderingMenuItemSnapshots.menuItemId, menuItemId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Reads the ordering_restaurant_snapshots row for a given restaurant ID.
 * Returns null when the row does not exist.
 */
export async function getRestaurantSnapshot(
  restaurantId: string,
): Promise<OrderingRestaurantSnapshot | null> {
  const db = getTestDb();
  const rows = await db
    .select()
    .from(orderingRestaurantSnapshots)
    .where(eq(orderingRestaurantSnapshots.restaurantId, restaurantId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Reads the ordering_delivery_zone_snapshots row for a given zone ID.
 * Returns null when the row does not exist.
 */
export async function getDeliveryZoneSnapshot(
  zoneId: string,
): Promise<OrderingDeliveryZoneSnapshot | null> {
  const db = getTestDb();
  const rows = await db
    .select()
    .from(orderingDeliveryZoneSnapshots)
    .where(eq(orderingDeliveryZoneSnapshots.zoneId, zoneId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Reads the orders row for a given order ID.
 * Returns null when the row does not exist.
 */
export async function getOrder(orderId: string): Promise<Order | null> {
  const db = getTestDb();
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Reads all order_items rows for a given order ID.
 */
export async function getOrderItems(orderId: string): Promise<OrderItem[]> {
  const db = getTestDb();
  return db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
}
