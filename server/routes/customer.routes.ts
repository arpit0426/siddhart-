import { Router } from 'express';
import { db, withTransaction } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logging.js';
import { rateLimit } from '../rateLimit.js';
import { ApiError, route } from '../http.js';
import { AuthenticatedRequest, requireAuth, requireRole } from '../auth.js';
import { inventoryMap, restock, tryConsumeStock, fulfilHold, releaseHold } from '../inventory.js';
import { generateHandoffCode, orderNumber, randomId } from '../codes.js';
import { availabilityFor } from '../catalog.js';
import {
  audit,
  maybeNotifyLowStock,
  notify,
  notifyCustomerOfOrder,
  notifyStoreSeller,
  recordInventoryEvent,
} from '../notifications.js';
import { publicUser } from '../auth.js';
import { expireReservations } from '../reservations.js';
import { computeSubtotal, deliveryFeeFor, orderTotal, toRupees } from '../pricing.js';
import {
  optionalCoordinate,
  optionalIdempotencyKey,
  optionalString,
  requireEnum,
  requireNonEmptyArray,
  requirePhone,
  requirePincode,
  requirePlatformId,
  requirePositiveInt,
  requireUploadUrl,
  requireQuantity,
  requireString,
} from '../validation.js';

export const customerRouter = Router();

const FULFILMENT_TYPES = ['delivery', 'pickup'] as const;

// Every customer endpoint - including store/product discovery - requires an
// authenticated CUSTOMER session. Ownership is enforced per resource below.
customerRouter.use(requireAuth, requireRole('customer'));

/* -------------------------------------------------------------------------- */
/* Cart (authenticated customer only)                                         */
/* -------------------------------------------------------------------------- */


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
      `SELECT ci.id, ci.quantity, ci.price_at_add, p.id AS product_id, p.name, p.price, p.category, p.image,
              p.is_published, p.availability, p.unit, p.store_id, s.name AS store_name, s.status AS store_status,
              s.supports_delivery, s.supports_pickup,
              i.stock_quantity, i.reserved_quantity, i.low_stock_threshold,
              (i.stock_quantity - i.reserved_quantity) AS stock
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
    const priceChanged =
      item.price_at_add != null && Math.abs(item.price_at_add - item.price) > 0.001
        ? { from: item.price_at_add, to: item.price }
        : null;
    const issue = itemIssue(item);
    group.items.push({
      ...item,
      lineTotal,
      issue,
      availabilityState: availabilityFor({
        sellable: item.stock,
        threshold: item.low_stock_threshold,
        availability: item.availability,
        isPublished: item.is_published,
      }).state,
      priceChanged,
      warning: priceChanged
        ? `The price of ${item.name} changed from ${formatRupees(priceChanged.from)} to ${formatRupees(priceChanged.to)}. Please review your cart.`
        : null,
    });
    group.subtotal = toRupees(group.subtotal + lineTotal);
  }

  const stores = [...groups.values()].map((group) => ({
    ...group,
    deliveryFee: deliveryFeeFor({ fulfilmentType: 'delivery', subtotal: group.subtotal }),
    storeClosed: group.storeStatus !== 'open',
    blocked: group.storeStatus !== 'open' || group.items.some((item: any) => item.issue),
  }));

  const subtotal = toRupees(stores.reduce((sum, group) => sum + group.subtotal, 0));
  const deliveryFee = toRupees(stores.reduce((sum, group) => sum + group.deliveryFee, 0));
  return { cartId, items, stores, subtotal, deliveryFee, total: toRupees(subtotal + deliveryFee) };
}

function formatRupees(value: number): string {
  return `₹${toRupees(value)}`;
}

function itemIssue(item: any): string | null {
  if (!item.is_published) return 'This product is no longer available.';
  if (item.store_status === 'inactive') return 'This store is not accepting orders.';
  if (item.store_status === 'closed') return 'This store is currently closed. Checkout is unavailable.';
  if (item.availability && item.availability !== 'available') return 'This product is no longer available.';
  if (item.stock <= 0) return 'This product is no longer available in the requested quantity.';
  if (item.quantity > item.stock) {
    return `Only ${item.stock} unit${item.stock === 1 ? ' is' : 's are'} currently available.`;
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
      deliveryFee: payload.deliveryFee,
      total: payload.total,
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
        `SELECT p.id, p.name, p.is_published, p.availability, p.price, s.status AS store_status,
                i.stock_quantity - i.reserved_quantity AS stock
         FROM products p
         JOIN stores s ON p.store_id = s.id
         JOIN inventory i ON i.product_id = p.id
         WHERE p.id = ?`
      )
      .get(productId) as any;

    if (!product) throw ApiError.notFound('Product not found.');
    if (!product.is_published || product.availability !== 'available') {
      throw ApiError.badRequest('This product is no longer available.');
    }
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
      // The customer is actively editing the line, so they have seen the current price.
      db.prepare(
        `UPDATE cart_items SET quantity = ?, price_at_add = ?, updated_at = ? WHERE id = ?`
      ).run(quantity, product.price, now, existing.id);
    } else {
      db.prepare(
        `INSERT INTO cart_items (id, cart_id, product_id, quantity, price_at_add, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(randomId('ci'), cartId, productId, quantity, product.price, now, now);
    }

    db.prepare(`UPDATE carts SET updated_at = ? WHERE id = ?`).run(now, cartId);

    const payload = cartPayload(customerId);
    res.json({ message: 'Cart updated.', items: payload.items, subtotal: payload.subtotal });
  })
);

