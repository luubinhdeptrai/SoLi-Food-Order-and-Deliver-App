import { Controller, Get } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { AppService } from './app.service';
import { RedisService } from './lib/redis/redis.service.js';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly redisService: RedisService,
  ) {}

  @AllowAnonymous()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @AllowAnonymous()
  @Get('health')
  async health(): Promise<{ status: string; redis: string }> {
    const redisPong = await this.redisService.ping();
    return { status: 'ok', redis: redisPong };
  }
}
