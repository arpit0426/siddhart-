/**
 * Post-login workspace entry (regression guard).
 *
 * Every login through a portal login page must open the signed-in user's own
 * workspace cleanly — no role-gate screens, no stale redirect targets, no
 * error states, no unexpected API failures. Drives the REAL React app from the
 * auth gateway / role login pages against the REAL server and fails the moment
 * anything looks like a hurdle.
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

const suite = createSuite('Post-login workspace entry tests');
const server = await launchServer('postlogin');

let cookie = '';
const apiFailures: string[] = [];
const consoleErrors: string[] = [];

(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('http')) return nodeFetch(input, init);
  const target = `${server.baseUrl}${url}`;
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (cookie) headers.Cookie = cookie;
  const response = await nodeFetch(target, { ...init, headers });
  for (const set of (response.headers as any).getSetCookie?.() ?? []) {
    const m = /^nb_session=([^;]*)/.exec(set);
    if (m) cookie = m[1] ? `nb_session=${m[1]}` : '';
  }
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  const expected = path.startsWith('/api/auth/session') || path.startsWith('/api/auth/me') || path.startsWith('/api/auth/login');
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function resetBrowserSession() {
  cookie = '';
  setSessionToken(null);
}

function mount(path: string) {
  apiFailures.length = 0;
  consoleErrors.length = 0;
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
  const click = async (label: RegExp) => {
    const start = Date.now();
    let el: HTMLElement | undefined;
    while (!el && Date.now() - start < 6000) {
      el = Array.from(container.querySelectorAll('button, a')).find(
        (x) => (label.test((x.textContent ?? '').trim()) || label.test(x.getAttribute('aria-label') ?? '')) && !(x as HTMLButtonElement).disabled
      ) as HTMLElement | undefined;
      if (!el) await sleep(40);
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
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input!.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(40);
  };
  return { text, waitFor, click, type, unmount: () => { root.unmount(); container.remove(); } };
}

const EMAILS = {
  customer: 'customer.demo@nearbuy.app',
  seller: 'seller.demo@nearbuy.app',
  rider: 'rider.demo@nearbuy.app',
} as const;

/* Scenario 1: fresh visitor logs in through each role's login page. */
await suite.test('fresh login through the login page lands in the role workspace', async () => {
  const landing = { customer: /Shop by category/, seller: /Needs Your Attention/, rider: /You are (online|offline)/ } as const;
  for (const role of ['customer', 'seller', 'rider'] as const) {
    resetBrowserSession();
    const app = mount(`/${role}/auth`);
    await app.type(/Email/, EMAILS[role]);
    await app.type(/Password/, 'NearBuy@2026');
    await app.click(/^Login$/);
    await app.waitFor(landing[role]);
    const home = role === 'seller' ? '/seller/dashboard' : `/${role}`;
    assert.equal(window.location.pathname, home, `${role} should land on ${home}, got ${window.location.pathname}`);
    const gate = /This workspace is for|Redirecting to sign in|Something went wrong/i;
    assert.ok(!gate.test(app.text()), `${role} hit a gate after login: ${app.text().slice(0, 200)}`);
    assert.deepEqual([...apiFailures], [], `${role}: unexpected API failures after login`);
    assert.deepEqual([...consoleErrors], [], `${role}: console errors after login`);
    app.unmount();
  }
});

/* Scenario 2: login with a stale ?next pointing at ANOTHER role's workspace. */
await suite.test('login with cross-role ?next still reaches the signed-in user\'s own workspace', async () => {
  resetBrowserSession();
  const app = mount('/customer/auth?next=%2Fseller');
  await app.type(/Email/, EMAILS.customer);
  await app.type(/Password/, 'NearBuy@2026');
  await app.click(/^Login$/);
  await app.waitFor(/Shop by category/);
  assert.equal(window.location.pathname, '/customer', 'customer must land in the customer workspace');
  assert.ok(!/This workspace is for/.test(app.text()), 'no role gate may appear after login');
  assert.deepEqual([...apiFailures], [], 'no unexpected API failures');
  assert.deepEqual([...consoleErrors], [], 'no console errors');
  app.unmount();
});

/* Scenario 3: login with ?next pointing at another role's auth page. */
await suite.test('login with auth-page ?next lands in the workspace, not another login screen', async () => {
  resetBrowserSession();
  const app = mount('/customer/auth?next=%2Fseller%2Fauth');
  await app.type(/Email/, EMAILS.customer);
  await app.type(/Password/, 'NearBuy@2026');
  await app.click(/^Login$/);
  await app.waitFor(/Shop by category/);
  assert.equal(window.location.pathname, '/customer');
  assert.ok(!/already signed in as/i.test(app.text()), 'no signed-in-elsewhere error note after login');
  app.unmount();
});

/* Scenario 3b: garbage ?next must not dump the user on a 404 after login. */
await suite.test('login with unknown ?next lands in the workspace instead of a 404', async () => {
  resetBrowserSession();
  const app = mount('/customer/auth?next=%2Fdoes-not-exist');
  await app.type(/Email/, EMAILS.customer);
  await app.type(/Password/, 'NearBuy@2026');
  await app.click(/^Login$/);
  await app.waitFor(/Shop by category/);
  assert.equal(window.location.pathname, '/customer');
  app.unmount();
});

/* Scenario 4: gateway "Enter as demo" one-click entry. */
await suite.test('gateway demo entry opens the customer workspace', async () => {
  resetBrowserSession();
  const app = mount('/');
  await app.click(/Enter as demo/i);
  await app.waitFor(/Shop by category/);
  assert.equal(window.location.pathname, '/customer');
  assert.deepEqual([...apiFailures], [], 'gateway demo: unexpected API failures');
  assert.deepEqual([...consoleErrors], [], 'gateway demo: console errors');
  app.unmount();
});

