# NearBuy — What You Need, Already Nearby.

A full-stack, database-backed neighbourhood-commerce platform connecting **Customers**, **Local Sellers** and **Delivery Riders** in Dwarka, New Delhi.

Every catalogue entry, cart, order, stock level, handoff code and status transition lives in one persisted SQLite database and is written and validated by the API server. There is no mock data path, no in-memory production state and no success message that the database did not confirm.

---

## 1. Architecture

```
┌───────────────────────────────┐
│  React 19 + Tailwind v4 SPA   │  deep links (/orders/:id, /seller/orders/:id, /rider/jobs/:id)
│  src/ (router, contexts, UI)  │  relative URLs only — never localhost/absolute hosts
└───────────────┬───────────────┘
                │ HTTP JSON + HttpOnly session cookie + X-NearBuy-Client header
┌───────────────▼───────────────┐
│  Express API (server.ts)      │  /api/auth /api/customer /api/seller /api/rider
│  requireAuth + requireRole    │  originGuard, rate limits, security headers, validation
└───────────────┬───────────────┘
                │ ACID transactions (BEGIN IMMEDIATE), atomic conditional UPDATEs
┌───────────────▼───────────────┐
│  SQLite (node:sqlite, WAL)    │  migrations 001–008, 16 tables
│  data/nearbuy.db              │  orders, inventory, delivery_jobs, handoff_events, …
└───────────────────────────────┘
```

* **Frontend**: React 19 SPA, Tailwind CSS v4, Lucide icons, history-API router with real deep links, mobile-first layout.
* **Backend**: Node 22 + Express 4, TypeScript end to end, `tsx server.ts` for dev and production.
* **Database**: `node:sqlite` `DatabaseSync` in WAL mode with foreign keys, an idempotent migration runner and row-level concurrency control.
* **Security**: scrypt password hashing with per-user salts, opaque session tokens stored **SHA-256-hashed** and delivered in an **HttpOnly, SameSite=Lax cookie** (no tokens in `localStorage`), server-side role authorization on every protected route, CSRF guards, sliding-window rate limits, structured logs with secret redaction.
* **Handoff verification**:
  * **Seller pickup code (`PK-XXXX`)** — generated with `crypto.randomBytes`, revealed to the seller only once the order reaches `ready_for_pickup`, never shown to the customer.
  * **Customer delivery code (`DL-XXXX`)** — visible only to the ordering customer, never to the seller or to unrelated riders.
  * Both codes are verified server-side with constant-time comparison; 5 wrong attempts per job/type locks the step (HTTP 429).

### Data integrity guarantees

| Risk | Control |
| :--- | :--- |
| Double-click / retry duplicates | `orders.idempotency_key` (UNIQUE) + replay returns the original order |
| Last-item race at checkout | `inventory.tryConsumeStock()` — conditional `UPDATE … WHERE stock − reserved ≥ qty` inside `BEGIN IMMEDIATE`; losers get 409 |
| Negative stock | `stock_quantity`/`reserved_quantity` never decremented below zero; `setStock` clamps to reservations |
| Two riders claim one job | Conditional `UPDATE delivery_jobs … WHERE rider_id IS NULL AND status='available'`; the loser gets 409 `already_claimed` |
| Illegal status jumps | `orderStateMachine.ts` role transition maps; sellers cannot mark `delivered`, riders cannot mark `ready_for_pickup` |
| Stale client prices/stock | Totals are recomputed server-side from live rows on quote and checkout |

**Payment**: Cash on Delivery and a clearly-labelled `test_mode` are the only supported methods. No gateway is integrated, so no payment is ever reported as captured. To add one (e.g. Razorpay/Stripe), create the payment intent inside the `withTransaction` block in `POST /api/customer/checkout`, mark the order `payment_status='pending_gateway'`, and only confirm on a signature-verified webhook — the order row is already the single source of truth.

---

## 2. Demo / staging accounts

Seeded idempotently by `npm run db:seed` with the normal scrypt password pipeline (identical to self-registration):

