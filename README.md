# NearBuy — What You Need, Already Nearby.

A full-stack, database-backed neighbourhood-commerce platform connecting Customers, Local Sellers, and Delivery Riders in Dwarka, New Delhi.

---

## 1. System Architecture

```
                    ┌───────────────────────────────┐
                    │       NearBuy Platform        │
                    │      React 19 + Tailwind      │
                    └───────────────┬───────────────┘
                                    │ HTTP / REST API
                    ┌───────────────▼───────────────┐
                    │      Express API Server       │
                    │   (Role-Based Authorization)   │
                    └───────────────┬───────────────┘
                                    │ ACID Transactions
                    ┌───────────────▼───────────────┐
                    │   SQLite (node:sqlite WAL)    │
                    │   Atomic Concurrency & Handoff│
                    └───────────────────────────────┘
```

* **Frontend**: React 19 SPA, Tailwind CSS v4, Lucide icons, mobile-responsive layout.
* **Backend**: Node.js v22 Express full-stack server (`server.ts`) with modular REST routers.
* **Database**: High-performance persistent SQLite engine (`node:sqlite` DatabaseSync) in WAL mode with foreign keys, row-level concurrency control, and ACID transactions.
* **Security & Authentication**: Scrypt password hashing with cryptographic salt, Bearer session tokens, server-side role isolation.
* **Dual-Code Verification System**:
  - **Seller Pickup Code (`PK-XXXX`)**: Disclosed only to the seller at the `ready_for_pickup` stage. Rider must submit this code to collect the package.
  - **Customer Delivery Code (`DL-XXXX`)**: Disclosed only to the customer. Rider must submit this code upon reaching the doorstep to complete delivery.

---

## 2. Seeded Staging / Demo Accounts

These accounts are seeded into the development/staging database using cryptographic password hashing (`scrypt`) and are ready for the end-to-end walkthrough:

| Role | Name | Email | Password | Phone |
| :--- | :--- | :--- | :--- | :--- |
| **Customer** | Aarav Sharma | `customer.demo@nearbuy.app` | `NearBuy@2026` | `+91 98765 43210` |
| **Seller** | Rahul Verma | `seller.demo@nearbuy.app` | `NearBuy@2026` | `+91 98112 34567` |
| **Rider** | Arjun Kumar | `rider.demo@nearbuy.app` | `NearBuy@2026` | `+91 98111 22334` |

> **Note**: These are strictly demo/staging credentials. In production environments, demo accounts are segregated or disabled.

### Seeded Store Data

* **Store**: Dwarka Fresh Mart
* **Manager**: Rahul Verma
* **Location**: Shop 14-16, Vardhman City Mall, Sector 12, Dwarka, New Delhi 110078
* **Status**: Open (07:00 AM - 10:00 PM)
* **Products in Catalog**:
  1. **Amul Taaza Milk 1L** — ₹68 (Stock: 20)
  2. **Aashirvaad Atta 5kg** — ₹285 (Stock: 15)
  3. **Tata Salt 1kg** — ₹28 (Stock: 30)
  4. **Fortune Sunflower Oil 1L** — ₹145 (Stock: 12)
  5. **Britannia Bread 400g** — ₹45 (Stock: 18)

---

## 3. Required Demo Walkthrough

The platform supports the exact full-circle walkthrough across all three personas:

```
[Customer: Aarav]
customer.demo@nearbuy.app
  │
  ├─ 1. Search "Amul Taaza" in Dwarka Fresh Mart
  ├─ 2. Add to cart (quantity: 1 or 2)
  ├─ 3. Open cart -> Review address (Sector 10, Dwarka)
  └─ 4. Checkout -> Order created with Customer Delivery Code (DL-XXXX)
        │
        ▼
[Seller: Rahul]
seller.demo@nearbuy.app
  │
  ├─ 1. View incoming order in Dashboard
  ├─ 2. Accept Order -> Start Preparing -> Pack Items
  └─ 3. Mark "Ready for Pickup" -> Reveals Seller Pickup Code (PK-XXXX)
        │
        ▼
[Rider: Arjun]
rider.demo@nearbuy.app
  │
  ├─ 1. View available delivery jobs in Dwarka
  ├─ 2. Claim job (atomic concurrency lock)
  ├─ 3. Enter Seller's Pickup Code (PK-XXXX) -> Status becomes "Out for Delivery"
  ├─ 4. Navigate to customer address (Shivani Apartments, Sector 10)
  └─ 5. Enter Customer's Delivery Code (DL-XXXX) -> Status becomes "Delivered", ₹40 payout credited
        │
        ▼
[Cross-Role Refresh Verification]
  ├─ Customer view shows "Delivered Successfully"
  ├─ Seller view shows "Delivered"
  ├─ Rider view shows "Completed" with ₹40 earnings
  └─ Refreshing pages / re-logging in confirms full database persistence
```

---

## 4. Setup and Development Commands

### Installation & Seeding
```bash
# Seed the database idempotently
npm run db:seed

# Start the full-stack development server (Port 3000)
npm run dev
```

### Testing & Verification
```bash
# Run unit and database integrity test suite
npm test

# Run full Customer -> Seller -> Rider E2E acceptance test
npm run test:e2e

# Run TypeScript type check
npm run lint

# Build for production
npm run build
```

---

## 5. Environment Configuration

Defined in `.env.example`:

| Variable | Description |
| :--- | :--- |
| `PORT` | HTTP port for Express server (defaults to `3000`) |
| `NODE_ENV` | `development` or `production` |
| `APP_URL` | Public hosting URL |
| `GEMINI_API_KEY` | Optional server-side AI integration key |

---

## 6. Health & Diagnostics

A standard health check is available at:
```http
GET /health
```
Response:
```json
{
  "status": "ok",
  "app": "NearBuy",
  "database": "connected (node:sqlite WAL)",
  "version": "1.0.0",
  "timestamp": "2026-09-30T16:40:25.885Z"
}
```
