import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RestaurantSnapshotRepository } from '../../acl/repositories/restaurant-snapshot.repository';
import type { Order } from '../../order/order.schema';
import type { TriggeredByRole } from '../../order/order.schema';

/**
 * OrderLifecycleService
 *
 * Encapsulates ownership verification rules for the order lifecycle.
 *
 * Design:
 *  - All checks run AFTER the TRANSITIONS map validates that the actor role
 *    is allowed for this transition. The service only enforces ownership,
 *    not role eligibility.
 *  - Restaurant ownership is verified through `ordering_restaurant_snapshots`
 *    (D3-B — no cross-BC imports from RestaurantModule).
 *  - Admin and system actors bypass all ownership checks.
 *
 * Phase: 5
 */
@Injectable()
export class OrderLifecycleService {
  private readonly logger = new Logger(OrderLifecycleService.name);

  constructor(
    private readonly restaurantSnapshotRepo: RestaurantSnapshotRepository,
  ) {}

  /**
   * Verify that the given actor is allowed to act on this order.
   *
   * @throws ForbiddenException when ownership cannot be confirmed.
   * @throws NotFoundException  when the restaurant snapshot is missing
   *                            (should not happen in normal operation).
   */
  async assertOwnership(
    order: Order,
    actorId: string | null,
    actorRole: TriggeredByRole,
  ): Promise<void> {
    // Admin and system actors bypass all ownership checks.
    if (actorRole === 'admin' || actorRole === 'system') return;

    switch (actorRole) {
      case 'customer':
        this.assertCustomerOwnership(order, actorId);
        break;

      case 'restaurant':
        await this.assertRestaurantOwnership(order, actorId);
        break;

      case 'shipper':
        // T-09 (self-assign): any authenticated shipper may claim a
        // ready_for_pickup order — no ownership check at claim time.
        // T-10/T-11: the assigned shipper must match.
        // The specific check (shipperId match) is handled inline in the
        // handler after T-09 sets shipperId; shippers are always authed.
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private assertCustomerOwnership(
    order: Order,
    actorId: string | null,
  ): void {
    if (!actorId || order.customerId !== actorId) {
      throw new ForbiddenException(
        'You do not own this order.',
      );
    }
  }

  private async assertRestaurantOwnership(
    order: Order,
    actorId: string | null,
  ): Promise<void> {
    if (!actorId) {
      throw new ForbiddenException('Restaurant actor must be authenticated.');
    }

    const snapshot = await this.restaurantSnapshotRepo.findByRestaurantIdAndOwnerId(
      order.restaurantId,
      actorId,
    );

    if (!snapshot) {
      this.logger.warn(
        `Restaurant ownership check failed: actorId=${actorId} restaurantId=${order.restaurantId}`,
      );
      throw new ForbiddenException(
        'You do not own the restaurant associated with this order.',
      );
    }
  }
}
