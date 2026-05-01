/**
 * db-setup.ts
 *
 * Provides a shared Drizzle client for the test database plus helpers for
 * resetting and seeding data before each test suite.
 *
 * All operations go through the ORM — no psql CLI required.
 * The DB is the same PostgreSQL instance that Docker Compose starts; you can
 * point TEST_DATABASE_URL at a separate "test" database if you prefer isolation.
 *
 * Delete order respects FK constraints:
 *   ordering_menu_item_snapshots (no FK — cross-BC)
 *   restaurants (cascade-deletes: delivery_zones, menu_categories, menu_items,
 *                modifier_groups, modifier_options)
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/drizzle/schema';
import { restaurants } from '../../src/module/restaurant-catalog/restaurant/restaurant.schema';
import { orderingMenuItemSnapshots } from '../../src/module/ordering/acl/schemas/menu-item-snapshot.schema';

// ─── Fixed test UUIDs ─────────────────────────────────────────────────────────
//
// Using v4-format UUIDs that are visually distinct and recognisable in logs.
// These are intentionally different from seed.ts UUIDs to prevent collisions
// when running tests against the same DB as a dev environment.

/** Owner of TEST_RESTAURANT.  Used as default session.user.id by MockAuthGuard. */
export const TEST_OWNER_ID = '11111111-1111-4111-8111-111111111111';

/** A second user who does NOT own TEST_RESTAURANT (used in 403 tests). */
export const TEST_OTHER_USER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

/** Restaurant owned by TEST_OWNER_ID. */
export const TEST_RESTAURANT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

// ─── Drizzle connection ───────────────────────────────────────────────────────

let _db: NodePgDatabase<typeof schema> | null = null;

export function getTestDb(): NodePgDatabase<typeof schema> {
  if (_db) return _db;
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Set TEST_DATABASE_URL (or DATABASE_URL) before running E2E tests.',
    );
  }
  _db = drizzle({ connection: { connectionString: url } }) as NodePgDatabase<typeof schema>;
  return _db;
}

// ─── Reset helpers ────────────────────────────────────────────────────────────

/**
 * Wipes all data that E2E tests write.
 *
 * Deleting restaurants cascades to:
 *   delivery_zones, menu_categories, menu_items, modifier_groups, modifier_options
 *
 * ordering_menu_item_snapshots has no FK so it is deleted first.
 */
export async function resetDb(): Promise<void> {
  const db = getTestDb();
  await db.delete(orderingMenuItemSnapshots);
  await db.delete(restaurants);
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

/**
 * Seeds the minimum data required by every test suite:
 *   • One restaurant owned by TEST_OWNER_ID
 *
 * Menu items, modifier groups, and options are created inside each test
 * (or in beforeAll blocks) via the real HTTP API so events fire properly
 * and the ordering snapshot stays in sync.
 */
export async function seedBaseRestaurant(): Promise<void> {
  const db = getTestDb();
  await db.insert(restaurants).values({
    id: TEST_RESTAURANT_ID,
    ownerId: TEST_OWNER_ID,
    name: 'E2E Test Restaurant',
    description: 'Seeded for automated E2E tests',
    address: '1 Test Street, Ho Chi Minh City',
    phone: '+84-000-000-0000',
    isOpen: true,
    isApproved: true,
  });
}
