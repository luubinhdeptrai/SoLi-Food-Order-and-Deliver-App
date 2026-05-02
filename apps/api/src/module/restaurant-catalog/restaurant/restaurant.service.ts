import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { RestaurantRepository, type PaginatedResult } from './restaurant.repository';
import { CreateRestaurantDto, UpdateRestaurantDto } from './dto/restaurant.dto';
import type { Restaurant } from '@/module/restaurant-catalog/restaurant/restaurant.schema';
import { RestaurantUpdatedEvent } from '@/shared/events/restaurant-updated.event';

// ---------------------------------------------------------------------------
// Pagination constants — enforced in all list/search endpoints (Issue #5)
// ---------------------------------------------------------------------------
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class RestaurantService {
  constructor(
    private readonly repo: RestaurantRepository,
    private readonly eventBus: EventBus,
  ) {}

  async findAll(
    offset?: number,
    limit?: number,
  ): Promise<PaginatedResult<Restaurant>> {
    // Enforce a default and ceiling on page size to prevent full-table dumps (Issue #5).
    const safeLimit = Math.min(limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    // Public listing must only show approved restaurants (Issue #4).
    return this.repo.findAll({ offset, limit: safeLimit, approvedOnly: true });
  }

  async findOne(id: string): Promise<Restaurant> {
    const restaurant = await this.repo.findById(id);
    if (!restaurant) {
      throw new NotFoundException(`Restaurant ${id} not found`);
    }
    return restaurant;
  }

  async create(ownerId: string, dto: CreateRestaurantDto): Promise<Restaurant> {
    const restaurant = await this.repo.create(ownerId, dto);
    this.publishRestaurantEvent(restaurant);
    return restaurant;
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
    const updated = await this.repo.update(id, dto);
    this.publishRestaurantEvent(updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const restaurant = await this.findOne(id);
    await this.repo.remove(id);
    // Invalidate the Ordering BC snapshot by publishing with isOpen/isApproved=false.
    // Without this event the snapshot row persists with the old values indefinitely.
    this.eventBus.publish(
      new RestaurantUpdatedEvent(
        restaurant.id,
        restaurant.name,
        false, // isOpen — treat as closed after deletion
        false, // isApproved — treat as not approved after deletion
        restaurant.address,
        restaurant.latitude ?? null,
        restaurant.longitude ?? null,
        restaurant.cuisineType ?? null,
      ),
    );
  }

  async setApproved(id: string, isApproved: boolean): Promise<Restaurant> {
    // `findOne` is called implicitly by `update` after the DB write.
    // We use the returned record (not a pre-fetch) so the event always
    // reflects the persisted state and avoids a race condition (Issue #2).
    const updated = await this.repo.update(id, { isApproved });
    if (!updated) {
      throw new NotFoundException(`Restaurant ${id} not found`);
    }
    // Emit so the Ordering BC snapshot stays in sync with isApproved changes (Issue #2).
    this.publishRestaurantEvent(updated);
    return updated;
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Publishes a RestaurantUpdatedEvent using the current DB state of the restaurant.
   * Centralising this here ensures the event is always emitted after any mutation
   * that changes the restaurant's observable state (create, update, approve, etc.).
   */
  private publishRestaurantEvent(restaurant: Restaurant): void {
    this.eventBus.publish(
      new RestaurantUpdatedEvent(
        restaurant.id!,
        restaurant.name,
        restaurant.isOpen ?? false,
        restaurant.isApproved ?? false,
        restaurant.address,
        restaurant.latitude ?? null,
        restaurant.longitude ?? null,
        restaurant.cuisineType ?? null,
      ),
    );
  }
}

