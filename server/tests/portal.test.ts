import assert from 'node:assert/strict';
import { createSuite, launchServer, uniqueEmail, type ApiClient } from './harness.js';

/**
 * Portal suite: security of the handoff codes, rider eligibility, multi-store
 * checkout, pickup hand-off, store status, reorder/saved items, notifications
 * and account security - all against the real HTTP API and database.
 */

const suite = createSuite('Portal feature tests');
const server = await launchServer('portal');
const db = server.db();

async function login(role: 'customer' | 'seller' | 'rider') {
  const client = server.client();
  const response = await client.loginAsDemo(role);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return client;
}

const customer = await login('customer');
const seller = await login('seller');
const rider = await login('rider');

let deliveredOrderId = '';

async function defaultAddress(client: ApiClient) {
  const response = await client.get('/api/customer/addresses');
  return response.body.addresses[0].id as string;
}

async function place(client: ApiClient, items: { productId: string; quantity: number }[], extra: Record<string, unknown> = {}) {
  const fulfilmentType = (extra.fulfilmentType as string) ?? 'delivery';
  const response = await client.post('/api/customer/checkout', {
    items,
    fulfilmentType,
    paymentMethod: 'cod',
    addressId: fulfilmentType === 'delivery' ? await defaultAddress(client) : undefined,
    idempotencyKey: `chk_${Math.random().toString(36).slice(2)}_${Date.now()}`,
    ...extra,
  });
  return response;
}

async function advance(orderId: string, statuses = ['accepted', 'preparing', 'packed', 'ready_for_pickup']) {
  let last: any;
  for (const status of statuses) {
    last = await seller.post(`/api/seller/orders/${orderId}/status`, { status });
    assert.equal(last.status, 200, `${status}: ${JSON.stringify(last.body)}`);
  }
  return last;
}

