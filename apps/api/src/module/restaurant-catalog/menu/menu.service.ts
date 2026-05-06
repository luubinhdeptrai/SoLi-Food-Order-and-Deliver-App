/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { MenuRepository, type PaginatedMenuItems } from './menu.repository';
import type {
  CreateMenuItemDto,
  UpdateMenuItemDto,
  CreateMenuCategoryDto,
  UpdateMenuCategoryDto,
  MenuItemStatusFilter,
} from './dto/menu.dto';
import type {
  MenuItem,
  MenuCategory,
} from '@/module/restaurant-catalog/menu/menu.schema';
import { RestaurantService } from '@/module/restaurant-catalog/restaurant/restaurant.service';
import { MenuItemUpdatedEvent } from '@/shared/events/menu-item-updated.event';
import type { MenuItemModifierSnapshot } from '@/shared/events/menu-item-updated.event';

export interface FindByRestaurantOptions {
  categoryId?: string;
  status?: MenuItemStatusFilter;
  offset?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Pagination constants
// ---------------------------------------------------------------------------
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class MenuService {
  constructor(
    private readonly repo: MenuRepository,
    private readonly restaurantService: RestaurantService,
    private readonly eventBus: EventBus,
  ) {}

  // -------------------------------------------------------------------------
  // Menu Items
  // -------------------------------------------------------------------------

  async findByRestaurant(
    restaurantId: string,
    opts: FindByRestaurantOptions = {},
  ): Promise<PaginatedMenuItems> {
    await this.restaurantService.findOne(restaurantId);
    const safeLimit = Math.min(opts.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    return this.repo.findByRestaurant(restaurantId, {
      ...opts,
      limit: safeLimit,
    });
  }

  async findOne(id: string): Promise<MenuItem> {
    const item = await this.repo.findById(id);
    if (!item) {
      throw new NotFoundException(`Menu item ${id} not found`);
    }
    return item;
  }

  async create(
    requesterId: string,
    isAdmin: boolean,
    dto: CreateMenuItemDto,
  ): Promise<MenuItem> {
    const restaurant = await this.restaurantService.findOne(dto.restaurantId);
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    const item = await this.repo.create(dto);
    this.publishMenuItemEvent(item, []);
    return item;
  }

  async update(
    id: string,
    requesterId: string,
    isAdmin: boolean,
    dto: UpdateMenuItemDto,
  ): Promise<MenuItem> {
    await this.assertOwnership(id, requesterId, isAdmin);
    const item = await this.repo.update(id, dto);
    // null = no modifier data in this event; projector will preserve existing snapshot modifiers
    this.publishMenuItemEvent(item, null);
    return item;
  }

  async toggleSoldOut(
    id: string,
    requesterId: string,
    isAdmin: boolean,
  ): Promise<MenuItem> {
    const item = await this.assertOwnership(id, requesterId, isAdmin);
    if (item.status === 'unavailable') {
      throw new ConflictException(
        'Cannot toggle sold-out on an unavailable item; mark it available first',
      );
    }
    const nextStatus =
      item.status === 'out_of_stock' ? 'available' : 'out_of_stock';
    const updated = await this.repo.update(id, { status: nextStatus });
    // null = no modifier data in this event; projector will preserve existing snapshot modifiers
    this.publishMenuItemEvent(updated, null);
    return updated;
  }

  async remove(
    id: string,
    requesterId: string,
    isAdmin: boolean,
  ): Promise<void> {
    const item = await this.assertOwnership(id, requesterId, isAdmin);
    await this.repo.remove(id);
    // Publish with 'unavailable' so the Ordering snapshot is invalidated
    this.eventBus.publish(
      new MenuItemUpdatedEvent(
        item.id,
        item.restaurantId,
        item.name,
        item.price,
        'unavailable',
        [],
      ),
    );
  }

  /**
   * Fixed S-2: uses `status` as the single source of truth.
   * `isAvailable` field has been removed from the schema.
   */
  async assertItemAvailable(id: string): Promise<MenuItem> {
    const item = await this.findOne(id);
    if (item.status !== 'available') {
      const reason =
        item.status === 'out_of_stock' ? 'out of stock' : 'unavailable';
      throw new ConflictException(`Item is ${reason}`);
    }
    return item;
  }

  // -------------------------------------------------------------------------
  // Menu Categories
  // -------------------------------------------------------------------------

  async findCategoriesByRestaurant(
    restaurantId: string,
  ): Promise<MenuCategory[]> {
    await this.restaurantService.findOne(restaurantId);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.repo.findCategoriesByRestaurant(restaurantId);
  }

  async createCategory(
    requesterId: string,
    isAdmin: boolean,
    dto: CreateMenuCategoryDto,
  ): Promise<MenuCategory> {
    const restaurant = await this.restaurantService.findOne(dto.restaurantId);
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    return this.repo.createCategory(dto);
  }

  async updateCategory(
    id: string,
    requesterId: string,
    isAdmin: boolean,
    dto: UpdateMenuCategoryDto,
  ): Promise<MenuCategory> {
    const category = await this.repo.findCategoryById(id);
    if (!category) throw new NotFoundException(`Category ${id} not found`);
    const restaurant = await this.restaurantService.findOne(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      category.restaurantId,
    );
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    return this.repo.updateCategory(id, dto);
  }

  async removeCategory(
    id: string,
    requesterId: string,
    isAdmin: boolean,
  ): Promise<void> {
    const category = await this.repo.findCategoryById(id);
    if (!category) throw new NotFoundException(`Category ${id} not found`);
    const restaurant = await this.restaurantService.findOne(
      category.restaurantId,
    );
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    await this.repo.removeCategory(id);
  }

  // -------------------------------------------------------------------------
  // Event publishing (called by MenuService and injected into ModifiersService)
  // -------------------------------------------------------------------------

  /**
   * Publishes a MenuItemUpdatedEvent with the latest item state + modifier snapshot.
   * `modifiers` is passed in by the caller (ModifiersService re-fetches them after any change).
   */
  publishMenuItemEvent(
    item: MenuItem,
    modifiers: MenuItemModifierSnapshot[] | null,
  ): void {
    this.eventBus.publish(
      new MenuItemUpdatedEvent(
        item.id,
        item.restaurantId,
        item.name,
        item.price,
        item.status,
        modifiers,
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async assertOwnership(
    itemId: string,
    requesterId: string,
    isAdmin: boolean,
  ): Promise<MenuItem> {
    const item = await this.findOne(itemId);
    if (!isAdmin) {
      const restaurant = await this.restaurantService.findOne(
        item.restaurantId,
      );
      if (restaurant.ownerId !== requesterId) {
        throw new ForbiddenException('You do not own this restaurant');
      }
    }
    return item;
  }
}
