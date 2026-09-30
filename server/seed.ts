import crypto from 'node:crypto';
import { db, initDatabase } from './db.js';
import { hashPassword } from './auth.js';

export function seedDemoData() {
  initDatabase();

  const now = new Date().toISOString();

  // Helper to upsert user
  function ensureUser(id: string, role: 'customer' | 'seller' | 'rider', name: string, email: string, phone: string, rawPassword: string) {
    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as any;
    const { hash, salt } = hashPassword(rawPassword);

    if (existing) {
      db.prepare(`
        UPDATE users 
        SET role = ?, name = ?, phone = ?, password_hash = ?, password_salt = ?, updated_at = ?
        WHERE email = ?
      `).run(role, name, phone, hash, salt, now, email);
      return existing.id;
    } else {
      db.prepare(`
        INSERT INTO users (id, role, name, email, phone, password_hash, password_salt, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(id, role, name, email, phone, hash, salt, now, now);
      return id;
    }
  }

  console.log('[Seed] Seeding NearBuy demo accounts...');

  // 1. Seed Customer: Aarav Sharma
  const customerId = ensureUser(
    'usr_cust_demo_01',
    'customer',
    'Aarav Sharma',
    'customer.demo@nearbuy.app',
    '+91 98765 43210',
    'NearBuy@2026'
  );

  // Seed Customer Address
  const existingAddress = db.prepare(`SELECT id FROM customer_addresses WHERE customer_id = ?`).get(customerId);
  if (!existingAddress) {
    db.prepare(`
      INSERT INTO customer_addresses (id, customer_id, label, recipient_name, phone, address_line, city, state, pincode, is_default, created_at)
      VALUES (?, ?, 'Home', 'Aarav Sharma', '+91 98765 43210', 'Flat 402, Shivani Apartments, Sector 10', 'Dwarka, New Delhi', 'Delhi', '110075', 1, ?)
    `).run('addr_demo_01', customerId, now);
  }

  // Ensure Customer Cart exists and is empty
  const existingCart = db.prepare(`SELECT id FROM carts WHERE customer_id = ?`).get(customerId) as any;
  if (!existingCart) {
    db.prepare(`
      INSERT INTO carts (id, customer_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run('cart_demo_01', customerId, now, now);
  }

  // 2. Seed Seller: Rahul Verma
  const sellerId = ensureUser(
    'usr_sell_demo_01',
    'seller',
    'Rahul Verma',
    'seller.demo@nearbuy.app',
    '+91 98112 34567',
    'NearBuy@2026'
  );

  // Store: Dwarka Fresh Mart
  const storeId = 'store_dwarka_mart_01';
  const existingStore = db.prepare(`SELECT id FROM stores WHERE id = ? OR seller_id = ?`).get(storeId, sellerId) as any;
  if (!existingStore) {
    db.prepare(`
      INSERT INTO stores (
        id, seller_id, name, description, category, address, city, state, pincode,
        latitude, longitude, opening_hours, status, image, published_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
    `).run(
      storeId,
      sellerId,
      'Dwarka Fresh Mart',
      'Your trusted neighbourhood supermarket for fresh dairy, staples, and daily packaged groceries in Sector 12.',
      'Grocery & Daily Essentials',
      'Shop 14-16, Vardhman City Mall, Sector 12',
      'Dwarka, New Delhi',
      'Delhi',
      '110078',
      28.5921,
      77.0460,
      '07:00 AM - 10:00 PM (Daily)',
      '/src/assets/images/dwarka_mart_store_1790786007152.jpg',
      now,
      now,
      now
    );
  } else {
    db.prepare(`
      UPDATE stores
      SET name = 'Dwarka Fresh Mart',
          description = 'Your trusted neighbourhood supermarket for fresh dairy, staples, and daily packaged groceries in Sector 12.',
          category = 'Grocery & Daily Essentials',
          address = 'Shop 14-16, Vardhman City Mall, Sector 12',
          city = 'Dwarka, New Delhi',
          pincode = '110078',
          status = 'open',
          image = '/src/assets/images/dwarka_mart_store_1790786007152.jpg',
          updated_at = ?
      WHERE id = ?
    `).run(now, existingStore.id);
  }

  // Realistic Products for Dwarka Fresh Mart
  const products = [
    {
      id: 'prod_amul_taaza',
      name: 'Amul Taaza Milk 1L',
      description: 'Homogenised toned milk, rich in calcium and essential vitamins. Fresh daily batch.',
      category: 'Dairy',
      image: '/src/assets/images/amul_taaza_milk_1790785945884.jpg',
      price: 68.0,
      stock: 20
    },
    {
      id: 'prod_aashirvaad_atta',
      name: 'Aashirvaad Atta 5kg',
      description: '100% pure whole wheat chakki atta with 0% maida for soft, fluffy rotis.',
      category: 'Staples & Grains',
      image: '/src/assets/images/aashirvaad_atta_1790785957834.jpg',
      price: 285.0,
      stock: 15
    },
    {
      id: 'prod_tata_salt',
      name: 'Tata Salt 1kg',
      description: 'Vacuum evaporated iodised salt. Desh ka Namak ensuring quality and purity.',
      category: 'Staples & Grains',
      image: '/src/assets/images/tata_salt_1790785969498.jpg',
      price: 28.0,
      stock: 30
    },
    {
      id: 'prod_fortune_oil',
      name: 'Fortune Sunflower Oil 1L',
      description: 'Refined sunflower edible cooking oil, light and healthy with natural Vitamin E.',
      category: 'Oils & Ghee',
      image: '/src/assets/images/fortune_oil_1790785982516.jpg',
      price: 145.0,
      stock: 12
    },
    {
      id: 'prod_britannia_bread',
      name: 'Britannia Bread 400g',
      description: 'Fresh sliced white sandwich bread baked daily for quick, wholesome breakfast.',
      category: 'Bakery & Dairy',
      image: '/src/assets/images/britannia_bread_1790785995062.jpg',
      price: 45.0,
      stock: 18
    }
  ];

  for (const p of products) {
    const existingP = db.prepare(`SELECT id FROM products WHERE id = ?`).get(p.id);
    if (!existingP) {
      db.prepare(`
        INSERT INTO products (id, store_id, name, description, category, image, price, stock, is_published, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(p.id, storeId, p.name, p.description, p.category, p.image, p.price, p.stock, now, now);
    } else {
      db.prepare(`
        UPDATE products
        SET name = ?, description = ?, category = ?, image = ?, price = ?, stock = ?, is_published = 1, updated_at = ?
        WHERE id = ?
      `).run(p.name, p.description, p.category, p.image, p.price, p.stock, now, p.id);
    }
  }

  // 3. Seed Rider: Arjun Kumar
  ensureUser(
    'usr_rider_demo_01',
    'rider',
    'Arjun Kumar',
    'rider.demo@nearbuy.app',
    '+91 98111 22334',
    'NearBuy@2026'
  );

  // 4. Seed Secondary Store for Multi-Store Support
  const seller2Id = ensureUser(
    'usr_sell_demo_02',
    'seller',
    'Priya Gupta',
    'priya.demo@nearbuy.app',
    '+91 98990 11223',
    'NearBuy@2026'
  );

  const store2Id = 'store_daily_needs_02';
  const existingStore2 = db.prepare(`SELECT id FROM stores WHERE id = ? OR seller_id = ?`).get(store2Id, seller2Id) as any;
  if (!existingStore2) {
    db.prepare(`
      INSERT INTO stores (
        id, seller_id, name, description, category, address, city, state, pincode,
        latitude, longitude, opening_hours, status, image, published_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
    `).run(
      store2Id,
      seller2Id,
      'Daily Needs Corner',
      'Quick snacks, beverages, and personal hygiene essentials in Sector 7.',
      'Snacks & Personal Care',
      'Plot 4, Local Shopping Complex, Sector 7',
      'Dwarka, New Delhi',
      'Delhi',
      '110075',
      28.5860,
      77.0540,
      '08:00 AM - 11:00 PM',
      '/src/assets/images/dwarka_mart_store_1790786007152.jpg',
      now,
      now,
      now
    );
  }

  const secondaryProducts = [
    {
      id: 'prod_maggi_noodles',
      name: 'Maggi 2-Minute Noodles 280g',
      description: 'Special Masala noodles instant pack with signature tastemaker seasoning.',
      category: 'Snacks & Instant Food',
      price: 48.0,
      stock: 25
    },
    {
      id: 'prod_tata_tea',
      name: 'Tata Tea Premium 500g',
      description: 'Chhoti aur badi patti ka anokha mishran. Rich aroma and authentic taste.',
      category: 'Beverages',
      price: 230.0,
      stock: 14
    }
  ];

  for (const p of secondaryProducts) {
    const existingP = db.prepare(`SELECT id FROM products WHERE id = ?`).get(p.id);
    if (!existingP) {
      db.prepare(`
        INSERT INTO products (id, store_id, name, description, category, image, price, stock, is_published, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(p.id, store2Id, p.name, p.description, p.category, '/src/assets/images/dwarka_mart_store_1790786007152.jpg', p.price, p.stock, now, now);
    }
  }

  console.log('[Seed] NearBuy demo database successfully initialized & seeded!');
}

// Allow standalone execution via `npm run db:seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDemoData();
  process.exit(0);
}
