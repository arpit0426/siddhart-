import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { type AuthenticatedRequest, hashPassword, hashToken, publicUser, verifyPassword } from '../auth.js';
import { clearSessionCookie } from '../security.js';
import { validatePasswordStrength } from '../config.js';
import { ApiError, route } from '../http.js';
import { rateLimit } from '../rateLimit.js';
import { randomId } from '../codes.js';
import { toRupees } from '../pricing.js';
import { lowStockProducts } from '../inventory.js';
import { auditSeller, LOCAL_DAY, LOCAL_NOW, notifySeller, pageMeta, pagination, queryText, requireSellerStore, sellerStore, settingsFor } from '../seller.js';
import { optionalPhone, optionalString, requireEmail, requireEnum, requirePositiveInt, requireString, sanitizeText } from '../validation.js';
import { expireReservations } from './seller.routes.js';

export const sellerWorkspaceRouter = Router();

function orderSummary(id: string) {
  const row = db.prepare(`SELECT o.id,o.order_number AS orderNumber,o.status,o.fulfillment_type AS fulfillmentType,
    o.subtotal,o.delivery_fee AS deliveryFee,o.total,o.created_at AS createdAt,u.name AS customer_name,
    (SELECT COALESCE(SUM(quantity),0) FROM order_items WHERE order_id=o.id) AS itemCount
    FROM orders o JOIN users u ON u.id=o.customer_id WHERE o.id=?`).get(id) as any;
  return { ...row, customer: { name: row.customer_name }, customer_name: undefined };
}

/** Zero-filled calendar days are query gaps, not invented sales. All sums use
 * India store time consistently, independent of the host/browser time zone. */
function salesDaily(storeId: string, days: number) {
  return db.prepare(`WITH RECURSIVE calendar(day) AS (
      SELECT date('now','+5 hours','+30 minutes',?)
      UNION ALL SELECT date(day,'+1 day') FROM calendar WHERE day<${LOCAL_NOW}
    ), sales AS (
      SELECT ${LOCAL_DAY} AS day,COUNT(*) AS orders,
        COALESCE(SUM(CASE WHEN status NOT IN ('cancelled','rejected') THEN subtotal ELSE 0 END),0) AS revenue
      FROM orders WHERE store_id=? AND ${LOCAL_DAY}>=date('now','+5 hours','+30 minutes',?) GROUP BY ${LOCAL_DAY}
    ) SELECT c.day,COALESCE(s.orders,0) AS orders,COALESCE(s.revenue,0) AS revenue
      FROM calendar c LEFT JOIN sales s ON s.day=c.day ORDER BY c.day`)
    .all(`-${days - 1} days`, storeId, `-${days - 1} days`) as { day: string; orders: number; revenue: number }[];
}

