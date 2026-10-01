import { db, withTransaction } from './db.js';
import { config } from './config.js';
import { hashPassword } from './auth.js';
import { logger } from './logging.js';
import { userExists } from './users.js';

/**
 * Idempotent demo/staging seed.
 *
 * Accounts are created through the SAME password hashing path as registration
 * (scrypt + per-user salt) and stored in the database - nothing here is
 * hard-coded in the frontend. Running this repeatedly never duplicates data and
 * never resets customer-created records (orders, carts, custom stores).
 *
 * Demo accounts only exist when demo mode is enabled (see server/config.ts).
 */
export interface SeedSummary {
  created: string[];
  updated: string[];
  skipped: string[];
}

const DEMO_PASSWORD = 'NearBuy@2026';

const DEMO_ACCOUNTS = {
  customer: {
    id: 'usr_customer_demo_01',
    email: 'customer.demo@nearbuy.app',
    name: 'Aarav Sharma',
    phone: '+91 98765 43210',
    role: 'customer' as const,
  },
  seller: {
    id: 'usr_seller_demo_01',
    email: 'seller.demo@nearbuy.app',
    name: 'Rahul Verma',
    phone: '+91 98112 34567',
    role: 'seller' as const,
  },
  rider: {
    id: 'usr_rider_demo_01',
    email: 'rider.demo@nearbuy.app',
    name: 'Arjun Kumar',
    phone: '+91 98111 22334',
    role: 'rider' as const,
  },
};

interface SeedStore {
  key: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  name: string;
  description: string;
  category: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number;
  longitude: number;
  opensAt: string;
  closesAt: string;
  operatingDays: string;
  status: 'open' | 'closed';
  image: string;
}

interface SeedProduct {
  key: string;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  image: string;
}

// Served from /public/images so the same URL works in dev and in the build.
const IMAGES = {
  store: '/images/store-dwarka-fresh-mart.jpg',
  milk: '/images/amul-taaza-milk-1l.jpg',
  atta: '/images/aashirvaad-atta-5kg.jpg',
  salt: '/images/tata-salt-1kg.jpg',
  oil: '/images/fortune-sunflower-oil-1l.jpg',
  bread: '/images/britannia-bread-400g.jpg',
};

const STORES: SeedStore[] = [
  {
    key: 'store_dwarka_mart_01',
    ownerId: DEMO_ACCOUNTS.seller.id,
    ownerName: DEMO_ACCOUNTS.seller.name,
    ownerEmail: DEMO_ACCOUNTS.seller.email,
    ownerPhone: DEMO_ACCOUNTS.seller.phone,
    name: 'Dwarka Fresh Mart',
    description:
      'Trusted neighbourhood supermarket in Sector 12 for fresh dairy, staples and daily packaged groceries.',
    category: 'Grocery',
    address: 'Shop 14-16, Vardhman City Mall, Sector 12',
    city: 'Dwarka, New Delhi',
    state: 'Delhi',
    pincode: '110078',
    latitude: 28.5921,
    longitude: 77.046,
    opensAt: '07:00',
    closesAt: '22:00',
    operatingDays: 'Mon-Sun',
    status: 'open',
    image: IMAGES.store,
  },
  {
    key: 'store_daily_needs_02',
    ownerId: 'usr_seller_demo_02',
    ownerName: 'Priya Gupta',
    ownerEmail: 'priya.demo@nearbuy.app',
    ownerPhone: '+91 98990 11223',
    name: 'Daily Needs Corner',
    description: 'Quick snacks, beverages and household essentials at the Sector 7 shopping complex.',
    category: 'Snacks',
    address: 'Plot 4, Local Shopping Complex, Sector 7',
    city: 'Dwarka, New Delhi',
    state: 'Delhi',
    pincode: '110075',
    latitude: 28.586,
    longitude: 77.054,
    opensAt: '08:00',
    closesAt: '23:00',
    operatingDays: 'Mon-Sun',
    status: 'open',
    image: IMAGES.store,
  },
  {
    key: 'store_sharma_general_03',
    ownerId: 'usr_seller_demo_03',
    ownerName: 'Vinod Sharma',
    ownerEmail: 'vinod.demo@nearbuy.app',
    ownerPhone: '+91 98180 44556',
    name: 'Sharma General Store',
    description: 'Family-run kirana since 1994 - pulses, spices, pooja items and household goods.',
    category: 'Grocery',
    address: 'B-22, Ramphal Chowk, Sector 7',
    city: 'Dwarka, New Delhi',
    state: 'Delhi',
    pincode: '110075',
    latitude: 28.5812,
    longitude: 77.0645,
    opensAt: '07:30',
    closesAt: '21:30',
    operatingDays: 'Mon-Sat',
    status: 'open',
    image: IMAGES.store,
  },
  {
    key: 'store_city_pharmacy_04',
    ownerId: 'usr_seller_demo_04',
    ownerName: 'Dr. Meera Nair',
    ownerEmail: 'meera.demo@nearbuy.app',
    ownerPhone: '+91 98100 77889',
    name: 'City Pharmacy',
    description: 'Licensed chemist for medicines, wellness and baby care with pharmacist on call.',
    category: 'Pharmacy',
    address: 'Ground Floor, Sector 10 Market',
    city: 'Dwarka, New Delhi',
    state: 'Delhi',
    pincode: '110075',
    latitude: 28.5827,
    longitude: 77.0493,
    opensAt: '08:00',
    closesAt: '22:00',
    operatingDays: 'Mon-Sun',
    status: 'open',
    image: IMAGES.store,
  },
  {
    key: 'store_raj_fruits_05',
    ownerId: 'usr_seller_demo_05',
    ownerName: 'Rajesh Yadav',
    ownerEmail: 'rajesh.demo@nearbuy.app',
    ownerPhone: '+91 98999 33445',
    name: 'Raj Fruits & Vegetables',
    description: 'Farm-fresh seasonal fruits and vegetables sourced from Azadpur mandi every morning.',
    category: 'Fruits & Vegetables',
    address: 'Shop 7, Sector 12 Market',
    city: 'Dwarka, New Delhi',
    state: 'Delhi',
    pincode: '110078',
    latitude: 28.5915,
    longitude: 77.0427,
    opensAt: '06:00',
    closesAt: '20:00',
    operatingDays: 'Tue-Sun',
    status: 'open',
    image: IMAGES.store,
  },
];

