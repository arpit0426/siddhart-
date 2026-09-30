import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { config, validatePasswordStrength } from '../config.js';
import { logger } from '../logging.js';
import { rateLimit } from '../rateLimit.js';
import { clearSessionCookie } from '../security.js';
import { ApiError, route } from '../http.js';
import {
  AuthenticatedRequest,
  Role,
  deleteAllSessionsForUser,
  deleteOtherSessions,
  hashPassword,
  listSessions,
  revokeSessionById,
  verifyPassword,
} from '../auth.js';
import { randomId } from '../codes.js';
import { audit, notify } from '../notifications.js';
import { optionalString, requireEnum, requireString } from '../validation.js';

/**
 * Account features shared by all three workspaces (notifications, support
 * tickets, preferences, password/session security, image uploads).
 *
 * The router is mounted under each role's own prefix AFTER that role's
 * requireAuth + requireRole middleware, e.g. /api/customer/notifications,
 * /api/seller/notifications, /api/rider/notifications. Every query is scoped to
 * `req.user.id` taken from the server-side session - a client-supplied user id
 * is never read.
 */
const SUPPORT_CATEGORIES: Record<Role, readonly string[]> = {
  customer: [
    'Order problem',
    'Missing item',
    'Wrong item',
    'Delivery problem',
    'Store problem',
    'Refund/problem',
    'Account problem',
    'General help',
  ],
  seller: ['Order problem', 'Payment/Settlement problem', 'Store problem', 'Account problem', 'Report issue', 'General help'],
  rider: [
    'Delivery issue',
    'Pickup issue',
    'Customer unavailable',
    'Store unavailable',
    'Wrong pickup code',
    'Wrong delivery code',
    'Navigation problem',
    'Payment/earnings issue',
    'Account issue',
    'Safety issue',
  ],
};

export const SUPPORT_CATEGORY_LIST = SUPPORT_CATEGORIES;

const PREFERENCE_KEYS: Record<Role, readonly string[]> = {
  customer: ['orderNotifications', 'stockNotifications', 'reservationNotifications', 'emailNotifications', 'shareUsageData'],
  seller: ['orderNotifications', 'lowStockNotifications', 'emailNotifications', 'requestNotifications'],
  rider: ['jobNotifications', 'earningsNotifications', 'emailNotifications'],
};

function defaultPreferences(role: Role): Record<string, boolean> {
  const defaults: Record<string, boolean> = {};
  for (const key of PREFERENCE_KEYS[role]) defaults[key] = key !== 'shareUsageData';
  return defaults;
}

function readPreferences(userId: string, role: Role): Record<string, boolean> {
  const row = db.prepare(`SELECT preferences FROM users WHERE id = ?`).get(userId) as any;
  let stored: Record<string, unknown> = {};
  try {
    stored = row?.preferences ? JSON.parse(row.preferences) : {};
  } catch {
    stored = {};
  }
  const merged = defaultPreferences(role);
  for (const key of PREFERENCE_KEYS[role]) {
    if (typeof stored[key] === 'boolean') merged[key] = stored[key] as boolean;
  }
  return merged;
}

function ownedOrderIdFor(role: Role, userId: string, orderId: string): string | null {
  const row =
    role === 'customer'
      ? db.prepare(`SELECT id FROM orders WHERE id = ? AND customer_id = ?`).get(orderId, userId)
      : role === 'seller'
        ? db
            .prepare(`SELECT o.id FROM orders o JOIN stores s ON s.id = o.store_id WHERE o.id = ? AND s.seller_id = ?`)
            .get(orderId, userId)
        : db.prepare(`SELECT id FROM orders WHERE id = ? AND rider_id = ?`).get(orderId, userId);
  return (row as any)?.id ?? null;
}

