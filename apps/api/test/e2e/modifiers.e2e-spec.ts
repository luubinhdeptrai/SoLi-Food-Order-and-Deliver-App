/**
 * modifiers.e2e-spec.ts
 *
 * End-to-end tests for modifier-group and modifier-option endpoints.
 *
 * Covers (mapped to MENU_MODIFIER_API_TEST.md):
 *
 *   Section 3 — Modifier Group & Option CRUD
 *     3.1  POST   modifier group → 201
 *     3.2  PATCH  modifier group — valid min/max → 200
 *     3.3  PATCH  modifier group — invalid min > max → 400
 *     3.4  PATCH  modifier group — partial update (only maxSelections) → 200
 *     3.5  DELETE modifier group → 204; cascade-deletes options
 *     3.6  POST   modifier option → 201
 *     3.7  PATCH  modifier option → 200
 *     3.8  DELETE modifier option → 204
 *
 *   Section 4 — New GET Endpoints
 *     4.1  GET  :menuItemId/modifier-groups/:groupId → 200 with options
 *     4.2  GET  :menuItemId/modifier-groups/:groupId/options → 200 flat array
 *     4.3  GET  :menuItemId/modifier-groups/:groupId/options/:optionId → 200
 *     4.4  GET  — wrong menuItemId → 404
 *     4.5  GET  — wrong groupId for optionId → 404
 *
 *   Section 5 — Edge Cases
 *     5.2  min > max on create → 400
 *     5.2  min = max = 0 → 201 (valid)
 *     5.3  group with zero options → snapshot has "options": []
 *     5.4  unauthenticated write → 401
 *     5.5  write by non-owner → 403
 *     5.6  ParseUUID guard — "options" literal as groupId → 400
 */

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  teardownTestApp,
} from '../setup/app-factory';
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

