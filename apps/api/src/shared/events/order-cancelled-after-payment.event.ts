/**
 * OrderCancelledAfterPaymentEvent  ← OUTGOING
 *
 * Published by: Ordering BC (OrderLifecycleService)
 * Triggers after: PAID → CANCELLED transition
 * Consumed by: Payment Context (initiate refund for paidAmount)
 *
 * This event only fires when a VNPay-paid order is cancelled after
 * the payment was already confirmed. The Payment Context must
 * issue a refund for `paidAmount`.
 */
export class OrderCancelledAfterPaymentEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    /** Always 'vnpay' */
    public readonly paymentMethod: 'vnpay',
    public readonly paidAmount: number,
    public readonly cancelledAt: Date,
    public readonly cancelledByRole: 'customer' | 'restaurant',
  ) {}
}
