import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.js';
import { config } from './config.js';
import { logger } from './logging.js';
import { readSessionCookie } from './security.js';
import { ApiError } from './http.js';
import { randomId } from './codes.js';

export type Role = 'customer' | 'seller' | 'rider';

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  onboardingCompleted: number;
  profile_image?: string | null;
  created_at?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  sessionToken?: string;
}

/* -------------------------------------------------------------------------- */
/* Password hashing (scrypt + per-user salt, constant-time comparison)         */
/* -------------------------------------------------------------------------- */

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  if (!hash || !salt) return false;
  const expected = Buffer.from(hash, 'hex');
  if (expected.length === 0) return false;
  const candidate = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, candidate);
}

/* -------------------------------------------------------------------------- */
/* Sessions: only SHA-256 hashes of tokens are persisted                       */
/* -------------------------------------------------------------------------- */

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface SessionResult {
  token: string;
  expiresAt: Date;
}

export function createSession(
  userId: string,
  role: Role,
  meta: { userAgent?: string; remember?: boolean } = {}
): SessionResult {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (meta.remember === false ? 1 : config.sessionTtlDays) * 24 * 60 * 60 * 1000);

  db.prepare(
    `INSERT INTO sessions (id, token_hash, user_id, role, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomId('ses'),
    hashToken(token),
    userId,
    role,
    (meta.userAgent || '').slice(0, 200) || null,
    now.toISOString(),
    now.toISOString(),
    expiresAt.toISOString()
  );

  db.prepare(
    `UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`
  ).run(now.toISOString(), hashToken(token));

  return { token, expiresAt };
}

export function deleteSession(token: string): void {
  db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
}

export function deleteAllSessionsForUser(userId: string): void {
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
}

export function purgeExpiredSessions(): void {
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(new Date().toISOString());
}

export function getUserByToken(token: string): AuthUser | null {
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.id, u.role, u.name, u.email, u.phone, u.status, u.onboarding_completed, s.expires_at, s.last_seen_at, u.profile_image, u.created_at
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = ?`
    )
    .get(hashToken(token)) as any;

  if (!row) return null;

  if (new Date(row.expires_at) < new Date()) {
    deleteSession(token);
    return null;
  }

  if (row.status !== 'active' || (!config.demoMode && row.email.endsWith('.demo@nearbuy.app'))) {
    return null;
  }

  if (Date.now() - Date.parse(row.last_seen_at) > 300_000) {
    db.prepare('UPDATE sessions SET last_seen_at=? WHERE token_hash=?').run(new Date().toISOString(), hashToken(token));
  }
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    onboardingCompleted: row.onboarding_completed ?? 0,
    profile_image: row.profile_image ?? null,
    created_at: row.created_at,
  };
}

export function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  return readSessionCookie(req);
}

/* -------------------------------------------------------------------------- */
/* Middleware                                                                  */
/* -------------------------------------------------------------------------- */

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const user = getUserByToken(token);
  if (!user) {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    return;
  }

  req.user = user;
  req.sessionToken = token;
  next();
}

export function requireRole(...allowedRoles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      logger.warn('security.role_denied', {
        userId: req.user.id,
        role: req.user.role,
        path: req.path,
        allowed: allowedRoles,
      });
      res.status(403).json({
        error: `This area is for ${allowedRoles.join('/')} accounts. You are signed in as a ${req.user.role}.`,
      });
      return;
    }
    next();
  };
}

/* -------------------------------------------------------------------------- */
/* Password reset tokens (single-use, SHA-256 hashed, expiring)                */
/* -------------------------------------------------------------------------- */

function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

/** True when the identifier looks like a phone number rather than an email. */
export function looksLikePhone(value: string): boolean {
  return !value.includes('@');
}

function normalizePhoneKey(value: string): string {
  // Match on the last 10 digits so +91 98765 43210 and 098765 43210 both work.
  const digits = value.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Find a user by email OR phone number. Used by login ("email / phone") and
 * account recovery. Enumeration is still impossible: callers must return the
 * same response whether or not a user is found.
 */
export function findUserByIdentifier(rawIdentifier: string): any | null {
  const identifier = normalizeIdentifier(rawIdentifier);
  if (!identifier) return null;

  if (looksLikePhone(identifier)) {
    const key = normalizePhoneKey(identifier);
    if (!key) return null;
    const byPhone = db.prepare(`SELECT * FROM users WHERE phone IS NOT NULL`).all() as any[];
    return byPhone.find((user) => normalizePhoneKey(user.phone) === key) ?? null;
  }

  return (db.prepare(`SELECT * FROM users WHERE email = ?`).get(identifier) as any) ?? null;
}

export interface IssuedResetToken {
  token: string;
  expiresAt: Date;
}

/**
 * Issue a password-reset token for a user. Any previous unused tokens are
 * invalidated first, only the SHA-256 hash is stored, and the token expires
 * after `RESET_TOKEN_TTL_MINUTES` (default 30).
 */
export function issueResetToken(userId: string, ip?: string): IssuedResetToken {
  const now = new Date();
  db.prepare(`DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL`).run(userId);

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + config.resetTokenTtlMinutes * 60 * 1000);
  db.prepare(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    randomId('prt'),
    userId,
    hashResetToken(token),
    expiresAt.toISOString(),
    ip ? ip.slice(0, 60) : null,
    now.toISOString()
  );
  return { token, expiresAt };
}

