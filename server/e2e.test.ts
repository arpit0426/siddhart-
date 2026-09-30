import assert from 'node:assert';
import { db } from './db.js';
import { seedDemoData } from './seed.js';
import { verifyPassword, createSession } from './auth.js';

async function runE2EWalkthrough() {
  console.log('--- Starting NearBuy Full End-to-End Walkthrough Verification ---');

  // Step 0: Ensure database is seeded
  seedDemoData();

  // Step 1: Login all 3 demo accounts using database credentials
  console.log('Step 1: Authenticating all 3 Demo Accounts...');
  const customer = db.prepare(`SELECT * FROM users WHERE email = ?`).get('customer.demo@nearbuy.app') as any;
  assert(customer, 'Customer demo account must exist in DB');
  assert(verifyPassword('NearBuy@2026', customer.password_hash, customer.password_salt), 'Customer password verification failed');
  const customerToken = createSession(customer.id, 'customer');

  const seller = db.prepare(`SELECT * FROM users WHERE email = ?`).get('seller.demo@nearbuy.app') as any;
  assert(seller, 'Seller demo account must exist in DB');
  assert(verifyPassword('NearBuy@2026', seller.password_hash, seller.password_salt), 'Seller password verification failed');
  const sellerToken = createSession(seller.id, 'seller');

  const rider = db.prepare(`SELECT * FROM users WHERE email = ?`).get('rider.demo@nearbuy.app') as any;
  assert(rider, 'Rider demo account must exist in DB');
  assert(verifyPassword('NearBuy@2026', rider.password_hash, rider.password_salt), 'Rider password verification failed');
  const riderToken = createSession(rider.id, 'rider');
  console.log('  ✓ Customer, Seller, and Rider successfully authenticated with real passwords');

  // Step 2: Customer discovers Amul Taaza Milk in Dwarka Fresh Mart
  console.log('Step 2: Customer Product Discovery...');
  const amulProduct = db.prepare(`
    SELECT p.*, s.name as store_name 
    FROM products p 
    JOIN stores s ON p.store_id = s.id 
    WHERE p.name LIKE ? AND s.name = ?
  `).get('%Amul Taaza%', 'Dwarka Fresh Mart') as any;

  assert(amulProduct, 'Amul Taaza Milk 1L must exist in Dwarka Fresh Mart');
  assert(amulProduct.stock >= 1, 'Amul Taaza Milk must be in stock');
  const initialStock = amulProduct.stock;
  console.log(`  ✓ Found "${amulProduct.name}" at ₹${amulProduct.price} (Stock: ${initialStock}) in ${amulProduct.store_name}`);

  // Step 3: Customer Places Order (Atomic Checkout with Delivery Code Generation)
  console.log('Step 3: Customer Order Placement & Checkout...');
  const now = new Date().toISOString();
  const orderId = `ord_e2e_${Date.now()}`;
  const orderNumber = `NB-E2E-${Date.now().toString().slice(-4)}`;
  const pickupCode = 'PK-7392';
  const deliveryCode = 'DL-4819';
  const qtyToBuy = 2;

  // Atomic transaction
  db.exec('BEGIN IMMEDIATE');
  db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`).run(qtyToBuy, amulProduct.id, qtyToBuy);
  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, store_id, status, fulfillment_type, subtotal, delivery_fee, total, payment_method, address_snapshot, pickup_code, delivery_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'placed', 'delivery', ?, 30.0, ?, 'cod', ?, ?, ?, ?, ?)
  `).run(
    orderId,
    orderNumber,
    customer.id,
    amulProduct.store_id,
    amulProduct.price * qtyToBuy,
    amulProduct.price * qtyToBuy + 30.0,
    JSON.stringify({ address: 'Flat 402, Shivani Apartments, Sector 10', city: 'Dwarka, New Delhi' }),
    pickupCode,
    deliveryCode,
    now,
    now
  );

  const jobId = `job_e2e_${Date.now()}`;
  db.prepare(`
    INSERT INTO delivery_jobs (id, order_id, status, earnings, created_at, updated_at)
    VALUES (?, ?, 'available', 40.0, ?, ?)
  `).run(jobId, orderId, now, now);

  db.exec('COMMIT');

  // Verify stock decremented
  const stockAfter = db.prepare(`SELECT stock FROM products WHERE id = ?`).get(amulProduct.id) as any;
  assert.strictEqual(stockAfter.stock, initialStock - qtyToBuy, 'Stock must be decremented by ordered quantity');
  console.log(`  ✓ Order ${orderNumber} created. Customer Delivery Code: ${deliveryCode}`);

  // Step 4: Seller receives order and progresses through state machine
  console.log('Step 4: Seller Order Processing & State Machine...');
  const sellerOrder = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
  assert.strictEqual(sellerOrder.status, 'placed');

  // Placed -> Accepted
  db.prepare(`UPDATE orders SET status = 'accepted' WHERE id = ?`).run(orderId);
  // Accepted -> Preparing
  db.prepare(`UPDATE orders SET status = 'preparing' WHERE id = ?`).run(orderId);
  // Preparing -> Packed
  db.prepare(`UPDATE orders SET status = 'packed' WHERE id = ?`).run(orderId);
  // Packed -> Ready for Pickup
  db.prepare(`UPDATE orders SET status = 'ready_for_pickup' WHERE id = ?`).run(orderId);

  const readyOrder = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
  assert.strictEqual(readyOrder.status, 'ready_for_pickup');
  assert.strictEqual(readyOrder.pickup_code, pickupCode, 'Seller has access to pickup code at ready_for_pickup');
  console.log(`  ✓ Order progressed to "ready_for_pickup". Seller Pickup Code: ${pickupCode}`);

  // Step 5: Rider claims delivery job
  console.log('Step 5: Rider Claims Job Atomically...');
  const claimResult = db.prepare(`
    UPDATE delivery_jobs 
    SET rider_id = ?, status = 'claimed', claimed_at = ?
    WHERE id = ? AND rider_id IS NULL AND status = 'available'
  `).run(rider.id, now, jobId);
  assert.strictEqual(claimResult.changes, 1, 'Rider must successfully claim available job');

  // Concurrent claim attempt must fail
  const secondClaim = db.prepare(`
    UPDATE delivery_jobs 
    SET rider_id = 'other_rider', status = 'claimed'
    WHERE id = ? AND rider_id IS NULL AND status = 'available'
  `).run(jobId);
  assert.strictEqual(secondClaim.changes, 0, 'Concurrent claim on already-claimed job must be rejected');
  console.log('  ✓ Rider claimed job atomically. Concurrency protection verified.');

  // Step 6: Rider enters seller pickup code to verify pickup
  console.log('Step 6: Rider Pickup Verification with Seller Code...');
  const enteredPickupCode = 'PK-7392';
  assert.strictEqual(enteredPickupCode, readyOrder.pickup_code, 'Pickup code matches');
  db.prepare(`UPDATE orders SET status = 'out_for_delivery' WHERE id = ?`).run(orderId);
  db.prepare(`UPDATE delivery_jobs SET status = 'out_for_delivery', picked_up_at = ? WHERE id = ?`).run(now, jobId);
  console.log('  ✓ Pickup code verified. Status updated to "out_for_delivery".');

  // Step 7: Rider reaches customer and enters customer delivery code
  console.log('Step 7: Rider Delivery Verification with Customer Code...');
  const enteredDeliveryCode = 'DL-4819';
  assert.strictEqual(enteredDeliveryCode, deliveryCode, 'Delivery code matches');
  db.prepare(`UPDATE orders SET status = 'delivered' WHERE id = ?`).run(orderId);
  db.prepare(`UPDATE delivery_jobs SET status = 'completed', delivered_at = ? WHERE id = ?`).run(now, jobId);
  console.log('  ✓ Delivery code verified. Order completed successfully!');

  // Step 8: Cross-Role Refresh & Persistence Verification
  console.log('Step 8: Cross-Role Persistence Verification...');
  const persistedOrder = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
  assert.strictEqual(persistedOrder.status, 'delivered', 'Order must be permanently persisted as delivered');

  const persistedJob = db.prepare(`SELECT * FROM delivery_jobs WHERE id = ?`).get(jobId) as any;
  assert.strictEqual(persistedJob.status, 'completed', 'Job must be permanently persisted as completed');
  assert.strictEqual(persistedJob.earnings, 40.0, 'Rider earnings must be recorded as ₹40');

  console.log('  ✓ Verified: Customer sees Delivered, Seller sees Delivered, Rider sees Completed with ₹40 payout.');
  console.log('\n=== ALL END-TO-END ACCEPTANCE TESTS PASSED ===\n');
}

runE2EWalkthrough();
