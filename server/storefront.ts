import { db } from './db.js';

/** The same safe public projection powers discovery and the seller's preview.
 * Never spread stores/users: private owner IDs and business verification data
 * are not customer-facing storefront information. */
export function publicStore(store: any) {
  return {
    id: store.id, name: store.name, description: store.description, category: store.category,
    address: store.address, city: store.city, state: store.state, pincode: store.pincode,
    latitude: store.latitude, longitude: store.longitude, opening_hours: store.opening_hours,
    opens_at: store.opens_at, closes_at: store.closes_at, operating_days: store.operating_days,
    contact_phone: store.contact_phone, contact_email: store.contact_email,
    status: store.temporarily_unavailable ? 'closed' : store.status,
    temporarily_unavailable: store.temporarily_unavailable, is_published: store.is_published,
    logo: store.logo, image: store.image, supports_delivery: store.supports_delivery,
    supports_pickup: store.supports_pickup, published_at: store.published_at,
    supports_reservations: store.supports_reservations, closure_type: store.closure_type, status_message: store.status_message,
    fulfilment_min_minutes: store.fulfilment_min_minutes, fulfilment_max_minutes: store.fulfilment_max_minutes,
    product_count: store.product_count,
  };
}

export function storefrontProducts(storeId: string) {
  return db.prepare(`SELECT p.id, p.store_id, p.name, p.description, p.category, p.image,
    p.price, p.mrp, p.brand, p.unit, p.availability, p.is_published, p.created_at, p.updated_at,
    i.stock_quantity, i.reserved_quantity,
    CASE WHEN p.availability = 'available' THEN i.stock_quantity - i.reserved_quantity ELSE 0 END AS stock,
    CASE WHEN p.availability = 'available' THEN i.stock_quantity - i.reserved_quantity ELSE 0 END AS sellable
    FROM products p JOIN inventory i ON i.product_id = p.id
    WHERE p.store_id = ? AND p.is_published = 1 ORDER BY p.category, p.name LIMIT 100`).all(storeId);
}
