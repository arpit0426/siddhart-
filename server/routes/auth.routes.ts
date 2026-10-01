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
  consumeResetToken,
  createSession,
  deleteAllSessionsForUser,
  deleteSession,
  extractToken,
  findUserByIdentifier,
  getUserByToken,
  hashPassword,
  issueResetToken,
  markResetTokenUsed,
  publicUser,
  registerFailedLogin,
  registerSuccessfulLogin,
  requireAuth,
  verifyPassword,
} from '../auth.js';
import {
  optionalPhone,
  optionalString,
  requireEmail,
  requireEnum,
  requirePincode,
  requireString,
} from '../validation.js';
import { randomId } from '../codes.js';

export const authRouter = Router();
authRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

const ROLES = ['customer', 'seller', 'rider'] as const;

/**
 * Copy shown for every recovery request. It is deliberately identical whether
 * or not the identifier matched an account, so responses cannot be used to
 * enumerate registered emails/phones.
 */
const RECOVERY_RESPONSE_MESSAGE =
  'If an account matches the information provided, recovery instructions will be sent.';

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

// Registration: /api/auth/register
//   { role, name, email, phone?, password, termsAccepted?,
//     address?, vehicleType?, vehicleNumber?,        (rider)
//     store?: { name, category, address, city, state, pincode, opensAt, closesAt, operatingDays } } (seller)
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

    // Terms acceptance is mandatory for roles whose signup form lists it.
    if ((role === 'customer' || role === 'rider') && req.body?.termsAccepted !== true) {
      throw ApiError.badRequest('Please accept the NearBuy terms to continue.', 'terms_required');
    }

    // Rider signup: address/location plus optional vehicle information. The
    // rider signup form always sends the address; riders who are created
    // through other flows can add it later from their profile.
    const address = role === 'rider' ? optionalString(req.body?.address, 'Address / location', { max: 240 }) : undefined;
    const vehicleType = role === 'rider' ? optionalString(req.body?.vehicleType, 'Vehicle type', { max: 40 }) : undefined;
    const vehicleNumber = role === 'rider' ? optionalString(req.body?.vehicleNumber, 'Vehicle number', { max: 20 }) : undefined;
    if (vehicleNumber && !/^[A-Za-z0-9\s-]{4,20}$/.test(vehicleNumber)) {
      throw ApiError.badRequest('Please provide a valid vehicle number.');
    }

    // Seller signup: store details are part of registration. Optional at the
    // API level (a seller can also add a store later), but the seller signup
    // experience always sends them, so the spec journey creates the store.
    const storeInput = req.body?.store ?? null;
    let store: null | {
      name: string;
      description: string;
      category: string;
      address: string;
      city: string;
      state: string;
      pincode: string;
      opensAt: string;
      closesAt: string;
      operatingDays: string;
      openingHours: string;
    } = null;
    if (role === 'seller' && storeInput !== null) {
      if (typeof storeInput !== 'object') {
        throw ApiError.badRequest('Store details are required to create a seller account.', 'store_required');
      }
      const opensAt = optionalString(storeInput.opensAt, 'Opening time', { max: 20 }) || '07:00';
      const closesAt = optionalString(storeInput.closesAt, 'Closing time', { max: 20 }) || '22:00';
      const operatingDays = optionalString(storeInput.operatingDays, 'Operating days', { max: 60 }) || 'Mon-Sun';
      store = {
        name: requireString(storeInput.name, 'Store name', { min: 3, max: 80 }),
        description: optionalString(storeInput.description, 'Store description', { max: 600 }) || '',
        category: requireString(storeInput.category, 'Store category', { min: 2, max: 60 }),
        address: requireString(storeInput.address, 'Address', { min: 5, max: 240 }),
        city: requireString(storeInput.city, 'City', { min: 2, max: 80 }),
        state: requireString(storeInput.state, 'State', { min: 2, max: 80 }),
        pincode: requirePincode(storeInput.pincode),
        opensAt,
        closesAt,
        operatingDays,
        openingHours: `${opensAt} - ${closesAt} (${operatingDays})`,
      };
    }

    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) {
      throw ApiError.conflict('An account with this email address already exists. Please sign in instead.', 'email_taken');
    }

    const id = randomId(`usr_${role}`);
    const { hash, salt } = hashPassword(password);
    const now = new Date().toISOString();

    withTransaction(() => {
      db.prepare(
        `INSERT INTO users (id, role, name, email, phone, password_hash, password_salt, status,
           address, vehicle_type, vehicle_number, onboarding_completed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        role,
        name,
        email,
        phone || null,
        hash,
        salt,
        address || null,
        vehicleType || null,
        vehicleNumber || null,
        role === 'seller' || (role === 'rider' && Boolean(vehicleType && vehicleNumber && phone)) ? 1 : 0,
        now,
        now
      );

      if (role === 'customer') {
        db.prepare(
          `INSERT INTO carts (id, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?)`
        ).run(randomId('cart'), id, now, now);
      }

      if (role === 'seller' && store) {
        db.prepare(
          `INSERT INTO stores (id, seller_id, name, description, category, address, city, state, pincode,
             opening_hours, opens_at, closes_at, operating_days, status, supports_delivery, supports_pickup,
             published_at, is_published, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inactive', 1, 1, NULL, 0, ?, ?)`
        ).run(
          randomId('store'),
          id,
          store.name,
          store.description,
          store.category,
          store.address,
          store.city,
          store.state,
          store.pincode,
          store.openingHours,
          store.opensAt,
          store.closesAt,
          store.operatingDays,
          now,
          now
        );
      }
    });

    const session = createSession(id, role, { userAgent: req.headers['user-agent'] });
    setSessionCookie(res, session.token, session.expiresAt);
    logger.info('auth.registered', { userId: id, role, withStore: Boolean(store) });

    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    res.status(201).json({ token: session.token, user: publicUser(user) });
  })
);

