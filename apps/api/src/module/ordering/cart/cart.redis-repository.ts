import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@/lib/redis/redis.service';
import { CART_KEY_PREFIX, CART_TTL_SECONDS } from '../common/ordering.constants';
import type { Cart } from './cart.types';

/**
 * CartRedisRepository
 *
 * Wraps all Redis I/O for the cart.  The cart is stored as a JSON string at
 * key `cart:<customerId>` with a sliding TTL (reset on every mutation).
 *
 * Design notes:
 *  - Uses CART_KEY_PREFIX ('cart:') from ordering.constants.ts
 *  - Default TTL is CART_TTL_SECONDS (7 days); callers may override
 *  - No cross-customer access: the key suffix is always the caller's own
 *    customerId, enforced by CartService which extracts it from the JWT
 */
@Injectable()
export class CartRedisRepository {
  private readonly logger = new Logger(CartRedisRepository.name);

  constructor(private readonly redis: RedisService) {}

  /** Builds the Redis key for a customer's cart. */
  buildKey(customerId: string): string {
    return `${CART_KEY_PREFIX}${customerId}`;
  }

  /**
   * Returns the customer's active cart, or `null` if not found / expired.
   * Returns `null` and logs a warning if the stored value is not valid JSON
   * (e.g. manual Redis edit or partial write).
   */
  async findByCustomerId(customerId: string): Promise<Cart | null> {
    const raw = await this.redis.get(this.buildKey(customerId));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as Cart;
    } catch {
      this.logger.warn(
        `Cart data for customer ${customerId} is corrupted (invalid JSON). Returning null.`,
      );
      return null;
    }
  }

  /**
   * Persists (create or overwrite) the cart with a sliding TTL.
   * @param ttlSeconds Defaults to CART_TTL_SECONDS when omitted.
   */
  async save(cart: Cart, ttlSeconds: number = CART_TTL_SECONDS): Promise<void> {
    await this.redis.setWithExpiry(
      this.buildKey(cart.customerId),
      JSON.stringify(cart),
      ttlSeconds,
    );
  }

  /**
   * Deletes the cart key (clear cart / checkout consumed the cart).
   */
  async delete(customerId: string): Promise<void> {
    await this.redis.del(this.buildKey(customerId));
  }
}