const PRODUCTS: Record<string, SeedProduct[]> = {
  store_dwarka_mart_01: [
    {
      key: 'prod_amul_taaza',
      name: 'Amul Taaza Milk 1L',
      description: 'Homogenised toned milk, rich in calcium and vitamins. Fresh daily batch.',
      category: 'Dairy',
      price: 68,
      stock: 20,
      image: IMAGES.milk,
    },
    {
      key: 'prod_aashirvaad_atta',
      name: 'Aashirvaad Atta 5kg',
      description: '100% whole wheat chakki atta with 0% maida for soft rotis.',
      category: 'Staples & Grains',
      price: 285,
      stock: 15,
      image: IMAGES.atta,
    },
    {
      key: 'prod_tata_salt',
      name: 'Tata Salt 1kg',
      description: 'Vacuum evaporated iodised salt - Desh ka namak.',
      category: 'Staples & Grains',
      price: 28,
      stock: 30,
      image: IMAGES.salt,
    },
    {
      key: 'prod_fortune_oil',
      name: 'Fortune Sunflower Oil 1L',
      description: 'Refined sunflower cooking oil, light and healthy with vitamin E.',
      category: 'Oils & Ghee',
      price: 145,
      stock: 12,
      image: IMAGES.oil,
    },
    {
      key: 'prod_britannia_bread',
      name: 'Britannia Bread 400g',
      description: 'Fresh sliced sandwich bread baked daily.',
      category: 'Bakery',
      price: 45,
      stock: 18,
      image: IMAGES.bread,
    },
  ],
  store_daily_needs_02: [
    {
      key: 'prod_maggi_noodles',
      name: 'Maggi 2-Minute Noodles 280g',
      description: 'Masala instant noodles with signature tastemaker.',
      category: 'Snacks',
      price: 48,
      stock: 25,
      image: IMAGES.store,
    },
    {
      key: 'prod_tata_tea',
      name: 'Tata Tea Premium 500g',
      description: 'Rich aroma blend of Assam and Darjeeling leaves.',
      category: 'Beverages',
      price: 230,
      stock: 14,
      image: IMAGES.store,
    },
    {
      key: 'prod_colgate_toothpaste',
      name: 'Colgate Strong Teeth 200g',
      description: 'Calcium boost toothpaste for stronger teeth.',
      category: 'Personal Care',
      price: 92,
      stock: 9,
      image: IMAGES.store,
    },
  ],
  store_sharma_general_03: [
    {
      key: 'prod_toor_dal',
      name: 'Toor Dal 1kg',
      description: 'Unpolished arhar dal, cleaned and hand-sorted.',
      category: 'Staples & Grains',
      price: 165,
      stock: 22,
      image: IMAGES.atta,
    },
    {
      key: 'prod_haldi_powder',
      name: 'Haldi Powder 200g',
      description: 'Pure turmeric powder with high curcumin content.',
      category: 'Staples & Grains',
      price: 58,
      stock: 40,
      image: IMAGES.salt,
    },
    {
      key: 'prod_surf_excel',
      name: 'Surf Excel Easy Wash 1kg',
      description: 'Detergent powder for everyday bucket wash.',
      category: 'Household',
      price: 118,
      stock: 16,
      image: IMAGES.store,
    },
    {
      key: 'prod_classmate_notebook',
      name: 'Classmate Notebook 172 Pages',
      description: 'Single line ruled notebook for school and college.',
      category: 'Stationery',
      price: 55,
      stock: 35,
      image: IMAGES.store,
    },
  ],
  store_city_pharmacy_04: [
    {
      key: 'prod_dettol_sanitizer',
      name: 'Dettol Hand Sanitizer 200ml',
      description: 'Alcohol-based sanitizer that kills 99.9% germs.',
      category: 'Personal Care',
      price: 110,
      stock: 24,
      image: IMAGES.store,
    },
    {
      key: 'prod_ors_pack',
      name: 'Electral ORS Sachet 21g',
      description: 'WHO-formula oral rehydration salts for dehydration.',
      category: 'Pharmacy',
      price: 32,
      stock: 50,
      image: IMAGES.store,
    },
  ],
  store_raj_fruits_05: [
    {
      key: 'prod_banana_dozen',
      name: 'Banana Robusta (Dozen)',
      description: 'Naturally ripened bananas, sold per dozen.',
      category: 'Fruits & Vegetables',
      price: 60,
      stock: 26,
      image: IMAGES.store,
    },
    {
      key: 'prod_tomato_1kg',
      name: 'Tomato Local 1kg',
      description: 'Firm, farm-fresh tomatoes picked this morning.',
      category: 'Fruits & Vegetables',
      price: 42,
      stock: 30,
      image: IMAGES.store,
    },
    {
      key: 'prod_palak_bunch',
      name: 'Palak (Spinach) 500g',
      description: 'Tender green spinach leaves, washed and bunched.',
      category: 'Fruits & Vegetables',
      price: 25,
      stock: 20,
      image: IMAGES.store,
    },
  ],
};

