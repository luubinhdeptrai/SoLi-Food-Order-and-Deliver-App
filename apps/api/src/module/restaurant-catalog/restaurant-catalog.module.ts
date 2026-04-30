import { Module } from '@nestjs/common';
import { MenuModule } from './menu/menu.module';
import { RestaurantModule } from './restaurant/restaurant.module';
import { ZonesModule } from './restaurant/zones/zones.module';
import { SearchModule } from './search/search.module';
import { ModifiersModule } from './menu/modifiers/modifiers.module';

@Module({
  imports: [MenuModule, RestaurantModule, ZonesModule, SearchModule, ModifiersModule],
})
export class RestaurantCatalogModule {}
