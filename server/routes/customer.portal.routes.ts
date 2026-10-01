import { Router } from 'express';
import { db } from '../db.js';
import { ApiError, route } from '../http.js';
import { AuthenticatedRequest, requireAuth, requireRole } from '../auth.js';
import { randomId } from '../codes.js';
import {
  SERVICE_AREAS,
  availabilityFor,
  categoryCounts,
  decorateProduct,
  decorateStore,
  queryProducts,
  queryStores,
  slugify,
} from '../catalog.js';
import { toRupees } from '../pricing.js';
import { requirePlatformId } from '../validation.js';
import { buildAccountRouter } from './account.routes.js';
import { hydrateOrder } from './customer.routes.js';

/**
 * Customer storefront + account surface (discovery, search, saved items,
 * reorder, settings, notifications, support). Every route is authenticated,
 * CUSTOMER-only, and scoped to the session's user id.
 */
export const customerPortalRouter = Router();
customerPortalRouter.use(requireAuth, requireRole('customer'));

export const STANDARD_CATEGORIES = [
  'Grocery',
  'Fruits & Vegetables',
  'Dairy',
  'Bakery',
  'Snacks',
  'Beverages',
  'Pharmacy',
  'Personal Care',
  'Household',
  'Stationery',
] as const;

function resolveCategoryParam(raw: string): string {
  // /customer/category/fruits-and-vegetables -> "Fruits & Vegetables"
  const wanted = slugify(raw);
  const known = new Set<string>(STANDARD_CATEGORIES);
  for (const row of categoryCounts()) known.add(row.category);
  for (const name of known) if (slugify(name) === wanted) return name;
  return raw;
}

/* -------------------------------- Discovery -------------------------------- */

customerPortalRouter.get(
  '/areas',
  route((_req, res) => {
    res.json({ areas: SERVICE_AREAS });
  })
);

customerPortalRouter.get(
  '/stores',
  route((req, res) => {
    res.json(queryStores(req.query));
  })
);

customerPortalRouter.get(
  '/categories',
  route((_req, res) => {
    const counts = new Map(categoryCounts().map((row) => [row.category.toLowerCase(), row]));
    const standard = STANDARD_CATEGORIES.map((name) => ({
      category: name,
      slug: slugify(name),
      count: counts.get(name.toLowerCase())?.count ?? 0,
      stores: counts.get(name.toLowerCase())?.stores ?? 0,
    }));
    const standardKeys = new Set(STANDARD_CATEGORIES.map((c) => c.toLowerCase()));
    const extra = categoryCounts()
      .filter((row) => !standardKeys.has(row.category.toLowerCase()))
      .map((row) => ({ ...row, slug: slugify(row.category) }));
    res.json({ categories: [...standard, ...extra] });
  })
);

customerPortalRouter.get(
  '/categories/:category',
  route((req, res) => {
    const category = resolveCategoryParam(req.params.category);
    const productResult = queryProducts({ ...req.query, category });
    const stores = queryStores({ lat: req.query.lat, lng: req.query.lng, category, pageSize: 50 });
    res.json({ category, slug: slugify(category), ...productResult, stores: stores.stores });
  })
);

customerPortalRouter.get(
  '/stores/:id',
  route((req, res) => {
    const row = db
      .prepare(
        `SELECT s.id, s.name, s.description, s.category, s.address, s.city, s.state, s.pincode, s.latitude, s.longitude,
                s.opening_hours, s.opens_at, s.closes_at, s.operating_days, s.contact_phone, s.contact_email, s.is_published, s.temporarily_unavailable, s.status, s.closure_type,
                s.status_message, s.image, s.logo, s.supports_delivery, s.supports_pickup, s.supports_reservations,
                s.fulfilment_min_minutes, s.fulfilment_max_minutes, s.published_at,
                (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id AND p.is_published = 1) AS product_count
         FROM stores s WHERE s.id = ? AND s.status != 'inactive' AND s.is_published=1 AND s.published_at IS NOT NULL`
      )
      .get(req.params.id) as any;
    if (!row) throw ApiError.notFound('Store not found.');

    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && row.latitude != null && row.longitude != null) {
      const d = db
        .prepare(
          `SELECT (6371 * 2 * asin(sqrt(pow(sin(radians(? - ?) / 2), 2) + cos(radians(?)) * cos(radians(?)) * pow(sin(radians(? - ?) / 2), 2)))) AS km`
        )
        .get(row.latitude, lat, lat, row.latitude, row.longitude, lng) as any;
      row.distance_km = d.km;
    }
    const categories = db
      .prepare(
        `SELECT category, COUNT(*) AS count FROM products WHERE store_id = ? AND is_published = 1 GROUP BY category ORDER BY category`
      )
      .all(req.params.id);
    const products = queryProducts({ ...req.query, storeId: req.params.id, pageSize: req.query.pageSize ?? 30 });
    res.json({ store: decorateStore(row), categories, ...products });
  })
);

