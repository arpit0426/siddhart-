import type { DatabaseSync } from 'node:sqlite';

/**
 * Ordered, idempotent schema migrations.
 *
 * Every migration is applied exactly once and recorded in `schema_migrations`.
 * Migrations must be additive/safe: they run automatically on server start
 * (`npm run dev`, `npm start`, `npm run db:migrate`) so a deployment never
 * requires manual schema edits.
 */
export interface Migration {
  id: string;
  description: string;
  up: (db: DatabaseSync) => void;
}

const baseline = `
  -- Users (all three roles share one identity table; role decides the workspace)
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

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

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

  CREATE TABLE IF NOT EXISTS carts (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
  );

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

  CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
  CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
  CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_delivery_jobs_status ON delivery_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_delivery_jobs_rider ON delivery_jobs(rider_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

export const migrations: Migration[] = [
  {
    id: '001_baseline',
    description: 'Baseline NearBuy schema (users, stores, products, carts, orders, jobs, requests)',
    up: (db) => {
      db.exec(baseline);
    },
  },
  {
    id: '002_inventory',
    description:
      'Authoritative inventory table (stockQuantity/reservedQuantity) backfilled from products.stock',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS inventory (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL UNIQUE,
          stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
          reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity >= 0),
          low_stock_threshold INTEGER NOT NULL DEFAULT 5,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);
      `);

      const now = new Date().toISOString();
      const products = db.prepare(`SELECT id, stock FROM products`).all() as any[];
      const insert = db.prepare(`
        INSERT INTO inventory (id, product_id, stock_quantity, reserved_quantity, low_stock_threshold, updated_at)
        VALUES (?, ?, ?, 0, 5, ?)
        ON CONFLICT(product_id) DO NOTHING
      `);
      for (const product of products) {
        insert.run(`inv_${product.id}`, product.id, Math.max(0, Math.floor(product.stock || 0)), now);
      }
    },
  },
  {
    id: '003_sessions_hashed',
    description: 'Store only SHA-256 hashes of session tokens, add session metadata',
    up: (db) => {
      // Sessions are ephemeral; recreating the table lets us drop raw tokens entirely.
      db.exec(`
        DROP TABLE IF EXISTS sessions;
        CREATE TABLE sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('customer', 'seller', 'rider')),
          user_agent TEXT,
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      `);
    },
  },
  {
    id: '004_users_profile',
    description: 'Rider onboarding fields, login tracking and lockout columns on users',
    up: (db) => {
      const columns = [
        `ALTER TABLE users ADD COLUMN vehicle_type TEXT`,
        `ALTER TABLE users ADD COLUMN vehicle_number TEXT`,
        `ALTER TABLE users ADD COLUMN license_number TEXT`,
        `ALTER TABLE users ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE users ADD COLUMN last_login_at TEXT`,
        `ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0`,
        `ALTER TABLE users ADD COLUMN locked_until TEXT`,
      ];
      for (const sql of columns) {
        try {
          db.exec(sql);
        } catch (err: any) {
          // Column already present (partially applied migration) - safe to continue.
          if (!String(err.message).includes('duplicate column name')) throw err;
        }
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      `);
    },
  },
  {
    id: '005_store_fulfilment',
    description: 'Store fulfilment configuration: delivery/pickup support, hours, operating days',
    up: (db) => {
      const columns = [
        `ALTER TABLE stores ADD COLUMN supports_delivery INTEGER NOT NULL DEFAULT 1`,
        `ALTER TABLE stores ADD COLUMN supports_pickup INTEGER NOT NULL DEFAULT 1`,
        `ALTER TABLE stores ADD COLUMN opens_at TEXT`,
        `ALTER TABLE stores ADD COLUMN closes_at TEXT`,
        `ALTER TABLE stores ADD COLUMN operating_days TEXT`,
        `ALTER TABLE stores ADD COLUMN contact_phone TEXT`,
      ];
      for (const sql of columns) {
        try {
          db.exec(sql);
        } catch (err: any) {
          if (!String(err.message).includes('duplicate column name')) throw err;
        }
      }
      db.prepare(
        `UPDATE stores SET opens_at = COALESCE(opens_at, '07:00'), closes_at = COALESCE(closes_at, '22:00'),
         operating_days = COALESCE(operating_days, 'Mon-Sun') WHERE opens_at IS NULL`
      ).run();
      db.exec(`CREATE INDEX IF NOT EXISTS idx_stores_status ON stores(status);`);
    },
  },
  {
    id: '006_orders_operational',
    description: 'Order operational timestamps and cancellation audit fields',
    up: (db) => {
      const columns = [
        `ALTER TABLE orders ADD COLUMN store_name_snapshot TEXT`,
        `ALTER TABLE orders ADD COLUMN store_address_snapshot TEXT`,
        `ALTER TABLE orders ADD COLUMN accepted_at TEXT`,
        `ALTER TABLE orders ADD COLUMN ready_at TEXT`,
        `ALTER TABLE orders ADD COLUMN rider_assigned_at TEXT`,
        `ALTER TABLE orders ADD COLUMN picked_up_at TEXT`,
        `ALTER TABLE orders ADD COLUMN delivered_at TEXT`,
        `ALTER TABLE orders ADD COLUMN cancelled_reason TEXT`,
        `ALTER TABLE orders ADD COLUMN cancelled_by TEXT`,
      ];
      for (const sql of columns) {
        try {
          db.exec(sql);
        } catch (err: any) {
          if (!String(err.message).includes('duplicate column name')) throw err;
        }
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_orders_store_status ON orders(store_id, status);
      `);
    },
  },
  {
    id: '007_reservations_holds',
    description: 'Reservations can hold real stock: expiry, hold flag, rebuilt status enum',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS reservations_new (
          id TEXT PRIMARY KEY,
          customer_id TEXT NOT NULL,
          store_id TEXT NOT NULL,
          product_id TEXT NOT NULL,
          requested_quantity INTEGER NOT NULL DEFAULT 1 CHECK(requested_quantity > 0),
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
            'pending', 'confirmed', 'rejected', 'cancelled', 'fulfilled', 'expired'
          )),
          seller_response TEXT,
          note TEXT,
          holds_stock INTEGER NOT NULL DEFAULT 0,
          requested_at TEXT NOT NULL,
          responded_at TEXT,
          expires_at TEXT,
          released_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (customer_id) REFERENCES users(id),
          FOREIGN KEY (store_id) REFERENCES stores(id),
          FOREIGN KEY (product_id) REFERENCES products(id)
        );

        INSERT INTO reservations_new (
          id, customer_id, store_id, product_id, requested_quantity, status, seller_response,
          holds_stock, requested_at, responded_at, created_at, updated_at
        )
        SELECT id, customer_id, store_id, product_id, requested_quantity, status, seller_response,
               0, created_at, CASE WHEN status = 'pending' THEN NULL ELSE updated_at END,
               created_at, updated_at
        FROM reservations;

        DROP TABLE reservations;
        ALTER TABLE reservations_new RENAME TO reservations;

        CREATE INDEX IF NOT EXISTS idx_reservations_customer ON reservations(customer_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reservations_store_status ON reservations(store_id, status);
        CREATE INDEX IF NOT EXISTS idx_reservations_product ON reservations(product_id);
      `);

      // Stock checks: response audit field + customer note + indexes.
      for (const sql of [
        `ALTER TABLE stock_requests ADD COLUMN responded_at TEXT`,
        `ALTER TABLE stock_requests ADD COLUMN note TEXT`,
      ]) {
        try {
          db.exec(sql);
        } catch (err: any) {
          if (!String(err.message).includes('duplicate column name')) throw err;
        }
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_stock_requests_customer ON stock_requests(customer_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_stock_requests_store_status ON stock_requests(store_id, status);
      `);
    },
  },
  {
    id: '008_delivery_jobs_ops',
    description: 'Delivery job verification timestamps, handoff attempt audit table, indexes',
    up: (db) => {
      const columns = [
        `ALTER TABLE delivery_jobs ADD COLUMN pickup_verified_at TEXT`,
        `ALTER TABLE delivery_jobs ADD COLUMN cancelled_at TEXT`,
        `ALTER TABLE delivery_jobs ADD COLUMN cancelled_reason TEXT`,
      ];
      for (const sql of columns) {
        try {
          db.exec(sql);
        } catch (err: any) {
          if (!String(err.message).includes('duplicate column name')) throw err;
        }
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_delivery_jobs_rider_status ON delivery_jobs(rider_id, status);
        CREATE INDEX IF NOT EXISTS idx_handoff_events_order ON handoff_events(order_id, created_at);

        -- Audit + brute-force protection for pickup/delivery code submissions.
        CREATE TABLE IF NOT EXISTS handoff_verifications (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL,
          job_id TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          verification_type TEXT NOT NULL CHECK(verification_type IN ('pickup', 'delivery')),
          success INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_handoff_verifications_job
          ON handoff_verifications(job_id, verification_type, created_at DESC);
      `);
    },
  },
];
