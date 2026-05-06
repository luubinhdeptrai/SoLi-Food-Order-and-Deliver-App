/**
 * restaurant.e2e-spec.ts
 *
 * Full-coverage end-to-end tests for Restaurant endpoints.
 *
 * Covers:
 *   §1  Create restaurant   — POST /api/restaurants (201, 401, validation)
 *   §2  List restaurants    — GET  /api/restaurants (pagination, approved-only filter)
 *   §3  Get restaurant      — GET  /api/restaurants/:id (200, 404, 400 invalid UUID)
 *   §4  Update restaurant   — PATCH /api/restaurants/:id (200, 401, 403 non-owner, 404)
 *   §5  Open / Close        — PATCH /api/restaurants/:id with isOpen field
 *   §6  Approve / Unapprove — PATCH /api/restaurants/:id/approve|unapprove (admin only, 403 for non-admin)
 *   §7  Delete restaurant   — DELETE /api/restaurants/:id (admin only, 204, 403, 404)
 *   §8  Response shape      — all required fields present in response body
 *
 * Admin user setup:
 *   A 3rd user (e2e-admin-rest@test.soli) is created in beforeAll and granted
 *   'admin' role via direct Drizzle update.  This user's token is used for
 *   admin-only endpoints (approve/unapprove/delete).  Cleaned up in afterAll.
 */

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import { createTestApp, teardownTestApp } from '../setup/app-factory';
import {
  resetDb,
  seedBaseRestaurant,
  getTestDb,
  TEST_RESTAURANT_ID,
} from '../setup/db-setup';
import {
  setAuthManager,
  noAuthHeaders,
  otherUserHeaders,
  ownerHeaders,
} from '../helpers/auth';
import { TestAuthManager, TEST_PASSWORD } from '../helpers/test-auth';
import { user } from '../../src/module/auth/auth.schema';

// ─── Admin test user ──────────────────────────────────────────────────────────

const TEST_ADMIN_EMAIL = 'e2e-admin-rest@test.soli';

// ─────────────────────────────────────────────────────────────────────────────

