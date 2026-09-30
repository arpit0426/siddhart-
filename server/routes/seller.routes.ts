import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { requireAuth, requireRole, AuthenticatedRequest } from '../auth.js';

export const sellerRouter = Router();

// All seller routes require seller authentication
sellerRouter.use(requireAuth, requireRole('seller'));

// Helper: Get seller's store
function getSellerStore(sellerId: string) {
  return db.prepare(`SELECT * FROM stores WHERE seller_id = ?`).get(sellerId) as any;
}

// Get Seller's Store
sellerRouter.get('/store', (req: AuthenticatedRequest, res) => {
  const store = getSellerStore(req.user!.id);
  res.json({ store: store || null });
});

// Create or Update Store
sellerRouter.post('/store', (req: AuthenticatedRequest, res) => {
  const sellerId = req.user!.id;
  const { name, description, category, address, city, state, pincode, openingHours, status, image } = req.body;

  if (!name || !address || !pincode) {
    res.status(400).json({ error: 'Store name, address, and pincode are required' });
    return;
  }

  const existingStore = getSellerStore(sellerId);
  const now = new Date().toISOString();

  if (existingStore) {
    db.prepare(`
      UPDATE stores
      SET name = ?, description = ?, category = ?, address = ?, city = ?, state = ?,
          pincode = ?, opening_hours = ?, status = ?, image = COALESCE(?, image), updated_at = ?
      WHERE id = ?
    `).run(
      name, description || '', category || 'General Store', address, city || 'Dwarka, New Delhi',
      state || 'Delhi', pincode, openingHours || '08:00 AM - 10:00 PM',
      status || 'open', image || null, now, existingStore.id
    );
    const updated = getSellerStore(sellerId);
    res.json({ store: updated, message: 'Store profile updated successfully' });
  } else {
    const storeId = `store_${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO stores (
        id, seller_id, name, description, category, address, city, state, pincode,
        opening_hours, status, image, published_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      storeId, sellerId, name, description || '', category || 'General Store', address,
      city || 'Dwarka, New Delhi', state || 'Delhi', pincode, openingHours || '08:00 AM - 10:00 PM',
      status || 'open', image || null, now, now, now
    );
    const created = getSellerStore(sellerId);
    res.status(201).json({ store: created, message: 'Store created successfully' });
  }
});

// Get Products
sellerRouter.get('/products', (req: AuthenticatedRequest, res) => {
  const store = getSellerStore(req.user!.id);
  if (!store) {
    res.json({ products: [] });
    return;
  }

  const products = db.prepare(`
    SELECT * FROM products 
    WHERE store_id = ? 
    ORDER BY created_at DESC
  `).all(store.id);

  res.json({ products });
});

// Create Product
sellerRouter.post('/products', (req: AuthenticatedRequest, res) => {
  const store = getSellerStore(req.user!.id);
  if (!store) {
    res.status(400).json({ error: 'Please configure your store profile before adding products' });
    return;
  }

  const { name, description, category, price, stock, image } = req.body;
  if (!name || typeof price !== 'number' || price < 0 || typeof stock !== 'number' || stock < 0) {
    res.status(400).json({ error: 'Product name, valid price, and non-negative stock are required' });
    return;
  }

  const id = `prod_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO products (id, store_id, name, description, category, image, price, stock, is_published, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, store.id, name.trim(), description || '', category || 'Daily Needs',
    image || null, price, Math.floor(stock), now, now
  );

  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
  res.status(201).json({ product, message: 'Product published to store' });
});

// Update Product
sellerRouter.put('/products/:id', (req: AuthenticatedRequest, res) => {
  const store = getSellerStore(req.user!.id);
  if (!store) {
    res.status(403).json({ error: 'Store not found' });
    return;
  }

  const { name, description, category, price, stock, isPublished, image } = req.body;
  const existingProd = db.prepare(`SELECT * FROM products WHERE id = ? AND store_id = ?`).get(req.params.id, store.id) as any;

  if (!existingProd) {
    res.status(404).json({ error: 'Product not found or does not belong to your store' });
    return;
  }

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE products
    SET name = COALESCE(?, name),
        description = COALESCE(?, description),
        category = COALESCE(?, category),
        price = COALESCE(?, price),
        stock = COALESCE(?, stock),
        is_published = COALESCE(?, is_published),
        image = COALESCE(?, image),
        updated_at = ?
    WHERE id = ? AND store_id = ?
  `).run(
    name ?? null,
    description ?? null,
    category ?? null,
    typeof price === 'number' ? price : null,
    typeof stock === 'number' ? Math.floor(stock) : null,
    typeof isPublished === 'boolean' ? (isPublished ? 1 : 0) : null,
    image ?? null,
    now,
    req.params.id,
    store.id
  );

  const updatedProd = db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id);
  res.json({ product: updatedProd, message: 'Product updated successfully' });
});

// Delete / Unpublish Product
sellerRouter.delete('/products/:id', (req: AuthenticatedRequest, res) => {
  const store = getSellerStore(req.user!.id);
  if (!store) {
    res.status(403).json({ error: 'Store not found' });
    return;
  }

  const result = db.prepare(`
    UPDATE products SET is_published = 0, updated_at = ? WHERE id = ? AND store_id = ?
  `).run(new Date().toISOString(), req.params.id, store.id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Product not found or not owned by your store' });
    return;
  }

  res.json({ message: 'Product unpublished from storefront' });
});

// Seller Orders
sellerRouter.get('/orders', (req: AuthenticatedRequest, res) => {
  const store = getSellerStore(req.user!.id);
  if (!store) {
    res.json({ orders: [] });
    return;
  }

  const orders = db.prepare(`
    SELECT o.id, o.order_number, o.status, o.fulfillment_type, o.subtotal, o.delivery_fee, o.total,
           o.payment_method, o.address_snapshot, o.created_at, o.updated_at,
           CASE 
             WHEN o.status IN ('packed', 'ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivered') 
             THEN o.pickup_code 
             ELSE NULL 
           END as pickup_code,
           u.name as customer_name, u.phone as customer_phone,
           dj.status as delivery_status, r.name as rider_name, r.phone as rider_phone
    FROM orders o
    JOIN users u ON o.customer_id = u.id
    LEFT JOIN delivery_jobs dj ON o.id = dj.order_id
    LEFT JOIN users r ON dj.rider_id = r.id
    WHERE o.store_id = ?
    ORDER BY o.created_at DESC
  `).all(store.id) as any[];

  const ordersWithItems = orders.map(ord => {
    const items = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).all(ord.id);
    return {
      ...ord,
      address_snapshot: JSON.parse(ord.address_snapshot || '{}'),
      items
    };
  });

  res.json({ orders: ordersWithItems });
});

// Single Order for Seller
sellerRouter.get('/orders/:id', (req: AuthenticatedRequest, res) => {
  const store = getSellerStore(req.user!.id);
  if (!store) {
    res.status(403).json({ error: 'Store not found' });
    return;
  }

  const order = db.prepare(`
    SELECT o.id, o.order_number, o.status, o.fulfillment_type, o.subtotal, o.delivery_fee, o.total,
           o.payment_method, o.address_snapshot, o.created_at, o.updated_at,
           CASE 
             WHEN o.status IN ('packed', 'ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivered') 
             THEN o.pickup_code 
             ELSE NULL 
           END as pickup_code,
           u.name as customer_name, u.phone as customer_phone,
           dj.status as delivery_status, r.name as rider_name, r.phone as rider_phone
    FROM orders o
    JOIN users u ON o.customer_id = u.id
    LEFT JOIN delivery_jobs dj ON o.id = dj.order_id
    LEFT JOIN users r ON dj.rider_id = r.id
    WHERE o.id = ? AND o.store_id = ?
  `).get(req.params.id, store.id) as any;

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

// Order State Transitions: PLACED -> ACCEPTED -> PREPARING -> PACKED -> READY_FOR_PICKUP
sellerRouter.post('/orders/:id/status', (req: AuthenticatedRequest, res) => {
  const store = getSellerStore(req.user!.id);
  if (!store) {
    res.status(403).json({ error: 'Store not found' });
    return;
  }

  const { status } = req.body;
  const order = db.prepare(`SELECT * FROM orders WHERE id = ? AND store_id = ?`).get(req.params.id, store.id) as any;

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  // State machine rules
  const validTransitions: Record<string, string[]> = {
    'placed': ['accepted', 'rejected', 'cancelled'],
    'accepted': ['preparing', 'cancelled'],
    'preparing': ['packed'],
    'packed': ['ready_for_pickup'],
    'ready_for_pickup': [] // Next transition handled by rider pickup
  };

  const allowed = validTransitions[order.status] || [];
  if (!allowed.includes(status)) {
    res.status(400).json({
      error: `Invalid status transition from "${order.status}" to "${status}". Allowed transitions: ${allowed.join(', ') || 'None'}`
    });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, order.id);

  // Record audit handoff event
  db.prepare(`
    INSERT INTO handoff_events (id, order_id, event_type, actor_role, actor_id, note, created_at)
    VALUES (?, ?, ?, 'seller', ?, ?, ?)
  `).run(
    `he_${crypto.randomUUID().slice(0, 8)}`,
    order.id,
    `ORDER_${status.toUpperCase()}`,
    req.user!.id,
    `Order status changed to ${status} by seller`,
    now
  );

  const updatedOrder = db.prepare(`
    SELECT o.*, 
           CASE WHEN o.status IN ('packed', 'ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivered') 
           THEN o.pickup_code ELSE NULL END as pickup_code
    FROM orders o WHERE o.id = ?
  `).get(order.id) as any;

  res.json({
    message: `Order status updated to ${status}`,
    order: updatedOrder
  });
});

// Stock Check Requests for Seller
sellerRouter.get('/stock-requests', (req: AuthenticatedRequest, res) => {
  const store = getSellerStore(req.user!.id);
  if (!store) {
    res.json({ requests: [] });
    return;
  }

  const requests = db.prepare(`
    SELECT sr.*, p.name as product_name, p.stock as current_stock, p.image as product_image,
           u.name as customer_name, u.phone as customer_phone
    FROM stock_requests sr
    JOIN products p ON sr.product_id = p.id
    JOIN users u ON sr.customer_id = u.id
    WHERE sr.store_id = ?
    ORDER BY sr.created_at DESC
  `).all(store.id);

  res.json({ requests });
});

sellerRouter.put('/stock-requests/:id', (req: AuthenticatedRequest, res) => {
  const store = getSellerStore(req.user!.id);
  if (!store) {
    res.status(403).json({ error: 'Store not found' });
    return;
  }

  const { status, sellerResponse } = req.body;
  if (!['confirmed', 'unavailable'].includes(status)) {
    res.status(400).json({ error: 'Status must be "confirmed" or "unavailable"' });
    return;
  }

  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE stock_requests
    SET status = ?, seller_response = ?, updated_at = ?
    WHERE id = ? AND store_id = ?
  `).run(status, sellerResponse || null, now, req.params.id, store.id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Stock request not found' });
    return;
  }

  res.json({ message: `Stock request marked as ${status}` });
});