// Login: /api/auth/login { email (or phone), password, expectedRole? }
authRouter.post(
  '/login',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 25, keyPrefix: 'login' }),
  route((req, res) => {
    // Customers may sign in with either their email or their phone number.
    const identifier =
      typeof req.body?.email === 'string' && req.body.email.trim()
        ? req.body.email
        : typeof req.body?.phone === 'string' && req.body.phone.trim()
          ? req.body.phone
          : undefined;
    if (identifier === undefined) {
      throw ApiError.badRequest('Email or phone is required.');
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const expectedRole = req.body?.expectedRole
      ? requireEnum(req.body.expectedRole, 'Portal', ROLES)
      : undefined;

    if (!password) throw ApiError.badRequest('Password is required.');

    const user = findUserByIdentifier(identifier);

    // Generic error message: never reveal whether an email/phone is registered.
    if (!user || (!config.demoMode && user.email.endsWith('.demo@nearbuy.app'))) {
      logger.warn('auth.login_failed', { identifier, reason: 'unknown_account' });
      throw new ApiError(401, 'Invalid email or password. Please try again.', 'invalid_credentials');
    }

    assertAccountNotLocked(user);

    if (!verifyPassword(password, user.password_hash, user.password_salt)) {
      registerFailedLogin(user.id);
      logger.warn('auth.login_failed', { userId: user.id, reason: 'bad_password' });
      throw new ApiError(401, 'Invalid email or password. Please try again.', 'invalid_credentials');
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
    const remember = req.body?.remember !== false;
    const session = createSession(user.id, user.role, { userAgent: req.headers['user-agent'], remember });
    setSessionCookie(res, session.token, session.expiresAt, remember);
    logger.info('auth.login', { userId: user.id, role: user.role });

    const fresh = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
    res.json({ token: session.token, user: publicUser(fresh) });
  })
);

// Account recovery request: /api/auth/recover { identifier, role? }
authRouter.post(
  '/recover',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: 'recover' }),
  route((req, res) => {
    const identifier =
      typeof req.body?.identifier === 'string' && req.body.identifier.trim()
        ? req.body.identifier
        : undefined;
    if (identifier === undefined) {
      throw ApiError.badRequest('Enter the email or phone number on your account.');
    }

    const user = findUserByIdentifier(identifier);
    let demoResetPath: string | undefined;

    if (user && user.status === 'active') {
      const issued = issueResetToken(user.id, req.ip);
      logger.info('auth.recover_issued', { userId: user.id, role: user.role });
      // There is no mail provider in this environment. In demo/staging mode the
      // reset link is returned so the flow is usable; production deployments
      // would email this URL instead and the field below never appears.
      if (config.demoMode) {
        demoResetPath = `/${user.role}/recover?token=${encodeURIComponent(issued.token)}`;
      }
    } else {
      logger.warn('auth.recover_no_match', { identifier });
    }

    // Same response shape and message whether or not the account exists.
    res.json({
      message: RECOVERY_RESPONSE_MESSAGE,
      ...(demoResetPath ? { demoResetPath } : {}),
    });
  })
);

// Password reset: /api/auth/reset { token, password }
authRouter.post(
  '/reset',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyPrefix: 'reset' }),
  route((req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    const policyError = validatePasswordStrength(password);
    if (policyError) throw ApiError.badRequest(policyError, 'weak_password');

    const match = consumeResetToken(token);
    if (!match) {
      throw ApiError.badRequest(
        'This password reset link is invalid or has expired. Please request a new one.',
        'invalid_reset_token'
      );
    }

    const { tokenRow, user } = match;
    const { hash, salt } = hashPassword(password);

    withTransaction(() => {
      db.prepare(
        `UPDATE users SET password_hash = ?, password_salt = ?, failed_login_attempts = 0,
           locked_until = NULL, updated_at = ? WHERE id = ?`
      ).run(hash, salt, new Date().toISOString(), user.id);
      markResetTokenUsed(tokenRow.id);
    });

    // Password changed: revoke every existing session for this account.
    deleteAllSessionsForUser(user.id);
    logger.info('auth.password_reset', { userId: user.id, role: user.role });

    res.json({ message: 'Your password has been updated successfully.', role: user.role });
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
