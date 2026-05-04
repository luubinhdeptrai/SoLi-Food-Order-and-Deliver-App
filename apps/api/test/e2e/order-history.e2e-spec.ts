/**
 * order-history.e2e-spec.ts — Phase 7 Order History E2E Tests
 *
 * Follows the E2E Testing Playbook exactly:
 *  - All state changes go through HTTP (no direct DB inserts for orders).
 *  - DB helpers used only for reading state not exposed by the API.
 *  - Real auth via TestAuthManager + per-suite user extensions.
 *  - No mocks — real NestJS app, real DB, real Redis.
 *
 * Users created for this suite (distinct from standard pair to avoid collisions):
 *  OH_OWNER    — 'restaurant' role, owns the test restaurant (from TestAuthManager)
 *  OH_OTHER    — 'restaurant' role, non-owner               (from TestAuthManager)
 *  OH_CUSTOMER — no special role → resolveRole() → 'customer' (places all test orders)
 *  OH_SHIPPER  — 'shipper' role  (picks up and delivers orders)
 *  OH_ADMIN    — 'admin' role    (accesses all orders)
 *
 * Order states seeded in beforeAll:
 *  orderDeliveredId  — pending → confirmed → preparing → ready_for_pickup
 *                       → picked_up → delivering → delivered
 *  orderReadyId      — pending → confirmed → preparing → ready_for_pickup
 *  orderConfirmedId  — pending → confirmed
 *
 * §1   GET /api/orders/my              — customer list (pagination, filters, auth)
 * §2   GET /api/orders/my/:id          — customer detail (own/other/invalid)
 * §3   GET /api/orders/my/:id/reorder  — reorder items
 * §4   GET /api/restaurant/orders      — restaurant list (roles, filters)
 * §5   GET /api/restaurant/orders/active — kitchen view
 * §6   GET /api/shipper/orders/available — available pool
 * §7   GET /api/shipper/orders/active  — active delivery (empty after delivery)
 * §8   GET /api/shipper/orders/history — shipper delivery history
 * §9   GET /api/admin/orders           — admin list (pagination, filters, sort)
 * §10  GET /api/admin/orders/:id       — admin detail (any order, 404, 400)
 */

import type { INestApplication } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';

import { createTestApp, teardownTestApp } from '../setup/app-factory';
import {
  getTestDb,
  resetDb,
  seedBaseRestaurant,
  TEST_RESTAURANT_ID,
} from '../setup/db-setup';
import { TestAuthManager, TEST_PASSWORD } from '../helpers/test-auth';
import {
  noAuthHeaders,
  otherUserHeaders,
  ownerHeaders,
  setAuthManager,
} from '../helpers/auth';
import { user as userTable } from '../../src/module/auth/auth.schema';

// ─── Suite-specific email constants ───────────────────────────────────────────
// Distinct from TEST_OWNER_EMAIL / TEST_OTHER_EMAIL so this suite can run
// alongside other specs without user-table collisions. resetDb() does NOT
// purge these addresses; we delete them manually in beforeAll / afterAll.

const OH_CUSTOMER_EMAIL = 'oh-customer@test.soli';
const OH_SHIPPER_EMAIL = 'oh-shipper@test.soli';
const OH_ADMIN_EMAIL = 'oh-admin@test.soli';
const OH_EXTRA_EMAILS = [OH_CUSTOMER_EMAIL, OH_SHIPPER_EMAIL, OH_ADMIN_EMAIL] as const;

// ─── Timing helper ────────────────────────────────────────────────────────────
// Required after HTTP mutations that fire async CQRS events (restaurant patch,
// menu-item creation) so projectors finish before the next read assertion.
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Delivery address fixture ─────────────────────────────────────────────────
const DELIVERY_ADDRESS = {
  street: '456 History Lane',
  district: 'District 3',
  city: 'Ho Chi Minh City',
};

// ─── Sign-up helper ───────────────────────────────────────────────────────────

