import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { MenuRepository } from './menu.repository';
import { DatabaseModule } from '@/drizzle/drizzle.module';
import { RestaurantModule } from '@/module/restaurant-catalog/restaurant/restaurant.module';
import { ModifiersModule } from './modifiers/modifiers.module';

@Module({
  imports: [DatabaseModule, RestaurantModule, ModifiersModule],
  controllers: [MenuController],
  providers: [MenuService, MenuRepository],
  exports: [MenuService],
})
export class MenuModule {}
