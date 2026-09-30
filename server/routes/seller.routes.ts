import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logging.js';
import { rateLimit } from '../rateLimit.js';
import { ApiError, route } from '../http.js';
import { AuthenticatedRequest, requireAuth, requireRole } from '../auth.js';
import {
  createInventoryForProduct,
  getInventory,
  lowStockProducts,
  releaseHold,
  setStock,
  tryConsumeStock,
  tryHoldStock,
  fulfilHold,
} from '../inventory.js';
import { randomId } from '../codes.js';
import { expireReservations } from '../reservations.js';
import {
  audit,
  maybeNotifyLowStock,
  notify,
  notifyCustomerOfOrder,
  recordInventoryEvent,
} from '../notifications.js';
import { toRupees } from '../pricing.js';
import { assertSellerTransition, statusLabel } from '../orderStateMachine.js';
import { hydrateOrder } from './customer.routes.js';
import {
  optionalCoordinate,
  optionalPhone,
  optionalString,
  requireEnum,
  requireNumber,
  requirePincode,
  requirePositiveInt,
  requireQuantity,
  requireString,
  sanitizeText,
} from '../validation.js';

export const sellerRouter = Router();

sellerRouter.use(requireAuth, requireRole('seller'));

const STORE_STATUSES = ['open', 'closed', 'inactive'] as const;
const PRODUCT_CATEGORIES = [
  'Grocery',
  'Fruits & Vegetables',
  'Dairy',
  'Bakery',
  'Snacks',
  'Beverages',
  'Personal Care',
  'Household',
  'Stationery',
  'Pharmacy',
  'Staples & Grains',
  'Oils & Ghee',
  'Frozen Foods',
] as const;

function getSellerStore(sellerId: string) {
  return db.prepare(`SELECT * FROM stores WHERE seller_id = ?`).get(sellerId) as any;
}

function requireStore(sellerId: string) {
  const store = getSellerStore(sellerId);
  if (!store) {
    throw new ApiError(409, 'Create your store profile before managing products or orders.', 'store_required');
  }
  return store;
}

/* -------------------------------------------------------------------------- */
/* Store profile                                                              */
/* -------------------------------------------------------------------------- */

sellerRouter.get(
  '/store',
  route((req: AuthenticatedRequest, res) => {
    res.json({ store: getSellerStore(req.user!.id) || null });
  })
);

