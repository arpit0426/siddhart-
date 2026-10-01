/**
 * Full-stack render test: mounts the REAL React app in a DOM and lets it talk to
 * the REAL Express server + SQLite database (no stubbed network). Every route of
 * every portal is rendered as the right role; the test fails if any page shows an
 * error state, triggers an unexpected 4xx/5xx API call, or logs a React error.
 */
import assert from 'node:assert/strict';

const nodeFetch = globalThis.fetch.bind(globalThis);
const { GlobalRegistrator } = await import('@happy-dom/global-registrator');
GlobalRegistrator.register({ url: 'http://localhost/' });

const { createSuite, launchServer } = await import('./harness.js');
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const App = (await import('../../src/App')).default;

const suite = createSuite('Live full-stack render tests');
const server = await launchServer('live');

let cookie = '';
const apiFailures: string[] = [];
const consoleErrors: string[] = [];

(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  // Absolute URLs come from the test harness clients, which manage their own session.
  if (url.startsWith('http')) return nodeFetch(input, init);
  const target = url.startsWith('http') ? url : `${server.baseUrl}${url}`;
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  const response = await nodeFetch(target, { ...init, headers });
  for (const set of (response.headers as any).getSetCookie?.() ?? []) {
    const m = /^nb_session=([^;]*)/.exec(set);
    if (m) cookie = m[1] ? `nb_session=${m[1]}` : '';
  }
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  const expected = path.startsWith('/api/auth/session') || path.startsWith('/api/auth/me');
  if (response.status >= 400 && !expected) {
    apiFailures.push(`${init.method ?? 'GET'} ${path} -> ${response.status}`);
  }
  return response;
};
(globalThis as any).scrollTo = () => {};
window.scrollTo = (() => {}) as any;
const realError = console.error;
console.error = (...args: any[]) => {
  consoleErrors.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ').slice(0, 300));
};

const api = server.client();
async function signIn(role: 'customer' | 'seller' | 'rider') {
  const c = server.client();
  const res = await c.loginAsDemo(role);
  assert.equal(res.status, 200);
  cookie = `nb_session=${encodeURIComponent(c.sessionValue()!)}`;
  return c;
}

const ERROR_TEXT = /Something went wrong|Request failed|API endpoint not found|Cannot read|undefined|NaN|\[object Object\]|Back to home/;

async function renderRoute(path: string) {
  apiFailures.length = 0;
  consoleErrors.length = 0;
  window.history.pushState({}, '', path);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(React.createElement(App));
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 50));
    if (i > 4 && !/Loading|Spinner/.test(container.textContent ?? '') && container.querySelector('h1,h2')) break;
  }
  const text = container.textContent ?? '';
  const result = { text, finalPath: window.location.pathname, api: [...apiFailures], errors: [...consoleErrors] };
  root.unmount();
  container.remove();
  return result;
}

async function check(path: string, expectText?: RegExp) {
  const r = await renderRoute(path);
  const problems: string[] = [];
  if (ERROR_TEXT.test(r.text)) problems.push(`error text: ${(ERROR_TEXT.exec(r.text) ?? [])[0]}`);
  if (r.api.length) problems.push(`api: ${r.api.join(', ')}`);
  if (r.errors.length) problems.push(`console: ${r.errors.join(' | ')}`);
  if (expectText && !expectText.test(r.text)) problems.push(`missing ${expectText}; got "${r.text.slice(0, 160)}"`);
  if (process.env.LIVE_DEBUG) console.log(path, r.finalPath, r.text.length, JSON.stringify(r.text.slice(0, 140)));
  return problems.length ? `${path}: ${problems.join('; ')}` : null;
}

