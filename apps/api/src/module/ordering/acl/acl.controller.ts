import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { AclService } from './acl.service';
import {
  MenuItemSnapshotResponseDto,
  RestaurantSnapshotResponseDto,
} from './dto/acl.dto';

/**
 * AclController
 *
 * Read-only diagnostic endpoints for the Ordering BC's local snapshot tables.
 * Intended for integration tests (Phase 3 test guide) and internal tooling.
 *
 * No auth/guards — these are internal, non-customer-facing endpoints.
 * No business logic — all reads delegate to AclService → snapshot repositories.
 *
 * Routes:
 *   GET /ordering/menu-items/:id           → single menu item snapshot
 *   GET /ordering/menu-items?ids=id1,id2   → bulk menu item snapshots
 *   GET /ordering/restaurants/:id          → single restaurant snapshot
 *   GET /ordering/restaurants?ids=id1,id2  → bulk restaurant snapshots
 *
 * Phase: 3 — ACL Layer
 */
@ApiTags('Ordering — ACL Snapshots')
@Controller('ordering')
export class AclController {
  constructor(private readonly aclService: AclService) {}

  // ---------------------------------------------------------------------------
  // Menu item snapshots
  // ---------------------------------------------------------------------------

  // Static route must be declared BEFORE the /:id dynamic route
  @Get('menu-items')
  @ApiOperation({
    summary: 'Bulk-fetch menu item snapshots',
    description:
      'Returns the local ACL snapshot for each supplied menu item ID. ' +
      'IDs not present in the snapshot table are silently omitted from the result.',
  })
  @ApiQuery({
    name: 'ids',
    required: true,
    type: String,
    description: 'Comma-separated list of menu item UUIDs',
    example: '4dc7cdfa-5a54-402f-b1a8-2d47de146081,a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5',
  })
  @ApiOkResponse({
    description: 'Snapshots for found IDs (missing IDs are omitted)',
    type: [MenuItemSnapshotResponseDto],
  })
  getMenuItemsByIds(
    @Query('ids') ids: string,
  ): Promise<MenuItemSnapshotResponseDto[]> {
    return this.aclService.getMenuItemsByIds(this.aclService.parseIds(ids ?? ''));
  }

  @Get('menu-items/:id')
  @ApiOperation({
    summary: 'Get a single menu item snapshot',
    description:
      'Returns the Ordering BC\'s local projection of the given menu item. ' +
      'A deleted item returns its tombstone row (status=unavailable).',
  })
  @ApiParam({
    name: 'id',
    description: 'Menu item UUID',
    format: 'uuid',
    example: '4dc7cdfa-5a54-402f-b1a8-2d47de146081',
  })
  @ApiOkResponse({
    description: 'Menu item snapshot found',
    type: MenuItemSnapshotResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No snapshot exists for the given ID',
  })
  @ApiBadRequestResponse({ description: 'id is not a valid UUID' })
  getMenuItemById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MenuItemSnapshotResponseDto> {
    return this.aclService.getMenuItemById(id);
  }

  // ---------------------------------------------------------------------------
  // Restaurant snapshots
  // ---------------------------------------------------------------------------

  // Static route must be declared BEFORE the /:id dynamic route
  @Get('restaurants')
  @ApiOperation({
    summary: 'Bulk-fetch restaurant snapshots',
    description:
      'Returns the local ACL snapshot for each supplied restaurant ID. ' +
      'IDs not present in the snapshot table are silently omitted from the result.',
  })
  @ApiQuery({
    name: 'ids',
    required: true,
    type: String,
    description: 'Comma-separated list of restaurant UUIDs',
    example:
      'fe8b2648-2260-4bc5-9acd-d88972148c78,cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  })
  @ApiOkResponse({
    description: 'Snapshots for found IDs (missing IDs are omitted)',
    type: [RestaurantSnapshotResponseDto],
  })
  getRestaurantsByIds(
    @Query('ids') ids: string,
  ): Promise<RestaurantSnapshotResponseDto[]> {
    return this.aclService.getRestaurantsByIds(this.aclService.parseIds(ids ?? ''));
  }

  @Get('restaurants/:id')
  @ApiOperation({
    summary: 'Get a single restaurant snapshot',
    description:
      'Returns the Ordering BC\'s local projection of the given restaurant. ' +
      'A deleted restaurant returns its tombstone row (isOpen=false, isApproved=false).',
  })
  @ApiParam({
    name: 'id',
    description: 'Restaurant UUID',
    format: 'uuid',
    example: 'fe8b2648-2260-4bc5-9acd-d88972148c78',
  })
  @ApiOkResponse({
    description: 'Restaurant snapshot found',
    type: RestaurantSnapshotResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No snapshot exists for the given ID',
  })
  @ApiBadRequestResponse({ description: 'id is not a valid UUID' })
  getRestaurantById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RestaurantSnapshotResponseDto> {
    return this.aclService.getRestaurantById(id);
  }
}
