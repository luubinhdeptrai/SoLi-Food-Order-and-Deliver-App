import { Global, Module, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';
import { RedisService } from './redis.service.js';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const logger = new Logger('RedisModule');

        const client = new Redis({
          host: process.env.REDIS_HOST ?? 'localhost',
          port: Number(process.env.REDIS_PORT ?? 6379),
          lazyConnect: true,
          // Exponential back-off capped at 3 s; stops after 10 attempts
          retryStrategy: (times: number) =>
            times > 10 ? null : Math.min(times * 200, 3000),
        });

        client.on('connect', () => logger.log('Redis connected'));
        client.on('error', (err: Error) => logger.error('Redis error', err.message));
        client.on('close', () => logger.warn('Redis connection closed'));

        return client;
      },
    },
    RedisService,
  ],
  exports: [RedisService],
})
export class RedisModule {}
