import assert from 'node:assert/strict';
import { createSuite, launchServer, type ApiClient } from './harness.js';

/**
 * End-to-end journeys over the real HTTP API + SQLite database (no stubs):
 *  1. Customer journey, including logout / log back in persistence
 *  2. Rider journey, including earnings + history updating
 *  3. Cross-role journey, all three portals reading the same persisted state
 */

const suite = createSuite('End-to-end journeys');
const server = await launchServer('e2e');

async function session(role: 'customer' | 'seller' | 'rider') {
  const client = server.client();
  const response = await client.loginAsDemo(role);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return client;
}

async function placeOrder(customer: ApiClient, productQuery: string, quantity = 1) {
  // search -> store -> product -> cart -> checkout, all through backend data
  const search = await customer.get(`/api/customer/products?query=${encodeURIComponent(productQuery)}`);
  assert.equal(search.status, 200);
  const product = search.body.products[0];
  assert.ok(product, `search should find "${productQuery}"`);

  const store = await customer.get(`/api/customer/stores/${product.store_id}`);
  assert.equal(store.status, 200);
  assert.ok(store.body.products.some((p: any) => p.id === product.id));

  const detail = await customer.get(`/api/customer/products/${product.id}`);
  assert.equal(detail.body.product.id, product.id);

  await customer.del('/api/customer/cart/clear');
  const add = await customer.post('/api/customer/cart/items', { productId: product.id, quantity });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const cart = await customer.get('/api/customer/cart');
  assert.equal(cart.body.items.length, 1);

  const addresses = await customer.get('/api/customer/addresses');
  const checkout = await customer.post('/api/customer/checkout', {
    items: [{ productId: product.id, quantity }],
    fulfilmentType: 'delivery',
    addressId: addresses.body.addresses[0].id,
    paymentMethod: 'cod',
    expectedTotal: cart.body.total,
    idempotencyKey: `chk_e2e_${Math.random().toString(36).slice(2)}`,
  });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  assert.equal((await customer.get('/api/customer/cart')).body.items.length, 0, 'cart is emptied by checkout');
  return checkout.body.orders[0] as any;
}

async function sellerReady(seller: ApiClient, orderId: string) {
  let last: any;
  for (const status of ['accepted', 'preparing', 'packed', 'ready_for_pickup']) {
    last = await seller.post(`/api/seller/orders/${orderId}/status`, { status });
    assert.equal(last.status, 200, `${status}: ${JSON.stringify(last.body)}`);
  }
  return last.body.order.pickupCode as string;
}

async function riderDeliver(rider: ApiClient, orderId: string, pickupCode: string, readDeliveryCode: () => Promise<string>) {
  assert.equal((await rider.put('/api/rider/availability', { availability: 'online' })).status, 200);
  const jobs = await rider.get('/api/rider/jobs');
  const job = jobs.body.jobs.find((row: any) => row.orderId === orderId);
  assert.ok(job, 'ready order appears in the rider job list');
  assert.equal((await rider.post(`/api/rider/jobs/${job.jobId}/claim`)).status, 200);
  assert.equal((await rider.post(`/api/rider/jobs/${job.jobId}/start-pickup`)).status, 200);
  assert.equal((await rider.post(`/api/rider/jobs/${job.jobId}/pickup`, { pickupCode })).status, 200);
  assert.equal((await rider.post(`/api/rider/jobs/${job.jobId}/start-delivery`)).status, 200);
  const deliveryCode = await readDeliveryCode();
  assert.match(deliveryCode, /^DL-\d{4}$/);
  const done = await rider.post(`/api/rider/jobs/${job.jobId}/delivery`, { deliveryCode });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return job.jobId as string;
}

