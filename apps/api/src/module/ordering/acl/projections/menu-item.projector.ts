import { Injectable, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { MenuItemUpdatedEvent } from '@/shared/events/menu-item-updated.event';
import { MenuItemSnapshotRepository } from '../repositories/menu-item-snapshot.repository';

/**
 * MenuItemProjector
 *
 * Listens for MenuItemUpdatedEvent from the RestaurantCatalog BC and upserts
 * the local read-model in `ordering_menu_item_snapshots` via
 * MenuItemSnapshotRepository (single source of upsert logic).
 *
 * Design:
 *  - Idempotent: ON CONFLICT (menu_item_id) DO UPDATE — safe to replay events.
 *  - No auth, no guards — projectors run inside the process event bus.
 *  - `lastSyncedAt` is reset on every upsert to track freshness.
 *  - `modifiers` JSONB column is updated with the full modifier tree from event.
 *  - DB errors are logged at ERROR level and re-thrown for observability.
 *
 * Phase: 3 — ACL Layer (updated with modifiers support)
 * Architecture decision: D3-B + D4-B (PostgreSQL snapshots, no runtime imports).
 */
@Injectable()
@EventsHandler(MenuItemUpdatedEvent)
export class MenuItemProjector implements IEventHandler<MenuItemUpdatedEvent> {
  private readonly logger = new Logger(MenuItemProjector.name);

  constructor(
    private readonly menuItemSnapshotRepo: MenuItemSnapshotRepository,
  ) {}

  async handle(event: MenuItemUpdatedEvent): Promise<void> {
    const { menuItemId, restaurantId, name, price, status, modifiers } = event;

    this.logger.debug(
      `Upserting menu item snapshot: ${menuItemId} (status=${status}, modifierGroups=${modifiers?.length ?? 'unchanged'})`,
    );

    try {
      await this.menuItemSnapshotRepo.upsert({
        menuItemId,
        restaurantId,
        name,
        price,
        status,
        modifiers,
        lastSyncedAt: new Date(),
      });
      this.logger.log(`Menu item snapshot upserted: ${menuItemId}`);
    } catch (err) {
      this.logger.error(
        `Failed to upsert menu item snapshot ${menuItemId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }
}
