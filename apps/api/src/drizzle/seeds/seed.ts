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
  modifierGroups,
  modifierOptions,
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

  // ── Modifier Groups ────────────────────────────────────────────────────────
  // R1 Phở Bắc
  grpR1Pho1Size: 'ee000001-0000-4000-8000-000000000001', // Phở Bò — Kích cỡ
  grpR1Pho1Topping: 'ee000002-0000-4000-8000-000000000002', // Phở Bò — Topping thêm
  grpR1Pho2Size: 'ee000003-0000-4000-8000-000000000003', // Phở Gà — Kích cỡ
  grpR1BunBoSpicy: 'ee000004-0000-4000-8000-000000000004', // Bún Bò Huế — Độ cay
  grpR1BunBoTopping: 'ee000005-0000-4000-8000-000000000005', // Bún Bò Huế — Topping thêm
  grpR1BanhCuonExtra: 'ee000006-0000-4000-8000-000000000006', // Bánh Cuốn — Phần thêm
  grpR1TraDaSugar: 'ee000007-0000-4000-8000-000000000007', // Trà Đá — Đường
  // R2 Bếp Đóng Cửa
  grpR2BurgerSauce: 'ee000008-0000-4000-8000-000000000008', // Classic Burger — Sốt
  // R3 Cơm Tấm Sài Gòn
  grpR3ComTam1Rice: 'ee000009-0000-4000-8000-000000000009', // Cơm Tấm Sườn Nướng — Cỡ cơm
  grpR3ComTam1Side: 'ee000010-0000-4000-8000-000000000010', // Cơm Tấm Sườn Nướng — Phần thêm
  grpR3ComTam2Side: 'ee000011-0000-4000-8000-000000000011', // Cơm Tấm Bì Chả — Phần thêm
  grpR3BanhMiSauce: 'ee000012-0000-4000-8000-000000000012', // Bánh Mì Thịt Nướng — Sốt
  grpR3BanhMiVeg: 'ee000013-0000-4000-8000-000000000013', // Bánh Mì Thịt Nướng — Rau
  grpR3ComChayProtein: 'ee000014-0000-4000-8000-000000000014', // Cơm Chay — Protein
  grpR3NuocNgotType: 'ee000015-0000-4000-8000-000000000015', // Nước Ngọt — Loại
  // R4 Seoul BBQ
  grpR4BbqMeat: 'ee000016-0000-4000-8000-000000000016', // Thịt Nướng — Loại thịt
  grpR4BbqPortion: 'ee000017-0000-4000-8000-000000000017', // Thịt Nướng — Phần ăn
  grpR4KimchiSpicy: 'ee000018-0000-4000-8000-000000000018', // Kimchi Jjigae — Độ cay
  grpR4BibimbapProtein: 'ee000019-0000-4000-8000-000000000019', // Bibimbap — Loại protein
  grpR4TraSuaSugar: 'ee000020-0000-4000-8000-000000000020', // Trà Sữa — Mức đường
  grpR4TraSuaIce: 'ee000021-0000-4000-8000-000000000021', // Trà Sữa — Lượng đá
  grpR4TraSuaTopping: 'ee000022-0000-4000-8000-000000000022', // Trà Sữa — Topping
  // R5 Sushi Hana
  grpR5SushiPortion: 'ee000023-0000-4000-8000-000000000023', // Sushi Cá Hồi — Số lượng miếng
  grpR5SashimiPortion: 'ee000024-0000-4000-8000-000000000024', // Sashimi Cá Ngừ — Số lượng lát
  grpR5BanhMiTemp: 'ee000025-0000-4000-8000-000000000025', // Bánh Mì Cá Hồi — Nhiệt độ
  grpR5TraXanhTemp: 'ee000026-0000-4000-8000-000000000026', // Trà Xanh — Nhiệt độ
  grpR5TraXanhStrength: 'ee000027-0000-4000-8000-000000000027', // Trà Xanh — Nồng độ matcha

  // ── Modifier Options ───────────────────────────────────────────────────────
  // grpR1Pho1Size
  optR1Pho1SizeS: 'ff000001-0000-4000-8000-000000000001', // Tô nhỏ
  optR1Pho1SizeM: 'ff000002-0000-4000-8000-000000000002', // Tô vừa
  optR1Pho1SizeL: 'ff000003-0000-4000-8000-000000000003', // Tô lớn
  // grpR1Pho1Topping
  optR1Pho1TopTai: 'ff000004-0000-4000-8000-000000000004', // Thêm tái
  optR1Pho1TopNam: 'ff000005-0000-4000-8000-000000000005', // Thêm nạm
  optR1Pho1TopGan: 'ff000006-0000-4000-8000-000000000006', // Thêm gân
  optR1Pho1TopSach: 'ff000007-0000-4000-8000-000000000007', // Thêm sách
  // grpR1Pho2Size
  optR1Pho2SizeS: 'ff000008-0000-4000-8000-000000000008', // Tô nhỏ
  optR1Pho2SizeM: 'ff000009-0000-4000-8000-000000000009', // Tô vừa
  optR1Pho2SizeL: 'ff000010-0000-4000-8000-000000000010', // Tô lớn
  // grpR1BunBoSpicy
  optR1BunBoSpicy0: 'ff000011-0000-4000-8000-000000000011', // Không cay
  optR1BunBoSpicyM: 'ff000012-0000-4000-8000-000000000012', // Cay vừa
  optR1BunBoSpicyH: 'ff000013-0000-4000-8000-000000000013', // Cay nhiều
  // grpR1BunBoTopping
  optR1BunBoTopCua: 'ff000014-0000-4000-8000-000000000014', // Thêm chả cua
  optR1BunBoTopHeo: 'ff000015-0000-4000-8000-000000000015', // Thêm chả heo
  // grpR1BanhCuonExtra
  optR1BanhCuonExtraLua: 'ff000016-0000-4000-8000-000000000016', // Thêm chả lụa
  optR1BanhCuonExtraEgg: 'ff000017-0000-4000-8000-000000000017', // Trứng ốp la
  optR1BanhCuonExtraCua: 'ff000018-0000-4000-8000-000000000018', // Chả cua
  // grpR1TraDaSugar
  optR1TraDaSugar0: 'ff000019-0000-4000-8000-000000000019', // Không đường
  optR1TraDaSugarLow: 'ff000020-0000-4000-8000-000000000020', // Ít đường
  optR1TraDaSugarNorm: 'ff000021-0000-4000-8000-000000000021', // Bình thường
  // grpR2BurgerSauce
  optR2BurgerSauceOrig: 'ff000022-0000-4000-8000-000000000022', // Bình thường
  optR2BurgerSauceBbq: 'ff000023-0000-4000-8000-000000000023', // BBQ
  optR2BurgerSauceMayo: 'ff000024-0000-4000-8000-000000000024', // Mayo
  // grpR3ComTam1Rice
  optR3ComTam1RiceS: 'ff000025-0000-4000-8000-000000000025', // Ít cơm
  optR3ComTam1RiceN: 'ff000026-0000-4000-8000-000000000026', // Bình thường
  optR3ComTam1RiceL: 'ff000027-0000-4000-8000-000000000027', // Nhiều cơm
  // grpR3ComTam1Side
  optR3ComTam1SidePickle: 'ff000028-0000-4000-8000-000000000028', // Đồ chua
  optR3ComTam1SideEgg: 'ff000029-0000-4000-8000-000000000029', // Trứng ốp la
  optR3ComTam1SideBi: 'ff000030-0000-4000-8000-000000000030', // Thêm bì
  // grpR3ComTam2Side
  optR3ComTam2SidePickle: 'ff000031-0000-4000-8000-000000000031', // Đồ chua
  optR3ComTam2SideEgg: 'ff000032-0000-4000-8000-000000000032', // Trứng ốp la
  optR3ComTam2SideBi: 'ff000033-0000-4000-8000-000000000033', // Thêm bì
  // grpR3BanhMiSauce
  optR3BanhMiSauceChili: 'ff000034-0000-4000-8000-000000000034', // Tương ớt
  optR3BanhMiSauceBlack: 'ff000035-0000-4000-8000-000000000035', // Tương đen
  optR3BanhMiSauceNone: 'ff000036-0000-4000-8000-000000000036', // Không sốt
  // grpR3BanhMiVeg
  optR3BanhMiVegCuke: 'ff000037-0000-4000-8000-000000000037', // Dưa leo
  optR3BanhMiVegPickle: 'ff000038-0000-4000-8000-000000000038', // Đồ chua
  optR3BanhMiVegHerb: 'ff000039-0000-4000-8000-000000000039', // Rau mùi
  optR3BanhMiVegNone: 'ff000040-0000-4000-8000-000000000040', // Không rau
  // grpR3ComChayProtein
  optR3ComChayTofu: 'ff000041-0000-4000-8000-000000000041', // Đậu phụ
  optR3ComChayMushroom: 'ff000042-0000-4000-8000-000000000042', // Nấm xào
  // grpR3NuocNgotType
  optR3NuocNgotCola: 'ff000043-0000-4000-8000-000000000043', // Coca-Cola
  optR3NuocNgotSprite: 'ff000044-0000-4000-8000-000000000044', // Sprite
  optR3NuocNgot7up: 'ff000045-0000-4000-8000-000000000045', // 7Up
  // grpR4BbqMeat
  optR4BbqMeatBaChi: 'ff000046-0000-4000-8000-000000000046', // Ba chỉ heo
  optR4BbqMeatCoHeo: 'ff000047-0000-4000-8000-000000000047', // Cổ heo
  optR4BbqMeatBoBaroi: 'ff000048-0000-4000-8000-000000000048', // Bò ba rọi
  // grpR4BbqPortion
  optR4BbqPortion1: 'ff000049-0000-4000-8000-000000000049', // 1 người
  optR4BbqPortion2: 'ff000050-0000-4000-8000-000000000050', // 2 người
  optR4BbqPortion3: 'ff000051-0000-4000-8000-000000000051', // 3 người
  // grpR4KimchiSpicy
  optR4KimchiSpicy0: 'ff000052-0000-4000-8000-000000000052', // Không cay
  optR4KimchiSpicyM: 'ff000053-0000-4000-8000-000000000053', // Cay vừa
  optR4KimchiSpicyH: 'ff000054-0000-4000-8000-000000000054', // Cay nhiều
  // grpR4BibimbapProtein
  optR4BibimbapBeef: 'ff000055-0000-4000-8000-000000000055', // Thịt bò
  optR4BibimbapTofu: 'ff000056-0000-4000-8000-000000000056', // Đậu phụ
  optR4BibimbapEgg: 'ff000057-0000-4000-8000-000000000057', // Trứng sống
  // grpR4TraSuaSugar
  optR4TraSuaSugar0: 'ff000058-0000-4000-8000-000000000058', // 0% đường
  optR4TraSuaSugar30: 'ff000059-0000-4000-8000-000000000059', // 30% đường
  optR4TraSuaSugar50: 'ff000060-0000-4000-8000-000000000060', // 50% đường
  optR4TraSuaSugar100: 'ff000061-0000-4000-8000-000000000061', // 100% đường
  // grpR4TraSuaIce
  optR4TraSuaIce0: 'ff000062-0000-4000-8000-000000000062', // Không đá
  optR4TraSuaIceLow: 'ff000063-0000-4000-8000-000000000063', // Ít đá
  optR4TraSuaIceNorm: 'ff000064-0000-4000-8000-000000000064', // Bình thường
  // grpR4TraSuaTopping
  optR4TraSuaToppingPearl: 'ff000065-0000-4000-8000-000000000065', // Trân châu đen
  optR4TraSuaToppingJelly: 'ff000066-0000-4000-8000-000000000066', // Thạch
  optR4TraSuaToppingCream: 'ff000067-0000-4000-8000-000000000067', // Kem trứng
  // grpR5SushiPortion
  optR5SushiPortion8: 'ff000068-0000-4000-8000-000000000068', // 8 miếng
  optR5SushiPortion12: 'ff000069-0000-4000-8000-000000000069', // 12 miếng
  optR5SushiPortion16: 'ff000070-0000-4000-8000-000000000070', // 16 miếng
  // grpR5SashimiPortion
  optR5SashimiPortion10: 'ff000071-0000-4000-8000-000000000071', // 10 lát
  optR5SashimiPortion15: 'ff000072-0000-4000-8000-000000000072', // 15 lát
  optR5SashimiPortion20: 'ff000073-0000-4000-8000-000000000073', // 20 lát
  // grpR5BanhMiTemp
  optR5BanhMiTempHot: 'ff000074-0000-4000-8000-000000000074', // Nóng
  optR5BanhMiTempCold: 'ff000075-0000-4000-8000-000000000075', // Lạnh
  // grpR5TraXanhTemp
  optR5TraXanhTempHot: 'ff000076-0000-4000-8000-000000000076', // Nóng
  optR5TraXanhTempCold: 'ff000077-0000-4000-8000-000000000077', // Lạnh
  // grpR5TraXanhStrength
  optR5TraXanhStrengthLight: 'ff000078-0000-4000-8000-000000000078', // Nhạt
  optR5TraXanhStrengthNorm: 'ff000079-0000-4000-8000-000000000079', // Bình thường
  optR5TraXanhStrengthStrong: 'ff000080-0000-4000-8000-000000000080', // Đậm
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

