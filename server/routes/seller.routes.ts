import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { config } from '../config.js';
import { ApiError, route } from '../http.js';
import { type AuthenticatedRequest, requireAuth, requireRole } from '../auth.js';
import { rateLimit } from '../rateLimit.js';
import { randomId, codesMatch } from '../codes.js';
import { createInventoryForProduct, getInventory, releaseHold, restock, setStock, tryHoldStock, fulfilHold } from '../inventory.js';
import { toRupees } from '../pricing.js';
import { assertSellerTransition, ORDER_STATUSES, statusLabel } from '../orderStateMachine.js';
import { hydrateOrder } from './customer.routes.js';
import { auditSeller, dateFilter, pageMeta, pagination, priceFilters, queryText, requireSellerStore, sellerStore } from '../seller.js';
import { publicStore, storefrontProducts } from '../storefront.js';
import { buildAccountRouter } from './account.routes.js';
import { audit, notifyCustomerOfOrder } from '../notifications.js';
import { decorateStore, queryProducts } from '../catalog.js';
import { sellerWorkspaceRouter } from './seller-workspace.routes.js';
import { optionalCoordinate, optionalPhone, optionalString, requireEmail, requireEnum, requireNumber, requirePincode, requirePositiveInt, requireString, sanitizeText } from '../validation.js';

export const sellerRouter = Router();
sellerRouter.use(requireAuth, requireRole('seller'));
sellerRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

export const PRODUCT_CATEGORIES = ['Grocery', 'Fruits & Vegetables', 'Dairy', 'Bakery', 'Snacks', 'Beverages', 'Personal Care', 'Household', 'Stationery', 'Pharmacy', 'Staples & Grains', 'Oils & Ghee', 'Frozen Foods'] as const;
const AVAILABILITY = ['available', 'unavailable', 'temporary'] as const;
export const productSelect = `SELECT p.*, i.stock_quantity, i.reserved_quantity, i.low_stock_threshold,
  i.version AS inventory_version, i.stock_quantity - i.reserved_quantity AS sellable
  FROM products p JOIN inventory i ON i.product_id = p.id`;
const productJson = (p: any) => ({ ...p, additional_images: JSON.parse(p.additional_images || '[]') });

function timeInput(value: unknown, fallback: string): string {
  const time = optionalString(value, 'Time', { max: 5 }) ?? fallback;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw ApiError.badRequest('Use a valid 24-hour time (HH:MM).');
  return time;
}
export function imageUrl(value: unknown): string | null {
  const url = optionalString(value, 'Image URL', { max: 500 });
  if (!url) return null;
  if (!/^\/(?!\/)[^\s\\]+$/.test(url) && !/^https?:\/\/[^\s]+$/i.test(url)) {
    throw ApiError.badRequest('Use a relative image path or an http/https image URL.');
  }
  return url;
}
function imageList(value: unknown): string {
  if (value === undefined) return '[]';
  if (!Array.isArray(value) || value.length > 5) throw ApiError.badRequest('Add at most five additional images.');
  return JSON.stringify(value.map(imageUrl).filter(Boolean));
}

