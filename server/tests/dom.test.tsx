/**
 * DOM smoke tests (happy-dom).
 *
 * Playwright browsers cannot be downloaded in this sandbox, so these tests are
 * the browser-level compensation: they mount the REAL React application (router,
 * providers, pages) against a stubbed network, then assert what a user would see
 * for anonymous, customer, seller and rider routes — including redirects.
 */
import assert from 'node:assert/strict';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

const { createSuite } = await import('./harness.js');
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const App = (await import('../../src/App')).default;

const suite = createSuite('DOM smoke tests');

/* -------------------------------------------------------------------------- */
/* Stubbed server                                                             */
/* -------------------------------------------------------------------------- */

const DELIVERY_FEE = 30;

const demoAccounts = [
  { role: 'customer', name: 'Aarav Sharma', email: 'customer.demo@nearbuy.app', password: 'NearBuy@2026' },
  { role: 'seller', name: 'Rahul Verma', email: 'seller.demo@nearbuy.app', password: 'NearBuy@2026' },
  { role: 'rider', name: 'Arjun Kumar', email: 'rider.demo@nearbuy.app', password: 'NearBuy@2026' },
];

const store = {
  id: 'store_dwarka_mart_01',
  name: 'Dwarka Fresh Mart',
  description: 'Your neighbourhood store in Sector 12.',
  category: 'Grocery',
  address: 'Shop 14, Sector 12 Market',
  city: 'Dwarka, New Delhi',
  pincode: '110078',
  status: 'open',
  image: '/images/store-dwarka-fresh-mart.jpg',
  openingHours: '07:00 - 22:00 (Mon-Sun)',
  supportsDelivery: true,
  supportsPickup: true,
  distanceKm: 1.2,
  productCount: 5,
};

const product = {
  id: 'prod_amul_taaza',
  name: 'Amul Taaza Milk 1L',
  description: 'Homogenised toned milk.',
  category: 'Dairy',
  price: 68,
  image: '/images/amul-taaza-milk-1l.jpg',
  stock: 20,
  store_id: store.id,
  store_name: store.name,
  store_status: 'open',
  is_published: 1,
};

let currentUser: any = null;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const stubFetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url ?? '';
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  const method = (init?.method ?? (typeof input === 'object' ? input?.method : 'GET') ?? 'GET').toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : {};

  if (path === '/api/auth/config') {
    return json({
      appName: 'NearBuy',
      version: '2.0.0',
      demoMode: true,
      deliveryFeePerStore: DELIVERY_FEE,
      freeDeliveryThreshold: 0,
      demoAccounts,
    });
  }
  if (path === '/api/auth/session') {
    return json({ authenticated: Boolean(currentUser), user: currentUser ?? null });
  }
  if (path === '/api/auth/me') {
    if (!currentUser) return json({ error: 'Not signed in.', code: 'unauthorized' }, 401);
    return json({ user: currentUser });
  }
  if (path === '/api/auth/login' && method === 'POST') {
    const account = demoAccounts.find((entry) => entry.role === body.role) ?? demoAccounts[0];
    currentUser = {
      id: `usr_${account.role}_demo`,
      role: account.role,
      name: account.name,
      email: account.email,
      phone: '+91 98765 43210',
      onboardingCompleted: account.role === 'rider',
    };
    return json({ token: 'stub-token', user: currentUser });
  }
  if (path === '/api/auth/logout') {
    currentUser = null;
    return json({ ok: true });
  }

  if (path.startsWith('/api/customer/products')) {
    if (/\/api\/customer\/products\/[^/?]+$/.test(path)) return json({ product, store, related: [] });
    return json({ products: [product] });
  }
  if (path.startsWith('/api/customer/stores')) {
    if (/\/api\/customer\/stores\/[^/?]+$/.test(path)) return json({ store, products: [product] });
    return json({ stores: [store] });
  }
  if (path === '/api/customer/categories') return json({ categories: [{ category: 'Dairy', count: 1 }, { category: 'Staples & Grains', count: 0 }] });
  if (path === '/api/customer/cart') {
    return json({ cart: { id: 'cart_demo_01' }, items: [], stores: [], subtotal: 0 });
  }
  if (path === '/api/customer/orders') return json({ orders: [] });
  if (/^\/api\/customer\/orders\/[^/?]+$/.test(path)) {
    const now = new Date().toISOString();
    return json({
      order: {
        id: 'ord_example',
        orderNumber: 'NB-260930-0001',
        status: 'out_for_delivery',
        fulfillmentType: 'delivery',
        subtotal: 136,
        deliveryFee: 30,
        total: 166,
        paymentMethod: 'cod',
        createdAt: now,
        updatedAt: now,
        address: { name: 'Aarav Sharma', address: 'Flat 402, Shivani Apartments, Sector 10', city: 'Dwarka, New Delhi', pincode: '110075' },
        items: [
          {
            id: 'oi_1',
            productId: 'prod_amul_taaza',
            name: 'Amul Taaza Milk 1L',
            unitPrice: 68,
            quantity: 2,
            lineTotal: 136,
            image: null,
          },
        ],
        timeline: [{ event_type: 'ORDER_PLACED', actor_role: 'customer', note: 'Order placed', created_at: now }],
        store: { id: store.id, name: store.name, address: store.address, city: store.city, phone: '+91 98111 00000' },
        deliveryCode: 'DL-4321',
        rider: { name: 'Arjun Kumar', phone: '+91 98111 22222', status: 'out_for_delivery' },
        jobStatus: 'out_for_delivery',
      },
    });
  }
  if (path === '/api/customer/addresses') return json({ addresses: [] });
  if (path === '/api/customer/reservations') return json({ reservations: [] });
  if (path === '/api/customer/stock-requests') return json({ requests: [] });
  if (path.startsWith('/api/seller/orders?') || path === '/api/seller/orders') return json({ orders: [], counts: {}, pagination: { page: 1, pageSize: 15, pages: 1, total: 0 } });
  if (path === '/api/seller/dashboard') return json({ store: { ...store, opens_at: '08:00', closes_at: '22:00', is_published: 1 }, metrics: { todayOrders: 0, todayRevenue: 0, pendingOrders: 0, lowStockCount: 0, totalProducts: 1, healthy: 1 }, actionRequired: {}, orderCounts: {}, liveOrders: [], lowStock: [], daily: [], setup: { percent: 100, checks: [] }, unreadNotifications: 0 });
  if (path === '/api/rider/jobs/available') return json({ jobs: [], upcoming: [] });
  if (path === '/api/rider/dashboard') {
    return json({
      rider: { id: 'usr_rider_demo', name: 'Arjun Kumar', onboardingCompleted: true, vehicleType: 'Bike' },
      availableCount: 0,
      availableJobs: [],
      activeJob: null,
      earnings: { completedJobs: 0, total: 0, today: 0 },
    });
  }
  if (path === '/api/rider/history') return json({ jobs: [] });
  if (path === '/api/rider/earnings') return json({ summary: { totalJobs: 0, completedJobs: 0, totalEarnings: 0 }, daily: [] });

  return json({}, 200);
};