// Real ids created through the API.
const customerClient = await signIn('customer');
const addresses = await customerClient.get('/api/customer/addresses');
const placed = await customerClient.post('/api/customer/checkout', {
  items: [{ productId: 'prod_amul_taaza', quantity: 1 }],
  fulfilmentType: 'delivery',
  addressId: addresses.body.addresses[0].id,
  paymentMethod: 'cod',
  idempotencyKey: `chk_live_${Date.now()}`,
});
assert.equal(placed.status, 201, JSON.stringify(placed.body));
const orderId = placed.body.orders[0].id as string;
const storeId = placed.body.orders[0].store?.id ?? (await customerClient.get('/api/customer/stores')).body.stores[0].id;
await customerClient.post('/api/customer/cart/items', { productId: 'prod_tata_salt', quantity: 1 });
const sellerProducts = await (await signIn('seller')).get('/api/seller/products');
const sellerProductId = sellerProducts.body.products[0].id as string;
await signIn('customer');

await suite.test('customer portal: every page renders real data without errors', async () => {
  await signIn('customer');
  const routes: [string, RegExp?][] = [
    ['/customer', /Shop by category/],
    ['/discover'],
    ['/discover/stores'],
    [`/stores/${storeId}`, /Dwarka Fresh Mart/],
    ['/products/prod_amul_taaza', /Amul Taaza/],
    ['/customer/saved'],
    ['/cart', /Your cart/],
    ['/checkout', /heckout/],
    ['/orders', /orders/i],
    [`/orders/${orderId}`, /NB-/],
    ['/requests'],
    ['/account', /account/i],
    ['/customer/notifications'],
    ['/customer/support'],
    ['/customer/security'],
  ];
  const bad = (await Promise.all([])).length; void bad;
  const failures: string[] = [];
  for (const [path, text] of routes) {
    const f = await check(path, text);
    if (f) failures.push(f);
  }
  assert.equal(failures.length, 0, '\n' + failures.join('\n'));
});

await suite.test('seller portal: every page renders real data without errors', async () => {
  const seller = await signIn('seller');
  const sellerOrders = await seller.get('/api/seller/orders');
  const sellerOrderId = sellerOrders.body.orders[0].id as string;
  const routes: [string, RegExp?][] = [
    ['/seller/dashboard', /Needs Your Attention/],
    ['/seller', /Needs Your Attention/],
    ['/seller/orders', /Orders/],
    [`/seller/orders/${sellerOrderId}`, /NB-/],
    ['/seller/products', /Products/],
    ['/seller/products/new', /Add a product/],
    [`/seller/products/${sellerProductId}`, /Edit product/],
    ['/seller/inventory', /Inventory/],
    ['/seller/requests'],
    ['/seller/store', /Store settings/],
    ['/seller/earnings', /Earnings/],
    ['/seller/performance'],
    ['/seller/notifications'],
    ['/seller/support'],
    ['/seller/security'],
    ['/seller/stock-requests', /Stock requests/],
    ['/seller/reservations', /Reservations/],
    ['/seller/analytics', /Performance/],
    ['/seller/profile', /Edit Profile/],
    ['/seller/business', /Business Profile/],
    ['/seller/settings', /Settings/],
    ['/seller/settings/security'],
  ];
  const failures: string[] = [];
  for (const [path, text] of routes) {
    const f = await check(path, text);
    if (f) failures.push(f);
  }
  assert.equal(failures.length, 0, '\n' + failures.join('\n'));
});

await suite.test('rider portal: every page renders real data without errors', async () => {
  const rider = await signIn('rider');
  void rider;
  await server.client(); // keep lint quiet
  const routes: [string, RegExp?][] = [
    ['/rider', /online|offline/i],
    ['/rider/jobs'],
    ['/rider/active'],
    ['/rider/history', /history/i],
    ['/rider/earnings', /arnings/],
    ['/rider/profile', /rofile/],
    ['/rider/notifications'],
    ['/rider/support'],
    ['/rider/security'],
  ];
  const failures: string[] = [];
  for (const [path, text] of routes) {
    const f = await check(path, text);
    if (f) failures.push(f);
  }
  assert.equal(failures.length, 0, '\n' + failures.join('\n'));
});

void api;
console.error = realError;
suite.summary();
await server.close();
process.exit(process.exitCode ?? 0);