sellerWorkspaceRouter.get('/dashboard', route((req: AuthenticatedRequest, res) => {
  expireReservations(); const store = sellerStore(req.user!.id);
  const unread = (db.prepare('SELECT COUNT(*) AS n FROM seller_notifications WHERE seller_id=? AND read_at IS NULL').get(req.user!.id) as any).n;
  if (!store) { res.json({ store: null, metrics: null, actionRequired: null, recentOrders: [], liveOrders: [], lowStock: [], daily: [], unreadNotifications: unread, setup: { percent: 0, checks: [] } }); return; }
  const metrics = db.prepare(`SELECT COUNT(*) AS totalOrders,
    COALESCE(SUM(CASE WHEN status NOT IN ('cancelled','rejected') THEN total ELSE 0 END),0) AS revenue,
    COALESCE(SUM(CASE WHEN status NOT IN ('cancelled','rejected') THEN subtotal ELSE 0 END),0) AS subtotalRevenue,
    COALESCE(SUM(status='delivered'),0) AS delivered,
    COALESCE(SUM(${LOCAL_DAY}=${LOCAL_NOW}),0) AS todayOrders,
    COALESCE(SUM(CASE WHEN ${LOCAL_DAY}=${LOCAL_NOW} AND status NOT IN ('cancelled','rejected') THEN subtotal ELSE 0 END),0) AS todayRevenue,
    COALESCE(SUM(status IN ('placed','accepted','preparing','packed','ready_for_pickup')),0) AS pendingOrders
    FROM orders WHERE store_id=?`).get(store.id) as any;
  const inventory = db.prepare(`SELECT COUNT(*) AS totalProducts,COALESCE(SUM(reserved_quantity),0) AS heldUnits,
    COALESCE(SUM(stock_quantity-reserved_quantity<=low_stock_threshold),0) AS lowStockCount,
    COALESCE(SUM(stock_quantity-reserved_quantity>low_stock_threshold),0) AS healthy,
    COALESCE(SUM(stock_quantity-reserved_quantity=0),0) AS outOfStock
    FROM inventory i JOIN products p ON p.id=i.product_id WHERE p.store_id=?`).get(store.id) as any;
  const states = Object.fromEntries((db.prepare('SELECT status,COUNT(*) AS n FROM orders WHERE store_id=? GROUP BY status').all(store.id) as any[]).map((r) => [r.status, r.n]));
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE store_id=? AND status='pending'`).get(store.id) as any).n;
  const checks = [
    { label: 'Profile', done: Boolean(req.user!.name && req.user!.phone) },
    { label: 'Store details', done: Boolean(store.name && store.description) },
    { label: 'Location', done: Boolean(store.address && store.city && store.pincode) },
    { label: 'Opening hours', done: Boolean(store.opens_at && store.closes_at && store.operating_days) },
    { label: 'First product', done: inventory.totalProducts > 0 },
    { label: 'Store image', done: Boolean(store.image) },
  ];
  const liveIds = db.prepare(`SELECT id FROM (SELECT id,status,created_at,
    ROW_NUMBER() OVER (PARTITION BY status ORDER BY created_at ASC,id) AS n FROM orders
    WHERE store_id=? AND status IN ('placed','accepted','preparing','packed','ready_for_pickup'))
    WHERE n<=3 ORDER BY created_at ASC`).all(store.id) as any[];
  res.json({ store, metrics: { ...metrics, ...inventory }, actionRequired: {
    newOrders: states.placed ?? 0, inProgress: (states.accepted ?? 0) + (states.preparing ?? 0),
    packedAwaitingPickup: states.packed ?? 0, readyForPickup: states.ready_for_pickup ?? 0,
    pendingStockRequests: count('stock_requests'), pendingReservations: count('reservations'),
  }, orderCounts: states,
    recentOrders: (db.prepare('SELECT id FROM orders WHERE store_id=? ORDER BY created_at DESC LIMIT 5').all(store.id) as any[]).map((r) => orderSummary(r.id)),
    liveOrders: liveIds.map((r) => orderSummary(r.id)), lowStock: lowStockProducts(store.id, 5), daily: salesDaily(store.id, 7),
    unreadNotifications: unread, setup: { percent: Math.round(checks.filter((c) => c.done).length / checks.length * 100), checks },
    activity: db.prepare('SELECT id,category,title,body,href,created_at,read_at FROM seller_notifications WHERE seller_id=? ORDER BY created_at DESC LIMIT 4').all(req.user!.id),
  });
}));

sellerWorkspaceRouter.get('/analytics', route((req: AuthenticatedRequest, res) => {
  const days = requirePositiveInt(req.query.days ?? 14, 'Days', { min: 7, max: 90 });
  const store = sellerStore(req.user!.id);
  if (!store) { res.json({ totals: null, topProducts: [], daily: [], categories: [], periods: { today: 0, week: 0, month: 0 }, inventory: { low: 0, out: 0 } }); return; }
  const since = `-${days - 1} days`;
  const totals = db.prepare(`SELECT COUNT(*) AS orders,
    COALESCE(SUM(status='delivered'),0) AS delivered,COALESCE(SUM(status='cancelled'),0) AS cancelled,
    COALESCE(SUM(status='rejected'),0) AS rejected,
    COALESCE(SUM(CASE WHEN status NOT IN ('cancelled','rejected') THEN subtotal ELSE 0 END),0) AS subtotal,
    COALESCE(AVG(CASE WHEN status NOT IN ('cancelled','rejected') THEN subtotal END),0) AS averageOrderValue,
    AVG(CASE WHEN ready_at IS NOT NULL AND accepted_at IS NOT NULL THEN (julianday(ready_at)-julianday(accepted_at))*1440 END) AS averagePreparationMinutes
    FROM orders WHERE store_id=? AND ${LOCAL_DAY}>=date('now','+5 hours','+30 minutes',?)`).get(store.id, since) as any;
  const topProducts = db.prepare(`SELECT oi.product_name AS name,oi.product_image AS image,SUM(oi.quantity) AS units,SUM(oi.line_total) AS revenue
    FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.store_id=? AND o.status NOT IN ('cancelled','rejected')
    AND date(o.created_at,'+5 hours','+30 minutes')>=date('now','+5 hours','+30 minutes',?)
    GROUP BY oi.product_id ORDER BY units DESC,revenue DESC LIMIT 8`).all(store.id, since);
  const categories = db.prepare(`SELECT COALESCE(p.category,'Other') AS name,SUM(oi.quantity) AS units,SUM(oi.line_total) AS revenue
    FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id
    WHERE o.store_id=? AND o.status NOT IN ('cancelled','rejected') AND date(o.created_at,'+5 hours','+30 minutes')>=date('now','+5 hours','+30 minutes',?)
    GROUP BY COALESCE(p.category,'Other') ORDER BY revenue DESC LIMIT 12`).all(store.id, since);
  const periods = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN ${LOCAL_DAY}=${LOCAL_NOW} THEN subtotal ELSE 0 END),0) AS today,
    COALESCE(SUM(CASE WHEN ${LOCAL_DAY}>=date('now','+5 hours','+30 minutes','weekday 0','-6 days') THEN subtotal ELSE 0 END),0) AS week,
    COALESCE(SUM(CASE WHEN strftime('%Y-%m',created_at,'+5 hours','+30 minutes')=strftime('%Y-%m','now','+5 hours','+30 minutes') THEN subtotal ELSE 0 END),0) AS month
    FROM orders WHERE store_id=? AND status NOT IN ('cancelled','rejected')`).get(store.id);
  const inventory = db.prepare(`SELECT COALESCE(SUM(stock_quantity-reserved_quantity>0 AND stock_quantity-reserved_quantity<=low_stock_threshold),0) AS low,
    COALESCE(SUM(stock_quantity-reserved_quantity=0),0) AS out FROM inventory i JOIN products p ON p.id=i.product_id WHERE p.store_id=?`).get(store.id);
  res.json({ totals: { ...totals, subtotal: toRupees(totals.subtotal), averageOrderValue: toRupees(totals.averageOrderValue) },
    topProducts, daily: salesDaily(store.id, days), categories, periods, inventory });
}));

