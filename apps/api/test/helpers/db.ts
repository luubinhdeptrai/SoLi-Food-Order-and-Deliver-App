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
