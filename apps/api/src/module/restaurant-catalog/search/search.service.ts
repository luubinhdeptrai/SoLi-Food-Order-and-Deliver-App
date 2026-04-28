import { Injectable } from '@nestjs/common';
import { SearchRepository } from './search.repository';
import type { Restaurant } from '@/module/restaurant-catalog/restaurant/restaurant.schema';

@Injectable()
export class SearchService {
  constructor(private readonly repo: SearchRepository) {}

  async searchRestaurants(
    name?: string,
    category?: string,
    lat?: number,
    lon?: number,
    radiusKm?: number,
    offset?: number,
    limit?: number,
  ): Promise<Restaurant[]> {
    return this.repo.search({
      name,
      category,
      lat,
      lon,
      radiusKm,
      offset,
      limit,
    });
  }
}
