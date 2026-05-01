/**
 * app-factory.ts
 *
 * Creates a real NestJS application with real authentication.
 * Tests use Bearer tokens instead of mock headers.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

// ─── Constants ────────────────────────────────────────────────────────────────

/** UUID of the default "restaurant owner" actor used in most tests. */
export const TEST_OWNER_ID = '11111111-1111-4111-8111-111111111111';

/** UUID of a second user who does NOT own the test restaurant (for 403 tests). */
export const TEST_OTHER_USER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

// ─── App factory ──────────────────────────────────────────────────────────────

/**
 * Creates a fully initialised NestJS test application.
 * Call this once in beforeAll(); close with teardownTestApp() in afterAll().
 *
 * Uses real authentication via Bearer tokens from the Better Auth service.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  // Mirror production setup from main.ts
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.setGlobalPrefix('api');

  await app.init();
  return app;
}

export async function teardownTestApp(app: INestApplication): Promise<void> {
  await app.close();
}
