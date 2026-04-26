/**
 * PaymentFailedEvent  ← INCOMING
 *
 * Published by: Payment Context
 * Consumed by: Ordering BC (triggers PENDING → CANCELLED + cart recovery)
 */
export class PaymentFailedEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    /** Always 'vnpay' — COD orders never go through payment gateway */
    public readonly paymentMethod: 'vnpay',
    public readonly reason: string,
    public readonly failedAt: Date,
  ) {}
}
