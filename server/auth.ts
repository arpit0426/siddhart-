import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.js';

export interface AuthUser {
  id: string;
  role: 'customer' | 'seller' | 'rider';
  name: string;
  email: string;
  phone: string | null;
  status: string;
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(testHash, 'hex'));
}

export function createSession(userId: string, role: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO sessions (token, user_id, role, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, userId, role, expiresAt, now);

  return token;
}

export function deleteSession(token: string): void {
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

export function getUserByToken(token: string): AuthUser | null {
  if (!token) return null;

  const session = db.prepare(`
    SELECT s.user_id, s.expires_at, u.id, u.role, u.name, u.email, u.phone, u.status
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
  `).get(token) as any;

  if (!session) return null;

  // Check expiration
  if (new Date(session.expires_at) < new Date()) {
    deleteSession(token);
    return null;
  }

  return {
    id: session.id,
    role: session.role,
    name: session.name,
    email: session.email,
    phone: session.phone,
    status: session.status
  };
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.cookies && req.cookies.nearbuy_token) {
    token = req.cookies.nearbuy_token;
  }

  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const user = getUserByToken(token);
  if (!user) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }

  req.user = user;
  next();
}

export function requireRole(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ 
        error: `Forbidden: Access restricted to ${allowedRoles.join('/')} accounts. Your role is ${req.user.role}.` 
      });
      return;
    }

    next();
  };
}
