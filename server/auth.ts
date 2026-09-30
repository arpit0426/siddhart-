import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.js';
import { config } from './config.js';
import { logger } from './logging.js';
import { readSessionCookie } from './security.js';
import { ApiError } from './http.js';

export type Role = 'customer' | 'seller' | 'rider';

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  onboardingCompleted: number;
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

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface SessionResult {
  token: string;
  expiresAt: Date;
}

export function createSession(
  userId: string,
  role: Role,
  meta: { userAgent?: string } = {}
): SessionResult {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionTtlDays * 24 * 60 * 60 * 1000);

  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, role, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
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
      `SELECT u.id, u.role, u.name, u.email, u.phone, u.status, u.onboarding_completed, s.expires_at
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

  if (row.status !== 'active') {
    return null;
  }

  return {
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    onboardingCompleted: row.onboarding_completed ?? 0,
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
/* Login throttling (per account lockout + failed-attempt counter)             */
/* -------------------------------------------------------------------------- */

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export function assertAccountNotLocked(user: any): void {
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
  };
}
