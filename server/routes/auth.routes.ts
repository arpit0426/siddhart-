import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { config, validatePasswordStrength } from '../config.js';
import { logger } from '../logging.js';
import { rateLimit } from '../rateLimit.js';
import { clearSessionCookie, setSessionCookie } from '../security.js';
import { ApiError, route } from '../http.js';
import {
  AuthenticatedRequest,
  assertAccountNotLocked,
  extractToken,
  createSession,
  deleteSession,
  getUserByToken,
  hashPassword,
  publicUser,
  registerFailedLogin,
  registerSuccessfulLogin,
  requireAuth,
  verifyPassword,
} from '../auth.js';
import { optionalPhone, requireEmail, requireEnum, requireString } from '../validation.js';
import { randomId } from '../codes.js';

export const authRouter = Router();

const ROLES = ['customer', 'seller', 'rider'] as const;

/**
 * Public runtime configuration for the SPA (never secrets).
 * Demo credentials are only exposed when demo mode is enabled.
 */
authRouter.get('/config', (_req, res) => {
  res.json({
    appName: config.appName,
    version: config.version,
    demoMode: config.demoMode,
    deliveryFeePerStore: config.deliveryFeePerStore,
    freeDeliveryThreshold: config.freeDeliveryThreshold,
    demoAccounts: config.demoMode
      ? [
          { role: 'customer', name: 'Aarav Sharma', email: 'customer.demo@nearbuy.app', password: 'NearBuy@2026' },
          { role: 'seller', name: 'Rahul Verma', email: 'seller.demo@nearbuy.app', password: 'NearBuy@2026' },
          { role: 'rider', name: 'Arjun Kumar', email: 'rider.demo@nearbuy.app', password: 'NearBuy@2026' },
        ]
      : [],
  });
});

// Registration: /api/auth/register  { role, name, email, phone, password }
authRouter.post(
  '/register',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyPrefix: 'register' }),
  route((req, res) => {
    const role = requireEnum(req.body?.role, 'Account type', ROLES);
    const name = requireString(req.body?.name, 'Full name', { min: 2, max: 80 });
    const email = requireEmail(req.body?.email);
    const phone = optionalPhone(req.body?.phone);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    const policyError = validatePasswordStrength(password);
    if (policyError) throw ApiError.badRequest(policyError, 'weak_password');

    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) {
      throw ApiError.conflict('An account with this email address already exists. Please sign in instead.', 'email_taken');
    }

    const id = randomId(`usr_${role}`);
    const { hash, salt } = hashPassword(password);
    const now = new Date().toISOString();

    withTransaction(() => {
      db.prepare(
        `INSERT INTO users (id, role, name, email, phone, password_hash, password_salt, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      ).run(id, role, name, email, phone || null, hash, salt, now, now);

      if (role === 'customer') {
        db.prepare(
          `INSERT INTO carts (id, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?)`
        ).run(randomId('cart'), id, now, now);
      }
    });

    const session = createSession(id, role, { userAgent: req.headers['user-agent'] });
    setSessionCookie(res, session.token, session.expiresAt);
    logger.info('auth.registered', { userId: id, role });

    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    res.status(201).json({ token: session.token, user: publicUser(user) });
  })
);

// Login: /api/auth/login { email, password, expectedRole? }
authRouter.post(
  '/login',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 25, keyPrefix: 'login' }),
  route((req, res) => {
    const email = requireEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const expectedRole = req.body?.expectedRole
      ? requireEnum(req.body.expectedRole, 'Portal', ROLES)
      : undefined;

    if (!password) throw ApiError.badRequest('Password is required.');

    const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as any;

    // Generic error message: never reveal whether an email is registered.
    if (!user) {
      logger.warn('auth.login_failed', { email, reason: 'unknown_account' });
      throw new ApiError(401, 'Incorrect email or password.', 'invalid_credentials');
    }

    assertAccountNotLocked(user);

    if (!verifyPassword(password, user.password_hash, user.password_salt)) {
      registerFailedLogin(user.id);
      logger.warn('auth.login_failed', { userId: user.id, reason: 'bad_password' });
      throw new ApiError(401, 'Incorrect email or password.', 'invalid_credentials');
    }

    if (user.status !== 'active') {
      throw ApiError.forbidden('This account is not active. Please contact support.');
    }

    if (expectedRole && user.role !== expectedRole) {
      throw ApiError.forbidden(
        `This account is registered as a ${user.role}. Please sign in through the ${user.role} portal.`
      );
    }

    registerSuccessfulLogin(user.id);
    const session = createSession(user.id, user.role, { userAgent: req.headers['user-agent'] });
    setSessionCookie(res, session.token, session.expiresAt);
    logger.info('auth.login', { userId: user.id, role: user.role });

    const fresh = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
    res.json({ token: session.token, user: publicUser(fresh) });
  })
);

authRouter.post(
  '/logout',
  route((req, res) => {
    // Revoke whichever credential was presented (Bearer token and/or cookie).
    const token = extractToken(req);
    if (token) deleteSession(token);
    clearSessionCookie(res);
    res.json({ message: 'Signed out successfully.' });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  route((req: AuthenticatedRequest, res) => {
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.id);
    if (!user) throw ApiError.unauthorized();
    res.json({ user: publicUser(user) });
  })
);

// Session validity probe used by the SPA router guards.
authRouter.get(
  '/session',
  route((req, res) => {
    const token = extractToken(req);
    const user = token ? getUserByToken(token) : null;
    res.json({ authenticated: Boolean(user), user: user ? publicUser(user) : null });
  })
);
