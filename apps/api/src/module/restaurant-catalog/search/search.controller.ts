import { Controller, Get, Query, ParseIntPipe } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { SearchService } from './search.service';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RestaurantResponseDto } from '@/module/restaurant-catalog/restaurant/dto/restaurant.dto';

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
      'Search for approved restaurants by name, location, and optionally cuisine/category.',
  })
  @ApiQuery({
    name: 'name',
    required: false,
    description: 'Restaurant name (substring search)',
    example: 'Pizza',
  })
  @ApiQuery({
    name: 'lat',
    required: false,
    type: Number,
    description: 'Latitude for location-based search',
    example: 10.762622,
  })
  @ApiQuery({
    name: 'lon',
    required: false,
    type: Number,
    description: 'Longitude for location-based search',
    example: 106.660172,
  })
  @ApiQuery({
    name: 'radiusKm',
    required: false,
    type: Number,
    description: 'Search radius in kilometers (default: 5)',
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
    description: 'Pagination limit',
    example: 20,
  })
  @ApiOkResponse({
    description: 'Search results returned successfully',
    type: [RestaurantResponseDto],
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
  search(
    @Query('name') name?: string,
    @Query('lat', new ParseIntPipe({ optional: true })) lat?: number,
    @Query('lon', new ParseIntPipe({ optional: true })) lon?: number,
    @Query('radiusKm', new ParseIntPipe({ optional: true })) radiusKm?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.service.searchRestaurants(
      name,
      undefined,
      lat,
      lon,
      radiusKm,
      offset,
      limit,
    );
  }
}
