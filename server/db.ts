import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Ensure data directory exists
const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'nearbuy.db');

export const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and foreign keys for high reliability and concurrency
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

export function initDatabase() {
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK(role IN ('customer', 'seller', 'rider')),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Stores table
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      pincode TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      opening_hours TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed', 'inactive')),
      image TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Products table
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      image TEXT,
      price REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      is_published INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
    );

    -- Customer Addresses table
    CREATE TABLE IF NOT EXISTS customer_addresses (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'Home',
      recipient_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address_line TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      pincode TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Customer Carts table
    CREATE TABLE IF NOT EXISTS carts (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Cart Items table
    CREATE TABLE IF NOT EXISTS cart_items (
      id TEXT PRIMARY KEY,
      cart_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(cart_id, product_id),
      FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    -- Orders table
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'placed' CHECK(status IN (
        'placed', 'accepted', 'preparing', 'packed', 
        'ready_for_pickup', 'picked_up', 'out_for_delivery', 
        'delivered', 'cancelled', 'rejected'
      )),
      fulfillment_type TEXT NOT NULL DEFAULT 'delivery' CHECK(fulfillment_type IN ('delivery', 'pickup')),
      subtotal REAL NOT NULL,
      delivery_fee REAL NOT NULL,
      total REAL NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'cod',
      address_snapshot TEXT NOT NULL,
      rider_id TEXT,
      pickup_code TEXT NOT NULL,
      delivery_code TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (store_id) REFERENCES stores(id),
      FOREIGN KEY (rider_id) REFERENCES users(id)
    );

    -- Order Items table
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      line_total REAL NOT NULL,
      product_image TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    -- Delivery Jobs table
    CREATE TABLE IF NOT EXISTS delivery_jobs (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      rider_id TEXT,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN (
        'available', 'claimed', 'pickup_verified', 'out_for_delivery', 'completed', 'cancelled'
      )),
      earnings REAL NOT NULL DEFAULT 40.0,
      claimed_at TEXT,
      picked_up_at TEXT,
      delivered_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (rider_id) REFERENCES users(id)
    );

    -- Handoff Events audit log
    CREATE TABLE IF NOT EXISTS handoff_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    -- Stock check requests
    CREATE TABLE IF NOT EXISTS stock_requests (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      requested_quantity INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'unavailable')),
      seller_response TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (store_id) REFERENCES stores(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    -- Reservations
    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      requested_quantity INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'rejected', 'fulfilled', 'cancelled')),
      seller_response TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (store_id) REFERENCES stores(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    -- Indexes for high-performance lookups
    CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_delivery_jobs_status ON delivery_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_delivery_jobs_rider ON delivery_jobs(rider_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);
}

// Initialise database schema on module load
initDatabase();
