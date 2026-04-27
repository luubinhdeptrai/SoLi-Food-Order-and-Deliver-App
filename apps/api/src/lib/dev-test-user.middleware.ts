import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * DEV / TEST ONLY — never use in production.
 *
 * Populates `req.user` so that `@CurrentUser()` works without a real JWT
 * when guards are disabled.
 *
 * Resolution order:
 *  1. `x-test-user-id` header  → uses that UUID as the identity
 *  2. No header                → falls back to the seeded owner UUID
 *                                 (11111111-1111-4111-8111-111111111111)
 *
 * The synthetic user always receives `['admin', 'restaurant']` roles so
 * all ownership and role checks pass during manual testing.
 */
const DEFAULT_TEST_USER_ID = '11111111-1111-4111-8111-111111111111';

@Injectable()
export class DevTestUserMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const testUserId =
      (req.headers['x-test-user-id'] as string | undefined) ??
      DEFAULT_TEST_USER_ID;

    req.user = {
      sub: testUserId,
      email: `dev-${testUserId}@test.local`,
      roles: ['admin', 'restaurant'],
    };

    next();
  }
}
