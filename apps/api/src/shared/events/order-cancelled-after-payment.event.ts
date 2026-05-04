/**
 * OrderCancelledAfterPaymentEvent  ← OUTGOING
 *
 * Published by: Ordering BC (OrderLifecycleService)
 * Triggers after: PAID → CANCELLED (T-05) or CONFIRMED → CANCELLED (T-07, VNPay only)
 * Consumed by: Payment Context (initiate refund for paidAmount)
 *
 * This event fires when a VNPay-paid order is cancelled after
 * the payment was already confirmed. The Payment Context must
 * issue a refund for `paidAmount`.
 *
 * `cancelledByRole` includes 'admin' (T-07) and 'system' (T-05 timeout).
 */
export class OrderCancelledAfterPaymentEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    /** Always 'vnpay' */
    public readonly paymentMethod: 'vnpay',
    public readonly paidAmount: number,
    public readonly cancelledAt: Date,
    public readonly cancelledByRole:
      | 'customer'
      | 'restaurant'
      | 'admin'
      | 'system',
  ) {}
}
