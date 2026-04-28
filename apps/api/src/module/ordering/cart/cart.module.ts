import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from '@/drizzle/drizzle.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartRedisRepository } from './cart.redis-repository';
import { MenuItemSnapshotRepository } from '../acl/repositories/menu-item-snapshot.repository';

/**
 * CartModule — Phase 2 implementation; extended in Phase 4 with checkout endpoint.
 *
 * Cart state is stored entirely in Redis (D2-B). No DB tables.
 * Per D1-C, cart uses a plain service pattern — no CQRS needed here.
 *
 * Phase 4 addition: CartController.checkout() dispatches PlaceOrderCommand
 * via CommandBus. CqrsModule is imported so CommandBus is available to the
 * controller.  The PlaceOrderHandler itself is registered in OrderModule.
 *
 * Providers:
 *  - CartController        → REST endpoints (/carts/my/* + /carts/my/checkout)
 *  - CartService           → business rules (BR-2, quantity merge, TTL reset)
 *  - CartRedisRepository   → Redis I/O  (`cart:<customerId>` key)
 *  - MenuItemSnapshotRepository → optional Phase 3 snapshot validation
 *
 * DatabaseModule is imported to provide DB_CONNECTION for
 * MenuItemSnapshotRepository.  RedisService is globally provided by
 * RedisModule (registered in AppModule) so no explicit import is needed.
 */
@Module({
  imports: [CqrsModule, DatabaseModule],
  controllers: [CartController],
  providers: [CartService, CartRedisRepository, MenuItemSnapshotRepository],
  exports: [CartService, CartRedisRepository],
})
export class CartModule {}
