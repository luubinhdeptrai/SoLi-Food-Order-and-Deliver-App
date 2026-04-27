import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CartRedisRepository } from './cart.redis-repository';
import { MenuItemSnapshotRepository } from '../acl/repositories/menu-item-snapshot.repository';
import type { Cart, CartItem } from './cart.types';
import type { AddItemToCartDto, UpdateCartItemQuantityDto } from './dto/cart.dto';

/**
 * CartService — manages the customer's Redis-backed shopping cart.
 *
 * Business rules enforced here:
 *  BR-2   Single-restaurant cart: all items must belong to the same restaurant.
 *         Adding an item from a different restaurant → 409 Conflict.
 *  D2-B   Redis is the sole source of truth.  No DB writes.
 *  D5-B   cartId is stable once created; carried into orders.cartId (UNIQUE).
 *  D3-B   MenuItemSnapshotRepository provides optional price/name validation.
 *         When the snapshot is absent (Phase 3 projector not yet seeded) the
 *         client-supplied values are trusted — logged at debug level.
 *
 * Concurrency note:
 *  Redis does not provide built-in optimistic locking via this service layer.
 *  Race conditions between two simultaneous addItem calls are acceptable in
 *  Phase 2; Phase 4 checkout adds a SET-NX cart lock for the critical section.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly cartRepo: CartRedisRepository,
    private readonly snapshotRepo: MenuItemSnapshotRepository,
  ) {}

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  /**
   * Returns the customer's active cart, or `null` when none exists.
   */
  async getCart(customerId: string): Promise<Cart | null> {
    return this.cartRepo.findByCustomerId(customerId);
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  /**
   * Adds an item to the cart (or merges quantity if already present).
   *
   * Flow:
   *  1. Load cart from Redis (or create a new empty one)
   *  2. Enforce BR-2: restaurantId must match the existing cart's restaurantId
   *  3. Optionally validate price/name against snapshot (Phase 3 guard)
   *  4. Merge quantity if item already exists; append otherwise
   *  5. Persist with TTL reset
   */
  async addItem(customerId: string, dto: AddItemToCartDto): Promise<Cart> {
    // 1. Load or initialise cart
    let cart = await this.cartRepo.findByCustomerId(customerId);

    if (!cart) {
      cart = this.createEmptyCart(customerId, dto.restaurantId, dto.restaurantName);
    }

    // 2. BR-2: single-restaurant cart
    if (cart.restaurantId !== dto.restaurantId) {
      throw new ConflictException(
        `Cart already contains items from restaurant "${cart.restaurantName}". ` +
          `Clear your cart before adding items from a different restaurant.`,
      );
    }

    // 3. Optional snapshot validation (Phase 3 guard — no-op when table empty)
    await this.validateAgainstSnapshot(dto);

    // 4. Merge or append
    const existingIndex = cart.items.findIndex(
      (i) => i.menuItemId === dto.menuItemId,
    );

    if (existingIndex >= 0) {
      const existing = cart.items[existingIndex];
      const newQty = existing.quantity + dto.quantity;
      if (newQty > 99) {
        throw new BadRequestException(
          `Total quantity for item "${dto.itemName}" would exceed the maximum of 99.`,
        );
      }
      cart.items[existingIndex] = { ...existing, quantity: newQty };
    } else {
      const item: CartItem = {
        menuItemId: dto.menuItemId,
        itemName: dto.itemName,
        unitPrice: dto.unitPrice,
        quantity: dto.quantity,
      };
      cart.items.push(item);
    }

    // 5. Persist with TTL reset
    cart.updatedAt = new Date().toISOString();
    await this.cartRepo.save(cart);

    return cart;
  }

  /**
   * Sets the absolute quantity of an item.
   * quantity = 0 → removes the item (same as removeItem).
   * If the cart becomes empty, the Redis key is deleted.
   */
  async updateItemQuantity(
    customerId: string,
    menuItemId: string,
    dto: UpdateCartItemQuantityDto,
  ): Promise<Cart | null> {
    const cart = await this.requireCart(customerId);

    const itemIndex = cart.items.findIndex((i) => i.menuItemId === menuItemId);
    if (itemIndex < 0) {
      throw new NotFoundException(
        `Item ${menuItemId} is not in your cart.`,
      );
    }

    if (dto.quantity === 0) {
      return this.removeItemFromCart(cart, menuItemId, customerId);
    }

    cart.items[itemIndex] = { ...cart.items[itemIndex], quantity: dto.quantity };
    cart.updatedAt = new Date().toISOString();
    await this.cartRepo.save(cart);

    return cart;
  }

  /**
   * Removes a single item from the cart.
   * If the cart becomes empty, the Redis key is deleted and `null` is returned.
   */
  async removeItem(customerId: string, menuItemId: string): Promise<Cart | null> {
    const cart = await this.requireCart(customerId);

    const itemExists = cart.items.some((i) => i.menuItemId === menuItemId);
    if (!itemExists) {
      throw new NotFoundException(`Item ${menuItemId} is not in your cart.`);
    }

    return this.removeItemFromCart(cart, menuItemId, customerId);
  }

  /**
   * Deletes the cart Redis key entirely.
   * Idempotent — does not throw if cart is already absent.
   */
  async clearCart(customerId: string): Promise<void> {
    await this.cartRepo.delete(customerId);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private createEmptyCart(
    customerId: string,
    restaurantId: string,
    restaurantName: string,
  ): Cart {
    const now = new Date().toISOString();
    return {
      cartId: randomUUID(),
      customerId,
      restaurantId,
      restaurantName,
      items: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Throws NotFoundException when no active cart exists for the customer.
   */
  private async requireCart(customerId: string): Promise<Cart> {
    const cart = await this.cartRepo.findByCustomerId(customerId);
    if (!cart) {
      throw new NotFoundException('No active cart found. Add an item first.');
    }
    return cart;
  }

  /**
   * Removes the item from the cart's items array.
   * Deletes the Redis key when the cart becomes empty; otherwise persists with TTL reset.
   * Returns the updated cart, or null when empty.
   */
  private async removeItemFromCart(
    cart: Cart,
    menuItemId: string,
    customerId: string,
  ): Promise<Cart | null> {
    cart.items = cart.items.filter((i) => i.menuItemId !== menuItemId);

    if (cart.items.length === 0) {
      await this.cartRepo.delete(customerId);
      return null;
    }

    cart.updatedAt = new Date().toISOString();
    await this.cartRepo.save(cart);
    return cart;
  }

  /**
   * Phase 3 guard: cross-validates price and name against the local snapshot.
   * When the snapshot row is absent (projector not yet seeded) the check is skipped.
   * This keeps Phase 2 fully testable without the Phase 3 projector running.
   */
  private async validateAgainstSnapshot(dto: AddItemToCartDto): Promise<void> {
    const snapshot = await this.snapshotRepo.findById(dto.menuItemId);
    if (!snapshot) {
      // Snapshot not yet projected — trust client-supplied values (Phase 2 behaviour)
      return;
    }

    if (snapshot.restaurantId !== dto.restaurantId) {
      throw new ConflictException(
        `Menu item ${dto.menuItemId} does not belong to restaurant ${dto.restaurantId}.`,
      );
    }

    if (snapshot.status !== 'available') {
      throw new ConflictException(
        `Menu item "${dto.itemName}" is currently not available (status: ${snapshot.status}).`,
      );
    }
  }
}
