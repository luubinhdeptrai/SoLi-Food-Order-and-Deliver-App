/**
 * IPaymentInitiationPort — DIP port for Ordering → Payment communication.
 *
 * The Ordering BC depends on this interface, NOT on PaymentService directly.
 * PaymentService (in the Payment BC) implements this interface.
 *
 * This inversion ensures:
 *   - Ordering never imports Payment BC implementation classes.
 *   - Payment BC can be replaced or mocked without touching Ordering.
 *   - No circular module dependency between OrderingModule ↔ PaymentModule.
 *
 * Usage in PlaceOrderHandler:
 *   constructor(
 *     @Inject(PAYMENT_INITIATION_PORT)
 *     private readonly paymentPort: IPaymentInitiationPort,
 *   ) {}
 */
export const PAYMENT_INITIATION_PORT = Symbol('PAYMENT_INITIATION_PORT');

export interface IPaymentInitiationPort {
  /**
   * Initiates a VNPay payment session for a placed order.
   *
   * This method:
   *   1. Creates a PaymentTransaction record in 'pending' state.
   *   2. Generates the VNPay redirect URL via VNPayService.
   *   3. Updates the PaymentTransaction to 'awaiting_ipn' and stores the URL.
   *   4. Returns { txnId, paymentUrl } to the caller.
   *
   * If URL generation fails, the PaymentTransaction remains in 'pending' state.
   * PaymentTimeoutTask will eventually expire it and fire PaymentFailedEvent,
   * which the Ordering BC handles by cancelling the order.
   *
   * @param orderId    UUID of the placed order (cross-context reference)
   * @param customerId UUID of the customer placing the order
   * @param amount     Order total in VND (from orders.total_amount)
   * @param ipAddr     Customer's IP address (sanitized by the controller layer)
   * @returns          { txnId: string; paymentUrl: string }
   * @throws           Error — if PaymentTransaction creation fails (DB error)
   *                   Error — if VNPay URL generation fails (rethrown to caller)
   */
  initiateVNPayPayment(
    orderId: string,
    customerId: string,
    amount: number,
    ipAddr: string,
  ): Promise<{ txnId: string; paymentUrl: string }>;
}