async function signUpUser(
  http: ReturnType<typeof request>,
  email: string,
  name: string,
): Promise<{ token: string; userId: string }> {
  const res = await http
    .post('/api/auth/sign-up/email')
    .set('Content-Type', 'application/json')
    .send({ email, password: TEST_PASSWORD, name });

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(
      `signUpUser failed for "${email}" — HTTP ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }

  return {
    token: res.body.token as string,
    userId: res.body.user.id as string,
  };
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─── Cart helpers ─────────────────────────────────────────────────────────────

async function clearCart(
  http: ReturnType<typeof request>,
  token: string,
): Promise<void> {
  await http.delete('/api/carts/my').set(authHeader(token));
}

async function addItemToCart(
  http: ReturnType<typeof request>,
  token: string,
  menuItemId: string,
): Promise<void> {
  const res = await http
    .post('/api/carts/my/items')
    .set(authHeader(token))
    .send({
      menuItemId,
      restaurantId: TEST_RESTAURANT_ID,
      restaurantName: 'E2E Test Restaurant',
      itemName: 'Test Burger',
      unitPrice: 10.0,
      quantity: 1,
    });
  expect(res.status).toBe(201);
}

async function placeOrder(
  http: ReturnType<typeof request>,
  token: string,
  menuItemId: string,
): Promise<string> {
  await clearCart(http, token);
  await addItemToCart(http, token, menuItemId);

  const res = await http
    .post('/api/carts/my/checkout')
    .set(authHeader(token))
    .send({ deliveryAddress: DELIVERY_ADDRESS, paymentMethod: 'cod' });

  expect(res.status).toBe(201);
  return res.body.orderId as string;
}

// ─── Lifecycle transition helpers ─────────────────────────────────────────────

async function confirmOrder(
  http: ReturnType<typeof request>,
  orderId: string,
  token: string,
) {
  return http.patch(`/api/orders/${orderId}/confirm`).set(authHeader(token));
}

async function startPreparing(
  http: ReturnType<typeof request>,
  orderId: string,
  token: string,
) {
  return http
    .patch(`/api/orders/${orderId}/start-preparing`)
    .set(authHeader(token));
}

async function markReady(
  http: ReturnType<typeof request>,
  orderId: string,
  token: string,
) {
  return http.patch(`/api/orders/${orderId}/ready`).set(authHeader(token));
}

async function pickupOrder(
  http: ReturnType<typeof request>,
  orderId: string,
  token: string,
) {
  return http.patch(`/api/orders/${orderId}/pickup`).set(authHeader(token));
}

async function enRoute(
  http: ReturnType<typeof request>,
  orderId: string,
  token: string,
) {
  return http.patch(`/api/orders/${orderId}/en-route`).set(authHeader(token));
}

async function deliverOrder(
  http: ReturnType<typeof request>,
  orderId: string,
  token: string,
) {
  return http.patch(`/api/orders/${orderId}/deliver`).set(authHeader(token));
}

// ─── Main suite ───────────────────────────────────────────────────────────────

describe('Order History E2E (Phase 7)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  // Standard 2-user auth manager (owner + non-owner, both 'restaurant' role)
  let testAuth: TestAuthManager;

  // Extra suite actors
  let customerToken: string;
  let customerId: string;
  let shipperToken: string;
  let shipperId: string;
  let adminToken: string;

  // Menu item (has ACL snapshot after seeding)
  let menuItemId: string;

  // Orders seeded in beforeAll
  let orderDeliveredId: string; // fully delivered
  let orderReadyId: string; // ready_for_pickup
  let orderConfirmedId: string; // confirmed

  // ─── Global setup ─────────────────────────────────────────────────────────

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());

    // 1. Reset all E2E data
    await resetDb();

    // 2. Clean up suite-specific users from any previous run
    const db = getTestDb();
    await db.delete(userTable).where(inArray(userTable.email, OH_EXTRA_EMAILS));

    // 3. Bootstrap the standard 2-user auth manager
    testAuth = new TestAuthManager();
    await testAuth.initialize(http);
    setAuthManager(testAuth);

    // 4. Create extra suite actors
    const customerResult = await signUpUser(http, OH_CUSTOMER_EMAIL, 'OH Customer');
    customerToken = customerResult.token;
    customerId = customerResult.userId;
    // Customer gets NO role update → resolveRole() → 'customer'

    const shipperResult = await signUpUser(http, OH_SHIPPER_EMAIL, 'OH Shipper');
    shipperToken = shipperResult.token;
    shipperId = shipperResult.userId;
    await db
      .update(userTable)
      .set({ role: 'shipper' })
      .where(eq(userTable.id, shipperId));

    const adminResult = await signUpUser(http, OH_ADMIN_EMAIL, 'OH Admin');
    adminToken = adminResult.token;
    await db
      .update(userTable)
      .set({ role: 'admin' })
      .where(eq(userTable.id, adminResult.userId));

    // 5. Seed restaurant row and trigger snapshot projection via PATCH.
    //    seedBaseRestaurant() does a direct DB insert — no event is fired,
    //    so the ordering_restaurant_snapshots table has no row yet.
    //    PATCH triggers RestaurantUpdatedEvent → RestaurantSnapshotProjector.
    await seedBaseRestaurant(testAuth.ownerUserId);
    const patchRes = await http
      .patch(`/api/restaurants/${TEST_RESTAURANT_ID}`)
      .set(ownerHeaders())
      .send({ name: 'E2E Test Restaurant' });
    expect(patchRes.status).toBe(200);
    await delay(200);

    // 6. Create menu item and wait for ACL snapshot.
    //    MenuItemCreatedEvent → MenuItemSnapshotProjector upserts the row.
    const itemRes = await http
      .post('/api/menu-items')
      .set(ownerHeaders())
      .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Test Burger', price: 10.0 });
    expect(itemRes.status).toBe(201);
    menuItemId = itemRes.body.id as string;
    await delay(200);

    // 7. Clear any stale Redis carts from previous runs
    await clearCart(http, testAuth.ownerToken);
    await clearCart(http, testAuth.otherToken);
    await clearCart(http, customerToken);
    await clearCart(http, shipperToken);
    await clearCart(http, adminToken);

    // 8. Place orderDeliveredId and advance through the full lifecycle:
    //    pending → confirmed → preparing → ready_for_pickup
    //    → picked_up → delivering → delivered
    orderDeliveredId = await placeOrder(http, customerToken, menuItemId);
    {
      const r1 = await confirmOrder(http, orderDeliveredId, testAuth.ownerToken);
      expect(r1.status).toBe(200);
      const r2 = await startPreparing(http, orderDeliveredId, testAuth.ownerToken);
      expect(r2.status).toBe(200);
      const r3 = await markReady(http, orderDeliveredId, testAuth.ownerToken);
      expect(r3.status).toBe(200);
      const r4 = await pickupOrder(http, orderDeliveredId, shipperToken);
      expect(r4.status).toBe(200);
      const r5 = await enRoute(http, orderDeliveredId, shipperToken);
      expect(r5.status).toBe(200);
      const r6 = await deliverOrder(http, orderDeliveredId, shipperToken);
      expect(r6.status).toBe(200);
    }

    // 9. Place orderReadyId and advance to ready_for_pickup:
    //    pending → confirmed → preparing → ready_for_pickup
    orderReadyId = await placeOrder(http, customerToken, menuItemId);
    {
      const r1 = await confirmOrder(http, orderReadyId, testAuth.ownerToken);
      expect(r1.status).toBe(200);
      const r2 = await startPreparing(http, orderReadyId, testAuth.ownerToken);
      expect(r2.status).toBe(200);
      const r3 = await markReady(http, orderReadyId, testAuth.ownerToken);
      expect(r3.status).toBe(200);
    }

    // 10. Place orderConfirmedId and advance to confirmed:
    //    pending → confirmed
    orderConfirmedId = await placeOrder(http, customerToken, menuItemId);
    {
      const r1 = await confirmOrder(http, orderConfirmedId, testAuth.ownerToken);
      expect(r1.status).toBe(200);
    }
  }, 60_000); // generous timeout for full lifecycle seeding

  afterAll(async () => {
    const db = getTestDb();
    await db.delete(userTable).where(inArray(userTable.email, OH_EXTRA_EMAILS));
    await teardownTestApp(app);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §1  GET /api/orders/my — Customer order list
  // ──────────────────────────────────────────────────────────────────────────

  describe('§1 GET /api/orders/my — customer order list', () => {
    it('OH-01 returns 200 with paginated list for authenticated customer', async () => {
      const res = await http.get('/api/orders/my').set(authHeader(customerToken));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        data: expect.any(Array),
        total: expect.any(Number),
        limit: expect.any(Number),
        offset: 0,
      });
      expect(res.body.total).toBeGreaterThanOrEqual(3);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('OH-02 each list item has the expected OrderListItemDto shape', async () => {
      const res = await http
        .get('/api/orders/my?limit=1&offset=0')
        .set(authHeader(customerToken));

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toMatchObject({
        orderId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        status: expect.any(String),
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'E2E Test Restaurant',
        paymentMethod: 'cod',
        totalAmount: expect.any(Number),
        shippingFee: expect.any(Number),
        itemCount: expect.any(Number),
        firstItemName: expect.any(String),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('OH-03 returns only the authenticated user\'s own orders', async () => {
      // The restaurant owner placed NO orders as a customer — their list must be empty
      const res = await http.get('/api/orders/my').set(ownerHeaders());

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.data).toEqual([]);
    });

    it('OH-04 filters by ?status=delivered', async () => {
      const res = await http
        .get('/api/orders/my?status=delivered')
        .set(authHeader(customerToken));

      expect(res.status).toBe(200);
      expect(
        (res.body.data as Array<{ status: string }>).every((o) => o.status === 'delivered'),
      ).toBe(true);
      const ids = (res.body.data as Array<{ orderId: string }>).map((o) => o.orderId);
      expect(ids).toContain(orderDeliveredId);
    });

    it('OH-05 pagination: limit=1&offset=0 returns 1 item, total >= 3', async () => {
      const res = await http
        .get('/api/orders/my?limit=1&offset=0')
        .set(authHeader(customerToken));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.limit).toBe(1);
      expect(res.body.offset).toBe(0);
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it('OH-06 pagination: offset beyond total returns empty data, total unchanged', async () => {
      const res = await http
        .get('/api/orders/my?limit=10&offset=100')
        .set(authHeader(customerToken));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it('OH-07 returns 401 without authentication', async () => {
      const res = await http.get('/api/orders/my').set(noAuthHeaders());

      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §2  GET /api/orders/my/:id — Customer order detail
  // ──────────────────────────────────────────────────────────────────────────

  describe('§2 GET /api/orders/my/:id — customer order detail', () => {
    it('OH-10 returns 200 with full OrderDetailDto for own order', async () => {
      const res = await http
        .get(`/api/orders/my/${orderDeliveredId}`)
        .set(authHeader(customerToken));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        orderId: orderDeliveredId,
        status: 'delivered',
        restaurantId: TEST_RESTAURANT_ID,
        paymentMethod: 'cod',
        totalAmount: expect.any(Number),
        deliveryAddress: expect.any(Object),
        items: expect.any(Array),
        timeline: expect.any(Array),
      });
    });

    it('OH-11 items array contains the seeded menu item', async () => {
      const res = await http
        .get(`/api/orders/my/${orderDeliveredId}`)
        .set(authHeader(customerToken));

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        menuItemId: menuItemId,
        itemName: expect.any(String),
        quantity: 1,
        unitPrice: expect.any(Number),
      });
    });

    it('OH-12 timeline contains audit log entries with toStatus and triggeredBy', async () => {
      const res = await http
        .get(`/api/orders/my/${orderDeliveredId}`)
        .set(authHeader(customerToken));

      expect(res.status).toBe(200);
      expect(res.body.timeline.length).toBeGreaterThanOrEqual(1);
      expect(res.body.timeline[0]).toMatchObject({
        toStatus: expect.any(String),
        triggeredBy: expect.any(String),
        createdAt: expect.any(String),
      });
    });

    it('OH-13 returns 404 (not 403) when accessing another customer\'s order (info-leak prevention)', async () => {
      // The restaurant owner did not place orderDeliveredId — accessing it returns 404
      const res = await http
        .get(`/api/orders/my/${orderDeliveredId}`)
        .set(ownerHeaders());

      expect(res.status).toBe(404);
    });

    it('OH-14 returns 401 without authentication', async () => {
      const res = await http
        .get(`/api/orders/my/${orderDeliveredId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(401);
    });

    it('OH-15 returns 400 on non-UUID order ID (ParseUUIDPipe)', async () => {
      const res = await http
        .get('/api/orders/my/not-a-valid-uuid')
        .set(authHeader(customerToken));

      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §3  GET /api/orders/my/:id/reorder — Reorder items
  // ──────────────────────────────────────────────────────────────────────────

  describe('§3 GET /api/orders/my/:id/reorder — reorder items', () => {
    it('OH-20 returns 200 with ReorderItemDto[] for own order', async () => {
      const res = await http
        .get(`/api/orders/my/${orderDeliveredId}/reorder`)
        .set(authHeader(customerToken));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]).toMatchObject({
        menuItemId: menuItemId,
        itemName: expect.any(String),
        quantity: expect.any(Number),
        selectedModifiers: expect.any(Array),
      });
    });

    it('OH-21 returns 404 when accessing another customer\'s order reorder', async () => {
      const res = await http
        .get(`/api/orders/my/${orderDeliveredId}/reorder`)
        .set(ownerHeaders());

      expect(res.status).toBe(404);
    });

    it('OH-22 returns 401 without authentication', async () => {
      const res = await http
        .get(`/api/orders/my/${orderDeliveredId}/reorder`)
        .set(noAuthHeaders());

      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §4  GET /api/restaurant/orders — Restaurant order list
  // ──────────────────────────────────────────────────────────────────────────

  describe('§4 GET /api/restaurant/orders — restaurant order list', () => {
    it('OH-30 returns 200 with paginated list for the restaurant owner', async () => {
      const res = await http.get('/api/restaurant/orders').set(ownerHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        data: expect.any(Array),
        total: expect.any(Number),
        limit: expect.any(Number),
        offset: 0,
      });
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it('OH-31 all returned orders belong to the owner\'s restaurant', async () => {
      const res = await http.get('/api/restaurant/orders').set(ownerHeaders());

      expect(res.status).toBe(200);
      expect(
        (res.body.data as Array<{ restaurantId: string }>).every(
          (o) => o.restaurantId === TEST_RESTAURANT_ID,
        ),
      ).toBe(true);
    });

    it('OH-32 filters by ?status=delivered', async () => {
      const res = await http
        .get('/api/restaurant/orders?status=delivered')
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      expect(
        (res.body.data as Array<{ status: string }>).every((o) => o.status === 'delivered'),
      ).toBe(true);
    });

    it('OH-33 pagination: limit=1 returns 1 item with correct total', async () => {
      const res = await http
        .get('/api/restaurant/orders?limit=1&offset=0')
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it('OH-34 returns 403 for restaurant-role user who owns no restaurant (no snapshot)', async () => {
      // otherUserHeaders() has 'restaurant' role but their userId ≠ restaurant.ownerId
      // → service snapshot lookup returns null → 403
      const res = await http.get('/api/restaurant/orders').set(otherUserHeaders());

      expect(res.status).toBe(403);
    });

    it('OH-35 returns 403 for a customer (missing restaurant/admin role)', async () => {
      const res = await http
        .get('/api/restaurant/orders')
        .set(authHeader(customerToken));

      expect(res.status).toBe(403);
    });

    it('OH-36 returns 401 without authentication', async () => {
      const res = await http.get('/api/restaurant/orders').set(noAuthHeaders());

      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §5  GET /api/restaurant/orders/active — Kitchen view
  // ──────────────────────────────────────────────────────────────────────────

  describe('§5 GET /api/restaurant/orders/active — kitchen view', () => {
    it('OH-40 returns 200 with an array of active orders', async () => {
      const res = await http
        .get('/api/restaurant/orders/active')
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('OH-41 active orders only have confirmed / preparing / ready_for_pickup status', async () => {
      const res = await http
        .get('/api/restaurant/orders/active')
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      const activeStatuses = ['confirmed', 'preparing', 'ready_for_pickup'];
      for (const order of res.body as Array<{ status: string }>) {
        expect(activeStatuses).toContain(order.status);
      }
    });

    it('OH-42 contains the confirmed order (orderConfirmedId)', async () => {
      const res = await http
        .get('/api/restaurant/orders/active')
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ orderId: string }>).map((o) => o.orderId);
      expect(ids).toContain(orderConfirmedId);
    });

    it('OH-43 contains the ready_for_pickup order (orderReadyId)', async () => {
      const res = await http
        .get('/api/restaurant/orders/active')
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ orderId: string }>).map((o) => o.orderId);
      expect(ids).toContain(orderReadyId);
    });

    it('OH-44 does NOT contain the delivered order (orderDeliveredId)', async () => {
      const res = await http
        .get('/api/restaurant/orders/active')
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ orderId: string }>).map((o) => o.orderId);
      expect(ids).not.toContain(orderDeliveredId);
    });

    it('OH-45 returns 401 without authentication', async () => {
      const res = await http
        .get('/api/restaurant/orders/active')
        .set(noAuthHeaders());

      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §6  GET /api/shipper/orders/available — Available orders pool
  // ──────────────────────────────────────────────────────────────────────────

  describe('§6 GET /api/shipper/orders/available — available orders pool', () => {
    it('OH-50 returns 200 with an array of available orders', async () => {
      const res = await http
        .get('/api/shipper/orders/available')
        .set(authHeader(shipperToken));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('OH-51 contains the ready_for_pickup order (orderReadyId)', async () => {
      const res = await http
        .get('/api/shipper/orders/available')
        .set(authHeader(shipperToken));

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ orderId: string }>).map((o) => o.orderId);
      expect(ids).toContain(orderReadyId);
    });

    it('OH-52 does NOT contain the delivered order', async () => {
      const res = await http
        .get('/api/shipper/orders/available')
        .set(authHeader(shipperToken));

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ orderId: string }>).map((o) => o.orderId);
      expect(ids).not.toContain(orderDeliveredId);
    });

    it('OH-53 does NOT contain the confirmed order (not ready_for_pickup yet)', async () => {
      const res = await http
        .get('/api/shipper/orders/available')
        .set(authHeader(shipperToken));

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ orderId: string }>).map((o) => o.orderId);
      expect(ids).not.toContain(orderConfirmedId);
    });

    it('OH-54 returns 403 for customer role (missing shipper/admin role)', async () => {
      const res = await http
        .get('/api/shipper/orders/available')
        .set(authHeader(customerToken));

      expect(res.status).toBe(403);
    });

    it('OH-55 returns 401 without authentication', async () => {
      const res = await http
        .get('/api/shipper/orders/available')
        .set(noAuthHeaders());

      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §7  GET /api/shipper/orders/active — Shipper active delivery
  // ──────────────────────────────────────────────────────────────────────────

  describe('§7 GET /api/shipper/orders/active — shipper active delivery', () => {
    it('OH-60 returns 200 with empty array when no active delivery (BUG-2 regression)', async () => {
      // orderDeliveredId was already delivered — no order is in picked_up/delivering state
      const res = await http
        .get('/api/shipper/orders/active')
        .set(authHeader(shipperToken));

      expect(res.status).toBe(200);
      // Must be an array (not null) — BUG-2 fix: getShipperActiveOrder returns []
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('OH-61 returns 403 for customer role', async () => {
      const res = await http
        .get('/api/shipper/orders/active')
        .set(authHeader(customerToken));

      expect(res.status).toBe(403);
    });

    it('OH-62 returns 401 without authentication', async () => {
      const res = await http
        .get('/api/shipper/orders/active')
        .set(noAuthHeaders());

      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §8  GET /api/shipper/orders/history — Shipper delivery history
  // ──────────────────────────────────────────────────────────────────────────

  describe('§8 GET /api/shipper/orders/history — shipper delivery history', () => {
    it('OH-70 returns 200 with paginated delivered orders for the shipper', async () => {
      const res = await http
        .get('/api/shipper/orders/history')
        .set(authHeader(shipperToken));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        data: expect.any(Array),
        total: expect.any(Number),
        limit: expect.any(Number),
        offset: expect.any(Number),
      });
    });

    it('OH-71 shipper history contains the order this shipper delivered', async () => {
      const res = await http
        .get('/api/shipper/orders/history')
        .set(authHeader(shipperToken));

      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ orderId: string }>).map((o) => o.orderId);
      expect(ids).toContain(orderDeliveredId);
    });

    it('OH-72 all orders in shipper history have status=delivered', async () => {
      const res = await http
        .get('/api/shipper/orders/history')
        .set(authHeader(shipperToken));

      expect(res.status).toBe(200);
      expect(
        (res.body.data as Array<{ status: string }>).every((o) => o.status === 'delivered'),
      ).toBe(true);
    });

    it('OH-73 returns 403 for customer role', async () => {
      const res = await http
        .get('/api/shipper/orders/history')
        .set(authHeader(customerToken));

      expect(res.status).toBe(403);
    });

    it('OH-74 returns 401 without authentication', async () => {
      const res = await http
        .get('/api/shipper/orders/history')
        .set(noAuthHeaders());

      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §9  GET /api/admin/orders — Admin order list
  // ──────────────────────────────────────────────────────────────────────────

  describe('§9 GET /api/admin/orders — admin order list', () => {
    it('OH-80 returns 200 with paginated list for admin', async () => {
      const res = await http.get('/api/admin/orders').set(authHeader(adminToken));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        data: expect.any(Array),
        total: expect.any(Number),
        limit: expect.any(Number),
        offset: expect.any(Number),
      });
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it('OH-81 filters by ?restaurantId returns only orders for that restaurant', async () => {
      const res = await http
        .get(`/api/admin/orders?restaurantId=${TEST_RESTAURANT_ID}`)
        .set(authHeader(adminToken));

      expect(res.status).toBe(200);
      expect(
        (res.body.data as Array<{ restaurantId: string }>).every(
          (o) => o.restaurantId === TEST_RESTAURANT_ID,
        ),
      ).toBe(true);
    });

    it('OH-82 filters by ?customerId returns only that customer\'s orders', async () => {
      const res = await http
        .get(`/api/admin/orders?customerId=${customerId}`)
        .set(authHeader(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it('OH-83 filters by ?status=delivered', async () => {
      const res = await http
        .get('/api/admin/orders?status=delivered')
        .set(authHeader(adminToken));

      expect(res.status).toBe(200);
      expect(
        (res.body.data as Array<{ status: string }>).every((o) => o.status === 'delivered'),
      ).toBe(true);
    });

    it('OH-84 sortBy=total_amount&sortOrder=asc returns monotonically non-decreasing amounts', async () => {
      const res = await http
        .get('/api/admin/orders?sortBy=total_amount&sortOrder=asc')
        .set(authHeader(adminToken));

      expect(res.status).toBe(200);
      const amounts = (res.body.data as Array<{ totalAmount: number }>).map(
        (o) => o.totalAmount,
      );
      for (let i = 1; i < amounts.length; i++) {
        expect(amounts[i]).toBeGreaterThanOrEqual(amounts[i - 1]);
      }
    });

    it('OH-85 pagination: limit=1 returns 1 item with correct total', async () => {
      const res = await http
        .get('/api/admin/orders?limit=1&offset=0')
        .set(authHeader(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.limit).toBe(1);
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it('OH-86 returns 403 for restaurant role (not admin)', async () => {
      const res = await http.get('/api/admin/orders').set(ownerHeaders());

      expect(res.status).toBe(403);
    });

    it('OH-87 returns 401 without authentication', async () => {
      const res = await http.get('/api/admin/orders').set(noAuthHeaders());

      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §10  GET /api/admin/orders/:id — Admin order detail
  // ──────────────────────────────────────────────────────────────────────────

  describe('§10 GET /api/admin/orders/:id — admin order detail', () => {
    it('OH-90 returns 200 with full OrderDetailDto for any order', async () => {
      const res = await http
        .get(`/api/admin/orders/${orderDeliveredId}`)
        .set(authHeader(adminToken));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        orderId: orderDeliveredId,
        status: 'delivered',
        items: expect.any(Array),
        timeline: expect.any(Array),
      });
    });

    it('OH-91 detail includes items and full timeline for delivered order', async () => {
      const res = await http
        .get(`/api/admin/orders/${orderDeliveredId}`)
        .set(authHeader(adminToken));

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      // Full lifecycle: pending→confirmed→preparing→ready→picked_up→delivering→delivered = 7 entries
      expect(res.body.timeline.length).toBeGreaterThanOrEqual(7);
    });

    it('OH-92 returns 404 for a non-existent order ID', async () => {
      const fakeId = '00000000-0000-4000-8000-000000000000';
      const res = await http
        .get(`/api/admin/orders/${fakeId}`)
        .set(authHeader(adminToken));

      expect(res.status).toBe(404);
    });

    it('OH-93 returns 400 on non-UUID param (ParseUUIDPipe)', async () => {
      const res = await http
        .get('/api/admin/orders/not-a-valid-uuid')
        .set(authHeader(adminToken));

      expect(res.status).toBe(400);
    });

    it('OH-94 returns 403 for restaurant role (not admin)', async () => {
      const res = await http
        .get(`/api/admin/orders/${orderDeliveredId}`)
        .set(ownerHeaders());

      expect(res.status).toBe(403);
    });

    it('OH-95 returns 401 without authentication', async () => {
      const res = await http
        .get(`/api/admin/orders/${orderDeliveredId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(401);
    });
  });
});
