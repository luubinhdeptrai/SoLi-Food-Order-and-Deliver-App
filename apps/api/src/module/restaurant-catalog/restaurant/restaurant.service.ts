import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { RestaurantRepository } from './restaurant.repository';
import { CreateRestaurantDto, UpdateRestaurantDto } from './dto/restaurant.dto';
import type {
  NewRestaurant,
  Restaurant,
} from '@/module/restaurant-catalog/restaurant/restaurant.schema';
import { RestaurantUpdatedEvent } from '@/shared/events/restaurant-updated.event';

@Injectable()
export class RestaurantService {
  constructor(
    private readonly repo: RestaurantRepository,
    private readonly eventBus: EventBus,
  ) {}

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
    const restaurant = await this.repo.create(ownerId, dto);
    this.eventBus.publish(
      new RestaurantUpdatedEvent(
        restaurant.id!,
        restaurant.name,
        restaurant.isOpen ?? false,
        restaurant.isApproved ?? false,
        restaurant.address,
        undefined,
        restaurant.latitude ?? null,
        restaurant.longitude ?? null,
      ),
    );
    return restaurant;
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
    const updated = await this.repo.update(id, dto);
    this.eventBus.publish(
      new RestaurantUpdatedEvent(
        updated.id!,
        updated.name,
        updated.isOpen ?? false,
        updated.isApproved ?? false,
        updated.address,
        undefined,
        updated.latitude ?? null,
        updated.longitude ?? null,
      ),
    );
    return updated;
  }

  async remove(id: string): Promise<void> {
    const restaurant = await this.findOne(id);
    await this.repo.remove(id);
    // Invalidate the Ordering BC snapshot: after deletion the restaurant must
    // be treated as closed and not approved so Phase 4 checkout rejects any
    // order placed against it. Without this event the snapshot row persists
    // with the old isOpen/isApproved values indefinitely.
    this.eventBus.publish(
      new RestaurantUpdatedEvent(
        restaurant.id,
        restaurant.name,
        false, // isOpen
        false, // isApproved
        restaurant.address,
        null,
        restaurant.latitude ?? null,
        restaurant.longitude ?? null,
      ),
    );
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