await suite.test('customer journey: search to DELIVERED, then logout/login keeps the state', async () => {
  const customer = await session('customer');
  const seller = await session('seller');
  const rider = await session('rider');

  const order = await placeOrder(customer, 'Amul', 1);
  assert.equal(order.status, 'placed');

  const pickupCode = await sellerReady(seller, order.id);
  const read = async () => {
    const view = await customer.get(`/api/customer/orders/${order.id}`);
    assert.equal(view.body.order.status, 'out_for_delivery');
    assert.equal(view.body.order.deliveryCodeState, 'available');
    return view.body.order.deliveryCode as string;
  };
  await riderDeliver(rider, order.id, pickupCode, read);

  const delivered = await customer.get(`/api/customer/orders/${order.id}`);
  assert.equal(delivered.body.order.status, 'delivered');
  assert.equal(delivered.body.order.deliveryCode, null, 'a used code is never shown again');
  assert.equal(delivered.body.order.deliveryCodeState, 'used');

  // logout, then log back in: delivered state persists
  assert.equal((await customer.post('/api/auth/logout')).status, 200);
  assert.equal((await customer.get('/api/customer/orders')).status, 401);
  const again = await session('customer');
  const orders = await again.get('/api/customer/orders');
  assert.equal(orders.body.orders.find((o: any) => o.id === order.id).status, 'delivered');
});

await suite.test('rider journey: online, claim, verify codes, completed; earnings and history update', async () => {
  const customer = await session('customer');
  const seller = await session('seller');
  const rider = await session('rider');

  const before = (await rider.get('/api/rider/earnings')).body.summary;
  const historyBefore = (await rider.get('/api/rider/history')).body.total;

  const order = await placeOrder(customer, 'Tata Salt', 1);
  const pickupCode = await sellerReady(seller, order.id);
  const jobId = await riderDeliver(rider, order.id, pickupCode, async () =>
    (await customer.get(`/api/customer/orders/${order.id}`)).body.order.deliveryCode
  );

  const job = (await rider.get(`/api/rider/jobs/${jobId}`)).body.job;
  assert.equal(job.jobStatus, 'completed');
  const after = (await rider.get('/api/rider/earnings')).body.summary;
  assert.ok(after.completedJobs === before.completedJobs + 1, 'completed jobs increments');
  assert.ok(after.totalEarnings > before.totalEarnings, 'an earnings record is created on completion');
  assert.equal((await rider.get('/api/rider/history')).body.total, historyBefore + 1);
  assert.equal((await rider.get('/api/rider/jobs/active')).body.job, null);

  // a full refresh of the dashboard reads the same persisted numbers
  const dashboard = (await rider.get('/api/rider/dashboard')).body;
  assert.ok(dashboard.kpis.completedToday >= 1);
});

await suite.test('cross-role journey: customer, seller and rider views agree on persistent state', async () => {
  const customer = await session('customer');
  const seller = await session('seller');
  const rider = await session('rider');

  const order = await placeOrder(customer, 'Bread', 1);
  const pickupCode = await sellerReady(seller, order.id);

  // seller sees ready_for_pickup and the pickup code, never the delivery code
  const sellerView = (await seller.get(`/api/seller/orders/${order.id}`)).body.order;
  assert.equal(sellerView.status, 'ready_for_pickup');
  assert.equal(sellerView.pickupCode, pickupCode);
  assert.equal('deliveryCode' in sellerView, false);

  const jobId = await riderDeliver(rider, order.id, pickupCode, async () =>
    (await customer.get(`/api/customer/orders/${order.id}`)).body.order.deliveryCode
  );

  const views = {
    customer: (await customer.get(`/api/customer/orders/${order.id}`)).body.order,
    seller: (await seller.get(`/api/seller/orders/${order.id}`)).body.order,
    rider: (await rider.get(`/api/rider/jobs/${jobId}`)).body.job,
  };
  assert.equal(views.customer.status, 'delivered');
  assert.equal(views.seller.status, 'delivered');
  assert.equal(views.rider.jobStatus, 'completed');
  assert.equal(JSON.stringify(views.seller).includes('DL-'), false, 'seller payload never contains a delivery code');
  assert.equal(JSON.stringify(views.rider).includes('DL-'), false, 'rider payload never contains a delivery code');

  // the seller's earnings now include the delivered order
  const earnings = (await seller.get('/api/seller/earnings')).body;
  assert.ok(earnings.recent.some((row: any) => row.id === order.id));
});

suite.summary();
await server.close();
