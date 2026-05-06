/**
 * Seed script — app_settings initial rows.
 *
 * Run once after Phase 1 schema migration:
 *   npx ts-node -r tsconfig-paths/register src/drizzle/seeds/app-settings.seed.ts
 *
 * Or add it to a `db:seed` npm script in package.json.
 *
 * All values can be updated directly in the DB at runtime without redeployment.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { appSettings } from '../../module/ordering/common/app-settings.schema';

const db = drizzle(process.env.DATABASE_URL!);

async function seed() {
  const rows = [
    {
      key: 'ORDER_IDEMPOTENCY_TTL_SECONDS',
      value: '300',
      description:
        'How long an idempotency key is retained in Redis before expiry (D5-A). ' +
        '5 minutes is sufficient for request deduplication.',
    },
    {
      key: 'RESTAURANT_ACCEPT_TIMEOUT_SECONDS',
      value: '600',
      description:
        'How long before an unconfirmed PENDING/PAID order is auto-cancelled ' +
        'by the OrderTimeoutTask cron job (Phase 5). Default: 10 minutes.',
    },
    {
      key: 'CART_ABANDONED_TTL_SECONDS',
      value: '86400',
      description:
        'Redis TTL for inactive carts (D2-B). Cart is silently evicted by Redis ' +
        'after this duration. Default: 24 hours.',
    },
  ];

  await db.insert(appSettings).values(rows).onConflictDoNothing(); // idempotent — safe to re-run

  console.log('✅ app_settings seeded:', rows.map((r) => r.key).join(', '));
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
