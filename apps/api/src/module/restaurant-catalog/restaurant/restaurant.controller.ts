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
import { RestaurantService } from './restaurant.service';
import { hasRole } from '@/module/auth/role.util';
import {
  CreateRestaurantDto,
  RestaurantResponseDto,
  UpdateRestaurantDto,
} from './dto/restaurant.dto';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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

@ApiTags('Restaurants')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token' })
@Controller('restaurants')
export class RestaurantController {
  constructor(private readonly service: RestaurantService) {}

  @Get()
  @ApiOperation({
    summary: 'List restaurants',
    description: 'Returns all restaurants ordered by creation date.',
  })
  @ApiOkResponse({
    description: 'Restaurants retrieved successfully',
    type: [RestaurantResponseDto],
  })
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get restaurant details',
    description: 'Returns one restaurant by its UUID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Restaurant UUID',
    format: 'uuid',
    example: 'f7d6df40-6c7e-4f44-b0d0-c544d6f9e8f9',
  })
  @ApiOkResponse({
    description: 'Restaurant found',
    type: RestaurantResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid UUID format' })
  @ApiNotFoundResponse({ description: 'Restaurant not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles(['admin', 'restaurant'])
  @ApiOperation({
    summary: 'Create restaurant',
    description: 'Creates a new restaurant for the authenticated owner.',
  })
  @ApiCreatedResponse({
    description: 'Restaurant created successfully',
    type: RestaurantResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions (requires admin or restaurant role)',
  })
  create(@Session() session: UserSession, @Body() dto: CreateRestaurantDto) {
    return this.service.create(session.user.id, dto);
  }

  @Patch(':id')
  @Roles(['admin', 'restaurant'])
  @ApiOperation({
    summary: 'Update restaurant',
    description:
      'Updates an existing restaurant. Admins can update any restaurant; restaurant users can only update their own.',
  })
  @ApiParam({
    name: 'id',
    description: 'Restaurant UUID',
    format: 'uuid',
    example: 'f7d6df40-6c7e-4f44-b0d0-c544d6f9e8f9',
  })
  @ApiOkResponse({
    description: 'Restaurant updated successfully',
    type: RestaurantResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid UUID format or invalid request body',
  })
  @ApiForbiddenResponse({
    description: 'You do not own this restaurant or your role is not allowed',
  })
  @ApiNotFoundResponse({ description: 'Restaurant not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
    @Body() dto: UpdateRestaurantDto,
  ) {
    return this.service.update(
      id,
      session.user.id,
      hasRole(session.user.role, 'admin'),
      dto,
    );
  }

  @Delete(':id')
  @Roles(['admin'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete restaurant',
    description: 'Deletes a restaurant by UUID. Admin only endpoint.',
  })
  @ApiParam({
    name: 'id',
    description: 'Restaurant UUID',
    format: 'uuid',
    example: 'f7d6df40-6c7e-4f44-b0d0-c544d6f9e8f9',
  })
  @ApiNoContentResponse({ description: 'Restaurant deleted successfully' })
  @ApiBadRequestResponse({ description: 'Invalid UUID format' })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions (admin role required)',
  })
  @ApiNotFoundResponse({ description: 'Restaurant not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
