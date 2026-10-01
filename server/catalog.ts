import { db } from './db.js';

/**
 * Shared, read-only catalogue queries used by the customer storefront and by the
 * seller's "Preview Store" (so both render exactly the same persisted data).
 *
 * All filtering, sorting, distance maths and pagination happen in SQL; clients
 * never receive the whole catalogue.
 */

export const SERVICE_AREAS = [
  { id: 'dwarka-sector-10', name: 'Dwarka Sector 10', city: 'Dwarka, New Delhi', latitude: 28.5823, longitude: 77.05 },
  { id: 'dwarka-sector-12', name: 'Dwarka Sector 12', city: 'Dwarka, New Delhi', latitude: 28.5921, longitude: 77.046 },
  { id: 'dwarka-sector-18', name: 'Dwarka Sector 18', city: 'Dwarka, New Delhi', latitude: 28.5706, longitude: 77.0576 },
  { id: 'dwarka-sector-22', name: 'Dwarka Sector 22', city: 'Dwarka, New Delhi', latitude: 28.5546, longitude: 77.0584 },
  { id: 'uttam-nagar', name: 'Uttam Nagar', city: 'New Delhi', latitude: 28.6207, longitude: 77.0549 },
  { id: 'najafgarh', name: 'Najafgarh', city: 'New Delhi', latitude: 28.6092, longitude: 76.9798 },
] as const;

export const DEFAULT_FULFILMENT = { min: 25, max: 40 };

export type AvailabilityState = 'in_stock' | 'low' | 'out_of_stock';

export function availabilityFor(input: {
  sellable: number;
  threshold?: number | null;
  availability?: string | null;
  isPublished?: number | boolean;
}): { state: AvailabilityState; label: string; detail: string } {
  const sellable = Math.max(0, Number(input.sellable) || 0);
  const flag = input.availability || 'available';
  if (input.isPublished === 0 || input.isPublished === false || flag !== 'available' || sellable <= 0) {
    return { state: 'out_of_stock', label: 'Out of Stock', detail: 'Currently unavailable' };
  }
  const threshold = input.threshold ?? 5;
  if (sellable <= threshold) return { state: 'low', label: 'Low Availability', detail: 'Only a few left' };
  return { state: 'in_stock', label: 'In Stock', detail: `${sellable} available` };
}

/** Haversine distance in SQL (km). `?` placeholders: lat, lat, lng. */
export const DISTANCE_SQL = `(6371 * 2 * asin(sqrt(
  pow(sin(radians(s.latitude - ?) / 2), 2) +
  cos(radians(?)) * cos(radians(s.latitude)) * pow(sin(radians(s.longitude - ?) / 2), 2)
)))`;

function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => list(v));
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 25);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function tokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export interface ProductQuery {
  query?: unknown;
  category?: unknown;
  storeId?: unknown;
  minPrice?: unknown;
  maxPrice?: unknown;
  inStockOnly?: unknown;
  lat?: unknown;
  lng?: unknown;
  maxDistanceKm?: unknown;
  sort?: unknown;
  page?: unknown;
  pageSize?: unknown;
  /** Seller preview may include closed/unpublished stores. */
  includeUnpublishedStores?: boolean;
}