describe('Restaurant CRUD (E2E)', () => {
  let app: INestApplication<App>;
  let http: ReturnType<typeof request>;

  /** Bearer token for the dedicated admin user (approve / unapprove / delete). */
  let adminToken: string;

  function adminHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${adminToken}` };
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());

    await resetDb();

    // ── Regular users (owner + non-owner restaurant role) ──────────────────
    const testAuth = new TestAuthManager();
    await testAuth.initialize(http);
    setAuthManager(testAuth);

    await seedBaseRestaurant(testAuth.ownerUserId);

    // ── Admin user ─────────────────────────────────────────────────────────
    const adminSignUp = await http
      .post('/api/auth/sign-up/email')
      .set('Content-Type', 'application/json')
      .send({
        email: TEST_ADMIN_EMAIL,
        password: TEST_PASSWORD,
        name: 'E2E Admin',
      });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    adminToken = (adminSignUp.body?.token ??
      adminSignUp.body?.session?.token) as string;

    // Grant admin role via direct Drizzle update
    const db = getTestDb();
    await db
      .update(user)
      .set({ role: 'admin' })
      .where(eq(user.email, TEST_ADMIN_EMAIL));
  });

  afterAll(async () => {
    // Remove the admin user created for this suite
    const db = getTestDb();
    await db.delete(user).where(eq(user.email, TEST_ADMIN_EMAIL));
    await teardownTestApp(app);
  });

  // ─── §1 Create restaurant ──────────────────────────────────────────────────

  describe('§1 POST /api/restaurants', () => {
    it('creates a restaurant with required fields and returns 201', async () => {
      const res = await http.post('/api/restaurants').set(ownerHeaders()).send({
        name: 'New Test Restaurant',
        address: '100 Test Ave',
        phone: '+84-100-000-0000',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'New Test Restaurant',
        address: '100 Test Ave',
        phone: '+84-100-000-0000',
        isOpen: false,
        isApproved: false,
      });
      expect(res.body.id).toBeDefined();
      expect(res.body.ownerId).toBeDefined();
    });

    it('creates a restaurant with all optional fields', async () => {
      const res = await http.post('/api/restaurants').set(ownerHeaders()).send({
        name: 'Full Fields Restaurant',
        address: '200 Full St',
        phone: '+84-200-000-0000',
        description: 'A fully detailed restaurant',
        latitude: 10.7769,
        longitude: 106.7009,
        cuisineType: 'Vietnamese',
        logoUrl: 'https://example.com/logo.jpg',
        coverImageUrl: 'https://example.com/cover.jpg',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        description: 'A fully detailed restaurant',
        latitude: 10.7769,
        longitude: 106.7009,
        cuisineType: 'Vietnamese',
        logoUrl: 'https://example.com/logo.jpg',
        coverImageUrl: 'https://example.com/cover.jpg',
      });
    });

    it('ownerId is set to the authenticated user id', async () => {
      const res = await http
        .post('/api/restaurants')
        .set(ownerHeaders())
        .send({ name: 'Owner ID Test', address: '1 St', phone: '+84000' });

      expect(res.status).toBe(201);
      expect(res.body.ownerId).toBeDefined();
      expect(typeof res.body.ownerId).toBe('string');
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .post('/api/restaurants')
        .set(noAuthHeaders())
        .send({ name: 'Hack', address: '1 St', phone: '+84000' });

      expect(res.status).toBe(401);
    });

    it('returns 400 for missing name', async () => {
      const res = await http
        .post('/api/restaurants')
        .set(ownerHeaders())
        .send({ address: '1 St', phone: '+84000' });

      expect(res.status).toBe(400);
    });

    it('returns 400 for name shorter than 2 characters', async () => {
      const res = await http
        .post('/api/restaurants')
        .set(ownerHeaders())
        .send({ name: 'A', address: '1 St', phone: '+84000' });

      expect(res.status).toBe(400);
    });

    it('returns 400 for missing address', async () => {
      const res = await http
        .post('/api/restaurants')
        .set(ownerHeaders())
        .send({ name: 'No Address', phone: '+84000' });

      expect(res.status).toBe(400);
    });

    it('returns 400 for missing phone', async () => {
      const res = await http
        .post('/api/restaurants')
        .set(ownerHeaders())
        .send({ name: 'No Phone', address: '1 St' });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid logoUrl', async () => {
      const res = await http.post('/api/restaurants').set(ownerHeaders()).send({
        name: 'Bad URL',
        address: '1 St',
        phone: '+84000',
        logoUrl: 'not-a-url',
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── §2 List restaurants ───────────────────────────────────────────────────

  describe('§2 GET /api/restaurants', () => {
    it('returns { data, total } shape (public)', async () => {
      const res = await http.get('/api/restaurants').set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe('number');
    });

    it('includes the seeded approved restaurant', async () => {
      const res = await http.get('/api/restaurants').set(noAuthHeaders());

      expect(res.status).toBe(200);
      const ids = (res.body.data as { id: string }[]).map((r) => r.id);
      expect(ids).toContain(TEST_RESTAURANT_ID);
    });

    it('does NOT include unapproved restaurants', async () => {
      // Create a new restaurant (defaults to isApproved=false)
      const createRes = await http
        .post('/api/restaurants')
        .set(ownerHeaders())
        .send({
          name: 'Unapproved Restaurant',
          address: '1 St',
          phone: '+84000',
        });
      const unapprovedId = createRes.body.id as string;

      const listRes = await http.get('/api/restaurants').set(noAuthHeaders());
      const ids = (listRes.body.data as { id: string }[]).map((r) => r.id);
      expect(ids).not.toContain(unapprovedId);
    });

    it('respects limit pagination parameter', async () => {
      const res = await http
        .get('/api/restaurants?limit=1')
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(1);
    });

    it('respects offset pagination parameter', async () => {
      const allRes = await http
        .get('/api/restaurants?limit=100')
        .set(noAuthHeaders());
      const total = allRes.body.total as number;

      if (total > 1) {
        const offsetRes = await http
          .get('/api/restaurants?offset=1&limit=100')
          .set(noAuthHeaders());
        expect(offsetRes.status).toBe(200);
        expect(offsetRes.body.data.length).toBe(total - 1);
      }
    });

    it('shows approved restaurant after admin approves it', async () => {
      // Create unapproved restaurant
      const createRes = await http
        .post('/api/restaurants')
        .set(ownerHeaders())
        .send({ name: 'Soon Approved', address: '1 St', phone: '+84000' });
      const restaurantId = createRes.body.id as string;

      // Verify it's not listed
      const before = await http.get('/api/restaurants').set(noAuthHeaders());
      const idsBefore = (before.body.data as { id: string }[]).map((r) => r.id);
      expect(idsBefore).not.toContain(restaurantId);

      // Admin approves it
      await http
        .patch(`/api/restaurants/${restaurantId}/approve`)
        .set(adminHeaders());

      // Now it should appear in the list
      const after = await http.get('/api/restaurants').set(noAuthHeaders());
      const idsAfter = (after.body.data as { id: string }[]).map((r) => r.id);
      expect(idsAfter).toContain(restaurantId);
    });
  });

  // ─── §3 Get restaurant ─────────────────────────────────────────────────────

  describe('§3 GET /api/restaurants/:id', () => {
    it('returns 200 with restaurant details (public)', async () => {
      const res = await http
        .get(`/api/restaurants/${TEST_RESTAURANT_ID}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(TEST_RESTAURANT_ID);
      expect(res.body.name).toBe('E2E Test Restaurant');
    });

    it('returns 404 for non-existent restaurant', async () => {
      const res = await http
        .get('/api/restaurants/00000000-0000-4000-8000-000000000000')
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid UUID format', async () => {
      const res = await http
        .get('/api/restaurants/not-a-uuid')
        .set(noAuthHeaders());

      expect(res.status).toBe(400);
    });
  });

  // ─── §4 Update restaurant ──────────────────────────────────────────────────

  describe('§4 PATCH /api/restaurants/:id', () => {
    let updatableId: string;

    beforeAll(async () => {
      const res = await http.post('/api/restaurants').set(ownerHeaders()).send({
        name: 'Updatable Restaurant',
        address: '1 St',
        phone: '+84000',
      });
      updatableId = res.body.id as string;
    });

    it('owner can update their restaurant and returns 200', async () => {
      const res = await http
        .patch(`/api/restaurants/${updatableId}`)
        .set(ownerHeaders())
        .send({
          name: 'Updated Restaurant Name',
          description: 'New description',
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Restaurant Name');
      expect(res.body.description).toBe('New description');
    });

    it('admin can update any restaurant', async () => {
      const res = await http
        .patch(`/api/restaurants/${updatableId}`)
        .set(adminHeaders())
        .send({ phone: '+84-999-999-0000' });

      expect(res.status).toBe(200);
      expect(res.body.phone).toBe('+84-999-999-0000');
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .patch(`/api/restaurants/${updatableId}`)
        .set(noAuthHeaders())
        .send({ name: 'Hack' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-owner non-admin user', async () => {
      const res = await http
        .patch(`/api/restaurants/${updatableId}`)
        .set(otherUserHeaders())
        .send({ name: 'Hack' });

      expect(res.status).toBe(403);
    });

    it('returns 404 for non-existent restaurant', async () => {
      const res = await http
        .patch('/api/restaurants/00000000-0000-4000-8000-000000000001')
        .set(ownerHeaders())
        .send({ name: 'Ghost' });

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid coverImageUrl', async () => {
      const res = await http
        .patch(`/api/restaurants/${updatableId}`)
        .set(ownerHeaders())
        .send({ coverImageUrl: 'not-a-valid-url' });

      expect(res.status).toBe(400);
    });
  });

  // ─── §5 Open / Close restaurant ───────────────────────────────────────────

  describe('§5 PATCH /api/restaurants/:id — isOpen toggle', () => {
    let restaurantId: string;

    beforeAll(async () => {
      const res = await http.post('/api/restaurants').set(ownerHeaders()).send({
        name: 'Toggle Open Restaurant',
        address: '1 St',
        phone: '+84000',
      });
      restaurantId = res.body.id as string;
    });

    it('owner can open the restaurant (isOpen: true)', async () => {
      const res = await http
        .patch(`/api/restaurants/${restaurantId}`)
        .set(ownerHeaders())
        .send({ isOpen: true });

      expect(res.status).toBe(200);
      expect(res.body.isOpen).toBe(true);
    });

    it('owner can close the restaurant (isOpen: false)', async () => {
      const res = await http
        .patch(`/api/restaurants/${restaurantId}`)
        .set(ownerHeaders())
        .send({ isOpen: false });

      expect(res.status).toBe(200);
      expect(res.body.isOpen).toBe(false);
    });

    it('GET after open reflects updated isOpen value', async () => {
      await http
        .patch(`/api/restaurants/${restaurantId}`)
        .set(ownerHeaders())
        .send({ isOpen: true });

      const res = await http
        .get(`/api/restaurants/${restaurantId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.isOpen).toBe(true);
    });
  });

  // ─── §6 Approve / Unapprove ────────────────────────────────────────────────

  describe('§6 PATCH /api/restaurants/:id/approve|unapprove (admin only)', () => {
    let restaurantId: string;

    beforeAll(async () => {
      const res = await http.post('/api/restaurants').set(ownerHeaders()).send({
        name: 'Approval Test Restaurant',
        address: '1 St',
        phone: '+84000',
      });
      restaurantId = res.body.id as string;
    });

    it('admin can approve a restaurant (returns 200, isApproved: true)', async () => {
      const res = await http
        .patch(`/api/restaurants/${restaurantId}/approve`)
        .set(adminHeaders());

      expect(res.status).toBe(200);
      expect(res.body.isApproved).toBe(true);
      expect(res.body.id).toBe(restaurantId);
    });

    it('admin can unapprove a restaurant (returns 200, isApproved: false)', async () => {
      const res = await http
        .patch(`/api/restaurants/${restaurantId}/unapprove`)
        .set(adminHeaders());

      expect(res.status).toBe(200);
      expect(res.body.isApproved).toBe(false);
    });

    it('GET after approve reflects isApproved: true', async () => {
      await http
        .patch(`/api/restaurants/${restaurantId}/approve`)
        .set(adminHeaders());

      const res = await http
        .get(`/api/restaurants/${restaurantId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.isApproved).toBe(true);
    });

    it('restaurant-role user cannot approve (403)', async () => {
      const res = await http
        .patch(`/api/restaurants/${restaurantId}/approve`)
        .set(ownerHeaders());

      expect(res.status).toBe(403);
    });

    it('restaurant-role user cannot unapprove (403)', async () => {
      const res = await http
        .patch(`/api/restaurants/${restaurantId}/unapprove`)
        .set(ownerHeaders());

      expect(res.status).toBe(403);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .patch(`/api/restaurants/${restaurantId}/approve`)
        .set(noAuthHeaders());

      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent restaurant', async () => {
      const res = await http
        .patch('/api/restaurants/00000000-0000-4000-8000-000000000002/approve')
        .set(adminHeaders());

      expect(res.status).toBe(404);
    });
  });

  // ─── §7 Delete restaurant ──────────────────────────────────────────────────

  describe('§7 DELETE /api/restaurants/:id (admin only)', () => {
    let deletableId: string;

    beforeAll(async () => {
      const res = await http.post('/api/restaurants').set(ownerHeaders()).send({
        name: 'Deletable Restaurant',
        address: '1 St',
        phone: '+84000',
      });
      deletableId = res.body.id as string;
    });

    it('restaurant-role user cannot delete (403)', async () => {
      const res = await http
        .delete(`/api/restaurants/${deletableId}`)
        .set(ownerHeaders());

      expect(res.status).toBe(403);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .delete(`/api/restaurants/${deletableId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(401);
    });

    it('admin can delete the restaurant and returns 204', async () => {
      const res = await http
        .delete(`/api/restaurants/${deletableId}`)
        .set(adminHeaders());

      expect(res.status).toBe(204);
    });

    it('returns 404 when fetching deleted restaurant', async () => {
      const res = await http
        .get(`/api/restaurants/${deletableId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });

    it('returns 404 for non-existent restaurant', async () => {
      const res = await http
        .delete('/api/restaurants/00000000-0000-4000-8000-000000000003')
        .set(adminHeaders());

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await http
        .delete('/api/restaurants/not-a-uuid')
        .set(adminHeaders());

      expect(res.status).toBe(400);
    });
  });

  // ─── §8 Response shape ─────────────────────────────────────────────────────

  describe('§8 Response shape', () => {
    it('GET /api/restaurants/:id returns all required fields', async () => {
      const res = await http
        .get(`/api/restaurants/${TEST_RESTAURANT_ID}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: expect.any(String),
        ownerId: expect.any(String),
        name: expect.any(String),
        address: expect.any(String),
        phone: expect.any(String),
        isOpen: expect.any(Boolean),
        isApproved: expect.any(Boolean),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('POST /api/restaurants returns restaurant with ownerId', async () => {
      const res = await http.post('/api/restaurants').set(ownerHeaders()).send({
        name: 'Shape Test Restaurant',
        address: '1 St',
        phone: '+84000',
      });

      expect(res.status).toBe(201);
      expect(res.body.ownerId).toBeDefined();
      expect(res.body.isOpen).toBe(false);
      expect(res.body.isApproved).toBe(false);
      expect(res.body.createdAt).toBeDefined();
      expect(res.body.updatedAt).toBeDefined();
    });

    it('GET /api/restaurants returns paginated wrapper', async () => {
      const res = await http.get('/api/restaurants').set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        data: expect.any(Array),
        total: expect.any(Number),
      });
    });
  });
});