sellerRouter.post(
  '/store',
  route((req: AuthenticatedRequest, res) => {
    const sellerId = req.user!.id;
    const name = requireString(req.body?.name, 'Store name', { min: 3, max: 80 });
    const description = optionalString(req.body?.description, 'Description', { max: 600 }) || '';
    const category = requireString(req.body?.category ?? 'Grocery', 'Store category', { min: 2, max: 60 });
    const address = requireString(req.body?.address, 'Address', { min: 5, max: 240 });
    const city = requireString(req.body?.city ?? 'Dwarka, New Delhi', 'City', { min: 2, max: 80 });
    const state = optionalString(req.body?.state, 'State', { max: 80 }) || 'Delhi';
    const pincode = requirePincode(req.body?.pincode);
    const contactPhone = optionalPhone(req.body?.contactPhone);
    const latitude = optionalCoordinate(req.body?.latitude, 'Latitude', { min: -90, max: 90 });
    const longitude = optionalCoordinate(req.body?.longitude, 'Longitude', { min: -180, max: 180 });
    const opensAt = optionalString(req.body?.opensAt, 'Opening time', { max: 20 }) || '07:00';
    const closesAt = optionalString(req.body?.closesAt, 'Closing time', { max: 20 }) || '22:00';
    const operatingDays = optionalString(req.body?.operatingDays, 'Operating days', { max: 60 }) || 'Mon-Sun';
    const image = optionalString(req.body?.image, 'Store image', { max: 500 });
    const supportsDelivery = req.body?.supportsDelivery === false ? 0 : 1;
    const supportsPickup = req.body?.supportsPickup === false ? 0 : 1;
    const status = req.body?.status
      ? requireEnum(req.body.status, 'Store status', STORE_STATUSES)
      : 'open';
    const openingHours = `${opensAt} - ${closesAt} (${operatingDays})`;

    const existing = getSellerStore(sellerId);
    const now = new Date().toISOString();

    if (existing) {
      db.prepare(
        `UPDATE stores SET name = ?, description = ?, category = ?, address = ?, city = ?, state = ?,
           pincode = ?, latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude),
           opening_hours = ?, opens_at = ?, closes_at = ?, operating_days = ?, contact_phone = ?,
           status = ?, image = COALESCE(?, image), supports_delivery = ?, supports_pickup = ?,
           published_at = COALESCE(published_at, ?), updated_at = ?
         WHERE id = ?`
      ).run(
        name,
        description,
        category,
        address,
        city,
        state,
        pincode,
        latitude ?? null,
        longitude ?? null,
        openingHours,
        opensAt,
        closesAt,
        operatingDays,
        contactPhone || null,
        status,
        image ?? null,
        supportsDelivery,
        supportsPickup,
        status === 'inactive' ? null : now,
        now,
        existing.id
      );
      res.json({ store: getSellerStore(sellerId), message: 'Store profile updated.' });
      return;
    }

    const storeId = randomId('store');
    db.prepare(
      `INSERT INTO stores (id, seller_id, name, description, category, address, city, state, pincode,
         latitude, longitude, opening_hours, opens_at, closes_at, operating_days, contact_phone,
         status, image, supports_delivery, supports_pickup, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      storeId,
      sellerId,
      name,
      description,
      category,
      address,
      city,
      state,
      pincode,
      latitude ?? null,
      longitude ?? null,
      openingHours,
      opensAt,
      closesAt,
      operatingDays,
      contactPhone || null,
      status,
      image ?? null,
      supportsDelivery,
      supportsPickup,
      status === 'inactive' ? null : now,
      now,
      now
    );

    logger.info('seller.store_created', { sellerId, storeId });
    res.status(201).json({
      store: getSellerStore(sellerId),
      message: 'Store created and published. Customers can now discover it.',
    });
  })
);

sellerRouter.post(
  '/store/publish',
  route((req: AuthenticatedRequest, res) => {
    const store = requireStore(req.user!.id);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE stores SET status = ?, published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?`
    ).run('open', now, now, store.id);
    res.json({
      store: getSellerStore(req.user!.id),
      message: 'Store published and discoverable to nearby customers.',
    });
  })
);

sellerRouter.post(
  '/store/unpublish',
  route((req: AuthenticatedRequest, res) => {
    const store = requireStore(req.user!.id);
    db.prepare(`UPDATE stores SET status = 'inactive', updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      store.id
    );
    res.json({ store: getSellerStore(req.user!.id), message: 'Store hidden from discovery.' });
  })
);

/* -------------------------------------------------------------------------- */
/* Products & inventory                                                       */
/* -------------------------------------------------------------------------- */

const productSelect = `
  SELECT p.*, i.stock_quantity, i.reserved_quantity, i.low_stock_threshold,
         (i.stock_quantity - i.reserved_quantity) AS sellable
  FROM products p JOIN inventory i ON i.product_id = p.id`;

sellerRouter.get(
  '/products',
  route((req: AuthenticatedRequest, res) => {
    const store = getSellerStore(req.user!.id);
    if (!store) {
      res.json({ products: [] });
      return;
    }
    const search = typeof req.query.query === 'string' ? `%${req.query.query.trim()}%` : null;
    const products = search
      ? db
          .prepare(`${productSelect} WHERE p.store_id = ? AND (p.name LIKE ? OR p.category LIKE ?) ORDER BY p.name ASC`)
          .all(store.id, search, search)
      : db.prepare(`${productSelect} WHERE p.store_id = ? ORDER BY p.name ASC`).all(store.id);
    res.json({ products });
  })
);

sellerRouter.get(
  '/inventory',
  route((req: AuthenticatedRequest, res) => {
    const store = getSellerStore(req.user!.id);
    if (!store) {
      res.json({ inventory: [], lowStock: [], summary: { products: 0, units: 0, reserved: 0, lowStock: 0 } });
      return;
    }
    const inventory = db
      .prepare(
        `${productSelect} WHERE p.store_id = ? ORDER BY (i.stock_quantity - i.reserved_quantity) ASC, p.name ASC`
      )
      .all(store.id) as any[];
    const summary = {
      products: inventory.length,
      units: inventory.reduce((sum, row) => sum + row.stock_quantity, 0),
      reserved: inventory.reduce((sum, row) => sum + row.reserved_quantity, 0),
      lowStock: inventory.filter((row) => row.sellable <= row.low_stock_threshold).length,
    };
    res.json({ inventory, lowStock: lowStockProducts(store.id), summary });
  })
);

sellerRouter.post(
  '/products',
  route((req: AuthenticatedRequest, res) => {
    const store = requireStore(req.user!.id);
    const name = sanitizeText(requireString(req.body?.name, 'Product name', { min: 2, max: 120 }));
    const description = sanitizeText(optionalString(req.body?.description, 'Description', { max: 600 }) || '');
    const category = requireString(req.body?.category ?? 'Grocery', 'Category', { min: 2, max: 60 });
    const price = toRupees(requireNumber(req.body?.price, 'Price', { min: 0.5, max: 1_000_000 }));
    const stock = requirePositiveInt(req.body?.stock ?? 0, 'Stock', { min: 0, max: 100000 });
    const image = optionalString(req.body?.image, 'Product image', { max: 500 });
    const isPublished = req.body?.isPublished === false ? 0 : 1;
    const id = randomId('prod');
    const now = new Date().toISOString();

    withTransaction(() => {
      db.prepare(
        `INSERT INTO products (id, store_id, name, description, category, image, price, stock, is_published, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, store.id, name, description, category, image ?? null, price, stock, isPublished, now, now);
      createInventoryForProduct(id, stock);
    });

    logger.info('seller.product_created', { sellerId: req.user!.id, productId: id, stock });
    const product = db.prepare(`${productSelect} WHERE p.id = ?`).get(id);
    res.status(201).json({ product, message: `${name} saved to your catalogue.` });
  })
);

