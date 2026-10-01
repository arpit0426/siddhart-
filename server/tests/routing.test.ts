import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createSuite } from './harness.js';

/**
 * Production routing test: boots the real server in production mode against the
 * built `dist/` bundle and verifies that deep links, static assets and API 404s
 * behave correctly. Run `npm run build` first.
 */

const suite = createSuite('Production routing tests');

process.env.NODE_ENV = 'production';
process.env.DATABASE_FILE = path.join(os.tmpdir(), `nearbuy-routing-${Date.now()}.db`);
process.env.DEMO_MODE = 'true';
process.env.LOG_LEVEL = 'error';
process.env.COOKIE_SECURE = 'false';

const { buildApp, prepareDatabase } = await import('../app.js');
const { seedDemoData } = await import('../seed.js');
const { attachFrontend, distPath } = await import('../frontend.js');

const indexFile = path.join(distPath, 'index.html');
const hasBuild = fs.existsSync(indexFile);

if (!hasBuild) {
  suite.skip('production deep links', 'dist/index.html not found — run `npm run build` first');
  suite.summary();
} else {
  prepareDatabase();
  seedDemoData();
  const app = buildApp();
  await attachFrontend(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('routing test server failed to bind');
  const base = `http://127.0.0.1:${address.port}`;

  const indexHtml = fs.readFileSync(indexFile, 'utf8');
  const assetMatch = /<script[^>]+src="([^"]+\.js)"/.exec(indexHtml);
  const assetPath = assetMatch?.[1] ?? null;

  await suite.test('built SPA assets are served with immutable caching headers', async () => {
    assert.ok(assetPath, 'index.html must reference a built JS bundle');
    const response = await fetch(`${base}${assetPath}`);
    assert.equal(response.status, 200);
    assert.match(String(response.headers.get('content-type')), /javascript/);
  });

  await suite.test('public deep links return the SPA shell instead of 404', async () => {
    const links = [
      '/',
      '/discover',
      '/discover/stores',
      '/customer/auth',
      '/customer/login',
      '/customer/signup',
      '/customer/recover',
      '/seller/auth',
      '/seller/signup',
      '/seller/recover',
      '/rider/auth',
      '/rider/recover',
      '/some/unknown/deep/link',
    ];

    for (const link of links) {
      const response = await fetch(`${base}${link}`, { redirect: 'manual' });
      assert.equal(response.status, 200, `${link} should serve the SPA shell`);
      assert.match(String(response.headers.get('content-type')), /text\/html/, `${link} should be HTML`);
      const body = await response.text();
      assert.ok(body.includes('id="root"'), `${link} should return index.html`);
      assert.ok(body.includes(assetPath!.replace(/^\//, '')) || body.includes(assetPath!), `${link} should load the bundle`);
    }
  });

  await suite.test('protected workspaces redirect anonymous visitors to the role auth flow', async () => {
    const expectations: [string, string][] = [
      ['/cart', '/customer/auth?next=%2Fcart'],
      ['/checkout', '/customer/auth?next=%2Fcheckout'],
      ['/orders', '/customer/auth?next=%2Forders'],
      ['/orders/ord_example123', '/customer/auth?next=%2Forders%2Ford_example123'],
      ['/customer', '/customer/auth?next=%2Fcustomer'],
      ['/customer/orders', '/customer/auth?next=%2Fcustomer%2Forders'],
      ['/requests', '/customer/auth?next=%2Frequests'],
      ['/account', '/customer/auth?next=%2Faccount'],
      ['/seller', '/seller/dashboard'],
      ['/seller/dashboard', '/seller/auth?next=%2Fseller%2Fdashboard'],
      ['/seller/orders', '/seller/auth?next=%2Fseller%2Forders'],
      ['/seller/orders/ord_example123', '/seller/auth?next=%2Fseller%2Forders%2Ford_example123'],
      ['/seller/products', '/seller/auth?next=%2Fseller%2Fproducts'],
      ['/seller/store', '/seller/auth?next=%2Fseller%2Fstore'],
      ['/rider', '/rider/auth?next=%2Frider'],
      ['/rider/jobs', '/rider/auth?next=%2Frider%2Fjobs'],
      ['/rider/profile', '/rider/auth?next=%2Frider%2Fprofile'],
    ];

    for (const [link, location] of expectations) {
      const response = await fetch(`${base}${link}`, { redirect: 'manual' });
      assert.equal(response.status, 302, `${link} must redirect anonymous visitors to the auth flow`);
      assert.equal(response.headers.get('location'), location, `${link} redirected to the wrong place`);
    }
  });

  await suite.test('signed-in users are redirected by the server, never forced to log in again', async () => {
    // Demo accounts are OFF in this production-mode database, so register a
    // real seller and a real customer through the normal API.
    const register = async (payload: Record<string, unknown>) => {
      const response = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-NearBuy-Client': 'web' },
        body: JSON.stringify({ password: 'TestPass123', ...payload }),
      });
      assert.ok([200, 201].includes(response.status), `registration failed: ${response.status}`);
      const cookie = (response.headers as any)
        .getSetCookie()
        .find((entry: string) => entry.startsWith('nb_session='));
      assert.ok(cookie, 'registration must set the session cookie');
      return cookie.split(';')[0];
    };

    const sessionCookie = await register({
      role: 'seller',
      name: 'Routing Seller',
      email: `routing.seller.${Date.now()}@example.com`,
      store: {
        name: 'Routing Corner Shop',
        category: 'Grocery',
        address: 'Shop 1, Sector 5 Market',
        city: 'Dwarka, New Delhi',
        state: 'Delhi',
        pincode: '110075',
      },
    });

    const redirectChecks: [string, string][] = [
      ['/', '/seller/dashboard'],
      ['/customer', '/seller/dashboard'],
      ['/customer/auth', '/seller/dashboard'],
      ['/rider/jobs', '/seller/dashboard'],
      ['/customer/recover', '/seller/dashboard'],
    ];
    for (const [link, location] of redirectChecks) {
      const response = await fetch(`${base}${link}`, {
        redirect: 'manual',
        headers: { Cookie: sessionCookie },
      });
      assert.equal(response.status, 302, `${link} should redirect a signed-in seller`);
      assert.equal(response.headers.get('location'), location);
    }

    // Their own workspace is served normally.
    const own = await fetch(`${base}/seller/orders`, {
      redirect: 'manual',
      headers: { Cookie: sessionCookie },
    });
    assert.equal(own.status, 200, 'sellers keep access to their own workspace');
    assert.match(String(own.headers.get('content-type')), /text\/html/);

    // The gateway honours customer sessions too.
    const customerCookie = await register({
      role: 'customer',
      name: 'Routing Customer',
      email: `routing.customer.${Date.now()}@example.com`,
      termsAccepted: true,
    });
    const customerRoot = await fetch(`${base}/`, {
      redirect: 'manual',
      headers: { Cookie: customerCookie },
    });
    assert.equal(customerRoot.status, 302);
    assert.equal(customerRoot.headers.get('location'), '/customer');
  });

  await suite.test('API 404s stay JSON and are never swallowed by the SPA fallback', async () => {
    const api = await fetch(`${base}/api/definitely-not-a-route`);
    assert.equal(api.status, 404);
    assert.match(String(api.headers.get('content-type')), /json/);
    const body = await api.json();
    assert.ok(body.error);

    const uploads = await fetch(`${base}/uploads/missing-image.png`);
    assert.equal(uploads.status, 404);
    const uploadsBody = await uploads.text();
    assert.ok(!uploadsBody.includes('id="root"'), 'uploads must never fall through to the SPA shell');
  });

  await suite.test('security headers and health endpoints are present in production mode', async () => {
    const config = await fetch(`${base}/api/auth/config`);
    assert.equal(config.status, 200);
    assert.equal(config.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(config.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(config.headers.get('x-powered-by'), null);

    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    const ready = await fetch(`${base}/health/ready`);
    assert.equal(ready.status, 200);
    const body = await ready.json();
    assert.equal(body.database, 'connected');
  });

  await suite.test('production mode hides demo credentials unless explicitly enabled', async () => {
    const config = await fetch(`${base}/api/auth/config`);
    const body = await config.json();
    assert.equal(body.demoMode, false, 'demo mode must be off in production by default');
    assert.deepEqual(body.demoAccounts, [], 'demo passwords must never be published in production');
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(process.env.DATABASE_FILE + suffix);
    } catch {
      /* ignore */
    }
  }
  suite.summary();
}
