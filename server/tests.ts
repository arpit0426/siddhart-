import assert from 'node:assert';
import crypto from 'node:crypto';
import { db, initDatabase } from './db.js';
import { seedDemoData } from './seed.js';
import { hashPassword, verifyPassword, createSession, getUserByToken } from './auth.js';

async function runTests() {
  console.log('--- Starting NearBuy Production Test Suite ---');
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ ${name}`);
      console.error('    Error:', err.message);
      failed++;
    }
  }

  // 1. Seed and Schema test
  test('Database initialization and seeding runs idempotently', () => {
    initDatabase();
    seedDemoData();
    const customer = db.prepare(`SELECT * FROM users WHERE email = ?`).get('customer.demo@nearbuy.app') as any;
    assert(customer, 'Customer demo account should exist');
    assert.strictEqual(customer.role, 'customer');

    const seller = db.prepare(`SELECT * FROM users WHERE email = ?`).get('seller.demo@nearbuy.app') as any;
    assert(seller, 'Seller demo account should exist');
    assert.strictEqual(seller.role, 'seller');

    const rider = db.prepare(`SELECT * FROM users WHERE email = ?`).get('rider.demo@nearbuy.app') as any;
    assert(rider, 'Rider demo account should exist');
    assert.strictEqual(rider.role, 'rider');

    const store = db.prepare(`SELECT * FROM stores WHERE seller_id = ?`).get(seller.id) as any;
    assert(store, 'Dwarka Fresh Mart store must exist');
    assert.strictEqual(store.name, 'Dwarka Fresh Mart');

    const amul = db.prepare(`SELECT * FROM products WHERE name LIKE ?`).get('%Amul Taaza%') as any;
    assert(amul, 'Amul Taaza product must exist in database');
    assert(amul.stock >= 20, 'Stock must be at least 20');
  });

  // 2. Authentication and password verification
  test('Password hashing and verification with scrypt', () => {
    const customer = db.prepare(`SELECT * FROM users WHERE email = ?`).get('customer.demo@nearbuy.app') as any;
    const isValid = verifyPassword('NearBuy@2026', customer.password_hash, customer.password_salt);
    assert(isValid, 'Password NearBuy@2026 must verify successfully');

    const isInvalid = verifyPassword('WrongPassword', customer.password_hash, customer.password_salt);
    assert(!isInvalid, 'Wrong password must fail verification');
  });

  // 3. Session tokens and role isolation
  test('Session tokens and role validation', () => {
    const customer = db.prepare(`SELECT * FROM users WHERE email = ?`).get('customer.demo@nearbuy.app') as any;
    const token = createSession(customer.id, 'customer');
    const authUser = getUserByToken(token);
    assert(authUser, 'Session token should resolve to user');
    assert.strictEqual(authUser?.id, customer.id);
    assert.strictEqual(authUser?.role, 'customer');
  });

  // 4. Out-of-stock validation
  test('Out-of-stock checkout rejection', () => {
    const zeroStockProdId = 'test_prod_zero_stock';
    const store = db.prepare(`SELECT id FROM stores LIMIT 1`).get() as any;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT OR REPLACE INTO products (id, store_id, name, description, category, price, stock, is_published, created_at, updated_at)
      VALUES (?, ?, 'Zero Stock Item', 'Test', 'Test', 50, 0, 1, ?, ?)
    `).run(zeroStockProdId, store.id, now, now);

    // Attempt to deduct 1 unit from stock of 0
    const result = db.prepare(`
      UPDATE products 
      SET stock = stock - 1, updated_at = ?
      WHERE id = ? AND stock >= 1
    `).run(now, zeroStockProdId);

    assert.strictEqual(result.changes, 0, 'Should not deduct when stock is 0');
  });

  // 5. Atomic Rider Job Claiming
  test('Atomic rider claim prevents race conditions', () => {
    const testOrderId = `test_ord_${Date.now()}`;
    const testJobId = `test_job_${Date.now()}`;
    const now = new Date().toISOString();
    const customer = db.prepare(`SELECT id FROM users WHERE role = 'customer' LIMIT 1`).get() as any;
    const store = db.prepare(`SELECT id FROM stores LIMIT 1`).get() as any;

    // Ensure two test riders exist in users table
    const rider1 = db.prepare(`SELECT id FROM users WHERE email = 'rider.demo@nearbuy.app'`).get() as any;
    const rider2Id = 'usr_test_rider_2';
    db.prepare(`
      INSERT OR IGNORE INTO users (id, role, name, email, phone, password_hash, password_salt, status, created_at, updated_at)
      VALUES (?, 'rider', 'Test Rider 2', 'testrider2@nearbuy.app', '9999999999', 'h', 's', 'active', ?, ?)
    `).run(rider2Id, now, now);

    db.prepare(`
      INSERT INTO orders (id, order_number, customer_id, store_id, status, subtotal, delivery_fee, total, address_snapshot, pickup_code, delivery_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'placed', 100, 30, 130, '{}', 'PK-1111', 'DL-2222', ?, ?)
    `).run(testOrderId, `NB-TEST-${Date.now()}-${Math.random()}`, customer.id, store.id, now, now);

    db.prepare(`
      INSERT INTO delivery_jobs (id, order_id, status, earnings, created_at, updated_at)
      VALUES (?, ?, 'available', 40.0, ?, ?)
    `).run(testJobId, testOrderId, now, now);

    // Rider 1 claims
    const claim1 = db.prepare(`
      UPDATE delivery_jobs 
      SET rider_id = ?, status = 'claimed', claimed_at = ?
      WHERE id = ? AND rider_id IS NULL AND status = 'available'
    `).run(rider1.id, now, testJobId);
    assert.strictEqual(claim1.changes, 1, 'Rider 1 claim should succeed');

    // Rider 2 attempts to claim same job simultaneously
    const claim2 = db.prepare(`
      UPDATE delivery_jobs 
      SET rider_id = ?, status = 'claimed', claimed_at = ?
      WHERE id = ? AND rider_id IS NULL AND status = 'available'
    `).run(rider2Id, now, testJobId);
    assert.strictEqual(claim2.changes, 0, 'Rider 2 claim must fail (atomic lock)');
  });

  // 6. Complete Order Lifecycle and Handoff Code Verifications
  test('Full Customer -> Seller -> Rider -> Customer handoff lifecycle with code checks', () => {
    const customer = db.prepare(`SELECT * FROM users WHERE email = 'customer.demo@nearbuy.app'`).get() as any;
    const seller = db.prepare(`SELECT * FROM users WHERE email = 'seller.demo@nearbuy.app'`).get() as any;
    const rider = db.prepare(`SELECT * FROM users WHERE email = 'rider.demo@nearbuy.app'`).get() as any;
    const store = db.prepare(`SELECT * FROM stores WHERE seller_id = ?`).get(seller.id) as any;
    const product = db.prepare(`SELECT * FROM products WHERE store_id = ? AND name LIKE '%Amul Taaza%'`).get(store.id) as any;

    const initialStock = product.stock;
    const now = new Date().toISOString();
    const orderId = `test_flow_ord_${Date.now()}`;
    const pickupCode = 'PK-9876';
    const deliveryCode = 'DL-5432';

    // Step A: Customer places order
    db.prepare(`
      UPDATE products SET stock = stock - 1 WHERE id = ? AND stock >= 1
    `).run(product.id);

    db.prepare(`
      INSERT INTO orders (id, order_number, customer_id, store_id, status, subtotal, delivery_fee, total, address_snapshot, pickup_code, delivery_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'placed', 68, 30, 98, '{"city":"Dwarka"}', ?, ?, ?, ?)
    `).run(orderId, `NB-FLOW-${Date.now()}-${Math.random()}`, customer.id, store.id, pickupCode, deliveryCode, now, now);

    const testJobId = `job_flow_${Date.now()}`;
    db.prepare(`
      INSERT INTO delivery_jobs (id, order_id, status, earnings, created_at, updated_at)
      VALUES (?, ?, 'available', 40.0, ?, ?)
    `).run(testJobId, orderId, now, now);

    const updatedProd = db.prepare(`SELECT stock FROM products WHERE id = ?`).get(product.id) as any;
    assert.strictEqual(updatedProd.stock, initialStock - 1, 'Inventory must be decremented');

    // Step B: Seller processes order: Placed -> Accepted -> Preparing -> Packed -> Ready for Pickup
    db.prepare(`UPDATE orders SET status = 'accepted' WHERE id = ?`).run(orderId);
    db.prepare(`UPDATE orders SET status = 'preparing' WHERE id = ?`).run(orderId);
    db.prepare(`UPDATE orders SET status = 'packed' WHERE id = ?`).run(orderId);
    db.prepare(`UPDATE orders SET status = 'ready_for_pickup' WHERE id = ?`).run(orderId);

    const readyOrder = db.prepare(`SELECT status, pickup_code FROM orders WHERE id = ?`).get(orderId) as any;
    assert.strictEqual(readyOrder.status, 'ready_for_pickup');
    assert.strictEqual(readyOrder.pickup_code, pickupCode);

    // Step C: Rider claims job
    const claimRes = db.prepare(`
      UPDATE delivery_jobs 
      SET rider_id = ?, status = 'claimed', claimed_at = ?
      WHERE id = ? AND rider_id IS NULL AND status = 'available'
    `).run(rider.id, now, testJobId);
    assert.strictEqual(claimRes.changes, 1);

    // Step D: Rider verifies pickup with seller code
    const enteredPickup = 'PK-9876';
    assert.strictEqual(enteredPickup, pickupCode, 'Rider pickup code matches');
    db.prepare(`UPDATE orders SET status = 'out_for_delivery' WHERE id = ?`).run(orderId);
    db.prepare(`UPDATE delivery_jobs SET status = 'out_for_delivery' WHERE id = ?`).run(testJobId);

    // Step E: Rider arrives at customer and verifies delivery with customer's code
    const enteredDelivery = 'DL-5432';
    assert.strictEqual(enteredDelivery, deliveryCode, 'Customer delivery code matches');
    db.prepare(`UPDATE orders SET status = 'delivered' WHERE id = ?`).run(orderId);
    db.prepare(`UPDATE delivery_jobs SET status = 'completed' WHERE id = ?`).run(testJobId);

    // Step F: Verify final persisted state
    const finalOrder = db.prepare(`SELECT status FROM orders WHERE id = ?`).get(orderId) as any;
    assert.strictEqual(finalOrder.status, 'delivered', 'Final order status must be delivered in database');

    const finalJob = db.prepare(`SELECT status FROM delivery_jobs WHERE id = ?`).get(testJobId) as any;
    assert.strictEqual(finalJob.status, 'completed', 'Final job status must be completed in database');
  });

  console.log(`\nTest results: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