sellerRouter.put(
  '/products/:id',
  route((req: AuthenticatedRequest, res) => {
    const store = requireStore(req.user!.id);
    const existing = db
      .prepare(`SELECT * FROM products WHERE id = ? AND store_id = ?`)
      .get(req.params.id, store.id) as any;
    if (!existing) throw ApiError.notFound('Product not found in your store.');

    const name = req.body?.name
      ? sanitizeText(requireString(req.body.name, 'Product name', { min: 2, max: 120 }))
      : existing.name;
    const description = req.body?.description !== undefined
      ? sanitizeText(optionalString(req.body.description, 'Description', { max: 600 }) || '')
      : existing.description;
    const category = req.body?.category
      ? requireString(req.body.category, 'Category', { min: 2, max: 60 })
      : existing.category;
    const price = req.body?.price !== undefined
      ? toRupees(requireNumber(req.body.price, 'Price', { min: 0.5, max: 1_000_000 }))
      : existing.price;
    const image = req.body?.image !== undefined
      ? optionalString(req.body.image, 'Product image', { max: 500 }) ?? null
      : existing.image;
    const isPublished = req.body?.isPublished === undefined
      ? existing.is_published
      : req.body.isPublished
        ? 1
        : 0;

    const now = new Date().toISOString();
    let stockNote: string | null = null;

    withTransaction(() => {
      db.prepare(
        `UPDATE products SET name = ?, description = ?, category = ?, price = ?, image = ?, is_published = ?, updated_at = ?
         WHERE id = ? AND store_id = ?`
      ).run(name, description, category, price, image, isPublished, now, req.params.id, store.id);

      if (req.body?.stock !== undefined) {
        const desired = requirePositiveInt(req.body.stock, 'Stock', { min: 0, max: 100000 });
        const result = setStock(req.params.id, desired);
        if (result.clampedToReserved) {
          stockNote = `Stock was kept at ${result.stockQuantity} because that many units are held for confirmed reservations.`;
        }
      }
    });

    const product = db.prepare(`${productSelect} WHERE p.id = ?`).get(req.params.id);
    res.json({ product, message: 'Product updated.', note: stockNote });
  })
);