customerRouter.delete(
  '/cart/items/:productId',
  route((req: AuthenticatedRequest, res) => {
    const cartId = ensureCart(req.user!.id);
    db.prepare(`DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?`).run(cartId, req.params.productId);
    res.json({ message: 'Item removed from cart.' });
  })
);

customerRouter.delete(
  '/cart/stores/:storeId',
  route((req: AuthenticatedRequest, res) => {
    const cartId = ensureCart(req.user!.id);
    db.prepare(
      `DELETE FROM cart_items WHERE cart_id = ? AND product_id IN (SELECT id FROM products WHERE store_id = ?)`
    ).run(cartId, req.params.storeId);
    res.json({ message: 'Store items removed from cart.' });
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

function parseAddressBody(body: any, existing?: any) {
  const pick = (key: string, fallback: any) => (body?.[key] !== undefined ? body[key] : fallback);
  const house = optionalString(pick('house', existing?.house), 'House / building', { max: 120 }) || '';
  const street = optionalString(pick('street', existing?.street), 'Street', { max: 120 }) || '';
  const area = optionalString(pick('area', existing?.area), 'Area', { max: 120 }) || '';
  const composed = [house, street, area].filter(Boolean).join(', ');
  const addressLine = requireString(
    body?.addressLine !== undefined ? body.addressLine : composed || existing?.address_line,
    'Address',
    { min: 5, max: 240 }
  );
  const latitude = optionalCoordinate(pick('latitude', existing?.latitude), 'Latitude', { min: -90, max: 90 });
  const longitude = optionalCoordinate(pick('longitude', existing?.longitude), 'Longitude', { min: -180, max: 180 });
  if ((latitude == null) !== (longitude == null)) {
    throw ApiError.badRequest('Provide both latitude and longitude, or neither.');
  }
  return {
    recipientName: requireString(pick('recipientName', existing?.recipient_name), 'Full name', { min: 2, max: 80 }),
    phone: requirePhone(pick('phone', existing?.phone), 'Contact phone'),
    addressLine,
    house,
    street,
    area,
    city: requireString(pick('city', existing?.city) || 'Dwarka, New Delhi', 'City', { min: 2, max: 80 }),
    state: optionalString(pick('state', existing?.state), 'State', { max: 80 }) || 'Delhi',
    pincode: requirePincode(pick('pincode', existing?.pincode)),
    label: requireEnum(
      optionalString(pick('label', existing?.label), 'Label', { max: 30 }) || 'Home',
      'Address label',
      ['Home', 'Work', 'Other'] as const
    ),
    instructions: optionalString(pick('instructions', existing?.instructions), 'Delivery instructions', { max: 240 }) || null,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
  };
}

customerRouter.post(
  '/addresses',
  route((req: AuthenticatedRequest, res) => {
    const customerId = req.user!.id;
    const a = parseAddressBody(req.body);
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM customer_addresses WHERE customer_id = ?`).get(customerId) as any).c;
    if (count >= 10) throw ApiError.badRequest('You can save up to 10 addresses. Remove one to add another.');
    // The first address is always the default.
    const isDefault = req.body?.isDefault || count === 0 ? 1 : 0;
    const id = randomId('addr');
    const now = new Date().toISOString();

    withTransaction(() => {
      if (isDefault) {
        db.prepare(`UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?`).run(customerId);
      }
      db.prepare(
        `INSERT INTO customer_addresses
         (id, customer_id, label, recipient_name, phone, address_line, house, street, area, city, state, pincode,
          instructions, latitude, longitude, is_default, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, customerId, a.label, a.recipientName, a.phone, a.addressLine, a.house, a.street, a.area,
        a.city, a.state, a.pincode, a.instructions, a.latitude, a.longitude, isDefault, now
      );
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
    const a = parseAddressBody(req.body, address);
    const isDefault = req.body?.isDefault === undefined ? address.is_default : req.body.isDefault ? 1 : 0;

    withTransaction(() => {
      if (isDefault) {
        db.prepare(`UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?`).run(req.user!.id);
      }
      db.prepare(
        `UPDATE customer_addresses
         SET label = ?, recipient_name = ?, phone = ?, address_line = ?, house = ?, street = ?, area = ?, city = ?,
             state = ?, pincode = ?, instructions = ?, latitude = ?, longitude = ?, is_default = ?
         WHERE id = ? AND customer_id = ?`
      ).run(
        a.label, a.recipientName, a.phone, a.addressLine, a.house, a.street, a.area, a.city, a.state, a.pincode,
        a.instructions, a.latitude, a.longitude, isDefault, req.params.id, req.user!.id
      );
    });

    res.json({ message: 'Address updated.' });
  })
);

customerRouter.post(
  '/addresses/:id/default',
  route((req: AuthenticatedRequest, res) => {
    const owned = db
      .prepare(`SELECT id FROM customer_addresses WHERE id = ? AND customer_id = ?`)
      .get(req.params.id, req.user!.id);
    if (!owned) throw ApiError.notFound('Address not found.');
    withTransaction(() => {
      db.prepare(`UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?`).run(req.user!.id);
      db.prepare(`UPDATE customer_addresses SET is_default = 1 WHERE id = ? AND customer_id = ?`).run(
        req.params.id,
        req.user!.id
      );
    });
    res.json({ message: 'Default address updated.' });
  })
);

customerRouter.delete(
  '/addresses/:id',
  route((req: AuthenticatedRequest, res) => {
    const address = db
      .prepare(`SELECT is_default FROM customer_addresses WHERE id = ? AND customer_id = ?`)
      .get(req.params.id, req.user!.id) as any;
    if (!address) throw ApiError.notFound('Address not found.');
    withTransaction(() => {
      db.prepare(`DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?`).run(req.params.id, req.user!.id);
      if (address.is_default) {
        db.prepare(
          `UPDATE customer_addresses SET is_default = 1 WHERE id = (
             SELECT id FROM customer_addresses WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1)`
        ).run(req.user!.id);
      }
    });
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
      `SELECT p.*, s.name AS store_name, s.status AS store_status, s.address AS store_address,
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
    if (product.store_status === 'inactive' || !product.published_at) {
      issues.push(`${product.store_name} is not accepting orders right now.`);
      continue;
    }
    if (product.store_status === 'closed') {
      issues.push(`${product.store_name} is currently closed. Checkout is unavailable.`);
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
          `SELECT o.id FROM orders o JOIN checkout_sessions cs ON cs.id = o.checkout_id
           WHERE cs.idempotency_key = ? AND cs.customer_id = ? ORDER BY o.created_at ASC`
        )
        .all(idempotencyKey, customerId) as any[];
      if (previous.length > 0) {
        logger.info('checkout.idempotent_replay', { customerId, idempotencyKey });
        res.json({
          message: 'This order was already placed. Showing your existing order(s).',
          idempotent: true,
          ...checkoutPayload(previous.map((row) => row.id)),
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
        area: address.area || null,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        instructions: address.instructions || null,
        latitude: address.latitude ?? null,
        longitude: address.longitude ?? null,
      };
    }

    const plan = buildCheckoutPlan(customerId, req.body?.items, fulfilmentType);
    if (plan.issues.length > 0) {
      throw ApiError.badRequest(plan.issues[0], 'checkout_conflict');
    }
    if (plan.storePlans.length === 0) {
      throw ApiError.badRequest('There is nothing to check out.', 'empty_checkout');
    }
    // The customer confirmed a specific total; if live prices/fees moved, stop and let them review.
    const expectedTotal = req.body?.expectedTotal;
    if (expectedTotal !== undefined && expectedTotal !== null && Math.abs(Number(expectedTotal) - plan.total) > 0.009) {
      throw ApiError.conflict(
        'Prices or delivery fees changed since you last reviewed your cart. Please review the updated total.',
        'price_changed'
      );
    }

    try {
      const created = withTransaction(() => {
        const now = new Date().toISOString();
        const orders: any[] = [];
        const checkoutId = randomId('chk');
        db.prepare(
          `INSERT INTO checkout_sessions (id, customer_id, idempotency_key, fulfillment_type, payment_method,
             subtotal, delivery_fee, total, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(checkoutId, customerId, idempotencyKey ?? null, fulfilmentType, paymentMethod,
          plan.subtotal, plan.deliveryFee, plan.total, now);

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
               pickup_code, delivery_code, checkout_id,
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
            checkoutId,
            group.storeName,
            `${group.storeAddress}, ${group.storeCity}`,
            now,
            now
          );

          for (const line of group.lines) {
            recordInventoryEvent({
              productId: line.productId,
              storeId: group.storeId,
              type: 'checkout',
              delta: -line.quantity,
              actorId: customerId,
              note: `Order ${number}`,
            });
            maybeNotifyLowStock(line.productId);
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
               VALUES (?, ?, 'available', ?, ?, ?)`
            ).run(randomId('job'), orderId, config.riderPayoutPerDelivery, now, now);
          }

          db.prepare(
            `INSERT INTO handoff_events (id, order_id, event_type, actor_role, actor_id, note, created_at)
             VALUES (?, ?, 'ORDER_PLACED', 'customer', ?, 'Order placed', ?)`
          ).run(randomId('he'), orderId, customerId, now);

          notifyCustomerOfOrder(customerId, orderId, number, 'placed');
          notifyStoreSeller(
            group.storeId,
            'order',
            `New order #${number}`,
            `${group.lines.length} item${group.lines.length === 1 ? '' : 's'} · ${fulfilmentType === 'pickup' ? 'Pickup' : 'Delivery'} · ₹${group.total}. Accept it to start preparing.`,
            `/seller/orders/${orderId}`
          );

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
        ...checkoutPayload(created.map((order) => order.id)),
      });
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      if (String(error?.message || '').includes('UNIQUE constraint failed: checkout_sessions')) {
        // Two identical requests raced: return the winner's orders.
        const previous = db
          .prepare(
            `SELECT o.id FROM orders o JOIN checkout_sessions cs ON cs.id = o.checkout_id
             WHERE cs.idempotency_key = ? AND cs.customer_id = ? ORDER BY o.created_at ASC`
          )
          .all(String(idempotencyKey), customerId) as any[];
        res.json({
          message: 'This order was already placed. Showing your existing order(s).',
          idempotent: true,
          ...checkoutPayload(previous.map((row) => row.id)),
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

/** Orders created by one checkout, plus the checkout-level totals. */
function checkoutPayload(orderIds: string[]) {
  const orders = orderIds.map((id) => hydrateOrder(id, 'customer'));
  const checkoutId = orders[0]?.checkoutId ?? null;
  return {
    checkoutId,
    orders,
    summary: {
      subtotal: toRupees(orders.reduce((sum, o: any) => sum + o.subtotal, 0)),
      deliveryFee: toRupees(orders.reduce((sum, o: any) => sum + o.deliveryFee, 0)),
      total: toRupees(orders.reduce((sum, o: any) => sum + o.total, 0)),
    },
  };
}

/**
 * Role-scoped order hydration. Each role receives only the fields and secrets it
 * is authorised to see (customer: delivery code; seller: pickup code after pack;
 * rider: never any code).
 */
export function hydrateOrder(orderId: string, viewer: 'customer' | 'seller' | 'rider' | 'admin') {
  const order = db
    .prepare(
      `SELECT o.*, s.name AS store_name, s.address AS store_address, s.city AS store_city,
              s.contact_phone AS store_phone, s.opening_hours, s.image AS store_image,
              u.name AS customer_name, u.phone AS customer_phone,
              dj.id AS job_id, dj.status AS job_status, dj.earnings AS job_earnings,
              dj.claimed_at, dj.picked_up_at, dj.delivered_at,
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
    checkoutId: order.checkout_id,
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
    preparingAt: order.preparing_at,
    packedAt: order.packed_at,
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
    // The delivery code is a secret released only at the handoff stage:
    //   delivery orders -> while out for delivery; pickup orders -> while ready for collection.
    const codeStage =
      order.fulfillment_type === 'pickup'
        ? order.status === 'ready_for_pickup'
        : order.status === 'out_for_delivery';
    const codeState = ['cancelled', 'rejected'].includes(order.status)
      ? 'unavailable'
      : order.status === 'delivered'
        ? 'used'
        : codeStage
          ? 'available'
          : 'locked';
    return {
      ...base,
      store: {
        id: order.store_id,
        name: order.store_name,
        address: order.store_address,
        city: order.store_city,
        phone: order.store_phone,
        image: order.store_image,
      },
      deliveryCode: codeState === 'available' ? order.delivery_code : null,
      deliveryCodeState: codeState,
      // Only a first name + initial; no rider phone number or live location.
      rider: order.rider_name ? { name: shortName(order.rider_name), status: order.job_status } : null,
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

function shortName(full: string): string {
  const parts = String(full).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

function pickupCodeRevealedForOrder(status: string): boolean {
  return ['ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivered'].includes(status);
}

customerRouter.get(
  '/orders',
  route((req: AuthenticatedRequest, res) => {
    const tab = typeof req.query.tab === 'string' ? req.query.tab : '';
    const groups: Record<string, string[]> = {
      active: ['placed', 'accepted', 'preparing', 'packed', 'ready_for_pickup', 'picked_up', 'out_for_delivery'],
      completed: ['delivered'],
      cancelled: ['cancelled', 'rejected'],
    };
    const statuses = groups[tab];
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 25));
    const where = `customer_id = ?${statuses ? ` AND status IN (${statuses.map(() => '?').join(',')})` : ''}`;
    const args = [req.user!.id, ...(statuses ?? [])];
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE ${where}`).get(...args) as any).c;
    const rows = db
      .prepare(`SELECT id FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as any[];
    const counts = db
      .prepare(
        `SELECT SUM(status IN ('delivered')) AS completed,
                SUM(status IN ('cancelled','rejected')) AS cancelled,
                SUM(status NOT IN ('delivered','cancelled','rejected')) AS active
         FROM orders WHERE customer_id = ?`
      )
      .get(req.user!.id) as any;
    res.json({
      orders: rows.map((row) => hydrateOrder(row.id, 'customer')),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
      counts: { active: counts.active ?? 0, completed: counts.completed ?? 0, cancelled: counts.cancelled ?? 0 },
    });
  })
);

// All store orders created by one checkout, viewable together.
customerRouter.get(
  '/checkouts/:id',
  route((req: AuthenticatedRequest, res) => {
    const rows = db
      .prepare(`SELECT id FROM orders WHERE checkout_id = ? AND customer_id = ? ORDER BY created_at ASC`)
      .all(req.params.id, req.user!.id) as any[];
    if (rows.length === 0) throw ApiError.notFound('Checkout not found.');
    res.json(checkoutPayload(rows.map((r) => r.id)));
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
      for (const item of items) {
        restock(item.product_id, item.quantity);
        recordInventoryEvent({
          productId: item.product_id,
          storeId: order.store_id,
          type: 'cancellation',
          delta: item.quantity,
          actorId: req.user!.id,
          note: `Order ${order.order_number} cancelled by customer`,
        });
      }

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

      notifyCustomerOfOrder(req.user!.id, order.id, order.order_number, 'cancelled');
      notifyStoreSeller(
        order.store_id,
        'order',
        `Order #${order.order_number} cancelled`,
        'The customer cancelled this order before acceptance.',
        `/seller/orders/${order.id}`
      );
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
      `SELECT p.*, s.name AS store_name, s.status AS store_status, s.published_at, s.supports_reservations,
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
    notifyStoreSeller(
      product.store_id,
      'stock_request',
      'Customer asked about stock',
      `${req.user!.name.split(' ')[0]} asked if ${product.name} × ${quantity} is available.`,
      '/seller/stock-requests'
    );

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

    if (!product.supports_reservations) {
      throw ApiError.badRequest('This store does not accept reservations.', 'reservations_unsupported');
    }
    let requestedFor: string | null = null;
    if (req.body?.requestedFor) {
      const when = new Date(String(req.body.requestedFor));
      if (Number.isNaN(when.getTime())) throw ApiError.badRequest('Please choose a valid pickup time.');
      if (when.getTime() < Date.now() - 60_000) throw ApiError.badRequest('Pickup time must be in the future.');
      if (when.getTime() > Date.now() + 7 * 24 * 3600 * 1000) {
        throw ApiError.badRequest('Reservations can be requested up to 7 days ahead.');
      }
      requestedFor = when.toISOString();
    }

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
       (id, customer_id, store_id, product_id, requested_quantity, status, note, holds_stock, requested_at, requested_for, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?, ?, ?)`
    ).run(
      id,
      req.user!.id,
      product.store_id,
      product.id,
      quantity,
      optionalString(req.body?.note, 'Note', { max: 300 }) || null,
      now,
      requestedFor,
      now,
      now
    );
    notifyStoreSeller(
      product.store_id,
      'reservation',
      'New reservation request',
      `${req.user!.name.split(' ')[0]} requested ${quantity} × ${product.name}.`,
      '/seller/reservations'
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
    expireReservations();
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

customerRouter.get(
  '/profile',
  route((req: AuthenticatedRequest, res) => {
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.id);
    res.json({ user: { ...publicUser(user), avatarUrl: (user as any).avatar_url ?? null } });
  })
);

customerRouter.put(
  '/profile',
  route((req: AuthenticatedRequest, res) => {
    const name = requireString(req.body?.name ?? req.user!.name, 'Full name', { min: 2, max: 80 });
    const phone = req.body?.phone ? requirePhone(req.body.phone, 'Phone') : req.user!.phone;
    const avatar =
      req.body?.avatarUrl === undefined
        ? undefined
        : req.body.avatarUrl === null || req.body.avatarUrl === ''
          ? null
          : requireUploadUrl(req.body.avatarUrl);
    db.prepare(
      `UPDATE users SET name = ?, phone = ?, ${avatar === undefined ? '' : 'avatar_url = ?,'} updated_at = ? WHERE id = ?`
    ).run(
      ...[name, phone || null, ...(avatar === undefined ? [] : [avatar]), new Date().toISOString(), req.user!.id]
    );
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.id) as any;
    // Never return the raw row: it contains the password hash and salt.
    res.json({ user: { ...publicUser(user), avatarUrl: user.avatar_url ?? null }, message: 'Profile updated.' });
  })
);

export { buildCheckoutPlan };
