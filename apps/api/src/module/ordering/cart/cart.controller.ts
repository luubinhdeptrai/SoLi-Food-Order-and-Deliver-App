import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { CartService } from './cart.service';
import {
  AddItemToCartDto,
  UpdateCartItemQuantityDto,
  CartResponseDto,
} from './dto/cart.dto';
import {
  CurrentUser,
  type JwtPayload,
} from '@/module/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/module/auth/guards/jwt-auth.guard';
import type { Cart } from './cart.types';

/**
 * CartController — REST surface for the customer's active cart.
 *
 * All endpoints are protected by JwtAuthGuard. The customerId is derived
 * from the JWT `sub` claim via @CurrentUser() so customers can only
 * read/mutate their own cart.
 *
 * Routes:
 *  GET    /carts/my                   → get active cart (null when empty)
 *  POST   /carts/my/items             → add / merge item
 *  PATCH  /carts/my/items/:menuItemId → update quantity (0 = remove)
 *  DELETE /carts/my/items/:menuItemId → remove specific item
 *  DELETE /carts/my                   → clear entire cart
 */
@ApiTags('Ordering - Cart')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('carts')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  // -------------------------------------------------------------------------
  // GET /carts/my
  // -------------------------------------------------------------------------

  @Get('my')
  @ApiOperation({ summary: "Get the caller's active cart" })
  @ApiOkResponse({
    description: 'Active cart, or null when no cart exists',
    type: CartResponseDto,
  })
  async getMyCart(
    @CurrentUser() user: JwtPayload,
  ): Promise<CartResponseDto | null> {
    const cart = await this.cartService.getCart(user.sub);
    return cart ? this.toResponse(cart) : null;
  }

  // -------------------------------------------------------------------------
  // POST /carts/my/items
  // -------------------------------------------------------------------------

  @Post('my/items')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Add an item to the cart (creates cart if absent; merges if item exists)',
  })
  @ApiCreatedResponse({ type: CartResponseDto })
  @ApiConflictResponse({
    description:
      'Item belongs to a different restaurant than the current cart (BR-2)',
  })
  @ApiBadRequestResponse({
    description: 'Validation failure or quantity overflow',
  })
  async addItem(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AddItemToCartDto,
  ): Promise<CartResponseDto> {
    const cart = await this.cartService.addItem(user.sub, dto);
    return this.toResponse(cart);
  }

  // -------------------------------------------------------------------------
  // PATCH /carts/my/items/:menuItemId
  // -------------------------------------------------------------------------

  @Patch('my/items/:menuItemId')
  @ApiOperation({
    summary: 'Update item quantity (quantity=0 removes the item)',
  })
  @ApiOkResponse({
    description: 'Updated cart',
    type: CartResponseDto,
  })
  @ApiNoContentResponse({ description: 'Cart is now empty after the update' })
  @ApiNotFoundResponse({ description: 'Cart or item not found' })
  @ApiBadRequestResponse({ description: 'Invalid quantity' })
  async updateItemQuantity(
    @CurrentUser() user: JwtPayload,
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Body() dto: UpdateCartItemQuantityDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartResponseDto | null> {
    const cart = await this.cartService.updateItemQuantity(
      user.sub,
      menuItemId,
      dto,
    );
    if (!cart) {
      res.status(HttpStatus.NO_CONTENT);
      return null;
    }
    return this.toResponse(cart);
  }

  // -------------------------------------------------------------------------
  // DELETE /carts/my/items/:menuItemId
  // -------------------------------------------------------------------------

  @Delete('my/items/:menuItemId')
  @ApiOperation({ summary: 'Remove a specific item from the cart' })
  @ApiOkResponse({
    description: 'Updated cart after removal',
    type: CartResponseDto,
  })
  @ApiNoContentResponse({ description: 'Cart is now empty after removal' })
  @ApiNotFoundResponse({ description: 'Cart or item not found' })
  async removeItem(
    @CurrentUser() user: JwtPayload,
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartResponseDto | null> {
    const cart = await this.cartService.removeItem(user.sub, menuItemId);
    if (!cart) {
      res.status(HttpStatus.NO_CONTENT);
      return null;
    }
    return this.toResponse(cart);
  }

  // -------------------------------------------------------------------------
  // DELETE /carts/my
  // -------------------------------------------------------------------------

  @Delete('my')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear (delete) the entire cart' })
  @ApiNoContentResponse({ description: 'Cart cleared successfully' })
  async clearCart(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.cartService.clearCart(user.sub);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private toResponse(cart: Cart): CartResponseDto {
    const items = cart.items.map((item) => ({
      menuItemId: item.menuItemId,
      itemName: item.itemName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      subtotal: parseFloat((item.unitPrice * item.quantity).toFixed(2)),
    }));

    const totalAmount = parseFloat(
      items.reduce((sum, i) => sum + i.subtotal, 0).toFixed(2),
    );

    return {
      cartId: cart.cartId,
      customerId: cart.customerId,
      restaurantId: cart.restaurantId,
      restaurantName: cart.restaurantName,
      items,
      totalAmount,
      createdAt: String(cart.createdAt),
      updatedAt: String(cart.updatedAt),
    };
  }
}
