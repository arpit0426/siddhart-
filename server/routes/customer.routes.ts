import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { requireAuth, requireRole, AuthenticatedRequest } from '../auth.js';

export const customerRouter = Router();

// Public / Discoverable Stores
customerRouter.get('/stores', (req, res) => {
  const { query, category } = req.query;
  let sql = `SELECT * FROM stores WHERE status != 'inactive'`;
  const params: any[] = [];

  if (query) {
    sql += ` AND (name LIKE ? OR description LIKE ? OR city LIKE ?)`;
    const q = `%${query}%`;
    params.push(q, q, q);
  }
  if (category) {
    sql += ` AND category = ?`;
    params.push(category);
  }

  sql += ` ORDER BY name ASC`;
  const stores = db.prepare(sql).all(...params);
  res.json({ stores });
});

// Single Store Details
customerRouter.get('/stores/:id', (req, res) => {
  const store = db.prepare(`SELECT * FROM stores WHERE id = ?`).get(req.params.id) as any;
  if (!store) {
    res.status(404).json({ error: 'Store not found' });
    return;
  }

  const products = db.prepare(`
    SELECT * FROM products 
    WHERE store_id = ? AND is_published = 1 
    ORDER BY created_at DESC
  `).all(req.params.id);

  res.json({ store, products });
});

// Search Products across stores
customerRouter.get('/products', (req, res) => {
  const { query, category, storeId, maxPrice, inStockOnly } = req.query;
  let sql = `
    SELECT p.*, s.name as store_name, s.status as store_status, s.city as store_city
    FROM products p
    JOIN stores s ON p.store_id = s.id
    WHERE p.is_published = 1 AND s.status != 'inactive'
  `;
  const params: any[] = [];

  if (query) {
    sql += ` AND (p.name LIKE ? OR p.description LIKE ? OR p.category LIKE ?)`;
    const q = `%${query}%`;
    params.push(q, q, q);
  }
  if (category) {
    sql += ` AND p.category = ?`;
    params.push(category);
  }
  if (storeId) {
    sql += ` AND p.store_id = ?`;
    params.push(storeId);
  }
  if (maxPrice) {
    sql += ` AND p.price <= ?`;
    params.push(Number(maxPrice));
  }
  if (inStockOnly === 'true') {
    sql += ` AND p.stock > 0`;
  }

  sql += ` ORDER BY p.name ASC`;
  const products = db.prepare(sql).all(...params);
  res.json({ products });
});

// Single Product Details
customerRouter.get('/products/:id', (req, res) => {
  const product = db.prepare(`
    SELECT p.*, s.name as store_name, s.address as store_address, s.city as store_city, s.status as store_status
    FROM products p
    JOIN stores s ON p.store_id = s.id
    WHERE p.id = ?
  `).get(req.params.id) as any;

  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  res.json({ product });
});

// Protected: Cart Operations
customerRouter.use('/cart', requireAuth, requireRole('customer'));

