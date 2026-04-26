import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

/**
 * CartModule — Phase 2 implementation target.
 * Cart state is stored entirely in Redis (D2-B). No DB tables.
 *
 * Placeholder registered here so OrderingModule can import it
 * without any Phase 0 side-effects.
 */
@Module({
  imports: [CqrsModule],
})
export class CartModule {}
