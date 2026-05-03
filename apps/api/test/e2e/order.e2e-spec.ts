/**
 * order.e2e-spec.ts — Phase 4 Order Placement E2E Tests
 *
 * Covers POST /api/carts/my/checkout end-to-end:
 *  §1  Basic checkout — response shape, cart cleared, DB state, ACL price override
 *  §2  Zone pricing   — shippingFee + estimatedDeliveryMinutes computed correctly
 *  §3  BR-3 delivery zone validation — soft guard + hard reject
 *  §4  Idempotency — D5-A Redis key (same key → same order)
 *  §5  Cart validation — empty cart, restaurant closed, item unavailable
 *  §6  Modifier validation at checkout — re-check Case 12 (option deleted after add)
 *  §7  Auth guard — 401 without credentials
 *
 * Architecture notes:
 *  - All state changes go through HTTP (no direct DB inserts).
 *  - DB helpers (getOrder, getOrderItems) are used only for assertions.
 *  - No mocks; real auth (TestAuthManager + Better Auth bearer tokens).
 *  - Redis idempotency keys in §4 are dynamically generated (crypto.randomUUID)
 *    so re-running the suite within the 5-min TTL window does not cause hits.
 *  - §2's beforeAll updates the restaurant with GPS coordinates; sections §3-§7
 *    run with a restaurant that HAS lat/lng and an active delivery zone.
 *    Use ADDRESS_NO_COORDS for tests that want shippingFee=0 (soft guard).
 */

import { randomUUID } from 'crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, teardownTestApp } from '../setup/app-factory';
import { resetDb, seedBaseRestaurant, TEST_RESTAURANT_ID } from '../setup/db-setup';
import { TestAuthManager } from '../helpers/test-auth';
import { setAuthManager, ownerHeaders, otherUserHeaders, noAuthHeaders } from '../helpers/auth';
import { getOrder, getOrderItems } from '../helpers/db';

// ─── Timing helper ────────────────────────────────────────────────────────────
// Required after any event-firing HTTP mutation (menu item create/update,
// restaurant update, zone create/delete) so async projectors finish before
// the next assertion reads the ACL snapshot.
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Restaurant GPS coordinates ───────────────────────────────────────────────
// Ho Chi Minh City center — used when lat/lng is needed for zone pricing tests.
const RESTAURANT_LAT = 10.7769;
const RESTAURANT_LNG = 106.7009;

// ~1 km north of the restaurant (≈ 0.009° latitude × 111 km/° ≈ 1.0 km).
// Haversine distance will be well within the 10 km test zone.
const NEARBY_LAT = 10.7859;
const NEARBY_LNG = 106.7009;

// ~25 km north of the restaurant — outside every test zone (radiusKm ≤ 10).
const FAR_LAT = 10.9919;
const FAR_LNG = 106.7009;

// ─── Delivery address fixtures ────────────────────────────────────────────────

/** No GPS coordinates — always triggers the soft guard (shippingFee=0). */
const ADDRESS_NO_COORDS = {
  street: '123 Test Street',
  district: 'District 1',
  city: 'Ho Chi Minh City',
};

/** ~1 km from restaurant — within the 10 km test zone. */
const ADDRESS_NEARBY = {
  ...ADDRESS_NO_COORDS,
  latitude: NEARBY_LAT,
  longitude: NEARBY_LNG,
};

/** ~25 km from restaurant — outside every test zone. */
const ADDRESS_FAR = {
  ...ADDRESS_NO_COORDS,
  latitude: FAR_LAT,
  longitude: FAR_LNG,
};

// ─── Reusable add-item payload builder ───────────────────────────────────────

function addItemPayload(menuItemId: string, quantity = 1, overrides: Record<string, unknown> = {}) {
  return {
    menuItemId,
    restaurantId: TEST_RESTAURANT_ID,
    restaurantName: 'E2E Test Restaurant',
    itemName: 'Test Burger',
    unitPrice: 10.0,
    quantity,
    ...overrides,
  };
}

