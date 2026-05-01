/**
 * menu.e2e-spec.ts
 *
 * End-to-end tests for menu item CRUD endpoints and edge-case snapshot behaviour.
 *
 * Covers:
 *   • POST   /api/menu-items                  — create a menu item
 *   • GET    /api/menu-items?restaurantId=...  — list by restaurant
 *   • GET    /api/menu-items/:id               — get one
 *   • PATCH  /api/menu-items/:id               — update
 *   • PATCH  /api/menu-items/:id/sold-out      — toggle sold-out
 *   • DELETE /api/menu-items/:id               — delete (marks snapshot unavailable)
 *
 *   Snapshot invariants (Section 5.1 from MENU_MODIFIER_API_TEST.md):
 *     • A newly created item has modifiers = [] in the snapshot (never null)
 *     • Updating price/name leaves modifiers = [] (not set to null)
 *
 *   Security (Sections 5.4 & 5.5):
 *     • Write endpoints require auth        → 401 when unauthenticated
 *     • Write endpoints require ownership   → 403 for non-owners
 */

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, teardownTestApp } from '../setup/app-factory';
import {
  resetDb,
  seedBaseRestaurant,
  TEST_RESTAURANT_ID,
} from '../setup/db-setup';
import { getSnapshot } from '../helpers/db';
import {
  setAuthManager,
  noAuthHeaders,
  otherUserHeaders,
  ownerHeaders,
} from '../helpers/auth';
import { TestAuthManager } from '../helpers/test-auth';

// ─────────────────────────────────────────────────────────────────────────────

describe('Menu Item CRUD (E2E)', () => {
  let app: INestApplication<App>;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());

    // 1. Clear all test data (users, snapshots, restaurants)
    await resetDb();

    // 2. Sign up test users and obtain real Bearer tokens
    const testAuth = new TestAuthManager();
    await testAuth.initialize(http);
    setAuthManager(testAuth);

    // 3. Seed the test restaurant with the owner's real UUID so that
    //    restaurant.ownerId === session.user.id for ownership checks
    await seedBaseRestaurant(testAuth.ownerUserId);
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  // ─── 1. Create ─────────────────────────────────────────────────────────────

  describe('POST /api/menu-items', () => {
    it('creates a menu item and returns 201 with the item', async () => {
      const res = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Margherita Pizza',
          price: 12.5,
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        restaurantId: TEST_RESTAURANT_ID,
        name: 'Margherita Pizza',
        price: 12.5,
        status: 'available',
      });
      expect(res.body.id).toBeDefined();
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .post('/api/menu-items')
        .set(noAuthHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Hack Item',
          price: 1,
        });

      expect(res.status).toBe(401);
    });

    it('returns 403 when authenticated user does not own the restaurant', async () => {
      const res = await http
        .post('/api/menu-items')
        .set(otherUserHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Intrusion Item',
          price: 1,
        });

      expect(res.status).toBe(403);
    });
  });

  // ─── 2. Read ───────────────────────────────────────────────────────────────

  describe('GET /api/menu-items', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Caesar Salad',
          price: 9.0,
        });
      itemId = res.body.id as string;
    });

    it('lists items by restaurantId (public)', async () => {
      const res = await http
        .get(`/api/menu-items?restaurantId=${TEST_RESTAURANT_ID}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const names = (res.body as { name: string }[]).map((i) => i.name);
      expect(names).toContain('Caesar Salad');
    });

    it('returns a single item by id (public)', async () => {
      const res = await http
        .get(`/api/menu-items/${itemId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(itemId);
      expect(res.body.name).toBe('Caesar Salad');
    });
  });

  // ─── 3. Update ─────────────────────────────────────────────────────────────

  describe('PATCH /api/menu-items/:id', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Tiramisu',
          price: 6.5,
        });
      itemId = res.body.id as string;
    });

    it('updates name and returns 200', async () => {
      const res = await http
        .patch(`/api/menu-items/${itemId}`)
        .set(ownerHeaders())
        .send({ name: 'Updated Tiramisu' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Tiramisu');
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .patch(`/api/menu-items/${itemId}`)
        .set(noAuthHeaders())
        .send({ name: 'Hack' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-owner', async () => {
      const res = await http
        .patch(`/api/menu-items/${itemId}`)
        .set(otherUserHeaders())
        .send({ name: 'Hack' });

      expect(res.status).toBe(403);
    });
  });

  // ─── 4. Toggle sold-out ────────────────────────────────────────────────────

  describe('PATCH /api/menu-items/:id/sold-out', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Burger',
          price: 10.0,
        });
      itemId = res.body.id as string;
    });

    it('toggles status to out_of_stock on first call', async () => {
      const res = await http
        .patch(`/api/menu-items/${itemId}/sold-out`)
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('out_of_stock');
    });

    it('toggles status back to available on second call', async () => {
      const res = await http
        .patch(`/api/menu-items/${itemId}/sold-out`)
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('available');
    });
  });

  // ─── 5. Delete ─────────────────────────────────────────────────────────────

  describe('DELETE /api/menu-items/:id', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Deletable Item',
          price: 5.0,
        });
      itemId = res.body.id as string;
    });

    it('deletes the item and returns 204', async () => {
      const res = await http
        .delete(`/api/menu-items/${itemId}`)
        .set(ownerHeaders());

      expect(res.status).toBe(204);
    });

    it('returns 404 when fetching the deleted item', async () => {
      const res = await http
        .get(`/api/menu-items/${itemId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });

    it('marks the ordering snapshot as unavailable with empty modifiers', async () => {
      const snapshot = await getSnapshot(itemId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.status).toBe('unavailable');
      expect(snapshot!.modifiers).toEqual([]);
    });
  });

  // ─── 6. Snapshot: null vs [] distinction (Section 5.1) ───────────────────

  describe('Snapshot null-vs-[] invariant', () => {
    let plainItemId: string;

    it('a newly created item (no modifier groups) has modifiers = [] in snapshot', async () => {
      const createRes = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Plain Item',
          price: 9.99,
        });
      expect(createRes.status).toBe(201);
      plainItemId = createRes.body.id as string;

      // Allow 100 ms for the async event handler (MenuItemProjector) to
      // complete its DB write before reading the snapshot.
      await new Promise((r) => setTimeout(r, 100));

      const snapshot = await getSnapshot(plainItemId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.modifiers).toEqual([]);
    });

    it('after a non-modifier update, modifiers remains [] (not null)', async () => {
      const patchRes = await http
        .patch(`/api/menu-items/${plainItemId}`)
        .set(ownerHeaders())
        .send({ price: 10.99 });
      expect(patchRes.status).toBe(200);

      // Allow 100 ms for the async event handler (MenuItemProjector) to
      // complete its DB write before reading the snapshot.
      await new Promise((r) => setTimeout(r, 100));

      const snapshot = await getSnapshot(plainItemId);
      expect(snapshot).not.toBeNull();
      // modifiers must still be an empty array — never null
      expect(snapshot!.modifiers).toEqual([]);
    });
  });
});
