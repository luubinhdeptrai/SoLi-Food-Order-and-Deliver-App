import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CartRedisRepository } from './cart.redis-repository';
import { MenuItemSnapshotRepository } from '../acl/repositories/menu-item-snapshot.repository';
import { AppSettingsService } from '../common/app-settings.service';
import { APP_SETTING_KEYS } from '../common/app-settings.schema';
import { CART_TTL_SECONDS } from '../common/ordering.constants';
import type { Cart, CartItem, SelectedModifier } from './cart.types';
import { buildFingerprintFromResolved } from './cart.types';
import type {
  AddItemToCartDto,
  UpdateCartItemQuantityDto,
  UpdateCartItemModifiersDto,
} from './dto/cart.dto';
import type { SelectedOptionDto } from './dto/cart.dto';

/**
 * CartService — manages the customer's Redis-backed shopping cart.
 *
 * Business rules enforced here:
 *  BR-2   Single-restaurant cart: all items must belong to the same restaurant.
 *         Adding an item from a different restaurant → 409 Conflict.
 *  D2-B   Redis is the sole source of truth.  No DB writes.
 *  D5-B   cartId is stable once created; carried into orders.cartId (UNIQUE).
 *  D3-B   MenuItemSnapshotRepository provides optional price/name + modifier validation.
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
    private readonly appSettingsService: AppSettingsService,
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
   *  3. Validate price/name/modifiers against snapshot (Phase 3 guard — no-op when absent)
   *  4. Resolve selected modifiers (IDs → full SelectedModifier objects with names+prices)
   *  5. Merge quantity if item already exists; append otherwise
   *  6. Persist with TTL reset
   */
  async addItem(customerId: string, dto: AddItemToCartDto): Promise<Cart> {
    // 1. Load or initialise cart
    let cart = await this.cartRepo.findByCustomerId(customerId);

    if (!cart) {
      cart = this.createEmptyCart(
        customerId,
        dto.restaurantId,
        dto.restaurantName,
      );
    }

    // 2. BR-2: single-restaurant cart
    if (cart.restaurantId !== dto.restaurantId) {
      throw new ConflictException(
        `Cart already contains items from restaurant "${cart.restaurantName}". ` +
          `Clear your cart before adding items from a different restaurant.`,
      );
    }

    // 3 & 4. Optional snapshot validation + modifier resolution
    const resolvedModifiers = await this.validateAndResolveModifiers(dto);

    // 5. Merge or append — identity = menuItemId + modifierFingerprint (Case 9 fix)
    // Fingerprint is built from RESOLVED modifiers (not raw DTO) so that
    // only server-confirmed IDs are used for identity comparison.
    const newFingerprint = buildFingerprintFromResolved(resolvedModifiers);

    const existingIndex = cart.items.findIndex(
      (i) =>
        i.menuItemId === dto.menuItemId &&
        i.modifierFingerprint === newFingerprint,
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
        cartItemId: randomUUID(), // stable line-item ID (Case 9, 15 fix)
        modifierFingerprint: newFingerprint, // deterministic identity hash (Case 9 fix)
        menuItemId: dto.menuItemId,
        itemName: dto.itemName,
        unitPrice: dto.unitPrice,
        quantity: dto.quantity,
        selectedModifiers: resolvedModifiers,
      };
      cart.items.push(item);
    }

    // 6. Persist with TTL reset
    cart.updatedAt = new Date().toISOString();
    await this.cartRepo.save(cart, await this.getCartTtl());

    return cart;
  }

  /**
   * Sets the absolute quantity of a specific cart line item.
   * quantity = 0 → removes the item (same as removeItem).
   * Uses cartItemId (not menuItemId) to unambiguously identify the line
   * when multiple lines share the same menuItemId (Case 15 fix).
   */
  async updateItemQuantity(
    customerId: string,
    cartItemId: string,
    dto: UpdateCartItemQuantityDto,
  ): Promise<Cart | null> {
    const cart = await this.requireCart(customerId);

    const itemIndex = cart.items.findIndex((i) => i.cartItemId === cartItemId);
    if (itemIndex < 0) {
      throw new NotFoundException(
        `Cart item ${cartItemId} is not in your cart.`,
      );
    }

    if (dto.quantity === 0) {
      return this.removeItemFromCart(cart, cartItemId, customerId);
    }

    cart.items[itemIndex] = {
      ...cart.items[itemIndex],
      quantity: dto.quantity,
    };
    cart.updatedAt = new Date().toISOString();
    await this.cartRepo.save(cart, await this.getCartTtl());

    return cart;
  }

  /**
   * Replaces the modifier selections on an existing cart line item.
   *
   * Design (Case 3 fix):
   *  - Replace semantics: selectedModifiers is entirely replaced, never merged.
   *  - quantity is NOT in the DTO — cannot be accidentally reset.
   *  - modifierFingerprint is updated to stay consistent with new selectedModifiers.
   *  - Uses resolveOptions() instead of validateAndResolveModifiers() because
   *    item status was already validated at add-time; we only need option validation.
   */
  async updateItemModifiers(
    customerId: string,
    cartItemId: string,
    dto: UpdateCartItemModifiersDto,
  ): Promise<Cart> {
    const cart = await this.requireCart(customerId);

    const itemIndex = cart.items.findIndex((i) => i.cartItemId === cartItemId);
    if (itemIndex < 0) {
      throw new NotFoundException(
        `Cart item ${cartItemId} is not in your cart.`,
      );
    }

    const existing = cart.items[itemIndex];

    // resolveOptions validates modifier constraints + availability using the ACL snapshot.
    // It does NOT re-check item status (item was verified as available when added).
    const resolved = await this.resolveOptions(
      existing.menuItemId,
      cart.restaurantId,
      dto.selectedOptions,
    );

    // Fingerprint MUST be updated alongside selectedModifiers (Case 3 bug 2 fix).
    // Without this, the old fingerprint would cause wrong merge decisions on future adds.
    const newFingerprint = buildFingerprintFromResolved(resolved);

    cart.items[itemIndex] = {
      ...existing,
      selectedModifiers: resolved,
      modifierFingerprint: newFingerprint,
      // quantity: intentionally absent — never touched by modifier updates
    };
    cart.updatedAt = new Date().toISOString();
    await this.cartRepo.save(cart, await this.getCartTtl());

    return cart;
  }

  /**
   * Removes a specific cart line item by cartItemId.
   * Uses cartItemId (not menuItemId) because multiple lines can share the same
   * menuItemId after the Case 9 / Case 15 fixes.
   * If the cart becomes empty, the Redis key is deleted and `null` is returned.
   */
  async removeItem(
    customerId: string,
    cartItemId: string,
  ): Promise<Cart | null> {
    const cart = await this.requireCart(customerId);

    const itemExists = cart.items.some((i) => i.cartItemId === cartItemId);
    if (!itemExists) {
      throw new NotFoundException(
        `Cart item ${cartItemId} is not in your cart.`,
      );
    }

    return this.removeItemFromCart(cart, cartItemId, customerId);
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
   * Removes the item with the given cartItemId from the cart's items array.
   * Deletes the Redis key when the cart becomes empty; otherwise persists with TTL reset.
   * Returns the updated cart, or null when empty.
   */
  private async removeItemFromCart(
    cart: Cart,
    cartItemId: string,
    customerId: string,
  ): Promise<Cart | null> {
    cart.items = cart.items.filter((i) => i.cartItemId !== cartItemId);

    if (cart.items.length === 0) {
      await this.cartRepo.delete(customerId);
      return null;
    }

    cart.updatedAt = new Date().toISOString();
    await this.cartRepo.save(cart, await this.getCartTtl());
    return cart;
  }

  /**
   * Reads CART_ABANDONED_TTL_SECONDS from app_settings (D2-B configurable TTL).
   * Falls back to CART_TTL_SECONDS when the DB row is absent or non-numeric.
   */
  private getCartTtl(): Promise<number> {
    return this.appSettingsService.getNumber(
      APP_SETTING_KEYS.CART_ABANDONED_TTL_SECONDS,
      CART_TTL_SECONDS,
    );
  }

  /**
   * Phase 3 guard: validates the menu item against its local snapshot and resolves
   * the client-supplied selectedOptions into full SelectedModifier objects.
   *
   * Additional checks vs resolveOptions:
   *  - If selectedOptions is non-empty and no snapshot exists → 400 (Case 2 fix)
   *  - Item status must be 'available' (rejects out_of_stock / unavailable items)
   *
   * Delegates modifier-specific validation to resolveOptions().
   */
  private async validateAndResolveModifiers(
    dto: AddItemToCartDto,
  ): Promise<SelectedModifier[]> {
    const selectedOptions = dto.selectedOptions ?? [];

    const snapshot = await this.snapshotRepo.findById(dto.menuItemId);
    if (!snapshot) {
      // Case 2 fix: reject if client sent options but we cannot validate them.
      // Allow if no options sent (item has no modifiers or client omitted the field).
      if (selectedOptions.length > 0) {
        throw new BadRequestException(
          `Menu item ${dto.menuItemId} has no local snapshot. ` +
            `Cannot validate modifier options. Please try again or contact support.`,
        );
      }
      return [];
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

    // Delegate all modifier-specific validation + resolution to resolveOptions.
    return this.resolveModifierOptions(
      snapshot.modifiers ?? [],
      selectedOptions,
    );
  }

  /**
   * Resolves and validates selectedOptions against a modifier group tree.
   *
   * Shared between addItem (via validateAndResolveModifiers) and updateItemModifiers.
   * Does NOT check item status — that is the caller's responsibility.
   *
   * Validation order (all bugs from solution-review Case 8 corrected):
   *  Step 1 — Count explicit selections per group.
   *  Step 2 — Auto-inject defaults BEFORE minSelections check (Case 8 fix: dead-code bug).
   *           Default injection uses option.name → optionName mapping (Case 8 fix: field-name bug).
   *  Step 3 — minSelections check (now sees auto-injected counts).
   *  Step 4 — Resolve + validate each explicit selection (isAvailable, maxSelections).
   *
   * Used by updateItemModifiers via resolveOptions() which loads the snapshot first.
   */
  private resolveModifierOptions(
    snapshotModifiers: import('@/shared/events/menu-item-updated.event').MenuItemModifierSnapshot[],
    selectedOptions: SelectedOptionDto[],
  ): SelectedModifier[] {
    const groupMap = new Map(snapshotModifiers.map((g) => [g.groupId, g]));

    // Step 1 — Count explicit selections per group
    const selectionCountByGroup = new Map<string, number>();
    for (const sel of selectedOptions) {
      selectionCountByGroup.set(
        sel.groupId,
        (selectionCountByGroup.get(sel.groupId) ?? 0) + 1,
      );
    }

    // Step 2 — Auto-inject defaults BEFORE minSelections check (Case 8 fix).
    // For any required group with no explicit selection, inject the default option
    // if one is available.  This augments selectionCountByGroup so Step 3 sees it.
    const autoInjected: SelectedModifier[] = [];
    for (const group of snapshotModifiers) {
      if (
        group.minSelections > 0 &&
        !selectionCountByGroup.has(group.groupId)
      ) {
        const defaultOpt = group.options.find(
          (o) => o.isDefault && o.isAvailable,
        );
        if (defaultOpt) {
          autoInjected.push({
            groupId: group.groupId,
            groupName: group.groupName,
            optionId: defaultOpt.optionId,
            optionName: defaultOpt.name, // name (ModifierOptionSnapshot) → optionName (SelectedModifier)
            price: defaultOpt.price,
          });
          // Register injected count so minSelections check passes for this group
          selectionCountByGroup.set(group.groupId, 1);
        }
        // If no available default exists, the minSelections check in Step 3 throws
      }
    }

    // Step 3 — minSelections check (now sees auto-injected counts)
    for (const group of snapshotModifiers) {
      if (group.minSelections > 0) {
        const count = selectionCountByGroup.get(group.groupId) ?? 0;
        if (count < group.minSelections) {
          throw new BadRequestException(
            `Modifier group "${group.groupName}" requires at least ${group.minSelections} ` +
              `selection(s), got ${count}. ` +
              (autoInjected.some((a) => a.groupId === group.groupId)
                ? ''
                : 'No available default option found to auto-select.'),
          );
        }
      }
    }

    // Step 4 — Resolve and validate each explicit selection
    const resolved: SelectedModifier[] = [...autoInjected];

    for (const sel of selectedOptions) {
      const group = groupMap.get(sel.groupId);
      if (!group) {
        throw new BadRequestException(
          `Modifier group ${sel.groupId} does not exist on this menu item.`,
        );
      }

      // maxSelections check
      const countForGroup = selectionCountByGroup.get(sel.groupId) ?? 0;
      if (group.maxSelections > 0 && countForGroup > group.maxSelections) {
        throw new BadRequestException(
          `Modifier group "${group.groupName}" allows at most ${group.maxSelections} selection(s).`,
        );
      }

      const option = group.options.find((o) => o.optionId === sel.optionId);
      if (!option) {
        throw new BadRequestException(
          `Modifier option ${sel.optionId} does not exist in group "${group.groupName}".`,
        );
      }

      // Case 11 fix: reject unavailable options at add-time
      if (!option.isAvailable) {
        throw new BadRequestException(
          `Modifier option "${option.name}" in group "${group.groupName}" is currently unavailable.`,
        );
      }

      resolved.push({
        groupId: group.groupId,
        groupName: group.groupName,
        optionId: option.optionId,
        optionName: option.name, // name (ModifierOptionSnapshot) → optionName (SelectedModifier)
        price: option.price,
      });
    }

    return resolved;
  }

  /**
   * Loads the ACL snapshot for a menu item and resolves selectedOptions against it.
   * Used by updateItemModifiers — does NOT check item status (validated at add-time).
   *
   * Case 3 fix: extracted so updateItemModifiers can call it with only
   * (menuItemId, restaurantId, selectedOptions) — without needing a full AddItemToCartDto.
   */
  private async resolveOptions(
    menuItemId: string,
    restaurantId: string,
    selectedOptions: SelectedOptionDto[],
  ): Promise<SelectedModifier[]> {
    const snapshot = await this.snapshotRepo.findById(menuItemId);
    if (!snapshot) {
      if (selectedOptions.length > 0) {
        throw new BadRequestException(
          `Menu item ${menuItemId} has no local snapshot. Cannot validate modifier options.`,
        );
      }
      return [];
    }

    if (snapshot.restaurantId !== restaurantId) {
      throw new ConflictException(
        `Menu item ${menuItemId} does not belong to restaurant ${restaurantId}.`,
      );
    }

    return this.resolveModifierOptions(
      snapshot.modifiers ?? [],
      selectedOptions,
    );
  }
}
