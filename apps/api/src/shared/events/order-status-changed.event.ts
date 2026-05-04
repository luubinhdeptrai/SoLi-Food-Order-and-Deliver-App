/**
 * OrderStatusChangedEvent
 *
 * Published by: Ordering BC (OrderLifecycleService) on every state transition
 * Consumed by: Notification Context (push notifications to affected actors)
 */
export class OrderStatusChangedEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly restaurantId: string,
    public readonly fromStatus: string,
    public readonly toStatus: string,
    public readonly triggeredByRole:
      | 'customer'
      | 'restaurant'
      | 'shipper'
      | 'admin'
      | 'system',
    public readonly note?: string,
  ) {}
}
