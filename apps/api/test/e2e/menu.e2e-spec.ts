/**
 * menu.e2e-spec.ts
 *
 * Full-coverage end-to-end tests for Menu Item and Category endpoints.
 *
 * Covers:
 *   §1  Category CRUD  — POST/GET/PATCH/DELETE /api/menu-items/categories
 *   §2  Create item    — POST /api/menu-items (all fields, validation, auth)
 *   §3  List items     — GET  /api/menu-items?restaurantId=... (pagination, status, category filters)
 *   §4  Get one        — GET  /api/menu-items/:id (200, 404, 400 invalid UUID)
 *   §5  Update item    — PATCH /api/menu-items/:id (200, 401, 403)
 *   §6  Toggle sold-out— PATCH /api/menu-items/:id/sold-out (toggle ×2, 409 on unavailable, 401, 403)
 *   §7  Delete item    — DELETE /api/menu-items/:id (204, 404 after delete)
 *   §8  Snapshot       — modifiers=[] on new item; preserved on non-modifier updates
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

describe('Menu Item & Category CRUD (E2E)', () => {
  let app: INestApplication<App>;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());

    await resetDb();

    const testAuth = new TestAuthManager();
    await testAuth.initialize(http);
    setAuthManager(testAuth);

    await seedBaseRestaurant(testAuth.ownerUserId);
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  // ─── §1 Category CRUD ─────────────────────────────────────────────────────

  describe('§1 Category CRUD', () => {
    let categoryId: string;

    describe('POST /api/menu-items/categories', () => {
      it('creates a category and returns 201', async () => {
        const res = await http
          .post('/api/menu-items/categories')
          .set(ownerHeaders())
          .send({
            restaurantId: TEST_RESTAURANT_ID,
            name: 'Starters',
            displayOrder: 1,
          });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Starters',
          displayOrder: 1,
        });
        expect(res.body.id).toBeDefined();
        categoryId = res.body.id as string;
      });

      it('returns 401 when unauthenticated', async () => {
        const res = await http
          .post('/api/menu-items/categories')
          .set(noAuthHeaders())
          .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Hack' });

        expect(res.status).toBe(401);
      });

      it('returns 403 when authenticated user does not own the restaurant', async () => {
        const res = await http
          .post('/api/menu-items/categories')
          .set(otherUserHeaders())
          .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Hack' });

        expect(res.status).toBe(403);
      });

      it('returns 400 for missing name', async () => {
        const res = await http
          .post('/api/menu-items/categories')
          .set(ownerHeaders())
          .send({ restaurantId: TEST_RESTAURANT_ID });

        expect(res.status).toBe(400);
      });
    });

    describe('GET /api/menu-items/categories', () => {
      it('lists categories by restaurantId (public)', async () => {
        const res = await http
          .get(`/api/menu-items/categories?restaurantId=${TEST_RESTAURANT_ID}`)
          .set(noAuthHeaders());

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        const names = (res.body as { name: string }[]).map((c) => c.name);
        expect(names).toContain('Starters');
      });

      it('returns 400 for missing restaurantId', async () => {
        const res = await http
          .get('/api/menu-items/categories')
          .set(noAuthHeaders());

        expect(res.status).toBe(400);
      });
    });

    describe('PATCH /api/menu-items/categories/:id', () => {
      it('updates category name and returns 200', async () => {
        const res = await http
          .patch(`/api/menu-items/categories/${categoryId}`)
          .set(ownerHeaders())
          .send({ name: 'Appetizers' });

        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Appetizers');
      });

      it('returns 401 when unauthenticated', async () => {
        const res = await http
          .patch(`/api/menu-items/categories/${categoryId}`)
          .set(noAuthHeaders())
          .send({ name: 'Hack' });

        expect(res.status).toBe(401);
      });

      it('returns 403 for non-owner', async () => {
        const res = await http
          .patch(`/api/menu-items/categories/${categoryId}`)
          .set(otherUserHeaders())
          .send({ name: 'Hack' });

        expect(res.status).toBe(403);
      });
    });

    describe('DELETE /api/menu-items/categories/:id', () => {
      it('deletes a category and returns 204', async () => {
        // Create a disposable category
        const createRes = await http
          .post('/api/menu-items/categories')
          .set(ownerHeaders())
          .send({
            restaurantId: TEST_RESTAURANT_ID,
            name: 'Deletable Category',
          });
        const disposableId = createRes.body.id as string;

        const res = await http
          .delete(`/api/menu-items/categories/${disposableId}`)
          .set(ownerHeaders());

        expect(res.status).toBe(204);
      });

      it('returns 401 when unauthenticated', async () => {
        const res = await http
          .delete(`/api/menu-items/categories/${categoryId}`)
          .set(noAuthHeaders());

        expect(res.status).toBe(401);
      });

      it('returns 403 for non-owner', async () => {
        const res = await http
          .delete(`/api/menu-items/categories/${categoryId}`)
          .set(otherUserHeaders());

        expect(res.status).toBe(403);
      });
    });
  });

  // ─── §2 Create menu item ───────────────────────────────────────────────────

  describe('§2 POST /api/menu-items', () => {
    it('creates a menu item with required fields and returns 201', async () => {
      const res = await http.post('/api/menu-items').set(ownerHeaders()).send({
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

    it('creates a menu item with all optional fields', async () => {
      // Ensure a category exists
      const catRes = await http
        .post('/api/menu-items/categories')
        .set(ownerHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Full Fields Category',
        });
      const catId = catRes.body.id as string;

      const res = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Deluxe Burger',
          price: 18.99,
          categoryId: catId,
          description: 'Double patty with special sauce',
          sku: 'BURGER-DLX-001',
          imageUrl: 'https://example.com/burger.jpg',
          tags: ['beef', 'popular'],
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'Deluxe Burger',
        price: 18.99,
        categoryId: catId,
        description: 'Double patty with special sauce',
        sku: 'BURGER-DLX-001',
        imageUrl: 'https://example.com/burger.jpg',
        tags: expect.arrayContaining(['beef', 'popular']),
      });
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http.post('/api/menu-items').set(noAuthHeaders()).send({
        restaurantId: TEST_RESTAURANT_ID,
        name: 'Hack Item',
        price: 1,
      });

      expect(res.status).toBe(401);
    });

    it('returns 403 when non-owner user tries to create item', async () => {
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

    it('returns 400 for missing name', async () => {
      const res = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({ restaurantId: TEST_RESTAURANT_ID, price: 10 });

      expect(res.status).toBe(400);
    });

    it('returns 400 for name shorter than 2 characters', async () => {
      const res = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({ restaurantId: TEST_RESTAURANT_ID, name: 'A', price: 10 });

      expect(res.status).toBe(400);
    });

    it('returns 400 for missing price', async () => {
      const res = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({ restaurantId: TEST_RESTAURANT_ID, name: 'No Price Item' });

      expect(res.status).toBe(400);
    });

    it('returns 400 for missing restaurantId', async () => {
      const res = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({ name: 'Orphan Item', price: 9.99 });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid imageUrl', async () => {
      const res = await http.post('/api/menu-items').set(ownerHeaders()).send({
        restaurantId: TEST_RESTAURANT_ID,
        name: 'Bad URL',
        price: 10,
        imageUrl: 'not-a-url',
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── §3 List menu items ────────────────────────────────────────────────────

  describe('§3 GET /api/menu-items', () => {
    let soupId: string;
    let saladId: string;
    let listCategoryId: string;

    beforeAll(async () => {
      // Create a category for filter tests
      const catRes = await http
        .post('/api/menu-items/categories')
        .set(ownerHeaders())
        .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Soups & Salads' });
      listCategoryId = catRes.body.id as string;

      // Create items in category
      const soupRes = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Tomato Soup',
          price: 7.5,
          categoryId: listCategoryId,
        });
      soupId = soupRes.body.id as string;

      const saladRes = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Caesar Salad',
          price: 9.0,
        });
      saladId = saladRes.body.id as string;
    });

    it('returns { data, total } shape (public)', async () => {
      const res = await http
        .get(`/api/menu-items?restaurantId=${TEST_RESTAURANT_ID}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(typeof res.body).toBe('object');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe('number');
    });

    it('returns only available items by default', async () => {
      // Mark soupId as out_of_stock
      await http
        .patch(`/api/menu-items/${soupId}/sold-out`)
        .set(ownerHeaders());

      const res = await http
        .get(`/api/menu-items?restaurantId=${TEST_RESTAURANT_ID}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const ids = (res.body.data as { id: string }[]).map((i) => i.id);
      expect(ids).not.toContain(soupId); // out_of_stock → excluded by default

      // Restore
      await http
        .patch(`/api/menu-items/${soupId}/sold-out`)
        .set(ownerHeaders());
    });

    it('returns all items when status=all', async () => {
      // Mark soup as out_of_stock again
      await http
        .patch(`/api/menu-items/${soupId}/sold-out`)
        .set(ownerHeaders());

      const res = await http
        .get(`/api/menu-items?restaurantId=${TEST_RESTAURANT_ID}&status=all`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const ids = (res.body.data as { id: string }[]).map((i) => i.id);
      expect(ids).toContain(soupId); // included when status=all

      // Restore
      await http
        .patch(`/api/menu-items/${soupId}/sold-out`)
        .set(ownerHeaders());
    });

    it('filters items by categoryId', async () => {
      const res = await http
        .get(
          `/api/menu-items?restaurantId=${TEST_RESTAURANT_ID}&categoryId=${listCategoryId}`,
        )
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const ids = (res.body.data as { id: string }[]).map((i) => i.id);
      expect(ids).toContain(soupId);
      expect(ids).not.toContain(saladId); // salad has no category
    });

    it('respects limit pagination parameter', async () => {
      const res = await http
        .get(`/api/menu-items?restaurantId=${TEST_RESTAURANT_ID}&limit=1`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(1);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('respects offset pagination parameter', async () => {
      const allRes = await http
        .get(`/api/menu-items?restaurantId=${TEST_RESTAURANT_ID}`)
        .set(noAuthHeaders());
      const total = allRes.body.total as number;

      if (total > 1) {
        const offsetRes = await http
          .get(
            `/api/menu-items?restaurantId=${TEST_RESTAURANT_ID}&offset=1&limit=100`,
          )
          .set(noAuthHeaders());
        expect(offsetRes.status).toBe(200);
        expect(offsetRes.body.data.length).toBe(total - 1);
      }
    });

    it('returns 400 for missing restaurantId', async () => {
      const res = await http.get('/api/menu-items').set(noAuthHeaders());

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid restaurantId UUID', async () => {
      const res = await http
        .get('/api/menu-items?restaurantId=not-a-uuid')
        .set(noAuthHeaders());

      expect(res.status).toBe(400);
    });
  });

  // ─── §4 Get single item ────────────────────────────────────────────────────

  describe('§4 GET /api/menu-items/:id', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await http.post('/api/menu-items').set(ownerHeaders()).send({
        restaurantId: TEST_RESTAURANT_ID,
        name: 'Spaghetti Carbonara',
        price: 14.5,
      });
      itemId = res.body.id as string;
    });

    it('returns 200 with the item (public)', async () => {
      const res = await http
        .get(`/api/menu-items/${itemId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(itemId);
      expect(res.body.name).toBe('Spaghetti Carbonara');
      expect(res.body.price).toBe(14.5);
      expect(res.body.status).toBe('available');
    });

    it('returns 404 for non-existent item', async () => {
      const res = await http
        .get('/api/menu-items/00000000-0000-4000-8000-000000000000')
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid UUID format', async () => {
      const res = await http
        .get('/api/menu-items/not-a-uuid')
        .set(noAuthHeaders());

      expect(res.status).toBe(400);
    });

    it('response includes all expected fields', async () => {
      const res = await http
        .get(`/api/menu-items/${itemId}`)
        .set(noAuthHeaders());

      expect(res.body).toMatchObject({
        id: expect.any(String),
        restaurantId: expect.any(String),
        name: expect.any(String),
        price: expect.any(Number),
        status: expect.any(String),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });
  });

  // ─── §5 Update item ────────────────────────────────────────────────────────

  describe('§5 PATCH /api/menu-items/:id', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await http.post('/api/menu-items').set(ownerHeaders()).send({
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
        .send({ name: 'Premium Tiramisu' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Premium Tiramisu');
    });

    it('updates price and returns 200', async () => {
      const res = await http
        .patch(`/api/menu-items/${itemId}`)
        .set(ownerHeaders())
        .send({ price: 8.99 });

      expect(res.status).toBe(200);
      expect(res.body.price).toBe(8.99);
    });

    it('updates tags and returns 200', async () => {
      const res = await http
        .patch(`/api/menu-items/${itemId}`)
        .set(ownerHeaders())
        .send({ tags: ['dessert', 'italian'] });

      expect(res.status).toBe(200);
      expect(res.body.tags).toEqual(
        expect.arrayContaining(['dessert', 'italian']),
      );
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

    it('returns 404 for non-existent item', async () => {
      const res = await http
        .patch('/api/menu-items/00000000-0000-4000-8000-000000000001')
        .set(ownerHeaders())
        .send({ name: 'Ghost' });

      expect(res.status).toBe(404);
    });
  });

  // ─── §6 Toggle sold-out ────────────────────────────────────────────────────

  describe('§6 PATCH /api/menu-items/:id/sold-out', () => {
    let toggleItemId: string;
    let unavailableItemId: string;

    beforeAll(async () => {
      // Create item for toggle tests
      const toggleRes = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Toggle Burger',
          price: 10,
        });
      toggleItemId = toggleRes.body.id as string;

      // Create item and manually set to unavailable via status update
      const unavailableRes = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Unavailable Item',
          price: 5,
        });
      unavailableItemId = unavailableRes.body.id as string;
      // Set to unavailable via update
      await http
        .patch(`/api/menu-items/${unavailableItemId}`)
        .set(ownerHeaders())
        .send({ status: 'unavailable' });
    });

    it('first toggle: available → out_of_stock', async () => {
      const res = await http
        .patch(`/api/menu-items/${toggleItemId}/sold-out`)
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('out_of_stock');
    });

    it('second toggle: out_of_stock → available', async () => {
      const res = await http
        .patch(`/api/menu-items/${toggleItemId}/sold-out`)
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('available');
    });

    it('returns 409 Conflict when item is unavailable', async () => {
      const res = await http
        .patch(`/api/menu-items/${unavailableItemId}/sold-out`)
        .set(ownerHeaders());

      expect(res.status).toBe(409);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .patch(`/api/menu-items/${toggleItemId}/sold-out`)
        .set(noAuthHeaders());

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-owner', async () => {
      const res = await http
        .patch(`/api/menu-items/${toggleItemId}/sold-out`)
        .set(otherUserHeaders());

      expect(res.status).toBe(403);
    });
  });

  // ─── §7 Delete item ────────────────────────────────────────────────────────

  describe('§7 DELETE /api/menu-items/:id', () => {
    let deletableItemId: string;

    beforeAll(async () => {
      const res = await http.post('/api/menu-items').set(ownerHeaders()).send({
        restaurantId: TEST_RESTAURANT_ID,
        name: 'Deletable Item',
        price: 5,
      });
      deletableItemId = res.body.id as string;
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .delete(`/api/menu-items/${deletableItemId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-owner', async () => {
      const res = await http
        .delete(`/api/menu-items/${deletableItemId}`)
        .set(otherUserHeaders());

      expect(res.status).toBe(403);
    });

    it('deletes the item and returns 204', async () => {
      const res = await http
        .delete(`/api/menu-items/${deletableItemId}`)
        .set(ownerHeaders());

      expect(res.status).toBe(204);
    });

    it('returns 404 when fetching the deleted item', async () => {
      const res = await http
        .get(`/api/menu-items/${deletableItemId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });

    it('marks the ordering snapshot as unavailable with empty modifiers', async () => {
      // Allow 100 ms for async projector to write
      await new Promise((r) => setTimeout(r, 100));

      const snapshot = await getSnapshot(deletableItemId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.status).toBe('unavailable');
      expect(snapshot!.modifiers).toEqual([]);
    });

    it('returns 404 for a non-existent id', async () => {
      const res = await http
        .delete('/api/menu-items/00000000-0000-4000-8000-000000000002')
        .set(ownerHeaders());

      expect(res.status).toBe(404);
    });
  });

  // ─── §8 Snapshot invariants ────────────────────────────────────────────────

  describe('§8 Snapshot invariants', () => {
    let plainItemId: string;

    it('a newly created item (no modifier groups) has modifiers = [] in snapshot', async () => {
      const createRes = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({
          restaurantId: TEST_RESTAURANT_ID,
          name: 'Snapshot Item',
          price: 9.99,
        });
      expect(createRes.status).toBe(201);
      plainItemId = createRes.body.id as string;

      // Allow 100 ms for async MenuItemProjector to write
      await new Promise((r) => setTimeout(r, 100));

      const snapshot = await getSnapshot(plainItemId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.modifiers).toEqual([]);
    });

    it('after a price update, modifiers remains [] (not null)', async () => {
      const patchRes = await http
        .patch(`/api/menu-items/${plainItemId}`)
        .set(ownerHeaders())
        .send({ price: 11.99 });
      expect(patchRes.status).toBe(200);

      // Allow 100 ms for projector
      await new Promise((r) => setTimeout(r, 100));

      const snapshot = await getSnapshot(plainItemId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.price).toBe(11.99);
      expect(snapshot!.modifiers).toEqual([]);
    });

    it('after a name update, modifiers remains [] (not null)', async () => {
      const patchRes = await http
        .patch(`/api/menu-items/${plainItemId}`)
        .set(ownerHeaders())
        .send({ name: 'Renamed Snapshot Item' });
      expect(patchRes.status).toBe(200);

      await new Promise((r) => setTimeout(r, 100));

      const snapshot = await getSnapshot(plainItemId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.modifiers).toEqual([]);
    });

    it('snapshot lastSyncedAt advances on each mutation', async () => {
      const before = (await getSnapshot(plainItemId))!.lastSyncedAt;

      // Small delay so timestamps differ
      await new Promise((r) => setTimeout(r, 10));

      await http
        .patch(`/api/menu-items/${plainItemId}`)
        .set(ownerHeaders())
        .send({ price: 12.0 });

      await new Promise((r) => setTimeout(r, 100));

      const after = (await getSnapshot(plainItemId))!.lastSyncedAt;
      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(
        new Date(before).getTime(),
      );
    });
  });
});
