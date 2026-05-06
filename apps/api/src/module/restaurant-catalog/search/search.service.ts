import { BadRequestException, Injectable } from '@nestjs/common';
import {
  SearchRepository,
  type SearchFilters,
  type UnifiedSearchResult,
} from './search.repository';

@Injectable()
export class SearchService {
  constructor(private readonly repo: SearchRepository) {}

  /**
   * Entry point for the unified search endpoint. Validates that lat and lon
   * are always provided together (providing only one would silently degrade
   * to a non-geo search without any warning to the caller).
   *
   * Pagination sanitisation (clamping, defaults) is intentionally delegated
   * to SearchRepository — the repository owns those constants as the single
   * source of truth.
   */
  async search(
    q?: string,
    category?: string,
    cuisineType?: string,
    tag?: string,
    lat?: number,
    lon?: number,
    radiusKm?: number,
    offset?: number,
    limit?: number,
  ): Promise<UnifiedSearchResult> {
    if ((lat === undefined) !== (lon === undefined)) {
      throw new BadRequestException(
        'lat and lon must both be provided together for geo search',
      );
    }

    const filters: SearchFilters = {
      q,
      category,
      cuisineType,
      tag,
      lat,
      lon,
      radiusKm,
      offset,
      limit,
    };

    return this.repo.search(filters);
  }
}
