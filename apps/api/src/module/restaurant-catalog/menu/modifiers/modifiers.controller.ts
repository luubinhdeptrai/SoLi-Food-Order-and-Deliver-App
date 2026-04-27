import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Roles, Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { ModifiersService } from './modifiers.service';
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
import {
  CreateMenuItemModifierDto,
  UpdateMenuItemModifierDto,
  MenuItemModifierResponseDto,
} from './modifiers.dto';

@ApiTags('Menu Item Modifiers')
@ApiBearerAuth()
@Controller('menu-items/:menuItemId/modifiers')
export class ModifiersController {
  constructor(private readonly service: ModifiersService) {}

  @Get()
  @ApiOperation({
    summary: 'List modifiers for a menu item',
    description: 'Returns all modifiers (size, toppings, etc.) for a menu item.',
  })
  @ApiParam({
    name: 'menuItemId',
    format: 'uuid',
    example: '22222222-2222-2222-2222-222222222222',
  })
  @ApiOkResponse({
    description: 'Modifiers retrieved successfully',
    type: [MenuItemModifierResponseDto],
  })
  @ApiNotFoundResponse({ description: 'Menu item not found' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
  findByMenuItem(@Param('menuItemId', ParseUUIDPipe) menuItemId: string) {
    return this.service.findByMenuItem(menuItemId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get modifier details' })
  @ApiParam({
    name: 'menuItemId',
    format: 'uuid',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Modifier found',
    type: MenuItemModifierResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Modifier not found' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
  findOne(
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(id, menuItemId);
  }

  @Post()
  @Roles(['admin', 'restaurant'])
  @ApiOperation({ summary: 'Create modifier for menu item' })
  @ApiParam({
    name: 'menuItemId',
    format: 'uuid',
  })
  @ApiBody({ type: CreateMenuItemModifierDto })
  @ApiCreatedResponse({
    description: 'Modifier created successfully',
    type: MenuItemModifierResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'You do not own this menu item',
  })
  @ApiNotFoundResponse({ description: 'Menu item not found' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
  create(
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Session() session: UserSession,
    @Body() dto: CreateMenuItemModifierDto,
  ) {
    return this.service.create(
      menuItemId,
      session.user.id,
      hasRole(session.user.role, 'admin'),
      dto,
    );
  }

  @Patch(':id')
  @Roles(['admin', 'restaurant'])
  @ApiOperation({ summary: 'Update modifier' })
  @ApiParam({
    name: 'menuItemId',
    format: 'uuid',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
  })
  @ApiBody({ type: UpdateMenuItemModifierDto })
  @ApiOkResponse({
    description: 'Modifier updated successfully',
    type: MenuItemModifierResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'You do not own this menu item',
  })
  @ApiNotFoundResponse({ description: 'Modifier not found' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
  update(
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
    @Body() dto: UpdateMenuItemModifierDto,
  ) {
    return this.service.update(
      id,
      menuItemId,
      session.user.id,
      hasRole(session.user.role, 'admin'),
      dto,
    );
  }

  @Delete(':id')
  @Roles(['admin', 'restaurant'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete modifier' })
  @ApiParam({
    name: 'menuItemId',
    format: 'uuid',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
  })
  @ApiNoContentResponse({ description: 'Modifier deleted successfully' })
  @ApiForbiddenResponse({
    description: 'You do not own this menu item',
  })
  @ApiNotFoundResponse({ description: 'Modifier not found' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid access token',
  })
  remove(
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ) {
    return this.service.remove(
      id,
      menuItemId,
      session.user.id,
      hasRole(session.user.role, 'admin'),
    );
  }
}