export function buildAccountRouter(role: Role): Router {
  const router = Router();

  /* ------------------------------ Notifications ----------------------------- */
  router.get(
    '/notifications',
    route((req: AuthenticatedRequest, res) => {
      const userId = req.user!.id;
      const unreadOnly = req.query.filter === 'unread';
      const type = typeof req.query.type === 'string' && req.query.type ? req.query.type : null;
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 25));
      const where = `user_id = ?${unreadOnly ? ' AND read_at IS NULL' : ''}${type ? ' AND type = ?' : ''}`;
      const args: any[] = [userId, ...(type ? [type] : [])];
      const total = (db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE ${where}`).get(...args) as any).c;
      const rows = db
        .prepare(
          `SELECT id, type, title, body, link, read_at, created_at FROM notifications
           WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
        )
        .all(...args, pageSize, (page - 1) * pageSize) as any[];
      const unreadCount = (
        db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL`).get(userId) as any
      ).c;
      res.json({
        notifications: rows.map((row) => ({
          id: row.id,
          type: row.type,
          title: row.title,
          body: row.body,
          link: row.link,
          read: Boolean(row.read_at),
          createdAt: row.created_at,
        })),
        unreadCount,
        total,
        page,
        pageSize,
        hasMore: page * pageSize < total,
      });
    })
  );

  router.get(
    '/notifications/unread-count',
    route((req: AuthenticatedRequest, res) => {
      const row = db
        .prepare(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL`)
        .get(req.user!.id) as any;
      res.json({ unreadCount: row.c });
    })
  );

  router.post(
    '/notifications/read-all',
    route((req: AuthenticatedRequest, res) => {
      const result = db
        .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`)
        .run(new Date().toISOString(), req.user!.id);
      res.json({ message: 'All notifications marked as read.', updated: Number(result.changes) });
    })
  );

  router.post(
    '/notifications/:id/read',
    route((req: AuthenticatedRequest, res) => {
      const result = db
        .prepare(`UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?`)
        .run(new Date().toISOString(), req.params.id, req.user!.id);
      if (result.changes === 0) throw ApiError.notFound('Notification not found.');
      res.json({ message: 'Notification marked as read.' });
    })
  );

  /* --------------------------------- Support -------------------------------- */
  router.get(
    '/support/categories',
    route((_req, res) => {
      res.json({ categories: SUPPORT_CATEGORIES[role] });
    })
  );

  router.get(
    '/support/tickets',
    route((req: AuthenticatedRequest, res) => {
      const tickets = db
        .prepare(
          `SELECT t.id, t.category, t.subject, t.message, t.order_id, t.status, t.created_at, o.order_number
           FROM support_tickets t LEFT JOIN orders o ON o.id = t.order_id
           WHERE t.user_id = ? ORDER BY t.created_at DESC LIMIT 50`
        )
        .all(req.user!.id);
      res.json({ tickets });
    })
  );

  router.post(
    '/support/tickets',
    rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyPrefix: 'support' }),
    route((req: AuthenticatedRequest, res) => {
      const category = requireEnum(req.body?.category, 'Category', SUPPORT_CATEGORIES[role]);
      const subject = requireString(req.body?.subject, 'Subject', { min: 3, max: 120 });
      const message = requireString(req.body?.message, 'Message', { min: 10, max: 2000 });
      let orderId: string | null = null;
      if (req.body?.orderId) {
        orderId = ownedOrderIdFor(role, req.user!.id, String(req.body.orderId));
        if (!orderId) throw ApiError.badRequest('That order could not be found on your account.');
      }
      const id = randomId('tkt');
      db.prepare(
        `INSERT INTO support_tickets (id, user_id, role, category, subject, message, order_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`
      ).run(id, req.user!.id, role, category, subject, message, orderId, new Date().toISOString());
      audit(req.user!.id, role, 'support.ticket_created', 'support_ticket', id, { category });
      res.status(201).json({
        id,
        message: 'Your request was sent to NearBuy support. We will get back to you by email or phone.',
      });
    })
  );

  /* -------------------------------- Settings -------------------------------- */
  router.get(
    '/settings',
    route((req: AuthenticatedRequest, res) => {
      const user = db.prepare(`SELECT id, name, email, phone, role, created_at, avatar_url FROM users WHERE id = ?`).get(req.user!.id) as any;
      res.json({
        account: {
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          createdAt: user.created_at,
          avatarUrl: user.avatar_url ?? null,
        },
        preferences: readPreferences(req.user!.id, role),
      });
    })
  );

  router.put(
    '/settings',
    route((req: AuthenticatedRequest, res) => {
      const incoming = req.body?.preferences;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        throw ApiError.badRequest('Preferences are required.');
      }
      const current = readPreferences(req.user!.id, role);
      for (const key of PREFERENCE_KEYS[role]) {
        if (incoming[key] !== undefined) {
          if (typeof incoming[key] !== 'boolean') throw ApiError.badRequest(`"${key}" must be true or false.`);
          current[key] = incoming[key];
        }
      }
      db.prepare(`UPDATE users SET preferences = ?, updated_at = ? WHERE id = ?`).run(
        JSON.stringify(current),
        new Date().toISOString(),
        req.user!.id
      );
      res.json({ message: 'Settings saved.', preferences: current });
    })
  );

  /* -------------------------------- Security -------------------------------- */
  router.post(
    '/security/password',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'change_password' }),
    route((req: AuthenticatedRequest, res) => {
      const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
      const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.id) as any;
      if (!verifyPassword(currentPassword, user.password_hash, user.password_salt)) {
        throw ApiError.badRequest('Your current password is incorrect.', 'wrong_password');
      }
      const policyError = validatePasswordStrength(newPassword);
      if (policyError) throw ApiError.badRequest(policyError, 'weak_password');
      if (newPassword === currentPassword) {
        throw ApiError.badRequest('Choose a password that is different from your current one.');
      }
      const { hash, salt } = hashPassword(newPassword);
      withTransaction(() => {
        db.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?`).run(
          hash,
          salt,
          new Date().toISOString(),
          user.id
        );
        notify(user.id, 'account', 'Password changed', 'Your password was changed successfully.', `/${role}/settings`);
        audit(user.id, role, 'auth.password_changed', 'user', user.id);
      });
      // Every other device is signed out; this session stays.
      const revoked = deleteOtherSessions(user.id, req.sessionToken ?? null);
      logger.info('auth.password_changed', { userId: user.id, revokedSessions: revoked });
      res.json({ message: 'Your password was changed successfully.', otherSessionsSignedOut: revoked });
    })
  );

  router.get(
    '/security/sessions',
    route((req: AuthenticatedRequest, res) => {
      res.json({ sessions: listSessions(req.user!.id, req.sessionToken ?? null) });
    })
  );

  router.post(
    '/security/sessions/:id/revoke',
    route((req: AuthenticatedRequest, res) => {
      if (!revokeSessionById(req.user!.id, req.params.id, req.sessionToken ?? null)) {
        throw ApiError.notFound('Session not found, or it is the session you are currently using.');
      }
      res.json({ message: 'That session was signed out.' });
    })
  );

  router.post(
    '/security/logout-all',
    route((req: AuthenticatedRequest, res) => {
      deleteAllSessionsForUser(req.user!.id);
      clearSessionCookie(res);
      audit(req.user!.id, role, 'auth.logout_all', 'user', req.user!.id);
      res.json({ message: 'You were signed out of every device.' });
    })
  );

  /* --------------------------------- Uploads -------------------------------- */
  router.post(
    '/uploads',
    rateLimit({ windowMs: 10 * 60 * 1000, max: 30, keyPrefix: 'upload' }),
    route((req: AuthenticatedRequest, res) => {
      const dataUrl = requireString(req.body?.dataUrl, 'Image data', { min: 24, max: 8_000_000 });
      const match = /^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
      if (!match) throw ApiError.badRequest('Only PNG, JPEG or WEBP images are supported.');
      const buffer = Buffer.from(match[3], 'base64');
      if (buffer.byteLength > config.maxUploadBytes) {
        throw ApiError.badRequest(`Image is too large. Maximum size is ${Math.round(config.maxUploadBytes / (1024 * 1024))} MB.`);
      }
      if (buffer.byteLength < 64) throw ApiError.badRequest('The uploaded image looks corrupted.');
      const mime = match[1].toLowerCase();
      const extension = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const filename = `${req.user!.id}-${randomId('img')}.${extension}`;
      fs.mkdirSync(config.uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(config.uploadsDir, filename), buffer);
      res.status(201).json({ url: `/uploads/${filename}`, bytes: buffer.byteLength });
    })
  );

  void optionalString;
  return router;
}