// Get Cart
customerRouter.get('/cart', (req: AuthenticatedRequest, res) => {
  const customerId = req.user!.id;

  let cart = db.prepare(`SELECT * FROM carts WHERE customer_id = ?`).get(customerId) as any;
  if (!cart) {
    const now = new Date().toISOString();
    const cartId = `cart_${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`INSERT INTO carts (id, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(cartId, customerId, now, now);
    cart = { id: cartId, customer_id: customerId };
  }

  const items = db.prepare(`
    SELECT ci.id, ci.quantity, p.id as product_id, p.name, p.price, p.stock, p.image, p.category,
           s.id as store_id, s.name as store_name, s.status as store_status
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    JOIN stores s ON p.store_id = s.id
    WHERE ci.cart_id = ?
    ORDER BY s.name ASC, p.name ASC
  `).all(cart.id);

  res.json({ cart, items });
});

// Add / Update Cart Item
customerRouter.post('/cart/items', requireAuth, requireRole('customer'), (req: AuthenticatedRequest, res) => {
  const customerId = req.user!.id;
  const { productId, quantity } = req.body;

  if (!productId || typeof quantity !== 'number' || quantity < 0) {
    res.status(400).json({ error: 'Invalid product or quantity' });
    return;
  }

  const product = db.prepare(`SELECT * FROM products WHERE id = ? AND is_published = 1`).get(productId) as any;
  if (!product) {
    res.status(404).json({ error: 'Product not found or unavailable' });
    return;
  }

  if (quantity > product.stock) {
    res.status(400).json({ 
      error: `Only ${product.stock} units available in stock. Cannot add ${quantity} units.` 
    });
    return;
  }

  let cart = db.prepare(`SELECT * FROM carts WHERE customer_id = ?`).get(customerId) as any;
  const now = new Date().toISOString();

  if (!cart) {
    const cartId = `cart_${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`INSERT INTO carts (id, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(cartId, customerId, now, now);
    cart = { id: cartId };
  }

  if (quantity === 0) {
    db.prepare(`DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?`).run(cart.id, productId);
    res.json({ message: 'Item removed from cart' });
    return;
  }

  const existingItem = db.prepare(`SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?`).get(cart.id, productId) as any;
  if (existingItem) {
    db.prepare(`
      UPDATE cart_items 
      SET quantity = ?, updated_at = ? 
      WHERE id = ?
    `).run(quantity, now, existingItem.id);
  } else {
    const itemId = `ci_${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO cart_items (id, cart_id, product_id, quantity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(itemId, cart.id, productId, quantity, now, now);
  }

  res.json({ message: 'Cart updated successfully' });
});

// Clear Cart
customerRouter.delete('/cart/clear', requireAuth, requireRole('customer'), (req: AuthenticatedRequest, res) => {
  const customerId = req.user!.id;
  const cart = db.prepare(`SELECT id FROM carts WHERE customer_id = ?`).get(customerId) as any;
  if (cart) {
    db.prepare(`DELETE FROM cart_items WHERE cart_id = ?`).run(cart.id);
  }
  res.json({ message: 'Cart cleared' });
});

// Saved Addresses
customerRouter.get('/addresses', requireAuth, requireRole('customer'), (req: AuthenticatedRequest, res) => {
  const addresses = db.prepare(`
    SELECT * FROM customer_addresses 
    WHERE customer_id = ? 
    ORDER BY is_default DESC, created_at DESC
  `).all(req.user!.id);
  res.json({ addresses });
});

customerRouter.post('/addresses', requireAuth, requireRole('customer'), (req: AuthenticatedRequest, res) => {
  const { label, recipientName, phone, addressLine, city, state, pincode, isDefault } = req.body;

  if (!recipientName || !addressLine || !pincode) {
    res.status(400).json({ error: 'Recipient name, address, and pincode are required' });
    return;
  }

  const customerId = req.user!.id;
  const id = `addr_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  if (isDefault) {
    db.prepare(`UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?`).run(customerId);
  }

  db.prepare(`
    INSERT INTO customer_addresses (id, customer_id, label, recipient_name, phone, address_line, city, state, pincode, is_default, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, customerId, label || 'Home', recipientName, phone || '', addressLine,
    city || 'Dwarka, New Delhi', state || 'Delhi', pincode, isDefault ? 1 : 0, now
  );

  res.status(201).json({ id, message: 'Address saved successfully' });
});

// Multi-Store Checkout with Atomic Inventory Deductions
customerRouter.post('/checkout', requireAuth, requireRole('customer'), (req: AuthenticatedRequest, res) => {
  const customerId = req.user!.id;
  const { items, addressId, addressSnapshot, fulfillmentType = 'delivery', paymentMethod = 'cod', idempotencyKey } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Checkout requires at least one item' });
    return;
  }

  // Check idempotency if key provided
  if (idempotencyKey) {
    const existingOrder = db.prepare(`SELECT * FROM orders WHERE idempotency_key = ?`).get(idempotencyKey) as any;
    if (existingOrder) {
      res.json({ message: 'Order already processed', orders: [existingOrder], idempotency: true });
      return;
    }
  }

  // Resolve address snapshot
  let resolvedAddress = addressSnapshot;
  if (!resolvedAddress && addressId) {
    const addr = db.prepare(`SELECT * FROM customer_addresses WHERE id = ? AND customer_id = ?`).get(addressId, customerId) as any;
    if (addr) {
      resolvedAddress = {
        name: addr.recipient_name,
        phone: addr.phone,
        address: addr.address_line,
        city: addr.city,
        pincode: addr.pincode
      };
    }
  }

  if (!resolvedAddress && fulfillmentType === 'delivery') {
    res.status(400).json({ error: 'Delivery address is required for delivery orders' });
    return;
  }

  // Group items by store for Multi-Store Order Generation
  const itemsByStore: Record<string, typeof items> = {};
  for (const item of items) {
    if (!item.productId || !item.quantity || item.quantity <= 0) {
      res.status(400).json({ error: 'Invalid product item format' });
      return;
    }

    const prod = db.prepare(`SELECT * FROM products WHERE id = ?`).get(item.productId) as any;
    if (!prod) {
      res.status(400).json({ error: `Product ${item.productId} not found` });
      return;
    }
    if (prod.stock < item.quantity) {
      res.status(400).json({
        error: `Insufficient stock for "${prod.name}". Available: ${prod.stock}, Requested: ${item.quantity}.`
      });
      return;
    }

    if (!itemsByStore[prod.store_id]) {
      itemsByStore[prod.store_id] = [];
    }
    itemsByStore[prod.store_id].push({
      ...item,
      product: prod
    });
  }

  // ATOMIC TRANSACTION: Deduct stock, create orders, create delivery jobs, clear cart
  db.exec('BEGIN IMMEDIATE');

  try {
    const createdOrders: any[] = [];
    const now = new Date().toISOString();

    for (const storeId of Object.keys(itemsByStore)) {
      const storeItems = itemsByStore[storeId];
      let subtotal = 0;

      // 1. Validate & Deduct stock atomically
      for (const item of storeItems) {
        const result = db.prepare(`
          UPDATE products 
          SET stock = stock - ?, updated_at = ?
          WHERE id = ? AND stock >= ?
        `).run(item.quantity, now, item.productId, item.quantity);

        if (result.changes === 0) {
          throw new Error(`Out of stock race condition for "${item.product.name}". Please try again.`);
        }

        subtotal += item.product.price * item.quantity;
      }

      // 2. Compute delivery fee: ₹30 flat per store for neighbourhood delivery
      const deliveryFee = fulfillmentType === 'delivery' ? 30.0 : 0.0;
      const total = subtotal + deliveryFee;

      // 3. Generate secure verification codes
      // Pickup code: 4-digit numeric string formatted as PK-XXXX
      const pickupCodeNum = Math.floor(1000 + Math.random() * 9000);
      const pickupCode = `PK-${pickupCodeNum}`;

      // Delivery code: 4-digit numeric string formatted as DL-XXXX
      const deliveryCodeNum = Math.floor(1000 + Math.random() * 9000);
      const deliveryCode = `DL-${deliveryCodeNum}`;

      const orderId = `ord_${crypto.randomUUID().slice(0, 8)}`;
      const orderNumber = `NB-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

      db.prepare(`
        INSERT INTO orders (
          id, order_number, customer_id, store_id, status, fulfillment_type,
          subtotal, delivery_fee, total, payment_method, address_snapshot,
          pickup_code, delivery_code, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'placed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderId, orderNumber, customerId, storeId, fulfillmentType,
        subtotal, deliveryFee, total, paymentMethod, JSON.stringify(resolvedAddress || {}),
        pickupCode, deliveryCode, idempotencyKey || null, now, now
      );

      // 4. Insert Order Items
      for (const item of storeItems) {
        const lineTotal = item.product.price * item.quantity;
        db.prepare(`
          INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, line_total, product_image)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `oi_${crypto.randomUUID().slice(0, 8)}`,
          orderId,
          item.product.id,
          item.product.name,
          item.product.price,
          item.quantity,
          lineTotal,
          item.product.image
        );
      }

      // 5. Create Delivery Job if delivery fulfillment
      if (fulfillmentType === 'delivery') {
        const jobId = `job_${crypto.randomUUID().slice(0, 8)}`;
        db.prepare(`
          INSERT INTO delivery_jobs (id, order_id, status, earnings, created_at, updated_at)
          VALUES (?, ?, 'available', 40.0, ?, ?)
        `).run(jobId, orderId, now, now);
      }

      // 6. Record Audit Handoff Event
      db.prepare(`
        INSERT INTO handoff_events (id, order_id, event_type, actor_role, actor_id, note, created_at)
        VALUES (?, ?, 'ORDER_PLACED', 'customer', ?, 'Order placed by customer', ?)
      `).run(`he_${crypto.randomUUID().slice(0, 8)}`, orderId, customerId, now);

      createdOrders.push({
        id: orderId,
        orderNumber,
        storeId,
        subtotal,
        deliveryFee,
        total,
        status: 'placed',
        deliveryCode // Returned only to customer
      });
    }

    // 7. Clear customer cart items that were purchased
    const cart = db.prepare(`SELECT id FROM carts WHERE customer_id = ?`).get(customerId) as any;
    if (cart) {
      for (const item of items) {
        db.prepare(`DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?`).run(cart.id, item.productId);
      }
    }

    db.exec('COMMIT');

    res.status(201).json({
      message: 'Order(s) placed successfully',
      orders: createdOrders
    });
  } catch (error: any) {
    db.exec('ROLLBACK');
    res.status(400).json({ error: error.message || 'Checkout failed' });
  }
});

