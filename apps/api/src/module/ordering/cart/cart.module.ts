import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/drizzle/drizzle.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartRedisRepository } from './cart.redis-repository';
import { MenuItemSnapshotRepository } from '../acl/repositories/menu-item-snapshot.repository';

/**
 * CartModule — Phase 2 implementation.
 *
 * Cart state is stored entirely in Redis (D2-B). No DB tables.
 * Per D1-C, cart uses a plain service pattern — no CQRS needed here.
 *
 * Providers:
 *  - CartController        → REST endpoints (/carts/my/*)
 *  - CartService           → business rules (BR-2, quantity merge, TTL reset)
 *  - CartRedisRepository   → Redis I/O  (`cart:<customerId>` key)
 *  - MenuItemSnapshotRepository → optional Phase 3 snapshot validation
 *
 * DatabaseModule is imported to provide DB_CONNECTION for
 * MenuItemSnapshotRepository.  RedisService is globally provided by
 * RedisModule (registered in AppModule) so no explicit import is needed.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [CartController],
  providers: [CartService, CartRedisRepository, MenuItemSnapshotRepository],
  exports: [CartService],
})
export class CartModule {}
