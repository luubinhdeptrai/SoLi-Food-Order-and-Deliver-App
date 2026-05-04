import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/drizzle/drizzle.module';
import { RestaurantSnapshotRepository } from '../acl/repositories/restaurant-snapshot.repository';

// Controllers
import {
  OrderHistoryAdminController,
  OrderHistoryCustomerController,
  OrderHistoryRestaurantController,
  OrderHistoryShipperController,
} from './controllers/order-history.controller';

// Service
import { OrderHistoryService } from './services/order-history.service';

// Repository
import { OrderHistoryRepository } from './repositories/order-history.repository';

/**
 * OrderHistoryModule — Phase 7 read-only query layer.
 *
 * Exposes paginated order-history endpoints for all four actor types:
 *  - Customer    (/orders/my, /orders/my/:id, /orders/my/:id/reorder)
 *  - Restaurant  (/restaurant/orders, /restaurant/orders/active)
 *  - Shipper     (/shipper/orders/available, /shipper/orders/active, /shipper/orders/history)
 *  - Admin       (/admin/orders, /admin/orders/:id)
 *
 * Architecture decisions:
 *  - No CqrsModule — pure read side, no commands or events.
 *  - RestaurantSnapshotRepository declared directly here to avoid circular
 *    imports with AclModule (mirrors OrderLifecycleModule pattern, D3-B).
 *  - MUST be registered before OrderLifecycleModule in OrderingModule.imports
 *    so that /orders/my** routes are not swallowed by /orders/:id (INCON-2).
 *
 * Phase: 7
 */
@Module({
  imports: [DatabaseModule],
  controllers: [
    OrderHistoryCustomerController,
    OrderHistoryRestaurantController,
    OrderHistoryShipperController,
    OrderHistoryAdminController,
  ],
  providers: [
    OrderHistoryService,
    OrderHistoryRepository,
    // Declared directly (not via AclModule) to avoid circular dependency.
    RestaurantSnapshotRepository,
  ],
})
export class OrderHistoryModule {}
