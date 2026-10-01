import { db } from './db.js';
import { randomId } from './codes.js';

/**
 * Notifications, audit events and inventory events.
 *
 * Everything here writes to the same SQLite database as the business record it
 * describes and is meant to be called inside the same transaction, so a
 * notification can never exist for a status change that did not happen.
 */
export type NotificationType =
  | 'order'
  | 'preparation'
  | 'delivery'
  | 'stock_request'
  | 'reservation'
  | 'account'
  | 'inventory'
  | 'platform'
  | 'job'
  | 'earnings';

export function notify(
  userId: string | null | undefined,
  type: NotificationType,
  title: string,
  body: string,
  link?: string
): void {
  if (!userId) return;
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, link, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(randomId('ntf'), userId, type, title, body, link ?? null, new Date().toISOString());
}

export function notifyStoreSeller(
  storeId: string,
  type: NotificationType,
  title: string,
  body: string,
  link?: string
): void {
  const row = db.prepare(`SELECT seller_id FROM stores WHERE id = ?`).get(storeId) as any;
  if (row) notify(row.seller_id, type, title, body, link);
}

/** Customer-facing copy for every persisted order transition. */
const ORDER_COPY: Record<string, { type: NotificationType; title: string; body: string }> = {
  placed: { type: 'order', title: 'Order placed', body: 'Your order has been placed. Waiting for the store to accept.' },
  accepted: { type: 'order', title: 'Order accepted', body: 'Your order has been accepted.' },
  preparing: { type: 'preparation', title: 'Being prepared', body: 'Your order is being prepared.' },
  packed: { type: 'preparation', title: 'Order packed', body: 'Your order is packed and will be ready for pickup soon.' },
  ready_for_pickup: { type: 'order', title: 'Ready for pickup', body: 'Your order is ready and waiting for a rider.' },
  picked_up: { type: 'delivery', title: 'Picked up', body: 'Your rider has collected your order from the store.' },
  out_for_delivery: { type: 'delivery', title: 'Out for delivery', body: 'Your order is out for delivery. Your delivery code is now available.' },
  delivered: { type: 'delivery', title: 'Delivered', body: 'Your order was delivered. Enjoy!' },
  cancelled: { type: 'order', title: 'Order cancelled', body: 'Your order was cancelled.' },
  rejected: { type: 'order', title: 'Order rejected', body: 'The store could not accept your order.' },
  rider_assigned: { type: 'delivery', title: 'Rider assigned', body: 'A rider has been assigned to your order.' },
};

export function notifyCustomerOfOrder(
  customerId: string,
  orderId: string,
  orderNumber: string,
  event: string,
  extra?: string
): void {
  const copy = ORDER_COPY[event];
  if (!copy) return;
  notify(
    customerId,
    copy.type,
    `${copy.title} · #${orderNumber}`,
    extra ? `${copy.body} ${extra}` : copy.body,
    `/customer/orders/${orderId}`
  );
}

export function audit(
  actorId: string | null,
  actorRole: string | null,
  action: string,
  entityType?: string,
  entityId?: string,
  meta?: Record<string, unknown>
): void {
  db.prepare(
    `INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomId('aud'),
    actorId,
    actorRole,
    action,
    entityType ?? null,
    entityId ?? null,
    meta ? JSON.stringify(meta) : null,
    new Date().toISOString()
  );
}

export function recordInventoryEvent(input: {
  productId: string;
  storeId: string;
  type: 'seller_adjustment' | 'checkout' | 'reservation' | 'reservation_release' | 'cancellation' | 'return' | 'initial';
  delta: number;
  actorId?: string | null;
  note?: string;
}): void {
  const row = db.prepare('SELECT stock_quantity,reserved_quantity FROM inventory WHERE product_id=?').get(input.productId) as any;
  const recent = db.prepare(`SELECT id,stock_after,reserved_after,created_at FROM inventory_events
    WHERE product_id=? AND actor_id IS NULL ORDER BY rowid DESC LIMIT 1`).get(input.productId) as any;
  if (recent && recent.stock_after === row?.stock_quantity && recent.reserved_after === row?.reserved_quantity
      && Date.parse(recent.created_at) >= Date.now() - 1000) {
    db.prepare('UPDATE inventory_events SET type=?,delta=?,actor_id=?,note=? WHERE id=?')
      .run(input.type, input.delta, input.actorId ?? null, input.note ?? null, recent.id);
    return;
  }
  const isHold = input.type === 'reservation' || input.type === 'reservation_release';
  db.prepare(`INSERT INTO inventory_events (id,product_id,store_id,type,delta,resulting_stock,actor_id,note,
    reason,stock_before,stock_after,reserved_before,reserved_after,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomId('ie'),input.productId,input.storeId,input.type,input.delta,
      row?.stock_quantity ?? 0,input.actorId ?? null,input.note ?? null,input.type,
      row ? row.stock_quantity - (isHold ? 0 : input.delta) : null,row?.stock_quantity ?? null,
      row ? row.reserved_quantity + (isHold ? input.delta : 0) : null,row?.reserved_quantity ?? null,new Date().toISOString());
}

/** Low-stock notice for the seller after stock drops below the threshold. */
export function maybeNotifyLowStock(productId: string): void {
  const row = db
    .prepare(
      `SELECT p.name, p.store_id, s.seller_id, i.stock_quantity - i.reserved_quantity AS sellable,
              i.low_stock_threshold AS threshold
       FROM products p
       JOIN inventory i ON i.product_id = p.id
       JOIN stores s ON s.id = p.store_id
       WHERE p.id = ?`
    )
    .get(productId) as any;
  if (!row || row.sellable >= row.threshold) return;
  // One unread low-stock notice per product at a time keeps the inbox useful.
  const link = `/seller/inventory?highlight=${productId}`;
  const existing = db
    .prepare(`SELECT id FROM notifications WHERE user_id = ? AND type = 'inventory' AND link = ? AND read_at IS NULL`)
    .get(row.seller_id, link);
  if (existing) return;
  notify(
    row.seller_id,
    'inventory',
    'Low stock alert',
    row.sellable <= 0
      ? `${row.name} is out of stock.`
      : `${row.name} has only ${row.sellable} unit${row.sellable === 1 ? '' : 's'} remaining.`,
    link
  );
}
