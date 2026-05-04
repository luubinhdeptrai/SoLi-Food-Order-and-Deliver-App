import type { OrderStatus, TriggeredByRole } from '../../order/order.schema';

/**
 * TransitionOrderCommand
 *
 * Single command for all Order lifecycle state transitions (D1-C Hybrid CQRS).
 * Dispatched by:
 *   - OrderLifecycleController (HTTP-triggered transitions)
 *   - PaymentConfirmedEventHandler (T-02: pending → paid)
 *   - PaymentFailedEventHandler    (T-03: pending → cancelled)
 *   - OrderTimeoutTask             (T-03/T-05: timeout cancellation)
 *
 * `actorId` is null for system-initiated transitions (cron, payment events).
 * `actorRole` is 'system' for system-initiated transitions.
 */
export class TransitionOrderCommand {
  constructor(
    public readonly orderId: string,
    public readonly toStatus: OrderStatus,
    /** null for system-initiated transitions */
    public readonly actorId: string | null,
    public readonly actorRole: TriggeredByRole,
    public readonly note?: string,
  ) {}
}
