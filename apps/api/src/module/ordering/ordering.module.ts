import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CartModule } from './cart/cart.module';
import { OrderModule } from './order/order.module';
import { OrderLifecycleModule } from './order-lifecycle/order-lifecycle.module';
import { OrderHistoryModule } from './order-history/order-history.module';
import { AclModule } from './acl/acl.module';

/**
 * OrderingModule — the root of the Ordering bounded context.
 *
 * Architecture summary (see ORDERING_CONTEXT_PROPOSAL.md):
 *   D1-C  Hybrid CQRS:  Cart = Service pattern; Order placement = CommandHandler
 *   D2-B  Redis cart:   No `carts`/`cart_items` DB tables
 *   D3-B  Projections:  Local snapshot tables for menu items & restaurants
 *   D4-B  DB snapshots: Stored in PostgreSQL, not in-memory
 *   D5-A+B Idempotency: X-Idempotency-Key header + UNIQUE(cartId) on orders
 *   D6-A  State machine: Hand-crafted transition table in OrderLifecycleService
 *
 * CqrsModule is imported here so the EventBus and CommandBus are available
 * to all sub-modules via re-export. Each sub-module also imports CqrsModule
 * directly to satisfy NestJS module scoping rules.
 */
@Module({
  imports: [
    CqrsModule,
    AclModule,
    CartModule,
    OrderModule,
    // IMPORTANT: OrderHistoryModule MUST be registered before OrderLifecycleModule.
    // NestJS resolves routes in module registration order. OrderHistoryModule
    // exposes GET /orders/my and GET /orders/my/:id which would otherwise be
    // swallowed by OrderLifecycleModule's catch-all GET /orders/:id (INCON-2).
    OrderHistoryModule,
    OrderLifecycleModule,
  ],
})
export class OrderingModule {}
