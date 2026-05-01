import { Injectable, Inject } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';
import {
  orderingMenuItemSnapshots,
  type NewOrderingMenuItemSnapshot,
  type OrderingMenuItemSnapshot,
} from '../schemas/menu-item-snapshot.schema';
import type { MenuItemModifierSnapshot } from '@/shared/events/menu-item-updated.event';

/**
 * Upsert payload — extends the schema insert type to allow `modifiers: null`.
 *  null      → event carries no modifier data; skip updating the modifiers column.
 *  []        → item has no modifier groups (or was deleted); clear the column.
 *  [...]     → replace snapshot modifiers with this new tree.
 */
type UpsertMenuItemSnapshotData = Omit<NewOrderingMenuItemSnapshot, 'modifiers'> & {
  modifiers?: MenuItemModifierSnapshot[] | null;
};

/**
 * MenuItemSnapshotRepository
 *
 * Read/write access to `ordering_menu_item_snapshots` — the Ordering BC's local
 * projection of upstream MenuItemUpdatedEvents (populated by MenuItemProjector,
 * Phase 3).
 *
 * Phase 2 note: findById is used by CartService for optional price/name
 * cross-validation; when the snapshot is absent the DTO values are trusted.
 * Phase 3 adds: findManyByIds (checkout multi-item validation) + upsert.
 * Modifier support: modifiers JSONB column is upserted alongside other fields.
 */
@Injectable()
export class MenuItemSnapshotRepository {
  constructor(
    @Inject(DB_CONNECTION) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findById(menuItemId: string): Promise<OrderingMenuItemSnapshot | null> {
    const result = await this.db
      .select()
      .from(orderingMenuItemSnapshots)
      .where(eq(orderingMenuItemSnapshots.menuItemId, menuItemId))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Bulk-fetch snapshots by multiple IDs.
   * Used by PlaceOrderHandler (Phase 4) to validate all cart items at checkout.
   * Returns only rows that exist — callers must handle missing entries.
   */
  async findManyByIds(
    menuItemIds: string[],
  ): Promise<OrderingMenuItemSnapshot[]> {
    if (menuItemIds.length === 0) return [];
    return this.db
      .select()
      .from(orderingMenuItemSnapshots)
      .where(inArray(orderingMenuItemSnapshots.menuItemId, menuItemIds));
  }

  async upsert(data: UpsertMenuItemSnapshotData): Promise<void> {
    // For INSERT (new row): default modifiers to [] when the event carries null.
    const insertValues = {
      ...data,
      modifiers: data.modifiers ?? [],
    } as NewOrderingMenuItemSnapshot;

    await this.db
      .insert(orderingMenuItemSnapshots)
      .values(insertValues)
      .onConflictDoUpdate({
        target: orderingMenuItemSnapshots.menuItemId,
        set: {
          restaurantId: data.restaurantId,
          name: data.name,
          price: data.price,
          status: data.status,
          // null → skip updating modifiers (preserves existing snapshot data).
          // [] or [...] → write the explicit value.
          ...(data.modifiers !== null &&
            data.modifiers !== undefined && { modifiers: data.modifiers }),
          lastSyncedAt: data.lastSyncedAt ?? new Date(),
        },
      });
  }
}
