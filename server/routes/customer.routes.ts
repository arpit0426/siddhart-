import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logging.js';
import { rateLimit } from '../rateLimit.js';
import { ApiError, route } from '../http.js';
import { AuthenticatedRequest, requireAuth, requireRole } from '../auth.js';
import { inventoryMap, restock, tryConsumeStock, fulfilHold, releaseHold } from '../inventory.js';
import { publicStore, storefrontProducts } from '../storefront.js';
import { generateHandoffCode, orderNumber, randomId } from '../codes.js';
import { computeSubtotal, deliveryFeeFor, orderTotal, toRupees } from '../pricing.js';
import {
  optionalIdempotencyKey,
  optionalString,
  requireEnum,
  requireNonEmptyArray,
  requirePhone,
  requirePincode,
  requirePlatformId,
  requirePositiveInt,
  requireQuantity,
  requireString,
} from '../validation.js';

export const customerRouter = Router();

const FULFILMENT_TYPES = ['delivery', 'pickup'] as const;

/* -------------------------------------------------------------------------- */
/* Public discovery                                                           */
/* -------------------------------------------------------------------------- */

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 100) / 100;
}

// GET /api/customer/stores?query=&category=&lat=&lng=
customerRouter.get(
  '/stores',
  route((req, res) => {
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const lat = req.query.lat ? Number(req.query.lat) : undefined;
    const lng = req.query.lng ? Number(req.query.lng) : undefined;

    let sql = `
      SELECT s.*, u.name AS seller_name,
             (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id AND p.is_published = 1) AS product_count
      FROM stores s
      JOIN users u ON s.seller_id = u.id
      WHERE s.status != 'inactive' AND s.is_published=1 AND s.published_at IS NOT NULL`;
    const params: any[] = [];

    if (query) {
      sql += ` AND (s.name LIKE ? OR s.description LIKE ? OR s.city LIKE ? OR s.category LIKE ?)`;
      const like = `%${query}%`;
      params.push(like, like, like, like);
    }
    if (category) {
      sql += ` AND s.category = ?`;
      params.push(category);
    }
    sql += ` ORDER BY s.name ASC LIMIT 100`;

    const stores = (db.prepare(sql).all(...params) as any[]).map((store) => ({
      ...publicStore(store),
      distanceKm:
        Number.isFinite(lat) && Number.isFinite(lng) && store.latitude != null && store.longitude != null
          ? haversineKm(lat as number, lng as number, store.latitude, store.longitude)
          : null,
    }));

    stores.sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return a.name.localeCompare(b.name);
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });

    res.json({ stores });
  })
);

// GET /api/customer/categories
customerRouter.get(
  '/categories',
  route((_req, res) => {
    const rows = db
      .prepare(
        `SELECT p.category AS category, COUNT(*) AS count
         FROM products p JOIN stores s ON p.store_id = s.id
         WHERE p.is_published = 1 AND s.status != 'inactive' AND s.is_published=1 AND s.published_at IS NOT NULL
         GROUP BY p.category ORDER BY count DESC, p.category ASC`
      )
      .all() as any[];
    res.json({ categories: rows });
  })
);

// GET /api/customer/stores/:id
customerRouter.get(
  '/stores/:id',
  route((req, res) => {
    const store = db
      .prepare(
        `SELECT s.*, u.name AS seller_name FROM stores s
         JOIN users u ON s.seller_id = u.id
         WHERE s.id = ? AND s.status != 'inactive' AND s.is_published=1`
      )
      .get(req.params.id) as any;

    if (!store) throw ApiError.notFound('Store not found.');

    const products = storefrontProducts(req.params.id);

    res.json({ store: publicStore(store), products });
  })
);

// GET /api/customer/products?query=&category=&storeId=&minPrice=&maxPrice=&inStockOnly=&sort=
customerRouter.get(
  '/products',
  route((req, res) => {
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const storeId = typeof req.query.storeId === 'string' ? req.query.storeId.trim() : '';
    const minPrice = req.query.minPrice ? Number(req.query.minPrice) : undefined;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : undefined;
    const inStockOnly = req.query.inStockOnly === 'true';
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'name';

    let sql = `
      SELECT p.*, s.name AS store_name, CASE WHEN s.temporarily_unavailable=1 THEN 'closed' WHEN s.is_published=0 THEN 'inactive' ELSE s.status END AS store_status, s.city AS store_city,
             s.supports_delivery, s.supports_pickup,
             i.stock_quantity, i.reserved_quantity, CASE WHEN p.availability='available' THEN i.stock_quantity - i.reserved_quantity ELSE 0 END AS stock
      FROM products p
      JOIN stores s ON p.store_id = s.id
      JOIN inventory i ON i.product_id = p.id
      WHERE p.is_published = 1 AND s.status != 'inactive' AND s.is_published=1 AND s.published_at IS NOT NULL`;
    const params: any[] = [];

    if (query) {
      sql += ` AND (p.name LIKE ? OR p.description LIKE ? OR p.category LIKE ? OR s.name LIKE ?)`;
      const like = `%${query}%`;
      params.push(like, like, like, like);
    }
    if (category) {
      sql += ` AND p.category = ?`;
      params.push(category);
    }
    if (storeId) {
      sql += ` AND p.store_id = ?`;
      params.push(storeId);
    }
    if (Number.isFinite(minPrice)) {
      sql += ` AND p.price >= ?`;
      params.push(minPrice);
    }
    if (Number.isFinite(maxPrice)) {
      sql += ` AND p.price <= ?`;
      params.push(maxPrice);
    }
    if (inStockOnly) {
      sql += ` AND (i.stock_quantity - i.reserved_quantity) > 0`;
    }

    const sorts: Record<string, string> = {
      name: 'p.name ASC',
      price_asc: 'p.price ASC',
      price_desc: 'p.price DESC',
      newest: 'p.created_at DESC',
    };
    sql += ` ORDER BY ${sorts[sort] || sorts.name} LIMIT 200`;

    res.json({ products: db.prepare(sql).all(...params) });
  })
);

