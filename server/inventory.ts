import { db, withTransaction } from './db.js';
import { randomId } from './codes.js';
import { ApiError } from './http.js';

/** Authoritative physical stock, reservation holds and a concurrency version.
 * Every write and its audit event are committed in the same transaction. */
export interface InventorySnapshot {
  productId: string;
  stockQuantity: number;
  reservedQuantity: number;
  sellable: number;
  lowStockThreshold: number;
  version: number;
}
export interface InventoryContext { actorId?: string; referenceId?: string; reason?: string }

export function ensureInventoryRow(productId: string, stock = 0): void {
  db.prepare(`INSERT INTO inventory (id, product_id, stock_quantity, reserved_quantity, low_stock_threshold, updated_at)
    VALUES (?, ?, ?, 0, 5, ?) ON CONFLICT(product_id) DO NOTHING`)
    .run(`inv_${productId}`, productId, Math.max(0, Math.floor(stock)), new Date().toISOString());
}

function syncProductCache(productId: string) {
  db.prepare(`UPDATE products SET stock = (SELECT stock_quantity FROM inventory WHERE product_id = ?) WHERE id = ?`)
    .run(productId, productId);
}

function snapshot(row: any): InventorySnapshot {
  return { productId: row.product_id, stockQuantity: row.stock_quantity, reservedQuantity: row.reserved_quantity,
    sellable: row.stock_quantity - row.reserved_quantity, lowStockThreshold: row.low_stock_threshold, version: row.version };
}

export function getInventory(productId: string): InventorySnapshot | null {
  const row = db.prepare('SELECT * FROM inventory WHERE product_id = ?').get(productId) as any;
  return row ? snapshot(row) : null;
}
export function sellableStock(productId: string) { return getInventory(productId)?.sellable ?? 0; }
export function inventoryMap(productIds: string[]): Map<string, InventorySnapshot> {
  if (!productIds.length) return new Map();
  const rows = db.prepare(`SELECT * FROM inventory WHERE product_id IN (${productIds.map(() => '?').join(',')})`).all(...productIds) as any[];
  return new Map(rows.map((row) => [row.product_id, snapshot(row)]));
}

function record(before: InventorySnapshot, reason: string, context: InventoryContext = {}) {
  const after = getInventory(before.productId)!;
  db.prepare(`INSERT INTO inventory_events (id, product_id, store_id, actor_id, reason, stock_before, stock_after,
    reserved_before, reserved_after, reference_id, type, delta, resulting_stock, note, created_at)
    SELECT ?, id, store_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM products WHERE id = ?`)
    .run(randomId('ie'), context.actorId ?? null, context.reason ?? reason, before.stockQuantity, after.stockQuantity,
      before.reservedQuantity, after.reservedQuantity, context.referenceId ?? null, reason,
      after.stockQuantity - before.stockQuantity, after.stockQuantity, context.reason ?? null, new Date().toISOString(), before.productId);
}
const validQuantity = (quantity: number) => Number.isInteger(quantity) && quantity > 0;

export function tryConsumeStock(productId: string, quantity: number, context: InventoryContext = {}): boolean {
  if (!validQuantity(quantity)) return false;
  return withTransaction(() => {
    const before = getInventory(productId);
    if (!before) return false;
    const result = db.prepare(`UPDATE inventory SET stock_quantity = stock_quantity - ?, version = version + 1, updated_at = ?
      WHERE product_id = ? AND stock_quantity - reserved_quantity >= ?`)
      .run(quantity, new Date().toISOString(), productId, quantity);
    if (!result.changes) return false;
    syncProductCache(productId); record(before, 'checkout', context); return true;
  });
}

export function restock(productId: string, quantity: number, context: InventoryContext = {}): void {
  if (!validQuantity(quantity)) return;
  withTransaction(() => {
    const before = getInventory(productId);
    if (!before) return;
    db.prepare(`UPDATE inventory SET stock_quantity = stock_quantity + ?, version = version + 1, updated_at = ? WHERE product_id = ?`)
      .run(quantity, new Date().toISOString(), productId);
    syncProductCache(productId); record(before, 'cancellation', context);
  });
}