/* Store identity, operations and visibility are separate controls. */
sellerRouter.get('/store', route((req: AuthenticatedRequest, res) => res.json({ store: sellerStore(req.user!.id) })));
sellerRouter.get('/store/preview', route((req: AuthenticatedRequest, res) => {
  const store = requireSellerStore(req.user!.id);
  const products = queryProducts({ ...req.query, storeId: store.id, includeUnpublishedStores: true });
  const categories = db.prepare('SELECT category,COUNT(*) AS count FROM products WHERE store_id=? AND is_published=1 GROUP BY category ORDER BY category').all(store.id);
  res.json({ store: decorateStore(publicStore(store)), visibleToCustomers: Boolean(store.is_published && store.status !== 'inactive'), categories, ...products });
}));
sellerRouter.post('/store', route((req: AuthenticatedRequest, res) => {
  const sellerId = req.user!.id;
  const existing = sellerStore(sellerId);
  const name = requireString(req.body?.name, 'Store name', { min: 3, max: 80 });
  const address = requireString(req.body?.address, 'Address', { min: 5, max: 240 });
  const category = requireString(req.body?.category ?? 'Grocery', 'Category', { min: 2, max: 60 });
  const description = sanitizeText(optionalString(req.body?.description, 'Description', { max: 600 }) ?? '');
  const city = requireString(req.body?.city, 'City', { min: 2, max: 80 });
  const state = requireString(req.body?.state ?? 'Delhi', 'State', { min: 2, max: 80 });
  const pincode = requirePincode(req.body?.pincode);
  const opensAt = timeInput(req.body?.opensAt, '08:00');
  const closesAt = timeInput(req.body?.closesAt, '22:00');
  const operatingDays = requireString(req.body?.operatingDays ?? 'Mon-Sun', 'Operating days', { max: 60 });
  if (!/^(Mon-Sun|Mon-Sat|Tue-Sun|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:,\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun))*)$/.test(operatingDays)) {
    throw ApiError.badRequest('Select at least one valid operating day.');
  }
  const latitude = optionalCoordinate(req.body?.latitude, 'Latitude', { min: -90, max: 90 });
  const longitude = optionalCoordinate(req.body?.longitude, 'Longitude', { min: -180, max: 180 });
  if ((latitude === undefined) !== (longitude === undefined)) throw ApiError.badRequest('Provide both latitude and longitude.');
  const phone = optionalPhone(req.body?.contactPhone) ?? null;
  const email = req.body?.contactEmail ? requireEmail(req.body.contactEmail) : null;
  const image = req.body?.image === undefined ? existing?.image ?? null : imageUrl(req.body.image);
  const logo = req.body?.logo === undefined ? existing?.logo ?? null : imageUrl(req.body.logo);
  const status = requireEnum(req.body?.status ?? existing?.status ?? 'inactive', 'Store status', ['open', 'closed', 'inactive'] as const);
  const delivery = req.body?.supportsDelivery === false ? 0 : 1;
  const pickup = req.body?.supportsPickup === false ? 0 : 1;
  if (!delivery && !pickup) throw ApiError.badRequest('Enable at least one fulfilment method.');
  const now = new Date().toISOString();
  const id = existing?.id ?? randomId('store');
  withTransaction(() => {
    if (existing) {
      db.prepare(`UPDATE stores SET name=?, description=?, category=?, address=?, city=?, state=?, pincode=?,
        latitude=?, longitude=?, opening_hours=?, opens_at=?, closes_at=?, operating_days=?, contact_phone=?,
        contact_email=?, status=?, image=?, logo=?, supports_delivery=?, supports_pickup=?,
        is_published=CASE WHEN ?='inactive' THEN 0 ELSE is_published END, updated_at=? WHERE id=? AND seller_id=?`)
        .run(name, description, category, address, city, state, pincode, latitude ?? null, longitude ?? null,
          `${opensAt} - ${closesAt} (${operatingDays})`, opensAt, closesAt, operatingDays, phone, email, status,
          image, logo, delivery, pickup, status, now, id, sellerId);
    } else {
      const published = status === 'inactive' ? 0 : 1;
      db.prepare(`INSERT INTO stores (id,seller_id,name,description,category,address,city,state,pincode,latitude,longitude,
        opening_hours,opens_at,closes_at,operating_days,contact_phone,contact_email,status,image,logo,
        supports_delivery,supports_pickup,is_published,published_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, sellerId, name, description, category, address, city, state, pincode, latitude ?? null, longitude ?? null,
          `${opensAt} - ${closesAt} (${operatingDays})`, opensAt, closesAt, operatingDays, phone, email, status, image, logo,
          delivery, pickup, published, published ? now : null, now, now);
    }
    auditSeller(sellerId, existing ? 'store.updated' : 'store.created', id);
  });
  res.status(existing ? 200 : 201).json({ store: sellerStore(sellerId), message: 'Store details saved.' });
}));

sellerRouter.post('/store/status', route((req: AuthenticatedRequest, res) => {
  const store = requireSellerStore(req.user!.id);
  const status = requireEnum(req.body?.status, 'Status', ['open', 'closed', 'temporary'] as const);
  if (status === 'open' && !store.is_published) throw ApiError.conflict('Publish your store before opening it for orders.');
  withTransaction(() => {
    db.prepare(`UPDATE stores SET status=?, temporarily_unavailable=?, updated_at=? WHERE id=?`)
      .run(status === 'open' ? 'open' : 'closed', status === 'temporary' ? 1 : 0, new Date().toISOString(), store.id);
    auditSeller(req.user!.id, 'store.status', store.id, status);
  });
  res.json({ store: sellerStore(req.user!.id), message: status === 'open' ? 'Your store is open for new orders.' : 'New checkout is paused. Existing orders can still be prepared.' });
}));
for (const publish of [true, false]) {
  sellerRouter.post(`/store/${publish ? 'publish' : 'unpublish'}`, route((req: AuthenticatedRequest, res) => {
    const store = requireSellerStore(req.user!.id);
    const now = new Date().toISOString();
    withTransaction(() => {
      db.prepare(`UPDATE stores SET is_published=?, status=?, temporarily_unavailable=0,
        published_at=CASE WHEN ?=1 THEN COALESCE(published_at, ?) ELSE published_at END, updated_at=? WHERE id=?`)
        .run(publish ? 1 : 0, publish ? (store.status === 'inactive' ? 'open' : store.status) : 'inactive', publish ? 1 : 0, now, now, store.id);
      auditSeller(req.user!.id, publish ? 'store.published' : 'store.unpublished', store.id);
    });
    res.json({ store: sellerStore(req.user!.id), message: publish ? 'Your store is now visible to nearby customers.' : 'Store unpublished. Existing orders remain accessible.' });
  }));
}

/* Keep the status/settings API already shipped on main. */
sellerRouter.put(
  '/store/status',
  route((req: AuthenticatedRequest, res) => {
    const store = requireSellerStore(req.user!.id);
    const status = requireEnum(req.body?.status, 'Store status', ['open', 'closed'] as const);
    const closureType =
      status === 'closed'
        ? requireEnum(req.body?.closureType ?? 'closed', 'Closure type', ['closed', 'temporarily_unavailable'] as const)
        : null;
    const message = optionalString(req.body?.message, 'Message', { max: 160 }) || null;
    if (status === 'open' && !store.is_published) throw ApiError.conflict('Publish your store before opening it for orders.');
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE stores SET status = ?, closure_type = ?, status_message = ?, temporarily_unavailable = ?,
         published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?`
    ).run(status, closureType, status === 'closed' ? message : null, closureType === 'temporarily_unavailable' ? 1 : 0, now, now, store.id);
    audit(req.user!.id, 'seller', `store.${status}`, 'store', store.id, { closureType });
    res.json({
      store: sellerStore(req.user!.id),
      message:
        status === 'open'
          ? 'Your store is open. Customers can place new orders.'
          : 'Your store is closed. Customers can browse but cannot check out; open orders stay active.',
    });
  })
);

sellerRouter.put(
  '/store/settings',
  route((req: AuthenticatedRequest, res) => {
    const store = requireSellerStore(req.user!.id);
    const bool = (v: unknown, current: number) => (v === undefined ? current : v ? 1 : 0);
    const minutes = (v: unknown, label: string, current: number | null) =>
      v === undefined || v === null || v === ''
        ? v === undefined ? current : null
        : requirePositiveInt(v, label, { min: 5, max: 480 });
    const fMin = minutes(req.body?.fulfilmentMinMinutes, 'Minimum fulfilment time', store.fulfilment_min_minutes);
    const fMax = minutes(req.body?.fulfilmentMaxMinutes, 'Maximum fulfilment time', store.fulfilment_max_minutes);
    if (fMin !== null && fMax !== null && fMin > fMax) {
      throw ApiError.badRequest('Minimum fulfilment time cannot exceed the maximum.');
    }
    const supportsDelivery = bool(req.body?.supportsDelivery, store.supports_delivery);
    const supportsPickup = bool(req.body?.supportsPickup, store.supports_pickup);
    if (!supportsDelivery && !supportsPickup) {
      throw ApiError.badRequest('Enable at least one of delivery or pickup.');
    }
    const logo = req.body?.logo !== undefined ? optionalString(req.body.logo, 'Logo', { max: 500 }) || null : store.logo;
    db.prepare(
      `UPDATE stores SET supports_delivery = ?, supports_pickup = ?, supports_reservations = ?,
         fulfilment_min_minutes = ?, fulfilment_max_minutes = ?, logo = ?,
         legal_name = ?, business_email = ?, support_phone = ?, updated_at = ? WHERE id = ?`
    ).run(
      supportsDelivery,
      supportsPickup,
      bool(req.body?.supportsReservations, store.supports_reservations),
      fMin,
      fMax,
      logo,
      req.body?.legalName !== undefined ? optionalString(req.body.legalName, 'Legal name', { max: 120 }) || null : store.legal_name,
      req.body?.businessEmail !== undefined ? optionalString(req.body.businessEmail, 'Business email', { max: 120 }) || null : store.business_email,
      req.body?.supportPhone !== undefined ? optionalPhone(req.body.supportPhone) || null : store.support_phone,
      new Date().toISOString(),
      store.id
    );
    res.json({ store: sellerStore(req.user!.id), message: 'Store settings saved.' });
  })
);


sellerRouter.get(
  '/inventory/events',
  route((req: AuthenticatedRequest, res) => {
    const store = sellerStore(req.user!.id);
    if (!store) {
      res.json({ events: [], total: 0, page: 1 });
      return;
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 30));
    const productId = typeof req.query.productId === 'string' ? req.query.productId : null;
    const where = `e.store_id = ? ${productId ? 'AND e.product_id = ?' : ''}`;
    const params: any[] = productId ? [store.id, productId] : [store.id];
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM inventory_events e WHERE ${where}`).get(...params) as any).c;
    const events = db
      .prepare(
        `SELECT e.id, e.product_id, p.name AS product_name, e.type, e.delta, e.resulting_stock, e.note, e.created_at
         FROM inventory_events e JOIN products p ON p.id = e.product_id
         WHERE ${where} ORDER BY e.created_at DESC, e.rowid DESC LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize);
    res.json({ events, total, page, pageSize, hasMore: page * pageSize < total });
  })
);


