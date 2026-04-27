import { Module } from '@nestjs/common';
import { ModifiersController } from './modifiers.controller';
import { ModifiersService } from './modifiers.service';
import { ModifiersRepository } from './modifiers.repository';
import { DatabaseModule } from '@/drizzle/drizzle.module';
import { MenuModule } from '../menu.module';

@Module({
  imports: [DatabaseModule, MenuModule],
  controllers: [ModifiersController],
  providers: [ModifiersService, ModifiersRepository],
})
export class ModifiersModule {}