sellerWorkspaceRouter.get('/earnings', route((req: AuthenticatedRequest, res) => {
  const store = sellerStore(req.user!.id); const { page, pageSize, offset } = pagination(req);
  if (!store) { res.json({ summary: { grossSales: 0, deliveryAmounts: 0, fees: 0, refunds: 0, adjustments: 0, netSales: 0, paidSettlements: 0 }, transactions: [], settlements: [], integration: 'not_connected', pagination: pageMeta(0, page, pageSize) }); return; }
  const sales = db.prepare("SELECT COALESCE(SUM(subtotal),0) AS grossSales,COALESCE(SUM(delivery_fee),0) AS deliveryAmounts FROM orders WHERE store_id=? AND status='delivered'").get(store.id) as any;
  const adjustments = db.prepare(`SELECT COALESCE(SUM(CASE WHEN kind='fee' THEN amount ELSE 0 END),0) AS fees,
    COALESCE(SUM(CASE WHEN kind='refund' THEN amount ELSE 0 END),0) AS refunds,
    COALESCE(SUM(CASE WHEN kind='adjustment' THEN amount ELSE 0 END),0) AS adjustments
    FROM seller_financial_adjustments WHERE store_id=?`).get(store.id) as any;
  // Preserve real settlements already recorded by the shared portal ledger.
  const settlementQuery = `SELECT id,amount,status,period_start,period_end,reference,paid_at,created_at FROM seller_settlements WHERE store_id=?
    UNION ALL SELECT id,amount,status,period_start,period_end,reference,paid_at,created_at FROM settlements
      WHERE user_id=? AND role='seller' AND id NOT IN (SELECT id FROM seller_settlements WHERE store_id=?)`;
  const settlementArgs = [store.id, req.user!.id, store.id];
  const settled = db.prepare(`SELECT COALESCE(SUM(amount),0) AS paidSettlements FROM (${settlementQuery}) WHERE status='paid'`).get(...settlementArgs) as any;
  const settlements = db.prepare(`${settlementQuery} ORDER BY created_at DESC LIMIT 100`).all(...settlementArgs);
  const recent = db.prepare(`SELECT id,order_number,subtotal,delivered_at FROM orders WHERE store_id=? AND status='delivered' ORDER BY delivered_at DESC,id DESC LIMIT 20`).all(store.id);
  const total = (db.prepare('SELECT COUNT(*) AS n FROM orders WHERE store_id=?').get(store.id) as any).n;
  const transactions = db.prepare(`SELECT id,order_number,status,subtotal,delivery_fee,total,payment_method,created_at,delivered_at
    FROM orders WHERE store_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(store.id, pageSize, offset);
  res.json({ summary: { ...sales, ...adjustments, ...settled, gross: sales.grossSales, platformFee: adjustments.fees, net: toRupees(sales.grossSales - adjustments.fees - adjustments.refunds + adjustments.adjustments), netSales: toRupees(sales.grossSales - adjustments.fees - adjustments.refunds + adjustments.adjustments) },
    transactions, settlements, recent,
    ledger: db.prepare('SELECT id,amount,kind,note,created_at FROM seller_financial_adjustments WHERE store_id=? ORDER BY created_at DESC LIMIT 50').all(store.id),
    integration: 'not_connected', pagination: pageMeta(total, page, pageSize) });
}));

sellerWorkspaceRouter.get('/notifications', route((req: AuthenticatedRequest, res) => {
  const { page, pageSize, offset } = pagination(req); const values: any[] = [req.user!.id];
  const clauses = ['seller_id=?'];
  if (req.query.unread === 'true') clauses.push('read_at IS NULL');
  if (req.query.category) { clauses.push('category=?'); values.push(requireEnum(req.query.category, 'Category', ['orders', 'inventory', 'reservation', 'stock_check', 'platform', 'payout', 'security'] as const)); }
  const where = clauses.join(' AND '); const total = (db.prepare(`SELECT COUNT(*) AS n FROM seller_notifications WHERE ${where}`).get(...values) as any).n;
  const unread = (db.prepare('SELECT COUNT(*) AS n FROM seller_notifications WHERE seller_id=? AND read_at IS NULL').get(req.user!.id) as any).n;
  res.json({ notifications: db.prepare(`SELECT id,category,title,body,href,read_at,created_at FROM seller_notifications WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...values, pageSize, offset), unread, pagination: pageMeta(total, page, pageSize) });
}));
sellerWorkspaceRouter.get('/notifications/unread-count', route((req: AuthenticatedRequest, res) => {
  const row = db.prepare('SELECT COUNT(*) AS unreadCount FROM seller_notifications WHERE seller_id=? AND read_at IS NULL').get(req.user!.id);
  res.json(row);
}));
sellerWorkspaceRouter.post('/notifications/:id/read', route((req: AuthenticatedRequest, res) => {
  if (!db.prepare('UPDATE seller_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND seller_id=?').run(new Date().toISOString(), req.params.id, req.user!.id).changes) throw ApiError.notFound('Notification not found.');
  res.json({ message: 'Notification marked as read.' });
}));
sellerWorkspaceRouter.post('/notifications/read-all', route((req: AuthenticatedRequest, res) => {
  db.prepare('UPDATE seller_notifications SET read_at=? WHERE seller_id=? AND read_at IS NULL').run(new Date().toISOString(), req.user!.id);
  res.json({ message: 'All notifications marked as read.' });
}));
sellerWorkspaceRouter.put('/notifications/:id', route((req: AuthenticatedRequest, res) => {
  if (!db.prepare('UPDATE seller_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND seller_id=?').run(new Date().toISOString(), req.params.id, req.user!.id).changes) throw ApiError.notFound('Notification not found.');
  res.json({ message: 'Notification marked as read.' });
}));

