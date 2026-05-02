/**
 * zones.e2e-spec.ts
 *
 * Full-coverage end-to-end tests for Delivery Zone endpoints.
 *
 * Covers:
 *   §1  Create zone         — POST /api/restaurants/:id/delivery-zones (201, auth, validation)
 *   §2  List zones          — GET  /api/restaurants/:id/delivery-zones (200, public)
 *   §3  Get single zone     — GET  /api/restaurants/:id/delivery-zones/:zoneId (200, 404)
 *   §4  Update zone         — PATCH /api/restaurants/:id/delivery-zones/:zoneId (200, 401, 403, 404)
 *   §5  Deactivate zone     — PATCH with isActive: false → zone remains but isActive=false
 *   §6  Delete zone         — DELETE /api/restaurants/:id/delivery-zones/:zoneId (204, 404)
 *   §7  Delivery estimate   — GET  .../delivery-estimate (200 happy path, 422 out-of-range,
 *                              422 no coordinates, 422 no active zones, 400 invalid params)
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
import {
  setAuthManager,
  noAuthHeaders,
  otherUserHeaders,
  ownerHeaders,
} from '../helpers/auth';
import { TestAuthManager } from '../helpers/test-auth';

// ─── Geo constants ─────────────────────────────────────────────────────────
//
// Restaurant location: Ho Chi Minh City, Vietnam
// Customer (in range): ~0.7 km from restaurant
// Customer (far away): Hanoi, Vietnam (~1700 km from HCMC)

const RESTAURANT_LAT = 10.7769;
const RESTAURANT_LON = 106.7009;
const CUSTOMER_NEARBY_LAT = 10.7820;
const CUSTOMER_NEARBY_LON = 106.7060;
const CUSTOMER_FAR_LAT = 21.0278;
const CUSTOMER_FAR_LON = 105.8342;

// ─────────────────────────────────────────────────────────────────────────────

describe('Delivery Zone CRUD & Estimate (E2E)', () => {
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

    // Add coordinates to TEST_RESTAURANT so delivery estimate tests work
    await http
      .patch(`/api/restaurants/${TEST_RESTAURANT_ID}`)
      .set(ownerHeaders())
      .send({ latitude: RESTAURANT_LAT, longitude: RESTAURANT_LON });
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  // ─── §1 Create zone ────────────────────────────────────────────────────────

  describe('§1 POST /api/restaurants/:id/delivery-zones', () => {
    it('creates a zone with required fields and returns 201', async () => {
      const res = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(ownerHeaders())
        .send({
          name: 'City Zone',
          radiusKm: 5,
          baseFee: 15000,
          perKmRate: 3000,
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        restaurantId: TEST_RESTAURANT_ID,
        name: 'City Zone',
        radiusKm: 5,
        baseFee: 15000,
        perKmRate: 3000,
        isActive: true,
      });
      expect(res.body.id).toBeDefined();
    });

    it('creates a zone with all optional fields', async () => {
      const res = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(ownerHeaders())
        .send({
          name: 'Full Fields Zone',
          radiusKm: 3,
          baseFee: 10000,
          perKmRate: 2000,
          avgSpeedKmh: 25,
          prepTimeMinutes: 20,
          bufferMinutes: 10,
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        avgSpeedKmh: 25,
        prepTimeMinutes: 20,
        bufferMinutes: 10,
      });
    });

    it('applies default values for optional fields', async () => {
      const res = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(ownerHeaders())
        .send({
          name: 'Defaults Zone',
          radiusKm: 2,
          baseFee: 5000,
          perKmRate: 1000,
        });

      expect(res.status).toBe(201);
      expect(res.body.avgSpeedKmh).toBe(30);
      expect(res.body.prepTimeMinutes).toBe(15);
      expect(res.body.bufferMinutes).toBe(5);
      expect(res.body.isActive).toBe(true);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(noAuthHeaders())
        .send({ name: 'Hack', radiusKm: 1, baseFee: 0, perKmRate: 0 });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-owner', async () => {
      const res = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(otherUserHeaders())
        .send({ name: 'Intrusion', radiusKm: 1, baseFee: 0, perKmRate: 0 });

      expect(res.status).toBe(403);
    });

    it('returns 400 for missing name', async () => {
      const res = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(ownerHeaders())
        .send({ radiusKm: 1, baseFee: 0, perKmRate: 0 });

      expect(res.status).toBe(400);
    });

    it('returns 400 for radiusKm below minimum (< 0.1)', async () => {
      const res = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(ownerHeaders())
        .send({ name: 'Tiny Zone', radiusKm: 0.05, baseFee: 0, perKmRate: 0 });

      expect(res.status).toBe(400);
    });

    it('returns 400 for negative baseFee', async () => {
      const res = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(ownerHeaders())
        .send({ name: 'Neg Fee', radiusKm: 1, baseFee: -100, perKmRate: 0 });

      expect(res.status).toBe(400);
    });

    it('returns 400 for avgSpeedKmh exceeding max (> 120)', async () => {
      const res = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(ownerHeaders())
        .send({ name: 'Fast', radiusKm: 1, baseFee: 0, perKmRate: 0, avgSpeedKmh: 200 });

      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent restaurant', async () => {
      const res = await http
        .post('/api/restaurants/00000000-0000-4000-8000-000000000000/delivery-zones')
        .set(ownerHeaders())
        .send({ name: 'Ghost Zone', radiusKm: 1, baseFee: 0, perKmRate: 0 });

      expect(res.status).toBe(404);
    });
  });

  // ─── §2 List zones ─────────────────────────────────────────────────────────

  describe('§2 GET /api/restaurants/:id/delivery-zones', () => {
    it('returns an array of zones (public)', async () => {
      const res = await http
        .get(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('contains zones created in §1', async () => {
      const res = await http
        .get(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const names = (res.body as { name: string }[]).map((z) => z.name);
      expect(names).toContain('City Zone');
    });

    it('returns 400 for invalid restaurant UUID', async () => {
      const res = await http
        .get('/api/restaurants/not-a-uuid/delivery-zones')
        .set(noAuthHeaders());

      expect(res.status).toBe(400);
    });
  });

  // ─── §3 Get single zone ────────────────────────────────────────────────────

  describe('§3 GET /api/restaurants/:id/delivery-zones/:zoneId', () => {
    let zoneId: string;

    beforeAll(async () => {
      const res = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(ownerHeaders())
        .send({
          name: 'Get Test Zone',
          radiusKm: 4,
          baseFee: 12000,
          perKmRate: 2500,
        });
      zoneId = res.body.id as string;
    });

    it('returns 200 with zone details (authenticated)', async () => {
      const res = await http
        .get(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(zoneId);
      expect(res.body.restaurantId).toBe(TEST_RESTAURANT_ID);
      expect(res.body.name).toBe('Get Test Zone');
      expect(res.body.radiusKm).toBe(4);
    });

    it('returns 404 for non-existent zone', async () => {
      const res = await http
        .get(
          `/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/00000000-0000-4000-8000-000000000006`,
        )
        .set(ownerHeaders());

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid zone UUID', async () => {
      const res = await http
        .get(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/not-a-uuid`)
        .set(ownerHeaders());

      expect(res.status).toBe(400);
    });

    it('response includes all expected fields', async () => {
      const res = await http
        .get(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders());

      expect(res.body).toMatchObject({
        id: expect.any(String),
        restaurantId: expect.any(String),
        name: expect.any(String),
        radiusKm: expect.any(Number),
        baseFee: expect.any(Number),
        perKmRate: expect.any(Number),
        avgSpeedKmh: expect.any(Number),
        prepTimeMinutes: expect.any(Number),
        bufferMinutes: expect.any(Number),
        isActive: expect.any(Boolean),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });
  });

  // ─── §4 Update zone ────────────────────────────────────────────────────────

  describe('§4 PATCH /api/restaurants/:id/delivery-zones/:zoneId', () => {
    let zoneId: string;

    beforeAll(async () => {
      const res = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(ownerHeaders())
        .send({
          name: 'Patch Test Zone',
          radiusKm: 6,
          baseFee: 20000,
          perKmRate: 4000,
        });
      zoneId = res.body.id as string;
    });

    it('owner can update name and returns 200', async () => {
      const res = await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders())
        .send({ name: 'Updated Zone Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Zone Name');
    });

    it('owner can update baseFee', async () => {
      const res = await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders())
        .send({ baseFee: 18000 });

      expect(res.status).toBe(200);
      expect(res.body.baseFee).toBe(18000);
    });

    it('partial update preserves other fields', async () => {
      const before = await http
        .get(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders());
      const originalRadius = before.body.radiusKm as number;

      const res = await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders())
        .send({ perKmRate: 3500 });

      expect(res.status).toBe(200);
      expect(res.body.perKmRate).toBe(3500);
      expect(res.body.radiusKm).toBe(originalRadius); // unchanged
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(noAuthHeaders())
        .send({ name: 'Hack' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-owner', async () => {
      const res = await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(otherUserHeaders())
        .send({ name: 'Hack' });

      expect(res.status).toBe(403);
    });

    it('returns 404 for non-existent zone', async () => {
      const res = await http
        .patch(
          `/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/00000000-0000-4000-8000-000000000007`,
        )
        .set(ownerHeaders())
        .send({ name: 'Ghost' });

      expect(res.status).toBe(404);
    });
  });

  // ─── §5 Deactivate zone ────────────────────────────────────────────────────

  describe('§5 Deactivate zone via PATCH (isActive: false)', () => {
    let zoneId: string;

    beforeAll(async () => {
      const res = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(ownerHeaders())
        .send({
          name: 'Deactivatable Zone',
          radiusKm: 3,
          baseFee: 8000,
          perKmRate: 1500,
        });
      zoneId = res.body.id as string;
    });

    it('deactivates zone and returns 200 with isActive: false', async () => {
      const res = await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders())
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);
    });

    it('reactivates zone and returns 200 with isActive: true', async () => {
      const res = await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders())
        .send({ isActive: true });

      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(true);
    });

    it('GET after deactivate shows isActive: false', async () => {
      await http
        .patch(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders())
        .send({ isActive: false });

      const res = await http
        .get(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${zoneId}`)
        .set(ownerHeaders());

      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);
    });
  });

  // ─── §6 Delete zone ────────────────────────────────────────────────────────

  describe('§6 DELETE /api/restaurants/:id/delivery-zones/:zoneId', () => {
    let deletableZoneId: string;

    beforeAll(async () => {
      const res = await http
        .post(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones`)
        .set(ownerHeaders())
        .send({
          name: 'Deletable Zone',
          radiusKm: 1,
          baseFee: 5000,
          perKmRate: 1000,
        });
      deletableZoneId = res.body.id as string;
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await http
        .delete(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${deletableZoneId}`)
        .set(noAuthHeaders());

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-owner', async () => {
      const res = await http
        .delete(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${deletableZoneId}`)
        .set(otherUserHeaders());

      expect(res.status).toBe(403);
    });

    it('owner can delete zone and returns 204', async () => {
      const res = await http
        .delete(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${deletableZoneId}`)
        .set(ownerHeaders());

      expect(res.status).toBe(204);
    });

    it('returns 404 when fetching deleted zone', async () => {
      const res = await http
        .get(`/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/${deletableZoneId}`)
        .set(ownerHeaders());

      expect(res.status).toBe(404);
    });

    it('returns 404 for non-existent zone id', async () => {
      const res = await http
        .delete(
          `/api/restaurants/${TEST_RESTAURANT_ID}/delivery-zones/00000000-0000-4000-8000-000000000008`,
        )
        .set(ownerHeaders());

      expect(res.status).toBe(404);
    });
  });

  // ─── §7 Delivery estimate ──────────────────────────────────────────────────

  describe('§7 GET .../delivery-zones/delivery-estimate', () => {
    /** A dedicated restaurant with coordinates for clean estimate tests. */
    let estimateRestaurantId: string;
    let estimateZoneId: string;
    /** Restaurant WITHOUT coordinates — for the 422 no-location test. */
    let noCoordRestaurantId: string;

    beforeAll(async () => {
      // 1. Create restaurant WITH coordinates + a zone
      const rRes = await http
        .post('/api/restaurants')
        .set(ownerHeaders())
        .send({
          name: 'Estimate Test Restaurant',
          address: '1 HCMC Street',
          phone: '+84-888-888-8888',
          latitude: RESTAURANT_LAT,
          longitude: RESTAURANT_LON,
        });
      estimateRestaurantId = rRes.body.id as string;

      const zRes = await http
        .post(`/api/restaurants/${estimateRestaurantId}/delivery-zones`)
        .set(ownerHeaders())
        .send({
          name: 'Estimate Zone',
          radiusKm: 10,
          baseFee: 15000,
          perKmRate: 3000,
          avgSpeedKmh: 30,
          prepTimeMinutes: 15,
          bufferMinutes: 5,
        });
      estimateZoneId = zRes.body.id as string;

      // 2. Create restaurant WITHOUT coordinates (for 422 no-location test)
      const noCoordRes = await http
        .post('/api/restaurants')
        .set(ownerHeaders())
        .send({
          name: 'No Coord Restaurant',
          address: '2 HCMC Street',
          phone: '+84-777-777-7777',
        });
      noCoordRestaurantId = noCoordRes.body.id as string;
    });

    it('returns 200 with valid estimate for nearby customer', async () => {
      const res = await http
        .get(`/api/restaurants/${estimateRestaurantId}/delivery-zones/delivery-estimate`)
        .query({ lat: CUSTOMER_NEARBY_LAT, lon: CUSTOMER_NEARBY_LON })
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body.restaurantId).toBe(estimateRestaurantId);
      expect(res.body.distanceKm).toBeGreaterThan(0);
      expect(res.body.deliveryFee).toBeGreaterThan(0);
      expect(res.body.estimatedMinutes).toBeGreaterThan(0);
      expect(res.body.zone).toBeDefined();
      expect(res.body.zone.id).toBe(estimateZoneId);
    });

    it('estimate response contains full breakdown', async () => {
      const res = await http
        .get(`/api/restaurants/${estimateRestaurantId}/delivery-zones/delivery-estimate`)
        .query({ lat: CUSTOMER_NEARBY_LAT, lon: CUSTOMER_NEARBY_LON })
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        restaurantId: estimateRestaurantId,
        distanceKm: expect.any(Number),
        deliveryFee: expect.any(Number),
        estimatedMinutes: expect.any(Number),
        zone: {
          id: expect.any(String),
          name: expect.any(String),
          radiusKm: expect.any(Number),
        },
        breakdown: {
          baseFee: expect.any(Number),
          distanceFee: expect.any(Number),
          prepTimeMinutes: expect.any(Number),
          travelTimeMinutes: expect.any(Number),
          bufferMinutes: expect.any(Number),
        },
      });
    });

    it('deliveryFee = baseFee + distanceFee', async () => {
      const res = await http
        .get(`/api/restaurants/${estimateRestaurantId}/delivery-zones/delivery-estimate`)
        .query({ lat: CUSTOMER_NEARBY_LAT, lon: CUSTOMER_NEARBY_LON })
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const { baseFee, distanceFee } = res.body.breakdown as {
        baseFee: number;
        distanceFee: number;
      };
      expect(res.body.deliveryFee).toBe(baseFee + distanceFee);
    });

    it('estimatedMinutes = prep + travel + buffer', async () => {
      const res = await http
        .get(`/api/restaurants/${estimateRestaurantId}/delivery-zones/delivery-estimate`)
        .query({ lat: CUSTOMER_NEARBY_LAT, lon: CUSTOMER_NEARBY_LON })
        .set(noAuthHeaders());

      expect(res.status).toBe(200);
      const { prepTimeMinutes, travelTimeMinutes, bufferMinutes } =
        res.body.breakdown as {
          prepTimeMinutes: number;
          travelTimeMinutes: number;
          bufferMinutes: number;
        };
      expect(res.body.estimatedMinutes).toBe(
        prepTimeMinutes + travelTimeMinutes + bufferMinutes,
      );
    });

    it('returns 422 for customer outside all zone radii', async () => {
      const res = await http
        .get(`/api/restaurants/${estimateRestaurantId}/delivery-zones/delivery-estimate`)
        .query({ lat: CUSTOMER_FAR_LAT, lon: CUSTOMER_FAR_LON })
        .set(noAuthHeaders());

      expect(res.status).toBe(422);
    });

    it('returns 422 when restaurant has no coordinates', async () => {
      const res = await http
        .get(`/api/restaurants/${noCoordRestaurantId}/delivery-zones/delivery-estimate`)
        .query({ lat: CUSTOMER_NEARBY_LAT, lon: CUSTOMER_NEARBY_LON })
        .set(noAuthHeaders());

      expect(res.status).toBe(422);
    });

    it('returns 422 when all zones are inactive', async () => {
      // Deactivate the estimate zone
      await http
        .patch(`/api/restaurants/${estimateRestaurantId}/delivery-zones/${estimateZoneId}`)
        .set(ownerHeaders())
        .send({ isActive: false });

      const res = await http
        .get(`/api/restaurants/${estimateRestaurantId}/delivery-zones/delivery-estimate`)
        .query({ lat: CUSTOMER_NEARBY_LAT, lon: CUSTOMER_NEARBY_LON })
        .set(noAuthHeaders());

      expect(res.status).toBe(422);

      // Restore
      await http
        .patch(`/api/restaurants/${estimateRestaurantId}/delivery-zones/${estimateZoneId}`)
        .set(ownerHeaders())
        .send({ isActive: true });
    });

    it('returns 400 for missing lat', async () => {
      const res = await http
        .get(`/api/restaurants/${estimateRestaurantId}/delivery-zones/delivery-estimate`)
        .query({ lon: RESTAURANT_LON })
        .set(noAuthHeaders());

      expect(res.status).toBe(400);
    });

    it('returns 400 for missing lon', async () => {
      const res = await http
        .get(`/api/restaurants/${estimateRestaurantId}/delivery-zones/delivery-estimate`)
        .query({ lat: RESTAURANT_LAT })
        .set(noAuthHeaders());

      expect(res.status).toBe(400);
    });

    it('returns 400 for latitude out of range (> 90)', async () => {
      const res = await http
        .get(`/api/restaurants/${estimateRestaurantId}/delivery-zones/delivery-estimate`)
        .query({ lat: 999, lon: RESTAURANT_LON })
        .set(noAuthHeaders());

      expect(res.status).toBe(400);
    });

    it('returns 400 for longitude out of range (> 180)', async () => {
      const res = await http
        .get(`/api/restaurants/${estimateRestaurantId}/delivery-zones/delivery-estimate`)
        .query({ lat: RESTAURANT_LAT, lon: 999 })
        .set(noAuthHeaders());

      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent restaurant', async () => {
      const res = await http
        .get('/api/restaurants/00000000-0000-4000-8000-000000000009/delivery-zones/delivery-estimate')
        .query({ lat: CUSTOMER_NEARBY_LAT, lon: CUSTOMER_NEARBY_LON })
        .set(noAuthHeaders());

      expect(res.status).toBe(404);
    });

    it('estimate is accessible without authentication (public endpoint)', async () => {
      const res = await http
        .get(`/api/restaurants/${estimateRestaurantId}/delivery-zones/delivery-estimate`)
        .query({ lat: CUSTOMER_NEARBY_LAT, lon: CUSTOMER_NEARBY_LON })
        // No auth headers
        ;

      expect(res.status).toBe(200);
    });
  });
});