// Explicit stock adjustment (delta or absolute) - returns the new inventory row.
sellerRouter.post(
  '/products/:id/stock',
  route((req: AuthenticatedRequest, res) => {
    const store = requireStore(req.user!.id);
    const existing = db
      .prepare(`SELECT id FROM products WHERE id = ? AND store_id = ?`)
      .get(req.params.id, store.id) as any;
    if (!existing) throw ApiError.notFound('Product not found in your store.');

    const mode = requireEnum(req.body?.mode ?? 'set', 'Stock update mode', ['set', 'delta'] as const);
    const value = requireNumber(req.body?.value, 'Stock value', { min: -100000, max: 100000 });
    const current = getInventory(req.params.id);
    const next = mode === 'set' ? value : (current?.stockQuantity ?? 0) + value;

    if (next < 0) throw ApiError.badRequest('Stock cannot be negative.');

    const result = setStock(req.params.id, next);
    const inventory = getInventory(req.params.id);
    res.json({
      inventory,
      message: result.clampedToReserved
        ? `Stock set to ${result.stockQuantity} - cannot go below units held for reservations.`
        : `Stock updated to ${result.stockQuantity}.`,
    });
  })
);

sellerRouter.delete(
  '/products/:id',
  route((req: AuthenticatedRequest, res) => {
    const store = requireStore(req.user!.id);
    const result = db
      .prepare(`UPDATE products SET is_published = 0, updated_at = ? WHERE id = ? AND store_id = ?`)
      .run(new Date().toISOString(), req.params.id, store.id);
    if (result.changes === 0) throw ApiError.notFound('Product not found in your store.');
    res.json({ message: 'Product unpublished from your storefront.' });
  })
);

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

sellerRouter.get(
  '/orders',
  route((req: AuthenticatedRequest, res) => {
    const store = getSellerStore(req.user!.id);
    if (!store) {
      res.json({ orders: [] });
      return;
    }
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const rows = db
      .prepare(
        `SELECT id FROM orders WHERE store_id = ? ${status ? 'AND status = ?' : ''}
         ORDER BY created_at DESC LIMIT 200`
      )
      .all(...(status ? [store.id, status] : [store.id])) as any[];
    res.json({ orders: rows.map((row) => hydrateOrder(row.id, 'seller')) });
  })
);

sellerRouter.get(
  '/orders/:id',
  route((req: AuthenticatedRequest, res) => {
    const store = requireStore(req.user!.id);
    const owned = db
      .prepare(`SELECT id FROM orders WHERE id = ? AND store_id = ?`)
      .get(req.params.id, store.id);
    if (!owned) throw ApiError.notFound('Order not found.');
    res.json({ order: hydrateOrder(req.params.id, 'seller') });
  })
);

