import type { OrderStatus, TriggeredByRole } from '../../order/order.schema';

// ---------------------------------------------------------------------------
// Transition Rule
// ---------------------------------------------------------------------------

export type TransitionRule = {
  /** Roles that are allowed to trigger this transition. */
  allowedRoles: TriggeredByRole[];
  /** If true, a non-empty `note` must be provided (cancel/refund reasons). */
  requireNote?: boolean;
  /** If true AND order.paymentMethod === 'vnpay', publish OrderCancelledAfterPaymentEvent. */
  triggersRefundIfVnpay?: boolean;
  /** If true, publish OrderReadyForPickupEvent after the transition. */
  triggersReadyForPickup?: boolean;
};

// ---------------------------------------------------------------------------
// TRANSITIONS — single source of truth (D6-A)
//
// Key format: `${fromStatus}→${toStatus}`
// Each entry defines who can trigger the transition and any side effects.
// ---------------------------------------------------------------------------

export const TRANSITIONS: Partial<
  Record<`${OrderStatus}→${OrderStatus}`, TransitionRule>
> = {
  /** T-01: COD restaurant accepts directly */
  'pending→confirmed': { allowedRoles: ['restaurant', 'admin'] },

  /** T-02: VNPay payment confirmed — system only, no HTTP endpoint */
  'pending→paid': { allowedRoles: ['system'] },

  /** T-03: Cancel before payment (manual or timeout) */
  'pending→cancelled': {
    allowedRoles: ['customer', 'restaurant', 'admin', 'system'],
    requireNote: true,
  },

  /** T-04: VNPay — restaurant confirms after payment */
  'paid→confirmed': { allowedRoles: ['restaurant', 'admin'] },

  /** T-05: Cancel after VNPay payment — triggers refund */
  'paid→cancelled': {
    allowedRoles: ['customer', 'restaurant', 'admin', 'system'],
    requireNote: true,
    triggersRefundIfVnpay: true,
  },

  /** T-06: Restaurant starts cooking */
  'confirmed→preparing': { allowedRoles: ['restaurant', 'admin'] },

  /** T-07: Restaurant cannot fulfill — triggers refund if VNPay */
  'confirmed→cancelled': {
    allowedRoles: ['restaurant', 'admin'],
    requireNote: true,
    triggersRefundIfVnpay: true,
  },

  /** T-08: Food ready — triggers shipper dispatch */
  'preparing→ready_for_pickup': {
    allowedRoles: ['restaurant', 'admin'],
    triggersReadyForPickup: true,
  },

  /** T-09: Shipper picks up (self-assigns shipperId) */
  'ready_for_pickup→picked_up': { allowedRoles: ['shipper', 'admin'] },

  /** T-10: Shipper starts en route */
  'picked_up→delivering': { allowedRoles: ['shipper', 'admin'] },

  /** T-11: Shipper confirms handoff */
  'delivering→delivered': { allowedRoles: ['shipper', 'admin'] },

  /** T-12: Admin processes refund for delivered order (dispute) */
  'delivered→refunded': { allowedRoles: ['admin'], requireNote: true },
};

// ---------------------------------------------------------------------------
// ALLOWED_TRANSITIONS — derived from TRANSITIONS for fast first-pass check.
//
// Maps every OrderStatus to the list of statuses it can transition to.
// This is the canonical D6-A definition — do not add transitions here
// unless a matching entry exists in TRANSITIONS above.
// ---------------------------------------------------------------------------

export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'confirmed', 'cancelled'],
  paid: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready_for_pickup'],
  ready_for_pickup: ['picked_up'],
  picked_up: ['delivering'],
  delivering: ['delivered'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};
