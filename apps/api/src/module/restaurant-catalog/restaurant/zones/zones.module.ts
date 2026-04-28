import { Module } from '@nestjs/common';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';
import { ZonesRepository } from './zones.repository';
import { DatabaseModule } from '@/drizzle/drizzle.module';
import { RestaurantModule } from '../restaurant.module';

@Module({
  imports: [DatabaseModule, RestaurantModule],
  controllers: [ZonesController],
  providers: [ZonesService, ZonesRepository],
})
export class ZonesModule {}
