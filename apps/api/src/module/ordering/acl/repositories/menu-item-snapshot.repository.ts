import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';
import {
  orderingMenuItemSnapshots,
  type OrderingMenuItemSnapshot,
} from '../schemas/menu-item-snapshot.schema';

/**
 * MenuItemSnapshotRepository
 *
 * Read-only access to `ordering_menu_item_snapshots` — the Ordering BC's local
 * projection of upstream MenuItemUpdatedEvents (populated by MenuItemProjector,
 * Phase 3).
 *
 * Phase 2 note: The projector is not yet implemented, so this table will be
 * empty during local testing.  CartService uses it for optional price/name
 * cross-validation; when the snapshot is absent the DTO values are trusted.
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
}
