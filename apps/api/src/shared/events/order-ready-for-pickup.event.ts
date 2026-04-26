/**
 * OrderReadyForPickupEvent
 *
 * Published by: Ordering BC (OrderLifecycleService)
 * Triggers after: PREPARING → READY_FOR_PICKUP transition
 * Consumed by: Delivery Context (trigger shipper dispatch),
 *              Notification Context (notify shipper)
 */
export class OrderReadyForPickupEvent {
  constructor(
    public readonly orderId: string,
    public readonly restaurantId: string,
    public readonly restaurantName: string,
    /** Sourced from ordering_restaurant_snapshots.address */
    public readonly restaurantAddress: string,
    public readonly customerId: string,
    public readonly deliveryAddress: {
      street: string;
      district: string;
      city: string;
      latitude?: number;
      longitude?: number;
    },
  ) {}
}