(globalThis as any).fetch = stubFetch;
(globalThis as any).scrollTo = () => {};
window.scrollTo = (() => {}) as any;

/* -------------------------------------------------------------------------- */
/* Render helpers                                                             */
/* -------------------------------------------------------------------------- */

async function renderAt(path: string, user: any = null) {
  currentUser = user;
  window.history.pushState({}, '', path);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(React.createElement(App));
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const text = container.textContent ?? '';
  return {
    text,
    path: window.location.pathname,
    cleanup: () => {
      root.unmount();
      container.remove();
    },
  };
}

const customer = {
  id: 'usr_customer_demo_01',
  role: 'customer',
  name: 'Aarav Sharma',
  email: 'customer.demo@nearbuy.app',
  phone: '+91 98765 43210',
};
const seller = { id: 'usr_sell_demo_01', role: 'seller', name: 'Rahul Verma', email: 'seller.demo@nearbuy.app' };
const rider = {
  id: 'usr_rider_demo_01',
  role: 'rider',
  name: 'Arjun Kumar',
  email: 'rider.demo@nearbuy.app',
  onboardingCompleted: true,
};

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

await suite.test('the authentication gateway is the first screen for anonymous visitors', async () => {
  const view = await renderAt('/');
  assert.match(view.text, /What You Need,/);
  assert.match(view.text, /Already Nearby/);
  assert.match(view.text, /Choose your role/);
  for (const role of ['Customer', 'Seller', 'Rider']) {
    assert.match(view.text, new RegExp(role));
  }
  assert.match(view.text, /Login/);
  assert.match(view.text, /Sign Up/);
  assert.match(view.text, /Recover Account/);
  view.cleanup();
});

await suite.test('an authenticated visitor is taken from the gateway to their workspace', async () => {
  const view = await renderAt('/', customer);
  assert.equal(view.path, '/customer', 'signed-in customers should land on /customer');
  view.cleanup();
});

await suite.test('discovery lists server products and stores', async () => {
  const view = await renderAt('/discover');
  assert.match(view.text, /Discover what/);
  assert.match(view.text, /Amul Taaza Milk 1L/);
  assert.match(view.text, /Dwarka Fresh Mart/);
  view.cleanup();

  const storesTab = await renderAt('/discover/stores');
  assert.match(storesTab.text, /Dwarka Fresh Mart/);
  storesTab.cleanup();
});

await suite.test('product and store deep links render their detail pages', async () => {
  const productView = await renderAt('/products/prod_amul_taaza');
  assert.match(productView.text, /Amul Taaza Milk 1L/);
  assert.match(productView.text, /68/);
  productView.cleanup();

  const storeView = await renderAt(`/stores/${store.id}`);
  assert.match(storeView.text, /Dwarka Fresh Mart/);
  assert.match(storeView.text, /Available products/);
  storeView.cleanup();
});

