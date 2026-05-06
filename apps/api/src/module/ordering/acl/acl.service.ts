import { Injectable, NotFoundException } from '@nestjs/common';
import { MenuItemSnapshotRepository } from './repositories/menu-item-snapshot.repository';
import { RestaurantSnapshotRepository } from './repositories/restaurant-snapshot.repository';
import type {
  MenuItemSnapshotResponseDto,
  RestaurantSnapshotResponseDto,
} from './dto/acl.dto';

/**
 * AclService
 *
 * Thin read-side service for the ACL layer. Delegates all DB access to the
 * snapshot repositories and applies the 404 guard so the controller stays clean.
 *
 * No write logic lives here — all writes happen in the projectors via EventBus.
 *
 * Phase: 3 — ACL Layer
 */
@Injectable()
export class AclService {
  constructor(
    private readonly menuItemSnapshotRepo: MenuItemSnapshotRepository,
    private readonly restaurantSnapshotRepo: RestaurantSnapshotRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Menu item snapshots
  // ---------------------------------------------------------------------------

  async getMenuItemById(
    menuItemId: string,
  ): Promise<MenuItemSnapshotResponseDto> {
    const snapshot = await this.menuItemSnapshotRepo.findById(menuItemId);
    if (!snapshot) {
      throw new NotFoundException(
        `Menu item snapshot not found: ${menuItemId}`,
      );
    }
    return snapshot as MenuItemSnapshotResponseDto;
  }

  /**
   * Bulk lookup by comma-separated IDs.
   * Returns only the rows that exist — callers must handle missing entries.
   * An empty `ids` list returns an empty array without hitting the DB.
   */
  async getMenuItemsByIds(
    ids: string[],
  ): Promise<MenuItemSnapshotResponseDto[]> {
    if (ids.length === 0) return [];
    return this.menuItemSnapshotRepo.findManyByIds(ids) as Promise<
      MenuItemSnapshotResponseDto[]
    >;
  }

  // ---------------------------------------------------------------------------
  // Restaurant snapshots
  // ---------------------------------------------------------------------------

  async getRestaurantById(
    restaurantId: string,
  ): Promise<RestaurantSnapshotResponseDto> {
    const snapshot = await this.restaurantSnapshotRepo.findById(restaurantId);
    if (!snapshot) {
      throw new NotFoundException(
        `Restaurant snapshot not found: ${restaurantId}`,
      );
    }
    return snapshot as RestaurantSnapshotResponseDto;
  }

  /**
   * Bulk lookup by comma-separated IDs.
   * Returns only the rows that exist.
   */
  async getRestaurantsByIds(
    ids: string[],
  ): Promise<RestaurantSnapshotResponseDto[]> {
    if (ids.length === 0) return [];
    return this.restaurantSnapshotRepo.findManyByIds(ids) as Promise<
      RestaurantSnapshotResponseDto[]
    >;
  }

  // ---------------------------------------------------------------------------
  // Shared helper
  // ---------------------------------------------------------------------------

  /**
   * Parses a comma-separated IDs string from a query parameter.
   * Filters out empty segments so `?ids=` (empty) returns [].
   */
  parseIds(raw: string): string[] {
    return raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }
}
