import { Module } from '@nestjs/common';
import { ModifiersController } from './modifiers.controller';
import { ModifiersService } from './modifiers.service';
import {
  ModifierGroupRepository,
  ModifierOptionRepository,
} from './modifiers.repository';
import { DatabaseModule } from '@/drizzle/drizzle.module';
import { MenuModule } from '../menu.module';
import { RestaurantModule } from '@/module/restaurant-catalog/restaurant/restaurant.module';

/**
 * ModifiersModule — owns modifier_groups + modifier_options tables.
 *
 * Imports MenuModule (for MenuRepository + MenuService) without creating a circular
 * dependency because MenuModule no longer imports ModifiersModule.
 * ModifiersModule is imported at RestaurantCatalogModule level.
 */
@Module({
  imports: [DatabaseModule, MenuModule, RestaurantModule],
  controllers: [ModifiersController],
  providers: [
    ModifiersService,
    ModifierGroupRepository,
    ModifierOptionRepository,
  ],
})
export class ModifiersModule {}
