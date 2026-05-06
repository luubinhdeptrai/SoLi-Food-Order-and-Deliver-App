/**
 * test-auth.ts
 *
 * TestAuthManager — manages test-user lifecycle for E2E suites.
 *
 * ── What it does ──────────────────────────────────────────────────────────────
 *   1. Signs up two test users (owner + non-owner) via the real HTTP sign-up API.
 *   2. Grants both users the 'restaurant' role with a direct Drizzle update so
 *      they pass @Roles(['restaurant']) guards on write endpoints.
 *   3. Stores the bearer tokens returned by sign-up for use in test requests.
 *
 * ── Why two separate users? ───────────────────────────────────────────────────
 *   Owner user:
 *     • session.user.id === restaurant.ownerId  → write requests return 200/201
 *   Non-owner user:
 *     • Has 'restaurant' role      → passes the @Roles(['restaurant']) guard
 *     • session.user.id ≠ ownerId  → ownership check throws 403
 *
 * ── Why direct DB role update instead of the admin API? ─────────────────────
 *   Better Auth's admin.setRole endpoint requires an existing admin-scoped
 *   bearer token.  Creating an admin user first adds a dependency chain we want
 *   to avoid.  A one-line Drizzle UPDATE is simpler and fully equivalent because
 *   Better Auth sessions re-read the user row from the DB on every request; the
 *   role is therefore live immediately without a new sign-in.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   // In beforeAll():
 *   const testAuth = new TestAuthManager();
 *   await testAuth.initialize(http);           // sign-up + grant role
 *   setAuthManager(testAuth);                  // wire auth.ts header factories
 *   await seedBaseRestaurant(testAuth.ownerUserId);  // seed with real UUID
 */

import request from 'supertest';
import type { App } from 'supertest/types';
import { inArray } from 'drizzle-orm';
import { user } from '../../src/module/auth/auth.schema';
import {
  getTestDb,
  TEST_OWNER_EMAIL,
  TEST_OTHER_EMAIL,
} from '../setup/db-setup';

// ─── Test credentials ─────────────────────────────────────────────────────────
//
// Email constants live in db-setup.ts (to avoid a circular import) and are
// re-exported from here for convenience.
export { TEST_OWNER_EMAIL, TEST_OTHER_EMAIL } from '../setup/db-setup';

/** Shared password for all test users — complex enough to pass any default policy. */
export const TEST_PASSWORD = 'TestAuth1234!';

// ─── Internal type ────────────────────────────────────────────────────────────

interface SignUpResult {
  token: string;
  userId: string;
}

// ─── TestAuthManager ──────────────────────────────────────────────────────────

export class TestAuthManager {
  private _ownerToken = '';
  private _otherToken = '';
  private _ownerUserId = '';

  // ── Public accessors ────────────────────────────────────────────────────────

  /**
   * Bearer token for the restaurant owner.
   * The owner's user.id matches the test restaurant's ownerId, so write
   * requests succeed the ownership check.
   */
  get ownerToken(): string {
    this._assertInitialized('ownerToken');
    return this._ownerToken;
  }

  /**
   * Bearer token for the non-owner user.
   * This user has the 'restaurant' role (passes @Roles guard) but their
   * user.id does NOT match restaurant.ownerId → ownership check returns 403.
   */
  get otherToken(): string {
    this._assertInitialized('otherToken');
    return this._otherToken;
  }

  /**
   * The real UUID that Better Auth assigned to the owner user.
   * Pass this to seedBaseRestaurant() so restaurant.ownerId equals the
   * value that session.user.id resolves to during requests.
   */
  get ownerUserId(): string {
    this._assertInitialized('ownerUserId');
    return this._ownerUserId;
  }

  // ── Initialization ──────────────────────────────────────────────────────────

  /**
   * Bootstraps both test users for one test suite run.
   *
   * Call after resetDb() (which clears stale users) and before
   * seedBaseRestaurant() (which needs ownerUserId).
   *
   * @param http - Supertest agent bound to the test app server.
   */
  async initialize(http: ReturnType<typeof request<App>>): Promise<void> {
    // 1. Register both users via the real HTTP sign-up API.
    const [owner, other] = await Promise.all([
      this._signUp(http, TEST_OWNER_EMAIL, TEST_PASSWORD, 'E2E Owner'),
      this._signUp(http, TEST_OTHER_EMAIL, TEST_PASSWORD, 'E2E Other'),
    ]);

    this._ownerUserId = owner.userId;
    this._ownerToken = owner.token;
    this._otherToken = other.token;

    // 2. Grant 'restaurant' role to both users so they pass
    //    @Roles(['restaurant', 'admin']) guards on write endpoints.
    //    Without this, authenticated requests would return 403 from the
    //    role guard — not from the ownership check — masking the real behaviour.
    await this._grantRestaurantRole([owner.userId, other.userId]);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Calls POST /api/auth/sign-up/email and extracts the bearer token.
   *
   * Better Auth returns the token in the response body when the bearer()
   * plugin is active:
   *   { user: { id, name, email, ... }, session: { ... }, token: "..." }
   */
  private async _signUp(
    http: ReturnType<typeof request<App>>,
    email: string,
    password: string,
    name: string,
  ): Promise<SignUpResult> {
    const res = await http
      .post('/api/auth/sign-up/email')
      .set('Content-Type', 'application/json')
      .send({ email, password, name });

    if (res.status !== 200 && res.status !== 201) {
      throw new Error(
        `[TestAuthManager] Sign-up failed for "${email}" — ` +
          `HTTP ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }

    // Better Auth + bearer() plugin response shape:
    //   { token: string, user: { id: string, ... } }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const token = (res.body?.token ?? res.body?.session?.token) as
      | string
      | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = (res.body?.user?.id ?? res.body?.id) as string | undefined;

    if (!token) {
      throw new Error(
        `[TestAuthManager] No bearer token in sign-up response for "${email}". ` +
          `Is the better-auth bearer() plugin enabled? ` +
          `Response: ${JSON.stringify(res.body)}`,
      );
    }
    if (!userId) {
      throw new Error(
        `[TestAuthManager] No user.id in sign-up response for "${email}". ` +
          `Response: ${JSON.stringify(res.body)}`,
      );
    }

    return { token, userId };
  }

  /**
   * Updates role to 'restaurant' for the given user IDs via Drizzle.
   *
   * The role update is reflected immediately on the next request because
   * Better Auth sessions look up the current user row on every validation —
   * no new sign-in is needed after the update.
   */
  private async _grantRestaurantRole(userIds: string[]): Promise<void> {
    const db = getTestDb();
    await db
      .update(user)
      .set({ role: 'restaurant' })
      .where(inArray(user.id, userIds));
  }

  private _assertInitialized(field: string): void {
    if (!this._ownerToken) {
      throw new Error(
        `[TestAuthManager] Not initialized — access to "${field}" before ` +
          `initialize() was called. Ensure initialize() is awaited in beforeAll().`,
      );
    }
  }
}
