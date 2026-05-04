/**
 * PaymentFailedEvent  ← INCOMING
 *
 * Published by: Payment Context
 * Consumed by: Ordering BC (triggers PENDING → CANCELLED)
 *
 * Cart recovery is a UI concern — the frontend prompts the customer to
 * place a new order. The cart was already deleted at checkout (Phase 4).
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