/* Scenario 5: cart badge in the header reflects the real cart after login. */
await suite.test('cart badge shows the item count after login', async () => {
  resetBrowserSession();
  const c = server.client();
  assert.equal((await c.loginAsDemo('customer')).status, 200);
  await c.del('/api/customer/cart/clear');
  const add = await c.post('/api/customer/cart/items', { productId: 'prod_amul_taaza', quantity: 2 });
  assert.equal(add.status, 200);
  cookie = `nb_session=${encodeURIComponent(c.sessionValue()!)}`;

  const app = mount('/customer');
  await app.waitFor(/Shop by category/);
  await sleep(800);
  const cartLabel = document.querySelector('[aria-label^="Cart"]')?.getAttribute('aria-label') ?? '';
  assert.ok(/Cart, 2 items/.test(cartLabel), `expected "Cart, 2 items", got "${cartLabel}"`);
  await c.del('/api/customer/cart/clear');
  app.unmount();
});

/* Scenario 6: logout then login again — the workspace opens fresh, no errors. */
await suite.test('sign out then sign back in reopens the workspace cleanly', async () => {
  resetBrowserSession();
  const app = mount('/customer/auth');
  await app.type(/Email/, EMAILS.customer);
  await app.type(/Password/, 'NearBuy@2026');
  await app.click(/^Login$/);
  await app.waitFor(/Shop by category/);

  // Sign out through the header account menu (retry: the menu toggle is a
  // stateful dropdown and a re-render between find and click can swallow it).
  const start = Date.now();
  while (!/Sign out/.test(app.text()) && Date.now() - start < 6000) {
    await app.click(/Aarav Sharma/);
    await sleep(120);
  }
  await app.click(/Sign out/);
  await app.waitFor(/Choose your role to continue/);
  assert.equal(window.location.pathname, '/');

  // And straight back in.
  await app.click(/Enter as demo/i);
  await app.waitFor(/Shop by category/);
  assert.equal(window.location.pathname, '/customer');
  assert.deepEqual([...apiFailures], [], 're-login: unexpected API failures');
  assert.deepEqual([...consoleErrors], [], 're-login: console errors');
  app.unmount();
});

/* Scenario 7: seller login opens the dedicated seller workspace with real data. */
await suite.test('seller login opens the seller workspace shell without errors', async () => {
  resetBrowserSession();
  const app = mount('/seller/auth?next=%2Fseller');
  await app.type(/Email/, EMAILS.seller);
  await app.type(/Password/, 'NearBuy@2026');
  await app.click(/^Login$/);
  await app.waitFor(/Needs Your Attention/);
  assert.equal(window.location.pathname, '/seller/dashboard');
  await sleep(600);
  const text = app.text();
  for (const label of ['Dashboard', 'Orders', 'Products', 'Inventory', 'Reservations', 'Stock Requests', 'Analytics', 'Earnings', 'Logout', 'Dwarka Fresh Mart', "Today's Orders", "Today's Sales", 'Pending Orders', 'Live Orders']) {
    assert.ok(text.includes(label), `seller workspace should show "${label}"`);
  }
  assert.ok(/Good (morning|afternoon|evening), Rahul/.test(text), 'greets the seller by first name');
  assert.ok(document.querySelector('aside nav[aria-label="Seller workspace"]'), 'desktop sidebar present');
  assert.ok(document.querySelector('nav[aria-label="Seller quick navigation"]'), 'mobile bottom navigation present');
  assert.ok(!/This workspace is for|Redirecting to sign in|Something went wrong|couldn't load/i.test(text), 'no gate or error state');
  assert.deepEqual([...apiFailures], [], 'seller: unexpected API failures after login');
  assert.deepEqual([...consoleErrors], [], 'seller: console errors after login');
  app.unmount();
});

/* Scenario 8: every seller page opens cleanly; logout and demo re-entry work. */
await suite.test('every seller page opens cleanly and seller can log out and back in', async () => {
  resetBrowserSession();
  const app = mount('/seller/auth');
  await app.click(/Use Demo Account/);
  await app.waitFor(/Needs Your Attention/);
  assert.equal(window.location.pathname, '/seller/dashboard');
  apiFailures.length = 0;
  const { navigate } = await import('../../src/lib/router');
  const pages: [string, RegExp][] = [
    ['/seller/orders', /Search order ID/],
    ['/seller/products', /Products/],
    ['/seller/inventory', /Inventory/],
    ['/seller/reservations', /Reservations/],
    ['/seller/stock-requests', /Stock requests/],
    ['/seller/store', /Store settings/],
    ['/seller/analytics', /Performance/],
    ['/seller/earnings', /Earnings|Gross/],
    ['/seller/notifications', /Notifications/],
    ['/seller/support', /Support|Help/],
    ['/seller/profile', /Edit Profile/],
    ['/seller/business', /Business Profile/],
    ['/seller/settings', /Manage your store, account and security/],
    ['/seller/settings/security', /Security|Password/],
    ['/seller', /Needs Your Attention/],
  ];
  for (const [path, pattern] of pages) {
    navigate(path);
    await app.waitFor(pattern);
    assert.ok(!/This workspace is for|Page not found|couldn't load/i.test(app.text()), `${path}: gate or error shown`);
  }
  assert.equal(window.location.pathname, '/seller/dashboard', 'bare /seller resolves to the dashboard');
  assert.deepEqual([...apiFailures], [], 'seller pages: unexpected API failures');

  await app.click(/^Logout$/);
  await app.waitFor(/Choose your role to continue/);
  assert.equal(window.location.pathname, '/');
  app.unmount();
});

console.error = realError;
suite.summary();
await server.close();
process.exit(process.exitCode ?? 0);