// GET /api/customer/products/:id
customerRouter.get(
  '/products/:id',
  route((req, res) => {
    const product = db
      .prepare(
        `SELECT p.*, s.name AS store_name, s.address AS store_address, s.city AS store_city,
                CASE WHEN s.temporarily_unavailable=1 THEN 'closed' WHEN s.is_published=0 THEN 'inactive' ELSE s.status END AS store_status, s.opening_hours, s.supports_delivery, s.supports_pickup,
                i.stock_quantity, i.reserved_quantity, CASE WHEN p.availability='available' THEN i.stock_quantity - i.reserved_quantity ELSE 0 END AS stock
         FROM products p
         JOIN stores s ON p.store_id = s.id
         JOIN inventory i ON i.product_id = p.id
         WHERE p.id = ? AND s.status != 'inactive'`
      )
      .get(req.params.id) as any;

    if (!product) throw ApiError.notFound('Product not found.');
    res.json({ product });
  })
);

/* -------------------------------------------------------------------------- */
/* Cart (authenticated customer only)                                         */
/* -------------------------------------------------------------------------- */

customerRouter.use('/cart', requireAuth, requireRole('customer'));
customerRouter.use('/addresses', requireAuth, requireRole('customer'));
customerRouter.use('/checkout', requireAuth, requireRole('customer'));
customerRouter.use('/orders', requireAuth, requireRole('customer'));
customerRouter.use('/reservations', requireAuth, requireRole('customer'));
customerRouter.use('/stock-requests', requireAuth, requireRole('customer'));

