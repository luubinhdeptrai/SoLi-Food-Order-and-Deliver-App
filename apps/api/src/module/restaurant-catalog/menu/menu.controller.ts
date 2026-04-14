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
import { CreateMenuItemDto, QueryMenuItemDto, UpdateMenuItemDto } from './dto/menu.dto';
import { JwtAuthGuard } from '@/module/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/module/auth/guards/roles.guard';
import { Roles } from '@/module/auth/decorators/roles.decorator';
import {
  CurrentUser,
  type JwtPayload,
} from '@/module/auth/decorators/current-user.decorator';

@Controller('menu-items')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MenuController {
  constructor(private readonly service: MenuService) {}

  // Static route — must be declared before /:id
  @Get('categories')
  getCategories() {
    return this.service.getCategories();
  }

  @Get()
  findByRestaurant(@Query() query: QueryMenuItemDto) {
    return this.service.findByRestaurant(query.restaurantId, query.category);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('admin', 'restaurant')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateMenuItemDto) {
    return this.service.create(user.sub, user.roles?.includes('admin') ?? false, dto);
  }

  @Patch(':id')
  @Roles('admin', 'restaurant')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateMenuItemDto,
  ) {
    return this.service.update(id, user.sub, user.roles?.includes('admin') ?? false, dto);
  }

  @Patch(':id/sold-out')
  @Roles('admin', 'restaurant')
  toggleSoldOut(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.toggleSoldOut(id, user.sub, user.roles?.includes('admin') ?? false);
  }

  @Delete(':id')
  @Roles('admin', 'restaurant')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(id, user.sub, user.roles?.includes('admin') ?? false);
  }
}
