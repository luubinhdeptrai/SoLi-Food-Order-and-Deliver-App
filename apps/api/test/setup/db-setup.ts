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
 *   user rows for TEST_OWNER_EMAIL / TEST_OTHER_EMAIL
 *     (cascade-deletes: sessions, accounts)
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inArray, sql } from 'drizzle-orm';
import * as schema from '../../src/drizzle/schema';
import { restaurants } from '../../src/module/restaurant-catalog/restaurant/restaurant.schema';
import { orderingMenuItemSnapshots } from '../../src/module/ordering/acl/schemas/menu-item-snapshot.schema';
import { orderingRestaurantSnapshots } from '../../src/module/ordering/acl/schemas/restaurant-snapshot.schema';
import { orderingDeliveryZoneSnapshots } from '../../src/module/ordering/acl/schemas/delivery-zone-snapshot.schema';
import { orders } from '../../src/module/ordering/order/order.schema';
import { user } from '../../src/module/auth/auth.schema';

// ─── Test user credentials ────────────────────────────────────────────────────
//
// Defined here (not in test-auth.ts) to avoid a circular import:
//   db-setup  ← test-auth (imports getTestDb)
// If the emails lived in test-auth, db-setup importing them would create a cycle.

/** Email of the test owner account created by TestAuthManager. */
export const TEST_OWNER_EMAIL = 'e2e-owner@test.soli';

/** Email of the non-owner test account created by TestAuthManager. */
export const TEST_OTHER_EMAIL = 'e2e-other@test.soli';

/** Both test-user emails — used by resetUsers() to target only test rows. */
export const TEST_USER_EMAILS = [TEST_OWNER_EMAIL, TEST_OTHER_EMAIL] as const;

// ─── Fixed test UUIDs ─────────────────────────────────────────────────────────

/** Restaurant used across all E2E suites. ownerId is set dynamically at runtime. */
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
  _db = drizzle({ connection: { connectionString: url } }) as NodePgDatabase<
    typeof schema
  >;
  return _db;
}

// ─── Reset helpers ────────────────────────────────────────────────────────────

/**
 * Removes only the two known test-user rows (by email).
 * Cascade-deletes their sessions and accounts automatically.
 *
 * Deliberately targets by email rather than deleting ALL users so this helper
 * is safe to run against a shared dev database that may have real accounts.
 */
export async function resetUsers(): Promise<void> {
  const db = getTestDb();
  await db.delete(user).where(inArray(user.email, TEST_USER_EMAILS));
}

/**
 * Wipes all data written by E2E tests.
 *
 * Order:
 *   1. ordering_menu_item_snapshots — no FK, must go before restaurant cascade
 *   2. restaurants — cascade-deletes: menu_items, modifier_groups, modifier_options
 *   3. test users  — cascade-deletes: sessions, accounts
 *      (restaurants.ownerId has no FK constraint so order vs restaurants is flexible)
 */
export async function resetDb(): Promise<void> {
  const db = getTestDb();
  // orders cascade-deletes: order_items, order_status_logs
  await db.delete(orders);
  await db.delete(orderingMenuItemSnapshots);
  await db.delete(orderingRestaurantSnapshots);
  await db.delete(orderingDeliveryZoneSnapshots);
  await db.delete(restaurants);
  await resetUsers();
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

/**
 * Seeds the minimum data required by every test suite: one test restaurant.
 *
 * @param ownerId - The real user UUID from TestAuthManager.ownerUserId.
 *   This must equal session.user.id for the signed-in owner so that
 *   restaurant.ownerId === session.user.id and ownership checks pass.
 *
 * Menu items, modifier groups, and options are created inside each test
 * (or in nested beforeAll blocks) via the real HTTP API so domain events fire
 * and the ordering snapshot stays in sync.
 */
/**
 * Ensures PostgreSQL extensions required by the search module are installed.
 *
 * Idempotent — safe to call even if extensions are already present.
 * Must be called in the `beforeAll` of any test suite that exercises
 * text-based search filters (q, name, item, category, cuisineType), because
 * those filters use `unaccent()` which requires the extension to be created.
 *
 * Background: extensions are DB-level objects installed by migration
 * 0007_search_indexes.sql. If the database was bootstrapped via `db:push`
 * instead of `db:migrate`, the extensions are absent and every unaccent()
 * call will throw `function unaccent(text) does not exist` → HTTP 500.
 */
export async function ensureExtensions(): Promise<void> {
  const db = getTestDb();
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS unaccent`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
}

export async function seedBaseRestaurant(ownerId: string): Promise<void> {
  const db = getTestDb();
  await db.insert(restaurants).values({
    id: TEST_RESTAURANT_ID,
    ownerId, // ← dynamic UUID from TestAuthManager
    name: 'E2E Test Restaurant',
    description: 'Seeded for automated E2E tests',
    address: '1 Test Street, Ho Chi Minh City',
    phone: '+84-000-000-0000',
    isOpen: true,
    isApproved: true,
  });
}