export function clampPage(query: { page?: unknown; pageSize?: unknown }, defaultSize = 24, maxSize = 60) {
  const page = Math.max(1, Math.floor(num(query.page) ?? 1));
  const pageSize = Math.min(maxSize, Math.max(1, Math.floor(num(query.pageSize) ?? defaultSize)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const PRODUCT_COLUMNS = `
  p.id, p.store_id, p.name, p.description, p.category, p.image, p.price, p.mrp, p.brand, p.unit, p.sku,
  p.availability, p.product_info, p.is_published, p.created_at, p.updated_at,
  s.name AS store_name, CASE WHEN s.is_published=0 THEN 'inactive' WHEN s.temporarily_unavailable=1 THEN 'closed' ELSE s.status END AS store_status, s.city AS store_city, s.image AS store_image,
  s.supports_delivery, s.supports_pickup, s.supports_reservations,
  i.stock_quantity, i.reserved_quantity, i.low_stock_threshold,
  (i.stock_quantity - i.reserved_quantity) AS stock`;

export function decorateProduct(row: any) {
  const sellable = Math.max(0, Number(row.stock) || 0);
  const avail = availabilityFor({
    sellable,
    threshold: row.low_stock_threshold,
    availability: row.availability,
    isPublished: row.is_published,
  });
  return {
    ...row,
    stock: avail.state === 'out_of_stock' ? 0 : sellable,
    availabilityState: avail.state,
    availabilityLabel: avail.label,
    availabilityDetail: avail.detail,
    // Customers never need exact stock counters beyond "N available".
    stock_quantity: undefined,
    reserved_quantity: undefined,
  };
}

export function queryProducts(q: ProductQuery) {
  const where: string[] = [`p.is_published = 1`];
  if (!q.includeUnpublishedStores) {
    where.push(`s.status != 'inactive'`, `s.is_published = 1`, `s.published_at IS NOT NULL`);
  }
  const params: any[] = [];

  const lat = num(q.lat);
  const lng = num(q.lng);
  const hasGeo = lat !== undefined && lng !== undefined;
  const distanceExpr = hasGeo ? DISTANCE_SQL : 'NULL';
  const distanceParams = hasGeo ? [lat, lat, lng] : [];

  const relevance: string[] = [];
  const relevanceParams: any[] = [];
  const queryText = typeof q.query === 'string' ? q.query.trim().slice(0, 80) : '';
  for (const token of tokens(queryText)) {
    const like = `%${escapeLike(token)}%`;
    where.push(
      `(p.name LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR p.category LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' OR s.category LIKE ? ESCAPE '\\')`
    );
    params.push(like, like, like, like, like, like);
    relevance.push(
      `(CASE WHEN p.name LIKE ? ESCAPE '\\' THEN 4 ELSE 0 END + CASE WHEN p.brand LIKE ? ESCAPE '\\' THEN 3 ELSE 0 END + CASE WHEN p.category LIKE ? ESCAPE '\\' THEN 2 ELSE 0 END + CASE WHEN s.name LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END)`
    );
    relevanceParams.push(like, like, like, like);
  }

  const categories = list(q.category);
  if (categories.length) {
    where.push(`p.category COLLATE NOCASE IN (${categories.map(() => '?').join(',')})`);
    params.push(...categories);
  }
  const storeIds = list(q.storeId);
  if (storeIds.length) {
    where.push(`p.store_id IN (${storeIds.map(() => '?').join(',')})`);
    params.push(...storeIds);
  }
  const minPrice = num(q.minPrice);
  const maxPrice = num(q.maxPrice);
  if (minPrice !== undefined) {
    where.push(`p.price >= ?`);
    params.push(minPrice);
  }
  if (maxPrice !== undefined) {
    where.push(`p.price <= ?`);
    params.push(maxPrice);
  }
  if (q.inStockOnly === true || q.inStockOnly === 'true') {
    where.push(`(i.stock_quantity - i.reserved_quantity) > 0 AND p.availability = 'available'`);
  }
  const maxDistance = num(q.maxDistanceKm);
  if (hasGeo && maxDistance !== undefined) {
    where.push(`s.latitude IS NOT NULL AND s.longitude IS NOT NULL AND ${DISTANCE_SQL} <= ?`);
    params.push(lat, lat, lng, maxDistance);
  }

  const relevanceExpr = relevance.length ? relevance.join(' + ') : '0';
  const sortKey = typeof q.sort === 'string' ? q.sort : 'relevance';
  const orderBy: Record<string, string> = {
    relevance: `relevance DESC, in_stock DESC, p.name ASC`,
    name: `p.name ASC`,
    price_asc: `p.price ASC, p.name ASC`,
    price_desc: `p.price DESC, p.name ASC`,
    newest: `p.created_at DESC`,
    availability: `in_stock DESC, sellable DESC, p.name ASC`,
    nearby: hasGeo ? `distance_km IS NULL, distance_km ASC, p.name ASC` : `p.name ASC`,
  };
  const { page, pageSize, offset } = clampPage(q);

  const base = `
    FROM products p
    JOIN stores s ON p.store_id = s.id
    JOIN inventory i ON i.product_id = p.id
    WHERE ${where.join(' AND ')}`;

  const total = (db.prepare(`SELECT COUNT(*) AS c ${base}`).get(...params) as any).c as number;

  const rows = db
    .prepare(
      `SELECT ${PRODUCT_COLUMNS},
              ${distanceExpr} AS distance_km,
              (${relevanceExpr}) AS relevance,
              CASE WHEN (i.stock_quantity - i.reserved_quantity) > 0 AND p.availability = 'available' THEN 1 ELSE 0 END AS in_stock,
              (i.stock_quantity - i.reserved_quantity) AS sellable
       ${base}
       ORDER BY ${orderBy[sortKey] || orderBy.relevance}
       LIMIT ? OFFSET ?`
    )
    .all(...distanceParams, ...relevanceParams, ...params, pageSize, offset) as any[];

  return {
    products: rows.map((row) => {
      const { relevance: _r, in_stock: _i, sellable: _s, ...rest } = row;
      return {
        ...decorateProduct(rest),
        distanceKm: rest.distance_km == null ? null : Math.round(rest.distance_km * 10) / 10,
      };
    }),
    total,
    page,
    pageSize,
    hasMore: offset + rows.length < total,
  };
}

export interface StoreQuery {
  query?: unknown;
  category?: unknown;
  lat?: unknown;
  lng?: unknown;
  maxDistanceKm?: unknown;
  openOnly?: unknown;
  sort?: unknown;
  page?: unknown;
  pageSize?: unknown;
}

export function decorateStore(row: any) {
  const { distance_km, ...rest } = row;
  if (rest.temporarily_unavailable) rest.status = 'closed';
  return {
    ...rest,
    isOpen: rest.status === 'open',
    statusLabel:
      rest.status === 'open'
        ? 'Open'
        : rest.closure_type === 'temporarily_unavailable'
          ? 'Temporarily unavailable'
          : 'Currently closed',
    distanceKm: distance_km == null ? null : Math.round(distance_km * 10) / 10,
    fulfilmentMinutes: {
      min: rest.fulfilment_min_minutes ?? DEFAULT_FULFILMENT.min,
      max: rest.fulfilment_max_minutes ?? DEFAULT_FULFILMENT.max,
    },
    // Private / operational fields never leave the server.
    seller_id: undefined,
    business_id: undefined,
    legal_name: undefined,
    business_email: undefined,
    support_phone: undefined,
  };
}

export function queryStores(q: StoreQuery) {
  const where: string[] = [`s.status != 'inactive'`, `s.is_published = 1`, `s.published_at IS NOT NULL`];
  const params: any[] = [];
  const lat = num(q.lat);
  const lng = num(q.lng);
  const hasGeo = lat !== undefined && lng !== undefined;
  const distanceExpr = hasGeo ? DISTANCE_SQL : 'NULL';
  const distanceParams = hasGeo ? [lat, lat, lng] : [];

  const queryText = typeof q.query === 'string' ? q.query.trim().slice(0, 80) : '';
  for (const token of tokens(queryText)) {
    const like = `%${escapeLike(token)}%`;
    where.push(
      `(s.name LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\' OR s.city LIKE ? ESCAPE '\\' OR s.category LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM products p WHERE p.store_id = s.id AND p.is_published = 1 AND (p.name LIKE ? ESCAPE '\\' OR p.category LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\')))`
    );
    params.push(like, like, like, like, like, like, like);
  }
  const categories = list(q.category);
  if (categories.length) {
    where.push(
      `(s.category COLLATE NOCASE IN (${categories.map(() => '?').join(',')}) OR EXISTS (SELECT 1 FROM products p WHERE p.store_id = s.id AND p.is_published = 1 AND p.category COLLATE NOCASE IN (${categories.map(() => '?').join(',')})))`
    );
    params.push(...categories, ...categories);
  }
  if (q.openOnly === true || q.openOnly === 'true') where.push(`s.status = 'open' AND s.temporarily_unavailable = 0`);
  const maxDistance = num(q.maxDistanceKm);
  if (hasGeo && maxDistance !== undefined) {
    where.push(`s.latitude IS NOT NULL AND s.longitude IS NOT NULL AND ${DISTANCE_SQL} <= ?`);
    params.push(lat, lat, lng, maxDistance);
  }

  const sortKey = typeof q.sort === 'string' ? q.sort : hasGeo ? 'distance' : 'relevance';
  const order =
    sortKey === 'distance' && hasGeo
      ? `(s.status = 'open') DESC, distance_km IS NULL, distance_km ASC, s.name ASC`
      : sortKey === 'name'
        ? `s.name ASC`
        : `(s.status = 'open') DESC, s.name ASC`;
  const { page, pageSize, offset } = clampPage(q, 24, 50);

  const base = `FROM stores s WHERE ${where.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) AS c ${base}`).get(...params) as any).c as number;
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.description, s.category, s.address, s.city, s.state, s.pincode,
              s.latitude, s.longitude, s.opening_hours, s.opens_at, s.closes_at, s.operating_days,
              s.contact_phone, s.contact_email, s.is_published, s.temporarily_unavailable, s.status, s.closure_type, s.status_message, s.image, s.logo,
              s.supports_delivery, s.supports_pickup, s.supports_reservations,
              s.fulfilment_min_minutes, s.fulfilment_max_minutes, s.published_at,
              (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id AND p.is_published = 1) AS product_count,
              ${distanceExpr} AS distance_km
       ${base}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`
    )
    .all(...distanceParams, ...params, pageSize, offset) as any[];

  return { stores: rows.map(decorateStore), total, page, pageSize, hasMore: offset + rows.length < total };
}

export function categoryCounts() {
  return db
    .prepare(
      `SELECT p.category AS category, COUNT(*) AS count, COUNT(DISTINCT p.store_id) AS stores
       FROM products p JOIN stores s ON p.store_id = s.id
       WHERE p.is_published = 1 AND s.status != 'inactive' AND s.is_published=1 AND s.published_at IS NOT NULL
       GROUP BY p.category ORDER BY count DESC, p.category ASC`
    )
    .all() as { category: string; count: number; stores: number }[];
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10;
}

/** Coarse delivery zones riders can choose from (backend configuration). */
export const RIDER_ZONES = [
  { id: 'dwarka', name: 'Dwarka', matches: ['dwarka'] },
  { id: 'uttam-nagar', name: 'Uttam Nagar', matches: ['uttam nagar'] },
  { id: 'najafgarh', name: 'Najafgarh', matches: ['najafgarh'] },
] as const;

export function zoneForText(...parts: (string | null | undefined)[]): string | null {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  for (const zone of RIDER_ZONES) {
    if (zone.matches.some((m) => text.includes(m))) return zone.name;
  }
  return null;
}

/** "Shop 14-16, Vardhman City Mall, Sector 12" + "Dwarka, New Delhi" -> "Sector 12, Dwarka" */
export function areaLabel(address: string | null | undefined, city: string | null | undefined): string {
  const segment = String(address ?? '').split(',').map((s) => s.trim()).filter(Boolean).pop() ?? '';
  const cityFirst = String(city ?? '').split(',')[0].trim();
  return [segment, cityFirst].filter(Boolean).join(', ') || 'Nearby';
}
