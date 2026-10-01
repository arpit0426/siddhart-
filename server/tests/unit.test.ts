import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from '../migrations.js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createSuite } from './harness.js';
import { validatePasswordStrength } from '../config.js';
import { hashPassword, verifyPassword } from '../auth.js';
import { codesMatch, generateHandoffCode, normalizeCode } from '../codes.js';
import { computeSubtotal, deliveryFeeFor, formatInr, orderTotal, toRupees } from '../pricing.js';
import {
  canTransition,
  SELLER_TRANSITIONS,
  assertSellerTransition,
  pickupCodeRevealed,
  statusLabel,
} from '../orderStateMachine.js';
import { rateLimit, resetRateLimits } from '../rateLimit.js';
import { originGuard, setSessionCookie } from '../security.js';

const suite = createSuite('Unit tests');

await suite.test('scrypt password hashing verifies the right password and rejects others', async () => {
  const { hash, salt } = hashPassword('NearBuy@2026');
  assert.equal(verifyPassword('NearBuy@2026', hash, salt), true);
  assert.equal(verifyPassword('nearbuy@2026', hash, salt), false);
  assert.equal(verifyPassword('', hash, salt), false);
  const second = hashPassword('NearBuy@2026');
  assert.notEqual(second.hash, hash, 'each password hash must use a fresh salt');
});

await suite.test('password policy enforces length, case and digits', async () => {
  assert.equal(validatePasswordStrength('NearBuy@2026'), null);
  assert.match(String(validatePasswordStrength('short1A')), /at least 8/);
  assert.match(String(validatePasswordStrength('lowercase1')), /uppercase/);
  assert.match(String(validatePasswordStrength('UPPERCASE1')), /lowercase/);
  assert.match(String(validatePasswordStrength('NoDigitsHere')), /number/);
});

await suite.test('handoff codes are CSPRNG generated and compared safely', async () => {
  const pickup = generateHandoffCode('pickup');
  const delivery = generateHandoffCode('delivery');
  assert.match(pickup, /^PK-\d{4}$/);
  assert.match(delivery, /^DL-\d{4}$/);
  assert.equal(normalizeCode(' pk 12 34 '), 'PK1234');
  assert.equal(codesMatch(pickup.slice(3), pickup), true, 'digits without the prefix should match');
  assert.equal(codesMatch(pickup.toLowerCase(), pickup), true, 'comparison is case-insensitive');
  assert.equal(codesMatch(`pk ${pickup.slice(3)}`, `PK ${pickup.slice(3)}`), true, 'spacing and case ignored');
  const wrongCode = `PK-${pickup.slice(3) === '0000' ? '1111' : '0000'}`;
  assert.equal(codesMatch(wrongCode, pickup), false);
  assert.equal(codesMatch('', pickup), false);
  assert.equal(codesMatch(null, pickup), false);
});

await suite.test('INR money maths is server-computed and rounded to paise', async () => {
  assert.equal(formatInr(68), '₹68');
  assert.equal(formatInr(1234.5), '₹1234.50');
  assert.equal(toRupees(68.005), 68.01);
  const { subtotal, lineTotals } = computeSubtotal([
    { unitPrice: 68, quantity: 2 },
    { unitPrice: 28.5, quantity: 1 },
  ]);
  assert.equal(subtotal, 164.5);
  assert.deepEqual(lineTotals, [136, 28.5]);
  assert.equal(orderTotal(subtotal, deliveryFeeFor({ fulfilmentType: 'delivery', subtotal })), 194.5);
  assert.equal(deliveryFeeFor({ fulfilmentType: 'pickup', subtotal }), 0);
  assert.equal(deliveryFeeFor({ fulfilmentType: 'delivery', subtotal, supportsDelivery: false }), 0);
});

await suite.test('order state machine rejects illegal transitions', async () => {
  assert.equal(canTransition('placed', 'accepted', SELLER_TRANSITIONS), true);
  assert.equal(canTransition('placed', 'preparing', SELLER_TRANSITIONS), false);
  assert.equal(canTransition('placed', 'delivered', SELLER_TRANSITIONS), false, 'sellers cannot deliver');
  assert.equal(canTransition('ready_for_pickup', 'delivered', SELLER_TRANSITIONS), false);
  assert.equal(canTransition('packed', 'ready_for_pickup', SELLER_TRANSITIONS), true);
  assert.throws(() => assertSellerTransition('placed', 'delivered'), /cannot be changed|cannot move/i);
  assert.equal(statusLabel('ready_for_pickup'), 'Ready for Pickup');
  assert.equal(pickupCodeRevealed('packed'), false);
  assert.equal(pickupCodeRevealed('ready_for_pickup'), true);
});