// Customer's Orders List
customerRouter.get('/orders', requireAuth, requireRole('customer'), (req: AuthenticatedRequest, res) => {
  const customerId = req.user!.id;

  const orders = db.prepare(`
    SELECT o.id, o.order_number, o.status, o.fulfillment_type, o.subtotal, o.delivery_fee, o.total,
           o.payment_method, o.delivery_code, o.created_at, o.updated_at,
           s.name as store_name, s.address as store_address, s.city as store_city,
           dj.status as delivery_status, dj.rider_id, r.name as rider_name, r.phone as rider_phone
    FROM orders o
    JOIN stores s ON o.store_id = s.id
    LEFT JOIN delivery_jobs dj ON o.id = dj.order_id
    LEFT JOIN users r ON dj.rider_id = r.id
    WHERE o.customer_id = ?
    ORDER BY o.created_at DESC
  `).all(customerId) as any[];

  // Fetch items for each order
  const ordersWithItems = orders.map(ord => {
    const items = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).all(ord.id);
    return {
      ...ord,
      items
    };
  });

  res.json({ orders: ordersWithItems });
});

// Customer Single Order Details
customerRouter.get('/orders/:id', requireAuth, requireRole('customer'), (req: AuthenticatedRequest, res) => {
  const customerId = req.user!.id;

  const order = db.prepare(`
    SELECT o.id, o.order_number, o.status, o.fulfillment_type, o.subtotal, o.delivery_fee, o.total,
           o.payment_method, o.address_snapshot, o.delivery_code, o.created_at, o.updated_at,
           s.name as store_name, s.address as store_address, s.city as store_city, s.phone as store_phone,
           dj.status as delivery_status, dj.rider_id, r.name as rider_name, r.phone as rider_phone
    FROM orders o
    JOIN stores s ON o.store_id = s.id
    LEFT JOIN delivery_jobs dj ON o.id = dj.order_id
    LEFT JOIN users r ON dj.rider_id = r.id
    WHERE o.id = ? AND o.customer_id = ?
  `).get(req.params.id, customerId) as any;

  if (!order) {
    res.status(404).json({ error: 'Order not found or unauthorized' });
    return;
  }

  const items = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).all(order.id);
  const events = db.prepare(`SELECT * FROM handoff_events WHERE order_id = ? ORDER BY created_at ASC`).all(order.id);

  res.json({
    order: {
      ...order,
      address_snapshot: JSON.parse(order.address_snapshot || '{}'),
      items,
      events
    }
  });
});

