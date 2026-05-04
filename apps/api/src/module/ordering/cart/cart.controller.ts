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
  ParseUUIDPipe,
  Res,
  Headers,
  BadRequestException,
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
  ApiHeader,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { CartService } from './cart.service';
import {
  AddItemToCartDto,
  UpdateCartItemQuantityDto,
  UpdateCartItemModifiersDto,
  CartResponseDto,
} from './dto/cart.dto';
import { CheckoutDto, CheckoutResponseDto } from '../order/dto/checkout.dto';
import { PlaceOrderCommand } from '../order/commands/place-order.command';
import type { Order } from '../order/order.schema';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Cart } from './cart.types';

/**
 * CartController — REST surface for the customer's active cart.
 *
 * All endpoints require an active session (better-auth cookie/bearer).
 * The customerId is derived from session.user.id so customers can only
 * read/mutate their own cart.
 *
 * Routes:
 *  GET    /carts/my                               → get active cart (null when empty)
 *  POST   /carts/my/items                         → add / merge item
 *  PATCH  /carts/my/items/:cartItemId             → update quantity only (0 = remove)
 *  PATCH  /carts/my/items/:cartItemId/modifiers   → replace modifier selections only
 *  DELETE /carts/my/items/:cartItemId             → remove specific line item
 *  DELETE /carts/my                               → clear entire cart
 */