function ensureUser(input: {
  id: string;
  role: 'customer' | 'seller' | 'rider';
  name: string;
  email: string;
  phone: string;
  extra?: { vehicleType?: string; vehicleNumber?: string; licenseNumber?: string; onboardingCompleted?: number };
}): { id: string; created: boolean } {
  const now = new Date().toISOString();
  const existing = userExists(input.email);
  const { hash, salt } = hashPassword(DEMO_PASSWORD);

  if (existing) {
    // A server restart must not reset passwords, profiles, hours or visibility.
    return { id: existing.id, created: false };
  }

  db.prepare(
    `INSERT INTO users (id, role, name, email, phone, password_hash, password_salt, status,
       vehicle_type, vehicle_number, license_number, onboarding_completed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.role,
    input.name,
    input.email,
    input.phone,
    hash,
    salt,
    input.extra?.vehicleType ?? null,
    input.extra?.vehicleNumber ?? null,
    input.extra?.licenseNumber ?? null,
    input.extra?.onboardingCompleted ?? 0,
    now,
    now
  );

  return { id: input.id, created: true };
}

function ensureStore(store: SeedStore): { id: string; created: boolean } {
  const now = new Date().toISOString();
  const existing = db
    .prepare(`SELECT id, seller_id FROM stores WHERE id = ? OR seller_id = ?`)
    .get(store.key, store.ownerId) as any;

  const openingHours = `${store.opensAt} - ${store.closesAt} (${store.operatingDays})`;

  if (existing) {
    // A server restart must not reset passwords, profiles, hours or visibility.
    return { id: existing.id, created: false };
  }

  db.prepare(
    `INSERT INTO stores (id, seller_id, name, description, category, address, city, state, pincode,
       latitude, longitude, opening_hours, opens_at, closes_at, operating_days, contact_phone,
       status, image, supports_delivery, supports_pickup, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`
  ).run(
    store.key,
    store.ownerId,
    store.name,
    store.description,
    store.category,
    store.address,
    store.city,
    store.state,
    store.pincode,
    store.latitude,
    store.longitude,
    openingHours,
    store.opensAt,
    store.closesAt,
    store.operatingDays,
    store.ownerPhone,
    store.status,
    store.image,
    now,
    now,
    now
  );

  return { id: store.key, created: true };
}

function ensureProduct(storeId: string, product: SeedProduct): { id: string; created: boolean } {
  const now = new Date().toISOString();
  const existing = db
    .prepare(`SELECT id FROM products WHERE id = ? OR (store_id = ? AND name = ?)`)
    .get(product.key, storeId, product.name) as any;

  if (existing) {
    // Preserve seller edits, stock, publication and prices across restarts.
    const inventory = db.prepare('SELECT id FROM inventory WHERE product_id=?').get(existing.id);
    if (!inventory) {
      db.prepare(`INSERT INTO inventory (id,product_id,stock_quantity,reserved_quantity,low_stock_threshold,updated_at)
        SELECT ?,id,MAX(0,stock),0,5,? FROM products WHERE id=?`).run(`inv_${existing.id}`, now, existing.id);
    }
    return { id: existing.id, created: false };
  }

  db.prepare(
    `INSERT INTO products (id, store_id, name, description, category, image, price, stock, is_published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    product.key,
    storeId,
    product.name,
    product.description,
    product.category,
    product.image,
    product.price,
    product.stock,
    now,
    now
  );

  db.prepare(
    `INSERT INTO inventory (id, product_id, stock_quantity, reserved_quantity, low_stock_threshold, updated_at)
     VALUES (?, ?, ?, 0, 5, ?)`
  ).run(`inv_${product.key}`, product.key, product.stock, now);

  return { id: product.key, created: true };
}

export function seedDemoData(): SeedSummary {
  const summary: SeedSummary = { created: [], updated: [], skipped: [] };

  if (!config.demoMode) {
    summary.skipped.push('demo accounts (demo mode disabled)');
    logger.info('seed.skipped', { reason: 'demo mode disabled' });
    return summary;
  }

  const now = new Date().toISOString();

  withTransaction(() => {
    // 1. Demo customer + default address + empty cart
    const customer = ensureUser(DEMO_ACCOUNTS.customer);
    (customer.created ? summary.created : summary.updated).push(`customer:${DEMO_ACCOUNTS.customer.email}`);

    const address = db
      .prepare(`SELECT id FROM customer_addresses WHERE customer_id = ?`)
      .get(customer.id) as any;
    if (!address) {
      db.prepare(
        `INSERT INTO customer_addresses (id, customer_id, label, recipient_name, phone, address_line, city, state, pincode, is_default, created_at)
         VALUES (?, ?, 'Home', 'Aarav Sharma', '+91 98765 43210', 'Flat 402, Shivani Apartments, Sector 10', 'Dwarka, New Delhi', 'Delhi', '110075', 1, ?)`
      ).run('addr_demo_01', customer.id, now);
      summary.created.push('address:Flat 402, Shivani Apartments');
    }

    const cart = db.prepare(`SELECT id FROM carts WHERE customer_id = ?`).get(customer.id);
    if (!cart) {
      db.prepare(`INSERT INTO carts (id, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
        'cart_demo_01',
        customer.id,
        now,
        now
      );
      summary.created.push('cart:empty');
    }

    // 2. Demo rider with completed onboarding (ready to claim jobs)
    const rider = ensureUser({
      ...DEMO_ACCOUNTS.rider,
      extra: {
        vehicleType: 'Bike',
        vehicleNumber: 'DL 3C AB 1234',
        licenseNumber: 'DL-0420110012345',
        onboardingCompleted: 1,
      },
    });
    (rider.created ? summary.created : summary.updated).push(`rider:${DEMO_ACCOUNTS.rider.email}`);

    // 3. Stores and their owners (store owners get the same demo password)
    for (const store of STORES) {
      const owner = ensureUser({
        id: store.ownerId,
        role: 'seller',
        name: store.ownerName,
        email: store.ownerEmail,
        phone: store.ownerPhone,
      });
      (owner.created ? summary.created : summary.updated).push(`seller:${store.ownerEmail}`);

      // ensureUser may have created the seller under a new id if the fixed id
      // was taken by an earlier row; always use the resolved id.
      const resolvedStore = ensureStore({ ...store, ownerId: owner.id });
      const created = resolvedStore.created;
      (created ? summary.created : summary.updated).push(`store:${store.name}`);

      for (const product of PRODUCTS[store.key] ?? []) {
        const result = ensureProduct(resolvedStore.id, product);
        (result.created ? summary.created : summary.updated).push(
          `product:${product.name}`
        );
      }
    }
  });

  logger.info('seed.completed', {
    created: summary.created.length,
    updated: summary.updated.length,
    marked: summary.created.filter((entry) => entry.includes('customer.demo')).length > 0,
  });

  return summary;
}

// Allow standalone execution via `npm run db:seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { prepareDatabase } = await import('./app.js');
  prepareDatabase();
  const result = seedDemoData();
  console.log('\nNearBuy demo data is ready.\n');
  console.log('Demo accounts (password NearBuy@2026):');
  console.log('  Customer  customer.demo@nearbuy.app  (Aarav Sharma)');
  console.log('  Seller    seller.demo@nearbuy.app    (Rahul Verma - Dwarka Fresh Mart)');
  console.log('  Rider     rider.demo@nearbuy.app     (Arjun Kumar)');
  console.log('\nDemo store: Dwarka Fresh Mart, Sector 12, Dwarka, New Delhi');
  console.log(
    `Seed summary: ${result.created.length} created, ${result.updated.length} refreshed, ${result.skipped.length} skipped.\n`
  );
  process.exit(0);
}
