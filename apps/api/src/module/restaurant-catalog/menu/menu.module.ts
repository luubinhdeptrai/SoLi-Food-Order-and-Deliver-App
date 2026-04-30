import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { MenuRepository } from './menu.repository';
import { DatabaseModule } from '@/drizzle/drizzle.module';
import { RestaurantModule } from '@/module/restaurant-catalog/restaurant/restaurant.module';

/**
 * MenuModule — owns menu_items, menu_categories.
 * ModifiersModule is imported at RestaurantCatalogModule level to avoid
 * the circular dependency (ModifiersModule imports MenuModule for MenuRepository).
 */
@Module({
  imports: [DatabaseModule, RestaurantModule, CqrsModule],
  controllers: [MenuController],
  providers: [MenuService, MenuRepository],
  exports: [MenuService, MenuRepository],
})
export class MenuModule {}