@ApiTags('Ordering - Cart')
@ApiBearerAuth()
@Controller('carts')
export class CartController {
  constructor(
    private readonly cartService: CartService,
    private readonly commandBus: CommandBus,
  ) {}

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
    @Session() session: UserSession,
  ): Promise<CartResponseDto | null> {
    const cart = await this.cartService.getCart(session.user.id);
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
    @Session() session: UserSession,
    @Body() dto: AddItemToCartDto,
  ): Promise<CartResponseDto> {
    const cart = await this.cartService.addItem(session.user.id, dto);
    return this.toResponse(cart);
  }

  // -------------------------------------------------------------------------
  // PATCH /carts/my/items/:cartItemId
  // Quantity update only — modifiers are NEVER touched here (Case 15 + 4.2 fix).
  // -------------------------------------------------------------------------

  @Patch('my/items/:cartItemId')
  @ApiOperation({
    summary: 'Update item quantity only (quantity=0 removes the item)',
    description:
      'Updates the quantity of a specific cart line item.  ' +
      'cartItemId (not menuItemId) is used so that multiple lines sharing the same ' +
      'menuItemId (different modifier combinations) can be targeted independently.  ' +
      'This endpoint NEVER modifies selectedModifiers.',
  })
  @ApiOkResponse({
    description: 'Updated cart',
    type: CartResponseDto,
  })
  @ApiNoContentResponse({ description: 'Cart is now empty after the update' })
  @ApiNotFoundResponse({ description: 'Cart or cart item not found' })
  @ApiBadRequestResponse({ description: 'Invalid quantity' })
  async updateItemQuantity(
    @Session() session: UserSession,
    @Param('cartItemId', ParseUUIDPipe) cartItemId: string,
    @Body() dto: UpdateCartItemQuantityDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartResponseDto | null> {
    const cart = await this.cartService.updateItemQuantity(
      session.user.id,
      cartItemId,
      dto,
    );
    if (!cart) {
      res.status(HttpStatus.NO_CONTENT);
      return null;
    }
    return this.toResponse(cart);
  }

  // -------------------------------------------------------------------------
  // PATCH /carts/my/items/:cartItemId/modifiers
  // Modifier update only — quantity is NEVER touched here (Section 4.2 + Case 3 fix).
  // Replace semantics: the full desired modifier state is sent; server replaces entirely.
  // -------------------------------------------------------------------------

  @Patch('my/items/:cartItemId/modifiers')
  @ApiOperation({
    summary: 'Replace modifier selections on a cart line item',
    description:
      'Replaces the selectedModifiers of a specific cart line item with the resolved ' +
      'result of selectedOptions.  Replace semantics: send the full desired modifier state.  ' +
      'Sending [] clears all modifiers (valid only when no group requires minSelections > 0).  ' +
      'quantity is NEVER modified by this endpoint.',
  })
  @ApiOkResponse({
    description: 'Updated cart with new modifier selections',
    type: CartResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Cart or cart item not found' })
  @ApiBadRequestResponse({
    description:
      'Modifier validation failure (invalid groupId/optionId, min/max violation, unavailable option)',
  })
  async updateItemModifiers(
    @Session() session: UserSession,
    @Param('cartItemId', ParseUUIDPipe) cartItemId: string,
    @Body() dto: UpdateCartItemModifiersDto,
  ): Promise<CartResponseDto> {
    const cart = await this.cartService.updateItemModifiers(
      session.user.id,
      cartItemId,
      dto,
    );
    return this.toResponse(cart);
  }

  // -------------------------------------------------------------------------
  // DELETE /carts/my/items/:cartItemId
  // Uses cartItemId so that multiple lines sharing the same menuItemId can be
  // targeted independently (Case 15 fix).
  // -------------------------------------------------------------------------

  @Delete('my/items/:cartItemId')
  @ApiOperation({ summary: 'Remove a specific cart line item' })
  @ApiOkResponse({
    description: 'Updated cart after removal',
    type: CartResponseDto,
  })
  @ApiNoContentResponse({ description: 'Cart is now empty after removal' })
  @ApiNotFoundResponse({ description: 'Cart or cart item not found' })
  async removeItem(
    @Session() session: UserSession,
    @Param('cartItemId', ParseUUIDPipe) cartItemId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CartResponseDto | null> {
    const cart = await this.cartService.removeItem(session.user.id, cartItemId);
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
  async clearCart(@Session() session: UserSession): Promise<void> {
    await this.cartService.clearCart(session.user.id);
  }

  // -------------------------------------------------------------------------
  // POST /carts/my/checkout   (Phase 4 — Order Placement)
  //
  // Dispatches PlaceOrderCommand via CommandBus (D1-C Hybrid CQRS).
  // The handler performs all validation, DB writes, event publishing and
  // Redis cart cleanup — this controller only marshals the HTTP contract.
  // -------------------------------------------------------------------------

  @Post('my/checkout')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Checkout the current cart — creates an Order',
    description:
      'Atomically validates the cart against ACL snapshots, creates an Order, ' +
      'publishes OrderPlacedEvent, and clears the Redis cart. ' +
      'Supply X-Idempotency-Key to safely retry on network failure.',
  })
  @ApiHeader({
    name: 'X-Idempotency-Key',
    description:
      'Optional client-generated UUID. If this key was already used to place an ' +
      'order, the same order is returned without creating a duplicate. ' +
      'Valid for ORDER_IDEMPOTENCY_TTL_SECONDS (default 5 min).',
    required: false,
  })
  @ApiCreatedResponse({
    description: 'Order placed successfully',
    type: CheckoutResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Cart is empty or missing' })
  @ApiConflictResponse({
    description:
      'Concurrent checkout in progress, or cartId already used (D5-B duplicate)',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Restaurant closed / not approved, item unavailable, or delivery out of range',
  })
  async checkout(
    @Session() session: UserSession,
    @Body() dto: CheckoutDto,
    @Headers('x-idempotency-key') rawIdempotencyKey?: string,
  ): Promise<CheckoutResponseDto> {
    // M-2 FIX: validate the idempotency key before using it as a Redis key.
    // Reject keys that are not UUID-like (8–64 hex chars + hyphens) to prevent
    // oversized keys and log-injection via the key value.
    const idempotencyKey = rawIdempotencyKey?.trim() || undefined;
    if (idempotencyKey !== undefined) {
      if (
        idempotencyKey.length > 64 ||
        !/^[0-9a-fA-F-]{8,64}$/.test(idempotencyKey)
      ) {
        throw new BadRequestException(
          'X-Idempotency-Key must be a UUID string (8–64 hexadecimal characters with optional hyphens).',
        );
      }
    }

    const command = new PlaceOrderCommand(
      session.user.id,
      dto.deliveryAddress,
      dto.paymentMethod,
      dto.note,
      idempotencyKey,
    );

    const order: Order = await this.commandBus.execute(command);

    return this.toCheckoutResponse(order);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private toCheckoutResponse(order: Order): CheckoutResponseDto {
    return {
      orderId: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
      shippingFee: order.shippingFee,
      paymentMethod: order.paymentMethod,
      paymentUrl: order.paymentUrl,
      estimatedDeliveryMinutes: order.estimatedDeliveryMinutes,
      createdAt: order.createdAt.toISOString(),
    };
  }

  private toResponse(cart: Cart): CartResponseDto {
    const items = cart.items.map((item) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const modifiersTotal = (item.selectedModifiers ?? []).reduce(
        (sum, m) => sum + m.price,
        0,
      );
      return {
        cartItemId: item.cartItemId,
        menuItemId: item.menuItemId,
        itemName: item.itemName,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        subtotal: parseFloat(
          ((item.unitPrice + modifiersTotal) * item.quantity).toFixed(2),
        ),
        selectedModifiers: item.selectedModifiers.map((m) => ({
          groupId: m.groupId,
          groupName: m.groupName,
          optionId: m.optionId,
          optionName: m.optionName,
          price: m.price,
        })),
      };
    });
    const totalAmount = parseFloat(
      items.reduce((sum, it) => sum + it.subtotal, 0).toFixed(2),
    );
    return {
      cartId: cart.cartId,
      customerId: cart.customerId,
      restaurantId: cart.restaurantId,
      restaurantName: cart.restaurantName,
      items,
      totalAmount,
      createdAt: cart.createdAt,
      updatedAt: cart.updatedAt,
    };
  }
}