sellerRouter.post(
  '/orders/:id/status',
  route((req: AuthenticatedRequest, res) => {
    const store = requireStore(req.user!.id);
    const order = db
      .prepare(`SELECT * FROM orders WHERE id = ? AND store_id = ?`)
      .get(req.params.id, store.id) as any;
    if (!order) throw ApiError.notFound('Order not found.');

    const target = requireEnum(
      req.body?.status,
      'Order status',
      ['accepted', 'preparing', 'packed', 'ready_for_pickup', 'rejected', 'cancelled'] as const
    );

    try {
      assertSellerTransition(order.status, target);
    } catch (error: any) {
      throw ApiError.badRequest(error.message, 'invalid_transition');
    }

    const reason = optionalString(req.body?.reason, 'Reason', { max: 240 });
    if (['rejected', 'cancelled'].includes(target) && !reason) {
      throw ApiError.badRequest('Please provide a short reason for rejecting or cancelling this order.');
    }

    const now = new Date().toISOString();
    const timestamps: Record<string, string> = {
      accepted: 'accepted_at',
      preparing: 'preparing_at',
      packed: 'packed_at',
      ready_for_pickup: 'ready_at',
    };

    withTransaction(() => {
      if (['rejected', 'cancelled'].includes(target)) {
        const items = db
          .prepare(`SELECT product_id, quantity FROM order_items WHERE order_id = ?`)
          .all(order.id) as any[];
        for (const item of items) {
          db.prepare(
            `UPDATE inventory SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE product_id = ?`
          ).run(item.quantity, now, item.product_id);
          db.prepare(
            `UPDATE products SET stock = COALESCE((SELECT stock_quantity FROM inventory WHERE product_id = ?), stock) WHERE id = ?`
          ).run(item.product_id, item.product_id);
          recordInventoryEvent({
            productId: item.product_id,
            storeId: store.id,
            type: 'cancellation',
            delta: item.quantity,
            actorId: req.user!.id,
            note: `Order ${order.order_number} ${target}`,
          });
        }
        db.prepare(
          `UPDATE delivery_jobs SET status = 'cancelled', cancelled_at = ?, cancelled_reason = ?, updated_at = ?
           WHERE order_id = ? AND status != 'completed'`
        ).run(now, reason || 'Order cancelled by store', now, order.id);
      }

      const column = timestamps[target];
      db.prepare(
        `UPDATE orders SET status = ?, ${column ? `${column} = ?,` : ''} updated_at = ? WHERE id = ?`
      ).run(...(column ? [target, now, now, order.id] : [target, now, order.id]));

      db.prepare(
        `INSERT INTO handoff_events (id, order_id, event_type, actor_role, actor_id, note, created_at)
         VALUES (?, ?, ?, 'seller', ?, ?, ?)`
      ).run(
        randomId('he'),
        order.id,
        `ORDER_${target.toUpperCase()}`,
        req.user!.id,
        reason ? `Marked ${statusLabel(target)}: ${reason}` : `Marked ${statusLabel(target)}`,
        now
      );

      notifyCustomerOfOrder(order.customer_id, order.id, order.order_number, target, reason ? `Reason: ${reason}` : undefined);
      audit(req.user!.id, 'seller', `order.${target}`, 'order', order.id, { from: order.status });

      // A delivery order that is ready makes the job visible to riders who are online.
      if (target === 'ready_for_pickup' && order.fulfillment_type === 'delivery') {
        const job = db.prepare(`SELECT id, earnings FROM delivery_jobs WHERE order_id = ?`).get(order.id) as any;
        const riders = db
          .prepare(
            `SELECT user_id FROM rider_profiles WHERE availability = 'online' AND account_status = 'active' LIMIT 200`
          )
          .all() as any[];
        for (const rider of riders) {
          notify(
            rider.user_id,
            'job',
            'New delivery available',
            `New delivery available — ₹${job?.earnings ?? 40} estimated earnings.`,
            `/rider/jobs/${job?.id}`
          );
        }
      }
    });

    logger.info('seller.order_status', { orderId: order.id, from: order.status, to: target });
    res.json({
      message: `Order marked ${statusLabel(target)}.`,
      order: hydrateOrder(order.id, 'seller'),
    });
  })
);

/* -------------------------------------------------------------------------- */
/* Stock checks & reservations                                                */
/* -------------------------------------------------------------------------- */

sellerRouter.get(
  '/stock-requests',
  route((req: AuthenticatedRequest, res) => {
    const store = getSellerStore(req.user!.id);
    if (!store) {
      res.json({ requests: [] });
      return;
    }
    const requests = db
      .prepare(
        `SELECT sr.*, p.name AS product_name, p.image AS product_image, p.price AS product_price,
                i.stock_quantity, (i.stock_quantity - i.reserved_quantity) AS sellable,
                u.name AS customer_name, u.phone AS customer_phone
         FROM stock_requests sr
         JOIN products p ON sr.product_id = p.id
         JOIN inventory i ON i.product_id = p.id
         JOIN users u ON sr.customer_id = u.id
         WHERE sr.store_id = ?
         ORDER BY CASE sr.status WHEN 'pending' THEN 0 ELSE 1 END, sr.created_at DESC`
      )
      .all(store.id);
    res.json({ requests });
  })
);

