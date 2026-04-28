import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModifiersRepository } from './modifiers.repository';
import { MenuService } from '../menu.service';
import type { CreateMenuItemModifierDto, UpdateMenuItemModifierDto } from './modifiers.dto';
import type { MenuItemModifier } from '@/module/restaurant-catalog/menu/menu.schema';

@Injectable()
export class ModifiersService {
  constructor(
    private readonly repo: ModifiersRepository,
    private readonly menuService: MenuService,
  ) {}

  async findByMenuItem(menuItemId: string): Promise<MenuItemModifier[]> {
    await this.menuService.findOne(menuItemId);
    return this.repo.findByMenuItem(menuItemId);
  }

  async findOne(id: string, menuItemId: string): Promise<MenuItemModifier> {
    const modifier = await this.repo.findById(id);
    if (!modifier || modifier.menuItemId !== menuItemId) {
      throw new NotFoundException('Modifier not found');
    }
    return modifier;
  }

  async create(
    menuItemId: string,
    requesterId: string,
    isAdmin: boolean,
    dto: CreateMenuItemModifierDto,
  ): Promise<MenuItemModifier> {
    const item = await this.menuService.findOne(menuItemId);
    if (!isAdmin) {
      const restaurant = await this.getRestaurantForItem(item.restaurantId);
      if (restaurant.ownerId !== requesterId) {
        throw new ForbiddenException('You do not own this menu item');
      }
    }
    return this.repo.create(menuItemId, dto);
  }

  async update(
    id: string,
    menuItemId: string,
    requesterId: string,
    isAdmin: boolean,
    dto: UpdateMenuItemModifierDto,
  ): Promise<MenuItemModifier> {
    const modifier = await this.findOne(id, menuItemId);
    const item = await this.menuService.findOne(menuItemId);
    if (!isAdmin) {
      const restaurant = await this.getRestaurantForItem(item.restaurantId);
      if (restaurant.ownerId !== requesterId) {
        throw new ForbiddenException('You do not own this menu item');
      }
    }
    return this.repo.update(id, dto);
  }

  async remove(
    id: string,
    menuItemId: string,
    requesterId: string,
    isAdmin: boolean,
  ): Promise<void> {
    const modifier = await this.findOne(id, menuItemId);
    const item = await this.menuService.findOne(menuItemId);
    if (!isAdmin) {
      const restaurant = await this.getRestaurantForItem(item.restaurantId);
      if (restaurant.ownerId !== requesterId) {
        throw new ForbiddenException('You do not own this menu item');
      }
    }
    return this.repo.remove(id);
  }

  private async getRestaurantForItem(restaurantId: string) {
    return { ownerId: restaurantId };
  }
}