sellerWorkspaceRouter.get('/search', route((req: AuthenticatedRequest, res) => {
  const query = queryText(req.query.query, 80); const store = sellerStore(req.user!.id);
  if (!store || query.length < 2) { res.json({ orders: [], products: [], requests: [], reservations: [] }); return; }
  const like = `%${query}%`;
  res.json({
    orders: db.prepare(`SELECT o.id,o.order_number AS name,o.status AS detail FROM orders o JOIN users u ON u.id=o.customer_id
      WHERE o.store_id=? AND (o.order_number LIKE ? OR u.name LIKE ?) ORDER BY o.created_at DESC LIMIT 5`).all(store.id, like, like),
    products: db.prepare('SELECT id,name,category AS detail FROM products WHERE store_id=? AND (name LIKE ? OR sku LIKE ?) ORDER BY name LIMIT 5').all(store.id, like, like),
    requests: db.prepare(`SELECT r.id,p.name,r.status AS detail FROM stock_requests r JOIN products p ON p.id=r.product_id
      WHERE r.store_id=? AND p.name LIKE ? ORDER BY r.created_at DESC LIMIT 5`).all(store.id, like),
    reservations: db.prepare(`SELECT r.id,p.name,r.status AS detail FROM reservations r JOIN products p ON p.id=r.product_id
      WHERE r.store_id=? AND p.name LIKE ? ORDER BY r.created_at DESC LIMIT 5`).all(store.id, like),
  });
}));

