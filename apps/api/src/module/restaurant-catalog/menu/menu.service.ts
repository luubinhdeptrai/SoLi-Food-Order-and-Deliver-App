import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MenuRepository } from './menu.repository';
import type {
  CreateMenuItemDto,
  MenuItemCategory,
  UpdateMenuItemDto,
} from './dto/menu.dto';
import { MENU_ITEM_CATEGORIES } from './dto/menu.dto';
import type { MenuItem } from '@/module/restaurant-catalog/menu/menu.schema';
import { RestaurantService } from '@/module/restaurant-catalog/restaurant/restaurant.service';

@Injectable()
export class MenuService {
  constructor(
    private readonly repo: MenuRepository,
    private readonly restaurantService: RestaurantService,
  ) {}

  async findByRestaurant(
    restaurantId: string,
    category?: MenuItemCategory,
  ): Promise<MenuItem[]> {
    await this.restaurantService.findOne(restaurantId);
    return this.repo.findByRestaurant(restaurantId, category);
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
    return this.repo.create(dto);
  }

  async update(
    id: string,
    requesterId: string,
    isAdmin: boolean,
    dto: UpdateMenuItemDto,
  ): Promise<MenuItem> {
    await this.assertOwnership(id, requesterId, isAdmin);
    return this.repo.update(id, dto);
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
    return this.repo.update(id, { status: nextStatus });
  }

  async remove(
    id: string,
    requesterId: string,
    isAdmin: boolean,
  ): Promise<void> {
    await this.assertOwnership(id, requesterId, isAdmin);
    return this.repo.remove(id);
  }

  async assertItemAvailable(id: string): Promise<MenuItem> {
    const item = await this.findOne(id);
    if (!item.isAvailable) {
      throw new ConflictException('Item is not available for ordering');
    }
    if (item.status === 'out_of_stock') {
      throw new ConflictException('Item is out of stock');
    }
    if (item.status === 'unavailable') {
      throw new ConflictException('Item is unavailable');
    }
    return item;
  }

  getCategories(): typeof MENU_ITEM_CATEGORIES {
    return MENU_ITEM_CATEGORIES;
  }

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
