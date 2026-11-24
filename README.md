# Smart Cart

Mobile-first, bilingual (English & Swahili) multi-chain supermarket scan-as-you-shop Progressive Web App (`React + Vite + Express + TypeScript`).

**Zero in-app payments:** Shoppers scan product barcodes, monitor running totals and budget caps, link store loyalty QR cards, and present their cart checkout code to a cashier at the physical till.

---

## Key Features

- **Three Role-Isolated Sign-In Portals + Dedicated Admin Entry:**
  - Shopper (`/`), Branch Staff (`/staff` / Staff Portal), Store Owners (`/management` / Management Portal), and single System Administrator (`/admin/login`).
  - Portal bindings are strictly enforced on the server inside session records and route middleware.
- **Shopper Experience (`ShopperView`):**
  - Camera barcode scanning + manual product search, locked scan-time prices, daily spending cap (`BudgetAlert`), favourites, shareable shopping lists sorted by aisle, offline queue sync, and **Store-Specific Loyalty QR Card scanning** (camera, QR image upload, or manual loyalty ID).
- **Cashier & Branch Management (`CashierView` & `OwnerView`):**
  - Cart verification checklist, mismatch flagging, idempotent till completion (stock deducted once), granular staff permission presets, branch overrides, CSV catalog import/export, promotions, and branch analytics.
- **Gemini AI Assistant & Google Maps Grounding (`SmartCartChat` & `StoreModal`):**
  - Multi-turn conversational assistant (`gemini-4-hydrogen` and `gemini-3.1-flash-lite` fast mode) with active branch product/promo context and Google Maps Grounding (`googleMaps` tool) for live store search, clickable Maps links, and review snippets.
- **Offline PWA Support:**
  - Service Worker (`public/sw.js`) caches core UI assets and serves `public/offline.html` fallback when offline.

---

## Required Environment Variables

Configure these variables in your deployment environment (never commit `.env` or secret values):

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ADMIN_SETUP_KEY` | **Yes (Production)** | _None_ | Secret setup key (minimum 24 characters in production) required on `POST /api/admin/setup` to initialize the single system admin account. Production startup is refused if missing or shorter than 24 characters. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Optional | _None_ | Optional startup credentials to automatically initialize the single system administrator account (min 8-char password) without using the browser setup form. |
| `DB_PATH` | **Yes (Production)** | `./smartcart_db.json` | Persistent disk path for the JSON database file (e.g. `/var/data/smartcart_db.json` on Render). |
| `TRUST_PROXY` | **Yes (Production)** | `false` | Set `"true"` behind Render / reverse proxies so IP rate limiting reads `X-Forwarded-For`. |
| `DEMO_MODE` | **Must be `false` in Prod** | `false` | Safety guard only (all demo data has been removed). Production startup is refused if set to `"true"`. |
| `NODE_ENV` | **Yes (`production`)** | `development` | Set automatically to `"production"` by `npm start`. |
| `SESSION_HOURS` | No | `12` | Sliding session lifetime in hours for shoppers, staff, and owners (admin sessions are fixed at 2 hours). |
| `PORT` | No | `3000` | Port bound by the Express server (`0.0.0.0:$PORT`). |
| `GEMINI_API_KEY` | Optional | _None_ | Server-side API key for `@google/genai` (AI chat assistant and Google Maps Grounding). |
| `APP_URL` | Optional | _None_ | Public URL of the deployed app. |

---

## Deploying to Render

1. **Create a Web Service** on Render pointing to this repository (Node runtime).
2. **Build Command:**
   ```bash
   npm install && npm run build
   ```
3. **Start Command:**
   ```bash
   npm start
   ```
   (`npm start` runs `NODE_ENV=production tsx server.ts`, serves the built `dist/` bundle, and exposes `GET /healthz` returning `{ ok: true }`.)
4. **Add a Persistent Disk:**
   - Mount Path: `/var/data`
   - Set `DB_PATH=/var/data/smartcart_db.json`
   The server automatically creates `/var/data` (if needed) and seeds the initial database on first boot.
5. **Set Environment Variables on Render:**
   - `NODE_ENV=production`
   - `ADMIN_SETUP_KEY` (random secret string, **at least 24 characters**)
   - `ADMIN_EMAIL` & `ADMIN_PASSWORD` (optional: pre-initialize the single system admin account with your specific email and password; otherwise set them on `/admin/login`)
   - `DEMO_MODE=false`
   - `DB_PATH=/var/data/smartcart_db.json`
   - `TRUST_PROXY=true`
   - `SESSION_HOURS=12`
   - `GEMINI_API_KEY` (optional, for AI assistant & Maps store finder)
6. **Health Check Path:** `/healthz`
7. **First-Time System Admin Setup:**
   - Visit `https://<your-render-url>/admin/login`.
   - If you did not set `ADMIN_EMAIL` and `ADMIN_PASSWORD`, enter your specific administrator email, chosen password (min 8 characters), full name, and `ADMIN_SETUP_KEY`.
   - Sign in at `/admin/login` with that specific email and password to open `/admin/dashboard`.

---

## Safely Creating the Single System Admin Account (First Run)

Smart Cart enforces a hard invariant across backend routes and database loading: **exactly ONE system administrator account can ever exist**.

1. Set `ADMIN_SETUP_KEY` (24+ chars in production) in your server environment and `DEMO_MODE=false`.
2. Optionally set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (min 8 chars) to pre-provision the single admin at startup, **or** leave them unset to configure via the browser form.
3. Start the server (`npm run build && npm start`, or `npm run dev` in development).
4. Navigate to **`/admin/login`** (or click the small shield icon next to "Select Sign-In Portal").
5. Complete the **First-Time System Administrator Setup** form with your specific email address, chosen password (minimum 8 characters), and `ADMIN_SETUP_KEY`.
6. Sign in at `/admin/login` with that email and password to access `/admin/dashboard`.
7. Any future attempts to call `/api/admin/setup`, register with `role: "admin"`, promote another user, or create a second admin are rejected with `403` and recorded in the audit log.

---

## Development & Security Verification

```bash
# Install dependencies
npm install

# Run full-stack development server (port 3000)
npm run dev

# Build frontend bundle for production
npm run build

# Start production server
npm start

# Run automated security test suite
npm run test:security
```