function ensureCart(customerId: string): string {
  const existing = db.prepare(`SELECT id FROM carts WHERE customer_id = ?`).get(customerId) as any;
  if (existing) return existing.id;
  const now = new Date().toISOString();
  const cartId = randomId('cart');
  db.prepare(`INSERT INTO carts (id, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
    cartId,
    customerId,
    now,
    now
  );
  return cartId;
}

function cartPayload(customerId: string) {
  const cartId = ensureCart(customerId);
  const items = db
    .prepare(
      `SELECT ci.id, ci.quantity, p.id AS product_id, p.name, p.price, p.category, p.image,
              p.is_published, p.store_id, s.name AS store_name, CASE WHEN s.temporarily_unavailable=1 THEN 'closed' WHEN s.is_published=0 THEN 'inactive' ELSE s.status END AS store_status,
              s.supports_delivery, s.supports_pickup,
              i.stock_quantity, i.reserved_quantity,
              CASE WHEN p.availability='available' THEN i.stock_quantity - i.reserved_quantity ELSE 0 END AS stock
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       JOIN stores s ON p.store_id = s.id
       JOIN inventory i ON i.product_id = p.id
       WHERE ci.cart_id = ?
       ORDER BY s.name ASC, p.name ASC`
    )
    .all(cartId) as any[];

  const groups = new Map<string, any>();
  for (const item of items) {
    if (!groups.has(item.store_id)) {
      groups.set(item.store_id, {
        storeId: item.store_id,
        storeName: item.store_name,
        storeStatus: item.store_status,
        supportsDelivery: Boolean(item.supports_delivery),
        supportsPickup: Boolean(item.supports_pickup),
        items: [] as any[],
        subtotal: 0,
      });
    }
    const group = groups.get(item.store_id)!;
    const lineTotal = toRupees(item.price * item.quantity);
    group.items.push({ ...item, lineTotal, issue: itemIssue(item) });
    group.subtotal = toRupees(group.subtotal + lineTotal);
  }

  const stores = [...groups.values()].map((group) => ({
    ...group,
    deliveryFee: deliveryFeeFor({ fulfilmentType: 'delivery', subtotal: group.subtotal }),
  }));

  const subtotal = toRupees(stores.reduce((sum, group) => sum + group.subtotal, 0));
  return { cartId, items, stores, subtotal };
}

function itemIssue(item: any): string | null {
  if (!item.is_published) return 'This item is no longer available.';
  if (item.store_status !== 'open') return 'This store is currently closed for checkout.';
  if (item.stock <= 0) return 'This item is now out of stock. Please update your cart.';
  if (item.quantity > item.stock) {
    return `Only ${item.stock} unit(s) left in stock. Please update the quantity.`;
  }
  return null;
}

customerRouter.get(
  '/cart',
  route((req: AuthenticatedRequest, res) => {
    const payload = cartPayload(req.user!.id);
    res.json({
      cart: { id: payload.cartId },
      items: payload.items,
      stores: payload.stores,
      subtotal: payload.subtotal,
    });
  })
);

customerRouter.post(
  '/cart/items',
  route((req: AuthenticatedRequest, res) => {
    const customerId = req.user!.id;
    const productId = requirePlatformId(req.body?.productId, 'Product');
    const quantity = requirePositiveInt(req.body?.quantity, 'Quantity', { min: 0, max: 999 });
    const cartId = ensureCart(customerId);

    const product = db
      .prepare(
        `SELECT p.id, p.name, p.is_published, CASE WHEN s.temporarily_unavailable=1 THEN 'closed' WHEN s.is_published=0 THEN 'inactive' ELSE s.status END AS store_status,
                CASE WHEN p.availability='available' THEN i.stock_quantity - i.reserved_quantity ELSE 0 END AS stock
         FROM products p
         JOIN stores s ON p.store_id = s.id
         JOIN inventory i ON i.product_id = p.id
         WHERE p.id = ?`
      )
      .get(productId) as any;

    if (!product) throw ApiError.notFound('Product not found.');
    if (!product.is_published) throw ApiError.badRequest('This product is no longer available.');
    if (product.store_status === 'inactive') {
      throw ApiError.badRequest('This store is not accepting orders right now.');
    }

    const now = new Date().toISOString();

    if (quantity === 0) {
      db.prepare(`DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?`).run(cartId, productId);
      const payload = cartPayload(customerId);
      res.json({ message: 'Item removed from cart.', items: payload.items, subtotal: payload.subtotal });
      return;
    }

    if (quantity > product.stock) {
      throw ApiError.badRequest(
        product.stock > 0
          ? `Only ${product.stock} unit(s) of ${product.name} are available right now.`
          : `${product.name} is out of stock right now.`
      );
    }

    const existing = db
      .prepare(`SELECT id FROM cart_items WHERE cart_id = ? AND product_id = ?`)
      .get(cartId, productId) as any;

    if (existing) {
      db.prepare(`UPDATE cart_items SET quantity = ?, updated_at = ? WHERE id = ?`).run(
        quantity,
        now,
        existing.id
      );
    } else {
      db.prepare(
        `INSERT INTO cart_items (id, cart_id, product_id, quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(randomId('ci'), cartId, productId, quantity, now, now);
    }

    db.prepare(`UPDATE carts SET updated_at = ? WHERE id = ?`).run(now, cartId);

    const payload = cartPayload(customerId);
    res.json({ message: 'Cart updated.', items: payload.items, subtotal: payload.subtotal });
  })
);

customerRouter.delete(
  '/cart/clear',
  route((req: AuthenticatedRequest, res) => {
    const cartId = ensureCart(req.user!.id);
    db.prepare(`DELETE FROM cart_items WHERE cart_id = ?`).run(cartId);
    res.json({ message: 'Cart cleared.', items: [] });
  })
);

/* -------------------------------------------------------------------------- */
/* Addresses                                                                  */
/* -------------------------------------------------------------------------- */

customerRouter.get(
  '/addresses',
  route((req: AuthenticatedRequest, res) => {
    const addresses = db
      .prepare(
        `SELECT * FROM customer_addresses WHERE customer_id = ?
         ORDER BY is_default DESC, created_at DESC`
      )
      .all(req.user!.id);
    res.json({ addresses });
  })
);