export function tryHoldStock(productId: string, quantity: number, context: InventoryContext = {}): boolean {
  if (!validQuantity(quantity)) return false;
  return withTransaction(() => {
    const before = getInventory(productId);
    if (!before) return false;
    const result = db.prepare(`UPDATE inventory SET reserved_quantity = reserved_quantity + ?, version = version + 1, updated_at = ?
      WHERE product_id = ? AND stock_quantity - reserved_quantity >= ?`)
      .run(quantity, new Date().toISOString(), productId, quantity);
    if (!result.changes) return false;
    record(before, 'reservation', context); return true;
  });
}

export function releaseHold(productId: string, quantity: number, context: InventoryContext = {}): void {
  if (!validQuantity(quantity)) return;
  withTransaction(() => {
    const before = getInventory(productId);
    if (!before) return;
    db.prepare(`UPDATE inventory SET reserved_quantity = MAX(0, reserved_quantity - ?), version = version + 1, updated_at = ? WHERE product_id = ?`)
      .run(quantity, new Date().toISOString(), productId);
    record(before, 'reservation_release', context);
  });
}

export function fulfilHold(productId: string, quantity: number, context: InventoryContext = {}): boolean {
  if (!validQuantity(quantity)) return false;
  return withTransaction(() => {
    const before = getInventory(productId);
    if (!before) return false;
    const result = db.prepare(`UPDATE inventory SET stock_quantity = stock_quantity - ?, reserved_quantity = reserved_quantity - ?,
      version = version + 1, updated_at = ? WHERE product_id = ? AND stock_quantity >= ? AND reserved_quantity >= ?`)
      .run(quantity, quantity, new Date().toISOString(), productId, quantity, quantity);
    if (!result.changes) return false;
    syncProductCache(productId); record(before, 'reservation_fulfilled', context); return true;
  });
}

export function setStock(productId: string, absoluteQuantity: number, context: InventoryContext & { expectedVersion?: number } = {}) {
  return withTransaction(() => {
    const current = getInventory(productId);
    if (!current) throw ApiError.notFound('Inventory not found.');
    if (!Number.isInteger(absoluteQuantity) || absoluteQuantity < 0) throw ApiError.badRequest('Stock must be a non-negative whole number.');
    if (context.expectedVersion !== undefined && current.version !== context.expectedVersion) {
      throw ApiError.conflict('This product could not be updated because its stock changed. Refresh and try again.', 'stock_conflict');
    }
    const finalQuantity = Math.max(absoluteQuantity, current.reservedQuantity);
    db.prepare(`UPDATE inventory SET stock_quantity = ?, version = version + 1, updated_at = ? WHERE product_id = ?`)
      .run(finalQuantity, new Date().toISOString(), productId);
    syncProductCache(productId); record(current, 'seller_adjustment', context);
    return { stockQuantity: finalQuantity, clampedToReserved: finalQuantity !== absoluteQuantity };
  });
}

export function lowStockProducts(storeId: string, limit = 100): any[] {
  return db.prepare(`SELECT p.id, p.name, p.image, p.sku, i.stock_quantity, i.reserved_quantity, i.low_stock_threshold,
    i.stock_quantity - i.reserved_quantity AS sellable, i.version
    FROM products p JOIN inventory i ON i.product_id = p.id
    WHERE p.store_id = ? AND i.stock_quantity - i.reserved_quantity <= i.low_stock_threshold
    ORDER BY sellable, p.name LIMIT ?`).all(storeId, limit) as any[];
}

export function createInventoryForProduct(productId: string, stock: number) {
  withTransaction(() => { ensureInventoryRow(productId, stock); setStock(productId, stock, { reason: 'initial_stock' }); });
}
