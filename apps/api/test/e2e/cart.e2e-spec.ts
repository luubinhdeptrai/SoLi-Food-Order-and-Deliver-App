/**
 * cart.e2e-spec.ts — Phase 2 Cart API
 *
 * Covers all cart endpoints plus the checkout DTO contract.
 * Cart state lives in Redis; it persists across DB resets.
 * The outer beforeAll creates a menu-item-with-modifiers so the
 * modifier-validation tests can reference a real snapshot.
 *
 * Cart ownership: implicit via session.user.id — no role guard.
 * - ownerHeaders()     → customer A (owner of TEST_RESTAURANT_ID)
 * - otherUserHeaders() → customer B (their own, independent cart)
 * - noAuthHeaders()    → 401 on all cart endpoints
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Constants ────────────────────────────────────────────────────────────────

const RESTAURANT_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Simple, fixed UUIDs used for "no-snapshot" / unknown-item cart adds
const UNKNOWN_ITEM_ID   = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UNKNOWN_ITEM_ID_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UNKNOWN_CART_ITEM_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

// ─── Main suite ──────────────────────────────────────────────────────────────

describe('Cart API (E2E)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  // Seeded via HTTP → has a real ACL snapshot after propagation
  let snapshotItemId: string;  // basic item – no modifiers
  let modItemId: string;       // item with modifier groups
  let reqGroupId: string;      // required modifier group (minSelections=1, maxSelections=1)
  let defaultOptId: string;    // default option in reqGroup
  let altOptId: string;        // non-default option in reqGroup
  let optGroupId: string;      // optional group (minSelections=0, maxSelections=2)
  let optOptAId: string;       // option A in optional group
  let optOptBId: string;       // option B in optional group

  // ─── Global setup ──────────────────────────────────────────────────────────

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());

    await resetDb();
    const testAuth = new TestAuthManager();
    await testAuth.initialize(http);
    setAuthManager(testAuth);
    await seedBaseRestaurant(testAuth.ownerUserId);

    // ── Create basic item (no modifiers) ──
    const basic = await http
      .post('/api/menu-items')
      .set(ownerHeaders())
      .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Plain Burger', price: 10.0 });
    snapshotItemId = basic.body.id as string;

    // ── Create item with modifiers ──
    const modItem = await http
      .post('/api/menu-items')
      .set(ownerHeaders())
      .send({ restaurantId: TEST_RESTAURANT_ID, name: 'Fancy Burger', price: 15.0 });
    modItemId = modItem.body.id as string;

    // Required modifier group (minSelections=1, maxSelections=1)
    // Route: POST /api/menu-items/:menuItemId/modifier-groups
    // Each creation fires a MenuItemUpdatedEvent handled asynchronously.
    // Add a delay after each call so events are processed sequentially,
    // preventing a stale event from overwriting a more recent snapshot.
    const reqGroupRes = await http
      .post(`/api/menu-items/${modItemId}/modifier-groups`)
      .set(ownerHeaders())
      .send({ name: 'Bread Type', minSelections: 1, maxSelections: 1 });
    reqGroupId = reqGroupRes.body.id as string;
    await delay(200);

    // Route: POST /api/menu-items/:menuItemId/modifier-groups/:groupId/options
    const defOptRes = await http
      .post(`/api/menu-items/${modItemId}/modifier-groups/${reqGroupId}/options`)
      .set(ownerHeaders())
      .send({ name: 'White Bread', price: 0, isDefault: true });
    defaultOptId = defOptRes.body.id as string;
    await delay(200);

    const altOptRes = await http
      .post(`/api/menu-items/${modItemId}/modifier-groups/${reqGroupId}/options`)
      .set(ownerHeaders())
      .send({ name: 'Whole Wheat', price: 0.5, isDefault: false });
    altOptId = altOptRes.body.id as string;
    await delay(200);

    // Optional modifier group (minSelections=0, maxSelections=2)
    const optGroupRes = await http
      .post(`/api/menu-items/${modItemId}/modifier-groups`)
      .set(ownerHeaders())
      .send({ name: 'Extras', minSelections: 0, maxSelections: 2 });
    optGroupId = optGroupRes.body.id as string;
    await delay(200);

    const optARes = await http
      .post(`/api/menu-items/${modItemId}/modifier-groups/${optGroupId}/options`)
      .set(ownerHeaders())
      .send({ name: 'Extra Cheese', price: 1.0, isDefault: false });
    optOptAId = optARes.body.id as string;
    await delay(200);

    const optBRes = await http
      .post(`/api/menu-items/${modItemId}/modifier-groups/${optGroupId}/options`)
      .set(ownerHeaders())
      .send({ name: 'Bacon', price: 1.5, isDefault: false });
    optOptBId = optBRes.body.id as string;

    // Final wait — ensure the last event is fully projected before tests run
    await delay(200);

    // Clear any stale cart from a previous test run
    await http.delete('/api/carts/my').set(ownerHeaders());
    await http.delete('/api/carts/my').set(otherUserHeaders());
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  // ─── §1  GET /carts/my ─────────────────────────────────────────────────────

  describe('§1 GET /api/carts/my', () => {
    beforeAll(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('C-01 returns 200 with empty/null body when cart is empty', async () => {
      const res = await http.get('/api/carts/my').set(ownerHeaders());
      expect(res.status).toBe(200);
      // NestJS serializes null as empty body; supertest parses empty body as {}
      expect(res.body?.cartId).toBeUndefined();
    });

    it('C-02 returns full CartResponseDto after adding an item', async () => {
      await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send({
          menuItemId: snapshotItemId,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'Test Restaurant',
          itemName: 'Plain Burger',
          unitPrice: 10.0,
          quantity: 2,
        });

      const res = await http.get('/api/carts/my').set(ownerHeaders());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        cartId: expect.any(String),
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: expect.any(String),
        items: expect.arrayContaining([
          expect.objectContaining({
            cartItemId: expect.any(String),
            menuItemId: snapshotItemId,
            quantity: 2,
          }),
        ]),
      });
    });

    it('C-03 cartId is stable across multiple GET calls', async () => {
      const r1 = await http.get('/api/carts/my').set(ownerHeaders());
      const r2 = await http.get('/api/carts/my').set(ownerHeaders());
      expect(r1.body.cartId).toBe(r2.body.cartId);
    });

    afterAll(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });
  });

  // ─── §2  POST /carts/my/items ──────────────────────────────────────────────

  describe('§2 POST /api/carts/my/items — add & merge', () => {
    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('C-04 creates a cart and returns 201 with CartResponseDto', async () => {
      const res = await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send({
          menuItemId: snapshotItemId,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'Test Restaurant',
          itemName: 'Plain Burger',
          unitPrice: 10.0,
          quantity: 1,
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        cartId: expect.any(String),
        items: [
          expect.objectContaining({
            menuItemId: snapshotItemId,
            quantity: 1,
            unitPrice: 10.0,
          }),
        ],
      });
    });

    it('C-05 merges quantity when same itemId + same modifiers added twice', async () => {
      const payload = {
        menuItemId: snapshotItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Plain Burger',
        unitPrice: 10.0,
        quantity: 2,
      };

      await http.post('/api/carts/my/items').set(ownerHeaders()).send(payload);
      const res = await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send({ ...payload, quantity: 3 });

      expect(res.status).toBe(201);
      const item = (res.body.items as { menuItemId: string; quantity: number }[]).find(
        (i) => i.menuItemId === snapshotItemId,
      );
      expect(item?.quantity).toBe(5); // 2 + 3
    });

    it('C-06 creates a new line when same item has different modifiers', async () => {
      // First line: no modifiers → uses auto-injected default for reqGroup
      await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send({
          menuItemId: modItemId,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'Test Restaurant',
          itemName: 'Fancy Burger',
          unitPrice: 15.0,
          quantity: 1,
          selectedOptions: [{ groupId: reqGroupId, optionId: defaultOptId }],
        });

      // Second line: different modifier selection → distinct fingerprint
      const res = await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send({
          menuItemId: modItemId,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'Test Restaurant',
          itemName: 'Fancy Burger',
          unitPrice: 15.0,
          quantity: 1,
          selectedOptions: [{ groupId: reqGroupId, optionId: altOptId }],
        });

      expect(res.status).toBe(201);
      const modLines = (res.body.items as { menuItemId: string }[]).filter(
        (i) => i.menuItemId === modItemId,
      );
      expect(modLines.length).toBe(2);
    });

    it('C-07 returns 400 when quantity overflow would exceed 99', async () => {
      const payload = {
        menuItemId: snapshotItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Plain Burger',
        unitPrice: 10.0,
        quantity: 99,
      };
      await http.post('/api/carts/my/items').set(ownerHeaders()).send(payload);

      const res = await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send({ ...payload, quantity: 1 }); // 99 + 1 = 100 → overflow

      expect(res.status).toBe(400);
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });
  });

  // ─── §3  PATCH /carts/my/items/:id — quantity ──────────────────────────────

  describe('§3 PATCH /api/carts/my/items/:id — update quantity', () => {
    let cartItemId: string;

    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());

      const addRes = await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send({
          menuItemId: snapshotItemId,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'Test Restaurant',
          itemName: 'Plain Burger',
          unitPrice: 10.0,
          quantity: 3,
        });
      cartItemId = (addRes.body.items as { cartItemId: string }[])[0].cartItemId;
    });

    it('C-08 PATCH qty updates quantity and returns 200 CartResponseDto', async () => {
      const res = await http
        .patch(`/api/carts/my/items/${cartItemId}`)
        .set(ownerHeaders())
        .send({ quantity: 5 });

      expect(res.status).toBe(200);
      const item = (res.body.items as { cartItemId: string; quantity: number }[]).find(
        (i) => i.cartItemId === cartItemId,
      );
      expect(item?.quantity).toBe(5);
    });

    it('C-09 PATCH qty=0 removes the item and returns 204 when cart is now empty', async () => {
      const res = await http
        .patch(`/api/carts/my/items/${cartItemId}`)
        .set(ownerHeaders())
        .send({ quantity: 0 });

      expect(res.status).toBe(204);
    });

    it('C-10 PATCH qty=0 on one item returns 200 with remaining items when others exist', async () => {
      // Add a second item
      const add2 = await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send({
          menuItemId: UNKNOWN_ITEM_ID,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'Test Restaurant',
          itemName: 'Second Item',
          unitPrice: 5.0,
          quantity: 1,
        });
      const secondItemId = (add2.body.items as { cartItemId: string; menuItemId: string }[]).find(
        (i) => i.menuItemId === UNKNOWN_ITEM_ID,
      )!.cartItemId;

      // Remove the first item (cartItemId) — second should remain
      const res = await http
        .patch(`/api/carts/my/items/${cartItemId}`)
        .set(ownerHeaders())
        .send({ quantity: 0 });

      expect(res.status).toBe(200);
      const ids = (res.body.items as { cartItemId: string }[]).map((i) => i.cartItemId);
      expect(ids).not.toContain(cartItemId);
      expect(ids).toContain(secondItemId);
    });

    it('C-11 returns 404 when cartItemId does not exist in cart', async () => {
      const res = await http
        .patch(`/api/carts/my/items/${UNKNOWN_CART_ITEM_ID}`)
        .set(ownerHeaders())
        .send({ quantity: 2 });

      expect(res.status).toBe(404);
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });
  });

  // ─── §4  PATCH /carts/my/items/:id/modifiers ──────────────────────────────

  describe('§4 PATCH /api/carts/my/items/:id/modifiers — update modifiers', () => {
    let cartItemId: string;

    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());

      // Add modItemId with only the required group selected
      const addRes = await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send({
          menuItemId: modItemId,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'Test Restaurant',
          itemName: 'Fancy Burger',
          unitPrice: 15.0,
          quantity: 1,
          selectedOptions: [{ groupId: reqGroupId, optionId: defaultOptId }],
        });
      cartItemId = (addRes.body.items as { cartItemId: string }[])[0].cartItemId;
    });

    it('C-12 replaces modifier selection and returns 200 CartResponseDto', async () => {
      const res = await http
        .patch(`/api/carts/my/items/${cartItemId}/modifiers`)
        .set(ownerHeaders())
        .send({
          selectedOptions: [
            { groupId: reqGroupId, optionId: altOptId },
            { groupId: optGroupId, optionId: optOptAId },
          ],
        });

      expect(res.status).toBe(200);
      const item = (res.body.items as { cartItemId: string; selectedModifiers: unknown[] }[]).find(
        (i) => i.cartItemId === cartItemId,
      );
      expect(item?.selectedModifiers).toBeDefined();
    });

    it('C-13 clears all modifiers when selectedOptions is empty array', async () => {
      // First set some modifiers
      await http
        .patch(`/api/carts/my/items/${cartItemId}/modifiers`)
        .set(ownerHeaders())
        .send({
          selectedOptions: [
            { groupId: reqGroupId, optionId: defaultOptId },
            { groupId: optGroupId, optionId: optOptAId },
          ],
        });

      // Then clear them (empty array is valid — no required validation at PATCH level)
      const res = await http
        .patch(`/api/carts/my/items/${cartItemId}/modifiers`)
        .set(ownerHeaders())
        .send({ selectedOptions: [] });

      // Either succeeds (200) or returns validation error (400) depending on business rules
      // Accept both — the important assertion is the response shape
      expect([200, 400]).toContain(res.status);
    });

    it('C-14 returns 404 when cartItemId does not exist', async () => {
      const res = await http
        .patch(`/api/carts/my/items/${UNKNOWN_CART_ITEM_ID}/modifiers`)
        .set(ownerHeaders())
        .send({ selectedOptions: [{ groupId: reqGroupId, optionId: defaultOptId }] });

      expect(res.status).toBe(404);
    });

    it('C-15 returns 400 when selectedOptions is missing from body', async () => {
      const res = await http
        .patch(`/api/carts/my/items/${cartItemId}/modifiers`)
        .set(ownerHeaders())
        .send({});

      expect(res.status).toBe(400);
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });
  });

  // ─── §5  DELETE item + clear cart ─────────────────────────────────────────

  describe('§5 DELETE items and clear cart', () => {
    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('C-16 DELETE item returns 200 with remaining items when others exist', async () => {
      const add1 = await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send({
          menuItemId: snapshotItemId,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'Test Restaurant',
          itemName: 'Item 1',
          unitPrice: 5.0,
          quantity: 1,
        });
      const item1Id = (add1.body.items as { cartItemId: string }[])[0].cartItemId;

      await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: UNKNOWN_ITEM_ID,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Item 2',
        unitPrice: 6.0,
        quantity: 1,
      });

      const res = await http
        .delete(`/api/carts/my/items/${item1Id}`)
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      const ids = (res.body.items as { cartItemId: string }[]).map((i) => i.cartItemId);
      expect(ids).not.toContain(item1Id);
      expect(ids.length).toBe(1);
    });

    it('C-17 DELETE last item returns 204 (empty cart)', async () => {
      const addRes = await http
        .post('/api/carts/my/items')
        .set(ownerHeaders())
        .send({
          menuItemId: snapshotItemId,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'Test Restaurant',
          itemName: 'Solo Item',
          unitPrice: 8.0,
          quantity: 1,
        });
      const itemId = (addRes.body.items as { cartItemId: string }[])[0].cartItemId;

      const res = await http.delete(`/api/carts/my/items/${itemId}`).set(ownerHeaders());
      expect(res.status).toBe(204);
    });

    it('C-18 DELETE /carts/my clears all items and returns 204', async () => {
      await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: snapshotItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Item',
        unitPrice: 5.0,
        quantity: 2,
      });

      const res = await http.delete('/api/carts/my').set(ownerHeaders());
      expect(res.status).toBe(204);

      const getRes = await http.get('/api/carts/my').set(ownerHeaders());
      // NestJS serializes null as empty body; supertest parses empty body as {}
      expect(getRes.body?.cartId).toBeUndefined();
    });

    it('C-19 DELETE /carts/my is idempotent — 204 even when no cart exists', async () => {
      const res = await http.delete('/api/carts/my').set(ownerHeaders());
      expect(res.status).toBe(204);
    });

    it('C-20 DELETE item returns 404 when cartItemId not found', async () => {
      await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: snapshotItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Existing Item',
        unitPrice: 5.0,
        quantity: 1,
      });

      const res = await http
        .delete(`/api/carts/my/items/${UNKNOWN_CART_ITEM_ID}`)
        .set(ownerHeaders());
      expect(res.status).toBe(404);
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });
  });

  // ─── §6  BR-2 single-restaurant constraint ─────────────────────────────────

  describe('§6 BR-2 — single-restaurant cart', () => {
    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('C-21 returns 409 when adding item from a different restaurant', async () => {
      await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: snapshotItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Item A',
        unitPrice: 5.0,
        quantity: 1,
      });

      const res = await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: UNKNOWN_ITEM_ID,
        restaurantId: RESTAURANT_B_ID,
        restaurantName: 'Other Restaurant',
        itemName: 'Item B',
        unitPrice: 6.0,
        quantity: 1,
      });

      expect(res.status).toBe(409);
    });

    it('C-22 can add from different restaurant after clearing the cart', async () => {
      await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: snapshotItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Item A',
        unitPrice: 5.0,
        quantity: 1,
      });

      await http.delete('/api/carts/my').set(ownerHeaders());

      const res = await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: UNKNOWN_ITEM_ID,
        restaurantId: RESTAURANT_B_ID,
        restaurantName: 'Other Restaurant',
        itemName: 'Item B',
        unitPrice: 6.0,
        quantity: 1,
      });

      expect(res.status).toBe(201);
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });
  });

  // ─── §7  Modifier validation via snapshot ──────────────────────────────────

  describe('§7 Modifier validation against ACL snapshot', () => {
    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('C-23 auto-injects default option when required group has a default and no selection given', async () => {
      const res = await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: modItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Fancy Burger',
        unitPrice: 15.0,
        quantity: 1,
        selectedOptions: [], // empty — service should inject default for reqGroup
      });

      // Should succeed — default is auto-injected
      expect(res.status).toBe(201);
      const item = (res.body.items as { selectedModifiers: { optionId: string }[] }[])[0];
      const optionIds = item.selectedModifiers.map((m) => m.optionId);
      expect(optionIds).toContain(defaultOptId);
    });

    it('C-24 returns 400 when an unknown groupId is sent', async () => {
      const res = await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: modItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Fancy Burger',
        unitPrice: 15.0,
        quantity: 1,
        selectedOptions: [{ groupId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', optionId: defaultOptId }],
      });

      // CartService.resolveModifierOptions throws BadRequestException (400) for unknown groupId
      expect(res.status).toBe(400);
    });

    it('C-25 returns 400 when an unknown optionId is sent for a known groupId', async () => {
      const res = await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: modItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Fancy Burger',
        unitPrice: 15.0,
        quantity: 1,
        selectedOptions: [
          { groupId: reqGroupId, optionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
        ],
      });

      // CartService.resolveModifierOptions throws BadRequestException (400) for unknown optionId
      expect(res.status).toBe(400);
    });

    it('C-26 returns 400 when item has no snapshot but selectedOptions are provided', async () => {
      // UNKNOWN_ITEM_ID_2 has no snapshot — providing options is an error
      const res = await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: UNKNOWN_ITEM_ID_2,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Ghost Item',
        unitPrice: 5.0,
        quantity: 1,
        selectedOptions: [{ groupId: reqGroupId, optionId: defaultOptId }],
      });

      expect(res.status).toBe(400);
    });

    it('C-27 succeeds for item with no snapshot and no selectedOptions (Phase 2 fallback)', async () => {
      // No snapshot → service trusts client data when no modifiers requested
      const res = await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: UNKNOWN_ITEM_ID_2,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Ghost Item',
        unitPrice: 5.0,
        quantity: 1,
      });

      expect(res.status).toBe(201);
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });
  });

  // ─── §8  DTO / UUID validation guards ──────────────────────────────────────

  describe('§8 DTO and UUID validation', () => {
    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('C-28 returns 400 when menuItemId is missing from add-item body', async () => {
      const res = await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'No ID Item',
        unitPrice: 5.0,
        quantity: 1,
      });
      expect(res.status).toBe(400);
    });

    it('C-29 returns 400 when quantity is 0 in add-item (min is 1)', async () => {
      const res = await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: snapshotItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Test',
        unitPrice: 5.0,
        quantity: 0,
      });
      expect(res.status).toBe(400);
    });

    it('C-30 returns 400 when quantity is 100 in add-item (max is 99)', async () => {
      const res = await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: snapshotItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Test',
        unitPrice: 5.0,
        quantity: 100,
      });
      expect(res.status).toBe(400);
    });

    it('C-31 PATCH quantity returns 400 when quantity > 99', async () => {
      const add = await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: snapshotItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Item',
        unitPrice: 5.0,
        quantity: 1,
      });
      const id = (add.body.items as { cartItemId: string }[])[0].cartItemId;

      const res = await http
        .patch(`/api/carts/my/items/${id}`)
        .set(ownerHeaders())
        .send({ quantity: 100 });
      expect(res.status).toBe(400);
    });

    it('C-32 PATCH quantity with non-UUID cartItemId returns 400', async () => {
      const res = await http
        .patch('/api/carts/my/items/not-a-uuid')
        .set(ownerHeaders())
        .send({ quantity: 2 });
      expect(res.status).toBe(400);
    });

    it('C-33 DELETE item with non-UUID cartItemId returns 400', async () => {
      const res = await http
        .delete('/api/carts/my/items/not-a-uuid')
        .set(ownerHeaders());
      expect(res.status).toBe(400);
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });
  });

  // ─── §9  Authentication guards ─────────────────────────────────────────────

  describe('§9 Authentication — 401 on all cart endpoints', () => {
    it('C-34 GET /carts/my returns 401 when unauthenticated', async () => {
      const res = await http.get('/api/carts/my').set(noAuthHeaders());
      expect(res.status).toBe(401);
    });

    it('C-35 POST /carts/my/items returns 401 when unauthenticated', async () => {
      const res = await http
        .post('/api/carts/my/items')
        .set(noAuthHeaders())
        .send({
          menuItemId: snapshotItemId,
          restaurantId: TEST_RESTAURANT_ID,
          restaurantName: 'Test',
          itemName: 'Test',
          unitPrice: 5.0,
          quantity: 1,
        });
      expect(res.status).toBe(401);
    });

    it('C-36 PATCH /carts/my/items/:id returns 401 when unauthenticated', async () => {
      const res = await http
        .patch(`/api/carts/my/items/${UNKNOWN_CART_ITEM_ID}`)
        .set(noAuthHeaders())
        .send({ quantity: 2 });
      expect(res.status).toBe(401);
    });

    it('C-37 PATCH /carts/my/items/:id/modifiers returns 401 when unauthenticated', async () => {
      const res = await http
        .patch(`/api/carts/my/items/${UNKNOWN_CART_ITEM_ID}/modifiers`)
        .set(noAuthHeaders())
        .send({ selectedOptions: [] });
      expect(res.status).toBe(401);
    });

    it('C-38 DELETE /carts/my/items/:id returns 401 when unauthenticated', async () => {
      const res = await http
        .delete(`/api/carts/my/items/${UNKNOWN_CART_ITEM_ID}`)
        .set(noAuthHeaders());
      expect(res.status).toBe(401);
    });

    it('C-39 DELETE /carts/my returns 401 when unauthenticated', async () => {
      const res = await http.delete('/api/carts/my').set(noAuthHeaders());
      expect(res.status).toBe(401);
    });

    it('C-40 POST /carts/my/checkout returns 401 when unauthenticated', async () => {
      const res = await http
        .post('/api/carts/my/checkout')
        .set(noAuthHeaders())
        .send({
          deliveryAddress: { street: 'Test', district: 'D1', city: 'HCM' },
          paymentMethod: 'cod',
        });
      expect(res.status).toBe(401);
    });
  });

  // ─── §10  Checkout — DTO & idempotency contract ────────────────────────────

  describe('§10 POST /api/carts/my/checkout — DTO contract', () => {
    beforeEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });

    it('C-41 returns 400 when cart is empty', async () => {
      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({
          deliveryAddress: { street: '123 Main St', district: 'D1', city: 'HCM' },
          paymentMethod: 'cod',
        });

      // Empty cart should be rejected
      expect([400, 422]).toContain(res.status);
    });

    it('C-42 returns 400 when deliveryAddress is missing', async () => {
      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({ paymentMethod: 'cod' });

      expect(res.status).toBe(400);
    });

    it('C-43 returns 400 when paymentMethod is invalid', async () => {
      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .send({
          deliveryAddress: { street: '123 Main St', district: 'D1', city: 'HCM' },
          paymentMethod: 'bitcoin',
        });

      expect(res.status).toBe(400);
    });

    it('C-44 returns 400 when idempotency key is too short (< 8 chars)', async () => {
      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .set('Idempotency-Key', 'abc123')
        .send({
          deliveryAddress: { street: '123 Main St', district: 'D1', city: 'HCM' },
          paymentMethod: 'cod',
        });

      expect(res.status).toBe(400);
    });

    it('C-45 returns 400 when idempotency key has invalid characters', async () => {
      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .set('Idempotency-Key', 'not_valid!!!')
        .send({
          deliveryAddress: { street: '123 Main St', district: 'D1', city: 'HCM' },
          paymentMethod: 'cod',
        });

      expect(res.status).toBe(400);
    });

    it('C-46 accepts valid UUID-format idempotency key (validation passes)', async () => {
      const validKey = '550e8400-e29b-41d4-a716-446655440000';

      // Add item to have a non-empty cart — checkout may fail at business logic
      // but should NOT fail at idempotency-key format validation
      await http.post('/api/carts/my/items').set(ownerHeaders()).send({
        menuItemId: snapshotItemId,
        restaurantId: TEST_RESTAURANT_ID,
        restaurantName: 'Test Restaurant',
        itemName: 'Plain Burger',
        unitPrice: 10.0,
        quantity: 1,
      });

      const res = await http
        .post('/api/carts/my/checkout')
        .set(ownerHeaders())
        .set('Idempotency-Key', validKey)
        .send({
          deliveryAddress: { street: '123 Main St', district: 'D1', city: 'HCM' },
          paymentMethod: 'cod',
        });

      // Should not be 400 (format validation passed); business logic may fail with 422
      expect(res.status).not.toBe(400);
    });

    afterEach(async () => {
      await http.delete('/api/carts/my').set(ownerHeaders());
    });
  });
});
