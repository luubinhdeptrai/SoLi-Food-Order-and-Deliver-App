import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

/**
 * OrderLifecycleModule — Phase 5 implementation target.
 * Hosts the hand-crafted state machine (D6-A), OrderLifecycleService,
 * OrderLifecycleController, and the OrderTimeoutTask (@Cron).
 *
 * Placeholder registered here so OrderingModule can import it
 * without any Phase 0 side-effects.
 */
@Module({
  imports: [CqrsModule],
})
export class OrderLifecycleModule {}