describe('Modifier Group & Option CRUD (E2E)', () => {
  let app: INestApplication<App>;
  let http: ReturnType<typeof request>;

  /** Menu item created in beforeAll; used across all nested describe blocks. */
  let menuItemId: string;

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());

    // 1. Clear all test data (users, snapshots, restaurants)
    await resetDb();

    // 2. Sign up test users and obtain real Bearer tokens
    const testAuth = new TestAuthManager();
    await testAuth.initialize(http);
    setAuthManager(testAuth);

    // 3. Seed the test restaurant with the owner's real UUID
    await seedBaseRestaurant(testAuth.ownerUserId);

    // Create the menu item used throughout this spec
    const itemRes = await http
      .post('/api/menu-items')
      .set(ownerHeaders())
      .send({
        restaurantId: TEST_RESTAURANT_ID,
        name: 'Modifier Test Item',
        price: 12.5,
      });
    expect(itemRes.status).toBe(201);
    menuItemId = itemRes.body.id as string;
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  // ─── Section 3.1–3.5: Modifier group CRUD ─────────────────────────────────

  describe('POST :menuItemId/modifier-groups (create group)', () => {
    it('3.1 — creates a modifier group and returns 201', async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({
          name: 'Spice Level',
          minSelections: 0,
          maxSelections: 1,
          displayOrder: 1,
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        menuItemId,
        name: 'Spice Level',
        minSelections: 0,
        maxSelections: 1,
      });
      expect(res.body.id).toBeDefined();
    });
  });

  describe('PATCH :menuItemId/modifier-groups/:groupId (update group)', () => {
    let groupId: string;

    beforeAll(async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Size', minSelections: 1, maxSelections: 1 });
      groupId = res.body.id as string;
    });

    it('3.2 — updates with valid min/max and returns 200', async () => {
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
        .set(ownerHeaders())
        .send({ minSelections: 1, maxSelections: 3 });

      expect(res.status).toBe(200);
      expect(res.body.minSelections).toBe(1);
      expect(res.body.maxSelections).toBe(3);
    });

    it('3.3 — rejects min > current max with 400', async () => {
      // currentMax = 3 from previous test; sending minSelections = 10 must fail
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
        .set(ownerHeaders())
        .send({ minSelections: 10 });

      expect(res.status).toBe(400);
    });

    it('3.4 — partial update (only maxSelections) preserves minSelections', async () => {
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
        .set(ownerHeaders())
        .send({ maxSelections: 2 });

      expect(res.status).toBe(200);
      expect(res.body.maxSelections).toBe(2);
      // minSelections must remain 1 (unchanged)
      expect(res.body.minSelections).toBe(1);
    });
  });

  describe('DELETE :menuItemId/modifier-groups/:groupId', () => {
    let groupId: string;
    let optionId: string;

    beforeAll(async () => {
      // Create a group
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Toppings', minSelections: 0, maxSelections: 3 });
      groupId = gRes.body.id as string;

      // Add an option so the cascade is exercised
      const oRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`)
        .set(ownerHeaders())
        .send({ name: 'Extra Cheese', price: 1.0 });
      optionId = oRes.body.id as string;
    });

    it('3.5 — deletes the group and returns 204', async () => {
      const res = await http
        .delete(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
        .set(ownerHeaders());

      expect(res.status).toBe(204);
    });

    it('cascade-deletes the option (GET option returns 404)', async () => {
      const res = await http
        .get(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
        )
        .set(noAuthHeaders());

      // group is gone so 404 is expected
      expect(res.status).toBe(404);
    });

    it('snapshot no longer contains the deleted group', async () => {
      const snapshot = await getSnapshot(menuItemId);
      expect(snapshot).not.toBeNull();
      const groupIds = (snapshot!.modifiers as { groupId: string }[]).map(
        (g) => g.groupId,
      );
      expect(groupIds).not.toContain(groupId);
    });
  });

  // ─── Section 3.6–3.8: Modifier option CRUD ────────────────────────────────

  describe('Modifier option CRUD (3.6–3.8)', () => {
    let groupId: string;
    let optionId: string;

    beforeAll(async () => {
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Drink Size', minSelections: 1, maxSelections: 1 });
      groupId = gRes.body.id as string;
    });

    it('3.6 — creates an option and returns 201', async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`)
        .set(ownerHeaders())
        .send({ name: 'Medium', price: 2.5, isDefault: false, displayOrder: 1 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        groupId,
        name: 'Medium',
        price: 2.5,
      });
      optionId = res.body.id as string;
    });

    it('3.7 — updates option price and availability', async () => {
      const res = await http
        .patch(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
        )
        .set(ownerHeaders())
        .send({ price: 3.0, isAvailable: false });

      expect(res.status).toBe(200);
      expect(res.body.price).toBe(3);
      expect(res.body.isAvailable).toBe(false);
    });

    it('snapshot reflects updated option price', async () => {
      const snapshot = await getSnapshot(menuItemId);
      expect(snapshot).not.toBeNull();
      const group = (
        snapshot!.modifiers as { groupId: string; options: { optionId: string; price: number }[] }[]
      ).find((g) => g.groupId === groupId);
      expect(group).toBeDefined();
      const option = group!.options.find((o) => o.optionId === optionId);
      expect(option).toBeDefined();
      expect(option!.price).toBe(3);
    });

    it('3.8 — deletes option and returns 204', async () => {
      const res = await http
        .delete(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
        )
        .set(ownerHeaders());

      expect(res.status).toBe(204);
    });
  });

  // ─── Section 4: New GET endpoints ─────────────────────────────────────────

  describe('GET endpoints (Section 4)', () => {
    let groupId: string;
    let optionId: string;

    beforeAll(async () => {
      // Create a fresh group with two options for GET tests
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Temperature', minSelections: 1, maxSelections: 1 });
      groupId = gRes.body.id as string;

      await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`)
        .set(ownerHeaders())
        .send({ name: 'Hot', price: 0, isDefault: true });

      const coldRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`)
        .set(ownerHeaders())
        .send({ name: 'Iced', price: 0.5 });
      optionId = coldRes.body.id as string;
    });

    it('4.1 — GET single group includes embedded options (public)', async () => {
      const res = await http
        .get(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(groupId);
      expect(res.body.menuItemId).toBe(menuItemId);
      expect(res.body.name).toBe('Temperature');
      expect(Array.isArray(res.body.options)).toBe(true);
      expect(res.body.options.length).toBeGreaterThanOrEqual(2);
    });

    it('4.2 — GET options list returns a flat array (public)', async () => {
      const res = await http
        .get(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const names = (res.body as { name: string }[]).map((o) => o.name);
      expect(names).toContain('Hot');
      expect(names).toContain('Iced');
    });

    it('4.3 — GET single option returns correct shape (public)', async () => {
      const res = await http
        .get(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
        )
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(optionId);
      expect(res.body.groupId).toBe(groupId);
      expect(res.body.name).toBe('Iced');
    });

    it('4.4 — GET group with wrong menuItemId returns 404', async () => {
      const wrongItemId = '99999999-9999-4999-8999-999999999999';
      const res = await http
        .get(`/api/menu-items/${wrongItemId}/modifier-groups/${groupId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });

    it('4.5 — GET option with wrong groupId returns 404', async () => {
      const wrongGroupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const res = await http
        .get(
          `/api/menu-items/${menuItemId}/modifier-groups/${wrongGroupId}/options/${optionId}`,
        )
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });
  });

  // ─── Section 5.2: min/max edge cases on create ────────────────────────────

  describe('min/max validation on create (Section 5.2)', () => {
    it('5.2a — min=0, max=0 is accepted (optional group)', async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({
          name: 'Optional Note',
          minSelections: 0,
          maxSelections: 0,
        });

      expect(res.status).toBe(201);
    });

    it('5.2b — min=2, max=1 is rejected with 400', async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({
          name: 'Bad Group',
          minSelections: 2,
          maxSelections: 1,
        });

      expect(res.status).toBe(400);
    });
  });

  // ─── Section 5.3: group with zero options ─────────────────────────────────

  describe('Snapshot with zero-option group (Section 5.3)', () => {
    it('5.3 — snapshot contains the empty group with options: []', async () => {
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Empty Group', minSelections: 0, maxSelections: 1 });
      expect(gRes.status).toBe(201);
      const emptyGroupId = gRes.body.id as string;

      // Allow 100 ms for the async event handler (MenuItemProjector) to
      // complete its DB write before reading the snapshot.
      await new Promise((r) => setTimeout(r, 100));

      const snapshot = await getSnapshot(menuItemId);
      expect(snapshot).not.toBeNull();
      const emptyGroup = (
        snapshot!.modifiers as { groupId: string; options: unknown[] }[]
      ).find((g) => g.groupId === emptyGroupId);
      expect(emptyGroup).toBeDefined();
      expect(emptyGroup!.options).toEqual([]);
    });
  });

  // ─── Section 5.4: unauthenticated writes ──────────────────────────────────

  describe('Unauthenticated write attempts (Section 5.4)', () => {
    it('5.4 — POST group without auth returns 401', async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(noAuthHeaders())
        .send({ name: 'Hack Group' });

      expect(res.status).toBe(401);
    });

    it('5.4 — PATCH group without auth returns 401', async () => {
      // We need any groupId; use a random UUID — guard fires before DB lookup
      const fakeGroupId = '12345678-1234-4123-8123-123456789012';
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/modifier-groups/${fakeGroupId}`)
        .set(noAuthHeaders())
        .send({ name: 'Hack' });

      expect(res.status).toBe(401);
    });
  });

  // ─── Section 5.5: write by non-owner ──────────────────────────────────────

  describe('Non-owner write attempt (Section 5.5)', () => {
    it('5.5 — POST group by non-owner returns 403', async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(otherUserHeaders())
        .send({ name: 'Intrusion Group' });

      expect(res.status).toBe(403);
    });
  });

  // ─── Section 5.6: ParseUUID guard for "options" literal ───────────────────

  describe('ParseUUID guard (Section 5.6)', () => {
    it('5.6 — GET .../modifier-groups/options rejects non-UUID groupId with 400', async () => {
      const res = await http
        .get(`/api/menu-items/${menuItemId}/modifier-groups/options`)
        .set(noAuthHeaders());

      // "options" is not a valid UUID → ParseUUIDPipe returns 400
      expect(res.status).toBe(400);
    });
  });
});
