/**
 * UI journey test: drives the REAL React app (clicking buttons, typing into
 * fields) against the REAL server and database. Covers the customer, seller and
 * rider flows from the product spec through to DELIVERED and back again.
 */
import assert from 'node:assert/strict';

const nodeFetch = globalThis.fetch.bind(globalThis);
const { GlobalRegistrator } = await import('@happy-dom/global-registrator');
GlobalRegistrator.register({ url: 'http://localhost/' });

const { createSuite, launchServer } = await import('./harness.js');
const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const App = (await import('../../src/App')).default;
const { setSessionToken } = await import('../../src/lib/api');

/** Cookie plus the tab-scoped bearer fallback. Clearing only the cookie leaves the SPA signed in. */
function resetBrowserSession() {
  cookie = '';
  setSessionToken(null);
}

const suite = createSuite('UI journey tests');
const server = await launchServer('ui');
let cookie = '';

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
  return response;
};
(globalThis as any).scrollTo = () => {};
window.scrollTo = (() => {}) as any;
window.confirm = (() => true) as any;
const originalError = console.error;
console.error = () => {};

async function signIn(role: 'customer' | 'seller' | 'rider') {
  const c = server.client();
  assert.equal((await c.loginAsDemo(role)).status, 200);
  cookie = `nb_session=${encodeURIComponent(c.sessionValue()!)}`;
  return c;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mount(path: string) {
  window.history.pushState({}, '', path);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(React.createElement(App));
  const text = () => container.textContent ?? '';
  const waitFor = async (pattern: RegExp, timeout = 6000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (pattern.test(text())) return;
      await sleep(40);
    }
    throw new Error(`Timed out waiting for ${pattern} on ${window.location.pathname}. Page: "${text().slice(0, 300)}"`);
  };
  const findButton = (label: RegExp) => {
    const controls = [...container.querySelectorAll('button'), ...container.querySelectorAll('a')]
      .filter((el) => !(el as HTMLButtonElement).disabled);
    // Prefer the visible operation button over a shell shortcut with the same
    // aria-label (the shortcut opens a separate confirmation dialog).
    return (controls.find((el) => label.test((el.textContent ?? '').trim()))
      ?? controls.find((el) => label.test(el.getAttribute('aria-label') ?? ''))) as HTMLElement | undefined;
  };
  const click = async (label: RegExp) => {
    const start = Date.now();
    let el = findButton(label);
    while (!el && Date.now() - start < 6000) {
      await sleep(40);
      el = findButton(label);
    }
    assert.ok(el, `button ${label} not found on ${window.location.pathname}. Page: "${text().slice(0, 300)}"`);
    el!.click();
    await sleep(60);
  };
  const type = async (label: RegExp, value: string) => {
    const start = Date.now();
    const find = () => {
      const l = Array.from(container.querySelectorAll('label')).find((x) => label.test(x.textContent ?? ''));
      const id = l?.getAttribute('for');
      return (id ? container.querySelector(`#${CSS.escape(id)}`) : l?.querySelector('input,textarea')) as HTMLInputElement | null;
    };
    let input = find();
    while (!input && Date.now() - start < 6000) {
      await sleep(40);
      input = find();
    }
    assert.ok(input, `field ${label} not found`);
    // Happy DOM checks decimal steps with floating-point %, so a valid ₹42
    // incorrectly fails step=0.01. Check paise precision explicitly here and
    // let the normal required/min/max and server validators enforce the rest.
    if (input!.type === 'number' && input!.step === '0.01') {
      const paise = Number(value) * 100;
      assert.ok(Math.abs(paise - Math.round(paise)) < 1e-7, 'money input must use whole paise');
      input!.step = 'any';
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input!.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(40);
  };
  const select = async (label: RegExp, value: string) => {
    const l = Array.from(container.querySelectorAll('label')).find((x) => label.test(x.textContent ?? ''));
    const id = l?.getAttribute('for');
    const field = (id ? container.querySelector(`#${CSS.escape(id)}`) : l?.querySelector('select')) as HTMLSelectElement | null;
    assert.ok(field, `select ${label} not found`);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(field, value);
    field!.dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(60);
  };
  return { text, waitFor, click, type, select, unmount: () => { root.unmount(); container.remove(); } };
}

let orderId = '';
let pickupCode = '';
let deliveryCode = '';

await suite.test('customer: browse, add to cart, check out through the UI', async () => {
  const api = await signIn('customer');
  await api.del('/api/customer/cart/clear');
  const app = mount('/customer');
  await app.waitFor(/Shop by category/);
  app.unmount();

  const product = mount('/products/prod_tata_salt');
  await product.waitFor(/Tata Salt/);
  await product.click(/Add to cart/);
  await product.waitFor(/in cart|Added|cart/i);
  product.unmount();

  const checkout = mount('/checkout');
  await checkout.waitFor(/Place order/);
  await checkout.click(/Place order/);
  await checkout.waitFor(/Order placed successfully/);
  checkout.unmount();

  const orders = await api.get('/api/customer/orders');
  orderId = orders.body.orders[0].id;
  assert.equal(orders.body.orders[0].status, 'placed');
});

await suite.test('seller: accepts, prepares, packs and readies the order through the UI', async () => {
  await signIn('seller');
  const app = mount(`/seller/orders/${orderId}`);
  await app.waitFor(/Accept order/);
  await app.click(/Accept order/);
  await app.waitFor(/Start preparing/);
  await app.click(/Start preparing/);
  await app.waitFor(/Mark packed/);
  await app.click(/Mark packed/);
  await app.waitFor(/Ready for pickup/);
  assert.doesNotMatch(app.text(), /PK-\d{4}/, 'pickup code is hidden until ready');
  await app.click(/^Ready for pickup$/);
  await app.click(/^Reveal$/);
  await app.waitFor(/PK-\d{4}/);
  pickupCode = /PK-\d{4}/.exec(app.text())![0];
  assert.doesNotMatch(app.text(), /DL-\d{4}/, 'seller UI never shows the delivery code');
  app.unmount();
});

await suite.test('rider: goes online, claims, verifies pickup and starts delivery through the UI', async () => {
  await signIn('rider');
  const app = mount('/rider');
  await app.waitFor(/You are (offline|online)/);
  if (/You are offline/.test(app.text())) {
    await app.click(/Go online/);
    await app.waitFor(/You are online/);
  }
  await app.click(/Claim job/);
  await app.waitFor(/Verify pickup|arrived at the store/);
  app.unmount();

  const active = mount('/rider/active');
  await active.click(/arrived at the store/);
  await active.type(/Pickup code/, 'PK-0000');
  await active.click(/^Verify pickup$/);
  await active.waitFor(/code|incorrect|invalid|match/i);
  assert.doesNotMatch(active.text(), new RegExp(pickupCode), 'a wrong code never reveals the right one');
  await active.type(/Pickup code/, pickupCode);
  await active.click(/^Verify pickup$/);
  await active.waitFor(/Pickup verified/);
  await active.click(/^Start delivery$/);
  await active.waitFor(/reached the customer/);
  assert.doesNotMatch(active.text(), /DL-\d{4}/, 'rider never sees the delivery code');
  active.unmount();
});

await suite.test('customer: delivery code appears only now; rider completes with it; Delivered persists', async () => {
  await signIn('customer');
  const view = mount(`/orders/${orderId}`);
  await view.waitFor(/DL-\d{4}/);
  deliveryCode = /DL-\d{4}/.exec(view.text())![0];
  view.unmount();

  await signIn('rider');
  const active = mount('/rider/active');
  await active.click(/reached the customer/);
  await active.type(/Delivery code/, 'DL-0000');
  await active.click(/^Complete delivery$/);
  await sleep(300);
  assert.doesNotMatch(active.text(), new RegExp(deliveryCode));
  await active.type(/Delivery code/, deliveryCode);
  await active.click(/^Complete delivery$/);
  await active.waitFor(/Delivery complete|Delivered|completed/i);
  active.unmount();

  const earnings = mount('/rider/earnings');
  await earnings.waitFor(/Earnings/);
  await earnings.waitFor(/₹40/);
  earnings.unmount();

  const history = mount('/rider/history');
  await history.waitFor(/NB-/);
  history.unmount();

  await signIn('customer');
  const after = mount(`/orders/${orderId}`);
  await after.waitFor(/Delivered/);
  assert.doesNotMatch(after.text(), /DL-\d{4}/, 'used code is no longer displayed');
  after.unmount();

  await signIn('seller');
  const seller = mount(`/seller/orders/${orderId}`);
  await seller.waitFor(/Delivered/);
  seller.unmount();
});

await suite.test('seller UI: adds a product, adjusts stock, closes and reopens the store', async () => {
  const seller = await signIn('seller');
  const name = `UI Test Biscuits ${Date.now()}`;

  const editor = mount('/seller/products/new');
  await editor.waitFor(/Add a product/);
  await editor.type(/Product name/, name);
  await editor.type(/Selling price/, '42');
  await editor.type(/Initial stock/, '12');
  await editor.type(/Brand/, 'UIBrand');
  await editor.click(/^Save & publish$/);
  await editor.waitFor(new RegExp(name));
  editor.unmount();

  const customerApi = server.client();
  await customerApi.loginAsDemo('customer');
  const found = await customerApi.get(`/api/customer/products?query=${encodeURIComponent(name)}`);
  assert.equal(found.body.products.length, 1, 'new product is discoverable by customers');
  assert.equal(found.body.products[0].brand, 'UIBrand');
  const productId = found.body.products[0].id;

  const inventory = mount('/seller/inventory');
  await inventory.waitFor(new RegExp(name));
  const openAdjustment = async () => {
    const row = Array.from(document.querySelectorAll('tr')).find((tr) => (tr.textContent ?? '').includes(name))!;
    (Array.from(row.querySelectorAll('button')).find((b) => /Update|Restock/.test(b.textContent ?? '')) as HTMLElement).click();
    await inventory.waitFor(/Update stock/);
    await sleep(150); // wait for the versioned inventory snapshot, not just the modal title
  };
  await openAdjustment();
  await inventory.select(/Adjustment type/, 'set');
  await inventory.type(/New shelf quantity/, '30');
  await inventory.type(/Adjustment note/, 'UI test restock');
  await inventory.click(/^Save stock update$/);
  await inventory.waitFor(/Stock updated/);
  assert.equal((await seller.get(`/api/seller/products/${productId}`)).body.product.stock_quantity, 30);
  await openAdjustment();
  await inventory.click(/View recent inventory events/);
  await inventory.waitFor(/UI test restock/);
  inventory.unmount();

  await customerApi.post('/api/customer/cart/items', { productId, quantity: 1 });
  const store = mount('/seller/store');
  await store.waitFor(/Store visibility/);
  await store.click(/^Close store$/);
  await store.waitFor(/New checkout is paused/);
  store.unmount();
  const addresses = await customerApi.get('/api/customer/addresses');
  const blocked = await customerApi.post('/api/customer/checkout', {
    items: [{ productId, quantity: 1 }], fulfilmentType: 'delivery', addressId: addresses.body.addresses[0].id,
    paymentMethod: 'cod', idempotencyKey: `chk_ui_closed_${Date.now()}`,
  });
  assert.ok(blocked.status >= 400, 'a closed store refuses new orders');

  const reopen = mount('/seller/store');
  await reopen.click(/^Open store$/);
  await reopen.waitFor(/Your store is open/);
  reopen.unmount();
});

await suite.test('customer UI: saving a product persists across a reload', async () => {
  await signIn('customer');
  const product = mount('/products/prod_amul_taaza');
  await product.waitFor(/Amul Taaza/);
  await product.click(/Save for later/);
  await sleep(300);
  product.unmount();
  const saved = mount('/customer/saved');
  await saved.waitFor(/Amul Taaza/);
  saved.unmount();
});

await suite.test('requests UI: stock check never holds stock, a confirmed reservation does', async () => {
  const sellerApi = await signIn('seller');
  const held = async () =>
    (await sellerApi.get('/api/seller/inventory')).body.inventory.find((p: any) => p.id === 'prod_aashirvaad_atta').reserved_quantity as number;
  const before = await held();

  await signIn('customer');
  const product = mount('/products/prod_aashirvaad_atta');
  await product.waitFor(/Ask the store/);
  await product.click(/Request stock check/);
  await product.click(/^Send request$/);
  await sleep(400);
  await product.click(/Request reservation/);
  await product.click(/^Send request$/);
  await sleep(400);
  product.unmount();

  await signIn('seller');
  const requests = mount('/seller/stock-requests');
  await requests.waitFor(/Confirm available/);
  await requests.click(/Confirm available/);
  await requests.click(/^Send response$/);
  await sleep(500);
  assert.equal(await held(), before, 'confirming a stock check does not reserve stock');
  requests.unmount();
  const reservations = mount('/seller/reservations');
  await reservations.click(/Confirm & reserve stock/);
  await reservations.click(/^Confirm response$/);
  await sleep(500);
  assert.ok((await held()) > before, 'a confirmed reservation holds units');
  reservations.unmount();

  await signIn('customer');
  const mine = mount('/requests');
  await mine.waitFor(/Confirmed/);
  mine.unmount();
});

await suite.test('auth UI: each role signs in with the demo account; wrong passwords are refused', async () => {
  const landing = { customer: /Shop by category/, seller: /Dashboard/, rider: /You are (online|offline)/ } as const;
  for (const role of ['customer', 'seller', 'rider'] as const) {
    resetBrowserSession();
    const emails = { customer: 'customer.demo@nearbuy.app', seller: 'seller.demo@nearbuy.app', rider: 'rider.demo@nearbuy.app' };

    const bad = mount(`/${role}/auth`);
    await bad.type(/Email/, emails[role]);
    await bad.type(/Password/, 'wrong-password-1');
    await bad.click(/^Login$/);
    await bad.waitFor(/invalid|incorrect|Invalid|not match|wrong/i);
    assert.equal(window.location.pathname, `/${role}/auth`);
    bad.unmount();

    resetBrowserSession();
    const good = mount(`/${role}/auth`);
    await good.type(/Email/, emails[role]);
    await good.type(/Password/, 'NearBuy@2026');
    await good.click(/^Login$/);
    await good.waitFor(landing[role]);
    good.unmount();
  }
});

await suite.test('auth UI: a new customer can sign up and is signed straight in', async () => {
  resetBrowserSession();
  const email = `ui.${Date.now()}@example.com`;
  const app = mount('/customer/signup');
  await app.type(/Full name/, 'Test Customer');
  await app.type(/^Email/, email);
  await app.type(/Phone/, '9876501234');
  await app.type(/^Password/, 'TestPass123');
  await app.type(/Confirm password/, 'TestPass123');
  const terms = app.text().match(/terms/i);
  void terms;
  const box = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  if (box && !box.checked) box.click();
  await sleep(60);
  await app.click(/Create|Sign up|Register/i);
  await app.waitFor(/Shop by category/);
  app.unmount();
});

console.error = originalError;
suite.summary();
await server.close();
process.exit(process.exitCode ?? 0);
