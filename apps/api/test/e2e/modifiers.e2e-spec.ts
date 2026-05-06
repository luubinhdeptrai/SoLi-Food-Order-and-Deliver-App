/**
 * modifiers.e2e-spec.ts
 *
 * Full-coverage end-to-end tests for Modifier Group and Option endpoints.
 *
 * Covers:
 *   §1  Create group   — POST .../modifier-groups (201, auth, min>max validation)
 *   §2  List groups    — GET  .../modifier-groups (200 with embedded options, public)
 *   §3  Get group      — GET  .../modifier-groups/:groupId (200, 404 wrong menuItemId)
 *   §4  Update group   — PATCH .../modifier-groups/:groupId (valid, min>max rejected, partial)
 *   §5  Delete group   — DELETE .../modifier-groups/:groupId (204, cascades options)
 *   §6  Create option  — POST .../options (201, auth, 403)
 *   §7  List options   — GET  .../options (flat array, public)
 *   §8  Get option     — GET  .../options/:optionId (200, 404 wrong groupId)
 *   §9  Update option  — PATCH .../options/:optionId (200, price+availability)
 *   §10 Delete option  — DELETE .../options/:optionId (204)
 *   §11 min/max edge cases — 0/0 accepted; 2/1 rejected; update triggers merged validation
 *   §12 Snapshot invariants — empty group, option count, snapshot reflects mutations
 *   §13 Security       — 401 unauthenticated; 403 non-owner
 *   §14 ParseUUID guard — "options" literal as groupId → 400
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
import type { MenuItemModifierSnapshot } from '../../src/shared/events/menu-item-updated.event';

// ─────────────────────────────────────────────────────────────────────────────

describe('Modifier Group & Option CRUD (E2E)', () => {
  let app: INestApplication<App>;
  let http: ReturnType<typeof request>;

  /** Menu item created in the outer beforeAll — shared across all sections. */
  let menuItemId: string;

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());

    await resetDb();

    const testAuth = new TestAuthManager();
    await testAuth.initialize(http);
    setAuthManager(testAuth);

    await seedBaseRestaurant(testAuth.ownerUserId);

    // Create the shared menu item used throughout this spec
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

  // ─── §1 Create modifier group ──────────────────────────────────────────────

  describe('§1 POST .../modifier-groups', () => {
    it('creates a group with all fields and returns 201', async () => {
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
        displayOrder: 1,
      });
      expect(res.body.id).toBeDefined();
    });

    it('creates a group with only required fields (defaults applied)', async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Minimal Group' });

      expect(res.status).toBe(201);
      expect(res.body.minSelections).toBe(0);
      expect(res.body.maxSelections).toBe(1);
      expect(res.body.displayOrder).toBe(0);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(noAuthHeaders())
        .send({ name: 'Hack Group' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-owner', async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(otherUserHeaders())
        .send({ name: 'Intrusion Group' });

      expect(res.status).toBe(403);
    });

    it('returns 400 for missing name', async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ minSelections: 0, maxSelections: 1 });

      expect(res.status).toBe(400);
    });

    it('returns 400 when min > max on create', async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Bad Group', minSelections: 2, maxSelections: 1 });

      expect(res.status).toBe(400);
    });
  });

  // ─── §2 List modifier groups ───────────────────────────────────────────────

  describe('§2 GET .../modifier-groups', () => {
    let listedGroupId: string;

    beforeAll(async () => {
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Sauce', minSelections: 0, maxSelections: 2 });
      listedGroupId = gRes.body.id as string;

      // Add an option to verify embedded options in list
      await http
        .post(
          `/api/menu-items/${menuItemId}/modifier-groups/${listedGroupId}/options`,
        )
        .set(ownerHeaders())
        .send({ name: 'Ketchup', price: 0 });
    });

    it('returns all groups with embedded options (public)', async () => {
      const res = await http
        .get(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const sauce = (res.body as { id: string; options: unknown[] }[]).find(
        (g) => g.id === listedGroupId,
      );
      expect(sauce).toBeDefined();
      expect(Array.isArray(sauce!.options)).toBe(true);
      expect(sauce!.options.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 404 for non-existent menuItemId', async () => {
      const res = await http
        .get(
          '/api/menu-items/99999999-9999-4999-8999-999999999999/modifier-groups',
        )
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });
  });

  // ─── §3 Get single modifier group ─────────────────────────────────────────

  describe('§3 GET .../modifier-groups/:groupId', () => {
    let groupId: string;
    let optionId: string;

    beforeAll(async () => {
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Temperature', minSelections: 1, maxSelections: 1 });
      groupId = gRes.body.id as string;

      const oRes = await http
        .post(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`,
        )
        .set(ownerHeaders())
        .send({ name: 'Hot', price: 0, isDefault: true });
      optionId = oRes.body.id as string;
    });

    it('returns 200 with embedded options (public)', async () => {
      const res = await http
        .get(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(groupId);
      expect(res.body.menuItemId).toBe(menuItemId);
      expect(res.body.name).toBe('Temperature');
      expect(Array.isArray(res.body.options)).toBe(true);
      const hotOption = (res.body.options as { id: string }[]).find(
        (o) => o.id === optionId,
      );
      expect(hotOption).toBeDefined();
    });

    it('returns 404 for wrong menuItemId', async () => {
      const wrongItemId = '88888888-8888-4888-8888-888888888888';
      const res = await http
        .get(`/api/menu-items/${wrongItemId}/modifier-groups/${groupId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });

    it('returns 404 for non-existent groupId', async () => {
      const res = await http
        .get(
          `/api/menu-items/${menuItemId}/modifier-groups/00000000-0000-4000-8000-000000000003`,
        )
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });
  });

  // ─── §4 Update modifier group ──────────────────────────────────────────────

  describe('§4 PATCH .../modifier-groups/:groupId', () => {
    let groupId: string;

    beforeAll(async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Size', minSelections: 1, maxSelections: 1 });
      groupId = res.body.id as string;
    });

    it('updates with valid min/max and returns 200', async () => {
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
        .set(ownerHeaders())
        .send({ minSelections: 1, maxSelections: 3 });

      expect(res.status).toBe(200);
      expect(res.body.minSelections).toBe(1);
      expect(res.body.maxSelections).toBe(3);
    });

    it('partial update of only maxSelections preserves minSelections', async () => {
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
        .set(ownerHeaders())
        .send({ maxSelections: 2 });

      expect(res.status).toBe(200);
      expect(res.body.maxSelections).toBe(2);
      expect(res.body.minSelections).toBe(1); // unchanged
    });

    it('rejects update that would make min > current max (400)', async () => {
      // Current: min=1, max=2 — sending min=10 would make 10 > 2
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
        .set(ownerHeaders())
        .send({ minSelections: 10 });

      expect(res.status).toBe(400);
    });

    it('updates name only', async () => {
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
        .set(ownerHeaders())
        .send({ name: 'Drink Size' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Drink Size');
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
        .set(noAuthHeaders())
        .send({ name: 'Hack' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-owner', async () => {
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
        .set(otherUserHeaders())
        .send({ name: 'Hack' });

      expect(res.status).toBe(403);
    });
  });

  // ─── §5 Delete modifier group ──────────────────────────────────────────────

  describe('§5 DELETE .../modifier-groups/:groupId', () => {
    let groupId: string;
    let optionId: string;

    beforeAll(async () => {
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Toppings', minSelections: 0, maxSelections: 3 });
      groupId = gRes.body.id as string;

      const oRes = await http
        .post(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`,
        )
        .set(ownerHeaders())
        .send({ name: 'Extra Cheese', price: 1.0 });
      optionId = oRes.body.id as string;
    });

    it('returns 401 when unauthenticated', async () => {
      const fakeGroupId = '12345678-1234-4123-8123-123456789012';
      const res = await http
        .delete(`/api/menu-items/${menuItemId}/modifier-groups/${fakeGroupId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-owner', async () => {
      const res = await http
        .delete(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
        .set(otherUserHeaders());

      expect(res.status).toBe(403);
    });

    it('deletes the group and returns 204', async () => {
      const res = await http
        .delete(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}`)
        .set(ownerHeaders());

      expect(res.status).toBe(204);
    });

    it('cascade-deletes options (GET option returns 404)', async () => {
      const res = await http
        .get(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
        )
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });

    it('snapshot no longer contains the deleted group', async () => {
      await new Promise((r) => setTimeout(r, 100));

      const snapshot = await getSnapshot(menuItemId);
      expect(snapshot).not.toBeNull();
      const groupIds = (snapshot!.modifiers as { groupId: string }[]).map(
        (g) => g.groupId,
      );
      expect(groupIds).not.toContain(groupId);
    });
  });

  // ─── §6 Create modifier option ─────────────────────────────────────────────

  describe('§6 POST .../modifier-groups/:groupId/options', () => {
    let groupId: string;

    beforeAll(async () => {
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Drinks', minSelections: 1, maxSelections: 1 });
      groupId = gRes.body.id as string;
    });

    it('creates an option with all fields and returns 201', async () => {
      const res = await http
        .post(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`,
        )
        .set(ownerHeaders())
        .send({
          name: 'Cola',
          price: 2.5,
          isDefault: false,
          displayOrder: 1,
          isAvailable: true,
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        groupId,
        name: 'Cola',
        price: 2.5,
        isDefault: false,
        displayOrder: 1,
        isAvailable: true,
      });
      expect(res.body.id).toBeDefined();
    });

    it('creates an option with defaults applied', async () => {
      const res = await http
        .post(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`,
        )
        .set(ownerHeaders())
        .send({ name: 'Water' });

      expect(res.status).toBe(201);
      expect(res.body.price).toBe(0);
      expect(res.body.isDefault).toBe(false);
      expect(res.body.displayOrder).toBe(0);
      expect(res.body.isAvailable).toBe(true);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .post(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`,
        )
        .set(noAuthHeaders())
        .send({ name: 'Hack' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-owner', async () => {
      const res = await http
        .post(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`,
        )
        .set(otherUserHeaders())
        .send({ name: 'Hack' });

      expect(res.status).toBe(403);
    });

    it('returns 400 for missing name', async () => {
      const res = await http
        .post(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`,
        )
        .set(ownerHeaders())
        .send({ price: 1.0 });

      expect(res.status).toBe(400);
    });
  });

  // ─── §7 List modifier options ──────────────────────────────────────────────

  describe('§7 GET .../modifier-groups/:groupId/options', () => {
    let groupId: string;

    beforeAll(async () => {
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Pasta Type', minSelections: 1, maxSelections: 1 });
      groupId = gRes.body.id as string;

      await http
        .post(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`,
        )
        .set(ownerHeaders())
        .send({ name: 'Spaghetti', price: 0, isDefault: true });
      await http
        .post(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`,
        )
        .set(ownerHeaders())
        .send({ name: 'Penne', price: 0.5 });
    });

    it('returns a flat array of options (public)', async () => {
      const res = await http
        .get(`/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const names = (res.body as { name: string }[]).map((o) => o.name);
      expect(names).toContain('Spaghetti');
      expect(names).toContain('Penne');
    });

    it('returns 404 for non-existent groupId', async () => {
      const res = await http
        .get(
          `/api/menu-items/${menuItemId}/modifier-groups/00000000-0000-4000-8000-000000000004/options`,
        )
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });
  });

  // ─── §8 Get single option ──────────────────────────────────────────────────

  describe('§8 GET .../modifier-groups/:groupId/options/:optionId', () => {
    let groupId: string;
    let optionId: string;

    beforeAll(async () => {
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Cheese', minSelections: 0, maxSelections: 1 });
      groupId = gRes.body.id as string;

      const oRes = await http
        .post(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`,
        )
        .set(ownerHeaders())
        .send({ name: 'Cheddar', price: 1.5 });
      optionId = oRes.body.id as string;
    });

    it('returns 200 with option details (public)', async () => {
      const res = await http
        .get(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
        )
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(optionId);
      expect(res.body.groupId).toBe(groupId);
      expect(res.body.name).toBe('Cheddar');
    });

    it('returns 404 for wrong groupId', async () => {
      const wrongGroupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const res = await http
        .get(
          `/api/menu-items/${menuItemId}/modifier-groups/${wrongGroupId}/options/${optionId}`,
        )
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });

    it('returns 404 for non-existent optionId', async () => {
      const res = await http
        .get(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/00000000-0000-4000-8000-000000000005`,
        )
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });
  });

  // ─── §9 Update modifier option ─────────────────────────────────────────────

  describe('§9 PATCH .../modifier-groups/:groupId/options/:optionId', () => {
    let groupId: string;
    let optionId: string;

    beforeAll(async () => {
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Protein', minSelections: 1, maxSelections: 1 });
      groupId = gRes.body.id as string;

      const oRes = await http
        .post(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`,
        )
        .set(ownerHeaders())
        .send({ name: 'Chicken', price: 3.0 });
      optionId = oRes.body.id as string;
    });

    it('updates price and availability, returns 200', async () => {
      const res = await http
        .patch(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
        )
        .set(ownerHeaders())
        .send({ price: 4.0, isAvailable: false });

      expect(res.status).toBe(200);
      expect(res.body.price).toBe(4);
      expect(res.body.isAvailable).toBe(false);
    });

    it('partial update of name preserves price', async () => {
      const res = await http
        .patch(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
        )
        .set(ownerHeaders())
        .send({ name: 'Grilled Chicken' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Grilled Chicken');
      expect(res.body.price).toBe(4); // unchanged
    });

    it('snapshot reflects updated option price', async () => {
      await new Promise((r) => setTimeout(r, 100));

      const snapshot = await getSnapshot(menuItemId);
      expect(snapshot).not.toBeNull();
      const group = (
        snapshot!.modifiers as {
          groupId: string;
          options: { optionId: string; price: number }[];
        }[]
      ).find((g) => g.groupId === groupId);
      expect(group).toBeDefined();
      const option = group!.options.find((o) => o.optionId === optionId);
      expect(option).toBeDefined();
      expect(option!.price).toBe(4);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .patch(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
        )
        .set(noAuthHeaders())
        .send({ price: 0 });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-owner', async () => {
      const res = await http
        .patch(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
        )
        .set(otherUserHeaders())
        .send({ price: 0 });

      expect(res.status).toBe(403);
    });
  });

  // ─── §10 Delete modifier option ────────────────────────────────────────────

  describe('§10 DELETE .../modifier-groups/:groupId/options/:optionId', () => {
    let groupId: string;
    let optionId: string;

    beforeAll(async () => {
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Extras', minSelections: 0, maxSelections: 2 });
      groupId = gRes.body.id as string;

      const oRes = await http
        .post(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options`,
        )
        .set(ownerHeaders())
        .send({ name: 'Extra Shot', price: 1.0 });
      optionId = oRes.body.id as string;
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .delete(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
        )
        .set(noAuthHeaders());

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-owner', async () => {
      const res = await http
        .delete(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
        )
        .set(otherUserHeaders());

      expect(res.status).toBe(403);
    });

    it('deletes option and returns 204', async () => {
      const res = await http
        .delete(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
        )
        .set(ownerHeaders());

      expect(res.status).toBe(204);
    });

    it('returns 404 when fetching the deleted option', async () => {
      const res = await http
        .get(
          `/api/menu-items/${menuItemId}/modifier-groups/${groupId}/options/${optionId}`,
        )
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });
  });

  // ─── §11 min/max edge cases ────────────────────────────────────────────────

  describe('§11 min/max validation edge cases', () => {
    it('min=0, max=0 is accepted on create (optional group)', async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Optional Note', minSelections: 0, maxSelections: 0 });

      expect(res.status).toBe(201);
      expect(res.body.minSelections).toBe(0);
      expect(res.body.maxSelections).toBe(0);
    });

    it('min=max=5 is accepted on create', async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Exactly 5', minSelections: 5, maxSelections: 5 });

      expect(res.status).toBe(201);
    });

    it('min=2, max=1 is rejected with 400 on create', async () => {
      const res = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Bad', minSelections: 2, maxSelections: 1 });

      expect(res.status).toBe(400);
    });

    it('update that keeps min <= max is accepted', async () => {
      // Create group first
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Range Test', minSelections: 0, maxSelections: 3 });
      const gId = gRes.body.id as string;

      // Update min to 2 (still ≤ max 3)
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/modifier-groups/${gId}`)
        .set(ownerHeaders())
        .send({ minSelections: 2 });

      expect(res.status).toBe(200);
      expect(res.body.minSelections).toBe(2);
    });
  });

  // ─── §12 Snapshot invariants ───────────────────────────────────────────────

  describe('§12 Snapshot invariants', () => {
    it('group with zero options has "options": [] in snapshot', async () => {
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Empty Group', minSelections: 0, maxSelections: 1 });
      expect(gRes.status).toBe(201);
      const emptyGroupId = gRes.body.id as string;

      await new Promise((r) => setTimeout(r, 100));

      const snapshot = await getSnapshot(menuItemId);
      expect(snapshot).not.toBeNull();
      const emptyGroup = (
        snapshot!.modifiers as { groupId: string; options: unknown[] }[]
      ).find((g) => g.groupId === emptyGroupId);
      expect(emptyGroup).toBeDefined();
      expect(emptyGroup!.options).toEqual([]);
    });

    it('snapshot reflects correct option count after adding options', async () => {
      // Create a fresh group
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Count Test', minSelections: 0, maxSelections: 3 });
      const gId = gRes.body.id as string;

      // Add 2 options
      await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups/${gId}/options`)
        .set(ownerHeaders())
        .send({ name: 'Option A', price: 0 });
      await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups/${gId}/options`)
        .set(ownerHeaders())
        .send({ name: 'Option B', price: 1 });

      await new Promise((r) => setTimeout(r, 100));

      const snapshot = await getSnapshot(menuItemId);
      const group = (snapshot!.modifiers as MenuItemModifierSnapshot[]).find(
        (g) => g.groupId === gId,
      );
      expect(group).toBeDefined();
      expect(group!.options.length).toBe(2);
    });

    it('snapshot modifiers is never null after any mutation', async () => {
      // Adding a new group should not result in null modifiers
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Null Check Group', minSelections: 0, maxSelections: 1 });
      expect(gRes.status).toBe(201);

      await new Promise((r) => setTimeout(r, 100));

      const snapshot = await getSnapshot(menuItemId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.modifiers).not.toBeNull();
      expect(Array.isArray(snapshot!.modifiers)).toBe(true);
    });
  });

  // ─── §13 Security ──────────────────────────────────────────────────────────

  describe('§13 Security: 401 / 403 on write endpoints', () => {
    const fakeGroupId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const fakeOptionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    it('PATCH group: 401 unauthenticated', async () => {
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/modifier-groups/${fakeGroupId}`)
        .set(noAuthHeaders())
        .send({ name: 'x' });
      expect(res.status).toBe(401);
    });

    it('DELETE option: 401 unauthenticated', async () => {
      const res = await http
        .delete(
          `/api/menu-items/${menuItemId}/modifier-groups/${fakeGroupId}/options/${fakeOptionId}`,
        )
        .set(noAuthHeaders());
      expect(res.status).toBe(401);
    });

    it('PATCH option: 403 non-owner', async () => {
      // Need a real group/option to get past UUID validation into the ownership check
      const gRes = await http
        .post(`/api/menu-items/${menuItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Security Group' });
      const secGroupId = gRes.body.id as string;

      const oRes = await http
        .post(
          `/api/menu-items/${menuItemId}/modifier-groups/${secGroupId}/options`,
        )
        .set(ownerHeaders())
        .send({ name: 'Security Option' });
      const secOptionId = oRes.body.id as string;

      const res = await http
        .patch(
          `/api/menu-items/${menuItemId}/modifier-groups/${secGroupId}/options/${secOptionId}`,
        )
        .set(otherUserHeaders())
        .send({ price: 0 });
      expect(res.status).toBe(403);
    });
  });

  // ─── §14 ParseUUID guard ───────────────────────────────────────────────────

  describe('§14 ParseUUID guard: non-UUID groupId', () => {
    it('GET .../modifier-groups/options rejects "options" as a groupId with 400', async () => {
      const res = await http
        .get(`/api/menu-items/${menuItemId}/modifier-groups/options`)
        .set(noAuthHeaders());

      // "options" is not a valid UUID → ParseUUIDPipe returns 400
      expect(res.status).toBe(400);
    });

    it('PATCH .../modifier-groups/not-a-uuid rejects with 400', async () => {
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/modifier-groups/not-a-uuid`)
        .set(ownerHeaders())
        .send({ name: 'x' });

      expect(res.status).toBe(400);
    });
  });
});
