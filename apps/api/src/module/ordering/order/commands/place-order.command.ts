import type { DeliveryAddress } from '../order.schema';

/**
 * PlaceOrderCommand
 *
 * Triggers the order-placement flow (D1-C Hybrid CQRS — critical write path).
 * Dispatched by CartController.checkout() via CommandBus.
 *
 * Design:
 *  - Carries everything the handler needs; no extra DB/Redis reads at dispatch time.
 *  - idempotencyKey is optional: when absent, only the DB UNIQUE(cartId) guard (D5-B) protects
 *    against duplicates. When present, both D5-A (Redis) and D5-B (DB) guards are active.
 *  - customerId is always the authenticated caller's `sub` — never derived from the cart payload
 *    to prevent spoofing.
 */
export class PlaceOrderCommand {
  constructor(
    /** Authenticated customer — from JWT sub claim (req.user.sub). */
    public readonly customerId: string,
    /** Validated delivery address from the request body. */
    public readonly deliveryAddress: DeliveryAddress,
    /** Payment method selected at checkout. */
    public readonly paymentMethod: 'cod' | 'vnpay',
    /** Optional freeform note for the restaurant. */
    public readonly note?: string,
    /**
     * D5-A idempotency key from the X-Idempotency-Key header.
     * When provided, a Redis key `idempotency:order:<key>` is checked first
     * and stored after successful order creation.
     */
    public readonly idempotencyKey?: string,
    /**
     * Customer IP address — extracted by CartController from x-forwarded-for
     * or socket.remoteAddress. Passed to VNPay as vnp_IpAddr.
     * Defaults to '127.0.0.1' when absent (e.g. integration test context).
     */
    public readonly ipAddr?: string,
  ) {}
}
