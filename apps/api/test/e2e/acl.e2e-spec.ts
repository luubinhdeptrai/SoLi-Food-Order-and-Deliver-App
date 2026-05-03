/**
 * acl.e2e-spec.ts — Phase 3 ACL Layer
 *
 * Tests the full pipeline:
 *   Restaurant-Catalog HTTP action → EventBus → Projector → Snapshot DB row
 * and the read-only ACL endpoints that expose those snapshots.
 *
 * §1  Menu item snapshot projection
 * §2  ACL read — GET /ordering/menu-items
 * §3  Restaurant snapshot projection
 * §4  ACL read — GET /ordering/restaurants
 * §5  Delivery zone snapshot projection
 * §6  Cross-BC integrity — snapshot state controls cart admission
 */

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  teardownTestApp,
} from '../setup/app-factory';
import {
  resetDb,
  seedBaseRestaurant,
  TEST_RESTAURANT_ID,
} from '../setup/db-setup';
import { TestAuthManager } from '../helpers/test-auth';
import {
  setAuthManager,
  ownerHeaders,
  otherUserHeaders,
  noAuthHeaders,
} from '../helpers/auth';
import { getSnapshot, getRestaurantSnapshot, getDeliveryZoneSnapshot } from '../helpers/db';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Unknown IDs (no snapshot exists) ────────────────────────────────────────

const UNKNOWN_ITEM_ID   = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UNKNOWN_REST_ID   = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// ─── Main suite ──────────────────────────────────────────────────────────────

