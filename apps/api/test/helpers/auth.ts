/**
 * auth.ts
 *
 * Header factories for real JWT authentication.
 * Uses a valid Bearer token obtained from login.
 *
 * Usage:
 *   await request(app).post('/api/...').set(ownerHeaders()).send(body);
 *   await request(app).post('/api/...').set(noAuthHeaders());   // expect 401
 *   await request(app).post('/api/...').set(otherUserHeaders()); // expect 403
 */

export type TestHeaders = Record<string, string>;

/** Real Bearer token from authenticated login. */
const BEARER_TOKEN = 'daloudQTcguMbPPnZNWziXsBLPuh5wD0';

/** Acts as the authenticated user — passes all guards. */
export function ownerHeaders(): TestHeaders {
  return {
    'Authorization': `Bearer ${BEARER_TOKEN}`,
  };
}

/**
 * Acts as the authenticated user.
 * Passes Roles(['restaurant'|'admin']) guards but subject to ownership checks.
 */
export function restaurantRoleHeaders(): TestHeaders {
  return {
    'Authorization': `Bearer ${BEARER_TOKEN}`,
  };
}

/** Acts as an unauthenticated request — expect 401 on guarded routes. */
export function otherUserHeaders(): TestHeaders {
  return {
    'Authorization': `Bearer ${BEARER_TOKEN}`,
  };
}

/** Simulate an unauthenticated request — expect 401 on guarded routes. */
export function noAuthHeaders(): TestHeaders {
  return {};
}