// ─── Main suite ───────────────────────────────────────────────────────────────

describe('Order placement E2E', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  /** The primary test menu item — has a full ACL snapshot after seeding. */
  let snapshotItemId: string;

  // ─── Global setup ──────────────────────────────────────────────────────────

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());

    await resetDb();

    const testAuth = new TestAuthManager();
    await testAuth.initialize(http);
    setAuthManager(testAuth);
    await seedBaseRestaurant(testAuth.ownerUserId);

    // seedBaseRestaurant() does a direct DB insert — it does NOT fire
    // RestaurantUpdatedEvent, so ordering_restaurant_snapshots has no row yet.
    // A PATCH call triggers the event and causes RestaurantSnapshotProjector to
    // upsert the snapshot row. This must happen before any checkout test runs.
    const patchRes = await http
      .patch(`/api/restaurants/${TEST_RESTAURANT_ID}`)
      .set(ownerHeaders())
      .send({ name: 'E2E Test Restaurant' });
    expect(patchRes.status).toBe(200);
    await delay(200);

    // Create the primary menu item.
    // Fires MenuItemCreatedEvent → MenuItemSnapshotProjector upserts ACL row.
    const itemRes = await http
      .post('/api/menu-items')
      .set(ownerHeaders())
      .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Test Burger', price: 10.0 });
    expect(itemRes.status).toBe(201);
    snapshotItemId = itemRes.body.id as string;

    // Wait for the snapshot to be projected before any test reads it.
    await delay(200);

    // Clear any stale Redis cart from a previous test run.
    await http.delete('/api/carts/my').set(ownerHeaders());
    await http.delete('/api/carts/my').set(otherUserHeaders());
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §1  Basic checkout — response shape, DB state, ACL price override
  // ──────────────────────────────────────────────────────────────────────────
  // Restaurant at this point: no lat/lng, no delivery zones.
  // All checkouts use ADDRESS_NO_COORDS → shippingFee = 0 (soft guard).

  describe('§1 POST /api/carts/my/checkout — basic checkout (no zone pricing)', () => {
    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('O-01 returns 201 with the correct CheckoutResponseDto shape', async () => {
      await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send(addItemPayload(snapshotItemId));

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: ADDRESS_NO_COORDS, paymentMethod: 'cod' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        orderId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        status: 'pending',
        totalAmount: expect.any(Number),
        shippingFee: 0,
        paymentMethod: 'cod',
        createdAt: expect.any(String),
      });
      // COD orders have no payment URL
      expect(res.body.paymentUrl == null).toBe(true);
    });

    it('O-02 cart is fully cleared after a successful checkout', async () => {
      await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send(addItemPayload(snapshotItemId));

      await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: ADDRESS_NO_COORDS, paymentMethod: 'cod' });

      const cartRes = await http.get('/api/carts/my').set(ownerHeaders());
      expect(cartRes.status).toBe(200);
      // NestJS serializes null body; supertest parses it as {}
      expect(cartRes.body?.cartId).toBeUndefined();
    });

    it('O-03 DB orders row has correct status, totalAmount=20, and shippingFee=0', async () => {
      await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send(addItemPayload(snapshotItemId, 2));

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: ADDRESS_NO_COORDS, paymentMethod: 'cod' });

      expect(res.status).toBe(201);

      const order = await getOrder(res.body.orderId as string);
      expect(order).not.toBeNull();
      expect(order!.status).toBe('pending');
      expect(order!.shippingFee).toBe(0);
      // Snapshot price (10.0) × qty 2 = 20.0
      expect(order!.totalAmount).toBe(20.0);
      expect(order!.estimatedDeliveryMinutes).toBeNull();
      expect(order!.paymentMethod).toBe('cod');
    });

    it('O-04 order_items use ACL snapshot price, not the (deliberately wrong) cart price', async () => {
      // Cart is seeded with unitPrice: 99.99 — handler must override from the ACL snapshot.
      await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send(addItemPayload(snapshotItemId, 1, { unitPrice: 99.99 }));

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: ADDRESS_NO_COORDS, paymentMethod: 'cod' });

      expect(res.status).toBe(201);
      const items = await getOrderItems(res.body.orderId as string);
      expect(items).toHaveLength(1);
      // ACL snapshot price wins — not the 99.99 cart price
      expect(items[0].unitPrice).toBe(10.0);
      expect(res.body.totalAmount).toBe(10.0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §2  Zone pricing — shippingFee + estimatedDeliveryMinutes
  // ──────────────────────────────────────────────────────────────────────────
  // This beforeAll updates the restaurant with GPS coordinates and creates a
  // delivery zone. All subsequent sections (§3–§7) run in a world where the
  // restaurant HAS lat/lng and an active zone.
  //
  // Zone design: perKmRate=0 so shippingFee = baseFee exactly, regardless of
  // the Haversine distance. This allows a precise fee assertion without
  // replicating the floating-point formula inside the test.

  describe('§2 Zone pricing — shippingFee + estimatedDeliveryMinutes computed', () => {
    beforeAll(async () => {
      // Set restaurant GPS coordinates.
      // Fires RestaurantUpdatedEvent → RestaurantSnapshotProjector writes lat/lng into snapshot.
      const patchRes = await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}`)
        .set(ownerHeaders())
        .send({ latitude: RESTAURANT_LAT, longitude: RESTAURANT_LNG });
      expect(patchRes.status).toBe(200);
      await delay(200);

      // Create a 10 km delivery zone.
      // perKmRate=0 → shippingFee = baseFee (2.50) for any address inside the zone.
      const zoneRes = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(ownerHeaders())
        .send({
          name: 'City Zone',
          radiusKm: 10,
          baseFee: 2.5,
          perKmRate: 0,
          avgSpeedKmh: 30,
          prepTimeMinutes: 15,
          bufferMinutes: 5,
        });
      expect(zoneRes.status).toBe(201);
      // Wait for DeliveryZoneSnapshotUpdatedEvent → DeliveryZoneSnapshotProjector
      await delay(200);
    });

    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('O-05 shippingFee equals baseFee (2.50) when delivery address is inside zone', async () => {
      await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send(addItemPayload(snapshotItemId));

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: ADDRESS_NEARBY, paymentMethod: 'cod' });

      expect(res.status).toBe(201);
      expect(res.body.shippingFee).toBe(2.5);
    });

    it('O-06 totalAmount = itemsTotal + shippingFee, consistent across response and DB', async () => {
      await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send(addItemPayload(snapshotItemId, 2));

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: ADDRESS_NEARBY, paymentMethod: 'cod' });

      expect(res.status).toBe(201);
      // itemsTotal = 10.0 × 2 = 20.0; shippingFee = 2.5; total = 22.5
      expect(res.body.shippingFee).toBe(2.5);
      expect(res.body.totalAmount).toBe(22.5);

      const order = await getOrder(res.body.orderId as string);
      expect(order!.totalAmount).toBe(22.5);
      expect(order!.shippingFee).toBe(2.5);
    });

    it('O-07 estimatedDeliveryMinutes is non-null when zone data is present', async () => {
      await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send(addItemPayload(snapshotItemId));

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: ADDRESS_NEARBY, paymentMethod: 'cod' });

      expect(res.status).toBe(201);
      // ETA = Math.ceil(prepTime + travelTime + buffer)
      // ≈ Math.ceil(15 + (1km/30km·h⁻¹)×60 + 5) = Math.ceil(22) = 22 minutes
      // Allow a small window for Haversine imprecision.
      expect(res.body.estimatedDeliveryMinutes).not.toBeNull();
      expect(res.body.estimatedDeliveryMinutes).toBeGreaterThanOrEqual(20);
      expect(res.body.estimatedDeliveryMinutes).toBeLessThanOrEqual(30);

      const order = await getOrder(res.body.orderId as string);
      expect(order!.estimatedDeliveryMinutes).not.toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §3  BR-3 delivery zone validation
  // ──────────────────────────────────────────────────────────────────────────
  // Restaurant now has lat/lng + one 10 km zone (from §2 beforeAll).

  describe('§3 BR-3 delivery zone validation', () => {
    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('O-08 delivery address without coordinates → soft guard → order succeeds with shippingFee=0', async () => {
      await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send(addItemPayload(snapshotItemId));

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: ADDRESS_NO_COORDS, paymentMethod: 'cod' });

      // Soft guard: delivery address has no GPS → pricing skipped entirely
      expect(res.status).toBe(201);
      expect(res.body.shippingFee).toBe(0);
      expect(res.body.estimatedDeliveryMinutes == null).toBe(true);
    });

    it('O-09 delivery address outside all zones → 422 UnprocessableEntity', async () => {
      await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send(addItemPayload(snapshotItemId));

      // ADDRESS_FAR is ~25 km from restaurant — exceeds the 10 km zone radius
      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: ADDRESS_FAR, paymentMethod: 'cod' });

      expect(res.status).toBe(422);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §4  Idempotency — D5-A (Redis key deduplication)
  // ──────────────────────────────────────────────────────────────────────────

  describe('§4 Idempotency', () => {
    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('O-10 same X-Idempotency-Key on retry returns the same orderId (no duplicate created)', async () => {
      // Use a fresh UUID so re-running the suite within the 5-min TTL window
      // does not accidentally hit a cached result from a previous run.
      const idempotencyKey = randomUUID();

      await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send(addItemPayload(snapshotItemId));

      // First call — creates the order and saves idempotency key to Redis.
      const first = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .set('X-Idempotency-Key', idempotencyKey)
        .send({ deliveryAddress: ADDRESS_NO_COORDS, paymentMethod: 'cod' });
      expect(first.status).toBe(201);
      const firstOrderId = first.body.orderId as string;

      // Cart is now cleared. Retry with the same key and an empty cart.
      // Step 1 of the handler hits the Redis cache and returns the cached order
      // before reaching the empty-cart check.
      const second = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .set('X-Idempotency-Key', idempotencyKey)
        .send({ deliveryAddress: ADDRESS_NO_COORDS, paymentMethod: 'cod' });
      expect(second.status).toBe(201);
      expect(second.body.orderId).toBe(firstOrderId);
    });

    it('O-11 X-Idempotency-Key shorter than 8 chars → 400', async () => {
      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .set('X-Idempotency-Key', 'abc123') // 6 chars — below the 8-char minimum
        .send({ deliveryAddress: ADDRESS_NO_COORDS, paymentMethod: 'cod' });

      expect(res.status).toBe(400);
    });

    it('O-12 X-Idempotency-Key with special characters → 400', async () => {
      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .set('X-Idempotency-Key', 'invalid_key_!!!')
        .send({ deliveryAddress: ADDRESS_NO_COORDS, paymentMethod: 'cod' });

      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §5  Cart validation at checkout
  // ──────────────────────────────────────────────────────────────────────────

  describe('§5 Cart and business-rule validation at checkout', () => {
    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('O-13 returns 400 when the cart is empty', async () => {
      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: ADDRESS_NO_COORDS, paymentMethod: 'cod' });

      // CartService rejects empty carts with 400
      expect([400, 422]).toContain(res.status);
    });

    it('O-14 returns 422 when the restaurant is closed', async () => {
      // Close the restaurant — fires RestaurantUpdatedEvent → snapshot updated.
      await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}`)
        .set(ownerHeaders())
        .send({ isOpen: false });
      await delay(200);

      let checkoutRes: Awaited<ReturnType<typeof http.post>> | undefined;
      try {
        await http
          .post('/api/carts/my/items')
          .set(ownerHeaders())
          .send(addItemPayload(snapshotItemId));

        checkoutRes = await http
          .post('/api/carts/my/checkout')
          .set(ownerHeaders())
          .send({ deliveryAddress: ADDRESS_NO_COORDS, paymentMethod: 'cod' });
      } finally {
        // Always re-open so subsequent tests are not affected.
        await http
          .patch(`/api/restaurants/${TEST_RESTAURANT_ID}`)
          .set(ownerHeaders())
          .send({ isOpen: true });
        await delay(200);
      }

      expect(checkoutRes!.status).toBe(422);
    });

    it('O-15 returns 422 when a cart item is unavailable in the ACL snapshot', async () => {
      // Create a dedicated "unavailable" item so we don't break snapshotItemId.
      const tempItemRes = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Soon Unavailable', price: 5.0 });
      expect(tempItemRes.status).toBe(201);
      const tempItemId = tempItemRes.body.id as string;
      await delay(200);

      // Add item to cart while still available.
      await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send(addItemPayload(tempItemId, 1, { itemName: 'Soon Unavailable', unitPrice: 5.0 }));

      // Mark the item unavailable — fires MenuItemUpdatedEvent → snapshot updated.
      await http
        .patch(`/api/menu-items/${tempItemId}`)
        .set(ownerHeaders())
        .send({ status: 'unavailable' });
      await delay(200);

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: ADDRESS_NO_COORDS, paymentMethod: 'cod' });

      expect(res.status).toBe(422);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §6  Modifier validation at checkout (Case 12 — re-check after cart add)
  // ──────────────────────────────────────────────────────────────────────────

  describe('§6 Modifier validation at checkout', () => {
    let modItemId: string;
    let reqGroupId: string;
    let defaultOptId: string;

    beforeAll(async () => {
      // Create a menu item with a required modifier group (minSelections=1, maxSelections=1).
      const modItemRes = await http
        .post('/api/menu-items')
        .set(ownerHeaders())
        .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Modifier Burger', price: 12.0 });
      expect(modItemRes.status).toBe(201);
      modItemId = modItemRes.body.id as string;

      const groupRes = await http
        .post(`/api/menu-items/${modItemId}/modifier-groups`)
        .set(ownerHeaders())
        .send({ name: 'Sauce', minSelections: 1, maxSelections: 1 });
      expect(groupRes.status).toBe(201);
      reqGroupId = groupRes.body.id as string;
      await delay(200);

      const optRes = await http
        .post(`/api/menu-items/${modItemId}/modifier-groups/${reqGroupId}/options`)
        .set(ownerHeaders())
        .send({ name: 'Ketchup', price: 0, isDefault: true });
      expect(optRes.status).toBe(201);
      defaultOptId = optRes.body.id as string;
      await delay(200);
    });

    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('O-16 returns 422 when a selected modifier option has been deleted since cart add', async () => {
      // Add item to cart with the option selected (option exists at this moment).
      await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send({
          menuItemId: modItemId,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'E2E Test Restaurant',
          itemName: 'Modifier Burger',
          unitPrice: 12.0,
          quantity: 1,
          selectedOptions: [{ groupId: reqGroupId, optionId: defaultOptId }],
        });

      // Delete the option — fires MenuItemUpdatedEvent → snapshot updated (option gone).
      await http
        .delete(
          `/api/menu-items/${modItemId}/modifier-groups/${reqGroupId}/options/${defaultOptId}`,
        )
        .set(ownerHeaders());
      await delay(200);

      // Checkout must fail because selectedModifiers in Redis cart still references
      // the deleted optionId, which assertModifierConstraintsAtCheckout rejects.
      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ deliveryAddress: ADDRESS_NO_COORDS, paymentMethod: 'cod' });

      expect(res.status).toBe(422);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // §7  Auth guard
  // ──────────────────────────────────────────────────────────────────────────

  describe('§7 Auth guard', () => {
    it('O-17 POST /api/carts/my/checkout returns 401 when unauthenticated', async () => {
      const res = await http
        .post('/api/carts/my/checkout')
        .set(noAuthHeaders())
        .send({ deliveryAddress: ADDRESS_NO_COORDS, paymentMethod: 'cod' });

      expect(res.status).toBe(401);
    });
  });
});