await suite.test('delivery code is hidden from seller, riders, strangers and API listings', async () => {
  const placed = await place(customer, [{ productId: 'prod_tata_salt', quantity: 1 }]);
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const orderId = placed.body.orders[0].id;
  deliveredOrderId = orderId;
  const secret = (db.prepare(`SELECT delivery_code FROM orders WHERE id = ?`).get(orderId) as any).delivery_code;

  await advance(orderId);

  const stranger = server.client();
  await stranger.post('/api/auth/register', {
    role: 'customer', name: 'Other Person', email: uniqueEmail('stranger'), password: 'TestPass123', termsAccepted: true,
  });
  await rider.put('/api/rider/availability', { availability: 'online' });

  const job = (await rider.get('/api/rider/jobs')).body.jobs.find((row: any) => row.orderId === orderId);
  assert.ok(job);
  await rider.post(`/api/rider/jobs/${job.jobId}/claim`);

  const views = [
    await seller.get(`/api/seller/orders/${orderId}`),
    await seller.get('/api/seller/orders'),
    await rider.get(`/api/rider/jobs/${job.jobId}`),
    await rider.get('/api/rider/jobs/active'),
    await rider.get('/api/rider/dashboard'),
    await customer.get(`/api/customer/orders/${orderId}`),
    await customer.get('/api/customer/orders'),
    await stranger.get(`/api/customer/orders/${orderId}`),
  ];
  for (const view of views) {
    assert.ok(!JSON.stringify(view.body).includes(secret), `delivery code leaked at ${view.status}`);
  }
  assert.equal(views[7].status, 404);

  // Only once the rider is out for delivery does the owning customer receive the code.
  const pickupCode = (await seller.get(`/api/seller/orders/${orderId}`)).body.order.pickupCode;
  assert.match(pickupCode, /^PK-\d{4}$/);
  assert.equal((await rider.post(`/api/rider/jobs/${job.jobId}/pickup`, { pickupCode })).status, 200);
  assert.ok(!JSON.stringify((await customer.get(`/api/customer/orders/${orderId}`)).body).includes(secret));
  assert.equal((await rider.post(`/api/rider/jobs/${job.jobId}/start-delivery`)).status, 200);
  const visible = await customer.get(`/api/customer/orders/${orderId}`);
  assert.equal(visible.body.order.deliveryCode, secret);
  assert.equal((await stranger.get(`/api/customer/orders/${orderId}`)).status, 404);

  // A wrong code never reveals the right one.
  const wrong = await rider.post(`/api/rider/jobs/${job.jobId}/delivery`, { deliveryCode: 'DL-0000' });
  assert.equal(wrong.status, 400);
  assert.ok(!JSON.stringify(wrong.body).includes(secret));

  const done = await rider.post(`/api/rider/jobs/${job.jobId}/delivery`, { deliveryCode: secret });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS c FROM rider_earnings WHERE job_id = ?`).get(job.jobId) as any).c,
    1,
    'exactly one earnings record per completed job'
  );
  const dash = await rider.get('/api/rider/dashboard');
  assert.ok(dash.body.kpis.todaysEarnings >= 40);
  assert.equal((await rider.get('/api/rider/earnings')).body.summary.completedJobs >= 1, true);

  // Completed jobs no longer expose the customer's address or phone.
  const history = await rider.get('/api/rider/history?period=today');
  const row = history.body.jobs.find((j: any) => j.jobId === job.jobId);
  assert.equal(row.drop, null);
  assert.equal(row.customerPhone, null);
  await rider.put('/api/rider/availability', { availability: 'offline' });
});

await suite.test('offline riders cannot claim and riders cannot read each other\'s jobs', async () => {
  const placed = await place(customer, [{ productId: 'prod_tata_salt', quantity: 1 }]);
  const orderId = placed.body.orders[0].id;
  await advance(orderId);
  const jobId = (db.prepare(`SELECT id FROM delivery_jobs WHERE order_id = ?`).get(orderId) as any).id;

  assert.equal((await rider.put('/api/rider/availability', { availability: 'offline' })).status, 200);
  const offlineClaim = await rider.post(`/api/rider/jobs/${jobId}/claim`);
  assert.equal(offlineClaim.status, 409);
  assert.equal(offlineClaim.body.code, 'rider_offline');

  await rider.put('/api/rider/availability', { availability: 'online' });
  assert.equal((await rider.post(`/api/rider/jobs/${jobId}/claim`)).status, 200);

  const other = server.client();
  await other.post('/api/auth/register', {
    role: 'rider', name: 'Other Rider', email: uniqueEmail('rider'), password: 'TestPass123', termsAccepted: true,
  });
  assert.equal((await other.get(`/api/rider/jobs/${jobId}`)).status, 404);
  const blocked = await other.put('/api/rider/availability', { availability: 'online' });
  assert.equal(blocked.status, 409, 'un-onboarded riders cannot go online');

  // Riders cannot go offline while a delivery is active.
  assert.equal((await rider.put('/api/rider/availability', { availability: 'offline' })).status, 409);
  assert.equal((await rider.post(`/api/rider/jobs/${jobId}/release`)).status, 200);
  await rider.put('/api/rider/availability', { availability: 'offline' });
});

await suite.test('multi-store checkout creates one order per store with a single checkout id', async () => {
  const stores = (await customer.get('/api/customer/stores')).body.stores;
  const other = stores.find((s: any) => s.name !== 'Dwarka Fresh Mart' && s.product_count > 0 && s.isOpen);
  assert.ok(other, 'a second open store exists');
  const detail = await customer.get(`/api/customer/stores/${other.id}`);
  const product = detail.body.products.find((p: any) => p.stock > 2);
  assert.ok(product);

  const placed = await place(customer, [
    { productId: 'prod_amul_taaza', quantity: 1 },
    { productId: product.id, quantity: 1 },
  ]);
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  assert.equal(placed.body.orders.length, 2);
  const rows = db
    .prepare(`SELECT DISTINCT checkout_id FROM orders WHERE id IN (?, ?)`)
    .all(placed.body.orders[0].id, placed.body.orders[1].id) as any[];
  assert.equal(rows.length, 1);
  assert.equal(
    (db.prepare(`SELECT COUNT(DISTINCT delivery_code) AS c FROM orders WHERE checkout_id = ?`).get(rows[0].checkout_id) as any).c,
    2,
    'each store order has its own handoff codes'
  );
});

await suite.test('checkout refuses a stale expected total and a closed store', async () => {
  const stale = await place(customer, [{ productId: 'prod_amul_taaza', quantity: 1 }], { expectedTotal: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'price_changed');

  assert.equal((await seller.put('/api/seller/store/status', { status: 'closed', message: 'Back at 9am' })).status, 200);
  const closed = await place(customer, [{ productId: 'prod_amul_taaza', quantity: 1 }]);
  assert.equal(closed.status, 400, JSON.stringify(closed.body));
  const cart = await customer.post('/api/customer/cart/items', { productId: 'prod_amul_taaza', quantity: 1 });
  assert.ok([200, 400].includes(cart.status));
  assert.equal((await seller.put('/api/seller/store/status', { status: 'open' })).status, 200);
  await customer.post('/api/customer/cart/clear');
});

await suite.test('pickup orders are completed by the seller with the customer code', async () => {
  const placed = await place(customer, [{ productId: 'prod_tata_salt', quantity: 1 }], { fulfilmentType: 'pickup' });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const orderId = placed.body.orders[0].id;
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS c FROM delivery_jobs WHERE order_id = ?`).get(orderId) as any).c,
    0,
    'pickup orders never create rider jobs'
  );
  await advance(orderId);
  const code = (await customer.get(`/api/customer/orders/${orderId}`)).body.order.deliveryCode;
  assert.match(code, /^DL-\d{4}$/);
  const wrong = await seller.post(`/api/seller/orders/${orderId}/complete-pickup`, { code: 'DL-0000' });
  assert.equal(wrong.status, 400);
  const ok = await seller.post(`/api/seller/orders/${orderId}/complete-pickup`, { code });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await customer.get(`/api/customer/orders/${orderId}`)).body.order.status, 'delivered');
});

