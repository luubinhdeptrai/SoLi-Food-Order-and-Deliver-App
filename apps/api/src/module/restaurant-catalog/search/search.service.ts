import { BadRequestException, Injectable } from '@nestjs/common';
import { SearchRepository, type SearchResult } from './search.repository';

// ---------------------------------------------------------------------------
// Pagination constants
// ---------------------------------------------------------------------------
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

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
  ): Promise<SearchResult> {
    // lat and lon must always be provided together (Issue #18).
    // Accepting only one silently degrades to a non-geo search without warning.
    const hasLat = lat !== undefined;
    const hasLon = lon !== undefined;
    if (hasLat !== hasLon) {
      throw new BadRequestException(
        'lat and lon must both be provided together for geo search',
      );
    }

    // Enforce page size defaults and ceiling (Issue #5).
    const safeLimit = Math.min(limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    return this.repo.search({
      name,
      category,
      lat,
      lon,
      radiusKm,
      offset,
      limit: safeLimit,
    });
  }
}