/* Catalog and inventory: bounded SQL queries, ownership checked on every ID. */
function catalogFilters(req: any, storeId: string) {
  const clauses = ['p.store_id = ?']; const values: any[] = [storeId];
  const search = queryText(req.query.query);
  if (search) { clauses.push('(p.name LIKE ? OR p.sku LIKE ? OR p.brand LIKE ?)'); values.push(...Array(3).fill(`%${search}%`)); }
  if (req.query.category) { clauses.push('p.category = ?'); values.push(queryText(req.query.category, 60)); }
  if (req.query.published !== undefined && req.query.published !== '') {
    const published = requireEnum(req.query.published, 'Published', ['true', 'false'] as const);
    clauses.push('p.is_published = ?'); values.push(published === 'true' ? 1 : 0);
  }
  if (req.query.availability) { clauses.push('p.availability = ?'); values.push(requireEnum(req.query.availability, 'Availability', AVAILABILITY)); }
  if (req.query.stock) {
    const stock = requireEnum(req.query.stock, 'Stock', ['healthy', 'low', 'out', 'in_stock'] as const);
    clauses.push(stock === 'healthy' ? 'i.stock_quantity-i.reserved_quantity > i.low_stock_threshold'
      : stock === 'low' ? 'i.stock_quantity-i.reserved_quantity > 0 AND i.stock_quantity-i.reserved_quantity <= i.low_stock_threshold'
      : stock === 'out' ? 'i.stock_quantity-i.reserved_quantity = 0' : 'i.stock_quantity-i.reserved_quantity > 0');
  }
  priceFilters(req, 'p.price', clauses, values);
  return { where: clauses.join(' AND '), values };
}
function inventorySummary(storeId: string) {
  return db.prepare(`SELECT COUNT(*) AS products, COALESCE(SUM(stock_quantity),0) AS units,
    COALESCE(SUM(reserved_quantity),0) AS reserved,
    COALESCE(SUM(stock_quantity-reserved_quantity>0),0) AS inStock,
    COALESCE(SUM(stock_quantity-reserved_quantity>0 AND stock_quantity-reserved_quantity<=low_stock_threshold),0) AS lowStock,
    COALESCE(SUM(stock_quantity-reserved_quantity=0),0) AS outOfStock,
    COALESCE(SUM(stock_quantity-reserved_quantity>low_stock_threshold),0) AS healthy
    FROM inventory i JOIN products p ON p.id=i.product_id WHERE p.store_id=?`).get(storeId);
}
for (const inventory of [false, true]) {
  sellerRouter.get(inventory ? '/inventory' : '/products', route((req: AuthenticatedRequest, res) => {
    expireReservations();
    const store = sellerStore(req.user!.id); const { page, pageSize, offset } = pagination(req, inventory ? 20 : 12);
    if (!store) { res.json({ [inventory ? 'inventory' : 'products']: [], categories: [], summary: { products: 0, units: 0, reserved: 0, inStock: 0, lowStock: 0, outOfStock: 0, healthy: 0 }, pagination: pageMeta(0, page, pageSize) }); return; }
    const { where, values } = catalogFilters(req, store.id);
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM products p JOIN inventory i ON i.product_id=p.id WHERE ${where}`).get(...values) as any).n;
    const rows = db.prepare(`${productSelect} WHERE ${where} ORDER BY ${inventory ? 'sellable ASC,' : ''} p.name COLLATE NOCASE, p.id LIMIT ? OFFSET ?`).all(...values, pageSize, offset) as any[];
    res.json({ [inventory ? 'inventory' : 'products']: rows.map(productJson), summary: inventorySummary(store.id),
      categories: db.prepare('SELECT DISTINCT category FROM products WHERE store_id=? ORDER BY category').all(store.id), pagination: pageMeta(total, page, pageSize) });
  }));
}
sellerRouter.get('/products/:id', route((req: AuthenticatedRequest, res) => {
  const store = requireSellerStore(req.user!.id);
  const product = db.prepare(`${productSelect} WHERE p.id=? AND p.store_id=?`).get(req.params.id, store.id);
  if (!product) throw ApiError.notFound('Product not found in your store.');
  res.json({ product: productJson(product) });
}));
function productInput(body: any, existing: any = {}) {
  const price = toRupees(requireNumber(body.price ?? existing.price, 'Selling price', { min: 0.5, max: 1_000_000 }));
  const mrpInput = body.mrp === undefined ? existing.mrp : body.mrp;
  const mrp = mrpInput === null || mrpInput === '' || mrpInput === undefined ? null : toRupees(requireNumber(mrpInput, 'MRP', { min: price, max: 1_000_000 }));
  if (body.isPublished !== undefined && typeof body.isPublished !== 'boolean') throw ApiError.badRequest('Publishing must be a boolean.');
  return {
    name: sanitizeText(requireString(body.name ?? existing.name, 'Product name', { min: 2, max: 120 })),
    description: sanitizeText(optionalString(body.description ?? existing.description, 'Description', { max: 600 }) ?? ''),
    category: requireEnum(body.category ?? existing.category ?? 'Grocery', 'Category', PRODUCT_CATEGORIES), price, mrp,
    productInfo: body.productInfo === undefined ? existing.product_info ?? null : sanitizeText(optionalString(body.productInfo, 'Product information', { max: 1000 }) ?? ''),
    brand: optionalString(body.brand ?? existing.brand, 'Brand', { max: 80 }) ?? null,
    unit: optionalString(body.unit ?? existing.unit, 'Unit / size', { max: 40 }) ?? null,
    sku: optionalString(body.sku ?? existing.sku, 'SKU', { max: 60 }) ?? null,
    image: body.image === undefined ? existing.image ?? null : imageUrl(body.image),
    images: body.additionalImages === undefined ? existing.additional_images ?? '[]' : imageList(body.additionalImages),
    availability: requireEnum(body.availability ?? existing.availability ?? 'available', 'Availability', AVAILABILITY),
    published: body.isPublished === undefined ? existing.is_published ?? 0 : body.isPublished ? 1 : 0,
    threshold: requirePositiveInt(body.lowStockThreshold ?? existing.low_stock_threshold ?? 5, 'Low-stock threshold', { min: 0, max: 100000 }),
  };
}
function assertUniqueSku(storeId: string, sku: string | null, exceptId = '') {
  if (sku && db.prepare('SELECT id FROM products WHERE store_id=? AND sku=? AND id != ?').get(storeId, sku, exceptId)) {
    throw ApiError.conflict('This SKU is already used by another product in your store.');
  }
}
sellerRouter.post('/products', route((req: AuthenticatedRequest, res) => {
  const store = requireSellerStore(req.user!.id); const input = productInput(req.body ?? {});
  const stock = requirePositiveInt(req.body?.stock ?? 0, 'Initial stock', { min: 0, max: 100000 });
  const id = randomId('prod'); const now = new Date().toISOString();
  withTransaction(() => {
    assertUniqueSku(store.id, input.sku);
    db.prepare(`INSERT INTO products (id,store_id,name,description,category,price,mrp,brand,unit,sku,image,additional_images,
      availability,is_published,stock,product_info,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, store.id, input.name, input.description, input.category, input.price, input.mrp, input.brand, input.unit,
        input.sku, input.image, input.images, input.availability, input.published, stock, input.productInfo, now, now);
    createInventoryForProduct(id, stock);
    db.prepare('UPDATE inventory SET low_stock_threshold=? WHERE product_id=?').run(input.threshold, id);
    auditSeller(req.user!.id, 'product.created', id);
  });
  res.status(201).json({ product: productJson(db.prepare(`${productSelect} WHERE p.id=?`).get(id)), message: input.published ? 'Product saved and published.' : 'Product saved as a draft.' });
}));
sellerRouter.put('/products/:id', route((req: AuthenticatedRequest, res) => {
  const store = requireSellerStore(req.user!.id);
  const existing = db.prepare(`${productSelect} WHERE p.id=? AND p.store_id=?`).get(req.params.id, store.id) as any;
  if (!existing) throw ApiError.notFound('Product not found in your store.');
  if (req.body?.expectedUpdatedAt && req.body.expectedUpdatedAt !== existing.updated_at) throw ApiError.conflict('This product changed. Refresh before saving.', 'product_conflict');
  const input = productInput(req.body ?? {}, existing); const now = new Date().toISOString(); let note: string | null = null;
  withTransaction(() => {
    assertUniqueSku(store.id, input.sku, existing.id);
    db.prepare(`UPDATE products SET name=?,description=?,category=?,price=?,mrp=?,brand=?,unit=?,sku=?,image=?,additional_images=?,
      availability=?,is_published=?,product_info=?,updated_at=? WHERE id=? AND store_id=?`)
      .run(input.name, input.description, input.category, input.price, input.mrp, input.brand, input.unit, input.sku, input.image,
        input.images, input.availability, input.published, input.productInfo, now, existing.id, store.id);
    if (req.body?.stock !== undefined) {
      const desired = requirePositiveInt(req.body.stock, 'Stock', { min: 0, max: 100000 });
      const expectedVersion = req.body.expectedVersion === undefined ? undefined : requirePositiveInt(req.body.expectedVersion, 'Inventory version');
      const result = setStock(existing.id, desired, { actorId: req.user!.id, expectedVersion });
      if (result.clampedToReserved) note = `Stock was kept at ${result.stockQuantity} to protect confirmed reservations.`;
    }
    db.prepare('UPDATE inventory SET low_stock_threshold=?, version=version+1, updated_at=? WHERE product_id=?')
      .run(input.threshold, now, existing.id);
    auditSeller(req.user!.id, 'product.updated', existing.id);
  });
  res.json({ product: productJson(db.prepare(`${productSelect} WHERE p.id=?`).get(existing.id)), message: 'Product updated.', note });
}));
sellerRouter.post('/products/:id/stock', route((req: AuthenticatedRequest, res) => {
  const store = requireSellerStore(req.user!.id);
  if (!db.prepare('SELECT id FROM products WHERE id=? AND store_id=?').get(req.params.id, store.id)) throw ApiError.notFound('Product not found in your store.');
  const mode = requireEnum(req.body?.mode ?? 'set', 'Mode', ['set', 'delta'] as const);
  const value = requirePositiveInt(req.body?.value, 'Stock value', { min: mode === 'set' ? 0 : -100000, max: 100000 });
  const expectedVersion = req.body.expectedVersion === undefined ? undefined : requirePositiveInt(req.body.expectedVersion, 'Inventory version');
  let result: ReturnType<typeof setStock>;
  withTransaction(() => {
    const current = getInventory(req.params.id)!;
    const next = mode === 'delta' ? current.stockQuantity + value : value;
    if (next < 0 || next > 100000) throw ApiError.badRequest('Stock must be between 0 and 100,000 units.');
    result = setStock(req.params.id, next, { expectedVersion, actorId: req.user!.id, reason: optionalString(req.body?.reason, 'Adjustment note', { max: 200 }) ?? 'seller_adjustment' });
    auditSeller(req.user!.id, 'inventory.adjusted', req.params.id, `${mode}: ${value}`);
  });
  res.json({ inventory: getInventory(req.params.id), message: result!.clampedToReserved ? `Stock kept at ${result!.stockQuantity} to protect reservation holds.` : `Stock updated to ${result!.stockQuantity}.` });
}));
sellerRouter.get('/inventory/:id/events', route((req: AuthenticatedRequest, res) => {
  const store = requireSellerStore(req.user!.id);
  if (!db.prepare('SELECT id FROM products WHERE id=? AND store_id=?').get(req.params.id, store.id)) throw ApiError.notFound('Product not found.');
  res.json({ events: db.prepare(`SELECT reason,stock_before,stock_after,reserved_before,reserved_after,created_at FROM inventory_events
    WHERE product_id=? AND store_id=? ORDER BY created_at DESC LIMIT 30`).all(req.params.id, store.id) });
}));
sellerRouter.delete('/products/:id', route((req: AuthenticatedRequest, res) => {
  const store = requireSellerStore(req.user!.id);
  withTransaction(() => {
    if (!db.prepare('UPDATE products SET is_published=0,updated_at=? WHERE id=? AND store_id=?').run(new Date().toISOString(), req.params.id, store.id).changes) throw ApiError.notFound('Product not found.');
    auditSeller(req.user!.id, 'product.unpublished', req.params.id);
  });
  res.json({ message: 'Product unpublished.' });
}));

