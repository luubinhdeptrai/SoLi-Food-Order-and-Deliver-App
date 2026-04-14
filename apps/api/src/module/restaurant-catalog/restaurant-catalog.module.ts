import { Module } from '@nestjs/common';
import { MenuModule } from './menu/menu.module';
import { RestaurantModule } from './restaurant/restaurant.module';

@Module({
  imports: [MenuModule, RestaurantModule],
})
export class RestaurantCatalogModule {}
