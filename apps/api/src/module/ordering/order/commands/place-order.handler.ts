import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
  BadRequestException,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';
import { PlaceOrderCommand } from './place-order.command';
import { CartRedisRepository } from '../../cart/cart.redis-repository';
import { MenuItemSnapshotRepository } from '../../acl/repositories/menu-item-snapshot.repository';
import { RestaurantSnapshotRepository } from '../../acl/repositories/restaurant-snapshot.repository';
import { AppSettingsService } from '../../common/app-settings.service';
import { RedisService } from '@/lib/redis/redis.service';
import { OrderPlacedEvent } from '@/shared/events/order-placed.event';
import {
  orders,
  orderItems,
  orderStatusLogs,
  type Order,
  type NewOrder,
  type NewOrderItem,
  type NewOrderStatusLog,
  type DeliveryAddress,
  type OrderModifier,
} from '../order.schema';
import type { Cart, CartItem } from '../../cart/cart.types';
import type { OrderingMenuItemSnapshot } from '../../acl/schemas/menu-item-snapshot.schema';
import type { OrderingRestaurantSnapshot } from '../../acl/schemas/restaurant-snapshot.schema';
import {
  IDEMPOTENCY_KEY_PREFIX,
  IDEMPOTENCY_TTL_FALLBACK_SECONDS,
  CART_KEY_PREFIX,
  CART_LOCK_SUFFIX,
  CART_LOCK_TTL_SECONDS,
} from '../../common/ordering.constants';
import { APP_SETTING_KEYS } from '../../common/app-settings.schema';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Business-rule constants
// ---------------------------------------------------------------------------

/** Minimum order total — prevents zero-price orders slipping through. */
const MINIMUM_ORDER_TOTAL = 0;

/**
 * PlaceOrderHandler
 *
 * The core of Phase 4: takes a customer's Redis cart and produces a persisted
 * Order aggregate with immutable price snapshots.
 *
 * Architecture decisions followed:
 *  D1-C  Hybrid CQRS — this handler owns the critical write path.
 *  D2-B  Cart lives only in Redis; cleared after successful order creation.
 *  D3-B  Never calls RestaurantService or MenuService; reads from ACL snapshots.
 *  D4-B  Snapshots stored in PostgreSQL (ordering_menu_item_snapshots, ordering_restaurant_snapshots).
 *  D5-A  Redis idempotency key: idempotency:order:<X-Idempotency-Key> → orderId.
 *  D5-B  DB UNIQUE(cartId) — second-line idempotency guard at the persistence layer.
 *
 * Step-by-step flow (see inline comments):
 *  1. D5-A: Check Redis idempotency key → return cached orderId if already processed.
 *  2. Acquire cart checkout lock (SET NX) → 409 if concurrent checkout running.
 *  3. Load cart from Redis → 400 if empty or missing.
 *  4. Load ACL snapshots (restaurant + all menu items).
 *  5. Validate: restaurant open + approved, all items available, same restaurant.
 *  6. Optionally enforce BR-3 delivery radius (Haversine) if coordinates present.
 *  7. Snapshot prices from ACL tables into order_items (immutable after this point).
 *  8. Calculate total amount.
 *  9. Atomic DB transaction: insert orders + order_items + order_status_logs.
 * 10. Save idempotency result to Redis (before cleanup — protects retry safety: C-1 fix).
 * 11. Publish OrderPlacedEvent via EventBus.
 * 12. Clear Redis cart (best-effort; ghost cart expires via TTL).
 * 13. Release cart lock.
 */
@Injectable()
@CommandHandler(PlaceOrderCommand)
export class PlaceOrderHandler implements ICommandHandler<PlaceOrderCommand> {
  private readonly logger = new Logger(PlaceOrderHandler.name);

