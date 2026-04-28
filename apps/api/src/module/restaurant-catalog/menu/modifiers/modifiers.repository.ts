import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  menuItemModifiers,
  type MenuItemModifier,
} from '@/module/restaurant-catalog/menu/menu.schema';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';
import type { CreateMenuItemModifierDto, UpdateMenuItemModifierDto } from './modifiers.dto';

@Injectable()
export class ModifiersRepository {
  constructor(
    @Inject(DB_CONNECTION) readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findByMenuItem(menuItemId: string): Promise<MenuItemModifier[]> {
    return this.db
      .select()
      .from(menuItemModifiers)
      .where(eq(menuItemModifiers.menuItemId, menuItemId))
      .orderBy(menuItemModifiers.createdAt);
  }

  async findById(id: string): Promise<MenuItemModifier | null> {
    const result = await this.db
      .select()
      .from(menuItemModifiers)
      .where(eq(menuItemModifiers.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  async create(
    menuItemId: string,
    dto: CreateMenuItemModifierDto,
  ): Promise<MenuItemModifier> {
    const [row] = await this.db
      .insert(menuItemModifiers)
      .values({
        menuItemId,
        name: dto.name,
        description: dto.description,
        price: dto.price,
        isRequired: dto.isRequired ?? false,
      })
      .returning();
    return row;
  }

  async update(
    id: string,
    dto: UpdateMenuItemModifierDto,
  ): Promise<MenuItemModifier> {
    const [row] = await this.db
      .update(menuItemModifiers)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(menuItemModifiers.id, id))
      .returning();
    return row;
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(menuItemModifiers).where(eq(menuItemModifiers.id, id));
  }
}