/** Validate a reset token and return its user, or null when invalid/expired/used. */
export function consumeResetToken(rawToken: string): any | null {
  if (!rawToken || rawToken.length > 200) return null;
  const row = db
    .prepare(`SELECT * FROM password_reset_tokens WHERE token_hash = ?`)
    .get(hashResetToken(rawToken.trim())) as any;
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(row.user_id) as any;
  if (!user || user.status !== 'active') return null;
  return { tokenRow: row, user };
}

/** Mark a reset token as used (single-use guarantee). */
export function markResetTokenUsed(tokenId: string): void {
  db.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    tokenId
  );
}

export function purgeExpiredResetTokens(): void {
  db.prepare(`DELETE FROM password_reset_tokens WHERE expires_at < ?`).run(new Date().toISOString());
}

/* -------------------------------------------------------------------------- */
/* Login throttling (per account lockout + failed-attempt counter)             */
/* -------------------------------------------------------------------------- */

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/** Seeded demo identities. Their password is public, so lockout only blocks the demo. */
const DEMO_ACCOUNT_EMAILS = new Set([
  'customer.demo@nearbuy.app',
  'seller.demo@nearbuy.app',
  'rider.demo@nearbuy.app',
]);

export function isPublicDemoAccount(user: { email?: string | null } | null | undefined): boolean {
  const email = user?.email?.trim().toLowerCase();
  return Boolean(config.demoMode && email && DEMO_ACCOUNT_EMAILS.has(email));
}

export function assertAccountNotLocked(user: any): void {
  // A wrong guess must not lock the published demo accounts out of the demo.
  if (isPublicDemoAccount(user)) return;
  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    const minutes = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
    throw new ApiError(
      429,
      `Too many failed attempts. This account is temporarily locked. Try again in ${minutes} minute(s).`,
      'account_locked'
    );
  }
}

export function registerFailedLogin(userId: string): void {
  const user = db
    .prepare(`SELECT failed_login_attempts FROM users WHERE id = ?`)
    .get(userId) as any;
  const attempts = (user?.failed_login_attempts ?? 0) + 1;
  const lockUntil =
    attempts >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
      : null;

  db.prepare(
    `UPDATE users SET failed_login_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?`
  ).run(attempts, lockUntil, new Date().toISOString(), userId);

  if (lockUntil) {
    logger.warn('security.account_locked', { userId, attempts });
  }
}

export function registerSuccessfulLogin(userId: string): void {
  db.prepare(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?`
  ).run(new Date().toISOString(), new Date().toISOString(), userId);
}

export function publicUser(user: any) {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    phone: user.phone,
    status: user.status,
    vehicleType: user.vehicle_type ?? null,
    vehicleNumber: user.vehicle_number ?? null,
    licenseNumber: user.license_number ?? null,
    onboardingCompleted: Boolean(user.onboarding_completed),
    createdAt: user.created_at,
    profileImage: user.profile_image ?? null,
  };
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

/** Sessions are identified by a short, non-reversible prefix of the stored hash. */
export function listSessions(userId: string, currentToken: string | null): SessionInfo[] {
  const currentHash = currentToken ? hashToken(currentToken) : null;
  const rows = db
    .prepare(
      `SELECT token_hash, user_agent, created_at, last_seen_at, expires_at FROM sessions
       WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC`
    )
    .all(userId, new Date().toISOString()) as any[];
  return rows.map((row) => ({
    id: String(row.token_hash).slice(0, 16),
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    current: row.token_hash === currentHash,
  }));
}

export function revokeSessionById(userId: string, shortId: string, currentToken: string | null): boolean {
  if (!/^[a-f0-9]{16}$/.test(shortId)) return false;
  const currentHash = currentToken ? hashToken(currentToken) : '';
  const result = db
    .prepare(`DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ? AND token_hash != ?`)
    .run(userId, shortId, currentHash);
  return result.changes > 0;
}

export function deleteOtherSessions(userId: string, currentToken: string | null): number {
  const currentHash = currentToken ? hashToken(currentToken) : '';
  return Number(
    db.prepare(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`).run(userId, currentHash).changes
  );
}
