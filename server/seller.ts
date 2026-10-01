import { db } from './db.js';
import { ApiError } from './http.js';
import { randomId } from './codes.js';
import { requireNumber, requirePositiveInt, requireString } from './validation.js';
import type { Request } from 'express';

export function sellerStore(sellerId: string): any | null {
  return db.prepare('SELECT * FROM stores WHERE seller_id = ?').get(sellerId) ?? null;
}

export function requireSellerStore(sellerId: string): any {
  const store = sellerStore(sellerId);
  if (!store) throw new ApiError(409, 'Create your store profile first.', 'store_required');
  return store;
}

export function auditSeller(sellerId: string, action: string, resourceId?: string, detail?: string) {
  db.prepare(`INSERT INTO seller_audit_events (id, seller_id, action, resource_id, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(randomId('audit'), sellerId, action, resourceId ?? null, detail ?? null, new Date().toISOString());
}

export function notifySeller(sellerId: string, category: string, title: string, body: string, href: string) {
  db.prepare(`INSERT INTO seller_notifications (id, seller_id, category, title, body, href, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomId('nt'), sellerId, category, title, body, href, new Date().toISOString());
}

export function pagination(req: Request, defaultSize = 20) {
  const page = requirePositiveInt(req.query.page ?? 1, 'Page', { min: 1, max: 100000 });
  const pageSize = requirePositiveInt(req.query.pageSize ?? defaultSize, 'Page size', { min: 1, max: 100 });
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pageMeta(total: number, page: number, pageSize: number) {
  return { total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function queryText(value: unknown, max = 120): string {
  if (value === undefined || value === '') return '';
  return requireString(value, 'Search', { max });
}

export function priceFilters(req: Request, column: string, clauses: string[], values: any[]) {
  for (const key of ['minPrice', 'maxPrice'] as const) {
    if (req.query[key] === undefined || req.query[key] === '') continue;
    const amount = requireNumber(req.query[key], key === 'minPrice' ? 'Minimum price' : 'Maximum price', { min: 0, max: 1_000_000 });
    clauses.push(`${column} ${key === 'minPrice' ? '>=' : '<='} ?`);
    values.push(amount);
  }
}

export function dateFilter(value: unknown): string {
  const date = requireString(value, 'Date', { min: 10, max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw ApiError.badRequest('Choose a valid date.');
  }
  return date;
}

export const LOCAL_DAY = "date(created_at, '+5 hours', '+30 minutes')";
export const LOCAL_NOW = "date('now', '+5 hours', '+30 minutes')";

export function settingsFor(sellerId: string) {
  db.prepare(`INSERT INTO seller_settings (seller_id, updated_at) VALUES (?, ?)
    ON CONFLICT(seller_id) DO NOTHING`).run(sellerId, new Date().toISOString());
  return db.prepare('SELECT * FROM seller_settings WHERE seller_id = ?').get(sellerId) as any;
}
