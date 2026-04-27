import { Module } from '@nestjs/common';
import { MenuModule } from './menu/menu.module';
import { RestaurantModule } from './restaurant/restaurant.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [MenuModule, RestaurantModule, SearchModule],
})
export class RestaurantCatalogModule {}
