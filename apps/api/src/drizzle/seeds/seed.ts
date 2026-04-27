/**
 * Master seed script — seeds all tables with fixed UUIDs for development & testing.
 *
 * Run:  pnpm db:seed
 *
 * Idempotent: all inserts use onConflictDoNothing(), safe to re-run.
 *
 * Fixed UUIDs (copy these into test scripts):
 * ─────────────────────────────────────────────────────────────────
 *  USERS
 *    Owner    : 00000000-0000-0000-0000-000000000001
 *    Customer : 00000000-0000-0000-0000-000000000002
 *
 *  RESTAURANTS
 *    Sunset Bistro  (open, approved)  : fe8b2648-2260-4bc5-9acd-d88972148c78
 *    Closed Kitchen (closed)          : 00000000-0000-0000-0000-000000000004
 *
 *  MENU ITEMS  (Sunset Bistro)
 *    Margherita Pizza  (mains)    : 4dc7cdfa-5a54-402f-b1a8-2d47de146081
 *    Caesar Salad      (salads)   : 00000000-0000-0000-0000-000000000006
 *    Tiramisu          (desserts) : 00000000-0000-0000-0000-000000000007
 *
 *  MENU ITEMS  (Closed Kitchen)
 *    Classic Burger    (mains)    : 00000000-0000-0000-0000-000000000008
 *
 *  ORDERING SNAPSHOTS
 *    ordering_restaurant_snapshots : mirrors restaurants above
 *    ordering_menu_item_snapshots  : mirrors menu_items above
 *
 *  APP SETTINGS
 *    ORDER_IDEMPOTENCY_TTL_SECONDS     = 300
 *    RESTAURANT_ACCEPT_TIMEOUT_SECONDS = 600
 *    CART_ABANDONED_TTL_SECONDS        = 86400
 * ─────────────────────────────────────────────────────────────────
 *
 * NOTE — JwtAuthGuard (dev placeholder) hardcodes user.sub = 'user-id' for ANY
 * Bearer token.  Cart Redis key for all tests = cart:user-id.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';

// Auth
import { user } from '../../module/auth/auth.schema';

// Restaurant catalog
import { restaurants } from '../../module/restaurant-catalog/restaurant/restaurant.schema';
import { menuItems } from '../../module/restaurant-catalog/menu/menu.schema';

// Ordering — common
import { appSettings } from '../../module/ordering/common/app-settings.schema';

// Ordering — ACL snapshots
import { orderingRestaurantSnapshots } from '../../module/ordering/acl/schemas/restaurant-snapshot.schema';
import { orderingMenuItemSnapshots } from '../../module/ordering/acl/schemas/menu-item-snapshot.schema';

const db = drizzle(process.env.DATABASE_URL!);

// ─── Fixed IDs ───────────────────────────────────────────────────────────────

const IDS = {
  // Users
  ownerUserId: '00000000-0000-0000-0000-000000000001',
  customerUserId: '00000000-0000-0000-0000-000000000002',

  // Restaurants
  restaurant1: 'fe8b2648-2260-4bc5-9acd-d88972148c78', // open + approved
  restaurant2: '00000000-0000-0000-0000-000000000004', // closed

  // Menu items — Sunset Bistro (restaurant1)
  menuItem1: '4dc7cdfa-5a54-402f-b1a8-2d47de146081', // Margherita Pizza
  menuItem2: '00000000-0000-0000-0000-000000000006', // Caesar Salad
  menuItem3: '00000000-0000-0000-0000-000000000007', // Tiramisu

  // Menu items — Closed Kitchen (restaurant2)
  menuItem4: '00000000-0000-0000-0000-000000000008', // Classic Burger
} as const;

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
  ];
  await db.insert(user).values(rows).onConflictDoNothing();
  console.log('✅ users seeded');
}

async function seedRestaurants() {
  const rows = [
    {
      id: IDS.restaurant1,
      ownerId: IDS.ownerUserId,
      name: 'Sunset Bistro',
      description: 'Cozy local spot serving modern comfort food.',
      address: '123 Main St, District 1, Ho Chi Minh City',
      phone: '+84-28-1234-5678',
      isOpen: true,
      isApproved: true,
      latitude: 10.762622,
      longitude: 106.660172,
    },
    {
      id: IDS.restaurant2,
      ownerId: IDS.ownerUserId,
      name: 'Closed Kitchen',
      description: 'Currently closed for renovations.',
      address: '456 Side St, District 3, Ho Chi Minh City',
      phone: '+84-28-9876-5432',
      isOpen: false,
      isApproved: true,
      latitude: 10.775,
      longitude: 106.701,
    },
  ];
  await db.insert(restaurants).values(rows).onConflictDoNothing();
  console.log('✅ restaurants seeded');
}

async function seedMenuItems() {
  const rows = [
    // Sunset Bistro
    {
      id: IDS.menuItem1,
      restaurantId: IDS.restaurant1,
      name: 'Margherita Pizza',
      description: 'Classic tomato, basil, and mozzarella.',
      price: 12.5,
      category: 'mains' as const,
      status: 'available' as const,
      isAvailable: true,
    },
    {
      id: IDS.menuItem2,
      restaurantId: IDS.restaurant1,
      name: 'Caesar Salad',
      description: 'Crisp romaine, parmesan, house-made Caesar dressing.',
      price: 9.0,
      category: 'salads' as const,
      status: 'available' as const,
      isAvailable: true,
    },
    {
      id: IDS.menuItem3,
      restaurantId: IDS.restaurant1,
      name: 'Tiramisu',
      description: 'Espresso-soaked ladyfingers, mascarpone cream.',
      price: 6.5,
      category: 'desserts' as const,
      status: 'available' as const,
      isAvailable: true,
    },
    // Closed Kitchen
    {
      id: IDS.menuItem4,
      restaurantId: IDS.restaurant2,
      name: 'Classic Burger',
      description: 'Beef patty, lettuce, tomato, cheese.',
      price: 11.0,
      category: 'mains' as const,
      status: 'available' as const,
      isAvailable: true,
    },
  ];
  await db.insert(menuItems).values(rows).onConflictDoNothing();
  console.log('✅ menu_items seeded');
}

async function seedAppSettings() {
  const rows = [
    {
      key: 'ORDER_IDEMPOTENCY_TTL_SECONDS',
      value: '300',
      description: 'Idempotency key Redis TTL (5 min). Phase 4 PlaceOrderHandler.',
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
  await db.insert(appSettings).values(rows).onConflictDoNothing();
  console.log('✅ app_settings seeded');
}

async function seedOrderingRestaurantSnapshots() {
  const rows = [
    {
      restaurantId: IDS.restaurant1,
      name: 'Sunset Bistro',
      isOpen: true,
      isApproved: true,
      address: '123 Main St, District 1, Ho Chi Minh City',
      latitude: 10.762622,
      longitude: 106.660172,
    },
    {
      restaurantId: IDS.restaurant2,
      name: 'Closed Kitchen',
      isOpen: false,
      isApproved: true,
      address: '456 Side St, District 3, Ho Chi Minh City',
      latitude: 10.775,
      longitude: 106.701,
    },
  ];
  await db.insert(orderingRestaurantSnapshots).values(rows).onConflictDoNothing();
  console.log('✅ ordering_restaurant_snapshots seeded');
}

async function seedOrderingMenuItemSnapshots() {
  const rows = [
    {
      menuItemId: IDS.menuItem1,
      restaurantId: IDS.restaurant1,
      name: 'Margherita Pizza',
      price: 12.5,
      status: 'available' as const,
    },
    {
      menuItemId: IDS.menuItem2,
      restaurantId: IDS.restaurant1,
      name: 'Caesar Salad',
      price: 9.0,
      status: 'available' as const,
    },
    {
      menuItemId: IDS.menuItem3,
      restaurantId: IDS.restaurant1,
      name: 'Tiramisu',
      price: 6.5,
      status: 'available' as const,
    },
    {
      menuItemId: IDS.menuItem4,
      restaurantId: IDS.restaurant2,
      name: 'Classic Burger',
      price: 11.0,
      status: 'available' as const,
    },
  ];
  await db.insert(orderingMenuItemSnapshots).values(rows).onConflictDoNothing();
  console.log('✅ ordering_menu_item_snapshots seeded');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Starting seed...\n');

  // Order matters: users → restaurants → menu_items → ordering snapshots
  await seedUsers();
  await seedRestaurants();
  await seedMenuItems();
  await seedAppSettings();
  await seedOrderingRestaurantSnapshots();
  await seedOrderingMenuItemSnapshots();

  console.log('\n✅ All tables seeded successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
