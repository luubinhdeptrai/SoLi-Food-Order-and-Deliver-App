/**
 * Master seed script — seeds all tables with fixed UUIDs for development & testing.
 *
 * Run:  pnpm db:seed
 *
 * Behavior: Deletes all existing data, then inserts fresh test data.
 * Safe to re-run; each run starts with a clean slate.
 *
 * Fixed UUIDs (copy into test scripts):
 * ──────────────────────────────────────────────────────────────────────────────
 *  USERS
 *    Owner 1  : 11111111-1111-4111-8111-111111111111
 *    Customer : 22222222-2222-4222-8222-222222222222
 *    Owner 2  : 33333333-3333-4333-8333-333333333333
 *
 *  RESTAURANTS
 *    Phở Bắc           (Vietnamese, D1, open)      : fe8b2648-2260-4bc5-9acd-d88972148c78
 *    Bếp Đóng Cửa     (Vietnamese, D3, closed)     : cccccccc-cccc-4ccc-8ccc-cccccccccccc
 *    Cơm Tấm Sài Gòn  (Vietnamese, D1, open)       : dddddddd-dddd-4ddd-8ddd-dddddddddddd
 *    Seoul BBQ & More  (Korean,     D7, open)       : eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee
 *    Sushi Hana        (Japanese,   BT, open)       : ffffffff-ffff-4fff-8fff-ffffffffffff
 *    (Sushi Hana has no delivery zones — edge case)
 *
 *  DELIVERY ZONES
 *    Phở Bắc — Inner (2 km)   : bb000001-0000-4000-8000-000000000001
 *    Phở Bắc — City  (5 km)   : bb000002-0000-4000-8000-000000000002
 *    Bếp Đóng Cửa   (3 km)    : bb000003-0000-4000-8000-000000000003
 *    Cơm Tấm — Inner (2 km)   : bb000004-0000-4000-8000-000000000004
 *    Cơm Tấm — City  (5 km)   : bb000005-0000-4000-8000-000000000005
 *    Seoul BBQ — Inner (2 km) : bb000006-0000-4000-8000-000000000006
 *    Seoul BBQ — Wide  (8 km) : bb000007-0000-4000-8000-000000000007
 *
 *  KEY SEARCH SCENARIOS
 *    ?q=pho             → Phở Bắc (restaurant) + Phở Bò, Phở Gà (items)
 *    ?q=banh+mi         → Bánh Mì Thịt Nướng (R3) + Bánh Mì Cá Hồi (R5) items
 *    ?item=banh+mi      → same two items with embedded restaurant context
 *    ?cuisineType=Viet… → R1, R2, R3
 *    ?cuisineType=Korean → R4
 *    ?tag=spicy         → Bún Bò Huế (R1), Kimchi Jjigae (R4)
 *    ?tag=vegetarian    → Cơm Chay (R3)
 *    ?lat=10.77&lon=106.67&radiusKm=3 → R1 + R3 (both within 3 km)
 *
 *  APP SETTINGS
 *    ORDER_IDEMPOTENCY_TTL_SECONDS     = 300
 *    RESTAURANT_ACCEPT_TIMEOUT_SECONDS = 600
 *    CART_ABANDONED_TTL_SECONDS        = 86400
 * ──────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';

import { user } from '../../module/auth/auth.schema';
import {
  restaurants,
  deliveryZones,
} from '../../module/restaurant-catalog/restaurant/restaurant.schema';
import {
  menuItems,
  menuCategories,
} from '../../module/restaurant-catalog/menu/menu.schema';
import { appSettings } from '../../module/ordering/common/app-settings.schema';
import { orderingRestaurantSnapshots } from '../../module/ordering/acl/schemas/restaurant-snapshot.schema';
import { orderingMenuItemSnapshots } from '../../module/ordering/acl/schemas/menu-item-snapshot.schema';
import { orderingDeliveryZoneSnapshots } from '../../module/ordering/acl/schemas/delivery-zone-snapshot.schema';

const db = drizzle(process.env.DATABASE_URL!);

// ─── Fixed IDs ────────────────────────────────────────────────────────────────

const IDS = {
  // ── Users ──────────────────────────────────────────────────────────────────
  ownerUserId: '11111111-1111-4111-8111-111111111111',
  customerUserId: '22222222-2222-4222-8222-222222222222',
  owner2UserId: '33333333-3333-4333-8333-333333333333',

  // ── Restaurants ────────────────────────────────────────────────────────────
  // R1: Vietnamese pho house — District 1, open & approved
  restaurant1: 'fe8b2648-2260-4bc5-9acd-d88972148c78',
  // R2: Permanently closed restaurant — District 3, edge case
  restaurant2: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  // R3: Vietnamese rice dishes — District 1, open & approved
  restaurant3: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  // R4: Korean BBQ — District 7, open & approved
  restaurant4: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  // R5: Japanese sushi — Bình Thạnh, open & approved, NO delivery zones
  restaurant5: 'ffffffff-ffff-4fff-8fff-ffffffffffff',

  // ── Delivery Zones ──────────────────────────────────────────────────────────
  zone1Inner: 'bb000001-0000-4000-8000-000000000001', // R1 — 2 km
  zone1City: 'bb000002-0000-4000-8000-000000000002', // R1 — 5 km
  zone2Only: 'bb000003-0000-4000-8000-000000000003', // R2 — 3 km (closed restaurant)
  zone3Inner: 'bb000004-0000-4000-8000-000000000004', // R3 — 2 km
  zone3City: 'bb000005-0000-4000-8000-000000000005', // R3 — 5 km
  zone4Inner: 'bb000006-0000-4000-8000-000000000006', // R4 — 2 km
  zone4Wide: 'bb000007-0000-4000-8000-000000000007', // R4 — 8 km

  // ── Menu Categories — R1 Phở Bắc ──────────────────────────────────────────
  catR1Noodles: 'cc000001-0000-4000-8000-000000000001',
  catR1Sides: 'cc000002-0000-4000-8000-000000000002',
  catR1Drinks: 'cc000003-0000-4000-8000-000000000003',

  // ── Menu Categories — R2 Bếp Đóng Cửa ─────────────────────────────────────
  catR2Mains: 'cc000004-0000-4000-8000-000000000004',

  // ── Menu Categories — R3 Cơm Tấm Sài Gòn ──────────────────────────────────
  catR3Rice: 'cc000005-0000-4000-8000-000000000005',
  catR3Sandwiches: 'cc000006-0000-4000-8000-000000000006',
  catR3Drinks: 'cc000007-0000-4000-8000-000000000007',

  // ── Menu Categories — R4 Seoul BBQ ─────────────────────────────────────────
  catR4Bbq: 'cc000008-0000-4000-8000-000000000008',
  catR4Stews: 'cc000009-0000-4000-8000-000000000009',
  catR4Drinks: 'cc000010-0000-4000-8000-000000000010',

  // ── Menu Categories — R5 Sushi Hana ────────────────────────────────────────
  catR5Sushi: 'cc000011-0000-4000-8000-000000000011',
  catR5Sashimi: 'cc000012-0000-4000-8000-000000000012',
  catR5Drinks: 'cc000013-0000-4000-8000-000000000013',

  // ── Menu Items — R1 Phở Bắc ────────────────────────────────────────────────
  r1Pho1: '4dc7cdfa-5a54-402f-b1a8-2d47de146081', // Phở Bò Tái Nạm (legacy ID)
  r1Pho2: 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5', // Phở Gà (legacy ID)
  r1BunBo: 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6', // Bún Bò Huế (legacy ID)
  r1BanhCuon: 'dd000004-0000-4000-8000-000000000004', // Bánh Cuốn
  r1TraDa: 'dd000005-0000-4000-8000-000000000005', // Trà Đá

  // ── Menu Items — R2 Bếp Đóng Cửa ──────────────────────────────────────────
  r2Burger: 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6', // Classic Burger (legacy ID)

  // ── Menu Items — R3 Cơm Tấm Sài Gòn ───────────────────────────────────────
  r3ComTam1: 'dd000010-0000-4000-8000-000000000010', // Cơm Tấm Sườn Nướng
  r3ComTam2: 'dd000011-0000-4000-8000-000000000011', // Cơm Tấm Bì Chả
  r3BanhMi: 'dd000012-0000-4000-8000-000000000012', // Bánh Mì Thịt Nướng ← "banh mi"
  r3ComChay: 'dd000013-0000-4000-8000-000000000013', // Cơm Chay ← "vegetarian"
  r3NuocNgot: 'dd000014-0000-4000-8000-000000000014', // Nước Ngọt

  // ── Menu Items — R4 Seoul BBQ ──────────────────────────────────────────────
  r4Bbq: 'dd000020-0000-4000-8000-000000000020', // Thịt Nướng Hàn Quốc
  r4Kimchi: 'dd000021-0000-4000-8000-000000000021', // Kimchi Jjigae ← "spicy"
  r4Bibimbap: 'dd000022-0000-4000-8000-000000000022', // Bibimbap
  r4TraSua: 'dd000023-0000-4000-8000-000000000023', // Trà Sữa Trân Châu

  // ── Menu Items — R5 Sushi Hana ─────────────────────────────────────────────
  r5Sushi: 'dd000030-0000-4000-8000-000000000030', // Sushi Cá Hồi
  r5Sashimi: 'dd000031-0000-4000-8000-000000000031', // Sashimi Cá Ngừ
  r5BanhMi: 'dd000032-0000-4000-8000-000000000032', // Bánh Mì Cá Hồi ← "banh mi" (cross-restaurant)
  r5TraXanh: 'dd000033-0000-4000-8000-000000000033', // Trà Xanh Nhật Bản
} as const;

// ─── Delete functions (reverse insert order to respect foreign keys) ──────────

async function deleteOrderingDeliveryZoneSnapshots() {
  await db.delete(orderingDeliveryZoneSnapshots);
  console.log('🗑️  ordering_delivery_zone_snapshots cleared');
}

async function deleteOrderingMenuItemSnapshots() {
  await db.delete(orderingMenuItemSnapshots);
  console.log('🗑️  ordering_menu_item_snapshots cleared');
}

async function deleteOrderingRestaurantSnapshots() {
  await db.delete(orderingRestaurantSnapshots);
  console.log('🗑️  ordering_restaurant_snapshots cleared');
}

async function deleteMenuItems() {
  await db.delete(menuItems);
  console.log('🗑️  menu_items cleared');
}

async function deleteMenuCategories() {
  await db.delete(menuCategories);
  console.log('🗑️  menu_categories cleared');
}

async function deleteDeliveryZones() {
  await db.delete(deliveryZones);
  console.log('🗑️  delivery_zones cleared');
}

async function deleteRestaurants() {
  await db.delete(restaurants);
  console.log('🗑️  restaurants cleared');
}

async function deleteAppSettings() {
  await db.delete(appSettings);
  console.log('🗑️  app_settings cleared');
}

async function deleteUsers() {
  await db.delete(user);
  console.log('🗑️  users cleared');
}

// ─── Seed functions ───────────────────────────────────────────────────────────

async function seedUsers() {
  const rows = [
    {
      id: IDS.ownerUserId,
      name: 'Restaurant Owner',
      email: 'owner@soli.dev',
      emailVerified: true,
    },
    {
      id: IDS.customerUserId,
      name: 'Test Customer',
      email: 'customer@soli.dev',
      emailVerified: true,
    },
    {
      id: IDS.owner2UserId,
      name: 'Second Owner',
      email: 'owner2@soli.dev',
      emailVerified: true,
    },
  ];
  await db.insert(user).values(rows);
  console.log('✅ users seeded');
}

async function seedRestaurants() {
  const rows = [
    // ── R1: Phở Bắc ─────────────────────────────────────────────────────────
    {
      id: IDS.restaurant1,
      ownerId: IDS.ownerUserId,
      name: 'Phở Bắc',
      description: 'Phở Bắc chính hiệu — nước dùng hầm xương 12 tiếng.',
      address: '45 Nguyễn Huệ, Quận 1, TP.HCM',
      phone: '+84-28-1234-5678',
      isOpen: true,
      isApproved: true,
      cuisineType: 'Vietnamese',
      latitude: 10.762622,
      longitude: 106.660172,
    },
    // ── R2: Bếp Đóng Cửa (closed) ────────────────────────────────────────────
    {
      id: IDS.restaurant2,
      ownerId: IDS.ownerUserId,
      name: 'Bếp Đóng Cửa',
      description: 'Tạm đóng cửa để cải tạo.',
      address: '12 Hai Bà Trưng, Quận 3, TP.HCM',
      phone: '+84-28-9876-5432',
      isOpen: false,
      isApproved: true,
      cuisineType: 'Vietnamese',
      latitude: 10.775,
      longitude: 106.701,
    },
    // ── R3: Cơm Tấm Sài Gòn ──────────────────────────────────────────────────
    {
      id: IDS.restaurant3,
      ownerId: IDS.ownerUserId,
      name: 'Cơm Tấm Sài Gòn',
      description: 'Cơm tấm sườn nướng, bì chả — đặc sản miền Nam.',
      address: '78 Lê Lợi, Quận 1, TP.HCM',
      phone: '+84-28-3456-7890',
      isOpen: true,
      isApproved: true,
      cuisineType: 'Vietnamese',
      latitude: 10.768,
      longitude: 106.682,
    },
    // ── R4: Seoul BBQ & More ──────────────────────────────────────────────────
    {
      id: IDS.restaurant4,
      ownerId: IDS.owner2UserId,
      name: 'Seoul BBQ & More',
      description: 'Thịt nướng Hàn Quốc, kimchi, bibimbap chính gốc.',
      address: '30 Nguyễn Văn Linh, Quận 7, TP.HCM',
      phone: '+84-28-7654-3210',
      isOpen: true,
      isApproved: true,
      cuisineType: 'Korean',
      latitude: 10.736,
      longitude: 106.703,
    },
    // ── R5: Sushi Hana (no delivery zones — edge case) ────────────────────────
    {
      id: IDS.restaurant5,
      ownerId: IDS.owner2UserId,
      name: 'Sushi Hana',
      description: 'Sushi và sashimi Nhật Bản — nguyên liệu nhập khẩu.',
      address: '5 Phan Đăng Lưu, Bình Thạnh, TP.HCM',
      phone: '+84-28-2468-1357',
      isOpen: true,
      isApproved: true,
      cuisineType: 'Japanese',
      latitude: 10.802,
      longitude: 106.706,
    },
  ];
  await db.insert(restaurants).values(rows);
  console.log('✅ restaurants seeded (5 rows)');
}

// Delivery fee constants — all values represent VND / 1000 (e.g. 15 = 15,000 VND)
const BASE_FEE_STANDARD = 15.0; // 15,000 VND base fee
const BASE_FEE_WIDE = 20.0; // 20,000 VND base fee for wide zones
const PER_KM_STANDARD = 5.0; // 5,000 VND / km
const PER_KM_WIDE = 7.0; // 7,000 VND / km (wider zones cost more)
const AVG_SPEED_CITY = 25; // km/h — slow city traffic
const AVG_SPEED_HIGHWAY = 35; // km/h — mixed roads
const PREP_TIME_NOODLE = 10; // minutes — noodle dishes are fast
const PREP_TIME_STANDARD = 15; // minutes — standard prep
const PREP_TIME_BBQ = 20; // minutes — BBQ needs more time
const BUFFER_MINUTES = 5; // minutes — standard buffer for all zones

async function seedDeliveryZones() {
  const rows = [
    // ── R1 Phở Bắc — two zones ────────────────────────────────────────────────
    {
      id: IDS.zone1Inner,
      restaurantId: IDS.restaurant1,
      name: 'Nội thành (2 km)',
      radiusKm: 2,
      baseFee: BASE_FEE_STANDARD,
      perKmRate: PER_KM_STANDARD,
      avgSpeedKmh: AVG_SPEED_CITY,
      prepTimeMinutes: PREP_TIME_NOODLE,
      bufferMinutes: BUFFER_MINUTES,
      isActive: true,
    },
    {
      id: IDS.zone1City,
      restaurantId: IDS.restaurant1,
      name: 'Toàn thành (5 km)',
      radiusKm: 5,
      baseFee: BASE_FEE_STANDARD,
      perKmRate: PER_KM_WIDE,
      avgSpeedKmh: AVG_SPEED_CITY,
      prepTimeMinutes: PREP_TIME_NOODLE,
      bufferMinutes: BUFFER_MINUTES,
      isActive: true,
    },
    // ── R2 Bếp Đóng Cửa — one zone (closed restaurant, still has zone data) ──
    {
      id: IDS.zone2Only,
      restaurantId: IDS.restaurant2,
      name: 'Khu vực giao hàng (3 km)',
      radiusKm: 3,
      baseFee: BASE_FEE_STANDARD,
      perKmRate: PER_KM_STANDARD,
      avgSpeedKmh: AVG_SPEED_CITY,
      prepTimeMinutes: PREP_TIME_STANDARD,
      bufferMinutes: BUFFER_MINUTES,
      isActive: false, // zone inactive because restaurant is closed
    },
    // ── R3 Cơm Tấm Sài Gòn — two zones ──────────────────────────────────────
    {
      id: IDS.zone3Inner,
      restaurantId: IDS.restaurant3,
      name: 'Nội thành (2 km)',
      radiusKm: 2,
      baseFee: BASE_FEE_STANDARD,
      perKmRate: PER_KM_STANDARD,
      avgSpeedKmh: AVG_SPEED_CITY,
      prepTimeMinutes: PREP_TIME_STANDARD,
      bufferMinutes: BUFFER_MINUTES,
      isActive: true,
    },
    {
      id: IDS.zone3City,
      restaurantId: IDS.restaurant3,
      name: 'Mở rộng (5 km)',
      radiusKm: 5,
      baseFee: BASE_FEE_STANDARD,
      perKmRate: PER_KM_WIDE,
      avgSpeedKmh: AVG_SPEED_CITY,
      prepTimeMinutes: PREP_TIME_STANDARD,
      bufferMinutes: BUFFER_MINUTES,
      isActive: true,
    },
    // ── R4 Seoul BBQ — two zones ──────────────────────────────────────────────
    {
      id: IDS.zone4Inner,
      restaurantId: IDS.restaurant4,
      name: 'Quận 7 nội bộ (2 km)',
      radiusKm: 2,
      baseFee: BASE_FEE_STANDARD,
      perKmRate: PER_KM_STANDARD,
      avgSpeedKmh: AVG_SPEED_HIGHWAY,
      prepTimeMinutes: PREP_TIME_BBQ,
      bufferMinutes: BUFFER_MINUTES,
      isActive: true,
    },
    {
      id: IDS.zone4Wide,
      restaurantId: IDS.restaurant4,
      name: 'Liên quận (8 km)',
      radiusKm: 8,
      baseFee: BASE_FEE_WIDE,
      perKmRate: PER_KM_WIDE,
      avgSpeedKmh: AVG_SPEED_HIGHWAY,
      prepTimeMinutes: PREP_TIME_BBQ,
      bufferMinutes: BUFFER_MINUTES,
      isActive: true,
    },
    // R5 Sushi Hana — intentionally no zones (edge case for search tests)
  ];
  await db.insert(deliveryZones).values(rows);
  console.log('✅ delivery_zones seeded (7 rows, R5 has none)');
}

async function seedMenuCategories() {
  const rows = [
    // ── R1 Phở Bắc ────────────────────────────────────────────────────────────
    {
      id: IDS.catR1Noodles,
      restaurantId: IDS.restaurant1,
      name: 'Noodles',
      displayOrder: 1,
    },
    {
      id: IDS.catR1Sides,
      restaurantId: IDS.restaurant1,
      name: 'Side Dishes',
      displayOrder: 2,
    },
    {
      id: IDS.catR1Drinks,
      restaurantId: IDS.restaurant1,
      name: 'Drinks',
      displayOrder: 3,
    },
    // ── R2 Bếp Đóng Cửa ───────────────────────────────────────────────────────
    {
      id: IDS.catR2Mains,
      restaurantId: IDS.restaurant2,
      name: 'Main Dishes',
      displayOrder: 1,
    },
    // ── R3 Cơm Tấm Sài Gòn ────────────────────────────────────────────────────
    {
      id: IDS.catR3Rice,
      restaurantId: IDS.restaurant3,
      name: 'Rice Dishes',
      displayOrder: 1,
    },
    {
      id: IDS.catR3Sandwiches,
      restaurantId: IDS.restaurant3,
      name: 'Sandwiches',
      displayOrder: 2,
    },
    {
      id: IDS.catR3Drinks,
      restaurantId: IDS.restaurant3,
      name: 'Drinks',
      displayOrder: 3,
    },
    // ── R4 Seoul BBQ ──────────────────────────────────────────────────────────
    {
      id: IDS.catR4Bbq,
      restaurantId: IDS.restaurant4,
      name: 'BBQ',
      displayOrder: 1,
    },
    {
      id: IDS.catR4Stews,
      restaurantId: IDS.restaurant4,
      name: 'Stews',
      displayOrder: 2,
    },
    {
      id: IDS.catR4Drinks,
      restaurantId: IDS.restaurant4,
      name: 'Drinks',
      displayOrder: 3,
    },
    // ── R5 Sushi Hana ──────────────────────────────────────────────────────────
    {
      id: IDS.catR5Sushi,
      restaurantId: IDS.restaurant5,
      name: 'Sushi',
      displayOrder: 1,
    },
    {
      id: IDS.catR5Sashimi,
      restaurantId: IDS.restaurant5,
      name: 'Sashimi',
      displayOrder: 2,
    },
    {
      id: IDS.catR5Drinks,
      restaurantId: IDS.restaurant5,
      name: 'Drinks',
      displayOrder: 3,
    },
  ];
  await db.insert(menuCategories).values(rows);
  console.log('✅ menu_categories seeded (13 rows)');
}

async function seedMenuItems() {
  const rows = [
    // ── R1 Phở Bắc ────────────────────────────────────────────────────────────
    {
      id: IDS.r1Pho1,
      restaurantId: IDS.restaurant1,
      categoryId: IDS.catR1Noodles,
      name: 'Phở Bò Tái Nạm',
      description:
        'Phở bò truyền thống — nước dùng hầm xương bò 12 tiếng, tái + nạm.',
      price: 8.5,
      tags: ['beef', 'soup', 'noodle'],
      status: 'available' as const,
    },
    {
      id: IDS.r1Pho2,
      restaurantId: IDS.restaurant1,
      categoryId: IDS.catR1Noodles,
      name: 'Phở Gà',
      description: 'Phở gà ta — nước dùng thanh ngọt tự nhiên từ xương gà.',
      price: 7.5,
      tags: ['chicken', 'soup', 'noodle'],
      status: 'available' as const,
    },
    {
      id: IDS.r1BunBo,
      restaurantId: IDS.restaurant1,
      categoryId: IDS.catR1Noodles,
      name: 'Bún Bò Huế',
      description: 'Bún bò Huế cay đặc trưng — mắm ruốc, sả, ớt.',
      price: 8.0,
      tags: ['spicy', 'beef', 'soup', 'noodle'],
      status: 'available' as const,
    },
    {
      id: IDS.r1BanhCuon,
      restaurantId: IDS.restaurant1,
      categoryId: IDS.catR1Sides,
      name: 'Bánh Cuốn',
      description:
        'Bánh cuốn nhân thịt bằm, mộc nhĩ — ăn kèm chả lụa và nước mắm.',
      price: 5.5,
      tags: ['pork', 'steamed'],
      status: 'available' as const,
    },
    {
      id: IDS.r1TraDa,
      restaurantId: IDS.restaurant1,
      categoryId: IDS.catR1Drinks,
      name: 'Trà Đá',
      description: 'Trà đá miễn phí khi dùng tại bàn.',
      price: 0.5,
      tags: ['cold', 'tea'],
      status: 'available' as const,
    },

    // ── R2 Bếp Đóng Cửa (1 item — closed restaurant edge case) ───────────────
    {
      id: IDS.r2Burger,
      restaurantId: IDS.restaurant2,
      categoryId: IDS.catR2Mains,
      name: 'Classic Burger',
      description: 'Beef patty, lettuce, tomato, cheese.',
      price: 11.0,
      tags: ['beef', 'fastfood'],
      status: 'available' as const,
    },

    // ── R3 Cơm Tấm Sài Gòn ────────────────────────────────────────────────────
    {
      id: IDS.r3ComTam1,
      restaurantId: IDS.restaurant3,
      categoryId: IDS.catR3Rice,
      name: 'Cơm Tấm Sườn Nướng',
      description: 'Cơm tấm kèm sườn nướng than hoa, trứng chiên, đồ chua.',
      price: 9.0,
      tags: ['pork', 'grilled', 'rice'],
      status: 'available' as const,
    },
    {
      id: IDS.r3ComTam2,
      restaurantId: IDS.restaurant3,
      categoryId: IDS.catR3Rice,
      name: 'Cơm Tấm Bì Chả',
      description: 'Cơm tấm kèm bì lợn và chả trứng hấp.',
      price: 8.5,
      tags: ['pork', 'rice'],
      status: 'available' as const,
    },
    {
      // Same item name exists in R5 — tests cross-restaurant search
      id: IDS.r3BanhMi,
      restaurantId: IDS.restaurant3,
      categoryId: IDS.catR3Sandwiches,
      name: 'Bánh Mì Thịt Nướng',
      description:
        'Bánh mì giòn nhân thịt heo nướng, đồ chua, rau thơm, tương ớt.',
      price: 3.5,
      tags: ['pork', 'grilled', 'sandwich'],
      status: 'available' as const,
    },
    {
      id: IDS.r3ComChay,
      restaurantId: IDS.restaurant3,
      categoryId: IDS.catR3Rice,
      name: 'Cơm Chay',
      description: 'Cơm trắng kèm đậu phụ, rau củ xào và canh chay.',
      price: 7.0,
      tags: ['vegetarian', 'vegan', 'rice'],
      status: 'available' as const,
    },
    {
      id: IDS.r3NuocNgot,
      restaurantId: IDS.restaurant3,
      categoryId: IDS.catR3Drinks,
      name: 'Nước Ngọt',
      description: 'Coca-Cola, Sprite, 7Up — lon 330ml.',
      price: 1.5,
      tags: ['cold', 'soft-drink'],
      status: 'available' as const,
    },

    // ── R4 Seoul BBQ & More ────────────────────────────────────────────────────
    {
      id: IDS.r4Bbq,
      restaurantId: IDS.restaurant4,
      categoryId: IDS.catR4Bbq,
      name: 'Thịt Nướng Hàn Quốc',
      description:
        'Bộ thịt nướng ba chỉ và ba rọi — ướp sốt gochujang, ăn kèm rau cuốn.',
      price: 18.0,
      tags: ['pork', 'grilled', 'korean'],
      status: 'available' as const,
    },
    {
      id: IDS.r4Kimchi,
      restaurantId: IDS.restaurant4,
      categoryId: IDS.catR4Stews,
      name: 'Kimchi Jjigae',
      description: 'Canh kimchi hầm thịt heo và đậu phụ — cay đậm đà.',
      price: 12.0,
      tags: ['spicy', 'pork', 'soup', 'korean'],
      status: 'available' as const,
    },
    {
      id: IDS.r4Bibimbap,
      restaurantId: IDS.restaurant4,
      categoryId: IDS.catR4Bbq,
      name: 'Bibimbap',
      description:
        'Cơm trộn Hàn Quốc — rau namul, thịt bò, trứng lòng đào, tương gochujang.',
      price: 13.5,
      tags: ['beef', 'rice', 'korean'],
      status: 'available' as const,
    },
    {
      id: IDS.r4TraSua,
      restaurantId: IDS.restaurant4,
      categoryId: IDS.catR4Drinks,
      name: 'Trà Sữa Trân Châu',
      description:
        'Trà sữa Hàn Quốc — trân châu đen, có thể chọn mức đường và đá.',
      price: 4.5,
      tags: ['cold', 'tea', 'korean'],
      status: 'available' as const,
    },

    // ── R5 Sushi Hana ──────────────────────────────────────────────────────────
    {
      id: IDS.r5Sushi,
      restaurantId: IDS.restaurant5,
      categoryId: IDS.catR5Sushi,
      name: 'Sushi Cá Hồi',
      description: 'Sushi cá hồi Na Uy nhập khẩu — 8 miếng.',
      price: 15.0,
      tags: ['seafood', 'japanese', 'raw'],
      status: 'available' as const,
    },
    {
      id: IDS.r5Sashimi,
      restaurantId: IDS.restaurant5,
      categoryId: IDS.catR5Sashimi,
      name: 'Sashimi Cá Ngừ',
      description: 'Sashimi cá ngừ đại dương thái lát mỏng — 10 lát.',
      price: 18.0,
      tags: ['seafood', 'japanese', 'raw'],
      status: 'available' as const,
    },
    {
      // Intentionally same "bánh mì" name as R3 item — tests cross-restaurant search
      id: IDS.r5BanhMi,
      restaurantId: IDS.restaurant5,
      categoryId: IDS.catR5Sushi,
      name: 'Bánh Mì Cá Hồi',
      description: 'Bánh mì Nhật Bản nhân cá hồi sốt teriyaki và rau mầm.',
      price: 6.5,
      tags: ['seafood', 'sandwich', 'japanese'],
      status: 'available' as const,
    },
    {
      id: IDS.r5TraXanh,
      restaurantId: IDS.restaurant5,
      categoryId: IDS.catR5Drinks,
      name: 'Trà Xanh Nhật Bản',
      description: 'Matcha latte nóng / lạnh — matcha Uji Kyoto grade A.',
      price: 5.0,
      tags: ['hot', 'cold', 'tea', 'japanese'],
      status: 'available' as const,
    },
  ];
  await db.insert(menuItems).values(rows);
  console.log('✅ menu_items seeded (19 rows)');
}

async function seedAppSettings() {
  const rows = [
    {
      key: 'ORDER_IDEMPOTENCY_TTL_SECONDS',
      value: '300',
      description:
        'Idempotency key Redis TTL (5 min). Phase 4 PlaceOrderHandler.',
    },
    {
      key: 'RESTAURANT_ACCEPT_TIMEOUT_SECONDS',
      value: '600',
      description: 'Auto-cancel unconfirmed orders after 10 min. Phase 5 cron.',
    },
    {
      key: 'CART_ABANDONED_TTL_SECONDS',
      value: '86400',
      description: 'Cart Redis TTL (24h). CartService Phase 2.',
    },
  ];
  await db.insert(appSettings).values(rows);
  console.log('✅ app_settings seeded');
}

async function seedOrderingRestaurantSnapshots() {
  const rows = [
    {
      restaurantId: IDS.restaurant1,
      name: 'Phở Bắc',
      isOpen: true,
      isApproved: true,
      address: '45 Nguyễn Huệ, Quận 1, TP.HCM',
      cuisineType: 'Vietnamese',
      latitude: 10.762622,
      longitude: 106.660172,
    },
    {
      restaurantId: IDS.restaurant2,
      name: 'Bếp Đóng Cửa',
      isOpen: false,
      isApproved: true,
      address: '12 Hai Bà Trưng, Quận 3, TP.HCM',
      cuisineType: 'Vietnamese',
      latitude: 10.775,
      longitude: 106.701,
    },
    {
      restaurantId: IDS.restaurant3,
      name: 'Cơm Tấm Sài Gòn',
      isOpen: true,
      isApproved: true,
      address: '78 Lê Lợi, Quận 1, TP.HCM',
      cuisineType: 'Vietnamese',
      latitude: 10.768,
      longitude: 106.682,
    },
    {
      restaurantId: IDS.restaurant4,
      name: 'Seoul BBQ & More',
      isOpen: true,
      isApproved: true,
      address: '30 Nguyễn Văn Linh, Quận 7, TP.HCM',
      cuisineType: 'Korean',
      latitude: 10.736,
      longitude: 106.703,
    },
    {
      restaurantId: IDS.restaurant5,
      name: 'Sushi Hana',
      isOpen: true,
      isApproved: true,
      address: '5 Phan Đăng Lưu, Bình Thạnh, TP.HCM',
      cuisineType: 'Japanese',
      latitude: 10.802,
      longitude: 106.706,
    },
  ];
  await db.insert(orderingRestaurantSnapshots).values(rows);
  console.log('✅ ordering_restaurant_snapshots seeded (5 rows)');
}

async function seedOrderingMenuItemSnapshots() {
  // modifiers = [] — no modifiers configured in seed data; can be extended per item later
  const rows = [
    // R1
    {
      menuItemId: IDS.r1Pho1,
      restaurantId: IDS.restaurant1,
      name: 'Phở Bò Tái Nạm',
      price: 8.5,
      status: 'available' as const,
      modifiers: [],
    },
    {
      menuItemId: IDS.r1Pho2,
      restaurantId: IDS.restaurant1,
      name: 'Phở Gà',
      price: 7.5,
      status: 'available' as const,
      modifiers: [],
    },
    {
      menuItemId: IDS.r1BunBo,
      restaurantId: IDS.restaurant1,
      name: 'Bún Bò Huế',
      price: 8.0,
      status: 'available' as const,
      modifiers: [],
    },
    {
      menuItemId: IDS.r1BanhCuon,
      restaurantId: IDS.restaurant1,
      name: 'Bánh Cuốn',
      price: 5.5,
      status: 'available' as const,
      modifiers: [],
    },
    {
      menuItemId: IDS.r1TraDa,
      restaurantId: IDS.restaurant1,
      name: 'Trà Đá',
      price: 0.5,
      status: 'available' as const,
      modifiers: [],
    },
    // R2
    {
      menuItemId: IDS.r2Burger,
      restaurantId: IDS.restaurant2,
      name: 'Classic Burger',
      price: 11.0,
      status: 'available' as const,
      modifiers: [],
    },
    // R3
    {
      menuItemId: IDS.r3ComTam1,
      restaurantId: IDS.restaurant3,
      name: 'Cơm Tấm Sườn Nướng',
      price: 9.0,
      status: 'available' as const,
      modifiers: [],
    },
    {
      menuItemId: IDS.r3ComTam2,
      restaurantId: IDS.restaurant3,
      name: 'Cơm Tấm Bì Chả',
      price: 8.5,
      status: 'available' as const,
      modifiers: [],
    },
    {
      menuItemId: IDS.r3BanhMi,
      restaurantId: IDS.restaurant3,
      name: 'Bánh Mì Thịt Nướng',
      price: 3.5,
      status: 'available' as const,
      modifiers: [],
    },
    {
      menuItemId: IDS.r3ComChay,
      restaurantId: IDS.restaurant3,
      name: 'Cơm Chay',
      price: 7.0,
      status: 'available' as const,
      modifiers: [],
    },
    {
      menuItemId: IDS.r3NuocNgot,
      restaurantId: IDS.restaurant3,
      name: 'Nước Ngọt',
      price: 1.5,
      status: 'available' as const,
      modifiers: [],
    },
    // R4
    {
      menuItemId: IDS.r4Bbq,
      restaurantId: IDS.restaurant4,
      name: 'Thịt Nướng Hàn Quốc',
      price: 18.0,
      status: 'available' as const,
      modifiers: [],
    },
    {
      menuItemId: IDS.r4Kimchi,
      restaurantId: IDS.restaurant4,
      name: 'Kimchi Jjigae',
      price: 12.0,
      status: 'available' as const,
      modifiers: [],
    },
    {
      menuItemId: IDS.r4Bibimbap,
      restaurantId: IDS.restaurant4,
      name: 'Bibimbap',
      price: 13.5,
      status: 'available' as const,
      modifiers: [],
    },
    {
      menuItemId: IDS.r4TraSua,
      restaurantId: IDS.restaurant4,
      name: 'Trà Sữa Trân Châu',
      price: 4.5,
      status: 'available' as const,
      modifiers: [],
    },
    // R5
    {
      menuItemId: IDS.r5Sushi,
      restaurantId: IDS.restaurant5,
      name: 'Sushi Cá Hồi',
      price: 15.0,
      status: 'available' as const,
      modifiers: [],
    },
    {
      menuItemId: IDS.r5Sashimi,
      restaurantId: IDS.restaurant5,
      name: 'Sashimi Cá Ngừ',
      price: 18.0,
      status: 'available' as const,
      modifiers: [],
    },
    {
      menuItemId: IDS.r5BanhMi,
      restaurantId: IDS.restaurant5,
      name: 'Bánh Mì Cá Hồi',
      price: 6.5,
      status: 'available' as const,
      modifiers: [],
    },
    {
      menuItemId: IDS.r5TraXanh,
      restaurantId: IDS.restaurant5,
      name: 'Trà Xanh Nhật Bản',
      price: 5.0,
      status: 'available' as const,
      modifiers: [],
    },
  ];
  await db.insert(orderingMenuItemSnapshots).values(rows);
  console.log('✅ ordering_menu_item_snapshots seeded (19 rows)');
}

async function seedOrderingDeliveryZoneSnapshots() {
  const rows = [
    // R1
    {
      zoneId: IDS.zone1Inner,
      restaurantId: IDS.restaurant1,
      name: 'Nội thành (2 km)',
      radiusKm: 2,
      baseFee: BASE_FEE_STANDARD,
      perKmRate: PER_KM_STANDARD,
      avgSpeedKmh: AVG_SPEED_CITY,
      prepTimeMinutes: PREP_TIME_NOODLE,
      bufferMinutes: BUFFER_MINUTES,
      isActive: true,
      isDeleted: false,
    },
    {
      zoneId: IDS.zone1City,
      restaurantId: IDS.restaurant1,
      name: 'Toàn thành (5 km)',
      radiusKm: 5,
      baseFee: BASE_FEE_STANDARD,
      perKmRate: PER_KM_WIDE,
      avgSpeedKmh: AVG_SPEED_CITY,
      prepTimeMinutes: PREP_TIME_NOODLE,
      bufferMinutes: BUFFER_MINUTES,
      isActive: true,
      isDeleted: false,
    },
    // R2 (inactive — closed restaurant)
    {
      zoneId: IDS.zone2Only,
      restaurantId: IDS.restaurant2,
      name: 'Khu vực giao hàng (3 km)',
      radiusKm: 3,
      baseFee: BASE_FEE_STANDARD,
      perKmRate: PER_KM_STANDARD,
      avgSpeedKmh: AVG_SPEED_CITY,
      prepTimeMinutes: PREP_TIME_STANDARD,
      bufferMinutes: BUFFER_MINUTES,
      isActive: false,
      isDeleted: false,
    },
    // R3
    {
      zoneId: IDS.zone3Inner,
      restaurantId: IDS.restaurant3,
      name: 'Nội thành (2 km)',
      radiusKm: 2,
      baseFee: BASE_FEE_STANDARD,
      perKmRate: PER_KM_STANDARD,
      avgSpeedKmh: AVG_SPEED_CITY,
      prepTimeMinutes: PREP_TIME_STANDARD,
      bufferMinutes: BUFFER_MINUTES,
      isActive: true,
      isDeleted: false,
    },
    {
      zoneId: IDS.zone3City,
      restaurantId: IDS.restaurant3,
      name: 'Mở rộng (5 km)',
      radiusKm: 5,
      baseFee: BASE_FEE_STANDARD,
      perKmRate: PER_KM_WIDE,
      avgSpeedKmh: AVG_SPEED_CITY,
      prepTimeMinutes: PREP_TIME_STANDARD,
      bufferMinutes: BUFFER_MINUTES,
      isActive: true,
      isDeleted: false,
    },
    // R4
    {
      zoneId: IDS.zone4Inner,
      restaurantId: IDS.restaurant4,
      name: 'Quận 7 nội bộ (2 km)',
      radiusKm: 2,
      baseFee: BASE_FEE_STANDARD,
      perKmRate: PER_KM_STANDARD,
      avgSpeedKmh: AVG_SPEED_HIGHWAY,
      prepTimeMinutes: PREP_TIME_BBQ,
      bufferMinutes: BUFFER_MINUTES,
      isActive: true,
      isDeleted: false,
    },
    {
      zoneId: IDS.zone4Wide,
      restaurantId: IDS.restaurant4,
      name: 'Liên quận (8 km)',
      radiusKm: 8,
      baseFee: BASE_FEE_WIDE,
      perKmRate: PER_KM_WIDE,
      avgSpeedKmh: AVG_SPEED_HIGHWAY,
      prepTimeMinutes: PREP_TIME_BBQ,
      bufferMinutes: BUFFER_MINUTES,
      isActive: true,
      isDeleted: false,
    },
    // R5 — no zones (edge case)
  ];
  await db.insert(orderingDeliveryZoneSnapshots).values(rows);
  console.log(
    '✅ ordering_delivery_zone_snapshots seeded (7 rows, R5 has none)',
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Starting seed...\n');

  console.log('🗑️  Clearing old data...\n');
  await deleteOrderingDeliveryZoneSnapshots();
  await deleteOrderingMenuItemSnapshots();
  await deleteOrderingRestaurantSnapshots();
  await deleteMenuItems();
  await deleteMenuCategories();
  await deleteDeliveryZones();
  await deleteRestaurants();
  await deleteAppSettings();
  await deleteUsers();

  console.log('\n📝 Inserting new data...\n');
  await seedUsers(); // 3 rows
  await seedRestaurants(); // 5 rows (R1–R5)
  await seedDeliveryZones(); // 7 rows (R5 has none)
  await seedMenuCategories(); // 13 rows
  await seedMenuItems(); // 19 rows
  await seedAppSettings(); // 3 rows
  await seedOrderingRestaurantSnapshots(); // 5 rows
  await seedOrderingMenuItemSnapshots(); // 19 rows
  await seedOrderingDeliveryZoneSnapshots(); // 7 rows

  console.log('\n✅ All tables seeded successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
