import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RestaurantRepository } from './restaurant.repository';
import { CreateRestaurantDto, UpdateRestaurantDto } from './dto/restaurant.dto';
import type { Restaurant } from '@/module/restaurant-catalog/restaurant/restaurant.schema';

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

  async create(ownerId: string, dto: CreateRestaurantDto): Promise<Restaurant> {
    return this.repo.create(ownerId, dto);
  }

  async update(
    id: string,
    requesterId: string,
    isAdmin: boolean,
    dto: UpdateRestaurantDto,
  ): Promise<Restaurant> {
    const restaurant = await this.findOne(id);
    if (!isAdmin && restaurant.ownerId !== requesterId) {
      throw new ForbiddenException('You do not own this restaurant');
    }
    return this.repo.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    return this.repo.remove(id);
  }

  async assertOpenAndApproved(id: string): Promise<Restaurant> {
    const restaurant = await this.findOne(id);
    if (!restaurant.isApproved) {
      throw new ConflictException('Restaurant is not approved');
    }
    if (!restaurant.isOpen) {
      throw new ConflictException('Restaurant is currently closed');
    }
    return restaurant;
  }
}
