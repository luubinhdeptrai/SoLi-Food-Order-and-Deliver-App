/**
 * OrderPlacedEvent
 *
 * Published by: Ordering BC (PlaceOrderHandler)
 * Triggers after: successful order creation at checkout
 * Consumed by: Payment Context (initiate payment), Notification Context
 */
export class OrderPlacedEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly restaurantId: string,
    public readonly restaurantName: string,
    public readonly totalAmount: number,
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
  ) {}
}
