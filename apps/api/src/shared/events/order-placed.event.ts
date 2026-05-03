/**
 * OrderPlacedEvent
 *
 * Published by: Ordering BC (PlaceOrderHandler)
 * Triggers after: successful order creation at checkout
 * Consumed by:
 *  - Payment Context  — initiate VNPay session for paymentMethod='vnpay'
 *  - Delivery Context — pre-warm shipper dispatch data
 *  - Notification Context — send order-confirmation push
 */
export class OrderPlacedEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly restaurantId: string,
    public readonly restaurantName: string,
    /** totalAmount = itemsTotal + shippingFee */
    public readonly totalAmount: number,
    /** Shipping fee computed from the innermost eligible delivery zone. 0 when zone data unavailable. */
    public readonly shippingFee: number,
    public readonly paymentMethod: 'cod' | 'vnpay',
    public readonly items: Array<{
      menuItemId: string;
      name: string;
      quantity: number;
      unitPrice: number;
    }>,
    public readonly deliveryAddress: {
      street: string;
      district: string;
      city: string;
      latitude?: number;
      longitude?: number;
    },
    /**
     * Haversine distance in km from restaurant to delivery address.
     * Undefined when either party's coordinates were absent (soft guard).
     * Useful for Delivery BC to pre-compute shipper dispatch radius.
     */
    public readonly distanceKm: number | undefined,
    /**
     * Estimated delivery time in minutes.
     * Formula: prepTimeMinutes + (distanceKm / avgSpeedKmh × 60) + bufferMinutes.
     * Undefined when coordinates or zone data were unavailable.
     */
    public readonly estimatedDeliveryMinutes: number | undefined,
  ) {}
}
