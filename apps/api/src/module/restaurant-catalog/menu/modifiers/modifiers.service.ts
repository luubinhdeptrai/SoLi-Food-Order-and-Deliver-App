import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModifierGroupRepository, ModifierOptionRepository } from './modifiers.repository';
import { MenuRepository } from '@/module/restaurant-catalog/menu/menu.repository';
import { RestaurantService } from '@/module/restaurant-catalog/restaurant/restaurant.service';
import { MenuService } from '@/module/restaurant-catalog/menu/menu.service';
import type { ModifierGroup, ModifierOption } from '@/module/restaurant-catalog/menu/menu.schema';
import type {
  CreateModifierGroupDto,
  UpdateModifierGroupDto,
  CreateModifierOptionDto,
  UpdateModifierOptionDto,
  ModifierGroupResponseDto,
} from './modifiers.dto';
import type { MenuItemModifierSnapshot } from '@/shared/events/menu-item-updated.event';

@Injectable()
export class ModifiersService {
  constructor(
    private readonly groupRepo: ModifierGroupRepository,
    private readonly optionRepo: ModifierOptionRepository,
    private readonly menuRepo: MenuRepository,
    private readonly restaurantService: RestaurantService,
    private readonly menuService: MenuService,
  ) {}

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  /**
   * Returns all modifier groups for a menu item, each with their options embedded.
   */
  async findGroupsByMenuItem(menuItemId: string): Promise<ModifierGroupResponseDto[]> {
    await this.requireMenuItem(menuItemId);
    return this.buildGroupsWithOptions(menuItemId);
  }

  async findGroup(groupId: string, menuItemId: string): Promise<ModifierGroup> {
    const group = await this.groupRepo.findById(groupId);
    if (!group || group.menuItemId !== menuItemId) {
      throw new NotFoundException('Modifier group not found');
    }
    return group;
  }

  async findOption(optionId: string, groupId: string): Promise<ModifierOption> {
    const option = await this.optionRepo.findById(optionId);
    if (!option || option.groupId !== groupId) {
      throw new NotFoundException('Modifier option not found');
    }
    return option;
  }

  // -------------------------------------------------------------------------
  // Modifier Groups
  // -------------------------------------------------------------------------

  async createGroup(
    menuItemId: string,
    requesterId: string,
    isAdmin: boolean,
    dto: CreateModifierGroupDto,
  ): Promise<ModifierGroup> {
    await this.assertMenuItemOwnership(menuItemId, requesterId, isAdmin);
    this.validateMinMax(dto.minSelections ?? 0, dto.maxSelections ?? 1);
    const group = await this.groupRepo.create(menuItemId, dto);
    await this.publishMenuItemEvent(menuItemId);
    return group;
  }

  async updateGroup(
    groupId: string,
    menuItemId: string,
    requesterId: string,
    isAdmin: boolean,
    dto: UpdateModifierGroupDto,
  ): Promise<ModifierGroup> {
    await this.findGroup(groupId, menuItemId); // existence check
    await this.assertMenuItemOwnership(menuItemId, requesterId, isAdmin);
    const group = await this.groupRepo.update(groupId, dto);
    await this.publishMenuItemEvent(menuItemId);
    return group;
  }

  async removeGroup(
    groupId: string,
    menuItemId: string,
    requesterId: string,
    isAdmin: boolean,
  ): Promise<void> {
    await this.findGroup(groupId, menuItemId); // existence check
    await this.assertMenuItemOwnership(menuItemId, requesterId, isAdmin);
    await this.groupRepo.remove(groupId);
    await this.publishMenuItemEvent(menuItemId);
  }

  // -------------------------------------------------------------------------
  // Modifier Options
  // -------------------------------------------------------------------------

  async createOption(
    groupId: string,
    menuItemId: string,
    requesterId: string,
    isAdmin: boolean,
    dto: CreateModifierOptionDto,
  ): Promise<ModifierOption> {
    await this.findGroup(groupId, menuItemId); // group belongs to item
    await this.assertMenuItemOwnership(menuItemId, requesterId, isAdmin);
    const option = await this.optionRepo.create(groupId, dto);
    await this.publishMenuItemEvent(menuItemId);
    return option;
  }

  async updateOption(
    optionId: string,
    groupId: string,
    menuItemId: string,
    requesterId: string,
    isAdmin: boolean,
    dto: UpdateModifierOptionDto,
  ): Promise<ModifierOption> {
    await this.findOption(optionId, groupId); // existence check
    await this.findGroup(groupId, menuItemId); // group belongs to item
    await this.assertMenuItemOwnership(menuItemId, requesterId, isAdmin);
    const option = await this.optionRepo.update(optionId, dto);
    await this.publishMenuItemEvent(menuItemId);
    return option;
  }

  async removeOption(
    optionId: string,
    groupId: string,
    menuItemId: string,
    requesterId: string,
    isAdmin: boolean,
  ): Promise<void> {
    await this.findOption(optionId, groupId); // existence check
    await this.findGroup(groupId, menuItemId); // group belongs to item
    await this.assertMenuItemOwnership(menuItemId, requesterId, isAdmin);
    await this.optionRepo.remove(optionId);
    await this.publishMenuItemEvent(menuItemId);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async requireMenuItem(menuItemId: string) {
    const item = await this.menuRepo.findById(menuItemId);
    if (!item) throw new NotFoundException(`Menu item ${menuItemId} not found`);
    return item;
  }

  /**
   * Fix S-1: resolves the actual restaurant owner via RestaurantService,
   * not a stub that returned the restaurant UUID as ownerId.
   */
  private async assertMenuItemOwnership(
    menuItemId: string,
    requesterId: string,
    isAdmin: boolean,
  ): Promise<void> {
    if (isAdmin) return;
    const item = await this.requireMenuItem(menuItemId);
    const restaurant = await this.restaurantService.findOne(item.restaurantId);
    if (restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this menu item');
    }
  }

  private validateMinMax(min: number, max: number): void {
    if (max < min) {
      throw new BadRequestException(
        `maxSelections (${max}) must be ≥ minSelections (${min})`,
      );
    }
  }

  /**
   * Re-fetches the full menu item + all groups+options and publishes
   * MenuItemUpdatedEvent so the Ordering snapshot stays in sync.
   * Fix I-1: modifier mutations now publish events.
   */
  private async publishMenuItemEvent(menuItemId: string): Promise<void> {
    const item = await this.requireMenuItem(menuItemId);
    const modifiers = await this.buildGroupsWithOptions(menuItemId);
    const snapshot: MenuItemModifierSnapshot[] = modifiers.map((g) => ({
      groupId: g.id,
      groupName: g.name,
      minSelections: g.minSelections,
      maxSelections: g.maxSelections,
      options: g.options.map((o) => ({
        optionId: o.id,
        name: o.name,
        price: o.price,
        isDefault: o.isDefault,
        isAvailable: o.isAvailable,
      })),
    }));
    this.menuService.publishMenuItemEvent(item, snapshot);
  }

  private async buildGroupsWithOptions(menuItemId: string): Promise<ModifierGroupResponseDto[]> {
    const groups = await this.groupRepo.findByMenuItem(menuItemId);
    const result: ModifierGroupResponseDto[] = [];
    for (const group of groups) {
      const options = await this.optionRepo.findByGroup(group.id);
      result.push({ ...group, options });
    }
    return result;
  }
}