/* Orders: only the documented state machine, no seller-delivered shortcut. */
sellerRouter.get('/orders', route((req: AuthenticatedRequest, res) => {
  const store = sellerStore(req.user!.id); const { page, pageSize, offset } = pagination(req);
  if (!store) { res.json({ orders: [], counts: {}, pagination: pageMeta(0, page, pageSize) }); return; }
  const clauses = ['store_id=?']; const values: any[] = [store.id];
  const tabGroups: Record<string, string[]> = { new: ['placed'], preparing: ['accepted', 'preparing', 'packed'], ready: ['ready_for_pickup'], completed: ['delivered'], cancelled: ['cancelled', 'rejected'] };
  if (req.query.status) {
    const status = String(req.query.status);
    // Retain main's comma-separated status and q search API, as well as the
    // seller workspace's named tabs. Unknown read filters do not widen ownership.
    const statuses = tabGroups[status] ?? status.split(',').map((s) => s.trim()).filter((s) => ORDER_STATUSES.includes(s as any));
    if (statuses.length) { clauses.push(`status IN (${statuses.map(() => '?').join(',')})`); values.push(...statuses); }
  }
  if (req.query.fulfillment) { clauses.push('fulfillment_type=?'); values.push(requireEnum(req.query.fulfillment, 'Fulfilment', ['delivery', 'pickup'] as const)); }
  const search = queryText(req.query.query ?? req.query.q);
  if (search) { const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`; clauses.push("(order_number LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')"); values.push(like, like); }
  if (req.query.date) { clauses.push("date(created_at,'+5 hours','+30 minutes')=?"); values.push(dateFilter(req.query.date)); }
  priceFilters(req, 'total', clauses, values);
  const where = clauses.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE ${where}`).get(...values) as any).n;
  const rows = db.prepare(`SELECT id FROM orders WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...values, pageSize, offset) as any[];
  const counts = Object.fromEntries((db.prepare('SELECT status,COUNT(*) AS n FROM orders WHERE store_id=? GROUP BY status').all(store.id) as any[]).map((r) => [r.status, r.n]));
  res.json({ orders: rows.map((r) => { const o: any = hydrateOrder(r.id, 'seller'); delete o.pickupCode; o.address = {}; if (o.customer) o.customer = { name: o.customer.name }; return o; }), counts, pagination: pageMeta(total, page, pageSize) });
}));
function ownedOrder(sellerId: string, id: string): any {
  const store = requireSellerStore(sellerId);
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND store_id=?').get(id, store.id);
  if (!order) throw ApiError.notFound('Order not found.');
  return order;
}
sellerRouter.get('/orders/:id', route((req: AuthenticatedRequest, res) => {
  ownedOrder(req.user!.id, req.params.id);
  res.json({ order: hydrateOrder(req.params.id, 'seller') });
}));
sellerRouter.post('/orders/:id/status', route((req: AuthenticatedRequest, res) => {
  const target = requireEnum(req.body?.status, 'Order status', ['accepted', 'preparing', 'packed', 'ready_for_pickup', 'rejected', 'cancelled'] as const);
  const reason = optionalString(req.body?.reason, 'Reason', { max: 240 });
  if (['rejected', 'cancelled'].includes(target) && !reason) throw ApiError.badRequest('Provide a reason for rejecting or cancelling the order.');
  const now = new Date().toISOString();
  withTransaction(() => {
    const order = ownedOrder(req.user!.id, req.params.id);
    try { assertSellerTransition(order.status, target); } catch (e: any) { throw ApiError.badRequest(e.message, 'invalid_transition'); }
    if (req.body?.expectedStatus && req.body.expectedStatus !== order.status) throw ApiError.conflict('This order changed. Refresh and try again.', 'order_conflict');
    if (['rejected', 'cancelled'].includes(target)) {
      for (const item of db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(order.id) as any[]) {
        restock(item.product_id, item.quantity, { actorId: req.user!.id, referenceId: order.id, reason: 'seller_cancellation' });
      }
      db.prepare("UPDATE delivery_jobs SET status='cancelled',cancelled_at=?,cancelled_reason=?,updated_at=? WHERE order_id=? AND status!='completed'").run(now, reason!, now, order.id);
      db.prepare("UPDATE orders SET cancelled_reason=?,cancelled_by='seller' WHERE id=?").run(reason!, order.id);
    }
    const columns: Record<string, string> = { accepted: 'accepted_at', preparing: 'preparing_at', packed: 'packed_at', ready_for_pickup: 'ready_at' };
    const column = columns[target];
    db.prepare(`UPDATE orders SET status=?, ${column ? `${column}=?,` : ''} updated_at=? WHERE id=? AND status=?`)
      .run(...(column ? [target, now, now, order.id, order.status] : [target, now, order.id, order.status]));
    db.prepare(`INSERT INTO handoff_events (id,order_id,event_type,actor_role,actor_id,note,created_at) VALUES (?,?,?,'seller',?,?,?)`)
      .run(randomId('he'), order.id, `ORDER_${target.toUpperCase()}`, req.user!.id, reason ?? `Marked ${statusLabel(target)}`, now);
    auditSeller(req.user!.id, 'order.status', order.id, `${order.status} → ${target}`);
    notifyCustomerOfOrder(order.customer_id, order.id, order.order_number, target, reason);
  });
  res.json({ order: hydrateOrder(req.params.id, 'seller'), message: `Order marked ${statusLabel(target)}.` });
}));

/* Secure, audited pickup. Delivery codes are never selected in these handlers. */
sellerRouter.post('/orders/:id/pickup-code', route((req: AuthenticatedRequest, res) => {
  const order = ownedOrder(req.user!.id, req.params.id);
  if (order.status !== 'ready_for_pickup' || order.fulfillment_type !== 'delivery') throw ApiError.conflict('Pickup code is available only for a delivery order ready for collection.');
  auditSeller(req.user!.id, 'pickup.code_revealed', order.id);
  res.json({ pickupCode: order.pickup_code });
}));
function pickupJob(sellerId: string, orderId: string) {
  const order = ownedOrder(sellerId, orderId);
  const job = db.prepare(`SELECT dj.*,u.name AS rider_name,u.phone AS rider_phone FROM delivery_jobs dj
    JOIN users u ON u.id=dj.rider_id WHERE dj.order_id=? AND dj.status='claimed'`).get(orderId) as any;
  if (order.status !== 'ready_for_pickup' || order.fulfillment_type !== 'delivery' || !job) throw ApiError.conflict('An assigned rider and a ready delivery order are required.');
  return { order, job };
}
sellerRouter.post('/orders/:id/verify-rider', rateLimit({ windowMs: 15 * 60_000, max: 15, keyPrefix: 'seller_verify_rider' }), route((req: AuthenticatedRequest, res) => {
  withTransaction(() => {
    const { order, job } = pickupJob(req.user!.id, req.params.id);
    const last4 = requireString(req.body?.phoneLast4, 'Last four digits of rider phone', { min: 4, max: 4 });
    if (!/^\d{4}$/.test(last4) || job.rider_phone?.replace(/\D/g, '').slice(-4) !== last4) throw ApiError.badRequest('The rider details do not match the assigned rider.', 'rider_mismatch');
    const now = new Date().toISOString();
    db.prepare('UPDATE delivery_jobs SET seller_verified_at=?,seller_verified_rider_id=? WHERE id=?').run(now, job.rider_id, job.id);
    db.prepare(`INSERT INTO handoff_events (id,order_id,event_type,actor_role,actor_id,note,created_at) VALUES (?,?,'SELLER_RIDER_VERIFIED','seller',?,?,?)`)
      .run(randomId('he'), order.id, req.user!.id, `Assigned rider ${job.rider_name} verified in person`, now);
    auditSeller(req.user!.id, 'pickup.rider_verified', order.id);
  });
  res.json({ order: hydrateOrder(req.params.id, 'seller'), message: 'Assigned rider verified. You can now complete the pickup.' });
}));
/* Preserve main's authorized customer collection flow, without disclosing a delivery code. */
const completeCustomerPickup = route((req: AuthenticatedRequest, res) => {
  withTransaction(() => {
    const order = ownedOrder(req.user!.id, req.params.id);
    if (order.fulfillment_type !== 'pickup') throw ApiError.badRequest('Delivery orders must use the assigned-rider handover workflow.');
    if (order.status !== 'ready_for_pickup') throw ApiError.badRequest('This order is not ready for collection yet.');
    const code = requireString(req.body?.code ?? req.body?.pickupCode, 'Customer collection code', { min: 4, max: 12 });
    if (!codesMatch(code, order.delivery_code)) throw ApiError.badRequest('That code does not match. Ask the customer to check their order page.', 'invalid_code');
    const now = new Date().toISOString();
    db.prepare("UPDATE orders SET status='delivered',delivered_at=?,updated_at=? WHERE id=? AND status='ready_for_pickup'").run(now, now, order.id);
    db.prepare("INSERT INTO handoff_events (id,order_id,event_type,actor_role,actor_id,note,created_at) VALUES (?,?,'ORDER_DELIVERED','seller',?,'Collected in store',?)").run(randomId('he'), order.id, req.user!.id, now);
    notifyCustomerOfOrder(order.customer_id, order.id, order.order_number, 'delivered');
    auditSeller(req.user!.id, 'pickup.customer_collected', order.id);
  });
  res.json({ message: 'Pickup completed.', order: hydrateOrder(req.params.id, 'seller') });
});
const customerCollectionLimit = rateLimit({ windowMs: 10 * 60_000, max: 20, keyPrefix: 'complete_customer_pickup' });
sellerRouter.post('/orders/:id/customer-pickup', customerCollectionLimit, completeCustomerPickup);
sellerRouter.post('/orders/:id/complete-pickup', (req: AuthenticatedRequest, res, next) => {
  try {
    const order = ownedOrder(req.user!.id, req.params.id);
    if (order.fulfillment_type !== 'pickup') return next();
    customerCollectionLimit(req, res, (error) => error ? next(error) : completeCustomerPickup(req, res, next));
  } catch (error) { next(error); }
});

sellerRouter.post('/orders/:id/complete-pickup', rateLimit({ windowMs: 15 * 60_000, max: 15, keyPrefix: 'seller_pickup' }), route((req: AuthenticatedRequest, res) => {
  const { order, job } = pickupJob(req.user!.id, req.params.id);
  if (!job.seller_verified_at || job.seller_verified_rider_id !== job.rider_id) throw ApiError.conflict('Verify the currently assigned rider in person first.');
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const failures = (db.prepare("SELECT COUNT(*) AS n FROM handoff_verifications WHERE job_id=? AND verification_type='pickup' AND success=0 AND created_at>?").get(job.id, since) as any).n;
  if (failures >= 5) throw new ApiError(429, 'Too many incorrect pickup attempts. Try again in 15 minutes.', 'too_many_attempts');
  const success = codesMatch(req.body?.pickupCode, order.pickup_code);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO handoff_verifications (id,order_id,job_id,actor_id,verification_type,success,created_at) VALUES (?,?,?,?,'pickup',?,?)`)
    .run(randomId('hv'), order.id, job.id, req.user!.id, success ? 1 : 0, now);
  if (!success) throw ApiError.badRequest('Incorrect pickup code. Check the code for this order.', 'invalid_pickup_code');
  withTransaction(() => {
    const current = pickupJob(req.user!.id, order.id);
    if (current.job.rider_id !== job.rider_id) throw ApiError.conflict('The assigned rider changed. Verify the new rider first.');
    db.prepare("UPDATE delivery_jobs SET status='out_for_delivery',pickup_verified_at=?,picked_up_at=?,updated_at=? WHERE id=? AND status='claimed'").run(now, now, now, job.id);
    db.prepare("UPDATE orders SET status='out_for_delivery',picked_up_at=?,updated_at=? WHERE id=? AND status='ready_for_pickup'").run(now, now, order.id);
    db.prepare(`INSERT INTO handoff_events (id,order_id,event_type,actor_role,actor_id,note,created_at) VALUES (?,?,'PICKUP_VERIFIED','seller',?,'Verified handover to the assigned rider',?)`)
      .run(randomId('he'), order.id, req.user!.id, now);
    auditSeller(req.user!.id, 'pickup.completed', order.id);
  });
  res.json({ order: hydrateOrder(order.id, 'seller'), message: 'Pickup completed. The rider is now responsible for delivery.' });
}));

