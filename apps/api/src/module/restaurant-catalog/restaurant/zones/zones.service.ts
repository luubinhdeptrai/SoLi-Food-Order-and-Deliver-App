import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ZonesRepository } from './zones.repository';
import { RestaurantService } from '../restaurant.service';
import type { CreateDeliveryZoneDto, UpdateDeliveryZoneDto } from './zones.dto';
import type { DeliveryZone } from '@/module/restaurant-catalog/restaurant/restaurant.schema';

@Injectable()
export class ZonesService {
  constructor(
    private readonly repo: ZonesRepository,
    private readonly restaurantService: RestaurantService,
  ) {}

  async findByRestaurant(restaurantId: string): Promise<DeliveryZone[]> {
    await this.restaurantService.findOne(restaurantId);
    return this.repo.findByRestaurant(restaurantId);
  }

  async findOne(id: string, restaurantId: string): Promise<DeliveryZone> {
    const zone = await this.repo.findById(id);
    if (!zone || zone.restaurantId !== restaurantId) {
      throw new NotFoundException('Delivery zone not found');
    }
    return zone;
  }

  async create(
    restaurantId: string,
    requesterId: string,
    isAdmin: boolean,
    dto: CreateDeliveryZoneDto,
  ): Promise<DeliveryZone> {
    const restaurant = await this.restaurantService.findOne(restaurantId);
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    return this.repo.create(restaurantId, dto);
  }

  async update(
    id: string,
    restaurantId: string,
    requesterId: string,
    isAdmin: boolean,
    dto: UpdateDeliveryZoneDto,
  ): Promise<DeliveryZone> {
    const zone = await this.findOne(id, restaurantId);
    const restaurant = await this.restaurantService.findOne(restaurantId);
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    return this.repo.update(id, dto);
  }

  async remove(
    id: string,
    restaurantId: string,
    requesterId: string,
    isAdmin: boolean,
  ): Promise<void> {
    const zone = await this.findOne(id, restaurantId);
    const restaurant = await this.restaurantService.findOne(restaurantId);
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    return this.repo.remove(id);
  }
}
