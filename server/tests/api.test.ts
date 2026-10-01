import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createSuite, launchServer, uniqueEmail, type ApiClient } from './harness.js';

/**
 * API / integration suite: exercises the real HTTP surface with cookie sessions,
 * covering authorization, discovery, checkout idempotency + races, the full
 * Customer → Seller → Rider → Customer handoff and persistence across restart.
 */

const suite = createSuite('API integration tests');
const server = await launchServer('api');
const db = server.db();

const demoCustomer = server.client();
const demoSeller = server.client();
const demoRider = server.client();

async function loginOk(client: ApiClient, email: string, password: string, role: string) {
  const response = await client.post('/api/auth/login', { email, password, expectedRole: role });
  assert.equal(response.status, 200, `login failed for ${email}: ${JSON.stringify(response.body)}`);
  return response.body;
}

async function registerCustomer(prefix: string) {
  const client = server.client();
  const email = uniqueEmail(prefix);
  const response = await client.post('/api/auth/register', {
    role: 'customer',
    name: `Test ${prefix}`,
    email,
    phone: '+91 98111 00000',
    password: 'TestPass123',
    termsAccepted: true,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return { client, email, user: response.body.user };
}

async function addAddress(client: ApiClient) {
  const response = await client.post('/api/customer/addresses', {
    recipientName: 'Test Customer',
    phone: '+91 98111 00000',
    addressLine: 'Flat 7B, Test Residency, Sector 12',
    city: 'Dwarka, New Delhi',
    state: 'Delhi',
    pincode: '110078',
    isDefault: true,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.id as string;
}

function productIds(body: any): string[] {
  const products = Array.isArray(body?.products) ? body.products : [];
  return products.map((product: any) => product.id);
}

let newSeller: ApiClient;
let secondRiderClient: ApiClient;
let createdStoreProductId = '';
let createdStoreId = '';
let mainOrderId = '';
let mainJobId = '';
let mainDeliveryCode = '';
let mainPickupCode = '';

/* -------------------------------------------------------------------------- */
/* Health + discovery                                                         */
/* -------------------------------------------------------------------------- */

await suite.test('health endpoints report process and database readiness', async () => {
  const health = await server.client().get('/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');

  const ready = await server.client().get('/health/ready');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.database, 'connected');
  assert.ok(ready.body.migrationsApplied >= 8);
});

await suite.test('public discovery returns the seeded demo store and catalog', async () => {
  const anonymous = server.client();
  const stores = await anonymous.get('/api/customer/stores');
  assert.equal(stores.status, 200);
  const names = (stores.body.stores ?? []).map((store: any) => store.name);
  assert.ok(names.includes('Dwarka Fresh Mart'), `expected demo store in ${JSON.stringify(names)}`);

  const search = await anonymous.get('/api/customer/products?query=Amul');
  assert.equal(search.status, 200);
  assert.ok(productIds(search.body).length > 0, 'Amul Taaza Milk should be searchable');
  const amul = search.body.products.find((product: any) => /Amul/i.test(product.name));
  assert.equal(amul.price, 68);
  assert.equal(amul.store_name, 'Dwarka Fresh Mart');
});

/* -------------------------------------------------------------------------- */
/* Authorization                                                              */
/* -------------------------------------------------------------------------- */

await suite.test('protected endpoints reject anonymous callers with 401', async () => {
  const anonymous = server.client();
  for (const path of ['/api/customer/cart', '/api/seller/store', '/api/rider/jobs/available', '/api/customer/orders']) {
    const response = await anonymous.get(path);
    assert.equal(response.status, 401, `${path} should require authentication`);
  }
});

await suite.test('role isolation returns 403 when a session hits another portal', async () => {
  await loginOk(demoCustomer, 'customer.demo@nearbuy.app', 'NearBuy@2026', 'customer');
  await loginOk(demoSeller, 'seller.demo@nearbuy.app', 'NearBuy@2026', 'seller');
  await loginOk(demoRider, 'rider.demo@nearbuy.app', 'NearBuy@2026', 'rider');

  assert.equal((await demoCustomer.get('/api/seller/store')).status, 403);
  assert.equal((await demoCustomer.get('/api/rider/jobs/available')).status, 403);
  assert.equal((await demoCustomer.post('/api/seller/orders/any/status', { status: 'accepted' })).status, 403);
  assert.equal((await demoSeller.get('/api/customer/orders')).status, 403);
  assert.equal((await demoSeller.get('/api/rider/jobs/available')).status, 403);
  assert.equal((await demoRider.get('/api/seller/orders')).status, 403);
  assert.equal((await demoRider.get('/api/customer/cart')).status, 403);
});

await suite.test('login rejects wrong passwords and cross-portal accounts', async () => {
  const client = server.client();
  const wrongPassword = await client.post('/api/auth/login', {
    email: 'customer.demo@nearbuy.app',
    password: 'definitely-wrong-9',
  });
  assert.equal(wrongPassword.status, 401);

  const wrongPortal = await client.post('/api/auth/login', {
    email: 'seller.demo@nearbuy.app',
    password: 'NearBuy@2026',
    expectedRole: 'customer',
  });
  assert.equal(wrongPortal.status, 403);
  assert.match(String(wrongPortal.body.error), /seller portal/i);
});

await suite.test('registration enforces the password policy and unique emails', async () => {
  const client = server.client();
  const weak = await client.post('/api/auth/register', {
    role: 'customer',
    name: 'Weak Password',
    email: uniqueEmail('weak'),
    password: 'short1',
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.code, 'weak_password');

  const email = uniqueEmail('dupe');
  const first = await server.client().post('/api/auth/register', {
    role: 'customer',
    name: 'Duplicate One',
    email,
    password: 'TestPass123',
    termsAccepted: true,
  });
  assert.equal(first.status, 201);
  const second = await server.client().post('/api/auth/register', {
    role: 'customer',
    name: 'Duplicate Two',
    email,
    password: 'TestPass123',
    termsAccepted: true,
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'email_taken');
});

await suite.test('logout invalidates the cookie session', async () => {
  const client = server.client();
  await loginOk(client, 'customer.demo@nearbuy.app', 'NearBuy@2026', 'customer');
  assert.equal((await client.get('/api/auth/me')).status, 200);
  const logout = await client.post('/api/auth/logout');
  assert.equal(logout.status, 200);
  assert.equal((await client.get('/api/auth/me')).status, 401);
});

await suite.test('CSRF guards block cookie writes without the client header or from a foreign origin', async () => {
  const client = server.client();
  await loginOk(client, 'customer.demo@nearbuy.app', 'NearBuy@2026', 'customer');
  const token = client.sessionValue();
  assert.ok(token, 'session cookie should be set');

  const missingHeader = await fetch(`${server.baseUrl}/api/customer/cart/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `nb_session=${token}` },
    body: JSON.stringify({ productId: 'prod_amul_taaza', quantity: 1 }),
  });
  assert.equal(missingHeader.status, 403);

  const foreignOrigin = await fetch(`${server.baseUrl}/api/customer/cart/items`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://evil.example',
      Cookie: `nb_session=${token}`,
    },
    body: JSON.stringify({ productId: 'prod_amul_taaza', quantity: 1 }),
  });
  assert.equal(foreignOrigin.status, 403);
});

/* -------------------------------------------------------------------------- */
/* Cart + checkout                                                            */
/* -------------------------------------------------------------------------- */

await suite.test('cart totals are computed server-side and client prices are ignored', async () => {
  const { client } = await registerCustomer('cart');
  const anonymous = server.client();
  const products = await anonymous.get('/api/customer/products?query=Amul');
  const product = products.body.products[0];

  const tampered = await client.post('/api/customer/cart/items', {
    productId: product.id,
    quantity: 2,
    price: 1,
    subtotal: 2,
  });
  assert.equal(tampered.status, 200, JSON.stringify(tampered.body));
  assert.equal(tampered.body.subtotal, 136, 'server must price 2 × ₹68, not the client-supplied price');

  const cart = await client.get('/api/customer/cart');
  assert.equal(cart.body.subtotal, 136);
  assert.equal(cart.body.stores[0].deliveryFee, 30);

  const overStock = await client.post('/api/customer/cart/items', { productId: product.id, quantity: 500 });
  assert.equal(overStock.status, 400);
  assert.match(String(overStock.body.error), /available right now|out of stock/i);

  await client.post('/api/customer/cart/clear');
});

await suite.test('checkout quote is server-authoritative (₹30 per store, no client totals)', async () => {
  const { client } = await registerCustomer('quote');
  const addressId = await addAddress(client);
  const products = await server.client().get('/api/customer/products?query=Bread');
  const bread = products.body.products.find((product: any) => /Bread/i.test(product.name));

  const quote = await client.post('/api/customer/checkout/quote', {
    items: [{ productId: bread.id, quantity: 2 }],
    fulfilmentType: 'delivery',
    total: 1,
  });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.quote.subtotal, 90, '2 × ₹45');
  assert.equal(quote.body.quote.deliveryFee, 30);
  assert.equal(quote.body.quote.total, 120);
  assert.equal(quote.body.quote.stores[0].storeName, 'Dwarka Fresh Mart');
  assert.ok(addressId);
});

/* -------------------------------------------------------------------------- */
/* New-seller discoverability + stock rules                                   */
/* -------------------------------------------------------------------------- */

await suite.test('a new seller only becomes discoverable after publishing, with live inventory', async () => {
  const seller = server.client();
  const email = uniqueEmail('seller');
  const registered = await seller.post('/api/auth/register', {
    role: 'seller',
    name: 'Neighbourhood Seller',
    email,
    password: 'TestPass123',
  });
  assert.equal(registered.status, 201);

  const store = await seller.post('/api/seller/store', {
    name: 'Sunrise Kirana',
    description: 'Fresh groceries for the block',
    category: 'Grocery',
    address: 'Shop 9, Sunrise Market, Sector 6',
    city: 'Dwarka, New Delhi',
    pincode: '110075',
    contactPhone: '+91 98111 22222',
  });
  assert.ok([200, 201].includes(store.status), JSON.stringify(store.body));
  createdStoreId = store.body.store.id;
  newSeller = seller;

  const product = await seller.post('/api/seller/products', {
    storeId: createdStoreId,
    name: 'Sunrise Poha 500g',
    category: 'Grocery',
    price: 42,
    stock: 6,
    isPublished: true,
  });
  assert.equal(product.status, 201, JSON.stringify(product.body));
  createdStoreProductId = product.body.product.id;

  const draft = await server.client().get('/api/customer/products?query=Sunrise%20Poha');
  assert.equal(productIds(draft.body).includes(createdStoreProductId), false, 'draft store is not discoverable');
  assert.equal((await seller.post('/api/seller/store/publish')).status, 200);
  const beforePublish = await server.client().get('/api/customer/products?query=Sunrise%20Poha');
  assert.equal(productIds(beforePublish.body).includes(createdStoreProductId), true, 'published store is discoverable');
  assert.equal((await server.client().get(`/api/customer/products/${createdStoreProductId}`)).status, 200);

  // Unpublish → hidden from discovery, direct lookup must fail too.
  const unpublish = await seller.post('/api/seller/store/unpublish');
  assert.equal(unpublish.status, 200);
  const hidden = await server.client().get('/api/customer/products?query=Sunrise%20Poha');
  assert.equal(productIds(hidden.body).includes(createdStoreProductId), false);
  assert.equal((await server.client().get(`/api/customer/products/${createdStoreProductId}`)).status, 404);

  const publish = await seller.post('/api/seller/store/publish');
  assert.equal(publish.status, 200);
  const visible = await server.client().get('/api/customer/products?query=Sunrise%20Poha');
  assert.equal(productIds(visible.body).includes(createdStoreProductId), true);

  // Stock authority: seller sets 1, customers cannot buy 2.
  const stock = await seller.post(`/api/seller/products/${createdStoreProductId}/stock`, { mode: 'set', value: 1 });
  assert.equal(stock.status, 200);
  assert.equal(stock.body.inventory.sellable, 1);

  const buyer = await registerCustomer('oos');
  const addressId = await addAddress(buyer.client);
  const rejected = await buyer.client.post('/api/customer/checkout', {
    items: [{ productId: createdStoreProductId, quantity: 2 }],
    fulfilmentType: 'delivery',
    addressId,
    paymentMethod: 'cod',
    idempotencyKey: `chk_oos_${Date.now()}`,
  });
  assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
  assert.match(String(rejected.body.error), /Only 1 unit|out of stock/i);

  const inventory = await seller.get('/api/seller/inventory');
  const row = inventory.body.inventory.find((item: any) => item.id === createdStoreProductId);
  assert.equal(row.sellable, 1, 'rejected checkout must not consume stock');
  assert.ok(row.sellable >= 0);
});

await suite.test('duplicate checkout with the same idempotency key creates exactly one order', async () => {
  const { client } = await registerCustomer('dupe-checkout');
  const addressId = await addAddress(client);
  const seller = newSeller;

  const stock = await seller.post(`/api/seller/products/${createdStoreProductId}/stock`, { mode: 'set', value: 5 });
  assert.equal(stock.status, 200);

  const key = `chk_idem_${Date.now()}`;
  const payload = {
    items: [{ productId: createdStoreProductId, quantity: 2 }],
    fulfilmentType: 'delivery',
    addressId,
    paymentMethod: 'cod',
    idempotencyKey: key,
  };

  const first = await client.post('/api/customer/checkout', payload);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.orders.length, 1);

  const second = await client.post('/api/customer/checkout', payload);
  assert.ok([200, 201].includes(second.status));
  assert.equal(second.body.idempotent, true);
  assert.equal(second.body.orders[0].id, first.body.orders[0].id, 'replay must return the original order');

  const sellerOrders = await seller.get('/api/seller/inventory');
  const row = sellerOrders.body.inventory.find((item: any) => item.id === createdStoreProductId);
  assert.equal(row.sellable, 3, 'stock must be consumed exactly once (5 − 2)');
});

await suite.test('concurrent checkout of the last unit has exactly one winner and never goes negative', async () => {
  const seller = newSeller;
  await seller.post(`/api/seller/products/${createdStoreProductId}/stock`, { mode: 'set', value: 1 });

  const buyerA = await registerCustomer('race-a');
  const buyerB = await registerCustomer('race-b');
  const addressA = await addAddress(buyerA.client);
  const addressB = await addAddress(buyerB.client);

  const payload = (addressId: string, tag: string) => ({
    items: [{ productId: createdStoreProductId, quantity: 1 }],
    fulfilmentType: 'delivery',
    addressId,
    paymentMethod: 'cod',
    idempotencyKey: `chk_race_${tag}_${Date.now()}`,
  });

  const [responseA, responseB] = await Promise.all([
    buyerA.client.post('/api/customer/checkout', payload(addressA, 'a')),
    buyerB.client.post('/api/customer/checkout', payload(addressB, 'b')),
  ]);

  const statuses = [responseA.status, responseB.status].sort();
  assert.equal(statuses[0], 201, `one checkout must succeed: ${JSON.stringify([responseA.body, responseB.body])}`);
  assert.ok(statuses[1] >= 400, 'the losing checkout must fail');
  assert.ok([400, 409].includes(statuses[1]));

  const inventory = await seller.get('/api/seller/inventory');
  const row = inventory.body.inventory.find((item: any) => item.id === createdStoreProductId);
  assert.equal(row.sellable, 0, 'last unit sold exactly once');
  assert.ok(row.stock_quantity >= 0 && row.reserved_quantity >= 0, 'no negative stock');
  assert.equal(row.sellable, 0);
});

/* -------------------------------------------------------------------------- */
/* Full Customer → Seller → Rider → Customer lifecycle                        */
/* -------------------------------------------------------------------------- */

await suite.test('full handoff lifecycle with role-scoped codes and status sync', async () => {
  const addresses = await demoCustomer.get('/api/customer/addresses');
  const addressId = addresses.body.addresses[0]?.id;
  assert.ok(addressId, 'demo customer needs a saved address');

  const checkout = await demoCustomer.post('/api/customer/checkout', {
    items: [{ productId: 'prod_amul_taaza', quantity: 2 }],
    fulfilmentType: 'delivery',
    addressId,
    paymentMethod: 'cod',
    idempotencyKey: `chk_lifecycle_${Date.now()}`,
  });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  const order = checkout.body.orders[0];
  mainOrderId = order.id;
  mainDeliveryCode = order.deliveryCode;
  assert.equal(order.status, 'placed');
  assert.match(mainDeliveryCode, /^DL-\d{4}$/);
  assert.equal('pickupCode' in order, false, 'customer must never receive the seller pickup code');
  assert.equal(order.total, 166, '2 × ₹68 + ₹30 delivery');

  // Another customer cannot read someone else's order.
  const stranger = await registerCustomer('stranger');
  assert.equal((await stranger.client.get(`/api/customer/orders/${mainOrderId}`)).status, 404);

  // Seller sees the order but no delivery code; pickup code still hidden.
  let sellerOrder = await demoSeller.get(`/api/seller/orders/${mainOrderId}`);
  assert.equal(sellerOrder.status, 200);
  assert.equal(sellerOrder.body.order.pickupCode, null);
  assert.equal('deliveryCode' in sellerOrder.body.order, false);

  // Illegal transitions are rejected server-side.
  const illegal = await demoSeller.post(`/api/seller/orders/${mainOrderId}/status`, { status: 'delivered' });
  assert.equal(illegal.status, 400, 'a seller must never be able to mark an order delivered');

  const skip = await demoSeller.post(`/api/seller/orders/${mainOrderId}/status`, { status: 'packed' });
  assert.equal(skip.status, 400, 'cannot skip accepted/preparing');
  assert.equal(skip.body.code, 'invalid_transition');

  for (const status of ['accepted', 'preparing', 'packed']) {
    const step = await demoSeller.post(`/api/seller/orders/${mainOrderId}/status`, { status });
    assert.equal(step.status, 200, `${status}: ${JSON.stringify(step.body)}`);
  }

  sellerOrder = await demoSeller.get(`/api/seller/orders/${mainOrderId}`);
  assert.equal(sellerOrder.body.order.pickupCode, null, 'pickup code stays hidden until ready_for_pickup');

  const ready = await demoSeller.post(`/api/seller/orders/${mainOrderId}/status`, { status: 'ready_for_pickup' });
  assert.equal(ready.status, 200);
  mainPickupCode = ready.body.order.pickupCode;
  assert.match(String(mainPickupCode), /^PK-\d{4}$/);

  const customerAfterReady = await demoCustomer.get(`/api/customer/orders/${mainOrderId}`);
  assert.equal(customerAfterReady.body.order.status, 'ready_for_pickup');
  assert.equal('pickupCode' in customerAfterReady.body.order, false);

  // Job becomes claimable; claiming is atomic.
  const available = await demoRider.get('/api/rider/jobs/available');
  const job = available.body.jobs.find((row: any) => row.orderId === mainOrderId);
  assert.ok(job, 'ready order must appear in available jobs');
  mainJobId = job.jobId;
  assert.equal('drop' in job, true);
  assert.equal(job.drop, null, 'exact drop address stays hidden until claimed');

  const premature = await demoRider.post(`/api/rider/jobs/${mainJobId}/verify-pickup`, { pickupCode: mainPickupCode });
  assert.equal(premature.status, 404, 'a rider cannot verify a job that is not assigned to them');

  const claim = await demoRider.post(`/api/rider/jobs/${mainJobId}/claim`);
  assert.equal(claim.status, 200, JSON.stringify(claim.body));

  // A second, fully onboarded rider cannot claim the same job.
  secondRiderClient = server.client();
  await secondRiderClient.post('/api/auth/register', {
    role: 'rider',
    name: 'Second Rider',
    email: uniqueEmail('rider2'),
    password: 'TestPass123',
    termsAccepted: true,
  });
  await secondRiderClient.put('/api/rider/profile', {
    name: 'Second Rider',
    phone: '+91 98111 33333',
    vehicleType: 'Bike',
    vehicleNumber: 'DL 3C CD 5678',
  });
  const claimedAgain = await secondRiderClient.post(`/api/rider/jobs/${mainJobId}/claim`);
  assert.equal(claimedAgain.status, 409);
  assert.equal(claimedAgain.body.code, 'already_claimed');

  const riderDetail = await demoRider.get(`/api/rider/jobs/${mainJobId}`);
  assert.equal(riderDetail.body.job.drop.address.length > 0, true, 'owner sees the drop address after claiming');
  assert.equal('pickupCode' in riderDetail.body.job, false, 'rider never receives either handoff code');

  const wrongPickup = await demoRider.post(`/api/rider/jobs/${mainJobId}/verify-pickup`, { pickupCode: 'PK-0000' });
  assert.ok([400, 429].includes(wrongPickup.status), 'wrong pickup code must be rejected');

  const pickup = await demoRider.post(`/api/rider/jobs/${mainJobId}/verify-pickup`, { pickupCode: mainPickupCode });
  assert.equal(pickup.status, 200, JSON.stringify(pickup.body));

  const afterPickup = await demoCustomer.get(`/api/customer/orders/${mainOrderId}`);
  assert.equal(afterPickup.body.order.status, 'out_for_delivery');
  assert.equal(afterPickup.body.order.rider.name, 'Arjun Kumar');

  const wrongDelivery = await demoRider.post(`/api/rider/jobs/${mainJobId}/verify-delivery`, {
    deliveryCode: mainPickupCode,
  });
  assert.ok([400, 429].includes(wrongDelivery.status), 'pickup code must not complete the delivery');

  const delivery = await demoRider.post(`/api/rider/jobs/${mainJobId}/verify-delivery`, {
    deliveryCode: mainDeliveryCode,
  });
  assert.equal(delivery.status, 200, JSON.stringify(delivery.body));

  const delivered = await demoCustomer.get(`/api/customer/orders/${mainOrderId}`);
  assert.equal(delivered.body.order.status, 'delivered');
  assert.ok(delivered.body.order.deliveredAt, 'deliveredAt must be stamped');

  const sellerFinal = await demoSeller.get(`/api/seller/orders/${mainOrderId}`);
  assert.equal(sellerFinal.body.order.status, 'delivered');

  const earnings = await demoRider.get('/api/rider/earnings');
  assert.ok(earnings.body.summary.totalEarnings >= 40, 'rider must be paid for the delivery');
  const history = await demoRider.get('/api/rider/history');
  assert.ok(
    history.body.jobs.some((row: any) => row.jobId === mainJobId && row.jobStatus === 'completed'),
    'completed job must appear in rider history'
  );
});

await suite.test('repeated wrong handoff codes are rate-limited', async () => {
  const addresses = await demoCustomer.get('/api/customer/addresses');
  const checkout = await demoCustomer.post('/api/customer/checkout', {
    items: [{ productId: 'prod_tata_salt', quantity: 1 }],
    fulfilmentType: 'delivery',
    addressId: addresses.body.addresses[0].id,
    paymentMethod: 'cod',
    idempotencyKey: `chk_attempts_${Date.now()}`,
  });
  assert.equal(checkout.status, 201);
  const orderId = checkout.body.orders[0].id;

  for (const status of ['accepted', 'preparing', 'packed', 'ready_for_pickup']) {
    const step = await demoSeller.post(`/api/seller/orders/${orderId}/status`, { status });
    assert.equal(step.status, 200);
  }

  const secondRider = secondRiderClient;

  const available = await secondRider.get('/api/rider/jobs/available');
  const job = available.body.jobs.find((row: any) => row.orderId === orderId);
  assert.ok(job, 'second rider should see the new job');
  assert.equal((await secondRider.post(`/api/rider/jobs/${job.jobId}/claim`)).status, 200);

  const statuses: number[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await secondRider.post(`/api/rider/jobs/${job.jobId}/verify-pickup`, { pickupCode: 'PK-0001' });
    statuses.push(response.status);
    if (response.status === 429) break;
  }
  assert.ok(statuses.includes(429), `expected a 429 after repeated wrong codes, saw ${statuses.join(',')}`);

  const order = await demoCustomer.get(`/api/customer/orders/${orderId}`);
  assert.equal(order.body.order.status, 'ready_for_pickup', 'locked job must not advance');
});

/* -------------------------------------------------------------------------- */
/* First-visit authentication: phone login, recovery, seller signup with store */
/* -------------------------------------------------------------------------- */

await suite.test('customers can sign in with their phone number instead of their email', async () => {
  const client = server.client();
  const response = await client.post('/api/auth/login', {
    email: '+91 98765 43210',
    password: 'NearBuy@2026',
    expectedRole: 'customer',
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.user.email, 'customer.demo@nearbuy.app');
});

await suite.test('account recovery never reveals whether an account exists', async () => {
  const client = server.client();
  const known = await client.post('/api/auth/recover', { identifier: 'customer.demo@nearbuy.app' });
  const unknown = await client.post('/api/auth/recover', { identifier: 'nobody.here@example.com' });
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  const message = 'If an account matches the information provided, recovery instructions will be sent.';
  assert.equal(known.body.message, message);
  assert.equal(unknown.body.message, message);
  assert.ok(known.body.demoResetPath, 'demo mode exposes a controlled reset path for the demo flow');
  assert.equal(unknown.body.demoResetPath, undefined, 'unknown identifiers must not get a reset path');
});

await suite.test('password reset tokens are single-use and revoke every session', async () => {
  const client = server.client();
  const requested = await client.post('/api/auth/recover', { identifier: 'customer.demo@nearbuy.app' });
  const token = String(requested.body.demoResetPath).split('token=')[1];
  assert.ok(token, 'demo reset path must contain a token');

  // Unknown tokens are rejected with a generic error.
  const badToken = await client.post('/api/auth/reset', { token: 'not-a-real-token', password: 'NewPass123' });
  assert.equal(badToken.status, 400);
  assert.equal(badToken.body.code, 'invalid_reset_token');

  // A valid session exists before the reset.
  await loginOk(client, 'customer.demo@nearbuy.app', 'NearBuy@2026', 'customer');
  assert.equal((await client.get('/api/auth/me')).status, 200);

  const reset = await client.post('/api/auth/reset', { token, password: 'NearBuy@2027' });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body.message, 'Your password has been updated successfully.');

  // Every existing session was revoked after the password change.
  assert.equal((await client.get('/api/auth/me')).status, 401);

  // Old password no longer works; the new one does.
  const oldPassword = await client.post('/api/auth/login', {
    email: 'customer.demo@nearbuy.app',
    password: 'NearBuy@2026',
  });
  assert.equal(oldPassword.status, 401);
  const newPassword = await client.post('/api/auth/login', {
    email: 'customer.demo@nearbuy.app',
    password: 'NearBuy@2027',
  });
  assert.equal(newPassword.status, 200);

  // The token cannot be reused.
  const reused = await client.post('/api/auth/reset', { token, password: 'AnotherPass1' });
  assert.equal(reused.status, 400);
  assert.equal(reused.body.code, 'invalid_reset_token');

  // Restore the demo password so later suites see the documented credentials.
  const restoreRequested = await client.post('/api/auth/recover', { identifier: 'customer.demo@nearbuy.app' });
  const restoreToken = String(restoreRequested.body.demoResetPath).split('token=')[1];
  const restore = await client.post('/api/auth/reset', { token: restoreToken, password: 'NearBuy@2026' });
  assert.equal(restore.status, 200);
  await loginOk(server.client(), 'customer.demo@nearbuy.app', 'NearBuy@2026', 'customer');
});

await suite.test('expired reset tokens are rejected with the same generic error', async () => {
  const client = server.client();
  const requested = await client.post('/api/auth/recover', { identifier: 'rider.demo@nearbuy.app' });
  const token = String(requested.body.demoResetPath).split('token=')[1];

  // Force-expire outstanding reset tokens directly in the database.
  db.prepare(`UPDATE password_reset_tokens SET expires_at = ?`).run(
    new Date(Date.now() - 60_000).toISOString()
  );

  const response = await client.post('/api/auth/reset', { token, password: 'AnotherPass1' });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'invalid_reset_token');
});

await suite.test('seller signup creates the store in the same transaction', async () => {
  const client = server.client();
  const email = uniqueEmail('storefront');
  const registered = await client.post('/api/auth/register', {
    role: 'seller',
    name: 'Storefront Seller',
    email,
    phone: '+91 98199 11223',
    password: 'TestPass123',
    store: {
      name: 'Green Basket Bazaar',
      category: 'Grocery',
      address: 'Shop 3, Community Centre, Sector 9',
      city: 'Dwarka, New Delhi',
      state: 'Delhi',
      pincode: '110077',
      opensAt: '08:00',
      closesAt: '21:00',
      operatingDays: 'Mon-Sat',
    },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  assert.equal(registered.body.user.role, 'seller');

  // Signup creates an owned draft. The seller previews before publishing.
  const store = await client.get('/api/seller/store');
  assert.equal(store.status, 200);
  assert.equal(store.body.store.name, 'Green Basket Bazaar');
  assert.equal(store.body.store.status, 'inactive');
  assert.equal(store.body.store.is_published, 0);
  assert.equal(store.body.store.published_at, null);
  const preview = await client.get('/api/seller/store/preview');
  assert.equal(preview.body.store.name, 'Green Basket Bazaar');
  assert.equal((await client.post('/api/seller/store/publish')).status, 200);

  // Discovery lists the store only after explicit publication.
  const discovery = await server.client().get('/api/customer/stores?query=Green%20Basket');
  assert.ok(discovery.body.stores.some((row: any) => row.name === 'Green Basket Bazaar'));
});

await suite.test('customer signup requires the terms acceptance', async () => {
  const client = server.client();
  const response = await client.post('/api/auth/register', {
    role: 'customer',
    name: 'Terms Refuser',
    email: uniqueEmail('terms'),
    password: 'TestPass123',
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'terms_required');
});

/* -------------------------------------------------------------------------- */
/* Persistence across restart                                                 */
/* -------------------------------------------------------------------------- */

await suite.test('status, orders and sessions survive a full server restart (disk persistence)', async () => {
  const databaseFile = server.databaseFile;
  await server.close({ keepDatabase: true });

  const restarted = await launchServer('api-restarted', { databaseFile, seed: false });
  try {
    const fresh = restarted.client();
    await loginOk(fresh, 'customer.demo@nearbuy.app', 'NearBuy@2026', 'customer');
    const order = await fresh.get(`/api/customer/orders/${mainOrderId}`);
    assert.equal(order.status, 200);
    assert.equal(order.body.order.status, 'delivered', 'order state must survive a restart');

    const rider = restarted.client();
    await loginOk(rider, 'rider.demo@nearbuy.app', 'NearBuy@2026', 'rider');
    const history = await rider.get('/api/rider/history');
    assert.ok(history.body.jobs.some((row: any) => row.jobId === mainJobId && row.jobStatus === 'completed'));

    // Verify the row really is on disk, read by an independent process.
    const script = `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(${JSON.stringify(databaseFile)}, { readOnly: true });
      const row = db.prepare("SELECT status, delivery_code, pickup_code FROM orders WHERE id = ?").get(${JSON.stringify(mainOrderId)});
      console.log(JSON.stringify(row));
      db.close();
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    const onDisk = JSON.parse(output.trim());
    assert.equal(onDisk.status, 'delivered');
    assert.match(onDisk.delivery_code, /^DL-\d{4}$/);
    assert.match(onDisk.pickup_code, /^PK-\d{4}$/);
  } finally {
    await restarted.close();
  }
});

suite.summary();
