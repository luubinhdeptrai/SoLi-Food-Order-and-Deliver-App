/**
 * auth.ts
 *
 * Header factories for E2E authentication.
 *
 * Tokens are obtained dynamically at runtime by TestAuthManager (see
 * test/helpers/test-auth.ts).  Call setAuthManager() in beforeAll() before
 * using any of the header factory functions.
 *
 * Usage:
 *   import { TestAuthManager } from './test-auth';
 *   import { setAuthManager, ownerHeaders, otherUserHeaders, noAuthHeaders } from './auth';
 *
 *   beforeAll(async () => {
 *     const testAuth = new TestAuthManager();
 *     await testAuth.initialize(http);   // sign up users, grant roles
 *     setAuthManager(testAuth);          // wire the header factories
 *   });
 *
 *   // In tests:
 *   .set(ownerHeaders())      // Authenticated owner  → expect 200/201
 *   .set(otherUserHeaders())  // Authenticated non-owner → expect 403
 *   .set(noAuthHeaders())     // No Authorization header → expect 401
 */

import type { TestAuthManager } from './test-auth';

export type TestHeaders = Record<string, string>;

// ─── Module-level manager reference ──────────────────────────────────────────
//
// Jest isolates module state per test file, so this variable is fresh (null)
// at the start of each spec file.  Each spec's beforeAll() must call
// setAuthManager() before any test runs.

let _manager: TestAuthManager | null = null;

/**
 * Registers the initialized TestAuthManager for the current test suite.
 * Must be called in beforeAll() after testAuth.initialize().
 */
export function setAuthManager(mgr: TestAuthManager): void {
  _manager = mgr;
}

// ─── Header factories ─────────────────────────────────────────────────────────

/**
 * Authorization header for the restaurant owner.
 *   • user.id === restaurant.ownerId → ownership checks pass → 200/201
 *   • role = 'restaurant'             → @Roles(['restaurant']) guard passes
 */
export function ownerHeaders(): TestHeaders {
  if (!_manager) {
    throw new Error(
      '[auth] Manager not set. Call setAuthManager(testAuth) in beforeAll().',
    );
  }
  return { Authorization: `Bearer ${_manager.ownerToken}` };
}

/**
 * Alias for ownerHeaders().
 * Use when you want to emphasise that the caller holds the 'restaurant' role.
 */
export function restaurantRoleHeaders(): TestHeaders {
  return ownerHeaders();
}

/**
 * Authorization header for the non-owner user.
 *   • role = 'restaurant' → @Roles(['restaurant']) guard passes
 *   • user.id ≠ ownerId   → ownership check in service throws 403
 *
 * Use when expecting HTTP 403 Forbidden on ownership-protected write endpoints.
 */
export function otherUserHeaders(): TestHeaders {
  if (!_manager) {
    throw new Error(
      '[auth] Manager not set. Call setAuthManager(testAuth) in beforeAll().',
    );
  }
  return { Authorization: `Bearer ${_manager.otherToken}` };
}

/**
 * Returns an empty headers object — no Authorization header is sent.
 * Use when expecting HTTP 401 Unauthorized on guarded endpoints.
 */
export function noAuthHeaders(): TestHeaders {
  return {};
}
