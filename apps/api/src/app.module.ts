import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './drizzle/drizzle.module';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './lib/auth';
import { RestaurantCatalogModule } from './module/restaurant-catalog/restaurant-catalog.module';
import { RedisModule } from './lib/redis/redis.module';
import { OrderingModule } from './module/ordering/ordering.module';
import { DevTestUserMiddleware } from './lib/dev-test-user.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    RedisModule,
    RestaurantCatalogModule,
    OrderingModule,

    AuthModule.forRoot({
      auth,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // DEV / TEST ONLY: populate req.user from x-test-user-id header
    consumer.apply(DevTestUserMiddleware).forRoutes('*');
  }
}