/* Stock checks never create holds. Only a confirmed reservation does. */
export function expireReservations(): number {
  return withTransaction(() => {
    const now = new Date().toISOString();
    const stale = db.prepare("SELECT * FROM reservations WHERE status='confirmed' AND expires_at IS NOT NULL AND expires_at<=?").all(now) as any[];
    for (const r of stale) {
      if (r.holds_stock) releaseHold(r.product_id, r.requested_quantity, { referenceId: r.id, reason: 'reservation_expiry' });
      db.prepare("UPDATE reservations SET status='expired',holds_stock=0,released_at=?,updated_at=? WHERE id=? AND status='confirmed'").run(now, now, r.id);
    }
    return stale.length;
  });
}
for (const reservation of [false, true]) {
  sellerRouter.get(reservation ? '/reservations' : '/stock-requests', route((req: AuthenticatedRequest, res) => {
    expireReservations(); const store = sellerStore(req.user!.id); const { page, pageSize, offset } = pagination(req);
    const key = reservation ? 'reservations' : 'requests'; const table = reservation ? 'reservations' : 'stock_requests';
    if (!store) { res.json({ [key]: [], counts: {}, pagination: pageMeta(0, page, pageSize) }); return; }
    const clauses = ['r.store_id=?']; const values: any[] = [store.id];
    if (req.query.status && req.query.status !== 'history' && req.query.status !== 'all') {
      clauses.push('r.status=?'); values.push(requireEnum(req.query.status, 'Status', reservation ? ['pending', 'confirmed', 'rejected', 'cancelled', 'expired', 'fulfilled'] : ['pending', 'confirmed', 'unavailable']));
    } else if (req.query.status === 'history') clauses.push("r.status!='pending'");
    const where = clauses.join(' AND ');
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} r WHERE ${where}`).get(...values) as any).n;
    const rows = db.prepare(`SELECT r.*,p.name AS product_name,p.image AS product_image,p.price AS product_price,
      i.stock_quantity,i.stock_quantity-i.reserved_quantity AS sellable,u.name AS customer_name
      FROM ${table} r JOIN products p ON p.id=r.product_id JOIN inventory i ON i.product_id=p.id JOIN users u ON u.id=r.customer_id
      WHERE ${where} ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,r.created_at DESC,r.id LIMIT ? OFFSET ?`).all(...values, pageSize, offset);
    const counts = Object.fromEntries((db.prepare(`SELECT status,COUNT(*) AS n FROM ${table} WHERE store_id=? GROUP BY status`).all(store.id) as any[]).map((r) => [r.status, r.n]));
    res.json({ [key]: rows, counts, pagination: pageMeta(total, page, pageSize) });
  }));
}
sellerRouter.put('/stock-requests/:id', route((req: AuthenticatedRequest, res) => {
  const store = requireSellerStore(req.user!.id);
  const status = requireEnum(req.body?.status, 'Status', ['confirmed', 'unavailable'] as const);
  const response = optionalString(req.body?.sellerResponse, 'Response', { max: 300 }); const now = new Date().toISOString();
  withTransaction(() => {
    const request = db.prepare('SELECT * FROM stock_requests WHERE id=? AND store_id=?').get(req.params.id, store.id) as any;
    if (!request) throw ApiError.notFound('Stock request not found.');
    if (request.status !== 'pending') throw ApiError.conflict('This request has already been answered.');
    if (status === 'confirmed' && (getInventory(request.product_id)?.sellable ?? 0) < request.requested_quantity) throw ApiError.conflict('Not enough available stock. Restock first or mark unavailable.');
    db.prepare('UPDATE stock_requests SET status=?,seller_response=?,responded_at=?,updated_at=? WHERE id=? AND status=\'pending\'').run(status, response ?? null, now, now, request.id);
    auditSeller(req.user!.id, 'stock_request.responded', request.id, status);
  });
  res.json({ message: status === 'confirmed' ? 'Stock confirmed, not reserved. No inventory has been held.' : 'Marked unavailable. The customer can see your response.' });
}));
sellerRouter.put('/reservations/:id', route((req: AuthenticatedRequest, res) => {
  expireReservations(); const store = requireSellerStore(req.user!.id);
  const action = requireEnum(req.body?.action ?? req.body?.status, 'Action', ['confirm', 'reject', 'fulfil'] as const);
  const response = optionalString(req.body?.sellerResponse, 'Response', { max: 300 });
  const hours = requireNumber(req.body?.holdHours ?? config.reservationHoldHours, 'Hold hours', { min: 1, max: 168 });
  const now = new Date().toISOString();
  withTransaction(() => {
    const r = db.prepare('SELECT * FROM reservations WHERE id=? AND store_id=?').get(req.params.id, store.id) as any;
    if (!r) throw ApiError.notFound('Reservation not found.');
    if (!['pending', 'confirmed'].includes(r.status)) throw ApiError.conflict(`This reservation is already ${r.status}.`);
    const context = { actorId: req.user!.id, referenceId: r.id };
    if (action === 'confirm') {
      if (r.status !== 'pending') throw ApiError.conflict('This reservation is already confirmed.');
      if (!tryHoldStock(r.product_id, r.requested_quantity, context)) throw ApiError.conflict('Not enough available stock to confirm. Restock first or reject the request.', 'insufficient_stock');
      db.prepare("UPDATE reservations SET status='confirmed',seller_response=?,responded_at=?,holds_stock=1,expires_at=?,updated_at=? WHERE id=? AND status='pending'")
        .run(response ?? null, now, new Date(Date.now() + hours * 3600_000).toISOString(), now, r.id);
    } else if (action === 'reject') {
      if (r.holds_stock) releaseHold(r.product_id, r.requested_quantity, context);
      db.prepare("UPDATE reservations SET status='rejected',seller_response=?,responded_at=?,holds_stock=0,released_at=?,updated_at=? WHERE id=?")
        .run(response ?? null, now, now, now, r.id);
    } else {
      if (r.status !== 'confirmed' || !r.holds_stock) throw ApiError.conflict('Confirm and hold the reservation before marking it fulfilled.');
      if (!fulfilHold(r.product_id, r.requested_quantity, context)) throw ApiError.conflict('Not enough held stock to fulfil this reservation.');
      db.prepare("UPDATE reservations SET status='fulfilled',seller_response=?,responded_at=COALESCE(responded_at,?),holds_stock=0,released_at=?,updated_at=? WHERE id=?")
        .run(response ?? null, now, now, now, r.id);
    }
    auditSeller(req.user!.id, `reservation.${action}`, r.id);
  });
  res.json({ message: action === 'confirm' ? 'Reservation confirmed. Stock is now held until expiry.' : action === 'reject' ? 'Reservation rejected. Any held stock was released.' : 'Reservation fulfilled and held stock deducted.' });
}));

/* Local image storage with content signature, size and type validation. */
sellerRouter.post('/uploads', rateLimit({ windowMs: 10 * 60_000, max: 30, keyPrefix: 'upload' }), route((req: AuthenticatedRequest, res) => {
  const dataUrl = requireString(req.body?.dataUrl, 'Image data', { min: 24, max: 8_000_000 });
  const match = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw ApiError.badRequest('Only PNG, JPEG and WEBP images are supported.');
  const buffer = Buffer.from(match[3], 'base64');
  if (buffer.byteLength > config.maxUploadBytes) throw ApiError.badRequest('Image too large. Maximum size is 4 MB.');
  const kind = match[2].toLowerCase();
  const signature = kind === 'png' ? buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : kind === 'webp' ? buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP'
    : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (buffer.byteLength < 64 || !signature) throw ApiError.badRequest('The image content does not match its type or is corrupted.');
  const filename = `${req.user!.id}-${randomId('img')}.${kind === 'jpeg' ? 'jpg' : kind}`;
  fs.mkdirSync(config.uploadsDir, { recursive: true }); fs.writeFileSync(path.join(config.uploadsDir, filename), buffer);
  auditSeller(req.user!.id, 'image.uploaded');
  res.status(201).json({ url: `/uploads/${filename}`, bytes: buffer.byteLength });
}));

sellerRouter.use(sellerWorkspaceRouter);
// Retain existing account/security API aliases for clients on main.
sellerRouter.use(buildAccountRouter('seller'));
