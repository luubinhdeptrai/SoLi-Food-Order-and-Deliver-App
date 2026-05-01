/**
 * snapshot.e2e-spec.ts
 *
 * Validates the critical "modifier data preservation" behaviour described in
 * Section 2 of MENU_MODIFIER_API_TEST.md.
 *
 * The core invariant being tested:
 *   When a menu item is updated via a non-modifier event (name, price, status),
 *   the ordering snapshot's `modifiers` column MUST NOT be overwritten with [].
 *   Only modifier-specific events (createGroup, updateOption, etc.) should
 *   change the modifiers column.
 *
 * Covers:
 *   2.1  Update item name  → modifiers unchanged in snapshot
 *   2.2  Update item price → modifiers unchanged AND price updated
 *   2.3  Toggle sold-out   → modifiers unchanged through both toggles
 *   2.4  Delete item       → snapshot marked unavailable, modifiers = [] (intentional)
 *
 *   Snapshot invariants (Section 6):
 *     • modifiers is never null
 *     • lastSyncedAt advances on every mutation
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
import { noAuthHeaders, ownerHeaders } from '../helpers/auth';
import type { MenuItemModifierSnapshot } from '../../src/shared/events/menu-item-updated.event';

// ─────────────────────────────────────────────────────────────────────────────

describe('Ordering Snapshot — Modifier Preservation (E2E)', () => {
  let app: INestApplication<App>;
  let http: ReturnType<typeof request>;

  /** Menu item with a "Size" group (Large + Small options). */
  let menuItemId: string;
  let sizeGroupId: string;
  let largeOptionId: string;
  let smallOptionId: string;

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    await resetDb();
    await seedBaseRestaurant();

    // ── Build the complete menu item via the API so every event fires ──────

    // 1. Create the menu item
    const itemRes = await http
      .post('/api/menu-items')
      .set(ownerHeaders())
      .send({
        restaurantId: TEST_RESTAURANT_ID,
        name: 'Snapshot Test Burger',
        price: 12.5,
      });
    expect(itemRes.status).toBe(201);
    menuItemId = itemRes.body.id as string;

    // 2. Create "Size" modifier group
    const groupRes = await http
      .post(`/api/menu-items/${menuItemId}/modifier-groups`)
      .set(ownerHeaders())
      .send({ name: 'Size', minSelections: 1, maxSelections: 1 });
    expect(groupRes.status).toBe(201);
    sizeGroupId = groupRes.body.id as string;

    // 3. Add "Large" option
    const largeRes = await http
      .post(`/api/menu-items/${menuItemId}/modifier-groups/${sizeGroupId}/options`)
      .set(ownerHeaders())
      .send({ name: 'Large', price: 5.0, isDefault: false });
    expect(largeRes.status).toBe(201);
    largeOptionId = largeRes.body.id as string;

    // 4. Add "Small" option (default)
    const smallRes = await http
      .post(`/api/menu-items/${menuItemId}/modifier-groups/${sizeGroupId}/options`)
      .set(ownerHeaders())
      .send({ name: 'Small', price: 0, isDefault: true });
    expect(smallRes.status).toBe(201);
    smallOptionId = smallRes.body.id as string;
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  // ─── Helper: assert that snapshot has the expected Size group ─────────────

  async function assertSizeGroupPresent(
    context: string,
  ): Promise<MenuItemModifierSnapshot[]> {
    const snapshot = await getSnapshot(menuItemId);
    expect(snapshot).not.toBeNull(); // [${context}] snapshot must exist
    expect(snapshot!.modifiers).not.toBeNull(); // [${context}] modifiers must not be null

    const modifiers = snapshot!.modifiers as MenuItemModifierSnapshot[];
    const sizeGroup = modifiers.find((g) => g.groupId === sizeGroupId);
    expect(sizeGroup).toBeDefined(); // [${context}] Size group must be in modifiers
    expect(sizeGroup!.options.length).toBe(2); // [${context}] Size group must have 2 options
    return modifiers;
  }

  // ─── Baseline: snapshot exists with modifier data after setup ─────────────

  it('baseline — snapshot contains the Size group with Large and Small options', async () => {
    await assertSizeGroupPresent('baseline');
  });

  // ─── Section 2.1: Update item name ────────────────────────────────────────

  describe('2.1 — Update item name → modifiers must survive', () => {
    it('PATCH name returns 200', async () => {
      const res = await http
        .patch(`/api/menu-items/${menuItemId}`)
        .set(ownerHeaders())
        .send({ name: 'Updated Snapshot Burger' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Snapshot Burger');
    });

    it('snapshot modifiers are unchanged after name update', async () => {
      await assertSizeGroupPresent('after name update');
    });
  });

  // ─── Section 2.2: Update item price ───────────────────────────────────────

  describe('2.2 — Update item price → modifiers must survive', () => {
    it('PATCH price returns 200', async () => {
      const res = await http
        .patch(`/api/menu-items/${menuItemId}`)
        .set(ownerHeaders())
        .send({ price: 15.99 });

      expect(res.status).toBe(200);
      expect(res.body.price).toBe(15.99);
    });

    it('snapshot price updated AND modifiers unchanged', async () => {
      const snapshot = await getSnapshot(menuItemId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.price).toBe(15.99);
      await assertSizeGroupPresent('after price update');
    });
  });

  // ─── Section 2.3: Toggle sold-out ─────────────────────────────────────────

  describe('2.3 — Toggle sold-out → modifiers must survive both toggles', () => {
    it('first toggle → status: out_of_stock', async () => {
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/sold-out`)
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('out_of_stock');
    });

    it('snapshot modifiers unchanged after first toggle', async () => {
      const snapshot = await getSnapshot(menuItemId);
      expect(snapshot!.status).toBe('out_of_stock');
      await assertSizeGroupPresent('after first sold-out toggle');
    });

    it('second toggle → status: available', async () => {
      const res = await http
        .patch(`/api/menu-items/${menuItemId}/sold-out`)
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('available');
    });

    it('snapshot modifiers unchanged after second toggle', async () => {
      const snapshot = await getSnapshot(menuItemId);
      expect(snapshot!.status).toBe('available');
      await assertSizeGroupPresent('after second sold-out toggle');
    });
  });

  // ─── Snapshot invariant: lastSyncedAt advances ────────────────────────────

  describe('Snapshot invariant — lastSyncedAt advances on every mutation', () => {
    it('lastSyncedAt is updated when item name changes', async () => {
      const before = await getSnapshot(menuItemId);
      const beforeTs = before!.lastSyncedAt.getTime();

      // Small delay to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 10));

      await http
        .patch(`/api/menu-items/${menuItemId}`)
        .set(ownerHeaders())
        .send({ name: 'Timestamp Test Burger' });

      const after = await getSnapshot(menuItemId);
      expect(after!.lastSyncedAt.getTime()).toBeGreaterThan(beforeTs);
    });
  });

  // ─── Section 2.4: Delete item (intentional clear) ─────────────────────────

  describe('2.4 — Delete item → snapshot marked unavailable, modifiers = []', () => {
    /**
     * This test must run last because it deletes the menu item.
     * After deletion the snapshot is NOT removed — it is tombstoned
     * (status=unavailable, modifiers=[]).
     */
    it('DELETE returns 204', async () => {
      const res = await http
        .delete(`/api/menu-items/${menuItemId}`)
        .set(ownerHeaders());

      expect(res.status).toBe(204);
    });

    it('snapshot is tombstoned: status=unavailable, modifiers=[]', async () => {
      const snapshot = await getSnapshot(menuItemId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.status).toBe('unavailable');
      expect(snapshot!.modifiers).toEqual([]);
    });

    it('item is no longer accessible via the API', async () => {
      const res = await http
        .get(`/api/menu-items/${menuItemId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });
  });
});
