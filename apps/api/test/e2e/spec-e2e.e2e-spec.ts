/**
 * spec-e2e.ts — Full Integration E2E Test Suite
 *
 * Covers the complete SoLi ordering platform end-to-end:
 *   §1  Restaurant & Catalog API (create/update/delete, zones, menu items)
 *   §2  ACL Snapshot Projection verification
 *   §3  Cart Flow (add, merge, append, update, remove, constraint, clear)
 *   §4  Checkout Flow (no-GPS · with-zone · outside-zone · idempotency)
 *   §5  Order Lifecycle (COD full path · cancel · invalid transitions · permissions)
 *   §6  Order History — Phase 7 (customer · restaurant · shipper · admin)
 *
 * Architecture notes:
 *  - All state changes go through HTTP (no direct DB mutations except role grants).
 *  - DB helpers are used ONLY for assertions, not for seeding business data.
 *  - Extra actors (customer, shipper, admin) use SPEC_* emails deleted in
 *    beforeAll/afterAll to avoid polluting the dev database.
 *  - delay(200) is required after every event-firing HTTP call (restaurant
 *    create/update, zone create, menu item create/update) to let async
 *    projectors finish before assertions read ACL snapshots.
 *  - Zone: perKmRate=0 so shippingFee = baseFee exactly (no float math needed).
 */

import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp, teardownTestApp } from '../setup/app-factory';
import {
  resetDb,
  seedBaseRestaurant,
  getTestDb,
  TEST_RESTAURANT_ID,
} from '../setup/db-setup';
import { TestAuthManager, TEST_PASSWORD } from '../helpers/test-auth';
import {
  setAuthManager,
  ownerHeaders,
  otherUserHeaders,
  noAuthHeaders,
} from '../helpers/auth';
import {
  getOrder,
  getOrderItems,
  getSnapshot,
  getRestaurantSnapshot,
  getDeliveryZoneSnapshot,
} from '../helpers/db';
import { user as userTable } from '../../src/module/auth/auth.schema';

// ── Timing helper ─────────────────────────────────────────────────────────────
// Required after any event-firing HTTP mutation so async projectors finish
// before the next assertion reads the ACL snapshot table.
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Extra test actor emails ───────────────────────────────────────────────────
// These are NOT cleaned by resetDb(); we delete them manually in beforeAll/afterAll.
const SPEC_CUSTOMER_EMAIL = 'spec-full-customer@test.soli';
const SPEC_SHIPPER_EMAIL = 'spec-full-shipper@test.soli';
const SPEC_ADMIN_EMAIL = 'spec-full-admin@test.soli';
// Restaurant-role user who has NO restaurant — used to verify snapshot 403.
const SPEC_EMPTY_RESTAURANT_EMAIL = 'spec-full-nosnap@test.soli';
const SPEC_ALL_EMAILS = [
  SPEC_CUSTOMER_EMAIL,
  SPEC_SHIPPER_EMAIL,
  SPEC_ADMIN_EMAIL,
  SPEC_EMPTY_RESTAURANT_EMAIL,
] as const;

// ── Restaurant GPS fixtures ───────────────────────────────────────────────────
// Ho Chi Minh City center — matches test zone radius (10 km).
const RESTAURANT_LAT = 10.7769;
const RESTAURANT_LNG = 106.7009;
const NEARBY_LAT = 10.7859; // ~1 km north  → inside 10 km zone
const NEARBY_LNG = 106.7009;
const FAR_LAT = 10.9919; // ~25 km north → outside every zone
const FAR_LNG = 106.7009;

// ── Delivery address fixtures ─────────────────────────────────────────────────
const ADDR_NO_GPS = {
  street: '1 Test Road',
  district: 'District 1',
  city: 'Ho Chi Minh City',
};
const ADDR_NEARBY = { ...ADDR_NO_GPS, latitude: NEARBY_LAT, longitude: NEARBY_LNG };
const ADDR_FAR = { ...ADDR_NO_GPS, latitude: FAR_LAT, longitude: FAR_LNG };

// ── Zone fee constants ────────────────────────────────────────────────────────
// perKmRate=0 → shippingFee = baseFee (exact, no floating-point formula needed)
const ZONE_BASE_FEE = 15000;
const ZONE_RADIUS_KM = 10;
const ZONE_PER_KM_RATE = 0;
const ZONE_AVG_SPEED = 30;
const ZONE_PREP_MINS = 15;
const ZONE_BUFFER_MINS = 5;

// ── Local helpers ─────────────────────────────────────────────────────────────

/** Sign up a new user and return their bearer token + userId. */
async function signUpUser(
  http: ReturnType<typeof request>,
  email: string,
  name: string,
): Promise<{ token: string; userId: string }> {
  const res = await http
    .post('/api/auth/sign-up/email')
    .send({ email, password: TEST_PASSWORD, name });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(
      `signUpUser failed for "${email}" (${res.status}): ${JSON.stringify(res.body)}`,
    );
  }
  return {
    token: res.body.token as string,
    userId: res.body.user.id as string,
  };
}

