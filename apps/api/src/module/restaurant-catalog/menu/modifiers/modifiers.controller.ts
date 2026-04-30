/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
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
import {
  AllowAnonymous,
  Roles,
  Session,
  type UserSession,
} from '@thallesp/nestjs-better-auth';
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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  CreateModifierGroupDto,
  UpdateModifierGroupDto,
  ModifierGroupResponseDto,
  CreateModifierOptionDto,
  UpdateModifierOptionDto,
  ModifierOptionResponseDto,
} from './modifiers.dto';

@ApiTags('Menu Item Modifiers')
@ApiBearerAuth()
@Controller('menu-items/:menuItemId/modifier-groups')
export class ModifiersController {
  constructor(private readonly service: ModifiersService) {}

  // -------------------------------------------------------------------------
  // Modifier Groups
  // -------------------------------------------------------------------------

  @Get()
  @AllowAnonymous()
  @ApiOperation({
    summary: 'List modifier groups for a menu item',
    description:
      'Returns all modifier groups with their options (e.g. "Size", "Toppings").',
  })
  @ApiParam({ name: 'menuItemId', format: 'uuid' })
  @ApiOkResponse({ type: [ModifierGroupResponseDto] })
  @ApiNotFoundResponse({ description: 'Menu item not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  findGroupsByMenuItem(@Param('menuItemId', ParseUUIDPipe) menuItemId: string) {
    return this.service.findGroupsByMenuItem(menuItemId);
  }

  @Post()
  @Roles(['admin', 'restaurant'])
  @ApiOperation({ summary: 'Create a modifier group for a menu item' })
  @ApiParam({ name: 'menuItemId', format: 'uuid' })
  @ApiBody({ type: CreateModifierGroupDto })
  @ApiCreatedResponse({ type: ModifierGroupResponseDto })
  @ApiForbiddenResponse({ description: 'You do not own this menu item' })
  @ApiNotFoundResponse({ description: 'Menu item not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  createGroup(
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Session() session: UserSession,
    @Body() dto: CreateModifierGroupDto,
  ) {
    return this.service.createGroup(
      menuItemId,
      session.user.id,
      hasRole(session.user.role, 'admin'),
      dto,
    );
  }

  @Patch(':groupId')
  @Roles(['admin', 'restaurant'])
  @ApiOperation({ summary: 'Update a modifier group' })
  @ApiParam({ name: 'menuItemId', format: 'uuid' })
  @ApiParam({ name: 'groupId', format: 'uuid' })
  @ApiBody({ type: UpdateModifierGroupDto })
  @ApiOkResponse({ type: ModifierGroupResponseDto })
  @ApiForbiddenResponse({ description: 'You do not own this menu item' })
  @ApiNotFoundResponse({ description: 'Modifier group not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  updateGroup(
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Session() session: UserSession,
    @Body() dto: UpdateModifierGroupDto,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.service.updateGroup(
      groupId,
      menuItemId,
      session.user.id,
      hasRole(session.user.role, 'admin'),
      dto,
    );
  }

  @Delete(':groupId')
  @Roles(['admin', 'restaurant'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a modifier group (cascades to options)' })
  @ApiParam({ name: 'menuItemId', format: 'uuid' })
  @ApiParam({ name: 'groupId', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Group deleted' })
  @ApiForbiddenResponse({ description: 'You do not own this menu item' })
  @ApiNotFoundResponse({ description: 'Modifier group not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  removeGroup(
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Session() session: UserSession,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.service.removeGroup(
      groupId,
      menuItemId,
      session.user.id,
      hasRole(session.user.role, 'admin'),
    );
  }

  // -------------------------------------------------------------------------
  // Modifier Options (sub-resource of a group)
  // -------------------------------------------------------------------------

  @Post(':groupId/options')
  @Roles(['admin', 'restaurant'])
  @ApiOperation({ summary: 'Add an option to a modifier group' })
  @ApiParam({ name: 'menuItemId', format: 'uuid' })
  @ApiParam({ name: 'groupId', format: 'uuid' })
  @ApiBody({ type: CreateModifierOptionDto })
  @ApiCreatedResponse({ type: ModifierOptionResponseDto })
  @ApiForbiddenResponse({ description: 'You do not own this menu item' })
  @ApiNotFoundResponse({ description: 'Modifier group or menu item not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  createOption(
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Session() session: UserSession,
    @Body() dto: CreateModifierOptionDto,
  ) {
    return this.service.createOption(
      groupId,
      menuItemId,
      session.user.id,
      hasRole(session.user.role, 'admin'),
      dto,
    );
  }

  @Patch(':groupId/options/:optionId')
  @Roles(['admin', 'restaurant'])
  @ApiOperation({ summary: 'Update a modifier option' })
  @ApiParam({ name: 'menuItemId', format: 'uuid' })
  @ApiParam({ name: 'groupId', format: 'uuid' })
  @ApiParam({ name: 'optionId', format: 'uuid' })
  @ApiBody({ type: UpdateModifierOptionDto })
  @ApiOkResponse({ type: ModifierOptionResponseDto })
  @ApiForbiddenResponse({ description: 'You do not own this menu item' })
  @ApiNotFoundResponse({ description: 'Option or group not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  updateOption(
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('optionId', ParseUUIDPipe) optionId: string,
    @Session() session: UserSession,
    @Body() dto: UpdateModifierOptionDto,
  ) {
    return this.service.updateOption(
      optionId,
      groupId,
      menuItemId,
      session.user.id,
      hasRole(session.user.role, 'admin'),
      dto,
    );
  }

  @Delete(':groupId/options/:optionId')
  @Roles(['admin', 'restaurant'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a modifier option' })
  @ApiParam({ name: 'menuItemId', format: 'uuid' })
  @ApiParam({ name: 'groupId', format: 'uuid' })
  @ApiParam({ name: 'optionId', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Option deleted' })
  @ApiForbiddenResponse({ description: 'You do not own this menu item' })
  @ApiNotFoundResponse({ description: 'Option or group not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  removeOption(
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('optionId', ParseUUIDPipe) optionId: string,
    @Session() session: UserSession,
  ) {
    return this.service.removeOption(
      optionId,
      groupId,
      menuItemId,
      session.user.id,
      hasRole(session.user.role, 'admin'),
    );
  }
}
