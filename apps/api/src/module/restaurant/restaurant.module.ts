import { Module } from '@nestjs/common';
import { RestaurantController } from './restaurant.controller';
import { RestaurantService } from './restaurant.service';
import { RestaurantRepository } from './restaurant.repository';
import { DatabaseModule } from '@/drizzle/drizzle.module';

@Module({
  imports:     [DatabaseModule],
  controllers: [RestaurantController],
  providers: [RestaurantService, RestaurantRepository],
  exports: [RestaurantService],
})
export class RestaurantModule {}
