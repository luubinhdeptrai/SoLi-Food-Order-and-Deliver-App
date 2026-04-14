import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { RestaurantRepository } from './restaurant.repository';
import { CreateRestaurantDto, UpdateRestaurantDto } from './dto/restaurant.dto';
import type {
  NewRestaurant,
  Restaurant,
} from '@/module/restaurant-catalog/restaurant/restaurant.schema';

@Injectable()
export class RestaurantService {
  constructor(private readonly repo: RestaurantRepository) {}

  async findAll(): Promise<Restaurant[]> {
    return this.repo.findAll();
  }

  async findOne(id: string): Promise<Restaurant> {
    const restaurant = await this.repo.findById(id);
    if (!restaurant) {
      throw new NotFoundException(`Restaurant ${id} not found`);
    }
    return restaurant;
  }

  async create(
    ownerId: string,
    dto: CreateRestaurantDto,
  ): Promise<NewRestaurant> {
    return await this.repo.create(ownerId, dto);
  }

  async update(
    id: string,
    requesterId: string,
    isAdmin: boolean,
    dto: UpdateRestaurantDto,
  ): Promise<NewRestaurant> {
    const restaurant = await this.findOne(id);
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    return await this.repo.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    return await this.repo.remove(id);
  }

  async assertOpenAndApproved(id: string): Promise<Restaurant> {
    const restaurant = await this.findOne(id);
    if (!restaurant.isApproved) {
      throw new ForbiddenException('Restaurant is not approved');
    }
    if (!restaurant.isOpen) {
      throw new ForbiddenException('Restaurant is currently closed');
    }
    return restaurant;
  }
}