sellerRouter.put(
  '/stock-requests/:id',
  route((req: AuthenticatedRequest, res) => {
    const store = requireStore(req.user!.id);
    const request = db
      .prepare(`SELECT * FROM stock_requests WHERE id = ? AND store_id = ?`)
      .get(req.params.id, store.id) as any;
    if (!request) throw ApiError.notFound('Stock request not found.');

    const status = requireEnum(req.body?.status, 'Status', ['confirmed', 'unavailable'] as const);
    const response = optionalString(req.body?.sellerResponse, 'Response', { max: 300 });
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE stock_requests SET status = ?, seller_response = ?, responded_at = ?, updated_at = ? WHERE id = ?`
    ).run(status, response || null, now, now, request.id);

    const product = db.prepare(`SELECT name FROM products WHERE id = ?`).get(request.product_id) as any;
    notify(
      request.customer_id,
      'stock_request',
      status === 'confirmed' ? 'Stock confirmed' : 'Stock unavailable',
      status === 'confirmed'
        ? `The seller confirmed your stock request for ${product?.name}. This does not reserve the item.`
        : `The seller cannot fulfil ${request.requested_quantity} × ${product?.name} right now.`,
      '/customer/stock-requests'
    );

    res.json({
      message:
        status === 'confirmed'
          ? 'Stock check confirmed. This tells the customer the item is available - it does not hold stock.'
          : 'Marked as unavailable. The customer has been informed.',
    });
  })
);

export { expireReservations };

sellerRouter.get(
  '/reservations',
  route((req: AuthenticatedRequest, res) => {
    expireReservations();
    const store = getSellerStore(req.user!.id);
    if (!store) {
      res.json({ reservations: [] });
      return;
    }
    const reservations = db
      .prepare(
        `SELECT r.*, p.name AS product_name, p.price AS product_price, p.image AS product_image,
                i.stock_quantity, (i.stock_quantity - i.reserved_quantity) AS sellable,
                u.name AS customer_name, u.phone AS customer_phone
         FROM reservations r
         JOIN products p ON r.product_id = p.id
         JOIN inventory i ON i.product_id = p.id
         JOIN users u ON r.customer_id = u.id
         WHERE r.store_id = ?
         ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC`
      )
      .all(store.id);
    res.json({ reservations });
  })
);

/**
 * Reservation responses.
 *  - confirm  -> really holds stock (inventory.reserved_quantity) until expiry
 *  - reject   -> no hold
 *  - fulfil   -> converts the hold into a sale and consumes the stock
 */
sellerRouter.put(
  '/reservations/:id',
  route((req: AuthenticatedRequest, res) => {
    const store = requireStore(req.user!.id);
    const reservation = db
      .prepare(`SELECT * FROM reservations WHERE id = ? AND store_id = ?`)
      .get(req.params.id, store.id) as any;
    if (!reservation) throw ApiError.notFound('Reservation not found.');

    const action = requireEnum(req.body?.action ?? req.body?.status, 'Action', [
      'confirm',
      'reject',
      'fulfil',
    ] as const);
    const response = optionalString(req.body?.sellerResponse, 'Response', { max: 300 });
    const holdHours = req.body?.holdHours
      ? requireNumber(req.body.holdHours, 'Hold hours', { min: 1, max: 168 })
      : config.reservationHoldHours;
    const now = new Date().toISOString();

    if (action === 'confirm') {
      if (reservation.status === 'confirmed' && reservation.holds_stock) {
        throw ApiError.conflict('This reservation is already confirmed and holding stock.');
      }
      if (['fulfilled', 'cancelled', 'expired', 'rejected'].includes(reservation.status)) {
        throw ApiError.badRequest(
          `This reservation is already ${reservation.status} and cannot be confirmed.`
        );
      }

      withTransaction(() => {
        if (!tryHoldStock(reservation.product_id, reservation.requested_quantity)) {
          throw ApiError.conflict(
            'There is not enough available stock to hold for this reservation. Reject it or restock first.',
            'insufficient_stock'
          );
        }
        const expiresAt = new Date(Date.now() + holdHours * 3600_000).toISOString();
        db.prepare(
          `UPDATE reservations SET status = 'confirmed', seller_response = ?, responded_at = ?,
             holds_stock = 1, expires_at = ?, updated_at = ? WHERE id = ?`
        ).run(response || null, now, expiresAt, now, reservation.id);
      });

      recordInventoryEvent({
        productId: reservation.product_id,
        storeId: store.id,
        type: 'reservation',
        delta: 0,
        actorId: req.user!.id,
        note: `Held ${reservation.requested_quantity} unit(s) for reservation`,
      });
      notify(
        reservation.customer_id,
        'reservation',
        'Reservation confirmed',
        `Your reservation was confirmed. ${reservation.requested_quantity} unit(s) are being held for you until ${new Date(
          Date.now() + holdHours * 3600_000
        ).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}.`,
        '/customer/reservations'
      );
      audit(req.user!.id, 'seller', 'reservation.confirm', 'reservation', reservation.id);
      const inventory = getInventory(reservation.product_id);
      res.json({
        message: `Reservation confirmed. ${reservation.requested_quantity} unit(s) are now held until ${new Date(
          Date.now() + holdHours * 3600_000
        ).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.`,
        inventory,
      });
      return;
    }

    if (action === 'reject') {
      withTransaction(() => {
        if (reservation.holds_stock) {
          releaseHold(reservation.product_id, reservation.requested_quantity);
        }
        db.prepare(
          `UPDATE reservations SET status = 'rejected', seller_response = ?, responded_at = ?,
             holds_stock = 0, released_at = ?, updated_at = ? WHERE id = ?`
        ).run(response || null, now, now, now, reservation.id);
      });
      notify(
        reservation.customer_id,
        'reservation',
        'Reservation declined',
        'The store declined your reservation request. No stock was held.',
        '/customer/reservations'
      );
      res.json({ message: 'Reservation rejected. Any held stock was released.' });
      return;
    }

    // fulfil
    if (['fulfilled', 'cancelled', 'expired', 'rejected'].includes(reservation.status)) {
      throw ApiError.badRequest(`This reservation is already ${reservation.status}.`);
    }

    withTransaction(() => {
      const consumed = reservation.holds_stock
        ? fulfilHold(reservation.product_id, reservation.requested_quantity)
        : tryConsumeStock(reservation.product_id, reservation.requested_quantity);
      if (!consumed) {
        throw ApiError.conflict('Not enough stock to fulfil this reservation.', 'insufficient_stock');
      }
      db.prepare(
        `UPDATE reservations SET status = 'fulfilled', seller_response = ?, responded_at = COALESCE(responded_at, ?),
           holds_stock = 0, released_at = ?, updated_at = ? WHERE id = ?`
      ).run(response || null, now, now, now, reservation.id);
    });

    notify(
      reservation.customer_id,
      'reservation',
      'Reservation fulfilled',
      'Your reserved item was marked as collected.',
      '/customer/reservations'
    );
    res.json({ message: 'Reservation fulfilled and stock deducted.' });
  })
);

/* -------------------------------------------------------------------------- */
/* Dashboard, analytics, storefront images                                    */
/* -------------------------------------------------------------------------- */

sellerRouter.get(
  '/dashboard',
  route((req: AuthenticatedRequest, res) => {
    const store = getSellerStore(req.user!.id);
    if (!store) {
      res.json({ store: null, metrics: null, actionRequired: null, recentOrders: [], lowStock: [] });
      return;
    }

    expireReservations();
    const metricRow = db
      .prepare(
        `SELECT
           COUNT(*) AS total_orders,
           COALESCE(SUM(CASE WHEN status NOT IN ('cancelled','rejected') THEN total ELSE 0 END), 0) AS revenue,
           COALESCE(SUM(CASE WHEN status = 'placed' THEN 1 ELSE 0 END), 0) AS new_orders,
           COALESCE(SUM(CASE WHEN status IN ('accepted','preparing') THEN 1 ELSE 0 END), 0) AS in_progress,
           COALESCE(SUM(CASE WHEN status = 'packed' THEN 1 ELSE 0 END), 0) AS packed,
           COALESCE(SUM(CASE WHEN status = 'ready_for_pickup' THEN 1 ELSE 0 END), 0) AS ready_for_pickup,
           COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered,
           COALESCE(SUM(CASE WHEN status NOT IN ('cancelled','rejected') THEN subtotal ELSE 0 END), 0) AS subtotal_revenue
         FROM orders WHERE store_id = ?`
      )
      .get(store.id) as any;

    const pendingStockRequests = db
      .prepare(`SELECT COUNT(*) AS count FROM stock_requests WHERE store_id = ? AND status = 'pending'`)
      .get(store.id) as any;
    const pendingReservations = db
      .prepare(`SELECT COUNT(*) AS count FROM reservations WHERE store_id = ? AND status = 'pending'`)
      .get(store.id) as any;
    const heldUnits = db
      .prepare(
        `SELECT COALESCE(SUM(reserved_quantity), 0) AS held FROM inventory i
         JOIN products p ON p.id = i.product_id WHERE p.store_id = ?`
      )
      .get(store.id) as any;
    const todayRow = db
      .prepare(
        `SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders FROM orders
         WHERE store_id = ? AND date(created_at) = date('now') AND status NOT IN ('cancelled','rejected')`
      )
      .get(store.id) as any;

    const recentOrders = (
      db
        .prepare(`SELECT id FROM orders WHERE store_id = ? ORDER BY created_at DESC LIMIT 6`)
        .all(store.id) as any[]
    ).map((row) => hydrateOrder(row.id, 'seller'));

    res.json({
      store,
      metrics: {
        totalOrders: metricRow.total_orders,
        revenue: toRupees(metricRow.revenue),
        subtotalRevenue: toRupees(metricRow.subtotal_revenue),
        delivered: metricRow.delivered,
        todayRevenue: toRupees(todayRow.revenue),
        todayOrders: todayRow.orders,
        heldUnits: heldUnits.held,
      },
      actionRequired: {
        newOrders: metricRow.new_orders,
        pendingStockRequests: pendingStockRequests.count,
        pendingReservations: pendingReservations.count,
        packedAwaitingPickup: metricRow.packed,
        readyForPickup: metricRow.ready_for_pickup,
        inProgress: metricRow.in_progress,
      },
      recentOrders,
      lowStock: lowStockProducts(store.id),
    });
  })
);

sellerRouter.get(
  '/analytics',
  route((req: AuthenticatedRequest, res) => {
    const store = getSellerStore(req.user!.id);
    if (!store) {
      res.json({ totals: null, topProducts: [], daily: [] });
      return;
    }
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS orders,
                COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered,
                COALESCE(SUM(CASE WHEN status IN ('cancelled','rejected') THEN 1 ELSE 0 END), 0) AS cancelled,
                COALESCE(SUM(CASE WHEN status NOT IN ('cancelled','rejected') THEN subtotal ELSE 0 END), 0) AS subtotal
         FROM orders WHERE store_id = ?`
      )
      .get(store.id) as any;
    const topProducts = db
      .prepare(
        `SELECT oi.product_name AS name, SUM(oi.quantity) AS units, SUM(oi.line_total) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.store_id = ? AND o.status NOT IN ('cancelled','rejected')
         GROUP BY oi.product_name ORDER BY units DESC LIMIT 8`
      )
      .all(store.id);
    const daily = db
      .prepare(
        `SELECT date(created_at) AS day, COUNT(*) AS orders,
                COALESCE(SUM(CASE WHEN status NOT IN ('cancelled','rejected') THEN total ELSE 0 END), 0) AS revenue
         FROM orders WHERE store_id = ? GROUP BY date(created_at)
         ORDER BY day DESC LIMIT 14`
      )
      .all(store.id);

    res.json({
      totals: { ...totals, subtotal: toRupees(totals.subtotal) },
      topProducts,
      daily: (daily as any[]).reverse(),
    });
  })
);