  constructor(
    @Inject(DB_CONNECTION) private readonly db: NodePgDatabase<typeof schema>,
    private readonly cartRepo: CartRedisRepository,
    private readonly menuItemSnapshotRepo: MenuItemSnapshotRepository,
    private readonly restaurantSnapshotRepo: RestaurantSnapshotRepository,
    private readonly appSettingsService: AppSettingsService,
    private readonly redis: RedisService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: PlaceOrderCommand): Promise<Order> {
    const { customerId, deliveryAddress, paymentMethod, note, idempotencyKey } =
      command;

    // -------------------------------------------------------------------------
    // Step 1 — D5-A: Check Redis idempotency key
    // Return the previously created order immediately if this key was processed.
    // This is the fast path for retried network requests.
    // -------------------------------------------------------------------------
    if (idempotencyKey) {
      const cachedOrderId = await this.checkIdempotencyCache(idempotencyKey);
      if (cachedOrderId) {
        this.logger.log(
          `Idempotency hit — returning cached orderId=${cachedOrderId} for key=${idempotencyKey}`,
        );
        // Fetch and return the cached order so the caller gets a full response.
        const cachedOrder = await this.fetchOrderById(cachedOrderId);
        if (cachedOrder) return cachedOrder;
        // If the DB record is somehow gone, fall through and allow re-creation.
        this.logger.warn(
          `Idempotency key ${idempotencyKey} points to orderId=${cachedOrderId} but DB row is missing. Re-creating.`,
        );
      }
    }

    // -------------------------------------------------------------------------
    // Step 2 — Acquire cart checkout lock (SET NX EX 30s)
    // Prevents two simultaneous requests from the same customer both succeeding.
    // -------------------------------------------------------------------------
    const lockKey = `${CART_KEY_PREFIX}${customerId}${CART_LOCK_SUFFIX}`;
    const lockAcquired = await this.redis.setNx(
      lockKey,
      '1',
      CART_LOCK_TTL_SECONDS,
    );
    if (!lockAcquired) {
      throw new ConflictException(
        'A checkout is already in progress for your cart. Please wait and try again.',
      );
    }

    try {
      return await this.executeWithLock(
        customerId,
        deliveryAddress,
        paymentMethod,
        note,
        idempotencyKey,
      );
    } finally {
      // Release lock — swallow errors so they never mask the original exception.
      // The lock expires automatically via CART_LOCK_TTL_SECONDS if del fails.
      await this.redis.del(lockKey).catch((err: Error) => {
        this.logger.error(
          `Failed to release cart checkout lock for customerId=${customerId}: ${err.message}`,
        );
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Core logic — runs inside the cart lock
  // ---------------------------------------------------------------------------

  private async executeWithLock(
    customerId: string,
    deliveryAddress: DeliveryAddress,
    paymentMethod: 'cod' | 'vnpay',
    note: string | undefined,
    idempotencyKey: string | undefined,
  ): Promise<Order> {
    // -------------------------------------------------------------------------
    // Step 3 — Load cart from Redis
    // -------------------------------------------------------------------------
    const cart = await this.cartRepo.findByCustomerId(customerId);
    this.assertCartIsValid(cart, customerId);

    // -------------------------------------------------------------------------
    // Step 4 — Load ACL snapshots (no cross-module calls — D3-B)
    // -------------------------------------------------------------------------
    const menuItemIds = cart!.items.map((item) => item.menuItemId);

    const [menuItemSnapshots, restaurantSnapshot] = await Promise.all([
      this.menuItemSnapshotRepo.findManyByIds(menuItemIds),
      this.restaurantSnapshotRepo.findById(cart!.restaurantId),
    ]);

    // -------------------------------------------------------------------------
    // Step 5 — Validate restaurant and items
    // -------------------------------------------------------------------------
    this.assertRestaurantIsAcceptingOrders(restaurantSnapshot, cart!.restaurantId);
    // C-2 FIX: pass cart.restaurantId so each item's snapshot.restaurantId is
    // verified — prevents a tampered Redis cart from mixing items across restaurants.
    this.assertAllItemsAreAvailable(cart!.items, menuItemSnapshots, cart!.restaurantId);

    // -------------------------------------------------------------------------
    // Step 5b — Re-validate modifier constraints at checkout (Case 12 fix)
    //
    // Cart was valid when items were added; modifier groups can change after that
    // (options removed, isAvailable flipped, minSelections raised by merchant).
    // Re-checks against the ACL snapshot to guarantee constraints hold at order time.
    // -------------------------------------------------------------------------
    const snapshotMapForModifiers = this.buildMenuItemSnapshotMap(menuItemSnapshots);
    this.assertModifierConstraintsAtCheckout(cart!.items, snapshotMapForModifiers);

    // -------------------------------------------------------------------------
    // Step 6 — BR-3: Delivery radius check (best-effort — skipped if no coords)
    // -------------------------------------------------------------------------
    this.assertDeliveryRadiusIfApplicable(restaurantSnapshot!, deliveryAddress);

    // -------------------------------------------------------------------------
    // Step 7 — Snapshot prices from ACL into order_items
    // Use ACL snapshot price (not cart price) as the authoritative source.
    // The cart carries the price at add-time; ACL carries the latest known price.
    // Both are snapshots — we prefer the ACL snapshot for freshness.
    // -------------------------------------------------------------------------
    const snapshotedItems = this.buildOrderItemsFromSnapshots(
      cart!.items,
      snapshotMapForModifiers,
    );

    // -------------------------------------------------------------------------
    // Step 8 — Calculate total
    // -------------------------------------------------------------------------
    const totalAmount = this.calculateTotal(snapshotedItems);
    if (totalAmount <= MINIMUM_ORDER_TOTAL) {
      throw new UnprocessableEntityException(
        'Order total must be greater than zero.',
      );
    }

    // -------------------------------------------------------------------------
    // Step 9 — Determine order expiry (for restaurant accept timeout)
    // -------------------------------------------------------------------------
    const restaurantAcceptTimeoutSeconds =
      await this.appSettingsService.getNumber(
        APP_SETTING_KEYS.RESTAURANT_ACCEPT_TIMEOUT_SECONDS,
        600, // 10 min fallback
      );
    const expiresAt = new Date(
      Date.now() + restaurantAcceptTimeoutSeconds * 1_000,
    );

    // -------------------------------------------------------------------------
    // Step 10 — Atomic DB transaction: orders + order_items + order_status_logs
    //
    // D5-B: If two requests race past the Redis lock (e.g. lock TTL expired),
    // the UNIQUE(cartId) constraint on orders will throw a constraint violation
    // on the second request, which we catch and re-throw as 409.
    // -------------------------------------------------------------------------
    const order = await this.persistOrderAtomically({
      customerId,
      restaurantId: cart!.restaurantId,
      restaurantName: restaurantSnapshot!.name,
      cartId: cart!.cartId,
      totalAmount,
      paymentMethod,
      deliveryAddress,
      note,
      expiresAt,
      items: snapshotedItems,
    });

    // -------------------------------------------------------------------------
    // -------------------------------------------------------------------------
    // Step 11 — C-1 FIX: Save idempotency result BEFORE any cleanup.
    //
    // Rationale: if cart delete (Step 12) throws and the client retries:
    //  - With key saved: Step 1 (idempotency check) returns the cached orderId → safe.
    //  - Without key saved: Step 1 misses → handler runs → UNIQUE(cartId) fires → 409.
    //    The order was created but the client gets a confusing Conflict response.
    // -------------------------------------------------------------------------
    if (idempotencyKey) {
      await this.saveIdempotencyResult(idempotencyKey, order.id);
    }

    // -------------------------------------------------------------------------
    // Step 12 — Publish OrderPlacedEvent (Payment + Notification contexts consume it)
    // -------------------------------------------------------------------------
    this.publishOrderPlacedEvent(order, snapshotedItems, deliveryAddress);

    // -------------------------------------------------------------------------
    // Step 13 — Clear the Redis cart (best-effort).
    // If this fails, the ghost cart expires via CART_TTL_SECONDS.
    // D5-B UNIQUE(cartId) prevents a duplicate order on any subsequent retry.
    // -------------------------------------------------------------------------
    await this.cartRepo.delete(customerId).catch((err: Error) => {
      this.logger.error(
        `Cart delete failed for customerId=${customerId} after order ${order.id} committed. ` +
          `Ghost cart will expire via TTL. Error: ${err.message}`,
      );
    });
    this.logger.log(`Cart cleared for customerId=${customerId}`);

    this.logger.log(
      `Order placed: orderId=${order.id}, customerId=${customerId}, total=${totalAmount}`,
    );

    return order;
  }

  // ---------------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------------

  private assertCartIsValid(cart: Cart | null, customerId: string): void {
    if (!cart || cart.items.length === 0) {
      throw new BadRequestException(
        `No active cart found for customer ${customerId}. Add items before checking out.`,
      );
    }
  }

  private assertRestaurantIsAcceptingOrders(
    snapshot: OrderingRestaurantSnapshot | null,
    restaurantId: string,
  ): void {
    if (!snapshot) {
      throw new UnprocessableEntityException(
        `Restaurant ${restaurantId} is not available in the ordering system. ` +
          `Please try again or contact support. (Missing ACL snapshot)`,
      );
    }
    if (!snapshot.isApproved) {
      throw new UnprocessableEntityException(
        `Restaurant "${snapshot.name}" is not approved to receive orders.`,
      );
    }
    if (!snapshot.isOpen) {
      throw new UnprocessableEntityException(
        `Restaurant "${snapshot.name}" is currently closed. Please try again later.`,
      );
    }
  }

  private assertAllItemsAreAvailable(
    cartItems: CartItem[],
    snapshots: OrderingMenuItemSnapshot[],
    expectedRestaurantId: string,
  ): void {
    const snapshotMap = this.buildMenuItemSnapshotMap(snapshots);

    for (const item of cartItems) {
      const snapshot = snapshotMap.get(item.menuItemId);

      if (!snapshot) {
        throw new UnprocessableEntityException(
          `Menu item "${item.itemName}" (${item.menuItemId}) is no longer available. ` +
            `Please remove it from your cart and try again.`,
        );
      }

      // C-2: Cross-restaurant contamination guard (BR-2 at checkout).
      // Validates the snapshot belongs to the same restaurant as the cart.
      // Protects against tampered Redis payloads that could mix items across BCs.
      if (snapshot.restaurantId !== expectedRestaurantId) {
        throw new UnprocessableEntityException(
          `Menu item "${item.itemName}" does not belong to the selected restaurant. ` +
            `Cart integrity violation — please clear your cart and try again.`,
        );
      }

      if (snapshot.status !== 'available') {
        const reason =
          snapshot.status === 'out_of_stock' ? 'out of stock' : 'unavailable';
        throw new UnprocessableEntityException(
          `Menu item "${snapshot.name}" is currently ${reason}. ` +
            `Please remove it from your cart and try again.`,
        );
      }
    }
  }

  /**
   * Case 12 fix — Re-validate modifier constraints at checkout against the ACL snapshot.
   *
   * The cart was valid when items were added. Between add-time and checkout:
   *  - A merchant may have removed a modifier group or option.
   *  - A merchant may have marked an option isAvailable=false.
   *  - A merchant may have raised minSelections on a required group.
   *
   * This method re-checks all three conditions so the Order aggregate is
   * never persisted with stale or invalid modifier data.
   *
   * Called AFTER assertAllItemsAreAvailable (which guarantees snapshot exists)
   * and BEFORE buildOrderItemsFromSnapshots (which reads option prices from snapshot).
   */
  private assertModifierConstraintsAtCheckout(
    cartItems: CartItem[],
    snapshotMap: Map<string, OrderingMenuItemSnapshot>,
  ): void {
    for (const cartItem of cartItems) {
      const snapshot = snapshotMap.get(cartItem.menuItemId)!;
      const groupMap = new Map(snapshot.modifiers.map((g) => [g.groupId, g]));
      const countByGroup = new Map<string, number>();

      // Validate each selected modifier option still exists and is available.
      for (const sel of cartItem.selectedModifiers) {
        const group = groupMap.get(sel.groupId);
        if (!group) {
          throw new UnprocessableEntityException(
            `Modifier group "${sel.groupName}" no longer exists on "${cartItem.itemName}". ` +
              `Please update your cart and try again.`,
          );
        }
        const opt = group.options.find((o) => o.optionId === sel.optionId);
        if (!opt) {
          throw new UnprocessableEntityException(
            `Modifier option "${sel.optionName}" no longer exists. ` +
              `Please update your cart and try again.`,
          );
        }
        if (!opt.isAvailable) {
          throw new UnprocessableEntityException(
            `Modifier option "${sel.optionName}" is no longer available. ` +
              `Please update your cart and try again.`,
          );
        }
        countByGroup.set(sel.groupId, (countByGroup.get(sel.groupId) ?? 0) + 1);
      }

      // Validate minSelections/maxSelections for each group.
      for (const group of snapshot.modifiers) {
        const count = countByGroup.get(group.groupId) ?? 0;
        if (count < group.minSelections) {
          throw new UnprocessableEntityException(
            `Modifier group "${group.groupName}" now requires at least ${group.minSelections} ` +
              `selection(s) for "${cartItem.itemName}". Please update your cart and try again.`,
          );
        }
        if (group.maxSelections > 0 && count > group.maxSelections) {
          throw new UnprocessableEntityException(
            `Modifier group "${group.groupName}" now allows at most ${group.maxSelections} ` +
              `selection(s) for "${cartItem.itemName}". Please update your cart and try again.`,
          );
        }
      }
    }
  }

  /**
   * BR-3 — Delivery radius check.
   *
   * Skipped gracefully when:
   *  - The restaurant snapshot has no coordinates (upstream has not provided lat/lng yet).
   *  - The restaurant snapshot has no deliveryRadiusKm (upstream has not added this column yet).
   *  - The delivery address has no coordinates (customer did not provide GPS coords).
   *
   * When all values are present, computes Haversine distance and rejects if out of range.
   *
   * ⚠️  UPSTREAM MISSING: `deliveryRadiusKm` and restaurant `latitude/longitude` are nullable
   *     in `ordering_restaurant_snapshots` until the RestaurantCatalog BC adds those columns.
   *     See: docs/Những yêu cầu cho các BC/restaurant-catalog.md
   */
  private assertDeliveryRadiusIfApplicable(
    restaurantSnapshot: OrderingRestaurantSnapshot,
    deliveryAddress: DeliveryAddress,
  ): void {
    const {
      deliveryRadiusKm,
      latitude: restaurantLat,
      longitude: restaurantLng,
    } = restaurantSnapshot;
    const { latitude: addressLat, longitude: addressLng } = deliveryAddress;

    // Skip check if any required coordinate or radius is absent.
    if (
      deliveryRadiusKm == null ||
      restaurantLat == null ||
      restaurantLng == null ||
      addressLat == null ||
      addressLng == null
    ) {
      return;
    }

    const distanceKm = this.haversineDistanceKm(
      restaurantLat,
      restaurantLng,
      addressLat,
      addressLng,
    );

    if (distanceKm > deliveryRadiusKm) {
      throw new UnprocessableEntityException(
        `Delivery address is ${distanceKm.toFixed(1)} km from the restaurant, ` +
          `which exceeds the ${deliveryRadiusKm} km delivery radius.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Price snapshot helpers
  // ---------------------------------------------------------------------------

  private buildMenuItemSnapshotMap(
    snapshots: OrderingMenuItemSnapshot[],
  ): Map<string, OrderingMenuItemSnapshot> {
    return new Map(snapshots.map((s) => [s.menuItemId, s]));
  }

  private buildOrderItemsFromSnapshots(
    cartItems: CartItem[],
    snapshotMap: Map<string, OrderingMenuItemSnapshot>,
  ): Array<{
    menuItemId: string;
    itemName: string;
    unitPrice: number;
    modifiersPrice: number;
    quantity: number;
    subtotal: number;
    modifiers: OrderModifier[];
  }> {
    return cartItems.map((cartItem) => {
      const snapshot = snapshotMap.get(cartItem.menuItemId)!;
      // ACL snapshot price is the authoritative base price (not cart add-time price).
      const unitPrice = snapshot.price;

      // Re-resolve modifier prices from the ACL snapshot (Case 13 fix).
      // Handles merchant price edits that occurred after the item was added to the cart.
      // assertModifierConstraintsAtCheckout above already guarantees all selected
      // options still exist and are available — safe to fall back to cart price if
      // a group/option is somehow absent (belt-and-suspenders).
      const groupOptionPriceMap = new Map<string, number>(
        snapshot.modifiers.flatMap((g) =>
          g.options.map((o) => [`${g.groupId}:${o.optionId}`, o.price] as [string, number]),
        ),
      );

      const modifiersPrice = cartItem.selectedModifiers.reduce((sum, sel) => {
        const price =
          groupOptionPriceMap.get(`${sel.groupId}:${sel.optionId}`) ?? sel.price;
        return sum + price;
      }, 0);

      // Snapshot modifier selections for the immutable order record (Case 14 fix).
      const modifiers: OrderModifier[] = cartItem.selectedModifiers.map((sel) => ({
        groupId: sel.groupId,
        groupName: sel.groupName,
        optionId: sel.optionId,
        optionName: sel.optionName,
        price:
          groupOptionPriceMap.get(`${sel.groupId}:${sel.optionId}`) ?? sel.price,
      }));

      const subtotal = parseFloat(
        ((unitPrice + modifiersPrice) * cartItem.quantity).toFixed(2),
      );

      return {
        menuItemId: cartItem.menuItemId,
        itemName: snapshot.name,
        unitPrice,
        modifiersPrice,
        quantity: cartItem.quantity,
        subtotal,
        modifiers,
      };
    });
  }

  private calculateTotal(
    items: Array<{ subtotal: number }>,
  ): number {
    return items.reduce((sum, item) => sum + item.subtotal, 0);
  }

  // ---------------------------------------------------------------------------
  // DB persistence
  // ---------------------------------------------------------------------------

  private async persistOrderAtomically(params: {
    customerId: string;
    restaurantId: string;
    restaurantName: string;
    cartId: string;
    totalAmount: number;
    paymentMethod: 'cod' | 'vnpay';
    deliveryAddress: DeliveryAddress;
    note: string | undefined;
    expiresAt: Date;
    items: Array<{
      menuItemId: string;
      itemName: string;
      unitPrice: number;
      modifiersPrice: number;
      quantity: number;
      subtotal: number;
      modifiers: OrderModifier[];
    }>;
  }): Promise<Order> {
    const {
      customerId,
      restaurantId,
      restaurantName,
      cartId,
      totalAmount,
      paymentMethod,
      deliveryAddress,
      note,
      expiresAt,
      items,
    } = params;

    try {
      return await this.db.transaction(async (tx) => {
        // 1. Insert the order aggregate root.
        const newOrder: NewOrder = {
          customerId,
          restaurantId,
          restaurantName,
          cartId,
          status: 'pending',
          totalAmount,
          paymentMethod,
          deliveryAddress,
          note: note ?? null,
          expiresAt,
        };

        const [insertedOrder] = await tx
          .insert(orders)
          .values(newOrder)
          .returning();

        // 2. Insert all order items (immutable price snapshot).
        const newOrderItems: NewOrderItem[] = items.map((item) => ({
          orderId: insertedOrder.id,
          menuItemId: item.menuItemId,
          itemName: item.itemName,
          unitPrice: item.unitPrice,
          modifiersPrice: item.modifiersPrice,   // Case 13 fix — kept separate from unitPrice
          quantity: item.quantity,
          subtotal: item.subtotal,
          modifiers: item.modifiers,             // Case 14 fix — ACL-re-resolved at checkout
        }));

        await tx.insert(orderItems).values(newOrderItems);

        // 3. Insert the initial status log entry (null → PENDING).
        const initialStatusLog: NewOrderStatusLog = {
          orderId: insertedOrder.id,
          fromStatus: null,       // null = order creation event (no prior state)
          toStatus: 'pending',
          triggeredBy: customerId,
          triggeredByRole: 'customer',
          note: 'Order placed by customer',
        };

        await tx.insert(orderStatusLogs).values(initialStatusLog);

        return insertedOrder;
      });
    } catch (err) {
      // D5-B: Catch the UNIQUE(cartId) violation — prevents duplicate orders
      // when two requests race past the Redis lock.
      const error = err as { code?: string; message?: string };
      if (error.code === '23505') {
        throw new ConflictException(
          'An order for this cart has already been placed. Duplicate order rejected.',
        );
      }

      this.logger.error(
        `DB transaction failed for customerId=${customerId}: ${error.message}`,
        (err as Error).stack,
      );
      throw new InternalServerErrorException(
        'Failed to place order. Please try again.',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // EventBus
  // ---------------------------------------------------------------------------

  private publishOrderPlacedEvent(
    order: Order,
    items: Array<{
      menuItemId: string;
      itemName: string;
      unitPrice: number;
      quantity: number;
    }>,
    deliveryAddress: DeliveryAddress,
  ): void {
    const event = new OrderPlacedEvent(
      order.id,
      order.customerId,
      order.restaurantId,
      order.restaurantName,
      order.totalAmount,
      order.paymentMethod as 'cod' | 'vnpay',
      items.map((i) => ({
        menuItemId: i.menuItemId,
        name: i.itemName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      {
        street: deliveryAddress.street,
        district: deliveryAddress.district,
        city: deliveryAddress.city,
        latitude: deliveryAddress.latitude,
        longitude: deliveryAddress.longitude,
      },
    );

    this.eventBus.publish(event);
    this.logger.log(`OrderPlacedEvent published: orderId=${order.id}`);
  }

  // ---------------------------------------------------------------------------
  // Idempotency helpers
  // ---------------------------------------------------------------------------

  private buildIdempotencyRedisKey(idempotencyKey: string): string {
    return `${IDEMPOTENCY_KEY_PREFIX}${idempotencyKey}`;
  }

  private async checkIdempotencyCache(
    idempotencyKey: string,
  ): Promise<string | null> {
    const redisKey = this.buildIdempotencyRedisKey(idempotencyKey);
    return this.redis.get(redisKey);
  }

  private async saveIdempotencyResult(
    idempotencyKey: string,
    orderId: string,
  ): Promise<void> {
    const ttlSeconds = await this.appSettingsService.getNumber(
      APP_SETTING_KEYS.ORDER_IDEMPOTENCY_TTL_SECONDS,
      IDEMPOTENCY_TTL_FALLBACK_SECONDS,
    );
    const redisKey = this.buildIdempotencyRedisKey(idempotencyKey);
    await this.redis.setWithExpiry(redisKey, orderId, ttlSeconds);
    this.logger.debug(
      `Idempotency key saved: ${redisKey} → ${orderId} (TTL=${ttlSeconds}s)`,
    );
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  /**
   * Fetch a single order by ID (used for idempotency cache hit path).
   * Returns null if not found — caller handles the fallback.
   */
  private async fetchOrderById(orderId: string): Promise<Order | null> {
    const result = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Haversine formula — returns great-circle distance in kilometres.
   * Precision is sufficient for delivery-radius checks (±0.1 km error at short range).
   */
  private haversineDistanceKm(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const EARTH_RADIUS_KM = 6_371;
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const deltaLat = toRad(lat2 - lat1);
    const deltaLng = toRad(lng2 - lng1);
    const sinHalfLat = Math.sin(deltaLat / 2);
    const sinHalfLng = Math.sin(deltaLng / 2);

    const a =
      sinHalfLat * sinHalfLat +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinHalfLng * sinHalfLng;

    const centralAngle = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * centralAngle;
  }
}
