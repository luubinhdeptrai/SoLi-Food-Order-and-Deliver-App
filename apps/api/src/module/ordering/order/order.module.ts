import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from '@/drizzle/drizzle.module';
import { PlaceOrderHandler } from './commands/place-order.handler';
import { AppSettingsService } from '../common/app-settings.service';
import { MenuItemSnapshotRepository } from '../acl/repositories/menu-item-snapshot.repository';
import { RestaurantSnapshotRepository } from '../acl/repositories/restaurant-snapshot.repository';
import { DeliveryZoneSnapshotRepository } from '../acl/repositories/delivery-zone-snapshot.repository';
import { CartRedisRepository } from '../cart/cart.redis-repository';

/**
 * OrderModule — Phase 4 implementation.
 *
 * Order placement uses the D1-C Hybrid CQRS pattern:
 *   PlaceOrderCommand → PlaceOrderHandler
 *
 * Dependencies injected into PlaceOrderHandler:
 *   - CartRedisRepository       : reads (and clears) the Redis cart
 *   - MenuItemSnapshotRepository: ACL snapshot for menu item validation
 *   - RestaurantSnapshotRepository: ACL snapshot for restaurant validation
 *   - DeliveryZoneSnapshotRepository: ACL snapshot for BR-3 delivery-zone check
 *   - AppSettingsService        : reads ORDER_IDEMPOTENCY_TTL_SECONDS and
 *                                 RESTAURANT_ACCEPT_TIMEOUT_SECONDS from DB
 *   - RedisService              : globally provided via RedisModule (AppModule)
 *   - EventBus                  : provided by CqrsModule
 */
@Module({
  imports: [CqrsModule, DatabaseModule],
  providers: [
    PlaceOrderHandler,
    AppSettingsService,
    // ACL snapshot repositories (AclModule exports them, but OrderModule
    // declares them here directly to avoid a circular import with AclModule)
    MenuItemSnapshotRepository,
    RestaurantSnapshotRepository,
    DeliveryZoneSnapshotRepository,
    // Cart Redis repository (CartModule exports CartService, not the repo;
    // declare directly here to keep the checkout handler self-contained)
    CartRedisRepository,
  ],
  exports: [AppSettingsService],
})
export class OrderModule {}
