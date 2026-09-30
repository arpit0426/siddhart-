import assert from 'node:assert/strict';
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

suite.summary();