customerPortalRouter.get(
  '/products',
  route((req, res) => {
    res.json(queryProducts(req.query));
  })
);

customerPortalRouter.get(
  '/products/:id',
  route((req: AuthenticatedRequest, res) => {
    const row = db
      .prepare(
        `SELECT p.id, p.store_id, p.name, p.description, p.category, p.image, p.price, p.mrp, p.brand, p.unit, p.sku,
                p.availability, p.product_info, p.additional_images AS extra_images, p.is_published, p.created_at, p.updated_at,
                s.name AS store_name, s.address AS store_address, s.city AS store_city, CASE WHEN s.is_published=0 THEN 'inactive' WHEN s.temporarily_unavailable=1 THEN 'closed' ELSE s.status END AS store_status,
                s.closure_type, s.opening_hours, s.supports_delivery, s.supports_pickup, s.supports_reservations,
                s.image AS store_image, s.published_at,
                i.stock_quantity, i.reserved_quantity, i.low_stock_threshold,
                (i.stock_quantity - i.reserved_quantity) AS stock
         FROM products p
         JOIN stores s ON p.store_id = s.id
         JOIN inventory i ON i.product_id = p.id
         WHERE p.id = ? AND s.status != 'inactive' AND s.is_published=1 AND s.published_at IS NOT NULL`
      )
      .get(req.params.id) as any;
    if (!row || !row.is_published) throw ApiError.notFound('Product not found.');

    let extraImages: string[] = [];
    try {
      extraImages = row.extra_images ? JSON.parse(row.extra_images) : [];
    } catch {
      extraImages = [];
    }
    const saved = db
      .prepare(`SELECT id FROM saved_items WHERE customer_id = ? AND product_id = ?`)
      .get(req.user!.id, row.id);
    const latestStockRequest = db
      .prepare(
        `SELECT id, requested_quantity, status, seller_response, created_at FROM stock_requests
         WHERE customer_id = ? AND product_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(req.user!.id, row.id);
    res.json({
      product: { ...decorateProduct(row), extra_images: extraImages, saved: Boolean(saved) },
      latestStockRequest: latestStockRequest ?? null,
    });
  })
);

/* ---------------------------------- Search --------------------------------- */

customerPortalRouter.get(
  '/search',
  route((req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    const products = queryProducts({ ...req.query, query: q, pageSize: req.query.pageSize ?? 24 });
    const stores = queryStores({
      query: q,
      lat: req.query.lat,
      lng: req.query.lng,
      maxDistanceKm: req.query.maxDistanceKm,
      category: req.query.category,
      pageSize: 12,
    });
    const needle = q.toLowerCase();
    const categories = needle
      ? categoryCounts().filter((row) => row.category.toLowerCase().includes(needle))
      : [];
    res.json({
      query: q,
      products: products.products,
      productTotal: products.total,
      page: products.page,
      pageSize: products.pageSize,
      hasMore: products.hasMore,
      stores: stores.stores,
      storeTotal: stores.total,
      categories: categories.map((row) => ({ ...row, slug: slugify(row.category) })),
    });
  })
);

/* ---------------------------------- Home ----------------------------------- */

customerPortalRouter.get(
  '/dashboard',
  route((req: AuthenticatedRequest, res) => {
    const customerId = req.user!.id;
    const geo = { lat: req.query.lat, lng: req.query.lng };

    const stores = queryStores({ ...geo, pageSize: 8 });
    const counts = new Map(categoryCounts().map((row) => [row.category.toLowerCase(), row]));
    const categories = STANDARD_CATEGORIES.map((name) => ({
      category: name,
      slug: slugify(name),
      count: counts.get(name.toLowerCase())?.count ?? 0,
    }));

    // "Popular" is real: units ordered across non-cancelled orders in the last 30 days.
    const popularIds = db
      .prepare(
        `SELECT oi.product_id AS id, SUM(oi.quantity) AS units
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.status NOT IN ('cancelled','rejected') AND o.created_at > ?
         GROUP BY oi.product_id ORDER BY units DESC LIMIT 12`
      )
      .all(new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()) as any[];

    let popular = [] as any[];
    let popularBasis: 'orders' | 'recent' = 'recent';
    if (popularIds.length > 0) {
      const all = queryProducts({ ...geo, inStockOnly: 'true', pageSize: 60 }).products;
      const rank = new Map(popularIds.map((row, index) => [row.id, index]));
      popular = all.filter((p: any) => rank.has(p.id)).sort((a: any, b: any) => rank.get(a.id)! - rank.get(b.id)!).slice(0, 8);
      popularBasis = 'orders';
    }
    if (popular.length < 4) {
      const fill = queryProducts({ ...geo, sort: 'newest', pageSize: 12 }).products.filter(
        (p: any) => !popular.some((x) => x.id === p.id)
      );
      popular = [...popular, ...fill].slice(0, 8);
      if (popularBasis === 'orders' && popular.length === 0) popularBasis = 'recent';
    }

    const activeRow = db
      .prepare(
        `SELECT id FROM orders WHERE customer_id = ? AND status NOT IN ('delivered','cancelled','rejected')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(customerId) as any;
    const activeCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM orders WHERE customer_id = ? AND status NOT IN ('delivered','cancelled','rejected')`
        )
        .get(customerId) as any
    ).c;

    const defaultAddress = db
      .prepare(
        `SELECT id, label, address_line, city, latitude, longitude FROM customer_addresses
         WHERE customer_id = ? ORDER BY is_default DESC, created_at DESC LIMIT 1`
      )
      .get(customerId) as any;

    res.json({
      stores: stores.stores,
      categories,
      popularProducts: popular,
      popularBasis,
      activeOrder: activeRow ? hydrateOrder(activeRow.id, 'customer') : null,
      activeOrderCount: activeCount,
      defaultAddress: defaultAddress ?? null,
    });
  })
);

/* ------------------------------- Saved items ------------------------------- */

customerPortalRouter.get(
  '/saved',
  route((req: AuthenticatedRequest, res) => {
    // Always the CURRENT price and stock, never a stored snapshot.
    const rows = db
      .prepare(
        `SELECT p.id, p.store_id, p.name, p.description, p.category, p.image, p.price, p.brand, p.unit,
                p.availability, p.is_published, si.created_at AS saved_at,
                s.name AS store_name, CASE WHEN s.is_published=0 THEN 'inactive' WHEN s.temporarily_unavailable=1 THEN 'closed' ELSE s.status END AS store_status, s.city AS store_city,
                i.low_stock_threshold, (i.stock_quantity - i.reserved_quantity) AS stock
         FROM saved_items si
         JOIN products p ON p.id = si.product_id
         JOIN stores s ON s.id = p.store_id
         JOIN inventory i ON i.product_id = p.id
         WHERE si.customer_id = ? ORDER BY si.created_at DESC LIMIT 200`
      )
      .all(req.user!.id) as any[];
    res.json({ items: rows.map((row) => decorateProduct(row)) });
  })
);

customerPortalRouter.post(
  '/saved',
  route((req: AuthenticatedRequest, res) => {
    const productId = requirePlatformId(req.body?.productId, 'Product');
    const exists = db
      .prepare(
        `SELECT p.id FROM products p JOIN stores s ON s.id = p.store_id
         WHERE p.id = ? AND p.is_published = 1 AND s.status != 'inactive' AND s.is_published=1 AND s.published_at IS NOT NULL`
      )
      .get(productId);
    if (!exists) throw ApiError.notFound('Product not found.');
    db.prepare(
      `INSERT INTO saved_items (id, customer_id, product_id, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(customer_id, product_id) DO NOTHING`
    ).run(randomId('sv'), req.user!.id, productId, new Date().toISOString());
    res.status(201).json({ saved: true, message: 'Saved for later.' });
  })
);

customerPortalRouter.delete(
  '/saved/:productId',
  route((req: AuthenticatedRequest, res) => {
    db.prepare(`DELETE FROM saved_items WHERE customer_id = ? AND product_id = ?`).run(
      req.user!.id,
      req.params.productId
    );
    res.json({ saved: false, message: 'Removed from saved items.' });
  })
);

/* --------------------------------- Reorder --------------------------------- */

/**
 * "Buy Again" never recreates the old order. Each line is re-checked against the
 * CURRENT product, price, stock and store status, and only what is truly
 * purchasable now is added to the cart.
 */
customerPortalRouter.post(
  '/orders/:id/reorder',
  route((req: AuthenticatedRequest, res) => {
    const order = db
      .prepare(`SELECT id, status FROM orders WHERE id = ? AND customer_id = ?`)
      .get(req.params.id, req.user!.id) as any;
    if (!order) throw ApiError.notFound('Order not found.');
    if (!['delivered', 'cancelled', 'rejected'].includes(order.status)) {
      throw ApiError.badRequest('You can buy again once the order is completed.');
    }

    const items = db
      .prepare(`SELECT product_id, product_name, unit_price, quantity FROM order_items WHERE order_id = ?`)
      .all(order.id) as any[];

    let cart = db.prepare(`SELECT id FROM carts WHERE customer_id = ?`).get(req.user!.id) as any;
    const now = new Date().toISOString();
    if (!cart) {
      cart = { id: randomId('cart') };
      db.prepare(`INSERT INTO carts (id, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
        cart.id,
        req.user!.id,
        now,
        now
      );
    }

    const added: any[] = [];
    const skipped: any[] = [];
    for (const item of items) {
      const live = db
        .prepare(
          `SELECT p.id, p.name, p.price, p.is_published, p.availability, CASE WHEN s.is_published=0 THEN 'inactive' WHEN s.temporarily_unavailable=1 THEN 'closed' ELSE s.status END AS store_status, s.published_at,
                  (i.stock_quantity - i.reserved_quantity) AS stock
           FROM products p JOIN stores s ON s.id = p.store_id JOIN inventory i ON i.product_id = p.id
           WHERE p.id = ?`
        )
        .get(item.product_id) as any;
      if (!live || !live.is_published || live.availability !== 'available') {
        skipped.push({ name: item.product_name, reason: 'No longer available' });
        continue;
      }
      if (live.store_status !== 'open' || !live.published_at) {
        skipped.push({ name: item.product_name, reason: 'Store is currently closed' });
        continue;
      }
      const existing = db
        .prepare(`SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ?`)
        .get(cart.id, live.id) as any;
      const wanted = Math.max(item.quantity, existing?.quantity ?? 0);
      const quantity = Math.min(wanted, live.stock);
      if (quantity <= 0) {
        skipped.push({ name: item.product_name, reason: 'Out of stock' });
        continue;
      }
      if (existing) {
        db.prepare(`UPDATE cart_items SET quantity = ?, price_at_add = ?, updated_at = ? WHERE id = ?`).run(
          quantity,
          live.price,
          now,
          existing.id
        );
      } else {
        db.prepare(
          `INSERT INTO cart_items (id, cart_id, product_id, quantity, price_at_add, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(randomId('ci'), cart.id, live.id, quantity, live.price, now, now);
      }
      added.push({
        name: live.name,
        quantity,
        requested: item.quantity,
        reducedForStock: quantity < item.quantity,
        previousPrice: toRupees(item.unit_price),
        currentPrice: toRupees(live.price),
        priceChanged: Math.abs(item.unit_price - live.price) > 0.001,
      });
    }
    db.prepare(`UPDATE carts SET updated_at = ? WHERE id = ?`).run(now, cart.id);
    res.json({
      message:
        added.length === 0
          ? 'None of these items can be added right now.'
          : `${added.length} item${added.length === 1 ? '' : 's'} added to your cart at current prices.`,
      added,
      skipped,
    });
  })
);

/* --------------------------- Data export (privacy) -------------------------- */

customerPortalRouter.get(
  '/settings/export',
  route((req: AuthenticatedRequest, res) => {
    const id = req.user!.id;
    const user = db
      .prepare(`SELECT id, name, email, phone, created_at FROM users WHERE id = ?`)
      .get(id);
    res.json({
      exportedAt: new Date().toISOString(),
      profile: user,
      addresses: db.prepare(`SELECT * FROM customer_addresses WHERE customer_id = ?`).all(id),
      orders: db
        .prepare(`SELECT order_number, status, total, fulfillment_type, created_at FROM orders WHERE customer_id = ?`)
        .all(id),
      savedItems: db.prepare(`SELECT product_id, created_at FROM saved_items WHERE customer_id = ?`).all(id),
    });
  })
);

customerPortalRouter.use(buildAccountRouter('customer'));

void availabilityFor;