await suite.test('role auth pages offer login, demo account, signup and recovery', async () => {
  for (const role of ['customer', 'seller', 'rider']) {
    const view = await renderAt(`/${role}/auth`);
    assert.match(view.text, role === 'seller' ? /NearBuy Seller/ : new RegExp(`${role} login`, 'i'));
    assert.match(view.text, /Forgot Password\?/);
    assert.match(view.text, new RegExp(`Create ${role.charAt(0).toUpperCase() + role.slice(1)} Account`));
    assert.match(view.text, /Use Demo Account/);
    assert.match(view.text, /Recover Account|Forgot Password/);
    view.cleanup();
  }
});

await suite.test('legacy /:role/login links redirect into the /:role/auth flow', async () => {
  const view = await renderAt('/customer/login');
  assert.equal(view.path, '/customer/auth');
  view.cleanup();
});

await suite.test('role signup pages render the role-specific fields', async () => {
  const customerView = await renderAt('/customer/signup');
  assert.match(customerView.text, /Create your customer account/);
  assert.match(customerView.text, /accept the NearBuy .*terms/);
  customerView.cleanup();

  const sellerView = await renderAt('/seller/signup');
  assert.match(sellerView.text, /Your store/);
  assert.match(sellerView.text, /Store name/);
  assert.match(sellerView.text, /Operating days/);
  sellerView.cleanup();

  const riderView = await renderAt('/rider/signup');
  assert.match(riderView.text, /Address \/ location/);
  assert.match(riderView.text, /Vehicle type/);
  riderView.cleanup();
});

await suite.test('recovery pages offer request and reset steps', async () => {
  const view = await renderAt('/customer/recover');
  assert.match(view.text, /Recover Account/);
  assert.match(view.text, /Request recovery/);
  view.cleanup();

  const resetView = await renderAt('/seller/recover?token=demo-token');
  assert.match(resetView.text, /New password/);
  resetView.cleanup();
});

await suite.test('guarded routes redirect anonymous visitors to the right auth flow', async () => {
  for (const [path, expected] of [
    ['/cart', '/customer/auth'],
    ['/orders', '/customer/auth'],
    ['/customer', '/customer/auth'],
    ['/seller/orders', '/seller/auth'],
    ['/rider/jobs', '/rider/auth'],
  ] as const) {
    const view = await renderAt(path);
    assert.equal(view.path, expected, `${path} should redirect to ${expected}`);
    view.cleanup();
  }
});

await suite.test('unknown routes render the 404 page instead of crashing', async () => {
  const view = await renderAt('/this/does/not/exist');
  assert.match(view.text, /Page not found/);
  assert.match(view.text, /Back to discovery/);
  view.cleanup();
});

await suite.test('signed-in customer sees cart, checkout and orders deep links', async () => {
  const cart = await renderAt('/cart', customer);
  assert.match(cart.text, /Your cart is empty/);
  cart.cleanup();

  const orders = await renderAt('/orders/ord_example', customer);
  assert.match(orders.text, /NB-260930-0001/);
  assert.match(orders.text, /DL-4321/);
  orders.cleanup();

  const account = await renderAt('/account', customer);
  assert.match(account.text, /Your account/);
  account.cleanup();
});

await suite.test('signed-in seller sees the order workspace', async () => {
  const view = await renderAt('/seller/orders', seller);
  assert.match(view.text, /Orders/);
  assert.match(view.text, /No orders in this view/);
  view.cleanup();
});

await suite.test('signed-in rider sees available jobs and empty states', async () => {
  const view = await renderAt('/rider/jobs', rider);
  assert.match(view.text, /Available delivery jobs/);
  assert.match(view.text, /Nothing ready for pickup right now/);
  view.cleanup();

  const history = await renderAt('/rider/history', rider);
  assert.match(history.text, /Delivery history/);
  history.cleanup();
});

await suite.test('a customer cannot open the seller workspace (client guard)', async () => {
  const view = await renderAt('/seller/orders', customer);
  assert.match(view.text, /seller account|Sign out/i);
  view.cleanup();
});

await suite.test('pages expose accessible names, labels and image alt text', async () => {
  const pages = ['/', '/discover', '/customer/auth', '/seller/auth', '/rider/auth'];
  for (const page of pages) {
    const view = await renderAt(page);
    const container = document.body.lastElementChild as HTMLElement;

    for (const img of Array.from(container.querySelectorAll('img'))) {
      assert.ok((img.getAttribute('alt') ?? '').trim().length > 0, `${page}: every image needs alt text`);
    }

    for (const button of Array.from(container.querySelectorAll('button'))) {
      const name = (button.textContent ?? '').trim() || button.getAttribute('aria-label') || '';
      assert.ok(name.length > 0, `${page}: every button needs an accessible name`);
    }

    for (const input of Array.from(container.querySelectorAll('input, select, textarea'))) {
      const id = input.getAttribute('id');
      const labelled =
        (id && container.querySelector(`label[for="${id}"]`)) ||
        input.getAttribute('aria-label') ||
        input.closest('label');
      assert.ok(Boolean(labelled), `${page}: form control ${(input as any).name || input.getAttribute('type')} needs a label`);
    }

    assert.ok(container.querySelector('main') || container.querySelector('nav'), `${page}: expect landmarks`);
    view.cleanup();
  }
});

suite.summary();