| Role | Name | Email | Password | Phone |
| :--- | :--- | :--- | :--- | :--- |
| **Customer** | Aarav Sharma | `customer.demo@nearbuy.app` | `NearBuy@2026` | `+91 98765 43210` |
| **Seller** | Rahul Verma | `seller.demo@nearbuy.app` | `NearBuy@2026` | `+91 98112 34567` |
| **Rider** | Arjun Kumar | `rider.demo@nearbuy.app` | `NearBuy@2026` | `+91 98111 22334` |

> **Demo/staging only — never production.** Demo mode defaults to ON outside production and to **OFF in production** unless `ENABLE_DEMO_ACCOUNTS=true` is set explicitly. When disabled, the accounts are not seeded and `GET /api/auth/config` returns an empty `demoAccounts` list, so the UI never displays credentials. Credentials are fetched from that endpoint at runtime (gated by `demoMode`) — they are **not hard-coded in the frontend**.

### Seeded data

* **Dwarka Fresh Mart** (seller: Rahul Verma) — `Shop 14-16, Vardhman City Mall, Sector 12, Dwarka, New Delhi 110078`, open 07:00–22:00, delivery + pickup, coordinates 28.5921 / 77.0460:

| Product | Price | Stock |
| :--- | ---: | ---: |
| Amul Taaza Milk 1L | ₹68 | 20 |
| Aashirvaad Atta 5kg | ₹285 | 15 |
| Tata Salt 1kg | ₹28 | 30 |
| Fortune Sunflower Oil 1L | ₹145 | 12 |
| Britannia Bread 400g | ₹45 | 18 |

* **Demo customer**: profile, one saved address (Flat 402, Shivani Apartments, Sector 10, Dwarka) and an empty cart.
* **Demo rider**: pre-onboarded (Bike, DL 3C AB 1234) and able to run the full claiming flow.
* Additional discovery stores (Daily Needs Corner, Sharma General Store, City Pharmacy, Raj Fruits & Vegetables) keep search and multi-store checkout realistic.

Re-running `npm run db:seed` updates rows in place, never duplicates users/stores/products and never zeroes existing stock.

---

## 3. Walkthrough (Customer → Seller → Rider → Customer)

```
[Customer: customer.demo@nearbuy.app]
 1. Search "Amul" in /discover → add 1–2 units from Dwarka Fresh Mart
 2. /cart → review the persisted cart (grouped per store, ₹30 delivery per store)
 3. /checkout → choose the saved Sector 10 address, payment = Cash on Delivery
 4. Order placed → your order page shows the DL-XXXX delivery code (customer-only)

[Seller: seller.demo@nearbuy.app]
 5. /seller/orders → Accept → Preparing → Packed → Ready for pickup
 6. The pickup code PK-XXXX appears only at "ready for pickup"

[Rider: rider.demo@nearbuy.app]
 7. /rider/jobs → Claim (atomic: exactly one rider wins)
 8. Enter the store's PK-XXXX → order becomes Out for delivery
 9. At the door enter the customer's DL-XXXX → Delivered, ₹40 earnings credited

[Cross-role persistence]
10. Refresh / log out / restart the server: customer, seller and rider views all
    report the same final state from the database, and the rider's history and
    earnings include the completed job.
```

---

## 4. Commands

```bash
npm install                 # install dependencies
npm run db:seed             # idempotent demo/staging seed (safe to re-run)
npm run dev                 # dev server on http://0.0.0.0:3000 (Vite middleware + HMR)

npm run lint                # TypeScript type check (tsc --noEmit)
npm run build               # production SPA build into dist/
NODE_ENV=production npm start   # serve the API + built SPA (SPA fallback for deep links)

npm test                    # unit + API + DOM + production-routing suites
npm run test:unit           # pricing, password policy, codes, state machine, rate limiter, demo gating
npm run test:api            # HTTP integration: authz, discovery, idempotency, races, full handoff, restart
npm run test:dom            # happy-dom render of the real SPA against a stubbed API
npm run test:routing        # production deep links / assets / JSON 404s (run build first)
```

