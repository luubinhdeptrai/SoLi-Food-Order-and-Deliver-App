import { Injectable, Inject, Logger } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { DB_CONNECTION } from '@/drizzle/drizzle.constants';
import * as schema from '@/drizzle/schema';
import { appSettings } from './app-settings.schema';

/**
 * AppSettingsService
 *
 * Reads runtime-configurable settings from the `app_settings` table.
 * The table is seeded at startup (see src/drizzle/seeds/app-settings.seed.ts).
 *
 * Usage pattern:
 *  - Consumer calls `getNumber(key, fallback)`.
 *  - If the row exists and the value is a valid integer, that value is returned.
 *  - If the row is missing or the value is non-numeric, the fallback is returned
 *    and a warning is logged.
 *
 * This service is intentionally lightweight — no caching layer — because settings
 * change rarely and the DB query is fast.  Add caching in a future phase if needed.
 *
 * Phase: 4 — consumed by PlaceOrderHandler for:
 *   ORDER_IDEMPOTENCY_TTL_SECONDS     → Redis TTL for idempotency keys
 *   RESTAURANT_ACCEPT_TIMEOUT_SECONDS → orders.expiresAt calculation
 */
@Injectable()
export class AppSettingsService {
  private readonly logger = new Logger(AppSettingsService.name);

  constructor(
    @Inject(DB_CONNECTION) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Returns the integer value of a setting key.
   * Falls back to `defaultValue` when the row is absent or value is non-numeric.
   */
  async getNumber(key: string, defaultValue: number): Promise<number> {
    try {
      const result = await this.db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .limit(1);

      if (result.length === 0) {
        this.logger.warn(
          `app_settings key "${key}" not found. Using fallback value: ${defaultValue}`,
        );
        return defaultValue;
      }

      const parsed = parseInt(result[0].value, 10);
      if (Number.isNaN(parsed)) {
        this.logger.warn(
          `app_settings key "${key}" has non-numeric value "${result[0].value}". Using fallback: ${defaultValue}`,
        );
        return defaultValue;
      }

      return parsed;
    } catch (err) {
      this.logger.error(
        `Failed to read app_settings key "${key}": ${(err as Error).message}`,
      );
      return defaultValue;
    }
  }
}