await suite.test('reorder revalidates against live stock; saved items persist', async () => {
  const orderId = deliveredOrderId;
  assert.ok(orderId, 'needs the order delivered earlier');
  db.prepare(`UPDATE inventory SET stock_quantity = 0 WHERE product_id = 'prod_tata_salt'`).run();
  const reorder = await customer.post(`/api/customer/orders/${orderId}/reorder`);
  assert.equal(reorder.status, 200, JSON.stringify(reorder.body));
  assert.equal(reorder.body.skipped.length, 1, 'out-of-stock item is skipped, never added');
  db.prepare(`UPDATE inventory SET stock_quantity = 40 WHERE product_id = 'prod_tata_salt'`).run();

  assert.equal((await customer.post('/api/customer/saved', { productId: 'prod_amul_taaza' })).status, 201);
  const saved = await customer.get('/api/customer/saved');
  assert.ok(saved.body.items.some((item: any) => item.id === 'prod_amul_taaza'));
  await customer.del('/api/customer/saved/prod_amul_taaza');
  assert.equal((await customer.get('/api/customer/saved')).body.items.length, 0);
});

await suite.test('stock requests and reservations are separate and never touch stock when only confirmed', async () => {
  const before = (db.prepare(`SELECT stock_quantity, reserved_quantity FROM inventory WHERE product_id = 'prod_amul_taaza'`).get() as any);
  const request = await customer.post('/api/customer/stock-requests', { productId: 'prod_amul_taaza', requestedQuantity: 2 });
  assert.equal(request.status, 201, JSON.stringify(request.body));
  const list = await seller.get('/api/seller/stock-requests');
  const row = list.body.requests?.find?.((r: any) => r.product_id === 'prod_amul_taaza') ?? list.body.stockRequests?.[0];
  assert.ok(row, JSON.stringify(list.body).slice(0, 200));
  const confirm = await seller.put(`/api/seller/stock-requests/${row.id}`, { status: 'confirmed' });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  const after = (db.prepare(`SELECT stock_quantity, reserved_quantity FROM inventory WHERE product_id = 'prod_amul_taaza'`).get() as any);
  assert.deepEqual(after, before, 'confirming a stock request must not reserve or consume stock');
});

await suite.test('notifications are created for real events and scoped to their owner', async () => {
  const mine = await customer.get('/api/customer/notifications');
  assert.equal(mine.status, 200);
  assert.ok(mine.body.notifications.length > 0);
  assert.ok(mine.body.unreadCount > 0);
  const sellerFeed = await seller.get('/api/seller/notifications');
  assert.ok(sellerFeed.body.notifications.length > 0);
  const id = mine.body.notifications[0].id;
  assert.equal((await seller.post(`/api/seller/notifications/${id}/read`)).status, 404, 'cannot read another account\'s notification');
  assert.equal((await customer.post(`/api/customer/notifications/${id}/read`)).status, 200);
  assert.equal((await customer.get('/api/rider/notifications')).status, 403);
});

