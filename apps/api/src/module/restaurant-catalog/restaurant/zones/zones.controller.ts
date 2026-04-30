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
import { AllowAnonymous, Roles, Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { ZonesService } from './zones.service';
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
import { CreateDeliveryZoneDto, UpdateDeliveryZoneDto, DeliveryZoneResponseDto } from './zones.dto';

@ApiTags('Delivery Zones')
@ApiBearerAuth()
@Controller('restaurants/:restaurantId/delivery-zones')
export class ZonesController {
  constructor(private readonly service: ZonesService) {}

  @Get()
  @AllowAnonymous()
  @ApiOperation({
    summary: 'List delivery zones',
    description: 'Returns all delivery zones for a restaurant.',
  })
  @ApiParam({
    name: 'restaurantId',
    format: 'uuid',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @ApiOkResponse({
    description: 'Delivery zones retrieved successfully',
    type: [DeliveryZoneResponseDto],
  })
  @ApiNotFoundResponse({ description: 'Restaurant not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  findByRestaurant(@Param('restaurantId', ParseUUIDPipe) restaurantId: string) {
    return this.service.findByRestaurant(restaurantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get delivery zone details' })
  @ApiParam({
    name: 'restaurantId',
    format: 'uuid',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Delivery zone found',
    type: DeliveryZoneResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Delivery zone not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  findOne(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findOne(id, restaurantId);
  }

  @Post()
  @Roles(['admin', 'restaurant'])
  @ApiOperation({ summary: 'Create delivery zone' })
  @ApiParam({
    name: 'restaurantId',
    format: 'uuid',
  })
  @ApiBody({ type: CreateDeliveryZoneDto })
  @ApiCreatedResponse({
    description: 'Delivery zone created successfully',
    type: DeliveryZoneResponseDto,
  })
  @ApiForbiddenResponse({ description: 'You do not own this restaurant' })
  @ApiNotFoundResponse({ description: 'Restaurant not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  create(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Session() session: UserSession,
    @Body() dto: CreateDeliveryZoneDto,
  ) {
    return this.service.create(
      restaurantId,
      session.user.id,
      hasRole(session.user.role, 'admin'),
      dto,
    );
  }

  @Patch(':id')
  @Roles(['admin', 'restaurant'])
  @ApiOperation({ summary: 'Update delivery zone' })
  @ApiParam({
    name: 'restaurantId',
    format: 'uuid',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
  })
  @ApiBody({ type: UpdateDeliveryZoneDto })
  @ApiOkResponse({
    description: 'Delivery zone updated successfully',
    type: DeliveryZoneResponseDto,
  })
  @ApiForbiddenResponse({ description: 'You do not own this restaurant' })
  @ApiNotFoundResponse({ description: 'Delivery zone not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  update(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
    @Body() dto: UpdateDeliveryZoneDto,
  ) {
    return this.service.update(
      id,
      restaurantId,
      session.user.id,
      hasRole(session.user.role, 'admin'),
      dto,
    );
  }

  @Delete(':id')
  @Roles(['admin', 'restaurant'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete delivery zone' })
  @ApiParam({
    name: 'restaurantId',
    format: 'uuid',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
  })
  @ApiNoContentResponse({ description: 'Delivery zone deleted successfully' })
  @ApiForbiddenResponse({ description: 'You do not own this restaurant' })
  @ApiNotFoundResponse({ description: 'Delivery zone not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  remove(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Session() session: UserSession,
  ) {
    return this.service.remove(
      id,
      restaurantId,
      session.user.id,
      hasRole(session.user.role, 'admin'),
    );
  }
}
