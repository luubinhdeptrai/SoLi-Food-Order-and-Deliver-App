import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  AllowAnonymous,
  Roles,
  Session,
  type UserSession,
} from '@thallesp/nestjs-better-auth';
import { MenuService } from './menu.service';
import {
  CreateMenuItemDto,
  CreateMenuCategoryDto,
  MenuCategoryResponseDto,
  MenuItemListResponseDto,
  MenuItemResponseDto,
  QueryMenuItemDto,
  UpdateMenuCategoryDto,
  UpdateMenuItemDto,
} from './dto/menu.dto';
import { hasRole } from '@/module/auth/role.util';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

@ApiTags('Menu')
@ApiBearerAuth()
@Controller('menu-items')
export class MenuController {
  constructor(private readonly service: MenuService) {}

  // -------------------------------------------------------------------------
  // Category endpoints (per-restaurant; replaces global enum)
  // -------------------------------------------------------------------------

  @Get('categories')
  @AllowAnonymous()
  @ApiOperation({
    summary: 'List categories for a restaurant',
    description:
      'Returns per-restaurant menu categories ordered by displayOrder.',
  })
  @ApiQuery({
    name: 'restaurantId',
    type: String,
    required: true,
    format: 'uuid',
  })
  @ApiOkResponse({ type: [MenuCategoryResponseDto] })
  getCategories(@Query('restaurantId', ParseUUIDPipe) restaurantId: string) {
    return this.service.findCategoriesByRestaurant(restaurantId);
  }

  @Post('categories')
  @Roles(['admin', 'restaurant'])
  @ApiOperation({ summary: 'Create a menu category for a restaurant' })
  @ApiBody({ type: CreateMenuCategoryDto })
  @ApiCreatedResponse({ type: MenuCategoryResponseDto })
  @ApiForbiddenResponse({ description: 'You do not own this restaurant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  createCategory(
    @Session() session: UserSession,
    @Body() dto: CreateMenuCategoryDto,
  ) {
    return this.service.createCategory(
      session.user.id,
      hasRole(session.user.role, 'admin'),
      dto,
    );
  }

  @Patch('categories/:id')
  @Roles(['admin', 'restaurant'])
  @ApiOperation({ summary: 'Update a menu category' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateMenuCategoryDto })
  @ApiOkResponse({ type: MenuCategoryResponseDto })
  @ApiForbiddenResponse({ description: 'You do not own this restaurant' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
    @Body() dto: UpdateMenuCategoryDto,
  ) {
    return this.service.updateCategory(
      id,
      session.user.id,
      hasRole(session.user.role, 'admin'),
      dto,
    );
  }

  @Delete('categories/:id')
  @Roles(['admin', 'restaurant'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a menu category' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Category deleted' })
  @ApiForbiddenResponse({ description: 'You do not own this restaurant' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  removeCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ) {
    return this.service.removeCategory(
      id,
      session.user.id,
      hasRole(session.user.role, 'admin'),
    );
  }

  // -------------------------------------------------------------------------
  // Menu item endpoints
  // -------------------------------------------------------------------------

  @Get()
  @AllowAnonymous()
  @ApiOperation({ summary: 'List menu items by restaurant' })
  @ApiQuery({
    name: 'restaurantId',
    type: String,
    required: true,
    format: 'uuid',
    description: 'Restaurant identifier',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @ApiQuery({
    name: 'categoryId',
    type: String,
    required: false,
    format: 'uuid',
    description: 'Optional category filter (UUID)',
  })
  @ApiOkResponse({
    description: 'Menu items returned successfully',
    type: MenuItemListResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Restaurant not found' })
  findByRestaurant(@Query() query: QueryMenuItemDto) {
    return this.service.findByRestaurant(query.restaurantId, {
      categoryId: query.categoryId,
      status: query.status,
      offset: query.offset,
      limit: query.limit,
    });
  }

  @Get(':id')
  @AllowAnonymous()
  @ApiOperation({ summary: 'Get menu item by id' })
  @ApiParam({
    name: 'id',
    required: true,
    format: 'uuid',
    description: 'Menu item identifier',
    example: '22222222-2222-2222-2222-222222222222',
  })
  @ApiOkResponse({
    description: 'Menu item returned successfully',
    type: MenuItemResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Menu item not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles(['admin', 'restaurant'])
  @ApiOperation({ summary: 'Create a menu item' })
  @ApiBody({ type: CreateMenuItemDto })
  @ApiCreatedResponse({
    description: 'Menu item created successfully',
    type: MenuItemResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'User is not owner of the restaurant',
  })
  @ApiNotFoundResponse({ description: 'Restaurant not found' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
  create(@Session() session: UserSession, @Body() dto: CreateMenuItemDto) {
    return this.service.create(
      session.user.id,
      hasRole(session.user.role, 'admin'),
      dto,
    );
  }

  @Patch(':id')
  @Roles(['admin', 'restaurant'])
  @ApiOperation({ summary: 'Update a menu item' })
  @ApiParam({
    name: 'id',
    required: true,
    format: 'uuid',
    description: 'Menu item identifier',
    example: '22222222-2222-2222-2222-222222222222',
  })
  @ApiBody({ type: UpdateMenuItemDto })
  @ApiOkResponse({
    description: 'Menu item updated successfully',
    type: MenuItemResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'User is not owner of the restaurant',
  })
  @ApiNotFoundResponse({ description: 'Menu item not found' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
    @Body() dto: UpdateMenuItemDto,
  ) {
    return this.service.update(
      id,
      session.user.id,
      hasRole(session.user.role, 'admin'),
      dto,
    );
  }

  @Patch(':id/sold-out')
  @Roles(['admin', 'restaurant'])
  @ApiOperation({ summary: 'Toggle sold out state for a menu item' })
  @ApiParam({
    name: 'id',
    required: true,
    format: 'uuid',
    description: 'Menu item identifier',
    example: '22222222-2222-2222-2222-222222222222',
  })
  @ApiOkResponse({
    description: 'Menu item sold out state toggled',
    type: MenuItemResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'User is not owner of the restaurant',
  })
  @ApiNotFoundResponse({ description: 'Menu item not found' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
  toggleSoldOut(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ) {
    return this.service.toggleSoldOut(
      id,
      session.user.id,
      hasRole(session.user.role, 'admin'),
    );
  }

  @Delete(':id')
  @Roles(['admin', 'restaurant'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a menu item' })
  @ApiParam({
    name: 'id',
    required: true,
    format: 'uuid',
    description: 'Menu item identifier',
    example: '22222222-2222-2222-2222-222222222222',
  })
  @ApiNoContentResponse({ description: 'Menu item deleted successfully' })
  @ApiForbiddenResponse({
    description: 'User is not owner of the restaurant',
  })
  @ApiNotFoundResponse({ description: 'Menu item not found' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ) {
    return this.service.remove(
      id,
      session.user.id,
      hasRole(session.user.role, 'admin'),
    );
  }
}
