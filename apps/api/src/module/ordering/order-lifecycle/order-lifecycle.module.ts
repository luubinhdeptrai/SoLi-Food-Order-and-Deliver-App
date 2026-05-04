import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from '@/drizzle/drizzle.module';
import { RestaurantSnapshotRepository } from '../acl/repositories/restaurant-snapshot.repository';

// Controllers
import { OrderLifecycleController } from './controllers/order-lifecycle.controller';

// Commands
import { TransitionOrderHandler } from './commands/transition-order.handler';

// Event handlers
import { PaymentConfirmedEventHandler } from './events/payment-confirmed.handler';
import { PaymentFailedEventHandler } from './events/payment-failed.handler';

// Tasks
import { OrderTimeoutTask } from './tasks/order-timeout.task';

// Services
import { OrderLifecycleService } from './services/order-lifecycle.service';

// Repositories
import { OrderRepository } from './repositories/order.repository';

/**
 * OrderLifecycleModule — Phase 5 implementation.
 *
 * Hosts the hand-crafted state machine (D6-A), TransitionOrderHandler,
 * OrderLifecycleService, OrderLifecycleController, and the
 * OrderTimeoutTask (@Cron — requires ScheduleModule.forRoot() in AppModule).
 *
 * Architecture decisions:
 *  D1-C  Single TransitionOrderCommand/Handler for all state transitions.
 *  D3-B  RestaurantSnapshotRepository declared directly here (avoids circular
 *         import with AclModule — mirrors the OrderModule pattern).
 *  D6-A  Hand-crafted TRANSITIONS map in constants/transitions.ts.
 *
 * Phase: 5
 */
@Module({
  imports: [CqrsModule, DatabaseModule],
  controllers: [OrderLifecycleController],
  providers: [
    // Command handler — core state machine logic
    TransitionOrderHandler,

    // Event handlers — incoming Payment BC events
    PaymentConfirmedEventHandler,
    PaymentFailedEventHandler,

    // Cron task — auto-cancel expired orders
    OrderTimeoutTask,

    // Service — ownership verification
    OrderLifecycleService,

    // Repositories
    OrderRepository,
    // RestaurantSnapshotRepository declared here directly to avoid a circular
    // import with AclModule (same pattern as OrderModule).
    RestaurantSnapshotRepository,
  ],
})
export class OrderLifecycleModule {}