/** Build an Authorization header from a bearer token. */
function authH(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('SoLi Full Integration E2E', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  // Standard two-user auth manager (owner + other, both 'restaurant' role)
  let testAuth: TestAuthManager;

  // Extra actors
  let customerToken: string;
  let customerId: string;
  let shipperToken: string;
  let shipperId: string;
  let adminToken: string;
  let adminId: string;
  // Restaurant-role user with NO restaurant snapshot (for H-13)
  let emptyRestaurantToken: string;

  // Seeded IDs (populated in beforeAll)
  let basicItemId: string; // Plain Burger — no modifiers
  let modItemId: string; // Fancy Burger — with modifier groups
  let reqGroupId: string; // Required group (min=1, max=1)
  let reqOptAId: string; // Default option (White bread)
  let reqOptBId: string; // Alternate option (Wheat bread, price +0.50)
  let optGroupId: string; // Optional group (min=0, max=2)
  let optOptAId: string; // Cheese +1.00
  let optOptBId: string; // Bacon +1.50
  let zoneId: string; // Delivery zone ID

  // ── Global setup ────────────────────────────────────────────────────────────

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());

    // 1. Wipe all E2E data
    await resetDb();
    const db = getTestDb();
    await db
      .delete(userTable)
      .where(inArray(userTable.email, [...SPEC_ALL_EMAILS]));

    // 2. Standard owner + other (both get 'restaurant' role via TestAuthManager)
    testAuth = new TestAuthManager();
    await testAuth.initialize(http);
    setAuthManager(testAuth);

    // 3. Extra actors
    const customer = await signUpUser(http, SPEC_CUSTOMER_EMAIL, 'Spec Customer');
    customerToken = customer.token;
    customerId = customer.userId;
    // default role resolves to 'customer' — no DB update needed

    const shipper = await signUpUser(http, SPEC_SHIPPER_EMAIL, 'Spec Shipper');
    shipperToken = shipper.token;
    shipperId = shipper.userId;
    await db
      .update(userTable)
      .set({ role: 'shipper' })
      .where(eq(userTable.id, shipperId));

    const admin = await signUpUser(http, SPEC_ADMIN_EMAIL, 'Spec Admin');
    adminToken = admin.token;
    adminId = admin.userId;
    await db
      .update(userTable)
      .set({ role: 'admin' })
      .where(eq(userTable.id, adminId));

    const emptyRest = await signUpUser(
      http,
      SPEC_EMPTY_RESTAURANT_EMAIL,
      'No Snap Restaurant',
    );
    emptyRestaurantToken = emptyRest.token;
    await db
      .update(userTable)
      .set({ role: 'restaurant' })
      .where(eq(userTable.id, emptyRest.userId));
    // Intentionally no restaurant created — snapshot table has no row for this user

    // 4. Seed base restaurant + trigger restaurant snapshot
    //    seedBaseRestaurant() is a direct DB insert — no event fires.
    //    The PATCH below fires RestaurantUpdatedEvent → RestaurantSnapshotProjector.
    await seedBaseRestaurant(testAuth.ownerUserId);
    const patchRes = await http
      .patch(`/api/restaurants/${TEST_RESTAURANT_ID}`)
      .set(ownerHeaders())
      .send({ latitude: RESTAURANT_LAT, longitude: RESTAURANT_LNG });
    expect(patchRes.status).toBe(200);
    await delay(200);

    // 5. Create delivery zone → fires DeliveryZoneSnapshotUpdatedEvent → zone snapshot
    const zoneRes = await http
      .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
      .set(ownerHeaders())
      .send({
        name: 'City Zone',
        radiusKm: ZONE_RADIUS_KM,
        baseFee: ZONE_BASE_FEE,
        perKmRate: ZONE_PER_KM_RATE,
        avgSpeedKmh: ZONE_AVG_SPEED,
        prepTimeMinutes: ZONE_PREP_MINS,
        bufferMinutes: ZONE_BUFFER_MINS,
      });
    expect(zoneRes.status).toBe(201);
    zoneId = zoneRes.body.id as string;
    await delay(200);

    // 6. Basic menu item (no modifiers) → fires MenuItemUpdatedEvent → item snapshot
    const basicRes = await http
      .post('/api/menu-items')
      .set(ownerHeaders())
      .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Plain Burger', price: 10.0 });
    expect(basicRes.status).toBe(201);
    basicItemId = basicRes.body.id as string;
    await delay(200);

    // 7. Menu item with modifiers — create item then attach groups + options
    const modRes = await http
      .post('/api/menu-items')
      .set(ownerHeaders())
      .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Fancy Burger', price: 15.0 });
    expect(modRes.status).toBe(201);
    modItemId = modRes.body.id as string;
    await delay(200);

    // Required group: Bread (min=1, max=1)
    const rgRes = await http
      .post(`/api/menu-items/${modItemId}/modifier-groups`)
      .set(ownerHeaders())
      .send({ name: 'Bread', minSelections: 1, maxSelections: 1 });
    expect(rgRes.status).toBe(201);
    reqGroupId = rgRes.body.id as string;
    await delay(200);

    const roaRes = await http
      .post(`/api/menu-items/${modItemId}/modifier-groups/${reqGroupId}/options`)
      .set(ownerHeaders())
      .send({ name: 'White', price: 0, isDefault: true });
    expect(roaRes.status).toBe(201);
    reqOptAId = roaRes.body.id as string;

    const robRes = await http
      .post(`/api/menu-items/${modItemId}/modifier-groups/${reqGroupId}/options`)
      .set(ownerHeaders())
      .send({ name: 'Wheat', price: 0.5, isDefault: false });
    expect(robRes.status).toBe(201);
    reqOptBId = robRes.body.id as string;
    await delay(200);

    // Optional group: Extras (min=0, max=2)
    const ogRes = await http
      .post(`/api/menu-items/${modItemId}/modifier-groups`)
      .set(ownerHeaders())
      .send({ name: 'Extras', minSelections: 0, maxSelections: 2 });
    expect(ogRes.status).toBe(201);
    optGroupId = ogRes.body.id as string;
    await delay(200);

    const ooaRes = await http
      .post(`/api/menu-items/${modItemId}/modifier-groups/${optGroupId}/options`)
      .set(ownerHeaders())
      .send({ name: 'Cheese', price: 1.0, isDefault: false });
    expect(ooaRes.status).toBe(201);
    optOptAId = ooaRes.body.id as string;

    const oobRes = await http
      .post(`/api/menu-items/${modItemId}/modifier-groups/${optGroupId}/options`)
      .set(ownerHeaders())
      .send({ name: 'Bacon', price: 1.5, isDefault: false });
    expect(oobRes.status).toBe(201);
    optOptBId = oobRes.body.id as string;
    await delay(300); // extra wait after modifier chain

    // 8. Clear any stale Redis carts
    await http.delete('/api/carts/my').set(ownerHeaders());
    await http.delete('/api/carts/my').set(otherUserHeaders());
    await http.delete('/api/carts/my').set(authH(customerToken));
  }, 90_000);

  afterAll(async () => {
    const db = getTestDb();
    await db
      .delete(userTable)
      .where(inArray(userTable.email, [...SPEC_ALL_EMAILS]));
    await teardownTestApp(app);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §1  Restaurant & Catalog API
  // ──────────────────────────────────────────────────────────────────────────
  // Creates a second, independent restaurant to verify CRUD without
  // polluting the shared TEST_RESTAURANT_ID used by §2-§6.

  describe('§1 Restaurant & Catalog API', () => {
    let newRestaurantId: string;
    let newZoneId: string;
    let newMenuItemId: string;

    it('R-01 POST /api/restaurants creates restaurant and returns 201', async () => {
      // Use otherUserHeaders() so the snapshot for this restaurant is owned by
      // testAuth.otherUserId, keeping testAuth.ownerUserId's snapshot clean for §6.
      const res = await http
        .post('/api/restaurants')
        .set(otherUserHeaders())
        .send({
          name: 'Spec Test Bistro',
          address: '42 API Street, District 3, HCMC',
          phone: '+84-090-000-0042',
          latitude: 10.78,
          longitude: 106.70,
          cuisineType: 'Vietnamese',
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        name: 'Spec Test Bistro',
        latitude: 10.78,
        longitude: 106.70,
      });
      newRestaurantId = res.body.id as string;
      await delay(200); // wait for RestaurantUpdatedEvent snapshot
    });

    it('R-02 GET /api/restaurants/:id returns the created restaurant', async () => {
      const res = await http.get(`/api/restaurants/${newRestaurantId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(newRestaurantId);
      expect(res.body.name).toBe('Spec Test Bistro');
    });

    it('R-03 PATCH /api/restaurants/:id updates restaurant fields', async () => {
      const res = await http
        .patch(`/api/restaurants/${newRestaurantId}`)
        .set(otherUserHeaders())
        .send({ name: 'Spec Test Bistro Updated', isOpen: true });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Spec Test Bistro Updated');
      await delay(200);
    });

    it('R-04 non-owner PATCH returns 403', async () => {
      // ownerHeaders() is NOT the owner of this restaurant (created by otherUserHeaders())
      const res = await http
        .patch(`/api/restaurants/${newRestaurantId}`)
        .set(ownerHeaders())
        .send({ name: 'Injected Name' });
      expect(res.status).toBe(403);
    });

    it('R-05 unauthenticated PATCH returns 401', async () => {
      const res = await http
        .patch(`/api/restaurants/${newRestaurantId}`)
        .set(noAuthHeaders())
        .send({ name: 'No Token' });
      expect(res.status).toBe(401);
    });

    it('R-06 GET /api/restaurants lists only approved restaurants', async () => {
      const res = await http.get('/api/restaurants');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      // newRestaurantId is NOT approved — must not appear in public listing
      const ids = (res.body.data as { id: string }[]).map((r) => r.id);
      expect(ids).not.toContain(newRestaurantId);
    });

    it('R-07 POST /api/restaurants/:id/delivery-zones creates zone (201)', async () => {
      const res = await http
        .post(`/api/restaurants/${newRestaurantId}/delivery-zones`)
        .set(otherUserHeaders())
        .send({ name: 'Near Zone', radiusKm: 5, baseFee: 10000, perKmRate: 2000 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: expect.any(String),
        restaurantId: newRestaurantId,
        radiusKm: 5,
        baseFee: 10000,
      });
      newZoneId = res.body.id as string;
      await delay(200);
    });

    it('R-08 GET /api/restaurants/:id/delivery-zones lists zones', async () => {
      const res = await http.get(
        `/api/restaurants/${newRestaurantId}/delivery-zones`,
      );
      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((z) => z.id);
      expect(ids).toContain(newZoneId);
    });

    it('R-09 POST /api/menu-items creates a menu item (201)', async () => {
      const res = await http
        .post('/api/menu-items')
        .set(otherUserHeaders())
        .send({
          restaurantId: newRestaurantId,
          name: 'Bistro Salad',
          price: 8.5,
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: expect.any(String),
        name: 'Bistro Salad',
        price: 8.5,
        restaurantId: newRestaurantId,
      });
      newMenuItemId = res.body.id as string;
      await delay(200);
    });

    it('R-10 GET /api/menu-items?restaurantId= lists items for restaurant', async () => {
      const res = await http.get(
        `/api/menu-items?restaurantId=${newRestaurantId}`,
      );
      expect(res.status).toBe(200);
      const ids = (res.body.data as { id: string }[]).map((i) => i.id);
      expect(ids).toContain(newMenuItemId);
    });

    it('R-11 POST /api/menu-items unauthenticated returns 401', async () => {
      const res = await http
        .post('/api/menu-items')
        .set(noAuthHeaders())
        .send({ restaurantId: newRestaurantId, name: 'Ghost Item', price: 5 });
      expect(res.status).toBe(401);
    });

    it('R-12 DELETE /api/restaurants/:id/delivery-zones/:zoneId removes zone', async () => {
      const res = await http
        .delete(
          `/api/restaurants/${newRestaurantId}/delivery-zones/${newZoneId}`,
        )
        .set(otherUserHeaders());
      expect(res.status).toBe(204);
      await delay(200);
    });

    it('R-13 GET deleted zone returns 404 (authenticated)', async () => {
      // GET single zone requires authentication (not @AllowAnonymous)
      const res = await http
        .get(`/api/restaurants/${newRestaurantId}/delivery-zones/${newZoneId}`)
        .set(ownerHeaders());
      expect(res.status).toBe(404);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §2  ACL Snapshot Projection
  // ──────────────────────────────────────────────────────────────────────────

  describe('§2 ACL Snapshot Projection', () => {
    it('S-01 restaurant snapshot exists with correct ownerId and lat/lng', async () => {
      const snap = await getRestaurantSnapshot(TEST_RESTAURANT_ID);
      expect(snap).not.toBeNull();
      expect(snap!.ownerId).toBe(testAuth.ownerUserId);
      expect(snap!.isOpen).toBe(true);
      expect(snap!.isApproved).toBe(true);
      expect(snap!.latitude).toBeCloseTo(RESTAURANT_LAT, 3);
      expect(snap!.longitude).toBeCloseTo(RESTAURANT_LNG, 3);
    });

    it('S-02 delivery zone snapshot exists after zone creation', async () => {
      const snap = await getDeliveryZoneSnapshot(zoneId);
      expect(snap).not.toBeNull();
      expect(snap!.restaurantId).toBe(TEST_RESTAURANT_ID);
      expect(snap!.baseFee).toBe(ZONE_BASE_FEE);
      expect(snap!.radiusKm).toBe(ZONE_RADIUS_KM);
      expect(snap!.isDeleted).toBe(false);
    });

    it('S-03 menu item snapshot exists for basic item', async () => {
      const snap = await getSnapshot(basicItemId);
      expect(snap).not.toBeNull();
      expect(snap!.name).toBe('Plain Burger');
      expect(snap!.price).toBe(10.0);
      expect(snap!.status).toBe('available');
      expect(snap!.restaurantId).toBe(TEST_RESTAURANT_ID);
    });

    it('S-04 modifiers item snapshot contains all modifier groups', async () => {
      const snap = await getSnapshot(modItemId);
      expect(snap).not.toBeNull();
      const mods = snap!.modifiers as { groupId: string }[] | null;
      expect(mods).not.toBeNull();
      const groupIds = mods!.map((m) => m.groupId);
      expect(groupIds).toContain(reqGroupId);
      expect(groupIds).toContain(optGroupId);
    });

    it('S-05 snapshot updates when restaurant name is patched', async () => {
      await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}`)
        .set(ownerHeaders())
        .send({ name: 'E2E Test Restaurant v2' });
      await delay(200);
      const snap = await getRestaurantSnapshot(TEST_RESTAURANT_ID);
      expect(snap!.name).toBe('E2E Test Restaurant v2');

      // Restore original name
      await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}`)
        .set(ownerHeaders())
        .send({ name: 'E2E Test Restaurant' });
      await delay(200);
    });

    it('S-06 menu item snapshot price updates after PATCH', async () => {
      await http
        .patch(`/api/menu-items/${basicItemId}`)
        .set(ownerHeaders())
        .send({ price: 12.0 });
      await delay(200);
      const snap = await getSnapshot(basicItemId);
      expect(snap!.price).toBe(12.0);

      // Restore original price
      await http
        .patch(`/api/menu-items/${basicItemId}`)
        .set(ownerHeaders())
        .send({ price: 10.0 });
      await delay(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §3  Cart Flow
  // ──────────────────────────────────────────────────────────────────────────

  describe('§3 Cart Flow', () => {
    beforeEach(async () => {
      await http.delete('/api/carts/my').set(authH(customerToken));
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(authH(customerToken));
    });

    /** Convenience: add basicItemId to cart. */
    const addBasic = (token: string, qty = 1) =>
      http
        .post('/api/carts/my/items')
        .set(authH(token))
        .send({
          menuItemId: basicItemId,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'E2E Test Restaurant',
          itemName: 'Plain Burger',
          unitPrice: 10.0,
          quantity: qty,
        });

    it('C-01 GET /api/carts/my returns null body when cart is empty', async () => {
      const res = await http.get('/api/carts/my').set(authH(customerToken));
      expect(res.status).toBe(200);
      expect(res.body?.cartId).toBeUndefined();
    });

    it('C-02 POST /api/carts/my/items returns 201 with CartResponseDto', async () => {
      const res = await addBasic(customerToken);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        cartId: expect.any(String),
        restaurantId: TEST_RESTAURANT_ID,
        items: expect.arrayContaining([
          expect.objectContaining({ menuItemId: basicItemId, quantity: 1 }),
        ]),
      });
    });

    it('C-03 same item + same modifiers merges quantity', async () => {
      await addBasic(customerToken, 2);
      const res = await addBasic(customerToken, 3);
      expect(res.status).toBe(201);
      const item = (
        res.body.items as { menuItemId: string; quantity: number }[]
      ).find((i) => i.menuItemId === basicItemId);
      expect(item?.quantity).toBe(5); // 2 + 3 merged
    });

    it('C-04 same item + different modifiers appends new cart line', async () => {
      const payload = (optionId: string) => ({
        menuItemId: modItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'E2E Test Restaurant',
        itemName: 'Fancy Burger',
        unitPrice: 15.0,
        quantity: 1,
        selectedOptions: [{ groupId: reqGroupId, optionId }],
      });
      await http
        .post('/api/carts/my/items')
        .set(authH(customerToken))
        .send(payload(reqOptAId));
      const res = await http
        .post('/api/carts/my/items')
        .set(authH(customerToken))
        .send(payload(reqOptBId)); // different modifier → different line
      expect(res.status).toBe(201);
      const lines = (res.body.items as { menuItemId: string }[]).filter(
        (i) => i.menuItemId === modItemId,
      );
      expect(lines.length).toBe(2);
    });

    it('C-05 PATCH /api/carts/my/items/:cartItemId updates quantity', async () => {
      const addRes = await addBasic(customerToken);
      const cartItemId = (
        addRes.body.items as { cartItemId: string; menuItemId: string }[]
      ).find((i) => i.menuItemId === basicItemId)!.cartItemId;

      const res = await http
        .patch(`/api/carts/my/items/${cartItemId}`)
        .set(authH(customerToken))
        .send({ quantity: 5 });
      expect(res.status).toBe(200);
      const updated = (
        res.body.items as { cartItemId: string; quantity: number }[]
      ).find((i) => i.cartItemId === cartItemId);
      expect(updated?.quantity).toBe(5);
    });

    it('C-06 PATCH quantity to 0 removes the line item', async () => {
      const addRes = await addBasic(customerToken);
      const cartItemId = (
        addRes.body.items as { cartItemId: string; menuItemId: string }[]
      ).find((i) => i.menuItemId === basicItemId)!.cartItemId;

      const res = await http
        .patch(`/api/carts/my/items/${cartItemId}`)
        .set(authH(customerToken))
        .send({ quantity: 0 });
      // 204 when cart is empty after removal, 200 if items remain
      expect([200, 204]).toContain(res.status);
    });

    it('C-07 DELETE /api/carts/my/items/:cartItemId removes specific line', async () => {
      const addRes = await addBasic(customerToken, 2);
      const cartItemId = (
        addRes.body.items as { cartItemId: string; menuItemId: string }[]
      ).find((i) => i.menuItemId === basicItemId)!.cartItemId;

      const res = await http
        .delete(`/api/carts/my/items/${cartItemId}`)
        .set(authH(customerToken));
      expect([200, 204]).toContain(res.status);
    });

    it('C-08 PATCH /api/carts/my/items/:id/modifiers replaces selected options', async () => {
      const addRes = await http
        .post('/api/carts/my/items')
        .set(authH(customerToken))
        .send({
          menuItemId: modItemId,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'E2E Test Restaurant',
          itemName: 'Fancy Burger',
          unitPrice: 15.0,
          quantity: 1,
          selectedOptions: [{ groupId: reqGroupId, optionId: reqOptAId }],
        });
      expect(addRes.status).toBe(201);
      const cartItemId = (
        addRes.body.items as { cartItemId: string; menuItemId: string }[]
      ).find((i) => i.menuItemId === modItemId)!.cartItemId;

      const res = await http
        .patch(`/api/carts/my/items/${cartItemId}/modifiers`)
        .set(authH(customerToken))
        .send({
          selectedOptions: [
            { groupId: reqGroupId, optionId: reqOptBId },
            { groupId: optGroupId, optionId: optOptAId },
          ],
        });
      expect(res.status).toBe(200);
      const updatedItem = (
        res.body.items as {
          cartItemId: string;
          selectedModifiers: { optionId: string }[];
        }[]
      ).find((i) => i.cartItemId === cartItemId);
      expect(updatedItem).toBeDefined();
      const optionIds = updatedItem!.selectedModifiers.map((m) => m.optionId);
      expect(optionIds).toContain(reqOptBId);
      expect(optionIds).toContain(optOptAId);
    });

    it('C-09 adding item from different restaurant returns 409', async () => {
      await addBasic(customerToken);
      const res = await http
        .post('/api/carts/my/items')
        .set(authH(customerToken))
        .send({
          menuItemId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          restaurantId: 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', // different restaurant
          restaurantName: 'Other Restaurant',
          itemName: 'Other Dish',
          unitPrice: 5.0,
          quantity: 1,
        });
      expect(res.status).toBe(409);
    });

    it('C-10 quantity exceeding max (>99) returns 400', async () => {
      // Cart DTO enforces @Max(99) on quantity — class-validator rejects it immediately
      const res = await http
        .post('/api/carts/my/items')
        .set(authH(customerToken))
        .send({
          menuItemId: basicItemId,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'E2E Test Restaurant',
          itemName: 'Plain Burger',
          unitPrice: 10.0,
          quantity: 100, // exceeds @Max(99)
        });
      expect(res.status).toBe(400);
    });

    it('C-11 DELETE /api/carts/my clears entire cart → 204', async () => {
      await addBasic(customerToken);
      const res = await http
        .delete('/api/carts/my')
        .set(authH(customerToken));
      expect(res.status).toBe(204);
      const cartRes = await http.get('/api/carts/my').set(authH(customerToken));
      expect(cartRes.body?.cartId).toBeUndefined();
    });

    it('C-12 GET /api/carts/my without auth returns 401', async () => {
      const res = await http.get('/api/carts/my').set(noAuthHeaders());
      expect(res.status).toBe(401);
    });

    it('C-13 POST /api/carts/my/items without auth returns 401', async () => {
      const res = await http
        .post('/api/carts/my/items')
        .set(noAuthHeaders())
        .send({
          menuItemId: basicItemId,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'E2E Test Restaurant',
          itemName: 'Plain Burger',
          unitPrice: 10.0,
          quantity: 1,
        });
      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §4  Checkout Flow
  // ──────────────────────────────────────────────────────────────────────────

  describe('§4 Checkout Flow', () => {
    /** Fill the cart with one basic burger, clearing any stale state first. */
    async function fillCart(token: string, qty = 1): Promise<void> {
      await http.delete('/api/carts/my').set(authH(token));
      await http.post('/api/carts/my/items').set(authH(token)).send({
        menuItemId: basicItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'E2E Test Restaurant',
        itemName: 'Plain Burger',
        unitPrice: 10.0,
        quantity: qty,
      });
    }

    afterEach(async () => {
      await http.delete('/api/carts/my').set(authH(customerToken));
    });

    it('O-01 Scenario A — no GPS → shippingFee=0, estimatedDeliveryMinutes=null', async () => {
      await fillCart(customerToken);
      const res = await http
        .post('/api/carts/my/checkout')
        .set(authH(customerToken))
        .send({ deliveryAddress: ADDR_NO_GPS, paymentMethod: 'cod' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        orderId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
        status: 'pending',
        shippingFee: 0,
        paymentMethod: 'cod',
        createdAt: expect.any(String),
      });
      expect(res.body.estimatedDeliveryMinutes).toBeNull();
      expect(res.body.paymentUrl == null).toBe(true);
    });

    it('O-02 Scenario B — GPS inside zone → shippingFee=ZONE_BASE_FEE, eta>0', async () => {
      await fillCart(customerToken);
      const res = await http
        .post('/api/carts/my/checkout')
        .set(authH(customerToken))
        .send({ deliveryAddress: ADDR_NEARBY, paymentMethod: 'cod' });
      expect(res.status).toBe(201);
      // perKmRate=0 so fee = baseFee exactly
      expect(res.body.shippingFee).toBe(ZONE_BASE_FEE);
      expect(res.body.estimatedDeliveryMinutes).toBeGreaterThan(0);
      // totalAmount = items total (10.0 * 1) + shippingFee
      expect(res.body.totalAmount).toBe(10.0 + ZONE_BASE_FEE);
    });

    it('O-03 Scenario C — GPS outside every zone → 422', async () => {
      await fillCart(customerToken);
      const res = await http
        .post('/api/carts/my/checkout')
        .set(authH(customerToken))
        .send({ deliveryAddress: ADDR_FAR, paymentMethod: 'cod' });
      expect(res.status).toBe(422);
    });

    it('O-04 Scenario D — same X-Idempotency-Key → same orderId on retry', async () => {
      await fillCart(customerToken);
      const idempotencyKey = randomUUID();
      const r1 = await http
        .post('/api/carts/my/checkout')
        .set(authH(customerToken))
        .set('X-Idempotency-Key', idempotencyKey)
        .send({ deliveryAddress: ADDR_NO_GPS, paymentMethod: 'cod' });
      expect(r1.status).toBe(201);
      const orderId1 = r1.body.orderId as string;

      // Retry with same key — cart already cleared but idempotency returns same order
      const r2 = await http
        .post('/api/carts/my/checkout')
        .set(authH(customerToken))
        .set('X-Idempotency-Key', idempotencyKey)
        .send({ deliveryAddress: ADDR_NO_GPS, paymentMethod: 'cod' });
      expect(r2.status).toBe(201);
      expect(r2.body.orderId).toBe(orderId1);
    });

    it('O-05 different X-Idempotency-Keys create distinct orders', async () => {
      await fillCart(customerToken);
      const r1 = await http
        .post('/api/carts/my/checkout')
        .set(authH(customerToken))
        .set('X-Idempotency-Key', randomUUID())
        .send({ deliveryAddress: ADDR_NO_GPS, paymentMethod: 'cod' });
      expect(r1.status).toBe(201);

      await fillCart(customerToken);
      const r2 = await http
        .post('/api/carts/my/checkout')
        .set(authH(customerToken))
        .set('X-Idempotency-Key', randomUUID())
        .send({ deliveryAddress: ADDR_NO_GPS, paymentMethod: 'cod' });
      expect(r2.status).toBe(201);
      expect(r2.body.orderId).not.toBe(r1.body.orderId);
    });

    it('O-06 cart is cleared after successful checkout', async () => {
      await fillCart(customerToken);
      await http
        .post('/api/carts/my/checkout')
        .set(authH(customerToken))
        .send({ deliveryAddress: ADDR_NO_GPS, paymentMethod: 'cod' });
      const cartRes = await http.get('/api/carts/my').set(authH(customerToken));
      expect(cartRes.body?.cartId).toBeUndefined();
    });

    it('O-07 empty cart checkout → 400', async () => {
      await http.delete('/api/carts/my').set(authH(customerToken));
      const res = await http
        .post('/api/carts/my/checkout')
        .set(authH(customerToken))
        .send({ deliveryAddress: ADDR_NO_GPS, paymentMethod: 'cod' });
      expect(res.status).toBe(400);
    });

    it('O-08 DB order_items use ACL snapshot price (not client-supplied price)', async () => {
      await http.delete('/api/carts/my').set(authH(customerToken));
      // Deliberately supply wrong unitPrice — PlaceOrderHandler must use ACL snapshot
      await http.post('/api/carts/my/items').set(authH(customerToken)).send({
        menuItemId: basicItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'E2E Test Restaurant',
        itemName: 'Plain Burger',
        unitPrice: 999.0, // wrong — ACL price is 10.0
        quantity: 1,
      });
      const res = await http
        .post('/api/carts/my/checkout')
        .set(authH(customerToken))
        .send({ deliveryAddress: ADDR_NO_GPS, paymentMethod: 'cod' });
      expect(res.status).toBe(201);
      const items = await getOrderItems(res.body.orderId as string);
      expect(items[0].unitPrice).toBe(10.0); // ACL snapshot price wins
      expect(res.body.totalAmount).toBe(10.0);
    });

    it('O-09 DB order row has correct status, totalAmount, shippingFee', async () => {
      await fillCart(customerToken, 2);
      const res = await http
        .post('/api/carts/my/checkout')
        .set(authH(customerToken))
        .send({ deliveryAddress: ADDR_NO_GPS, paymentMethod: 'cod' });
      expect(res.status).toBe(201);
      const order = await getOrder(res.body.orderId as string);
      expect(order).not.toBeNull();
      expect(order!.status).toBe('pending');
      expect(order!.shippingFee).toBe(0);
      expect(order!.totalAmount).toBe(20.0); // 10.0 × qty 2
      expect(order!.estimatedDeliveryMinutes).toBeNull();
    });

    it('O-10 unauthenticated checkout → 401', async () => {
      const res = await http
        .post('/api/carts/my/checkout')
        .set(noAuthHeaders())
        .send({ deliveryAddress: ADDR_NO_GPS, paymentMethod: 'cod' });
      expect(res.status).toBe(401);
    });

    it('O-11 missing required deliveryAddress fields → 400', async () => {
      await fillCart(customerToken);
      const res = await http
        .post('/api/carts/my/checkout')
        .set(authH(customerToken))
        .send({
          deliveryAddress: { street: '1 Road' }, // missing district + city
          paymentMethod: 'cod',
        });
      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §5  Order Lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  describe('§5 Order Lifecycle', () => {
    // ── Shared lifecycle helpers ─────────────────────────────────────────────

    /** Place a COD order with one basic burger and return the orderId. */
    async function placeOrder(
      token: string,
      paymentMethod: 'cod' | 'vnpay' = 'cod',
    ): Promise<string> {
      await http.delete('/api/carts/my').set(authH(token));
      await http.post('/api/carts/my/items').set(authH(token)).send({
        menuItemId: basicItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'E2E Test Restaurant',
        itemName: 'Plain Burger',
        unitPrice: 10.0,
        quantity: 1,
      });
      const res = await http
        .post('/api/carts/my/checkout')
        .set(authH(token))
        .send({ deliveryAddress: ADDR_NO_GPS, paymentMethod });
      expect(res.status).toBe(201);
      return res.body.orderId as string;
    }

    const confirm = (id: string, t: string) =>
      http.patch(`/api/orders/${id}/confirm`).set(authH(t));
    const prepare = (id: string, t: string) =>
      http.patch(`/api/orders/${id}/start-preparing`).set(authH(t));
    const ready = (id: string, t: string) =>
      http.patch(`/api/orders/${id}/ready`).set(authH(t));
    const pickup = (id: string, t: string) =>
      http.patch(`/api/orders/${id}/pickup`).set(authH(t));
    const enRoute = (id: string, t: string) =>
      http.patch(`/api/orders/${id}/en-route`).set(authH(t));
    const deliver = (id: string, t: string) =>
      http.patch(`/api/orders/${id}/deliver`).set(authH(t));
    const cancelOrder = (id: string, t: string, reason = 'Test reason') =>
      http
        .patch(`/api/orders/${id}/cancel`)
        .set(authH(t))
        .send({ reason });
    const refund = (id: string, t: string, reason = 'Refund reason') =>
      http.post(`/api/orders/${id}/refund`).set(authH(t)).send({ reason });

    // ── §5.1 Happy path COD ─────────────────────────────────────────────────

    describe('§5.1 Happy path — full COD lifecycle', () => {
      let orderId: string;

      beforeAll(async () => {
        orderId = await placeOrder(customerToken);
      });

      it('L-01 order created with status=pending', async () => {
        const order = await getOrder(orderId);
        expect(order!.status).toBe('pending');
        expect(order!.paymentMethod).toBe('cod');
        expect(order!.customerId).toBe(customerId);
      });

      it('L-02 restaurant confirms → status=confirmed (T-01)', async () => {
        const res = await confirm(orderId, testAuth.ownerToken);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('confirmed');
      });

      it('L-03 restaurant starts preparing → status=preparing (T-06)', async () => {
        const res = await prepare(orderId, testAuth.ownerToken);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('preparing');
      });

      it('L-04 restaurant marks ready → status=ready_for_pickup (T-08)', async () => {
        const res = await ready(orderId, testAuth.ownerToken);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ready_for_pickup');
      });

      it('L-05 shipper picks up → status=picked_up, shipperId recorded (T-09)', async () => {
        const res = await pickup(orderId, shipperToken);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('picked_up');
        const order = await getOrder(orderId);
        expect(order!.shipperId).toBe(shipperId);
      });

      it('L-06 shipper en route → status=delivering (T-10)', async () => {
        const res = await enRoute(orderId, shipperToken);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('delivering');
      });

      it('L-07 shipper delivers → status=delivered (T-11)', async () => {
        const res = await deliver(orderId, shipperToken);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('delivered');
      });

      it('L-08 GET /api/orders/:id returns correct { order, items } shape', async () => {
        const res = await http
          .get(`/api/orders/${orderId}`)
          .set(authH(customerToken));
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('order');
        expect(res.body).toHaveProperty('items');
        expect(res.body.order.id).toBe(orderId);
        expect(res.body.order.status).toBe('delivered');
        expect(Array.isArray(res.body.items)).toBe(true);
        expect(res.body.items).toHaveLength(1);
      });

      it('L-09 GET /api/orders/:id/timeline has ≥7 entries oldest-first', async () => {
        const res = await http
          .get(`/api/orders/${orderId}/timeline`)
          .set(authH(customerToken));
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        // null→pending + 6 transitions = 7 entries
        expect(res.body).toHaveLength(7);
        expect(res.body[0].fromStatus).toBeNull();
        expect(res.body[0].toStatus).toBe('pending');
        expect(res.body[6].toStatus).toBe('delivered');
      });
    });

    // ── §5.2 T-12 admin refund ──────────────────────────────────────────────

    describe('§5.2 T-12 Admin refund (delivered → refunded)', () => {
      let orderId: string;

      beforeAll(async () => {
        orderId = await placeOrder(customerToken);
        await confirm(orderId, testAuth.ownerToken);
        await prepare(orderId, testAuth.ownerToken);
        await ready(orderId, testAuth.ownerToken);
        await pickup(orderId, shipperToken);
        await enRoute(orderId, shipperToken);
        await deliver(orderId, shipperToken);
      });

      it('L-10 admin can refund a delivered order → status=refunded', async () => {
        const res = await refund(orderId, adminToken, 'Customer dispute');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('refunded');
      });

      it('L-11 non-admin (customer) cannot refund → 403', async () => {
        // Advance another order to delivered
        const id2 = await placeOrder(customerToken);
        await confirm(id2, testAuth.ownerToken);
        await prepare(id2, testAuth.ownerToken);
        await ready(id2, testAuth.ownerToken);
        await pickup(id2, shipperToken);
        await enRoute(id2, shipperToken);
        await deliver(id2, shipperToken);
        const res = await refund(id2, customerToken, 'Self refund');
        expect(res.status).toBe(403);
      });
    });

    // ── §5.3 Customer cancel (pending) ──────────────────────────────────────

    describe('§5.3 Customer cancels pending COD order (T-03)', () => {
      let orderId: string;

      beforeAll(async () => {
        orderId = await placeOrder(customerToken);
      });

      it('L-12 customer can cancel pending order → status=cancelled', async () => {
        const res = await cancelOrder(orderId, customerToken, 'Changed my mind');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('cancelled');
      });
    });

    // ── §5.4 Restaurant cancel (confirmed) ─────────────────────────────────

    describe('§5.4 Restaurant cancels confirmed COD order (T-07)', () => {
      let orderId: string;

      beforeAll(async () => {
        orderId = await placeOrder(customerToken);
        await confirm(orderId, testAuth.ownerToken);
      });

      it('L-13 restaurant can cancel confirmed order → status=cancelled', async () => {
        const res = await cancelOrder(
          orderId,
          testAuth.ownerToken,
          'Out of stock',
        );
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('cancelled');
      });
    });

    // ── §5.5 Invalid transitions → 422 ─────────────────────────────────────

    describe('§5.5 Invalid transitions → 422', () => {
      let pendingOrderId: string;

      beforeAll(async () => {
        pendingOrderId = await placeOrder(customerToken);
      });

      it('L-14 pending → delivering is invalid (422)', async () => {
        const res = await enRoute(pendingOrderId, testAuth.ownerToken);
        expect(res.status).toBe(422);
      });

      it('L-15 pending → delivered is invalid (422)', async () => {
        const res = await deliver(pendingOrderId, testAuth.ownerToken);
        expect(res.status).toBe(422);
      });

      it('L-16 pending → ready_for_pickup is invalid (422)', async () => {
        const res = await ready(pendingOrderId, testAuth.ownerToken);
        expect(res.status).toBe(422);
      });

      it('L-17 non-existent order returns 404', async () => {
        const res = await confirm(
          '00000000-0000-4000-8000-000000000000',
          testAuth.ownerToken,
        );
        expect(res.status).toBe(404);
      });
    });

    // ── §5.6 Permission and role checks ────────────────────────────────────

    describe('§5.6 Permission and role checks (401 / 403)', () => {
      let pendingOrderId: string;
      let readyOrderId: string;

      beforeAll(async () => {
        pendingOrderId = await placeOrder(customerToken);

        readyOrderId = await placeOrder(customerToken);
        await confirm(readyOrderId, testAuth.ownerToken);
        await prepare(readyOrderId, testAuth.ownerToken);
        await ready(readyOrderId, testAuth.ownerToken);
      });

      it('L-18 unauthenticated confirm → 401', async () => {
        const res = await http.patch(
          `/api/orders/${pendingOrderId}/confirm`,
        );
        expect(res.status).toBe(401);
      });

      it('L-19 customer cannot confirm (403)', async () => {
        const res = await confirm(pendingOrderId, customerToken);
        expect(res.status).toBe(403);
      });

      it('L-20 shipper cannot confirm (403)', async () => {
        const res = await confirm(pendingOrderId, shipperToken);
        expect(res.status).toBe(403);
      });

      it('L-21 non-owner restaurant user cannot confirm (ownership — 403)', async () => {
        // otherUserHeaders() is a restaurant-role user who does NOT own TEST_RESTAURANT_ID
        const res = await confirm(pendingOrderId, testAuth.otherToken);
        expect(res.status).toBe(403);
      });

      it('L-22 customer cannot start-preparing a confirmed order (403)', async () => {
        const confirmedId = await placeOrder(customerToken);
        await confirm(confirmedId, testAuth.ownerToken);
        const res = await prepare(confirmedId, customerToken);
        expect(res.status).toBe(403);
      });

      it('L-23 non-assigned shipper cannot deliver (403)', async () => {
        // readyOrderId was advanced to ready_for_pickup by owner
        // Pick up with shipper
        await pickup(readyOrderId, shipperToken);
        await enRoute(readyOrderId, shipperToken);
        // A different shipper (use ownerToken which resolves to 'restaurant', not shipper)
        // Actually test with adminToken — admin can deliver but that's allowed
        // Use otherUserHeaders (restaurant role) who is NOT the assigned shipper
        // The delivering endpoint requires the assigned shipper or admin
        const res = await deliver(readyOrderId, testAuth.otherToken);
        // 403 because otherToken resolves to 'restaurant' role and restaurant cannot deliver
        expect(res.status).toBe(403);
      });
    });

    // ── §5.7 Note required for cancel/refund → 400 ─────────────────────────

    describe('§5.7 Note required for cancel and refund (400)', () => {
      it('L-24 cancel without reason field → 400', async () => {
        const orderId = await placeOrder(customerToken);
        const res = await http
          .patch(`/api/orders/${orderId}/cancel`)
          .set(authH(customerToken))
          .send({}); // missing reason
        expect(res.status).toBe(400);
      });

      it('L-25 cancel with whitespace-only reason → 400', async () => {
        const orderId = await placeOrder(customerToken);
        const res = await http
          .patch(`/api/orders/${orderId}/cancel`)
          .set(authH(customerToken))
          .send({ reason: '   ' });
        expect(res.status).toBe(400);
      });

      it('L-26 refund without reason → 400', async () => {
        const orderId = await placeOrder(customerToken);
        await confirm(orderId, testAuth.ownerToken);
        await prepare(orderId, testAuth.ownerToken);
        await ready(orderId, testAuth.ownerToken);
        await pickup(orderId, shipperToken);
        await enRoute(orderId, shipperToken);
        await deliver(orderId, shipperToken);
        const res = await http
          .post(`/api/orders/${orderId}/refund`)
          .set(authH(adminToken))
          .send({});
        expect(res.status).toBe(400);
      });
    });

    // ── §5.8 GET /orders/:id and /timeline ─────────────────────────────────

    describe('§5.8 GET /api/orders/:id and GET /api/orders/:id/timeline', () => {
      let orderId: string;

      beforeAll(async () => {
        orderId = await placeOrder(customerToken);
        await confirm(orderId, testAuth.ownerToken);
      });

      it('L-27 GET /api/orders/:id returns { order, items } shape', async () => {
        const res = await http
          .get(`/api/orders/${orderId}`)
          .set(authH(customerToken));
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('order');
        expect(res.body).toHaveProperty('items');
        expect(res.body.order.id).toBe(orderId);
        expect(res.body.order.status).toBe('confirmed');
        expect(Array.isArray(res.body.items)).toBe(true);
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0].menuItemId).toBe(basicItemId);
      });

      it('L-28 GET /api/orders/:id with non-existent UUID → 404', async () => {
        const res = await http
          .get('/api/orders/00000000-0000-4000-8000-000000000001')
          .set(authH(customerToken));
        expect(res.status).toBe(404);
      });

      it('L-29 GET /api/orders/:id with invalid UUID → 400', async () => {
        const res = await http
          .get('/api/orders/not-a-uuid')
          .set(authH(customerToken));
        expect(res.status).toBe(400);
      });

      it('L-30 GET /api/orders/:id/timeline returns entries oldest-first', async () => {
        const res = await http
          .get(`/api/orders/${orderId}/timeline`)
          .set(authH(customerToken));
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        // entry[0] = null→pending (created by checkout), entry[1] = pending→confirmed
        expect(res.body).toHaveLength(2);
        expect(res.body[0].fromStatus).toBeNull();
        expect(res.body[0].toStatus).toBe('pending');
        expect(res.body[1].fromStatus).toBe('pending');
        expect(res.body[1].toStatus).toBe('confirmed');
        expect(res.body[1].triggeredByRole).toBe('restaurant');
      });

      it('L-31 GET /api/orders/:id/timeline without auth → 401', async () => {
        const res = await http.get(`/api/orders/${orderId}/timeline`);
        expect(res.status).toBe(401);
      });

      it('L-32 GET /api/orders/:id without auth → 401', async () => {
        const res = await http.get(`/api/orders/${orderId}`);
        expect(res.status).toBe(401);
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §6  Order History — Phase 7
  // ──────────────────────────────────────────────────────────────────────────

  describe('§6 Order History (Phase 7)', () => {
    // These orders are created fresh for §6 to ensure predictable state.
    let pendingOrderId: string; // customer's pending order
    let deliveredOrderId: string; // advanced all the way to delivered

    beforeAll(async () => {
      // Place pending order
      await http.delete('/api/carts/my').set(authH(customerToken));
      await http.post('/api/carts/my/items').set(authH(customerToken)).send({
        menuItemId: basicItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'E2E Test Restaurant',
        itemName: 'Plain Burger',
        unitPrice: 10.0,
        quantity: 1,
      });
      const pr = await http
        .post('/api/carts/my/checkout')
        .set(authH(customerToken))
        .send({ deliveryAddress: ADDR_NO_GPS, paymentMethod: 'cod' });
      expect(pr.status).toBe(201);
      pendingOrderId = pr.body.orderId as string;

      // Place and advance a second order to delivered
      await http.delete('/api/carts/my').set(authH(customerToken));
      await http.post('/api/carts/my/items').set(authH(customerToken)).send({
        menuItemId: basicItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'E2E Test Restaurant',
        itemName: 'Plain Burger',
        unitPrice: 10.0,
        quantity: 2,
      });
      const dr = await http
        .post('/api/carts/my/checkout')
        .set(authH(customerToken))
        .send({ deliveryAddress: ADDR_NO_GPS, paymentMethod: 'cod' });
      expect(dr.status).toBe(201);
      deliveredOrderId = dr.body.orderId as string;

      await http
        .patch(`/api/orders/${deliveredOrderId}/confirm`)
        .set(ownerHeaders());
      await http
        .patch(`/api/orders/${deliveredOrderId}/start-preparing`)
        .set(ownerHeaders());
      await http
        .patch(`/api/orders/${deliveredOrderId}/ready`)
        .set(ownerHeaders());
      await http
        .patch(`/api/orders/${deliveredOrderId}/pickup`)
        .set(authH(shipperToken));
      await http
        .patch(`/api/orders/${deliveredOrderId}/en-route`)
        .set(authH(shipperToken));
      await http
        .patch(`/api/orders/${deliveredOrderId}/deliver`)
        .set(authH(shipperToken));
    }, 30_000);

    // ── §6.1 Customer history ───────────────────────────────────────────────

    describe('§6.1 Customer history', () => {
      it('H-01 GET /api/orders/my returns paginated list containing customer orders', async () => {
        const res = await http
          .get('/api/orders/my')
          .set(authH(customerToken));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          data: expect.any(Array),
          total: expect.any(Number),
          limit: 20,
          offset: 0,
        });
        const orderIds = (
          res.body.data as { orderId: string }[]
        ).map((o) => o.orderId);
        expect(orderIds).toContain(pendingOrderId);
        expect(orderIds).toContain(deliveredOrderId);
      });

      it('H-02 GET /api/orders/my?status=pending filters by status', async () => {
        const res = await http
          .get('/api/orders/my?status=pending')
          .set(authH(customerToken));
        expect(res.status).toBe(200);
        const statuses = (
          res.body.data as { status: string }[]
        ).map((o) => o.status);
        expect(statuses.every((s) => s === 'pending')).toBe(true);
      });

      it('H-03 GET /api/orders/my?status=delivered filters by status', async () => {
        const res = await http
          .get('/api/orders/my?status=delivered')
          .set(authH(customerToken));
        expect(res.status).toBe(200);
        const orderIds = (
          res.body.data as { orderId: string }[]
        ).map((o) => o.orderId);
        expect(orderIds).toContain(deliveredOrderId);
      });

      it('H-04 GET /api/orders/my/:id returns full OrderDetailDto', async () => {
        const res = await http
          .get(`/api/orders/my/${deliveredOrderId}`)
          .set(authH(customerToken));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          orderId: deliveredOrderId,
          status: 'delivered',
          restaurantId: TEST_RESTAURANT_ID,
          paymentMethod: 'cod',
          totalAmount: expect.any(Number),
          shippingFee: 0,
          items: expect.arrayContaining([
            expect.objectContaining({ menuItemId: basicItemId }),
          ]),
          timeline: expect.arrayContaining([
            expect.objectContaining({ toStatus: 'pending' }),
          ]),
          deliveryAddress: expect.objectContaining({
            street: ADDR_NO_GPS.street,
          }),
        });
      });

      it('H-05 GET /api/orders/my/:id with another customer returns 404 (info-leak prevention)', async () => {
        // Owner (restaurant role) tries to access customer's private order detail
        const res = await http
          .get(`/api/orders/my/${deliveredOrderId}`)
          .set(ownerHeaders());
        expect(res.status).toBe(404);
      });

      it('H-06 GET /api/orders/my/:id/reorder returns ReorderItemDto[]', async () => {
        const res = await http
          .get(`/api/orders/my/${deliveredOrderId}/reorder`)
          .set(authH(customerToken));
        expect(res.status).toBe(200);
        expect(res.body).toBeInstanceOf(Array);
        const items = res.body as { menuItemId: string }[];
        expect(items.length).toBeGreaterThan(0);
        expect(items[0].menuItemId).toBe(basicItemId);
      });

      it('H-07 GET /api/orders/my with non-existent orderId → 404', async () => {
        const res = await http
          .get(`/api/orders/my/${randomUUID()}`)
          .set(authH(customerToken));
        expect(res.status).toBe(404);
      });

      it('H-08 GET /api/orders/my → 401 without token', async () => {
        const res = await http.get('/api/orders/my').set(noAuthHeaders());
        expect(res.status).toBe(401);
      });

      it('H-09 GET /api/orders/my supports pagination (limit + offset)', async () => {
        const res = await http
          .get('/api/orders/my?limit=1&offset=0')
          .set(authH(customerToken));
        expect(res.status).toBe(200);
        expect(res.body.limit).toBe(1);
        expect(res.body.data).toHaveLength(1);
      });
    });

    // ── §6.2 Restaurant history ─────────────────────────────────────────────

    describe('§6.2 Restaurant order history', () => {
      it('H-10 GET /api/restaurant/orders returns paginated list for owner', async () => {
        const res = await http
          .get('/api/restaurant/orders')
          .set(ownerHeaders());
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          data: expect.any(Array),
          total: expect.any(Number),
        });
        const orderIds = (
          res.body.data as { orderId: string }[]
        ).map((o) => o.orderId);
        expect(orderIds).toContain(deliveredOrderId);
      });

      it('H-11 GET /api/restaurant/orders/active returns active (non-terminal) orders', async () => {
        const res = await http
          .get('/api/restaurant/orders/active')
          .set(ownerHeaders());
        expect(res.status).toBe(200);
        expect(res.body).toBeInstanceOf(Array);
        // Verify only active statuses are returned
        const statuses = (res.body as { status: string }[]).map((o) => o.status);
        const terminal = ['delivered', 'cancelled', 'refunded'];
        expect(statuses.every((s) => !terminal.includes(s))).toBe(true);
      });

      it('H-12 customer cannot access /api/restaurant/orders (403)', async () => {
        const res = await http
          .get('/api/restaurant/orders')
          .set(authH(customerToken));
        expect(res.status).toBe(403);
      });

      it('H-13 restaurant owner without snapshot → 403', async () => {
        // emptyRestaurantToken has 'restaurant' role but no restaurant snapshot
        const res = await http
          .get('/api/restaurant/orders')
          .set(authH(emptyRestaurantToken));
        expect(res.status).toBe(403);
      });

      it('H-14 GET /api/restaurant/orders → 401 without token', async () => {
        const res = await http
          .get('/api/restaurant/orders')
          .set(noAuthHeaders());
        expect(res.status).toBe(401);
      });

      it('H-15 GET /api/restaurant/orders supports status filter', async () => {
        const res = await http
          .get('/api/restaurant/orders?status=delivered')
          .set(ownerHeaders());
        expect(res.status).toBe(200);
        const statuses = (
          res.body.data as { status: string }[]
        ).map((o) => o.status);
        expect(statuses.every((s) => s === 'delivered')).toBe(true);
      });
    });

    // ── §6.3 Shipper order views ────────────────────────────────────────────

    describe('§6.3 Shipper order views', () => {
      it('H-16 GET /api/shipper/orders/available returns ready_for_pickup orders', async () => {
        const res = await http
          .get('/api/shipper/orders/available')
          .set(authH(shipperToken));
        expect(res.status).toBe(200);
        expect(res.body).toBeInstanceOf(Array);
        // All returned orders should be in ready_for_pickup state
        const statuses = (res.body as { status: string }[]).map((o) => o.status);
        expect(statuses.every((s) => s === 'ready_for_pickup')).toBe(true);
      });

      it('H-17 GET /api/shipper/orders/active returns [] (not null) when no active delivery', async () => {
        // After delivering deliveredOrderId, shipper has no active orders
        const res = await http
          .get('/api/shipper/orders/active')
          .set(authH(shipperToken));
        expect(res.status).toBe(200);
        // Must return an array — never null (Phase 7 BUG-2 fix)
        expect(Array.isArray(res.body)).toBe(true);
        // No active delivery after delivering the order in beforeAll
        const activeOrderIds = (res.body as { orderId: string }[]).map(
          (o) => o.orderId,
        );
        expect(activeOrderIds).not.toContain(deliveredOrderId);
      });

      it('H-18 GET /api/shipper/orders/history returns delivered orders for this shipper', async () => {
        const res = await http
          .get('/api/shipper/orders/history')
          .set(authH(shipperToken));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          data: expect.any(Array),
          total: expect.any(Number),
        });
        const orderIds = (
          res.body.data as { orderId: string }[]
        ).map((o) => o.orderId);
        expect(orderIds).toContain(deliveredOrderId);
      });

      it('H-19 customer cannot access /api/shipper/orders/available (403)', async () => {
        const res = await http
          .get('/api/shipper/orders/available')
          .set(authH(customerToken));
        expect(res.status).toBe(403);
      });

      it('H-20 GET /api/shipper/orders/available → 401 without token', async () => {
        const res = await http
          .get('/api/shipper/orders/available')
          .set(noAuthHeaders());
        expect(res.status).toBe(401);
      });
    });

    // ── §6.4 Admin order management ────────────────────────────────────────

    describe('§6.4 Admin order management', () => {
      it('H-21 GET /api/admin/orders returns all orders', async () => {
        const res = await http
          .get('/api/admin/orders')
          .set(authH(adminToken));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          data: expect.any(Array),
          total: expect.any(Number),
        });
        const orderIds = (
          res.body.data as { orderId: string }[]
        ).map((o) => o.orderId);
        expect(orderIds).toContain(deliveredOrderId);
        expect(orderIds).toContain(pendingOrderId);
      });

      it('H-22 GET /api/admin/orders?status=delivered filters by status', async () => {
        const res = await http
          .get('/api/admin/orders?status=delivered')
          .set(authH(adminToken));
        expect(res.status).toBe(200);
        const statuses = (
          res.body.data as { status: string }[]
        ).map((o) => o.status);
        expect(statuses.every((s) => s === 'delivered')).toBe(true);
      });

      it('H-23 GET /api/admin/orders?customerId= filters by customer', async () => {
        const res = await http
          .get(`/api/admin/orders?customerId=${customerId}`)
          .set(authH(adminToken));
        expect(res.status).toBe(200);
        // All returned orders belong to this customer
        const orderIds = (
          res.body.data as { orderId: string }[]
        ).map((o) => o.orderId);
        expect(orderIds).toContain(deliveredOrderId);
      });

      it('H-24 GET /api/admin/orders/:id returns full OrderDetailDto', async () => {
        const res = await http
          .get(`/api/admin/orders/${deliveredOrderId}`)
          .set(authH(adminToken));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          orderId: deliveredOrderId,
          status: 'delivered',
          items: expect.any(Array),
          timeline: expect.any(Array),
        });
        expect(res.body.timeline.length).toBeGreaterThanOrEqual(7);
      });

      it('H-25 GET /api/admin/orders/:id with invalid UUID → 400', async () => {
        const res = await http
          .get('/api/admin/orders/not-a-uuid')
          .set(authH(adminToken));
        expect(res.status).toBe(400);
      });

      it('H-26 GET /api/admin/orders/:id non-existent → 404', async () => {
        const res = await http
          .get(`/api/admin/orders/${randomUUID()}`)
          .set(authH(adminToken));
        expect(res.status).toBe(404);
      });

      it('H-27 customer cannot access /api/admin/orders (403)', async () => {
        const res = await http
          .get('/api/admin/orders')
          .set(authH(customerToken));
        expect(res.status).toBe(403);
      });

      it('H-28 GET /api/admin/orders → 401 without token', async () => {
        const res = await http
          .get('/api/admin/orders')
          .set(noAuthHeaders());
        expect(res.status).toBe(401);
      });

      it('H-29 GET /api/admin/orders supports pagination', async () => {
        const res = await http
          .get('/api/admin/orders?limit=2&offset=0')
          .set(authH(adminToken));
        expect(res.status).toBe(200);
        expect(res.body.limit).toBe(2);
        expect((res.body.data as unknown[]).length).toBeLessThanOrEqual(2);
      });
    });
  });
});
