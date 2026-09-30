import { db, withTransaction } from './db.js';
import { logger } from './logging.js';
import { releaseHold } from './inventory.js';
import { notify, recordInventoryEvent } from './notifications.js';

/** Lazily expires reservations whose hold has lapsed and releases their stock. */
export function expireReservations(): number {
  const now = new Date().toISOString();
  const stale = db
    .prepare(
      `SELECT r.*, p.name AS product_name FROM reservations r JOIN products p ON p.id = r.product_id
       WHERE r.status = 'confirmed' AND r.expires_at IS NOT NULL AND r.expires_at < ?`
    )
    .all(now) as any[];

  if (stale.length === 0) return 0;

  withTransaction(() => {
    for (const reservation of stale) {
      if (reservation.holds_stock) {
        releaseHold(reservation.product_id, reservation.requested_quantity);
        recordInventoryEvent({
          productId: reservation.product_id,
          storeId: reservation.store_id,
          type: 'reservation_release',
          delta: 0,
          note: 'Reservation expired; held stock released',
        });
      }
      db.prepare(
        `UPDATE reservations SET status = 'expired', holds_stock = 0, released_at = ?, updated_at = ? WHERE id = ?`
      ).run(now, now, reservation.id);
      notify(
        reservation.customer_id,
        'reservation',
        'Reservation expired',
        `Your reservation for ${reservation.product_name} expired and the held stock was released.`,
        '/customer/reservations'
      );
    }
  });

  logger.info('reservations.expired', { count: stale.length });
  return stale.length;
}