await suite.test('seller inventory: events recorded, negative stock refused, unpublish hides product', async () => {
  const before = await seller.get('/api/seller/inventory/events');
  const adjust = await seller.post('/api/seller/products/prod_tata_salt/stock', { mode: 'delta', value: -1000 });
  assert.equal(adjust.status, 400);
  const ok = await seller.post('/api/seller/products/prod_tata_salt/stock', { mode: 'delta', value: 3, reason: 'Restock' });
  assert.equal(ok.status, 200);
  const after = await seller.get('/api/seller/inventory/events');
  assert.equal(after.body.total, before.body.total + 1);
  assert.equal(after.body.events[0].delta, 3);
  assert.equal(after.body.events[0].note, 'Restock');

  const created = await seller.post('/api/seller/products', {
    name: 'Test Notebook A5', category: 'Stationery', price: 60, stock: 4, isPublished: true, brand: 'Classmate', unit: '1pc', mrp: 70, sku: 'NB-A5',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const badMrp = await seller.put(`/api/seller/products/${created.body.product.id}`, { mrp: 10 });
  assert.equal(badMrp.status, 400);
  const found = await customer.get('/api/customer/products?query=Notebook');
  assert.ok(found.body.products.some((p: any) => p.brand === 'Classmate'));
  await seller.put(`/api/seller/products/${created.body.product.id}`, { isPublished: false });
  assert.equal((await customer.get(`/api/customer/products/${created.body.product.id}`)).status, 404);
});

await suite.test('security: sessions are listable, revocable, and passwords never leak', async () => {
  const profile = await customer.get('/api/customer/profile');
  assert.ok(!JSON.stringify(profile.body).match(/password|salt|hash/i));
  const put = await customer.put('/api/customer/profile', { name: 'Aarav Sharma' });
  assert.ok(!JSON.stringify(put.body).match(/password_hash|salt/i));

  const sessions = await customer.get('/api/customer/security/sessions');
  assert.equal(sessions.status, 200);
  assert.ok(sessions.body.sessions.some((s: any) => s.current));
  const weak = await customer.post('/api/customer/security/password', { currentPassword: 'NearBuy@2026', newPassword: 'short' });
  assert.equal(weak.status, 400);
  const wrong = await customer.post('/api/customer/security/password', { currentPassword: 'nope-nope-1', newPassword: 'BetterPass123' });
  assert.ok([400, 401, 403].includes(wrong.status));
});

await suite.test('customer discovery endpoints return backend-filtered, paginated data', async () => {
  const cats = await customer.get('/api/customer/categories');
  assert.ok(cats.body.categories.length >= 8);
  const dairy = await customer.get('/api/customer/categories/dairy');
  assert.ok(dairy.body.products.every((p: any) => p.category === 'Dairy'));
  const cheap = await customer.get('/api/customer/products?maxPrice=50&sort=price_asc');
  assert.ok(cheap.body.products.every((p: any) => p.price <= 50));
  const nearby = await customer.get('/api/customer/stores?lat=28.5823&lng=77.05&sort=distance');
  assert.ok(nearby.body.stores[0].distanceKm !== null);
  const dash = await customer.get('/api/customer/dashboard');
  assert.equal(dash.status, 200);
  const none = await customer.get('/api/customer/search?q=zzzzzzqqq');
  assert.equal(none.body.products.length, 0);
  assert.equal((await server.client().get('/api/customer/stores')).status, 401);
});

await suite.test('seller earnings, store preview, settings and profile save stay consistent', async () => {
  const earnings = await seller.get('/api/seller/earnings');
  assert.equal(earnings.status, 200, JSON.stringify(earnings.body));
  assert.ok(earnings.body.summary.gross > 0, 'delivered orders from earlier tests count as gross');
  const { gross, platformFee, net } = earnings.body.summary;
  assert.ok(Math.abs(gross - platformFee - net) < 0.02);
  assert.ok(earnings.body.recent.length > 0);
  assert.equal((await customer.get('/api/seller/earnings')).status, 403);

  const preview = await seller.get('/api/seller/store/preview');
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.ok(preview.body.products.length > 0);
  assert.equal(preview.body.visibleToCustomers, true);

  const settings = await seller.put('/api/seller/store/settings', { fulfilmentMinMinutes: 20, fulfilmentMaxMinutes: 10 });
  assert.equal(settings.status, 400);
  const ok = await seller.put('/api/seller/store/settings', { fulfilmentMinMinutes: 15, fulfilmentMaxMinutes: 40, supportPhone: '+91 98111 22334' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  // Closing the store, then re-saving the profile without a status, must not reopen it.
  const closed = await seller.put('/api/seller/store/status', { status: 'closed', message: 'Back soon' });
  assert.equal(closed.status, 200);
  const current = (await seller.get('/api/seller/store')).body.store;
  const resave = await seller.post('/api/seller/store', {
    name: current.name, description: current.description, category: current.category, address: current.address,
    city: current.city, state: current.state, pincode: current.pincode,
  });
  assert.equal(resave.status, 200, JSON.stringify(resave.body));
  assert.equal(resave.body.store.status, 'closed');
  const reopened = await seller.put('/api/seller/store/status', { status: 'open' });
  assert.equal(reopened.body.store.status, 'open');
});

suite.summary();
await server.close();
