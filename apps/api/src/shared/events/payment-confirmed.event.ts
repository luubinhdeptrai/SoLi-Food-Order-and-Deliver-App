/**
 * PaymentConfirmedEvent  ← INCOMING
 *
 * Published by: Payment Context
 * Consumed by: Ordering BC (triggers PENDING → PAID for VNPay orders)
 *
 * Only applies to paymentMethod = 'vnpay'. The handler in Ordering
 * must reject this event if the order's paymentMethod is not 'vnpay'.
 */
export class PaymentConfirmedEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    /** Always 'vnpay' — COD orders never receive this event */
    public readonly paymentMethod: 'vnpay',
    public readonly paidAmount: number,
    public readonly paidAt: Date,
  ) {}
}
