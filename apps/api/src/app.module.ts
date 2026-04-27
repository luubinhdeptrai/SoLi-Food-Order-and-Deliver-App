import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './drizzle/drizzle.module';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './lib/auth';
import { RestaurantCatalogModule } from './module/restaurant-catalog/restaurant-catalog.module';
import { RedisModule } from './lib/redis/redis.module';
import { OrderingModule } from './module/ordering/ordering.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    RedisModule,
    RestaurantCatalogModule,
    OrderingModule,

    AuthModule.forRoot({
      auth,
      disableGlobalAuthGuard: true,
      bodyParser: {
        json: { limit: '2mb' },
        urlencoded: { limit: '2mb', extended: true },
        rawBody: true,
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
