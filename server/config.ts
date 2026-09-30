import 'dotenv/config';
import path from 'node:path';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

/**
 * Demo/staging mode.
 *
 * Demo accounts (customer/seller/rider) are seeded into the database only when
 * demo mode is enabled. It defaults to ON outside production and MUST be opted
 * into explicitly in production via ENABLE_DEMO_ACCOUNTS=true.
 */
const demoMode = isProduction
  ? bool(process.env.ENABLE_DEMO_ACCOUNTS, false)
  : bool(process.env.DEMO_MODE, true);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  appName: 'NearBuy',
  version: '2.0.0',
  nodeEnv,
  isProduction,
  port: num(process.env.PORT, 3000),
  appUrl: process.env.APP_URL || '',
  /** SQLite database file. Overridable so tests can use throwaway databases. */
  databaseFile: process.env.DATABASE_FILE
    ? path.resolve(process.env.DATABASE_FILE)
    : path.resolve(process.cwd(), 'data', 'nearbuy.db'),
  demoMode,
  trustProxy: bool(process.env.TRUST_PROXY, true),
  allowedOrigins,
  cookieSecure: bool(process.env.COOKIE_SECURE, isProduction),
  sessionCookieName: 'nb_session',
  sessionTtlDays: num(process.env.SESSION_TTL_DAYS, 30),
  /** Password-reset tokens: single-use, hashed at rest, short-lived. */
  resetTokenTtlMinutes: num(process.env.RESET_TOKEN_TTL_MINUTES, 30),
  /** Business rules */
  deliveryFeePerStore: num(process.env.DELIVERY_FEE_PER_STORE, 30),
  freeDeliveryThreshold: num(process.env.FREE_DELIVERY_THRESHOLD, 0),
  reservationHoldHours: num(process.env.RESERVATION_HOLD_HOURS, 24),
  lowStockThreshold: num(process.env.LOW_STOCK_THRESHOLD, 5),
  uploadsDir: process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.resolve(process.cwd(), 'data', 'uploads'),
  maxUploadBytes: num(process.env.MAX_UPLOAD_BYTES, 4 * 1024 * 1024),
};

/** Password policy shared by the API and the UI (single source of truth). */
export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 72,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  description:
    'At least 8 characters with an uppercase letter, a lowercase letter and a number.',
};

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_POLICY.minLength) {
    return `Password must be at least ${PASSWORD_POLICY.minLength} characters long.`;
  }
  if (password.length > PASSWORD_POLICY.maxLength) {
    return `Password must be at most ${PASSWORD_POLICY.maxLength} characters long.`;
  }
  if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) {
    return 'Password must include at least one uppercase letter.';
  }
  if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) {
    return 'Password must include at least one lowercase letter.';
  }
  if (PASSWORD_POLICY.requireNumber && !/[0-9]/.test(password)) {
    return 'Password must include at least one number.';
  }
  return null;
}

export function warnAboutConfiguration(log: (msg: string) => void) {
  if (config.isProduction) {
    if (config.demoMode) {
      log('[config] ENABLE_DEMO_ACCOUNTS=true in production: demo accounts will be seeded.');
    }
    if (!config.appUrl) {
      log('[config] APP_URL is not set. Set it to the public https URL of the deployment.');
    }
    if (!config.cookieSecure) {
      log('[config] COOKIE_SECURE is disabled in production. Sessions will not be Secure-only.');
    }
  }
}