sellerWorkspaceRouter.get('/profile', route((req: AuthenticatedRequest, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user!.id) as any;
  const store = sellerStore(req.user!.id);
  res.json({ user: publicUser(user), store: store ? { id: store.id, name: store.name } : null });
}));
sellerWorkspaceRouter.put('/profile', route((req: AuthenticatedRequest, res) => {
  const name = requireString(req.body?.name, 'Full name', { min: 2, max: 80 });
  const phone = optionalPhone(req.body?.phone) ?? null;
  const image = optionalString(req.body?.profileImage, 'Profile image', { max: 500 }) ?? null;
  if (image && !/^\/(?!\/)[^\s\\]+$/.test(image) && !/^https?:\/\/[^\s]+$/i.test(image)) throw ApiError.badRequest('Use a valid profile image URL.');
  withTransaction(() => {
    db.prepare('UPDATE users SET name=?,phone=?,profile_image=?,updated_at=? WHERE id=?').run(name, phone, image, new Date().toISOString(), req.user!.id);
    auditSeller(req.user!.id, 'profile.updated');
  });
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user!.id)), message: 'Profile updated.' });
}));

sellerWorkspaceRouter.get('/business', route((req: AuthenticatedRequest, res) => {
  res.json({ business: db.prepare('SELECT * FROM business_profiles WHERE seller_id=?').get(req.user!.id) ?? null });
}));
sellerWorkspaceRouter.put('/business', route((req: AuthenticatedRequest, res) => {
  const body = req.body ?? {};
  const legalName = requireString(body.legalName, 'Legal / business name', { min: 2, max: 120 });
  const ownerName = requireString(body.ownerName, 'Owner name', { min: 2, max: 80 });
  const phone = optionalPhone(body.phone) ?? null; const email = body.email ? requireEmail(body.email) : null;
  const category = optionalString(body.category, 'Category', { max: 60 }) ?? null;
  const address = optionalString(body.address, 'Business address', { max: 240 }) ?? null;
  const identifier = optionalString(body.businessIdentifier, 'Business identifier', { max: 100 }) ?? null;
  const support = optionalString(body.supportContact, 'Support contact', { max: 120 }) ?? null;
  withTransaction(() => {
    db.prepare(`INSERT INTO business_profiles (seller_id,legal_name,owner_name,phone,email,category,address,business_identifier,support_contact,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(seller_id) DO UPDATE SET legal_name=excluded.legal_name,owner_name=excluded.owner_name,
      phone=excluded.phone,email=excluded.email,category=excluded.category,address=excluded.address,
      business_identifier=excluded.business_identifier,support_contact=excluded.support_contact,updated_at=excluded.updated_at`)
      .run(req.user!.id, legalName, ownerName, phone, email, category, address, identifier, support, new Date().toISOString());
    auditSeller(req.user!.id, 'business.updated');
  });
  res.json({ business: db.prepare('SELECT * FROM business_profiles WHERE seller_id=?').get(req.user!.id), message: 'Private business profile saved.' });
}));