await suite.test('rate limiter blocks once the window budget is exhausted', async () => {
  resetRateLimits();
  const limiter = rateLimit({ windowMs: 60_000, max: 2, keyPrefix: 'unit' });
  const makeRes = () => {
    const headers: Record<string, string> = {};
    return {
      statusCode: 200,
      body: undefined as any,
      setHeader: (key: string, value: string) => {
        headers[key] = value;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.body = payload;
        headers['content-type'] = 'application/json';
        return this;
      },
    } as any;
  };
  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' }, path: '/unit', method: 'POST' } as any;

  let nextCalls = 0;
  limiter(req, makeRes(), () => { nextCalls += 1; });
  limiter(req, makeRes(), () => { nextCalls += 1; });
  const res = makeRes();
  limiter(req, res, () => { nextCalls += 1; });

  assert.equal(nextCalls, 2);
  assert.equal(res.statusCode, 429);
  assert.match(String(res.body.error), /Too many requests/);
  resetRateLimits();
});

function mockRes() {
  const headers: Record<string, string | string[]> = {};
  return {
    statusCode: 200,
    headers,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    append(name: string, value: string) {
      const key = name.toLowerCase();
      const current = headers[key];
      headers[key] = current ? ([] as string[]).concat(current, value) : value;
    },
  };
}

await suite.test('preview sign-in is allowed and the session cookie survives an embedded iframe', async () => {
  let nextCalls = 0;
  const previewReq = {
    method: 'POST',
    path: '/api/auth/login',
    secure: false,
    headers: {
      host: '127.0.0.1:3000',
      origin: 'https://3000-sandbox.e2b.app',
      'x-forwarded-proto': 'https',
    },
  } as any;
  const blocked = mockRes();
  originGuard(previewReq, blocked as any, () => {
    nextCalls += 1;
  });
  assert.equal(nextCalls, 1, 'the embedded preview origin must be able to sign in');
  assert.notEqual(blocked.statusCode, 403);

  const cookieRes = mockRes();
  setSessionCookie(cookieRes as any, 'session-token', new Date(Date.now() + 60_000), previewReq);
  const setCookie = String(cookieRes.headers['set-cookie']);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=None/);
  assert.match(setCookie, /Partitioned/);

  const localRes = mockRes();
  setSessionCookie(
    localRes as any,
    'session-token',
    new Date(Date.now() + 60_000),
    { method: 'POST', secure: false, headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } } as any
  );
  assert.match(String(localRes.headers['set-cookie']), /SameSite=Lax/);
  assert.doesNotMatch(String(localRes.headers['set-cookie']), /Partitioned/);

  let evilCalls = 0;
  const evil = mockRes();
  originGuard(
    { method: 'POST', path: '/api/auth/login', headers: { host: 'localhost:3000', origin: 'https://evil.example' } } as any,
    evil as any,
    () => {
      evilCalls += 1;
    }
  );
  assert.equal(evilCalls, 0);
  assert.equal(evil.statusCode, 403);

  let sameOriginCalls = 0;
  originGuard(
    {
      method: 'POST',
      path: '/api/auth/login',
      headers: {
        host: 'internal:3000',
        origin: 'https://app.example.com',
        'sec-fetch-site': 'same-origin',
      },
    } as any,
    mockRes() as any,
    () => {
      sameOriginCalls += 1;
    }
  );
  assert.equal(sameOriginCalls, 1, 'a same-origin browser fetch must not be blocked by a rewritten Host');
});

await suite.test('demo accounts are gated: off in production, on only when explicitly enabled', async () => {
  const probe = path.resolve(import.meta.dirname, 'demo-gate.probe.ts');
  const tsx = path.resolve(import.meta.dirname, '..', '..', 'node_modules', '.bin', 'tsx');
  const runProbe = (env: Record<string, string>) =>
    JSON.parse(execFileSync(tsx, [probe], { encoding: 'utf8', env: { ...process.env, ...env } }).trim());

  const production = runProbe({ NODE_ENV: 'production', DEMO_MODE: '', ENABLE_DEMO_ACCOUNTS: '' });
  assert.equal(production.isProduction, true);
  assert.equal(production.demoMode, false, 'production must not enable demo accounts implicitly');
  assert.equal(production.cookieSecure, true, 'production cookies must be Secure by default');

  const productionOptIn = runProbe({
    NODE_ENV: 'production',
    ENABLE_DEMO_ACCOUNTS: 'true',
    COOKIE_SECURE: 'false',
  });
  assert.equal(productionOptIn.demoMode, true, 'production may opt in explicitly for staging demos');

  const development = runProbe({ NODE_ENV: 'development', DEMO_MODE: '', ENABLE_DEMO_ACCOUNTS: '' });
  assert.equal(development.demoMode, true, 'development focuses on the demo experience');
});

