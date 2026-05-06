import {
  Controller,
  Get,
  Query,
  ParseFloatPipe,
  ParseIntPipe,
} from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { SearchService } from './search.service';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { UnifiedSearchResponseDto } from './search.dto';

@ApiTags('Search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  @AllowAnonymous()
  @ApiOperation({
    summary: 'Unified food & restaurant search',
    description:
      'Returns matching restaurants AND menu items in a single response (SERP). ' +
      'Accent-insensitive: "pho" matches "Phở", "banh mi" matches "Bánh Mì", ' +
      '"com" matches "Cơm". ' +
      'Requires unaccent + pg_trgm PostgreSQL extensions (migration 0007).',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description:
      'General search term (accent-insensitive). ' +
      'Matched against restaurant names, cuisine, description AND menu item names, tags, and categories.',
    example: 'banh mi',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    description:
      'Menu category name filter (accent-insensitive, e.g. "Sandwiches")',
    example: 'Sandwiches',
  })
  @ApiQuery({
    name: 'cuisineType',
    required: false,
    description: 'Cuisine type filter on restaurants (accent-insensitive)',
    example: 'Vietnamese',
  })
  @ApiQuery({
    name: 'tag',
    required: false,
    description: 'Menu item tag filter — exact match against items.tags array',
    example: 'vegetarian',
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
    description:
      'Pagination offset — applies independently to both restaurants and items sections',
    example: 0,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Pagination limit per section (max 100, default 20)',
    example: 20,
  })
  @ApiOkResponse({
    description: 'Unified search results — restaurants section + items section',
    type: UnifiedSearchResponseDto,
  })
  search(
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('cuisineType') cuisineType?: string,
    @Query('tag') tag?: string,
    @Query('lat', new ParseFloatPipe({ optional: true })) lat?: number,
    @Query('lon', new ParseFloatPipe({ optional: true })) lon?: number,
    @Query('radiusKm', new ParseFloatPipe({ optional: true }))
    radiusKm?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.service.search(
      q,
      category,
      cuisineType,
      tag,
      lat,
      lon,
      radiusKm,
      offset,
      limit,
    );
  }
}