// Reservations for Seller
sellerRouter.get('/reservations', (req: AuthenticatedRequest, res) => {
  const store = getSellerStore(req.user!.id);
  if (!store) {
    res.json({ reservations: [] });
    return;
  }

  const reservations = db.prepare(`
    SELECT r.*, p.name as product_name, p.price as product_price, p.stock as current_stock,
           u.name as customer_name, u.phone as customer_phone
    FROM reservations r
    JOIN products p ON r.product_id = p.id
    JOIN users u ON r.customer_id = u.id
    WHERE r.store_id = ?
    ORDER BY r.created_at DESC
  `).all(store.id);

  res.json({ reservations });
});

sellerRouter.put('/reservations/:id', (req: AuthenticatedRequest, res) => {
  const store = getSellerStore(req.user!.id);
  if (!store) {
    res.status(403).json({ error: 'Store not found' });
    return;
  }

  const { status, sellerResponse } = req.body;
  if (!['confirmed', 'rejected', 'fulfilled', 'cancelled'].includes(status)) {
    res.status(400).json({ error: 'Invalid reservation response status' });
    return;
  }

  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE reservations
    SET status = ?, seller_response = ?, updated_at = ?
    WHERE id = ? AND store_id = ?
  `).run(status, sellerResponse || null, now, req.params.id, store.id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Reservation not found' });
    return;
  }

  res.json({ message: `Reservation marked as ${status}` });
});

// Seller Analytics / Performance
sellerRouter.get('/analytics', (req: AuthenticatedRequest, res) => {
  const store = getSellerStore(req.user!.id);
  if (!store) {
    res.json({ totalRevenue: 0, orderCount: 0, pendingCount: 0, lowStockCount: 0 });
    return;
  }

  const revRow = db.prepare(`
    SELECT COALESCE(SUM(subtotal), 0) as totalRevenue, COUNT(*) as orderCount
    FROM orders 
    WHERE store_id = ? AND status != 'cancelled' AND status != 'rejected'
  `).get(store.id) as any;

  const pendingRow = db.prepare(`
    SELECT COUNT(*) as pendingCount 
    FROM orders 
    WHERE store_id = ? AND status IN ('placed', 'accepted', 'preparing', 'packed')
  `).get(store.id) as any;

  const lowStockRow = db.prepare(`
    SELECT COUNT(*) as lowStockCount 
    FROM products 
    WHERE store_id = ? AND stock <= 5
  `).get(store.id) as any;

  res.json({
    totalRevenue: revRow.totalRevenue,
    orderCount: revRow.orderCount,
    pendingCount: pendingRow.pendingCount,
    lowStockCount: lowStockRow.lowStockCount
  });
});
