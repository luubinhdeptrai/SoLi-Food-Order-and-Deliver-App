import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  modifierGroups,
  modifierOptions,
  type ModifierGroup,
  type NewModifierGroup,
  type ModifierOption,
  type NewModifierOption,
} from '@/module/restaurant-catalog/menu/menu.schema';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';
import type {
  CreateModifierGroupDto,
  UpdateModifierGroupDto,
  CreateModifierOptionDto,
  UpdateModifierOptionDto,
} from './modifiers.dto';

// ---------------------------------------------------------------------------
// ModifierGroupRepository
// ---------------------------------------------------------------------------

@Injectable()
export class ModifierGroupRepository {
  constructor(
    @Inject(DB_CONNECTION) readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findByMenuItem(menuItemId: string): Promise<ModifierGroup[]> {
    return this.db
      .select()
      .from(modifierGroups)
      .where(eq(modifierGroups.menuItemId, menuItemId))
      .orderBy(modifierGroups.displayOrder);
  }

  async findById(id: string): Promise<ModifierGroup | null> {
    const result = await this.db
      .select()
      .from(modifierGroups)
      .where(eq(modifierGroups.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  async create(menuItemId: string, dto: CreateModifierGroupDto): Promise<ModifierGroup> {
    const data: NewModifierGroup = {
      menuItemId,
      name: dto.name,
      minSelections: dto.minSelections ?? 0,
      maxSelections: dto.maxSelections ?? 1,
      displayOrder: dto.displayOrder ?? 0,
    };
    const [row] = await this.db.insert(modifierGroups).values(data).returning();
    return row;
  }

  async update(id: string, dto: UpdateModifierGroupDto): Promise<ModifierGroup> {
    const [row] = await this.db
      .update(modifierGroups)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(modifierGroups.id, id))
      .returning();
    return row;
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(modifierGroups).where(eq(modifierGroups.id, id));
  }
}

// ---------------------------------------------------------------------------
// ModifierOptionRepository
// ---------------------------------------------------------------------------

@Injectable()
export class ModifierOptionRepository {
  constructor(
    @Inject(DB_CONNECTION) readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findByGroup(groupId: string): Promise<ModifierOption[]> {
    return this.db
      .select()
      .from(modifierOptions)
      .where(eq(modifierOptions.groupId, groupId))
      .orderBy(modifierOptions.displayOrder);
  }

  async findById(id: string): Promise<ModifierOption | null> {
    const result = await this.db
      .select()
      .from(modifierOptions)
      .where(eq(modifierOptions.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  async create(groupId: string, dto: CreateModifierOptionDto): Promise<ModifierOption> {
    const data: NewModifierOption = {
      groupId,
      name: dto.name,
      price: dto.price ?? 0,
      isDefault: dto.isDefault ?? false,
      displayOrder: dto.displayOrder ?? 0,
      isAvailable: dto.isAvailable ?? true,
    };
    const [row] = await this.db.insert(modifierOptions).values(data).returning();
    return row;
  }

  async update(id: string, dto: UpdateModifierOptionDto): Promise<ModifierOption> {
    const [row] = await this.db
      .update(modifierOptions)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(modifierOptions.id, id))
      .returning();
    return row;
  }

  /**
   * Fetches all options whose parent group belongs to the given menu item.
   * Uses a 2-query approach (groups → options via inArray) to avoid N+1 while
   * keeping the return type cleanly typed as ModifierOption[].
   * Called by ModifiersService.buildGroupsWithOptions.
   */
  async findAllByMenuItem(menuItemId: string): Promise<ModifierOption[]> {
    const groups = await this.db
      .select({ id: modifierGroups.id })
      .from(modifierGroups)
      .where(eq(modifierGroups.menuItemId, menuItemId));
    if (groups.length === 0) return [];
    const groupIds = groups.map((g) => g.id);
    return this.db
      .select()
      .from(modifierOptions)
      .where(inArray(modifierOptions.groupId, groupIds))
      .orderBy(modifierOptions.displayOrder);
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(modifierOptions).where(eq(modifierOptions.id, id));
  }
}
