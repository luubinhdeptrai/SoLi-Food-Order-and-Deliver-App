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
import { Roles, Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { MenuService } from './menu.service';
import {
  CreateMenuItemDto,
  MENU_ITEM_CATEGORIES,
  MenuItemResponseDto,
  QueryMenuItemDto,
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

  // Static route — must be declared before /:id
  @Get('categories')
  @ApiOperation({ summary: 'List available menu categories' })
  @ApiOkResponse({
    description: 'Array of supported menu categories',
    schema: {
      type: 'array',
      items: {
        type: 'string',
        enum: [...MENU_ITEM_CATEGORIES],
      },
      example: [...MENU_ITEM_CATEGORIES],
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
  getCategories() {
    return this.service.getCategories();
  }

  @Get()
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
    name: 'category',
    required: false,
    enum: MENU_ITEM_CATEGORIES,
    enumName: 'MenuItemCategory',
    description: 'Optional category filter',
  })
  @ApiOkResponse({
    description: 'Menu items returned successfully',
    type: [MenuItemResponseDto],
  })
  @ApiNotFoundResponse({ description: 'Restaurant not found' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
  findByRestaurant(@Query() query: QueryMenuItemDto) {
    return this.service.findByRestaurant(query.restaurantId, query.category);
  }

  @Get(':id')
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
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
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