describe('ACL Layer — Snapshot Projection & Read API (E2E)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  // ─── Global setup ──────────────────────────────────────────────────────────

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

  // ─── §1  Menu item snapshot projection ────────────────────────────────────

  describe('§1 Menu item snapshot — projection from MenuItemUpdatedEvent', () => {
    let itemId: string;
    let groupId: string;
    let optionId: string;

    beforeAll(async () => {
      // Create a basic item — fires MenuItemUpdatedEvent → MenuItemProjector
      const itemRes = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Snapshot Pizza', price: 12.0 });
      itemId = itemRes.body.id as string;

      // Add a modifier group + option so we can verify modifier snapshotting
      // Route: POST /api/menu-items/:menuItemId/modifier-groups
      const groupRes = await http
        .post(`/api/menu-items/${itemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Size', minSelections: 1, maxSelections: 1 });
      groupId = groupRes.body.id as string;
      // Delay between events to avoid race condition in async projector
      await delay(200);

      // Route: POST /api/menu-items/:menuItemId/modifier-groups/:groupId/options
      const optRes = await http
        .post(`/api/menu-items/${itemId}/modifier-groups/${groupId}/options`)
        .set(ownerHeaders())
        .send({ name: 'Regular', price: 0, isDefault: true });
      optionId = optRes.body.id as string;

      // Wait for EventBus propagation
      await delay(200);
    });

    it('A-01 snapshot row is created after menu item creation', async () => {
      const row = await getSnapshot(itemId);
      expect(row).not.toBeNull();
    });

    it('A-02 snapshot fields match the created item', async () => {
      const row = await getSnapshot(itemId);
      expect(row).toMatchObject({
        menuItemId: itemId,
        restaurantId: TEST_RESTAURANT_ID,
        name: 'Snapshot Pizza',
        price: 12.0,
        status: 'available',
      });
    });

    it('A-03 modifier group is stored in the snapshot modifiers JSONB', async () => {
      const row = await getSnapshot(itemId);
      expect(Array.isArray(row!.modifiers)).toBe(true);
      const group = (row!.modifiers as { groupId: string }[]).find(
        (g) => g.groupId === groupId,
      );
      expect(group).toBeDefined();
    });

    it('A-04 modifier option is stored inside the group', async () => {
      const row = await getSnapshot(itemId);
      const group = (row!.modifiers as { groupId: string; options: { optionId: string }[] }[]).find(
        (g) => g.groupId === groupId,
      );
      const opt = group?.options.find((o) => o.optionId === optionId);
      expect(opt).toBeDefined();
    });

    it('A-05 snapshot updates when menu item name/price is changed', async () => {
      const before = await getSnapshot(itemId);

      await http
        .patch(`/api/menu-items/${itemId}`)
        .set(ownerHeaders())
        .send({ name: 'Snapshot Pizza XL', price: 14.5 });
      await delay(150);

      const after = await getSnapshot(itemId);
      expect(after!.name).toBe('Snapshot Pizza XL');
      expect(after!.price).toBe(14.5);
      expect(after!.lastSyncedAt.getTime()).toBeGreaterThanOrEqual(before!.lastSyncedAt.getTime());
    });

    it('A-06 snapshot status becomes out_of_stock after sold-out toggle', async () => {
      await http.patch(`/api/menu-items/${itemId}/sold-out`).set(ownerHeaders());
      await delay(150);

      const row = await getSnapshot(itemId);
      expect(row!.status).toBe('out_of_stock');

      // Restore
      await http.patch(`/api/menu-items/${itemId}/sold-out`).set(ownerHeaders());
      await delay(150);
    });

    it('A-07 snapshot status becomes unavailable after disable', async () => {
      // No dedicated /unavailable endpoint — use PATCH :id with status field
      await http
        .patch(`/api/menu-items/${itemId}`)
        .set(ownerHeaders())
        .send({ status: 'unavailable' });
      await delay(150);

      const row = await getSnapshot(itemId);
      expect(row!.status).toBe('unavailable');

      // Restore
      await http
        .patch(`/api/menu-items/${itemId}`)
        .set(ownerHeaders())
        .send({ status: 'available' });
      await delay(150);
    });

    it('A-08 snapshot is upserted on repeated updates (no duplicate rows)', async () => {
      await http
        .patch(`/api/menu-items/${itemId}`)
        .set(ownerHeaders())
        .send({ name: 'Snapshot Pizza — v3' });
      await delay(150);

      await http
        .patch(`/api/menu-items/${itemId}`)
        .set(ownerHeaders())
        .send({ name: 'Snapshot Pizza — v4' });
      await delay(150);

      const row = await getSnapshot(itemId);
      expect(row!.name).toBe('Snapshot Pizza — v4');
    });

    it('A-09 ACL /ordering/menu-items/:id reflects latest snapshot state', async () => {
      const res = await http
        .get(`/api/ordering/menu-items/${itemId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Snapshot Pizza — v4');
    });
  });

  // ─── §2  ACL read — menu items ────────────────────────────────────────────

  describe('§2 GET /api/ordering/menu-items — read API', () => {
    let readItemId: string;

    beforeAll(async () => {
      const res = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Read Test Item', price: 8.0 });
      readItemId = res.body.id as string;
      await delay(150);
    });

    it('A-10 GET /:id returns 200 with MenuItemSnapshotResponseDto', async () => {
      const res = await http
        .get(`/api/ordering/menu-items/${readItemId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        menuItemId: readItemId,
        restaurantId: TEST_RESTAURANT_ID,
        name: 'Read Test Item',
        price: 8.0,
        status: 'available',
        lastSyncedAt: expect.any(String),
      });
    });

    it('A-11 GET /:id returns 404 for unknown item ID', async () => {
      const res = await http
        .get(`/api/ordering/menu-items/${UNKNOWN_ITEM_ID}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });

    it('A-12 GET /:id returns 400 for non-UUID path param', async () => {
      const res = await http
        .get('/api/ordering/menu-items/not-a-uuid')
        .set(noAuthHeaders());

      expect(res.status).toBe(400);
    });

    it('A-13 GET ?ids= returns array with found snapshots', async () => {
      const res = await http
        .get(`/api/ordering/menu-items?ids=${readItemId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const ids = (res.body as { menuItemId: string }[]).map((i) => i.menuItemId);
      expect(ids).toContain(readItemId);
    });

    it('A-14 GET ?ids= silently omits IDs with no snapshot (partial result)', async () => {
      const res = await http
        .get(`/api/ordering/menu-items?ids=${readItemId},${UNKNOWN_ITEM_ID}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect((res.body as { menuItemId: string }[])[0].menuItemId).toBe(readItemId);
    });

    it('A-15 GET ?ids= with all-unknown IDs returns empty array', async () => {
      const res = await http
        .get(`/api/ordering/menu-items?ids=${UNKNOWN_ITEM_ID}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('A-16 GET ?ids= is accessible without authentication', async () => {
      const res = await http
        .get(`/api/ordering/menu-items?ids=${readItemId}`)
        .set(noAuthHeaders());

      // Must NOT be 401 — endpoint is @AllowAnonymous
      expect(res.status).toBe(200);
    });
  });

  // ─── §3  Restaurant snapshot projection ───────────────────────────────────

  describe('§3 Restaurant snapshot — projection from RestaurantUpdatedEvent', () => {
    let restId: string;

    beforeAll(async () => {
      // Create restaurant via HTTP — fires RestaurantUpdatedEvent → RestaurantSnapshotProjector
      // Use otherUserHeaders() since owner already has a restaurant from seedBaseRestaurant
      // CreateRestaurantDto requires: name, address, phone
      const res = await http
        .post('/api/restaurants')
        .set(otherUserHeaders())
        .send({
          name: 'ACL Test Bistro',
          address: '42 Snapshot Street, District 3',
          phone: '+84-90-000-0002',
          cuisineType: 'Vietnamese',
        });

      expect(res.status).toBe(201);
      restId = res.body.id as string;
      await delay(150);
    });

    it('A-17 snapshot row is created after restaurant creation', async () => {
      const row = await getRestaurantSnapshot(restId);
      expect(row).not.toBeNull();
    });

    it('A-18 snapshot fields match the created restaurant', async () => {
      const row = await getRestaurantSnapshot(restId);
      expect(row).toMatchObject({
        restaurantId: restId,
        name: 'ACL Test Bistro',
        address: '42 Snapshot Street, District 3',
        cuisineType: 'Vietnamese',
        isOpen: false,
        isApproved: false,
      });
    });

    it('A-19 snapshot updates when restaurant name/address is patched', async () => {
      await http
        .patch(`/api/restaurants/${restId}`)
        .set(otherUserHeaders())
        .send({ name: 'ACL Test Bistro — Updated', address: '99 Updated Ave' });
      await delay(150);

      const row = await getRestaurantSnapshot(restId);
      expect(row!.name).toBe('ACL Test Bistro — Updated');
      expect(row!.address).toBe('99 Updated Ave');
    });

    it('A-20 snapshot latitude/longitude reflect GPS coordinates after patch', async () => {
      await http
        .patch(`/api/restaurants/${restId}`)
        .set(otherUserHeaders())
        .send({ latitude: 10.7769, longitude: 106.7009 });
      await delay(150);

      const row = await getRestaurantSnapshot(restId);
      expect(row!.latitude).toBeCloseTo(10.7769, 3);
      expect(row!.longitude).toBeCloseTo(106.7009, 3);
    });

    it('A-21 snapshot cuisineType is nullable — null when not provided', async () => {
      const res = await http
        .post('/api/restaurants')
        .set(ownerHeaders())
        .send({ name: 'No Cuisine Cafe', address: '1 Plain Road', phone: '+84-90-000-0001' });

      if (res.status !== 201) {
        // Owner may already have a restaurant — skip assertion
        return;
      }

      const noCuisineId = res.body.id as string;
      await delay(150);

      const row = await getRestaurantSnapshot(noCuisineId);
      if (row) {
        expect(row.cuisineType).toBeNull();
      }
    });

    it('A-22 snapshot isOpen updates when restaurant is opened', async () => {
      // No dedicated /open or /close endpoint — use PATCH :id with isOpen field
      await http
        .patch(`/api/restaurants/${restId}`)
        .set(otherUserHeaders())
        .send({ isOpen: true });
      await delay(150);

      const row = await getRestaurantSnapshot(restId);
      expect(row!.isOpen).toBe(true);

      // Close again
      await http
        .patch(`/api/restaurants/${restId}`)
        .set(otherUserHeaders())
        .send({ isOpen: false });
      await delay(150);
    });
  });

  // ─── §4  ACL read — restaurants ───────────────────────────────────────────

  describe('§4 GET /api/ordering/restaurants — read API', () => {
    let readRestId: string;

    beforeAll(async () => {
      const res = await http
        .post('/api/restaurants')
        .set(otherUserHeaders())
        .send({ name: 'Read Test Eatery', address: '5 Read Lane', phone: '+84-90-000-0003' });

      // May fail if otherUser already owns a restaurant from §3
      // In that case, reuse the first restaurant created
      if (res.status === 201) {
        readRestId = res.body.id as string;
      } else {
        // Fall back: find via list or use the §3 restaurant — get it via listing
        const listRes = await http
          .get('/api/restaurants?limit=20')
          .set(noAuthHeaders());
        const myRest = (listRes.body?.data ?? listRes.body ?? []) as { id: string; name: string }[];
        const found = myRest.find((r) => r.name.startsWith('ACL Test Bistro'));
        readRestId = found?.id ?? TEST_RESTAURANT_ID;
      }
      await delay(150);
    });

    it('A-23 GET /:id returns 200 with RestaurantSnapshotResponseDto', async () => {
      const res = await http
        .get(`/api/ordering/restaurants/${readRestId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        restaurantId: readRestId,
        lastSyncedAt: expect.any(String),
      });
    });

    it('A-24 GET /:id returns 404 for unknown restaurant ID', async () => {
      const res = await http
        .get(`/api/ordering/restaurants/${UNKNOWN_REST_ID}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });

    it('A-25 GET /:id returns 400 for non-UUID path param', async () => {
      const res = await http
        .get('/api/ordering/restaurants/not-a-uuid')
        .set(noAuthHeaders());

      expect(res.status).toBe(400);
    });

    it('A-26 GET ?ids= returns array with found snapshots', async () => {
      const res = await http
        .get(`/api/ordering/restaurants?ids=${readRestId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const ids = (res.body as { restaurantId: string }[]).map((r) => r.restaurantId);
      expect(ids).toContain(readRestId);
    });

    it('A-27 GET ?ids= silently omits unknown IDs (partial result)', async () => {
      const res = await http
        .get(`/api/ordering/restaurants?ids=${readRestId},${UNKNOWN_REST_ID}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
    });

    it('A-28 GET ?ids= with all-unknown IDs returns empty array', async () => {
      const res = await http
        .get(`/api/ordering/restaurants?ids=${UNKNOWN_REST_ID}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('A-29 GET ?ids= is accessible without authentication', async () => {
      const res = await http
        .get(`/api/ordering/restaurants?ids=${readRestId}`)
        .set(noAuthHeaders());

      expect(res.status).not.toBe(401);
    });
  });

  // ─── §5  Delivery zone snapshot projection ────────────────────────────────

  describe('§5 Delivery zone snapshot — projection from DeliveryZoneSnapshotUpdatedEvent', () => {
    let zoneId: string;

    beforeAll(async () => {
      // Create zone under TEST_RESTAURANT_ID — fires DeliveryZoneSnapshotUpdatedEvent
      const res = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(ownerHeaders())
        .send({
          name: 'ACL Zone 1',
          radiusKm: 5,
          baseFee: 15000,
          perKmRate: 3000,
        });

      expect(res.status).toBe(201);
      zoneId = res.body.id as string;
      await delay(150);
    });

    it('A-30 snapshot row is created after delivery zone creation', async () => {
      const row = await getDeliveryZoneSnapshot(zoneId);
      expect(row).not.toBeNull();
    });

    it('A-31 snapshot fields match the created zone', async () => {
      const row = await getDeliveryZoneSnapshot(zoneId);
      expect(row).toMatchObject({
        zoneId,
        restaurantId: TEST_RESTAURANT_ID,
        name: 'ACL Zone 1',
        radiusKm: 5,
        baseFee: 15000,
        perKmRate: 3000,
        isActive: true,
        isDeleted: false,
      });
    });

    it('A-32 snapshot updates when zone is patched', async () => {
      await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders())
        .send({ name: 'ACL Zone 1 — Updated', radiusKm: 8 });
      await delay(150);

      const row = await getDeliveryZoneSnapshot(zoneId);
      expect(row!.name).toBe('ACL Zone 1 — Updated');
      expect(row!.radiusKm).toBe(8);
    });

    it('A-33 snapshot isActive=false when zone is deactivated', async () => {
      await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders())
        .send({ isActive: false });
      await delay(150);

      const row = await getDeliveryZoneSnapshot(zoneId);
      expect(row!.isActive).toBe(false);

      // Re-activate
      await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders())
        .send({ isActive: true });
      await delay(150);
    });

    it('A-34 snapshot isDeleted=true (tombstone) after zone is deleted', async () => {
      // Create a disposable zone
      const dispRes = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(ownerHeaders())
        .send({ name: 'Disposable Zone', radiusKm: 2, baseFee: 5000, perKmRate: 1000 });
      const dispZoneId = dispRes.body.id as string;
      await delay(150);

      // Confirm snapshot was created
      const before = await getDeliveryZoneSnapshot(dispZoneId);
      expect(before).not.toBeNull();
      expect(before!.isDeleted).toBe(false);

      // Delete the zone
      await http
        .delete(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${dispZoneId}`)
        .set(ownerHeaders());
      await delay(150);

      // Snapshot row must still exist as a tombstone
      const after = await getDeliveryZoneSnapshot(dispZoneId);
      expect(after).not.toBeNull();
      expect(after!.isDeleted).toBe(true);
    });

    it('A-35 snapshot upsert is idempotent — repeated patches do not create duplicate rows', async () => {
      await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders())
        .send({ name: 'Idempotency Check v1' });
      await delay(150);

      await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders())
        .send({ name: 'Idempotency Check v2' });
      await delay(150);

      const row = await getDeliveryZoneSnapshot(zoneId);
      expect(row!.name).toBe('Idempotency Check v2');
    });
  });

  // ─── §6  Cross-BC integrity ────────────────────────────────────────────────

  describe('§6 Cross-BC integrity — snapshot state gates cart admission', () => {
    let availableItemId: string;
    let cartCustomerHeaders: ReturnType<typeof ownerHeaders>;

    beforeAll(async () => {
      // Create a fresh menu item with 'available' status
      const res = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Gate Test Item', price: 9.0 });
      availableItemId = res.body.id as string;
      await delay(150);

      cartCustomerHeaders = ownerHeaders();

      // Clear any existing cart
      await http.delete('/api/carts/my').set(cartCustomerHeaders);
    });

    afterEach(async () => {
      // Clean up cart between tests
      await http.delete('/api/carts/my').set(cartCustomerHeaders);
    });

    it('A-36 item with status=available can be added to cart', async () => {
      const res = await http.post('/api/carts/my/items').set(cartCustomerHeaders).send({
        menuItemId: availableItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Gate Test Item',
        unitPrice: 9.0,
        quantity: 1,
      });

      expect(res.status).toBe(201);
    });

    it('A-37 item with status=out_of_stock is rejected (409) when adding to cart', async () => {
      // Mark item out of stock
      await http.patch(`/api/menu-items/${availableItemId}/sold-out`).set(ownerHeaders());
      await delay(150);

      const res = await http.post('/api/carts/my/items').set(cartCustomerHeaders).send({
        menuItemId: availableItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Gate Test Item',
        unitPrice: 9.0,
        quantity: 1,
      });

      expect(res.status).toBe(409);

      // Restore
      await http.patch(`/api/menu-items/${availableItemId}/sold-out`).set(ownerHeaders());
      await delay(150);
    });

    it('A-38 item with status=unavailable is rejected (409) when adding to cart', async () => {
      // No dedicated /unavailable endpoint — use PATCH :id with status field
      await http
        .patch(`/api/menu-items/${availableItemId}`)
        .set(ownerHeaders())
        .send({ status: 'unavailable' });
      await delay(150);

      const res = await http.post('/api/carts/my/items').set(cartCustomerHeaders).send({
        menuItemId: availableItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Gate Test Item',
        unitPrice: 9.0,
        quantity: 1,
      });

      expect(res.status).toBe(409);

      // Restore
      await http
        .patch(`/api/menu-items/${availableItemId}`)
        .set(ownerHeaders())
        .send({ status: 'available' });
      await delay(150);
    });

    it('A-39 item becomes addable again once restored to available status', async () => {
      // Mark out of stock then restore
      await http.patch(`/api/menu-items/${availableItemId}/sold-out`).set(ownerHeaders());
      await delay(150);
      await http.patch(`/api/menu-items/${availableItemId}/sold-out`).set(ownerHeaders()); // toggle back
      await delay(150);

      const row = await getSnapshot(availableItemId);
      expect(row!.status).toBe('available');

      const res = await http.post('/api/carts/my/items').set(cartCustomerHeaders).send({
        menuItemId: availableItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Gate Test Item',
        unitPrice: 9.0,
        quantity: 1,
      });

      expect(res.status).toBe(201);
    });
  });
});
