import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MenuService } from './menu.service';
import {
  CreateMenuItemDto,
  MENU_ITEM_CATEGORIES,
  MENU_ITEM_STATUSES,
  QueryMenuItemDto,
  UpdateMenuItemDto,
} from './dto/menu.dto';
import { JwtAuthGuard } from '@/module/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/module/auth/guards/roles.guard';
import { Roles } from '@/module/auth/decorators/roles.decorator';
import {
  CurrentUser,
  type JwtPayload,
} from '@/module/auth/decorators/current-user.decorator';
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

const MENU_ITEM_RESPONSE_SCHEMA = {
  type: 'object',
  required: [
    'id',
    'restaurantId',
    'name',
    'price',
    'category',
    'status',
    'isAvailable',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      example: '22222222-2222-2222-2222-222222222222',
    },
    restaurantId: {
      type: 'string',
      format: 'uuid',
      example: '11111111-1111-1111-1111-111111111111',
    },
    name: {
      type: 'string',
      example: 'Margherita Pizza',
    },
    description: {
      type: 'string',
      nullable: true,
      example: 'Classic tomato, basil, and mozzarella',
    },
    price: {
      type: 'number',
      minimum: 0,
      example: 12.5,
    },
    sku: {
      type: 'string',
      nullable: true,
      example: 'PIZZA-MARG-01',
    },
    category: {
      type: 'string',
      enum: Array.from(MENU_ITEM_CATEGORIES),
      example: 'mains',
    },
    status: {
      type: 'string',
      enum: Array.from(MENU_ITEM_STATUSES),
      example: 'available',
    },
    imageUrl: {
      type: 'string',
      nullable: true,
      example: 'https://cdn.example.com/menu/margherita.jpg',
    },
    isAvailable: {
      type: 'boolean',
      example: true,
    },
    tags: {
      type: 'array',
      nullable: true,
      items: { type: 'string' },
      example: ['vegetarian', 'popular'],
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-04-15T08:00:00.000Z',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      example: '2026-04-15T08:00:00.000Z',
    },
  },
};

@ApiTags('Menu')
@ApiBearerAuth()
@Controller('menu-items')
// @UseGuards(JwtAuthGuard, RolesGuard) // disabled for dev/test — use x-test-user-id header
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
    schema: {
      type: 'array',
      items: MENU_ITEM_RESPONSE_SCHEMA,
    },
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
    schema: MENU_ITEM_RESPONSE_SCHEMA,
  })
  @ApiNotFoundResponse({ description: 'Menu item not found' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('admin', 'restaurant')
  @ApiOperation({ summary: 'Create a menu item' })
  @ApiBody({ type: CreateMenuItemDto })
  @ApiCreatedResponse({
    description: 'Menu item created successfully',
    schema: MENU_ITEM_RESPONSE_SCHEMA,
  })
  @ApiForbiddenResponse({
    description: 'User is not owner of the restaurant',
  })
  @ApiNotFoundResponse({ description: 'Restaurant not found' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateMenuItemDto) {
    return this.service.create(
      user.sub,
      user.roles?.includes('admin') ?? false,
      dto,
    );
  }

  @Patch(':id')
  @Roles('admin', 'restaurant')
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
    schema: MENU_ITEM_RESPONSE_SCHEMA,
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
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateMenuItemDto,
  ) {
    return this.service.update(
      id,
      user.sub,
      user.roles?.includes('admin') ?? false,
      dto,
    );
  }

  @Patch(':id/sold-out')
  @Roles('admin', 'restaurant')
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
    schema: MENU_ITEM_RESPONSE_SCHEMA,
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
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.toggleSoldOut(
      id,
      user.sub,
      user.roles?.includes('admin') ?? false,
    );
  }

  @Delete(':id')
  @Roles('admin', 'restaurant')
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
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.remove(
      id,
      user.sub,
      user.roles?.includes('admin') ?? false,
    );
  }
}
