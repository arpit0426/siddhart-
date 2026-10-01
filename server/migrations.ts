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
  {
    id: '009_password_reset_tokens',
    description: 'Single-use, expiring password-reset tokens (SHA-256 hashed at rest)',
    up: (db) => {
      try {
        db.exec(`ALTER TABLE users ADD COLUMN address TEXT`);
      } catch (err: any) {
        if (!String(err.message).includes('duplicate column name')) throw err;
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          used_at TEXT,
          created_ip TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
          ON password_reset_tokens(user_id, created_at DESC);
      `);
    },
  },
  {
    id: '010_portal_features',
    description:
      'Notifications, saved items, checkout sessions, rider profiles/earnings/settlements/exceptions, support tickets, audit + inventory events, catalogue & address fields',
    up: (db) => {
      const addColumns = (table: string, cols: string[]) => {
        for (const col of cols) {
          try {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
          } catch (err: any) {
            if (!String(err.message).includes('duplicate column name')) throw err;
          }
        }
      };

      addColumns('users', [`avatar_url TEXT`, `preferences TEXT`]);
      addColumns('customer_addresses', [
        `house TEXT`,
        `street TEXT`,
        `area TEXT`,
        `instructions TEXT`,
        `latitude REAL`,
        `longitude REAL`,
      ]);
      addColumns('products', [
        `brand TEXT`,
        `unit TEXT`,
        `mrp REAL`,
        `sku TEXT`,
        `availability TEXT NOT NULL DEFAULT 'available'`,
        `extra_images TEXT`,
        `product_info TEXT`,
      ]);
      addColumns('stores', [
        `closure_type TEXT`,
        `status_message TEXT`,
        `supports_reservations INTEGER NOT NULL DEFAULT 1`,
        `logo TEXT`,
        `legal_name TEXT`,
        `business_id TEXT`,
        `business_email TEXT`,
        `support_phone TEXT`,
        `fulfilment_min_minutes INTEGER`,
        `fulfilment_max_minutes INTEGER`,
      ]);
      addColumns('orders', [`checkout_id TEXT`, `packed_at TEXT`, `preparing_at TEXT`]);
      addColumns('reservations', [`requested_for TEXT`]);
      addColumns('cart_items', [`price_at_add REAL`]);
      addColumns('delivery_jobs', [`pickup_started_at TEXT`, `out_for_delivery_at TEXT`, `arrived_at TEXT`]);

      db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          link TEXT,
          read_at TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at);

        CREATE TABLE IF NOT EXISTS saved_items (
          id TEXT PRIMARY KEY,
          customer_id TEXT NOT NULL,
          product_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(customer_id, product_id),
          FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_saved_items_customer ON saved_items(customer_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS checkout_sessions (
          id TEXT PRIMARY KEY,
          customer_id TEXT NOT NULL,
          idempotency_key TEXT,
          fulfillment_type TEXT NOT NULL,
          payment_method TEXT NOT NULL,
          subtotal REAL NOT NULL,
          delivery_fee REAL NOT NULL,
          total REAL NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(customer_id, idempotency_key),
          FOREIGN KEY (customer_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_orders_checkout ON orders(checkout_id);

        CREATE TABLE IF NOT EXISTS rider_profiles (
          user_id TEXT PRIMARY KEY,
          availability TEXT NOT NULL DEFAULT 'offline' CHECK(availability IN ('offline','online')),
          account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('pending','active','suspended','inactive')),
          service_area TEXT,
          vehicle_model TEXT,
          vehicle_verification TEXT NOT NULL DEFAULT 'pending' CHECK(vehicle_verification IN ('pending','verified','rejected')),
          city TEXT,
          state TEXT,
          pincode TEXT,
          last_online_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT OR IGNORE INTO rider_profiles (user_id, availability, account_status, created_at, updated_at)
          SELECT id, 'offline', 'active', created_at, updated_at FROM users WHERE role = 'rider';

        CREATE TABLE IF NOT EXISTS rider_earnings (
          id TEXT PRIMARY KEY,
          rider_id TEXT NOT NULL,
          job_id TEXT NOT NULL UNIQUE,
          order_id TEXT NOT NULL,
          amount REAL NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','paid','failed')),
          settlement_id TEXT,
          earned_at TEXT NOT NULL,
          FOREIGN KEY (rider_id) REFERENCES users(id),
          FOREIGN KEY (job_id) REFERENCES delivery_jobs(id)
        );
        CREATE INDEX IF NOT EXISTS idx_rider_earnings_rider ON rider_earnings(rider_id, earned_at DESC);
        INSERT OR IGNORE INTO rider_earnings (id, rider_id, job_id, order_id, amount, status, earned_at)
          SELECT 'earn_' || id, rider_id, id, order_id, earnings, 'pending', COALESCE(delivered_at, updated_at)
          FROM delivery_jobs WHERE status = 'completed' AND rider_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS settlements (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('seller','rider')),
          period_start TEXT NOT NULL,
          period_end TEXT NOT NULL,
          amount REAL NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','paid','failed')),
          reference TEXT,
          created_at TEXT NOT NULL,
          paid_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_settlements_user ON settlements(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS delivery_exceptions (
          id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL,
          order_id TEXT NOT NULL,
          rider_id TEXT NOT NULL,
          type TEXT NOT NULL,
          note TEXT,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          FOREIGN KEY (job_id) REFERENCES delivery_jobs(id),
          FOREIGN KEY (order_id) REFERENCES orders(id)
        );
        CREATE INDEX IF NOT EXISTS idx_delivery_exceptions_job ON delivery_exceptions(job_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS support_tickets (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL,
          category TEXT NOT NULL,
          subject TEXT NOT NULL,
          message TEXT NOT NULL,
          order_id TEXT,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')),
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS audit_events (
          id TEXT PRIMARY KEY,
          actor_id TEXT,
          actor_role TEXT,
          action TEXT NOT NULL,
          entity_type TEXT,
          entity_id TEXT,
          meta TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS inventory_events (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL,
          store_id TEXT NOT NULL,
          type TEXT NOT NULL,
          delta INTEGER NOT NULL,
          resulting_stock INTEGER NOT NULL,
          actor_id TEXT,
          note TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_events_product ON inventory_events(product_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_products_name ON products(name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_products_store_pub ON products(store_id, is_published, category);
        CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
        CREATE INDEX IF NOT EXISTS idx_stores_name ON stores(name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_jobs_available ON delivery_jobs(status, rider_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_handoff_events_type ON handoff_events(order_id, event_type);
      `);
    },
  },

  {
    id: '011_seller_workspace',
    description: 'Merchant catalog metadata, versioned inventory, notifications, business, sessions and support',
    up: (db) => {
      // Main already owns the shared catalogue, support and inventory-event
      // tables. Extend them without dropping existing portal records.
      for (const sql of [
        "ALTER TABLE products ADD COLUMN brand TEXT;",
        "ALTER TABLE products ADD COLUMN unit TEXT;",
        "ALTER TABLE products ADD COLUMN sku TEXT;",
        "ALTER TABLE products ADD COLUMN mrp REAL;",
        "ALTER TABLE products ADD COLUMN availability TEXT NOT NULL DEFAULT 'available'\n          CHECK(availability IN ('available','unavailable','temporary'));",
        "ALTER TABLE products ADD COLUMN additional_images TEXT NOT NULL DEFAULT '[]';",
        "ALTER TABLE inventory ADD COLUMN version INTEGER NOT NULL DEFAULT 0;",
        "ALTER TABLE stores ADD COLUMN logo TEXT;",
        "ALTER TABLE stores ADD COLUMN contact_email TEXT;",
        "ALTER TABLE stores ADD COLUMN is_published INTEGER NOT NULL DEFAULT 1;",
        "ALTER TABLE stores ADD COLUMN temporarily_unavailable INTEGER NOT NULL DEFAULT 0;",
        "ALTER TABLE users ADD COLUMN profile_image TEXT;",
        "ALTER TABLE sessions ADD COLUMN id TEXT;",
        "ALTER TABLE delivery_jobs ADD COLUMN seller_verified_at TEXT;",
        "ALTER TABLE delivery_jobs ADD COLUMN seller_verified_rider_id TEXT;",
        "ALTER TABLE orders ADD COLUMN preparing_at TEXT;",
        "ALTER TABLE orders ADD COLUMN packed_at TEXT;",
        "ALTER TABLE inventory_events ADD COLUMN reason TEXT;",
        "ALTER TABLE inventory_events ADD COLUMN stock_before INTEGER;",
        "ALTER TABLE inventory_events ADD COLUMN stock_after INTEGER;",
        "ALTER TABLE inventory_events ADD COLUMN reserved_before INTEGER;",
        "ALTER TABLE inventory_events ADD COLUMN reserved_after INTEGER;",
        "ALTER TABLE inventory_events ADD COLUMN reference_id TEXT;",
        "ALTER TABLE support_tickets ADD COLUMN updated_at TEXT;"
      ]) {
        try { db.exec(sql); }
        catch (error: any) {
          if (!String(error.message).includes('duplicate column name')) throw error;
        }
      }
      db.exec(`
        UPDATE stores SET is_published = CASE WHEN status = 'inactive' OR published_at IS NULL THEN 0 ELSE 1 END;
        UPDATE sessions SET id = 'ses_' || lower(hex(randomblob(12)));
        CREATE UNIQUE INDEX idx_sessions_id ON sessions(id);

        UPDATE inventory_events SET reason=COALESCE(reason,type),
          stock_before=COALESCE(stock_before,CASE WHEN type IN ('reservation','reservation_release') THEN resulting_stock ELSE resulting_stock-delta END), stock_after=COALESCE(stock_after,resulting_stock);
        UPDATE support_tickets SET updated_at=COALESCE(updated_at,created_at);
        UPDATE products SET additional_images=extra_images WHERE extra_images IS NOT NULL AND json_valid(extra_images) AND json_type(extra_images)='array';
        UPDATE users SET profile_image=avatar_url WHERE profile_image IS NULL;

        CREATE TABLE seller_settings (
          seller_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          email_notifications INTEGER NOT NULL DEFAULT 1,
          order_notifications INTEGER NOT NULL DEFAULT 1,
          low_stock_notifications INTEGER NOT NULL DEFAULT 1,
          reservation_notifications INTEGER NOT NULL DEFAULT 1,
          stock_request_notifications INTEGER NOT NULL DEFAULT 1,
          security_notifications INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE business_profiles (
          seller_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          legal_name TEXT NOT NULL DEFAULT '', owner_name TEXT NOT NULL DEFAULT '',
          phone TEXT, email TEXT, category TEXT, address TEXT,
          business_identifier TEXT, support_contact TEXT, updated_at TEXT NOT NULL
        );
        CREATE TABLE seller_notifications (
          id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
          href TEXT NOT NULL, event_key TEXT, read_at TEXT, created_at TEXT NOT NULL,
          UNIQUE(seller_id, event_key)
        );
        CREATE INDEX idx_seller_notifications_unread ON seller_notifications(seller_id, read_at, created_at DESC);
        CREATE TABLE seller_audit_events (
          id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES users(id),
          action TEXT NOT NULL, resource_id TEXT, detail TEXT, created_at TEXT NOT NULL
        );
        CREATE INDEX idx_seller_audit ON seller_audit_events(seller_id, created_at DESC);
        -- These are actual ledger records, never inferred payments or mock payouts.
        CREATE TABLE seller_settlements (
          id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id),
          amount REAL NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','processing','paid','failed')),
          period_start TEXT NOT NULL, period_end TEXT NOT NULL,
          reference TEXT, paid_at TEXT, created_at TEXT NOT NULL
        );
        CREATE INDEX idx_settlements_store ON seller_settlements(store_id, created_at DESC);
        CREATE TABLE seller_financial_adjustments (
          id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id),
          order_id TEXT REFERENCES orders(id), amount REAL NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('fee','refund','adjustment')),
          note TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX idx_financial_store ON seller_financial_adjustments(store_id, created_at DESC);
        CREATE INDEX idx_products_store_published ON products(store_id, is_published, name);
        CREATE INDEX idx_orders_store_created ON orders(store_id, created_at DESC);
        CREATE INDEX idx_order_items_order ON order_items(order_id);

        CREATE TRIGGER notify_seller_order AFTER INSERT ON orders BEGIN
          INSERT OR IGNORE INTO seller_notifications
            (id, seller_id, category, title, body, href, event_key, created_at)
          SELECT 'nt_' || lower(hex(randomblob(12))), seller_id, 'orders', 'New order received',
            NEW.order_number || ' is waiting for your acceptance.', '/seller/orders/' || NEW.id,
            'order:' || NEW.id, NEW.created_at FROM stores WHERE id = NEW.store_id;
        END;
        CREATE TRIGGER notify_seller_stock_request AFTER INSERT ON stock_requests BEGIN
          INSERT OR IGNORE INTO seller_notifications
            (id, seller_id, category, title, body, href, event_key, created_at)
          SELECT 'nt_' || lower(hex(randomblob(12))), s.seller_id, 'stock_check', 'Customer asked about stock',
            p.name || ' × ' || NEW.requested_quantity || '. Confirming availability does not reserve stock.',
            '/seller/stock-requests', 'stock_request:' || NEW.id, NEW.created_at
            FROM stores s JOIN products p ON p.id = NEW.product_id WHERE s.id = NEW.store_id;
        END;
        CREATE TRIGGER notify_seller_reservation AFTER INSERT ON reservations BEGIN
          INSERT OR IGNORE INTO seller_notifications
            (id, seller_id, category, title, body, href, event_key, created_at)
          SELECT 'nt_' || lower(hex(randomblob(12))), s.seller_id, 'reservation', 'New reservation request',
            p.name || ' × ' || NEW.requested_quantity || ' requested. Review before holding stock.',
            '/seller/reservations', 'reservation:' || NEW.id, NEW.created_at
            FROM stores s JOIN products p ON p.id = NEW.product_id WHERE s.id = NEW.store_id;
        END;
        CREATE TRIGGER notify_seller_low_stock AFTER UPDATE ON inventory
          WHEN (NEW.stock_quantity - NEW.reserved_quantity) <= NEW.low_stock_threshold
          AND ((OLD.stock_quantity - OLD.reserved_quantity) > OLD.low_stock_threshold
               OR NEW.low_stock_threshold > OLD.low_stock_threshold)
        BEGIN
          INSERT INTO seller_notifications (id, seller_id, category, title, body, href, created_at)
          SELECT 'nt_' || lower(hex(randomblob(12))), s.seller_id, 'inventory', 'Low stock alert',
            p.name || ' has only ' || (NEW.stock_quantity - NEW.reserved_quantity) || ' units available.',
            '/seller/inventory?stock=low', NEW.updated_at
            FROM products p JOIN stores s ON s.id = p.store_id WHERE p.id = NEW.product_id;
        END;
        CREATE TRIGGER notify_seller_rider AFTER UPDATE OF rider_id ON delivery_jobs
          WHEN NEW.rider_id IS NOT NULL AND (OLD.rider_id IS NULL OR OLD.rider_id != NEW.rider_id)
        BEGIN
          INSERT INTO seller_notifications (id, seller_id, category, title, body, href, created_at)
          SELECT 'nt_' || lower(hex(randomblob(12))), s.seller_id, 'orders', 'Rider assigned',
            u.name || ' will collect ' || o.order_number || '.', '/seller/orders/' || o.id, NEW.updated_at
            FROM orders o JOIN stores s ON s.id = o.store_id JOIN users u ON u.id = NEW.rider_id
            WHERE o.id = NEW.order_id;
        END;
        CREATE TRIGGER notify_seller_delivery AFTER UPDATE OF status ON orders
          WHEN NEW.status = 'delivered' AND OLD.status != 'delivered'
        BEGIN
          INSERT INTO seller_notifications (id, seller_id, category, title, body, href, created_at)
          SELECT 'nt_' || lower(hex(randomblob(12))), seller_id, 'orders', 'Order delivered',
            NEW.order_number || ' has been delivered to the customer.', '/seller/orders/' || NEW.id,
            NEW.updated_at FROM stores WHERE id = NEW.store_id;
        END;
        CREATE TRIGGER notify_seller_settlement AFTER INSERT ON seller_settlements BEGIN
          INSERT INTO seller_notifications (id, seller_id, category, title, body, href, created_at)
          SELECT 'nt_' || lower(hex(randomblob(12))), seller_id, 'payout', 'Settlement recorded',
            'A settlement is now ' || NEW.status || '. Check earnings for details.',
            '/seller/earnings?tab=settlements', NEW.created_at FROM stores WHERE id = NEW.store_id;
        END;
      `);
    },
  },

];