// Stock Check Requests
customerRouter.post('/stock-requests', requireAuth, requireRole('customer'), (req: AuthenticatedRequest, res) => {
  const customerId = req.user!.id;
  const { productId, requestedQuantity } = req.body;

  const prod = db.prepare(`SELECT * FROM products WHERE id = ?`).get(productId) as any;
  if (!prod) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  const id = `sr_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO stock_requests (id, customer_id, store_id, product_id, requested_quantity, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, customerId, prod.store_id, productId, requestedQuantity || 1, now, now);

  res.status(201).json({ id, message: 'Stock check request sent to seller' });
});

customerRouter.get('/stock-requests', requireAuth, requireRole('customer'), (req: AuthenticatedRequest, res) => {
  const requests = db.prepare(`
    SELECT sr.*, p.name as product_name, p.image as product_image, s.name as store_name
    FROM stock_requests sr
    JOIN products p ON sr.product_id = p.id
    JOIN stores s ON sr.store_id = s.id
    WHERE sr.customer_id = ?
    ORDER BY sr.created_at DESC
  `).all(req.user!.id);
  res.json({ requests });
});

// Reservations
customerRouter.post('/reservations', requireAuth, requireRole('customer'), (req: AuthenticatedRequest, res) => {
  const customerId = req.user!.id;
  const { productId, requestedQuantity } = req.body;

  const prod = db.prepare(`SELECT * FROM products WHERE id = ?`).get(productId) as any;
  if (!prod) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  const id = `res_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO reservations (id, customer_id, store_id, product_id, requested_quantity, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, customerId, prod.store_id, productId, requestedQuantity || 1, now, now);

  res.status(201).json({ id, message: 'Item reservation request submitted' });
});

customerRouter.get('/reservations', requireAuth, requireRole('customer'), (req: AuthenticatedRequest, res) => {
  const reservations = db.prepare(`
    SELECT r.*, p.name as product_name, p.price as product_price, p.image as product_image, s.name as store_name
    FROM reservations r
    JOIN products p ON r.product_id = p.id
    JOIN stores s ON r.store_id = s.id
    WHERE r.customer_id = ?
    ORDER BY r.created_at DESC
  `).all(req.user!.id);
  res.json({ reservations });
});
