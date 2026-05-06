import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { DatabaseModule } from '@/drizzle/drizzle.module';

// Projectors
import { MenuItemProjector } from './projections/menu-item.projector';
import { RestaurantSnapshotProjector } from './projections/restaurant-snapshot.projector';
import { DeliveryZoneSnapshotProjector } from './projections/delivery-zone-snapshot.projector';

// Repositories
import { MenuItemSnapshotRepository } from './repositories/menu-item-snapshot.repository';
import { RestaurantSnapshotRepository } from './repositories/restaurant-snapshot.repository';
import { DeliveryZoneSnapshotRepository } from './repositories/delivery-zone-snapshot.repository';

// Service
import { AclService } from './acl.service';
// Controller
import { AclController } from './acl.controller';

/**
 * AclModule — Anti-Corruption Layer for the Ordering bounded context.
 *
 * Responsibilities:
 *   1. Listen to upstream domain events (from RestaurantCatalog BC via EventBus).
 *   2. Project events into local PostgreSQL snapshot tables (D4-B).
 *   3. Expose read-only query endpoints so integration tests can verify snapshots.
 *
 * Architecture decisions:
 *   D3-B  Snapshots: Ordering never calls RestaurantCatalog services at runtime.
 *   D4-B  Storage:   PostgreSQL via Drizzle ORM (not in-memory).
 *   CqrsModule is imported to register @EventsHandler decorators on the projectors.
 *
 * Phase: 3
 */
@Module({
  imports: [CqrsModule, DatabaseModule],
  controllers: [AclController],
  providers: [
    // Projectors (event handlers)
    MenuItemProjector,
    RestaurantSnapshotProjector,
    DeliveryZoneSnapshotProjector,
    // Repositories (data access)
    MenuItemSnapshotRepository,
    RestaurantSnapshotRepository,
    DeliveryZoneSnapshotRepository,
    // Service (read-side orchestration for controller)
    AclService,
  ],
  exports: [
    MenuItemSnapshotRepository,
    RestaurantSnapshotRepository,
    DeliveryZoneSnapshotRepository,
  ],
})
export class AclModule {}
