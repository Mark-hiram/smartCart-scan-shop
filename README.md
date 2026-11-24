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
| `ADMIN_SETUP_KEY` | **Yes (Production)** | _None_ | Secret setup key required on `POST /api/admin/setup` to initialize the single system admin account. Setup is refused in production if unset. |
| `GEMINI_API_KEY` | For AI Chat & Maps | _None_ | Server-side API key for `@google/genai` (chat assistant and Google Maps Grounding). |
| `DEMO_MODE` | Recommended `false` | `false` | Enables demo seed users and exposes OTP reset codes in responses only when set to `"true"`. Always `"false"` in production. |
| `PORT` | No | `3000` | Port bound by the Express server (`0.0.0.0:$PORT`). |
| `DB_PATH` | Recommended | `./smartcart_db.json` | Persistent disk path for the JSON database file (point to a persistent volume in production). |
| `TRUST_PROXY` | Behind Proxy | `false` | Set `"true"` behind Cloud Run / Render / Nginx so IP rate limiting reads `X-Forwarded-For`. |
| `SESSION_HOURS` | No | `12` | Sliding session lifetime in hours for shoppers, staff, and owners (admin sessions are fixed at 2 hours). |
| `APP_URL` | Optional | _None_ | Public URL of the deployed app. |

---

## Safely Creating the Single System Admin Account (First Run)

Smart Cart enforces a hard invariant across backend routes and database loading: **exactly ONE system administrator account can ever exist**.

1. Set `ADMIN_SETUP_KEY` in your server environment (and `DEMO_MODE=false` in production).
2. Start the server (`npm run build && npm start` or `npm run dev` in development).
3. Navigate directly to **`/admin/login`** (there are no links to `/admin/login` in public menus).
4. Complete the **First-Time System Administrator Setup** form with:
   - Your administrator email address
   - Full name
   - The `ADMIN_SETUP_KEY` configured on the server
5. Copy the generated **temporary password** (displayed **only once**).
6. Sign in at `/admin/login` with that email and temporary password — you will be prompted immediately to replace it with a permanent password (minimum 8 characters).
7. Any future attempts to call `/api/admin/setup`, register with `role: "admin"`, or create a second admin are rejected with `403` and recorded in the audit log.

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