customerRouter.post(
  '/addresses',
  route((req: AuthenticatedRequest, res) => {
    const customerId = req.user!.id;
    const recipientName = requireString(req.body?.recipientName, 'Recipient name', { min: 2, max: 80 });
    const phone = requirePhone(req.body?.phone, 'Contact phone');
    const addressLine = requireString(req.body?.addressLine, 'Address', { min: 5, max: 240 });
    const city = requireString(req.body?.city ?? 'Dwarka, New Delhi', 'City', { min: 2, max: 80 });
    const state = optionalString(req.body?.state, 'State', { max: 80 }) || 'Delhi';
    const pincode = requirePincode(req.body?.pincode);
    const label = optionalString(req.body?.label, 'Label', { max: 30 }) || 'Home';
    const isDefault = req.body?.isDefault ? 1 : 0;
    const id = randomId('addr');
    const now = new Date().toISOString();

    withTransaction(() => {
      if (isDefault) {
        db.prepare(`UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?`).run(customerId);
      }
      db.prepare(
        `INSERT INTO customer_addresses
         (id, customer_id, label, recipient_name, phone, address_line, city, state, pincode, is_default, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, customerId, label, recipientName, phone, addressLine, city, state, pincode, isDefault, now);
    });

    res.status(201).json({ id, message: 'Address saved.' });
  })
);

customerRouter.put(
  '/addresses/:id',
  route((req: AuthenticatedRequest, res) => {
    const address = db
      .prepare(`SELECT * FROM customer_addresses WHERE id = ? AND customer_id = ?`)
      .get(req.params.id, req.user!.id) as any;
    if (!address) throw ApiError.notFound('Address not found.');

    const recipientName = requireString(req.body?.recipientName ?? address.recipient_name, 'Recipient name', {
      min: 2,
      max: 80,
    });
    const addressLine = requireString(req.body?.addressLine ?? address.address_line, 'Address', {
      min: 5,
      max: 240,
    });
    const pincode = requirePincode(req.body?.pincode ?? address.pincode);
    const label = optionalString(req.body?.label, 'Label', { max: 30 }) ?? address.label;
    const phone = req.body?.phone ? requirePhone(req.body.phone, 'Contact phone') : address.phone;
    const city = optionalString(req.body?.city, 'City', { max: 80 }) ?? address.city;
    const isDefault = req.body?.isDefault === undefined ? address.is_default : req.body.isDefault ? 1 : 0;

    withTransaction(() => {
      if (isDefault) {
        db.prepare(`UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?`).run(req.user!.id);
      }
      db.prepare(
        `UPDATE customer_addresses
         SET label = ?, recipient_name = ?, phone = ?, address_line = ?, city = ?, pincode = ?, is_default = ?
         WHERE id = ? AND customer_id = ?`
      ).run(label, recipientName, phone, addressLine, city, pincode, isDefault, req.params.id, req.user!.id);
    });

    res.json({ message: 'Address updated.' });
  })
);

customerRouter.delete(
  '/addresses/:id',
  route((req: AuthenticatedRequest, res) => {
    const result = db
      .prepare(`DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?`)
      .run(req.params.id, req.user!.id);
    if (result.changes === 0) throw ApiError.notFound('Address not found.');
    res.json({ message: 'Address removed.' });
  })
);

/* -------------------------------------------------------------------------- */
/* Checkout                                                                   */
/* -------------------------------------------------------------------------- */

interface CheckoutLine {
  productId: string;
  quantity: number;
}

/**
 * Builds the authoritative server-side checkout plan: validates ownership,
 * publication, store status, fulfilment support, live price and stock, and
 * computes per-store fees/totals in INR.
 */
function buildCheckoutPlan(customerId: string, rawItems: unknown, fulfilmentType: 'delivery' | 'pickup') {
  const items = requireNonEmptyArray(rawItems, 'Cart items');
  const lines: CheckoutLine[] = items.map((item: any) => ({
    productId: requirePlatformId(item?.productId, 'Product'),
    quantity: requireQuantity(item?.quantity),
  }));

  const products = db
    .prepare(
      `SELECT p.*, s.name AS store_name, CASE WHEN s.temporarily_unavailable=1 THEN 'closed' WHEN s.is_published=0 THEN 'inactive' ELSE s.status END AS store_status, s.address AS store_address,
              s.city AS store_city, s.supports_delivery, s.supports_pickup, s.published_at
       FROM products p JOIN stores s ON p.store_id = s.id
       WHERE p.id IN (${lines.map(() => '?').join(',')})`
    )
    .all(...lines.map((line) => line.productId)) as any[];

  const inventory = inventoryMap(lines.map((line) => line.productId));
  const byId = new Map(products.map((product) => [product.id, product]));

  const groups = new Map<string, any>();
  const issues: string[] = [];

  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product) {
      issues.push('One of the items in your cart is no longer available.');
      continue;
    }
    if (!product.is_published || product.availability !== 'available') {
      issues.push(`${product.name} is no longer available at ${product.store_name}.`);
      continue;
    }
    if (product.store_status !== 'open' || !product.published_at) {
      issues.push(`${product.store_name} is not accepting orders right now.`);
      continue;
    }
    if (fulfilmentType === 'delivery' && !product.supports_delivery) {
      issues.push(`${product.store_name} does not offer home delivery. Choose store pickup instead.`);
      continue;
    }
    if (fulfilmentType === 'pickup' && !product.supports_pickup) {
      issues.push(`${product.store_name} does not offer store pickup.`);
      continue;
    }

    const stock = inventory.get(line.productId);
    if (!stock || stock.sellable < line.quantity) {
      issues.push(
        stock && stock.sellable > 0
          ? `Only ${stock.sellable} unit(s) of ${product.name} are available.`
          : `${product.name} is out of stock.`
      );
      continue;
    }

    if (!groups.has(product.store_id)) {
      groups.set(product.store_id, {
        storeId: product.store_id,
        storeName: product.store_name,
        storeStatus: product.store_status,
        supportsDelivery: Boolean(product.supports_delivery),
        supportsPickup: Boolean(product.supports_pickup),
        storeAddress: product.store_address,
        storeCity: product.store_city,
        lines: [],
        subtotal: 0,
      });
    }

    groups.get(product.store_id)!.lines.push({
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      quantity: line.quantity,
      image: product.image,
    });
  }

  const storePlans = [...groups.values()].map((group) => {
    const { subtotal, lineTotals } = computeSubtotal(
      group.lines.map((line: any) => ({ unitPrice: line.unitPrice, quantity: line.quantity }))
    );
    const deliveryFee = deliveryFeeFor({
      fulfilmentType,
      subtotal,
      supportsDelivery: group.supportsDelivery,
    });
    const linesWithTotals = group.lines.map((line: any, index: number) => ({
      ...line,
      lineTotal: lineTotals[index],
    }));
    return {
      ...group,
      lines: linesWithTotals,
      subtotal,
      deliveryFee,
      total: orderTotal(subtotal, deliveryFee),
    };
  });

  const subtotal = toRupees(storePlans.reduce((sum, group) => sum + group.subtotal, 0));
  const deliveryFee = toRupees(storePlans.reduce((sum, group) => sum + group.deliveryFee, 0));

  return {
    storePlans,
    issues,
    subtotal,
    deliveryFee,
    total: orderTotal(subtotal, deliveryFee),
    fulfilmentType,
  };
}

// POST /api/customer/checkout/quote  (server-authoritative cost breakdown)
customerRouter.post(
  '/checkout/quote',
  route((req: AuthenticatedRequest, res) => {
    const fulfilmentType = requireEnum(
      req.body?.fulfilmentType ?? 'delivery',
      'Fulfilment method',
      FULFILMENT_TYPES
    );
    const plan = buildCheckoutPlan(req.user!.id, req.body?.items, fulfilmentType);
    res.json({
      quote: {
        fulfilmentType: plan.fulfilmentType,
        subtotal: plan.subtotal,
        deliveryFee: plan.deliveryFee,
        total: plan.total,
        stores: plan.storePlans.map((group) => ({
          storeId: group.storeId,
          storeName: group.storeName,
          subtotal: group.subtotal,
          deliveryFee: group.deliveryFee,
          total: group.total,
          itemCount: group.lines.length,
        })),
      },
      issues: plan.issues,
    });
  })
);

// POST /api/customer/checkout
customerRouter.post(
  '/checkout',
  rateLimit({ windowMs: 5 * 60 * 1000, max: 60, keyPrefix: 'checkout' }),
  route((req: AuthenticatedRequest, res) => {
    const customerId = req.user!.id;
    const fulfilmentType = requireEnum(
      req.body?.fulfilmentType ?? 'delivery',
      'Fulfilment method',
      FULFILMENT_TYPES
    );
    const paymentMethod = requireEnum(
      req.body?.paymentMethod ?? 'cod',
      'Payment method',
      ['cod', 'test_mode'] as const
    );
    const idempotencyKey = optionalIdempotencyKey(req.body?.idempotencyKey);
    const addressId = req.body?.addressId ? String(req.body.addressId) : undefined;

    // Idempotent replay: a retried request returns the ORIGINAL orders.
    if (idempotencyKey) {
      const previous = db
        .prepare(
          `SELECT id FROM orders WHERE idempotency_key = ? AND customer_id = ? ORDER BY created_at ASC`
        )
        .all(idempotencyKey, customerId) as any[];
      if (previous.length > 0) {
        logger.info('checkout.idempotent_replay', { customerId, idempotencyKey });
        res.json({
          message: 'This order was already placed. Showing your existing order(s).',
          idempotent: true,
          orders: previous.map((row) => hydrateOrder(row.id, 'customer')),
        });
        return;
      }
    }

    let addressSnapshot: any = null;
    if (fulfilmentType === 'delivery') {
      if (!addressId) throw ApiError.badRequest('Please select a delivery address.');
      const address = db
        .prepare(`SELECT * FROM customer_addresses WHERE id = ? AND customer_id = ?`)
        .get(addressId, customerId) as any;
      if (!address) throw ApiError.badRequest('The selected delivery address could not be found.');
      addressSnapshot = {
        name: address.recipient_name,
        phone: address.phone,
        address: address.address_line,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
      };
    }

    const plan = buildCheckoutPlan(customerId, req.body?.items, fulfilmentType);
    if (plan.issues.length > 0) {
      throw ApiError.badRequest(plan.issues[0], 'checkout_conflict');
    }
    if (plan.storePlans.length === 0) {
      throw ApiError.badRequest('There is nothing to check out.', 'empty_checkout');
    }

    try {
      const created = withTransaction(() => {
        const now = new Date().toISOString();
        const orders: any[] = [];

        for (const group of plan.storePlans) {
          // Atomic stock consumption: if a concurrent buyer took the last unit,
          // changes === 0 and the whole transaction is rolled back.
          for (const line of group.lines) {
            if (!tryConsumeStock(line.productId, line.quantity)) {
              throw ApiError.conflict(
                `${line.name} sold out while you were checking out. Please review your cart.`,
                'stock_conflict'
              );
            }
          }

          const orderId = randomId('ord');
          const number = orderNumber();
          const pickupCode = generateHandoffCode('pickup');
          const deliveryCode = generateHandoffCode('delivery');

          db.prepare(
            `INSERT INTO orders (
               id, order_number, customer_id, store_id, status, fulfillment_type,
               subtotal, delivery_fee, total, payment_method, address_snapshot,
               pickup_code, delivery_code, idempotency_key,
               store_name_snapshot, store_address_snapshot, created_at, updated_at
             ) VALUES (?, ?, ?, ?, 'placed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            orderId,
            number,
            customerId,
            group.storeId,
            fulfilmentType,
            group.subtotal,
            group.deliveryFee,
            group.total,
            paymentMethod,
            JSON.stringify(addressSnapshot ?? { pickup: true, store: group.storeName }),
            pickupCode,
            deliveryCode,
            idempotencyKey ?? null,
            group.storeName,
            `${group.storeAddress}, ${group.storeCity}`,
            now,
            now
          );

          for (const line of group.lines) {
            db.prepare(
              `INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, line_total, product_image)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              randomId('oi'),
              orderId,
              line.productId,
              line.name,
              line.unitPrice,
              line.quantity,
              line.lineTotal,
              line.image
            );
          }

          if (fulfilmentType === 'delivery') {
            db.prepare(
              `INSERT INTO delivery_jobs (id, order_id, status, earnings, created_at, updated_at)
               VALUES (?, ?, 'available', 40, ?, ?)`
            ).run(randomId('job'), orderId, now, now);
          }

          db.prepare(
            `INSERT INTO handoff_events (id, order_id, event_type, actor_role, actor_id, note, created_at)
             VALUES (?, ?, 'ORDER_PLACED', 'customer', ?, 'Order placed', ?)`
          ).run(randomId('he'), orderId, customerId, now);

          orders.push({
            id: orderId,
            orderNumber: number,
            storeId: group.storeId,
            storeName: group.storeName,
            subtotal: group.subtotal,
            deliveryFee: group.deliveryFee,
            total: group.total,
            status: 'placed',
          });
        }

        // Remove only the purchased items from the cart.
        const cart = db.prepare(`SELECT id FROM carts WHERE customer_id = ?`).get(customerId) as any;
        if (cart) {
          for (const line of plan.storePlans.flatMap((group) => group.lines)) {
            db.prepare(`DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?`).run(
              cart.id,
              line.productId
            );
          }
          db.prepare(`UPDATE carts SET updated_at = ? WHERE id = ?`).run(now, cart.id);
        }

        return orders;
      });

      logger.info('checkout.completed', {
        customerId,
        orders: created.length,
        total: plan.total,
        stores: created.map((order) => order.storeId),
      });

      res.status(201).json({
        message:
          created.length > 1
            ? `${created.length} store orders placed successfully.`
            : 'Order placed successfully.',
        orders: created.map((order) => hydrateOrder(order.id, 'customer')),
      });
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      if (String(error?.message || '').includes('UNIQUE constraint failed: orders.idempotency_key')) {
        // Two identical requests raced: return the winner's orders.
        const previous = db
          .prepare(`SELECT id FROM orders WHERE idempotency_key = ? AND customer_id = ?`)
          .all(String(idempotencyKey), customerId) as any[];
        res.json({
          message: 'This order was already placed. Showing your existing order(s).',
          idempotent: true,
          orders: previous.map((row) => hydrateOrder(row.id, 'customer')),
        });
        return;
      }
      logger.error('checkout.failed', { customerId, message: error?.message });
      throw ApiError.badRequest(error?.message || 'Checkout could not be completed.');
    }
  })
);

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Role-scoped order hydration. Each role receives only the fields and secrets it
 * is authorised to see (customer: delivery code; seller: pickup code after pack;
 * rider: never any code).
 */
export function hydrateOrder(orderId: string, viewer: 'customer' | 'seller' | 'rider' | 'admin') {
  const order = db
    .prepare(
      `SELECT o.*, s.name AS store_name, s.address AS store_address, s.city AS store_city,
              s.contact_phone AS store_phone, s.opening_hours,
              u.name AS customer_name, u.phone AS customer_phone,
              dj.id AS job_id, dj.status AS job_status, dj.earnings AS job_earnings,
              dj.claimed_at, dj.picked_up_at, dj.delivered_at, dj.seller_verified_at, dj.seller_verified_rider_id, dj.rider_id AS assigned_rider_id,
              r.name AS rider_name, r.phone AS rider_phone
       FROM orders o
       JOIN stores s ON o.store_id = s.id
       JOIN users u ON o.customer_id = u.id
       LEFT JOIN delivery_jobs dj ON dj.order_id = o.id
       LEFT JOIN users r ON dj.rider_id = r.id
       WHERE o.id = ?`
    )
    .get(orderId) as any;

  if (!order) return null;

  const items = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).all(orderId);
  const events = db
    .prepare(`SELECT event_type, actor_role, note, created_at FROM handoff_events WHERE order_id = ? ORDER BY created_at ASC`)
    .all(orderId);

  const base = {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    fulfillmentType: order.fulfillment_type,
    subtotal: order.subtotal,
    deliveryFee: order.delivery_fee,
    total: order.total,
    paymentMethod: order.payment_method,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    address: JSON.parse(order.address_snapshot || '{}'),
    acceptedAt: order.accepted_at,
    readyAt: order.ready_at,
    pickedUpAt: order.picked_up_at,
    deliveredAt: order.delivered_at,
    cancelledReason: order.cancelled_reason,
    items: (items as any[]).map((item) => ({
      id: item.id,
      productId: item.product_id,
      name: item.product_name,
      unitPrice: item.unit_price,
      quantity: item.quantity,
      lineTotal: item.line_total,
      image: item.product_image,
    })),
    timeline: events,
  };

  if (viewer === 'customer') {
    return {
      ...base,
      store: {
        id: order.store_id,
        name: order.store_name,
        address: order.store_address,
        city: order.store_city,
        phone: order.store_phone,
      },
      deliveryCode: order.delivery_code,
      rider: order.rider_name
        ? { name: order.rider_name, phone: order.rider_phone, status: order.job_status }
        : null,
      jobStatus: order.job_status,
    };
  }

  if (viewer === 'seller') {
    return {
      ...base,
      storeId: order.store_id,
      customer: { name: order.customer_name, phone: order.customer_phone },
      pickupCode: pickupCodeRevealedForOrder(order.status) ? order.pickup_code : null,
      rider: order.rider_name ? { name: order.rider_name, phone: order.rider_phone } : null,
      jobStatus: order.job_status,
      riderVerified: Boolean(order.seller_verified_at && order.seller_verified_rider_id === order.assigned_rider_id),
    };
  }

  if (viewer === 'rider') {
    return {
      ...base,
      store: {
        id: order.store_id,
        name: order.store_name,
        address: order.store_address,
        city: order.store_city,
        phone: order.store_phone,
        openingHours: order.opening_hours,
      },
      customer: { name: order.customer_name, phone: order.customer_phone },
      job: order.job_id
        ? {
            id: order.job_id,
            status: order.job_status,
            earnings: order.job_earnings,
            claimedAt: order.claimed_at,
            pickedUpAt: order.picked_up_at,
            deliveredAt: order.delivered_at,
          }
        : null,
    };
  }

  return { ...base, pickupCode: order.pickup_code, deliveryCode: order.delivery_code };
}

function pickupCodeRevealedForOrder(status: string): boolean {
  return ['ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivered'].includes(status);
}

customerRouter.get(
  '/orders',
  route((req: AuthenticatedRequest, res) => {
    const rows = db
      .prepare(`SELECT id FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100`)
      .all(req.user!.id) as any[];
    res.json({ orders: rows.map((row) => hydrateOrder(row.id, 'customer')) });
  })
);

customerRouter.get(
  '/orders/:id',
  route((req: AuthenticatedRequest, res) => {
    const owned = db
      .prepare(`SELECT id FROM orders WHERE id = ? AND customer_id = ?`)
      .get(req.params.id, req.user!.id);
    if (!owned) throw ApiError.notFound('Order not found.');
    res.json({ order: hydrateOrder(req.params.id, 'customer') });
  })
);

// Customer cancellation is only possible before the store accepts the order.
customerRouter.post(
  '/orders/:id/cancel',
  route((req: AuthenticatedRequest, res) => {
    const order = db
      .prepare(`SELECT * FROM orders WHERE id = ? AND customer_id = ?`)
      .get(req.params.id, req.user!.id) as any;
    if (!order) throw ApiError.notFound('Order not found.');
    if (order.status !== 'placed') {
      throw ApiError.badRequest(
        order.status === 'cancelled'
          ? 'This order is already cancelled.'
          : 'The store has already started processing this order. Please contact the store to cancel.'
      );
    }

    withTransaction(() => {
      const now = new Date().toISOString();
      const items = db.prepare(`SELECT product_id, quantity FROM order_items WHERE order_id = ?`).all(order.id) as any[];
      for (const item of items) restock(item.product_id, item.quantity);

      db.prepare(
        `UPDATE orders SET status = 'cancelled', cancelled_reason = ?, cancelled_by = 'customer', updated_at = ? WHERE id = ?`
      ).run('Cancelled by customer before store acceptance', now, order.id);

      db.prepare(
        `UPDATE delivery_jobs SET status = 'cancelled', cancelled_at = ?, cancelled_reason = ?, updated_at = ? WHERE order_id = ?`
      ).run(now, 'Order cancelled by customer', now, order.id);

      db.prepare(
        `INSERT INTO handoff_events (id, order_id, event_type, actor_role, actor_id, note, created_at)
         VALUES (?, ?, 'ORDER_CANCELLED', 'customer', ?, 'Order cancelled by customer', ?)`
      ).run(randomId('he'), order.id, req.user!.id, now);
    });

    res.json({ message: 'Order cancelled and stock returned to the store.', order: hydrateOrder(order.id, 'customer') });
  })
);

/* -------------------------------------------------------------------------- */
/* Stock check requests and reservations                                      */
/* -------------------------------------------------------------------------- */

function productForRequest(productId: string) {
  const product = db
    .prepare(
      `SELECT p.*, CASE WHEN s.temporarily_unavailable=1 THEN 'closed' WHEN s.is_published=0 THEN 'inactive' ELSE s.status END AS store_status, s.published_at,
              i.stock_quantity, i.reserved_quantity, (i.stock_quantity - i.reserved_quantity) AS sellable
       FROM products p JOIN stores s ON p.store_id = s.id
       JOIN inventory i ON i.product_id = p.id
       WHERE p.id = ?`
    )
    .get(productId) as any;
  if (!product) throw ApiError.notFound('Product not found.');
  if (product.store_status === 'inactive' || !product.published_at) {
    throw ApiError.badRequest('This store is not accepting requests right now.');
  }
  return product;
}

customerRouter.post(
  '/stock-requests',
  route((req: AuthenticatedRequest, res) => {
    const product = productForRequest(requirePlatformId(req.body?.productId, 'Product'));
    const quantity = requireQuantity(req.body?.requestedQuantity ?? 1, 'Requested quantity');
    const note = optionalString(req.body?.note, 'Note', { max: 300 });
    const now = new Date().toISOString();
    const id = randomId('sr');

    db.prepare(
      `INSERT INTO stock_requests (id, customer_id, store_id, product_id, requested_quantity, status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    ).run(id, req.user!.id, product.store_id, product.id, quantity, note || null, now, now);

    res.status(201).json({
      id,
      status: 'pending',
      message: `Stock check sent to ${product.store_name || 'the store'}. A confirmed check means the store has the item - it is not held for you.`,
    });
  })
);

customerRouter.get(
  '/stock-requests',
  route((req: AuthenticatedRequest, res) => {
    const requests = db
      .prepare(
        `SELECT sr.*, p.name AS product_name, p.image AS product_image, p.price AS product_price,
                s.name AS store_name
         FROM stock_requests sr
         JOIN products p ON sr.product_id = p.id
         JOIN stores s ON sr.store_id = s.id
         WHERE sr.customer_id = ?
         ORDER BY sr.created_at DESC`
      )
      .all(req.user!.id);
    res.json({ requests });
  })
);

customerRouter.post(
  '/reservations',
  route((req: AuthenticatedRequest, res) => {
    const product = productForRequest(requirePlatformId(req.body?.productId, 'Product'));
    const quantity = requireQuantity(req.body?.requestedQuantity ?? 1, 'Requested quantity');

    const existing = db
      .prepare(
        `SELECT id FROM reservations WHERE customer_id = ? AND product_id = ? AND status = 'pending'`
      )
      .get(req.user!.id, product.id);
    if (existing) {
      throw ApiError.conflict('You already have a pending reservation request for this item.', 'duplicate_reservation');
    }

    const now = new Date().toISOString();
    const id = randomId('res');
    db.prepare(
      `INSERT INTO reservations
       (id, customer_id, store_id, product_id, requested_quantity, status, note, holds_stock, requested_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?)`
    ).run(
      id,
      req.user!.id,
      product.store_id,
      product.id,
      quantity,
      optionalString(req.body?.note, 'Note', { max: 300 }) || null,
      now,
      now,
      now
    );

    res.status(201).json({
      id,
      status: 'pending',
      message:
        'Reservation requested. Stock is only held once the store confirms - you will see the status change here.',
    });
  })
);

customerRouter.get(
  '/reservations',
  route((req: AuthenticatedRequest, res) => {
    const reservations = db
      .prepare(
        `SELECT r.*, p.name AS product_name, p.image AS product_image, p.price AS product_price,
                s.name AS store_name
         FROM reservations r
         JOIN products p ON r.product_id = p.id
         JOIN stores s ON r.store_id = s.id
         WHERE r.customer_id = ?
         ORDER BY r.created_at DESC`
      )
      .all(req.user!.id);
    res.json({ reservations });
  })
);

customerRouter.post(
  '/reservations/:id/cancel',
  route((req: AuthenticatedRequest, res) => {
    const reservation = db
      .prepare(`SELECT * FROM reservations WHERE id = ? AND customer_id = ?`)
      .get(req.params.id, req.user!.id) as any;
    if (!reservation) throw ApiError.notFound('Reservation not found.');
    if (!['pending', 'confirmed'].includes(reservation.status)) {
      throw ApiError.badRequest(`This reservation is already ${reservation.status}.`);
    }

    withTransaction(() => {
      const now = new Date().toISOString();
      if (reservation.holds_stock) {
        releaseHold(reservation.product_id, reservation.requested_quantity);
      }
      db.prepare(
        `UPDATE reservations
         SET status = 'cancelled', holds_stock = 0, released_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(now, now, reservation.id);
    });

    res.json({ message: 'Reservation cancelled. Any held stock was released.' });
  })
);

/* -------------------------------------------------------------------------- */
/* Customer profile                                                           */
/* -------------------------------------------------------------------------- */

customerRouter.put(
  '/profile',
  route((req: AuthenticatedRequest, res) => {
    const name = requireString(req.body?.name ?? req.user!.name, 'Full name', { min: 2, max: 80 });
    const phone = req.body?.phone ? requirePhone(req.body.phone, 'Phone') : req.user!.phone;
    db.prepare(`UPDATE users SET name = ?, phone = ?, updated_at = ? WHERE id = ?`).run(
      name,
      phone || null,
      new Date().toISOString(),
      req.user!.id
    );
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.id);
    res.json({ user, message: 'Profile updated.' });
  })
);

export { buildCheckoutPlan };