// Storefront image upload: accepts a data URL, validates type/size and stores it.
sellerRouter.post(
  '/uploads',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 30, keyPrefix: 'upload' }),
  route((req: AuthenticatedRequest, res) => {
    const dataUrl = requireString(req.body?.dataUrl, 'Image data', { min: 24, max: 8_000_000 });
    const match = /^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
    if (!match) {
      throw ApiError.badRequest('Only PNG, JPEG or WEBP images are supported.');
    }
    const mime = match[1].toLowerCase();
    const buffer = Buffer.from(match[3], 'base64');
    if (buffer.byteLength > config.maxUploadBytes) {
      throw ApiError.badRequest(
        `Image is too large. Maximum size is ${Math.round(config.maxUploadBytes / (1024 * 1024))} MB.`
      );
    }
    if (buffer.byteLength < 64) {
      throw ApiError.badRequest('The uploaded image looks corrupted.');
    }

    const extension = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const filename = `${req.user!.id}-${randomId('img')}.${extension}`;
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(config.uploadsDir, filename), buffer);

    // Local storage is the default; production should map OBJECT_STORAGE_URL /
    // a CDN in front of this directory (see README deployment notes).
    res.status(201).json({ url: `/uploads/${filename}`, bytes: buffer.byteLength });
  })
);

sellerRouter.put(
  '/profile',
  route((req: AuthenticatedRequest, res) => {
    const name = requireString(req.body?.name ?? req.user!.name, 'Full name', { min: 2, max: 80 });
    const phone = req.body?.phone ? optionalPhone(req.body.phone) : req.user!.phone;
    db.prepare(`UPDATE users SET name = ?, phone = ?, updated_at = ? WHERE id = ?`).run(
      name,
      phone || null,
      new Date().toISOString(),
      req.user!.id
    );
    res.json({ message: 'Profile updated.' });
  })
);

export { PRODUCT_CATEGORIES };