sellerWorkspaceRouter.get('/settings', route((req: AuthenticatedRequest, res) => res.json({ settings: settingsFor(req.user!.id) })));
sellerWorkspaceRouter.put('/settings', route((req: AuthenticatedRequest, res) => {
  const fields = ['email_notifications', 'order_notifications', 'low_stock_notifications', 'reservation_notifications', 'stock_request_notifications', 'security_notifications'];
  const current = settingsFor(req.user!.id);
  const values = fields.map((key) => {
    const value = req.body?.[key];
    if (value === undefined) return current[key];
    if (typeof value !== 'boolean') throw ApiError.badRequest('Notification preferences must be true or false.');
    return value ? 1 : 0;
  });
  db.prepare(`UPDATE seller_settings SET ${fields.map((k) => `${k}=?`).join(',')},updated_at=? WHERE seller_id=?`).run(...values, new Date().toISOString(), req.user!.id);
  res.json({ settings: settingsFor(req.user!.id), message: 'Preferences saved. In-app operational records remain available.' });
}));

sellerWorkspaceRouter.get('/settings/security', route((req: AuthenticatedRequest, res) => {
  const currentHash = hashToken(req.sessionToken!);
  const sessions = (db.prepare('SELECT id,token_hash,user_agent,created_at,last_seen_at,expires_at FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC').all(req.user!.id, new Date().toISOString()) as any[])
    .map(({ token_hash, ...s }) => ({ ...s, current: token_hash === currentHash }));
  res.json({ sessions, recovery: { email: req.user!.email, phone: req.user!.phone }, securityNotifications: Boolean(settingsFor(req.user!.id).security_notifications) });
}));
sellerWorkspaceRouter.delete('/settings/security/sessions/:id', route((req: AuthenticatedRequest, res) => {
  const session = db.prepare('SELECT token_hash FROM sessions WHERE id=? AND user_id=?').get(req.params.id, req.user!.id) as any;
  if (!session) throw ApiError.notFound('Session not found.');
  db.prepare('DELETE FROM sessions WHERE id=? AND user_id=?').run(req.params.id, req.user!.id);
  if (session.token_hash === hashToken(req.sessionToken!)) clearSessionCookie(res);
  auditSeller(req.user!.id, 'security.session_revoked');
  res.json({ message: 'Session signed out.', currentSessionRevoked: session.token_hash === hashToken(req.sessionToken!) });
}));
sellerWorkspaceRouter.post('/settings/security/logout-all', route((req: AuthenticatedRequest, res) => {
  withTransaction(() => { db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user!.id); auditSeller(req.user!.id, 'security.all_sessions_revoked'); });
  clearSessionCookie(res); res.json({ message: 'Signed out of all sessions.' });
}));
sellerWorkspaceRouter.post('/settings/security/password', rateLimit({ windowMs: 15 * 60_000, max: 5, keyPrefix: 'seller_password' }), route((req: AuthenticatedRequest, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user!.id) as any;
  const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  if (!verifyPassword(current, user.password_hash, user.password_salt)) throw ApiError.badRequest('Current password is incorrect.');
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const policy = validatePasswordStrength(password); if (policy) throw ApiError.badRequest(policy);
  if (password !== req.body.confirmPassword) throw ApiError.badRequest('New passwords do not match.');
  if (password === current) throw ApiError.badRequest('Choose a different new password.');
  const { hash, salt } = hashPassword(password);
  withTransaction(() => {
    db.prepare('UPDATE users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?').run(hash, salt, new Date().toISOString(), req.user!.id);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash!=?').run(req.user!.id, hashToken(req.sessionToken!));
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id=?').run(req.user!.id);
    auditSeller(req.user!.id, 'security.password_changed');
    notifySeller(req.user!.id, 'security', 'Password changed', 'Your password was changed. All other sessions were signed out.', '/seller/settings/security');
  });
  res.json({ message: 'Password updated. All other sessions have been signed out.' });
}));