async function deleteModifierOptions() {
  await db.delete(modifierOptions);
  console.log('🗑️  modifier_options cleared');
}

async function deleteModifierGroups() {
  await db.delete(modifierGroups);
  console.log('🗑️  modifier_groups cleared');
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

// Modifier price constants — values in the same unit as menu item prices (USD-equivalent)
const PRICE_FREE = 0; // no extra charge
const PRICE_TOPPING_SMALL = 0.5; // small add-on (egg, pickle)
const PRICE_TOPPING_MED = 1.0; // medium add-on (chả lụa, extra protein)
const PRICE_TOPPING_LG = 1.5; // large add-on (chả cua)
const PRICE_TOPPING_PREMIUM = 2.0; // premium add-on (chả cua on bánh cuốn)
const PRICE_SIZE_UP = 0.5; // upsize surcharge (medium → large)
const PRICE_SIZE_UP2 = 1.0; // double upsize (small → large)
const PRICE_BBQ_BEEF = 2.0; // premium beef upgrade for BBQ
const PRICE_BBQ_2PAX = 15.0; // 2-person BBQ set surcharge
const PRICE_BBQ_3PAX = 25.0; // 3-person BBQ set surcharge
const PRICE_SUSHI_12 = 5.0; // 12-piece sushi upgrade
const PRICE_SUSHI_16 = 9.0; // 16-piece sushi upgrade
const PRICE_SASHIMI_15 = 7.0; // 15-slice sashimi upgrade
const PRICE_SASHIMI_20 = 12.0; // 20-slice sashimi upgrade
const PRICE_JELLY = 0.5; // thạch topping
const PRICE_CREAM = 1.0; // kem trứng topping
const PRICE_MUSHROOM = 0.5; // nấm xào upgrade for vegetarian rice

async function seedModifierGroups() {
  const rows = [
    // ── R1 Phở Bắc ────────────────────────────────────────────────────────────
    {
      // Single-select, required — customer must pick a bowl size
      id: IDS.grpR1Pho1Size,
      menuItemId: IDS.r1Pho1,
      name: 'Kích cỡ',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },
    {
      // Multi-select, optional — up to 3 extra toppings on Phở Bò
      id: IDS.grpR1Pho1Topping,
      menuItemId: IDS.r1Pho1,
      name: 'Topping thêm',
      minSelections: 0,
      maxSelections: 3,
      displayOrder: 2,
    },
    {
      // Single-select, required — size for Phở Gà
      id: IDS.grpR1Pho2Size,
      menuItemId: IDS.r1Pho2,
      name: 'Kích cỡ',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },
    {
      // Single-select, required — spice level for Bún Bò Huế
      id: IDS.grpR1BunBoSpicy,
      menuItemId: IDS.r1BunBo,
      name: 'Độ cay',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },
    {
      // Multi-select, optional — extra protein toppings for Bún Bò Huế
      id: IDS.grpR1BunBoTopping,
      menuItemId: IDS.r1BunBo,
      name: 'Topping thêm',
      minSelections: 0,
      maxSelections: 2,
      displayOrder: 2,
    },
    {
      // Multi-select, optional — add-ons for Bánh Cuốn (up to 2)
      id: IDS.grpR1BanhCuonExtra,
      menuItemId: IDS.r1BanhCuon,
      name: 'Phần thêm',
      minSelections: 0,
      maxSelections: 2,
      displayOrder: 1,
    },
    {
      // Single-select, optional — sugar level for iced tea
      id: IDS.grpR1TraDaSugar,
      menuItemId: IDS.r1TraDa,
      name: 'Đường',
      minSelections: 0,
      maxSelections: 1,
      displayOrder: 1,
    },

    // ── R2 Bếp Đóng Cửa ───────────────────────────────────────────────────────
    {
      // Single-select, required — sauce choice for Classic Burger
      id: IDS.grpR2BurgerSauce,
      menuItemId: IDS.r2Burger,
      name: 'Sốt',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },

    // ── R3 Cơm Tấm Sài Gòn ────────────────────────────────────────────────────
    {
      // Single-select, required — rice portion size
      id: IDS.grpR3ComTam1Rice,
      menuItemId: IDS.r3ComTam1,
      name: 'Cỡ cơm',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },
    {
      // Multi-select, optional — side add-ons for Cơm Tấm Sườn Nướng
      id: IDS.grpR3ComTam1Side,
      menuItemId: IDS.r3ComTam1,
      name: 'Phần thêm',
      minSelections: 0,
      maxSelections: 3,
      displayOrder: 2,
    },
    {
      // Multi-select, optional — side add-ons for Cơm Tấm Bì Chả
      id: IDS.grpR3ComTam2Side,
      menuItemId: IDS.r3ComTam2,
      name: 'Phần thêm',
      minSelections: 0,
      maxSelections: 2,
      displayOrder: 1,
    },
    {
      // Single-select, required — sauce for Bánh Mì Thịt Nướng
      id: IDS.grpR3BanhMiSauce,
      menuItemId: IDS.r3BanhMi,
      name: 'Sốt',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },
    {
      // Multi-select, optional — vegetables / garnish for Bánh Mì (up to all 4)
      id: IDS.grpR3BanhMiVeg,
      menuItemId: IDS.r3BanhMi,
      name: 'Rau',
      minSelections: 0,
      maxSelections: 4,
      displayOrder: 2,
    },
    {
      // Single-select, required — protein choice for Cơm Chay
      id: IDS.grpR3ComChayProtein,
      menuItemId: IDS.r3ComChay,
      name: 'Protein',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },
    {
      // Single-select, required — which soft drink to pour
      id: IDS.grpR3NuocNgotType,
      menuItemId: IDS.r3NuocNgot,
      name: 'Loại nước ngọt',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },

    // ── R4 Seoul BBQ & More ────────────────────────────────────────────────────
    {
      // Multi-select, required — choose 1 or 2 meats for the BBQ set
      id: IDS.grpR4BbqMeat,
      menuItemId: IDS.r4Bbq,
      name: 'Loại thịt',
      minSelections: 1,
      maxSelections: 2,
      displayOrder: 1,
    },
    {
      // Single-select, required — table-size portion (1 / 2 / 3 people)
      id: IDS.grpR4BbqPortion,
      menuItemId: IDS.r4Bbq,
      name: 'Phần ăn',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 2,
    },
    {
      // Single-select, required — spice level for Kimchi Jjigae
      id: IDS.grpR4KimchiSpicy,
      menuItemId: IDS.r4Kimchi,
      name: 'Độ cay',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },
    {
      // Single-select, required — protein choice for Bibimbap
      id: IDS.grpR4BibimbapProtein,
      menuItemId: IDS.r4Bibimbap,
      name: 'Loại protein',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },
    {
      // Single-select, required — sugar level for bubble tea
      id: IDS.grpR4TraSuaSugar,
      menuItemId: IDS.r4TraSua,
      name: 'Mức đường',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },
    {
      // Single-select, required — ice level for bubble tea
      id: IDS.grpR4TraSuaIce,
      menuItemId: IDS.r4TraSua,
      name: 'Lượng đá',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 2,
    },
    {
      // Multi-select, optional — toppings for bubble tea (up to 2)
      id: IDS.grpR4TraSuaTopping,
      menuItemId: IDS.r4TraSua,
      name: 'Topping',
      minSelections: 0,
      maxSelections: 2,
      displayOrder: 3,
    },

    // ── R5 Sushi Hana ──────────────────────────────────────────────────────────
    {
      // Single-select, required — number of sushi pieces
      id: IDS.grpR5SushiPortion,
      menuItemId: IDS.r5Sushi,
      name: 'Số lượng miếng',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },
    {
      // Single-select, required — number of sashimi slices
      id: IDS.grpR5SashimiPortion,
      menuItemId: IDS.r5Sashimi,
      name: 'Số lượng lát',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },
    {
      // Single-select, required — hot or cold for salmon bánh mì
      id: IDS.grpR5BanhMiTemp,
      menuItemId: IDS.r5BanhMi,
      name: 'Nhiệt độ',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },
    {
      // Single-select, required — hot or iced matcha latte
      id: IDS.grpR5TraXanhTemp,
      menuItemId: IDS.r5TraXanh,
      name: 'Nhiệt độ',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 1,
    },
    {
      // Single-select, required — matcha concentration
      id: IDS.grpR5TraXanhStrength,
      menuItemId: IDS.r5TraXanh,
      name: 'Nồng độ matcha',
      minSelections: 1,
      maxSelections: 1,
      displayOrder: 2,
    },
  ];
  await db.insert(modifierGroups).values(rows);
  console.log(`✅ modifier_groups seeded (${rows.length} groups)`);
}

async function seedModifierOptions() {
  const rows = [
    // ── grpR1Pho1Size — Kích cỡ (Phở Bò Tái Nạm) ─────────────────────────────
    {
      id: IDS.optR1Pho1SizeS,
      groupId: IDS.grpR1Pho1Size,
      name: 'Tô nhỏ',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR1Pho1SizeM,
      groupId: IDS.grpR1Pho1Size,
      name: 'Tô vừa',
      price: PRICE_SIZE_UP,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR1Pho1SizeL,
      groupId: IDS.grpR1Pho1Size,
      name: 'Tô lớn',
      price: PRICE_SIZE_UP2,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR1Pho1Topping — Topping thêm (Phở Bò Tái Nạm) ─────────────────────
    {
      id: IDS.optR1Pho1TopTai,
      groupId: IDS.grpR1Pho1Topping,
      name: 'Thêm tái',
      price: PRICE_TOPPING_MED,
      isDefault: false,
      displayOrder: 1,
    },
    {
      id: IDS.optR1Pho1TopNam,
      groupId: IDS.grpR1Pho1Topping,
      name: 'Thêm nạm',
      price: PRICE_TOPPING_MED,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR1Pho1TopGan,
      groupId: IDS.grpR1Pho1Topping,
      name: 'Thêm gân',
      price: PRICE_TOPPING_LG,
      isDefault: false,
      displayOrder: 3,
    },
    {
      id: IDS.optR1Pho1TopSach,
      groupId: IDS.grpR1Pho1Topping,
      name: 'Thêm sách',
      price: PRICE_TOPPING_LG,
      isDefault: false,
      displayOrder: 4,
    },

    // ── grpR1Pho2Size — Kích cỡ (Phở Gà) ─────────────────────────────────────
    {
      id: IDS.optR1Pho2SizeS,
      groupId: IDS.grpR1Pho2Size,
      name: 'Tô nhỏ',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR1Pho2SizeM,
      groupId: IDS.grpR1Pho2Size,
      name: 'Tô vừa',
      price: PRICE_SIZE_UP,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR1Pho2SizeL,
      groupId: IDS.grpR1Pho2Size,
      name: 'Tô lớn',
      price: PRICE_SIZE_UP2,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR1BunBoSpicy — Độ cay (Bún Bò Huế) ────────────────────────────────
    {
      id: IDS.optR1BunBoSpicy0,
      groupId: IDS.grpR1BunBoSpicy,
      name: 'Không cay',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 1,
    },
    {
      id: IDS.optR1BunBoSpicyM,
      groupId: IDS.grpR1BunBoSpicy,
      name: 'Cay vừa',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 2,
    },
    {
      id: IDS.optR1BunBoSpicyH,
      groupId: IDS.grpR1BunBoSpicy,
      name: 'Cay nhiều',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR1BunBoTopping — Topping thêm (Bún Bò Huế) ────────────────────────
    {
      id: IDS.optR1BunBoTopCua,
      groupId: IDS.grpR1BunBoTopping,
      name: 'Thêm chả cua',
      price: PRICE_TOPPING_LG,
      isDefault: false,
      displayOrder: 1,
    },
    {
      id: IDS.optR1BunBoTopHeo,
      groupId: IDS.grpR1BunBoTopping,
      name: 'Thêm chả heo',
      price: PRICE_TOPPING_MED,
      isDefault: false,
      displayOrder: 2,
    },

    // ── grpR1BanhCuonExtra — Phần thêm (Bánh Cuốn) ───────────────────────────
    {
      id: IDS.optR1BanhCuonExtraLua,
      groupId: IDS.grpR1BanhCuonExtra,
      name: 'Thêm chả lụa',
      price: PRICE_TOPPING_MED,
      isDefault: false,
      displayOrder: 1,
    },
    {
      id: IDS.optR1BanhCuonExtraEgg,
      groupId: IDS.grpR1BanhCuonExtra,
      name: 'Trứng ốp la',
      price: PRICE_TOPPING_SMALL,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR1BanhCuonExtraCua,
      groupId: IDS.grpR1BanhCuonExtra,
      name: 'Chả cua',
      price: PRICE_TOPPING_PREMIUM,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR1TraDaSugar — Đường (Trà Đá) ─────────────────────────────────────
    {
      id: IDS.optR1TraDaSugar0,
      groupId: IDS.grpR1TraDaSugar,
      name: 'Không đường',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR1TraDaSugarLow,
      groupId: IDS.grpR1TraDaSugar,
      name: 'Ít đường',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR1TraDaSugarNorm,
      groupId: IDS.grpR1TraDaSugar,
      name: 'Bình thường',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR2BurgerSauce — Sốt (Classic Burger) ──────────────────────────────
    {
      id: IDS.optR2BurgerSauceOrig,
      groupId: IDS.grpR2BurgerSauce,
      name: 'Bình thường',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR2BurgerSauceBbq,
      groupId: IDS.grpR2BurgerSauce,
      name: 'BBQ',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR2BurgerSauceMayo,
      groupId: IDS.grpR2BurgerSauce,
      name: 'Mayo',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR3ComTam1Rice — Cỡ cơm (Cơm Tấm Sườn Nướng) ──────────────────────
    {
      id: IDS.optR3ComTam1RiceS,
      groupId: IDS.grpR3ComTam1Rice,
      name: 'Ít cơm',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 1,
    },
    {
      id: IDS.optR3ComTam1RiceN,
      groupId: IDS.grpR3ComTam1Rice,
      name: 'Bình thường',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 2,
    },
    {
      id: IDS.optR3ComTam1RiceL,
      groupId: IDS.grpR3ComTam1Rice,
      name: 'Nhiều cơm',
      price: PRICE_SIZE_UP,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR3ComTam1Side — Phần thêm (Cơm Tấm Sườn Nướng) ───────────────────
    {
      // Đồ chua is pre-checked (comes with the dish by default)
      id: IDS.optR3ComTam1SidePickle,
      groupId: IDS.grpR3ComTam1Side,
      name: 'Đồ chua',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR3ComTam1SideEgg,
      groupId: IDS.grpR3ComTam1Side,
      name: 'Trứng ốp la',
      price: PRICE_TOPPING_SMALL,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR3ComTam1SideBi,
      groupId: IDS.grpR3ComTam1Side,
      name: 'Thêm bì',
      price: PRICE_TOPPING_MED,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR3ComTam2Side — Phần thêm (Cơm Tấm Bì Chả) ───────────────────────
    {
      id: IDS.optR3ComTam2SidePickle,
      groupId: IDS.grpR3ComTam2Side,
      name: 'Đồ chua',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR3ComTam2SideEgg,
      groupId: IDS.grpR3ComTam2Side,
      name: 'Trứng ốp la',
      price: PRICE_TOPPING_SMALL,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR3ComTam2SideBi,
      groupId: IDS.grpR3ComTam2Side,
      name: 'Thêm bì',
      price: PRICE_TOPPING_MED,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR3BanhMiSauce — Sốt (Bánh Mì Thịt Nướng) ─────────────────────────
    {
      id: IDS.optR3BanhMiSauceChili,
      groupId: IDS.grpR3BanhMiSauce,
      name: 'Tương ớt',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR3BanhMiSauceBlack,
      groupId: IDS.grpR3BanhMiSauce,
      name: 'Tương đen',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR3BanhMiSauceNone,
      groupId: IDS.grpR3BanhMiSauce,
      name: 'Không sốt',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR3BanhMiVeg — Rau (Bánh Mì Thịt Nướng) ────────────────────────────
    {
      // Both dưa leo and đồ chua are pre-selected (standard bánh mì filling)
      id: IDS.optR3BanhMiVegCuke,
      groupId: IDS.grpR3BanhMiVeg,
      name: 'Dưa leo',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR3BanhMiVegPickle,
      groupId: IDS.grpR3BanhMiVeg,
      name: 'Đồ chua',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 2,
    },
    {
      id: IDS.optR3BanhMiVegHerb,
      groupId: IDS.grpR3BanhMiVeg,
      name: 'Rau mùi',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 3,
    },
    {
      id: IDS.optR3BanhMiVegNone,
      groupId: IDS.grpR3BanhMiVeg,
      name: 'Không rau',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 4,
    },

    // ── grpR3ComChayProtein — Protein (Cơm Chay) ─────────────────────────────
    {
      id: IDS.optR3ComChayTofu,
      groupId: IDS.grpR3ComChayProtein,
      name: 'Đậu phụ',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR3ComChayMushroom,
      groupId: IDS.grpR3ComChayProtein,
      name: 'Nấm xào',
      price: PRICE_MUSHROOM,
      isDefault: false,
      displayOrder: 2,
    },

    // ── grpR3NuocNgotType — Loại nước ngọt (Nước Ngọt) ───────────────────────
    {
      id: IDS.optR3NuocNgotCola,
      groupId: IDS.grpR3NuocNgotType,
      name: 'Coca-Cola',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR3NuocNgotSprite,
      groupId: IDS.grpR3NuocNgotType,
      name: 'Sprite',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR3NuocNgot7up,
      groupId: IDS.grpR3NuocNgotType,
      name: '7Up',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR4BbqMeat — Loại thịt (Thịt Nướng Hàn Quốc) ──────────────────────
    {
      id: IDS.optR4BbqMeatBaChi,
      groupId: IDS.grpR4BbqMeat,
      name: 'Ba chỉ heo',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR4BbqMeatCoHeo,
      groupId: IDS.grpR4BbqMeat,
      name: 'Cổ heo',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR4BbqMeatBoBaroi,
      groupId: IDS.grpR4BbqMeat,
      name: 'Bò ba rọi',
      price: PRICE_BBQ_BEEF,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR4BbqPortion — Phần ăn (Thịt Nướng Hàn Quốc) ─────────────────────
    {
      id: IDS.optR4BbqPortion1,
      groupId: IDS.grpR4BbqPortion,
      name: '1 người',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR4BbqPortion2,
      groupId: IDS.grpR4BbqPortion,
      name: '2 người',
      price: PRICE_BBQ_2PAX,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR4BbqPortion3,
      groupId: IDS.grpR4BbqPortion,
      name: '3 người',
      price: PRICE_BBQ_3PAX,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR4KimchiSpicy — Độ cay (Kimchi Jjigae) ────────────────────────────
    {
      id: IDS.optR4KimchiSpicy0,
      groupId: IDS.grpR4KimchiSpicy,
      name: 'Không cay',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 1,
    },
    {
      id: IDS.optR4KimchiSpicyM,
      groupId: IDS.grpR4KimchiSpicy,
      name: 'Cay vừa',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 2,
    },
    {
      id: IDS.optR4KimchiSpicyH,
      groupId: IDS.grpR4KimchiSpicy,
      name: 'Cay nhiều',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR4BibimbapProtein — Loại protein (Bibimbap) ────────────────────────
    {
      id: IDS.optR4BibimbapBeef,
      groupId: IDS.grpR4BibimbapProtein,
      name: 'Thịt bò',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR4BibimbapTofu,
      groupId: IDS.grpR4BibimbapProtein,
      name: 'Đậu phụ',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR4BibimbapEgg,
      groupId: IDS.grpR4BibimbapProtein,
      name: 'Trứng sống',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR4TraSuaSugar — Mức đường (Trà Sữa Trân Châu) ─────────────────────
    {
      id: IDS.optR4TraSuaSugar0,
      groupId: IDS.grpR4TraSuaSugar,
      name: '0% đường',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 1,
    },
    {
      id: IDS.optR4TraSuaSugar30,
      groupId: IDS.grpR4TraSuaSugar,
      name: '30% đường',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR4TraSuaSugar50,
      groupId: IDS.grpR4TraSuaSugar,
      name: '50% đường',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 3,
    },
    {
      id: IDS.optR4TraSuaSugar100,
      groupId: IDS.grpR4TraSuaSugar,
      name: '100% đường',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 4,
    },

    // ── grpR4TraSuaIce — Lượng đá (Trà Sữa Trân Châu) ────────────────────────
    {
      id: IDS.optR4TraSuaIce0,
      groupId: IDS.grpR4TraSuaIce,
      name: 'Không đá',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 1,
    },
    {
      id: IDS.optR4TraSuaIceLow,
      groupId: IDS.grpR4TraSuaIce,
      name: 'Ít đá',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR4TraSuaIceNorm,
      groupId: IDS.grpR4TraSuaIce,
      name: 'Bình thường',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 3,
    },

    // ── grpR4TraSuaTopping — Topping (Trà Sữa Trân Châu) ─────────────────────
    {
      // Trân châu đen is pre-selected (it's in the item name)
      id: IDS.optR4TraSuaToppingPearl,
      groupId: IDS.grpR4TraSuaTopping,
      name: 'Trân châu đen',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR4TraSuaToppingJelly,
      groupId: IDS.grpR4TraSuaTopping,
      name: 'Thạch',
      price: PRICE_JELLY,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR4TraSuaToppingCream,
      groupId: IDS.grpR4TraSuaTopping,
      name: 'Kem trứng',
      price: PRICE_CREAM,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR5SushiPortion — Số lượng miếng (Sushi Cá Hồi) ────────────────────
    {
      id: IDS.optR5SushiPortion8,
      groupId: IDS.grpR5SushiPortion,
      name: '8 miếng',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR5SushiPortion12,
      groupId: IDS.grpR5SushiPortion,
      name: '12 miếng',
      price: PRICE_SUSHI_12,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR5SushiPortion16,
      groupId: IDS.grpR5SushiPortion,
      name: '16 miếng',
      price: PRICE_SUSHI_16,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR5SashimiPortion — Số lượng lát (Sashimi Cá Ngừ) ──────────────────
    {
      id: IDS.optR5SashimiPortion10,
      groupId: IDS.grpR5SashimiPortion,
      name: '10 lát',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR5SashimiPortion15,
      groupId: IDS.grpR5SashimiPortion,
      name: '15 lát',
      price: PRICE_SASHIMI_15,
      isDefault: false,
      displayOrder: 2,
    },
    {
      id: IDS.optR5SashimiPortion20,
      groupId: IDS.grpR5SashimiPortion,
      name: '20 lát',
      price: PRICE_SASHIMI_20,
      isDefault: false,
      displayOrder: 3,
    },

    // ── grpR5BanhMiTemp — Nhiệt độ (Bánh Mì Cá Hồi) ─────────────────────────
    {
      id: IDS.optR5BanhMiTempHot,
      groupId: IDS.grpR5BanhMiTemp,
      name: 'Nóng',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 1,
    },
    {
      id: IDS.optR5BanhMiTempCold,
      groupId: IDS.grpR5BanhMiTemp,
      name: 'Lạnh',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 2,
    },

    // ── grpR5TraXanhTemp — Nhiệt độ (Trà Xanh Nhật Bản) ─────────────────────
    {
      id: IDS.optR5TraXanhTempHot,
      groupId: IDS.grpR5TraXanhTemp,
      name: 'Nóng',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 1,
    },
    {
      id: IDS.optR5TraXanhTempCold,
      groupId: IDS.grpR5TraXanhTemp,
      name: 'Lạnh',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 2,
    },

    // ── grpR5TraXanhStrength — Nồng độ matcha (Trà Xanh Nhật Bản) ───────────
    {
      id: IDS.optR5TraXanhStrengthLight,
      groupId: IDS.grpR5TraXanhStrength,
      name: 'Nhạt',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 1,
    },
    {
      id: IDS.optR5TraXanhStrengthNorm,
      groupId: IDS.grpR5TraXanhStrength,
      name: 'Bình thường',
      price: PRICE_FREE,
      isDefault: true,
      displayOrder: 2,
    },
    {
      id: IDS.optR5TraXanhStrengthStrong,
      groupId: IDS.grpR5TraXanhStrength,
      name: 'Đậm',
      price: PRICE_FREE,
      isDefault: false,
      displayOrder: 3,
    },
  ];
  await db.insert(modifierOptions).values(rows);
  console.log(`✅ modifier_options seeded (${rows.length} options)`);
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
  await deleteModifierOptions();
  await deleteModifierGroups();
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
  await seedModifierGroups(); // 27 groups
  await seedModifierOptions(); // 80 options
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