await suite.test('seller schema upgrade preserves the existing portal records and reservation holds', async () => {
  const fixture = new DatabaseSync(':memory:');
  try {
    for (const migration of migrations.filter((m) => m.id !== '011_seller_workspace')) migration.up(fixture);
    fixture.exec(`
      INSERT INTO users (id,role,name,email,password_hash,password_salt,avatar_url,created_at,updated_at)
        VALUES ('usr_upgrade','seller','Upgrade Seller','upgrade@example.com','fixture_hash','fixture_salt','/images/profile.jpg','2026-09-30','2026-09-30');
      INSERT INTO stores (id,seller_id,name,category,address,city,state,pincode,published_at,legal_name,business_id,created_at,updated_at)
        VALUES ('store_upgrade','usr_upgrade','Upgrade Store','Grocery','Shop 1','Delhi','Delhi','110078','2026-09-30','Saved Legal Name','SAVED-ID','2026-09-30','2026-09-30');
      INSERT INTO products (id,store_id,name,category,price,stock,extra_images,created_at,updated_at)
        VALUES ('prod_upgrade','store_upgrade','Upgrade Product','Grocery',42,7,'["/images/extra.jpg"]','2026-09-30','2026-09-30');
      INSERT INTO inventory (id,product_id,stock_quantity,reserved_quantity,low_stock_threshold,updated_at)
        VALUES ('inv_upgrade','prod_upgrade',7,2,5,'2026-09-30');
      INSERT INTO inventory_events (id,product_id,store_id,type,delta,resulting_stock,note,created_at)
        VALUES ('ie_upgrade','prod_upgrade','store_upgrade','seller_adjustment',2,7,'Saved restock','2026-09-30');
      INSERT INTO support_tickets (id,user_id,role,category,subject,message,created_at)
        VALUES ('ticket_upgrade','usr_upgrade','seller','store','Saved issue','Existing support ticket','2026-09-30');
      INSERT INTO notifications (id,user_id,type,title,body,link,read_at,created_at)
        VALUES ('nt_upgrade','usr_upgrade','inventory','Saved alert','Existing notification','/seller/inventory','2026-09-30','2026-09-30');
      INSERT INTO settlements (id,user_id,role,period_start,period_end,amount,status,created_at)
        VALUES ('set_upgrade','usr_upgrade','seller','2026-09-01','2026-09-30',42,'paid','2026-09-30');
    `);
    migrations.find((m) => m.id === '011_seller_workspace')!.up(fixture);
    const stock = fixture.prepare('SELECT stock_quantity,reserved_quantity,version FROM inventory').get() as any;
    assert.equal(stock.stock_quantity, 7);
    assert.equal(stock.reserved_quantity, 2, 'the migration must not release existing holds');
    assert.equal(stock.version, 0);
    const event = fixture.prepare('SELECT delta,stock_before,stock_after,reason FROM inventory_events').get() as any;
    assert.equal(event.delta, 2);
    assert.equal(event.stock_before, 5);
    assert.equal(event.stock_after, 7);
    assert.equal(event.reason, 'seller_adjustment');
    assert.equal((fixture.prepare('SELECT user_id FROM support_tickets').get() as any).user_id, 'usr_upgrade');
    assert.equal((fixture.prepare('SELECT amount FROM settlements').get() as any).amount, 42);
    assert.equal((fixture.prepare('SELECT legal_name FROM business_profiles').get() as any).legal_name, 'Saved Legal Name');
    assert.equal((fixture.prepare('SELECT read_at FROM seller_notifications WHERE id=?').get('nt_upgrade') as any).read_at, '2026-09-30');
    assert.equal((fixture.prepare('SELECT additional_images FROM products').get() as any).additional_images, '["/images/extra.jpg"]');
    const user = fixture.prepare('SELECT password_hash,profile_image FROM users').get() as any;
    assert.equal(user.password_hash, 'fixture_hash', 'migration must not reset passwords');
    assert.equal(user.profile_image, '/images/profile.jpg');
    assert.equal((fixture.prepare('PRAGMA integrity_check').get() as any).integrity_check, 'ok');
  } finally { fixture.close(); }
});

await suite.test('unremembered embedded-preview sessions use secure browser-session cookies', async () => {
  let cookie = '';
  const res = { append: (_header: string, value: string) => { cookie = value; } };
  setSessionCookie(res as any, 'fixture_session', new Date(Date.now() + 86400000), { headers: { 'x-forwarded-proto': 'https' } } as any, false);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=None/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Partitioned/);
  assert.doesNotMatch(cookie, /Expires=|Max-Age=/, 'remember=false must not make the cookie persistent');
});

suite.summary();
