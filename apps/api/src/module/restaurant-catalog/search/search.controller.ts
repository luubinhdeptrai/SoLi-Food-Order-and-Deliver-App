import { Controller, Get, Query, ParseFloatPipe, ParseIntPipe } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { SearchService } from './search.service';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RestaurantSearchResponseDto } from '@/module/restaurant-catalog/restaurant/dto/restaurant.dto';

@ApiTags('Search')
@ApiBearerAuth()
@Controller('restaurants/search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  @AllowAnonymous()
  @ApiOperation({
    summary: 'Search restaurants',
    description:
      'Search for approved, open restaurants by name, category, and/or location.',
  })
  @ApiQuery({
    name: 'name',
    required: false,
    description: 'Restaurant name (substring search)',
    example: 'Pizza',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    description: 'Menu category name (substring search, e.g. "sushi")',
    example: 'sushi',
  })
  @ApiQuery({
    name: 'lat',
    required: false,
    type: Number,
    description: 'Latitude for location-based search (requires lon)',
    example: 10.762622,
  })
  @ApiQuery({
    name: 'lon',
    required: false,
    type: Number,
    description: 'Longitude for location-based search (requires lat)',
    example: 106.660172,
  })
  @ApiQuery({
    name: 'radiusKm',
    required: false,
    type: Number,
    description: 'Search radius in kilometres (default: 5)',
    example: 5,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Pagination offset',
    example: 0,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: `Pagination limit (max 100, default 20)`,
    example: 20,
  })
  @ApiOkResponse({
    description: 'Search results returned successfully',
    type: RestaurantSearchResponseDto,
  })
  search(
    @Query('name') name?: string,
    @Query('category') category?: string,
    // ParseFloatPipe preserves decimal precision for coordinates (Issue #1).
    @Query('lat', new ParseFloatPipe({ optional: true })) lat?: number,
    @Query('lon', new ParseFloatPipe({ optional: true })) lon?: number,
    @Query('radiusKm', new ParseFloatPipe({ optional: true })) radiusKm?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.service.searchRestaurants(name, category, lat, lon, radiusKm, offset, limit);
  }
}