**Browser E2E note (honest limitation):** the planned Playwright runner could not be used in this environment — Chromium cannot be downloaded/installed here (`npx playwright install` fails: missing apt font packages and a blocked browser CDN). In its place `npm run test:api` drives the real HTTP stack end-to-end (including the complete Customer→Seller→Rider→Customer handoff, duplicate checkout, last-unit race and duplicate claim) and `npm run test:dom` mounts the real React app in a DOM to cover routing, guards and page rendering. A browser runner should be added on CI where browsers can be installed; the suite layout (`server/tests/`) is ready for it.

---

## 5. Environment configuration

Copy `.env.example` → `.env` and adjust. Nothing here needs to be shared as a chat secret; set values in your hosting provider's environment/secrets panel.

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | Enables production behaviour (Secure cookies, static SPA, demo gating) |
| `APP_URL` | – | Public https URL, used for origin checks and logs |
| `ALLOWED_ORIGINS` | – | Extra comma-separated origins allowed to make state-changing requests |
| `DATABASE_FILE` | `data/nearbuy.db` | SQLite file (point at a persistent volume in production) |
| `DEMO_MODE` | `true` (non-production) | Seeds/allowlists the demo accounts outside production |
| `ENABLE_DEMO_ACCOUNTS` | `false` | Explicit opt-in required to allow demo accounts **in production** |
| `COOKIE_SECURE` | `true` in production | Marks the session cookie `Secure` (keep true behind HTTPS) |
| `TRUST_PROXY` | `true` | Honour `X-Forwarded-*` from a reverse proxy |
| `SESSION_TTL_DAYS` | `30` | Session lifetime |
| `DELIVERY_FEE_PER_STORE` | `30` | ₹ delivery fee applied per store order |
| `FREE_DELIVERY_THRESHOLD` | `0` | Subtotal at/above which delivery is free (0 = disabled) |
| `RESERVATION_HOLD_HOURS` | `24` | How long a confirmed reservation holds stock |
| `LOW_STOCK_THRESHOLD` | `5` | Seller dashboard low-stock cut-off |
| `UPLOADS_DIR` | `data/uploads` | Directory for seller-uploaded images |
| `MAX_UPLOAD_BYTES` | `4194304` | Max upload size (4 MB) |
| `LOG_LEVEL` | `info` | `debug` adds verbose logs; secrets are always redacted |

---

## 6. Health & diagnostics

```http
GET /health        → { "status": "ok", "app": "NearBuy", "version": "2.0.0", "uptimeSeconds": … }
GET /health/ready  → { "status": "ready", "database": "connected",
                       "migrationsApplied": 8, "latestMigration": "008_delivery_jobs_ops",
                       "demoMode": false }
```

`/health` is a liveness probe; `/health/ready` is a readiness probe that fails with 503 if the database is unreachable.

---

## 7. Deploying

1. **Install & build**: `npm ci && npm run build`.
2. **Persist the database**: mount a volume and set `DATABASE_FILE=/data/nearbuy.db` (SQLite in WAL mode; back up the `.db`, `-wal` and `-shm` files together).
3. **Run**: `NODE_ENV=production PORT=$PORT npm start`. The process serves the API and the built SPA, returns JSON 404s for `/api/*` and serves `index.html` for deep links such as `/seller/orders/ord_123`.
4. **Environment**: set `APP_URL=https://your-domain` (and `ALLOWED_ORIGINS` if you use extra origins), keep `COOKIE_SECURE=true`, leave `ENABLE_DEMO_ACCOUNTS` unset for a real deployment, and set `TRUST_PROXY=true` behind a load balancer.
5. **Health check**: point the platform probe at `/health/ready`.
6. **Uploads**: `UPLOADS_DIR` must be a persistent volume as well, or point it at object storage.

Deployment of this sandbox build to a public host was **not** performed: the repository contains no hosting-provider configuration (no Vercel/Netlify/Render/Fly/Cloud Run descriptors) and no credentials. Everything above is verified locally in production mode (`npm run build` + `NODE_ENV=production npm start`, including deep links and `/health/ready`).
