/**
 * app-factory.ts
 *
 * Creates a real NestJS application for E2E tests.
 * Uses the full AppModule — all guards, pipes, and modules are real.
 * Authentication uses real Bearer tokens from the Better Auth service
 * (see test/helpers/test-auth.ts for how tokens are obtained).
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

// ─── App factory ──────────────────────────────────────────────────────────────

/**
 * Creates a fully initialised NestJS test application.
 * Call once in beforeAll(); shut down with teardownTestApp() in afterAll().
 *
 * Mirrors the production setup from main.ts:
 *   • ValidationPipe(transform: true, whitelist: true)
 *   • Global prefix 'api'
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.setGlobalPrefix('api');

  await app.init();
  return app;
}

export async function teardownTestApp(app: INestApplication): Promise<void> {
  await app.close();
}