sellerWorkspaceRouter.get('/support', route((req: AuthenticatedRequest, res) => {
  const { page, pageSize, offset } = pagination(req);
  const total = (db.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE user_id=? AND role='seller'").get(req.user!.id) as any).n;
  res.json({ tickets: db.prepare("SELECT id,category,subject,message,order_id,status,created_at FROM support_tickets WHERE user_id=? AND role='seller' ORDER BY created_at DESC LIMIT ? OFFSET ?").all(req.user!.id, pageSize, offset), pagination: pageMeta(total, page, pageSize) });
}));
sellerWorkspaceRouter.post('/support', rateLimit({ windowMs: 60 * 60_000, max: 10, keyPrefix: 'seller_support' }), route((req: AuthenticatedRequest, res) => {
  const category = requireEnum(req.body?.category, 'Issue type', ['order', 'payment', 'store', 'account', 'other'] as const);
  const subject = sanitizeText(requireString(req.body?.subject, 'Subject', { min: 5, max: 120 }));
  const message = sanitizeText(requireString(req.body?.message, 'Message', { min: 10, max: 2000 }));
  const orderId = optionalString(req.body?.orderId, 'Order ID', { max: 80 }) ?? null;
  if (orderId) {
    const store = requireSellerStore(req.user!.id);
    if (!db.prepare('SELECT id FROM orders WHERE id=? AND store_id=?').get(orderId, store.id)) throw ApiError.notFound('Order not found in your store.');
  }
  const id = randomId('ticket'); const now = new Date().toISOString();
  db.prepare("INSERT INTO support_tickets (id,user_id,role,category,subject,message,order_id,created_at,updated_at) VALUES (?, ?, 'seller', ?, ?, ?, ?, ?, ?)").run(id, req.user!.id, category, subject, message, orderId, now, now);
  res.status(201).json({ ticket: db.prepare('SELECT id,category,subject,status,created_at FROM support_tickets WHERE id=?').get(id), message: 'Issue saved to your support queue. No response has been sent yet.' });
}));
