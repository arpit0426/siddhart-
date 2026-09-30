import { db, withTransaction } from './db.js';

/**
 * Inventory model (single source of truth)
 * ----------------------------------------
 * `inventory.stock_quantity`  – physical units on the shelf.
 * `inventory.reserved_quantity` – units held for CONFIRMED reservations.
 * sellable = stock_quantity - reserved_quantity  (what a customer may buy).
 *
 * `products.stock` is kept in sync as a denormalised cache for legacy readers;
 * every mutation goes through this module so the two can never diverge.
 */
export interface InventorySnapshot {
  productId: string;
  stockQuantity: number;
  reservedQuantity: number;
  sellable: number;
  lowStockThreshold: number;
}

export function ensureInventoryRow(productId: string, stock = 0): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO inventory (id, product_id, stock_quantity, reserved_quantity, low_stock_threshold, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT(product_id) DO NOTHING`
  ).run(`inv_${productId}`, productId, Math.max(0, Math.floor(stock)), 5, now);
  syncProductCache(productId);
}

function syncProductCache(productId: string): void {
  db.prepare(
    `UPDATE products
     SET stock = COALESCE((SELECT stock_quantity FROM inventory WHERE product_id = ?), stock)
     WHERE id = ?`
  ).run(productId, productId);
}

export function getInventory(productId: string): InventorySnapshot | null {
  const row = db
    .prepare(
      `SELECT product_id, stock_quantity, reserved_quantity, low_stock_threshold
       FROM inventory WHERE product_id = ?`
    )
    .get(productId) as any;
  if (!row) return null;
  const stockQuantity = Math.max(0, row.stock_quantity || 0);
  const reservedQuantity = Math.max(0, row.reserved_quantity || 0);
  return {
    productId: row.product_id,
    stockQuantity,
    reservedQuantity,
    sellable: Math.max(0, stockQuantity - reservedQuantity),
    lowStockThreshold: row.low_stock_threshold ?? 5,
  };
}

export function sellableStock(productId: string): number {
  return getInventory(productId)?.sellable ?? 0;
}

export function inventoryMap(productIds: string[]): Map<string, InventorySnapshot> {
  const result = new Map<string, InventorySnapshot>();
  if (productIds.length === 0) return result;
  const placeholders = productIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT product_id, stock_quantity, reserved_quantity, low_stock_threshold
       FROM inventory WHERE product_id IN (${placeholders})`
    )
    .all(...productIds) as any[];
  for (const row of rows) {
    result.set(row.product_id, {
      productId: row.product_id,
      stockQuantity: row.stock_quantity,
      reservedQuantity: row.reserved_quantity,
      sellable: Math.max(0, row.stock_quantity - row.reserved_quantity),
      lowStockThreshold: row.low_stock_threshold ?? 5,
    });
  }
  return result;
}

/**
 * Atomically consumes stock for a checkout line. The conditional WHERE clause is
 * what makes concurrent checkouts safe: two buyers racing for the last unit
 * result in exactly one successful update, never negative stock.
 */
export function tryConsumeStock(productId: string, quantity: number): boolean {
  if (quantity <= 0) return false;
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE inventory
       SET stock_quantity = stock_quantity - ?, updated_at = ?
       WHERE product_id = ?
         AND stock_quantity - reserved_quantity >= ?`
    )
    .run(quantity, now, productId, quantity);
  if (result.changes === 0) return false;
  syncProductCache(productId);
  return true;
}

/** Returns stock to the shelf (order cancellation / reservation expiry). */
export function restock(productId: string, quantity: number): void {
  if (quantity <= 0) return;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE inventory SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE product_id = ?`
  ).run(quantity, now, productId);
  syncProductCache(productId);
}

/** Holds stock for a confirmed reservation. Atomic - never over-reserves. */
export function tryHoldStock(productId: string, quantity: number): boolean {
  if (quantity <= 0) return false;
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE inventory
       SET reserved_quantity = reserved_quantity + ?, updated_at = ?
       WHERE product_id = ?
         AND stock_quantity - reserved_quantity >= ?`
    )
    .run(quantity, now, productId, quantity);
  return result.changes > 0;
}

/** Releases a previously held reservation hold. */
export function releaseHold(productId: string, quantity: number): void {
  if (quantity <= 0) return;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE inventory
     SET reserved_quantity = MAX(0, reserved_quantity - ?), updated_at = ?
     WHERE product_id = ?`
  ).run(quantity, now, productId);
}

/**
 * Converts a confirmed hold into a sale (reservation fulfilled).
 * Consumes physical stock and clears the hold in one atomic statement.
 */
export function fulfilHold(productId: string, quantity: number): boolean {
  if (quantity <= 0) return false;
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE inventory
       SET stock_quantity = stock_quantity - ?,
           reserved_quantity = MAX(0, reserved_quantity - ?),
           updated_at = ?
       WHERE product_id = ? AND stock_quantity >= ?`
    )
    .run(quantity, quantity, now, productId, quantity);
  if (result.changes === 0) return false;
  syncProductCache(productId);
  return true;
}

/**
 * Seller stock edit. Stock can never be set below the quantity already held for
 * confirmed reservations.
 */
export function setStock(
  productId: string,
  absoluteQuantity: number
): { stockQuantity: number; clampedToReserved: boolean } {
  const current = getInventory(productId);
  const desired = Math.max(0, Math.floor(absoluteQuantity));
  const reserved = current?.reservedQuantity ?? 0;
  const finalQuantity = Math.max(desired, reserved);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE inventory SET stock_quantity = ?, updated_at = ? WHERE product_id = ?`
  ).run(finalQuantity, now, productId);
  syncProductCache(productId);
  return { stockQuantity: finalQuantity, clampedToReserved: finalQuantity !== desired };
}

/** Low-stock products for a store (real data only). */
export function lowStockProducts(storeId: string): any[] {
  return db
    .prepare(
      `SELECT p.id, p.name, i.stock_quantity AS stock_quantity, i.reserved_quantity AS reserved_quantity,
              i.low_stock_threshold AS low_stock_threshold
       FROM products p
       JOIN inventory i ON i.product_id = p.id
       WHERE p.store_id = ? AND p.is_published = 1 AND i.stock_quantity - i.reserved_quantity <= i.low_stock_threshold
       ORDER BY (i.stock_quantity - i.reserved_quantity) ASC`
    )
    .all(storeId) as any[];
}

/** Called from within a transaction when products are created. */
export function createInventoryForProduct(productId: string, stock: number): void {
  withTransaction(() => {
    ensureInventoryRow(productId, stock);
    setStock(productId, stock);
  });
}
