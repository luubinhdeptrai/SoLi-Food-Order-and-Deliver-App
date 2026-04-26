import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

/**
 * OrderModule — Phase 4 implementation target.
 * Order placement uses CQRS: PlaceOrderCommand → PlaceOrderHandler (D1-C).
 * Simple service methods (e.g. findById) live in OrderService.
 *
 * Placeholder registered here so OrderingModule can import it
 * without any Phase 0 side-effects.
 */
@Module({
  imports: [CqrsModule],
})
export class OrderModule {}
