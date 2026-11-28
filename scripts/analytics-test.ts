import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { calculateEAN13CheckDigit } from '../src/utils/barcode';
import { getAdminAnalytics, clearAnalyticsCache } from '../src/server/analytics';
import { createInitialDatabase } from '../src/server/db';

const TEST_PORT = 4100 + crypto.randomInt(0, 300);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smartcart-analytics-test-'));
const TEST_DB_PATH = path.join(TMP_DIR, 'smartcart_analytics_test_db.json');
const ADMIN_SETUP_KEY = `TestAdminKey_${crypto.randomBytes(12).toString('hex')}`;

const makeTestSecret = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString('hex')}!9`;

let serverProc: ChildProcess | null = null;

async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch {
      // booting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Timed out waiting for test server to boot');
}

async function api(
  pathname: string,
  options: Omit<RequestInit, 'headers'> & {
    token?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; data: any; rawText: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  const res = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers,
  });
  const rawText = await res.text();
  let data: any = rawText;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    // CSV or plain text
  }
  return { status: res.status, data, rawText };
}

function killProc(proc: ChildProcess | null) {
  if (!proc?.pid) return;
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
}

async function runTests() {
  let exitCode = 0;

  const check = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
    } catch (err: any) {
      console.error(`  FAIL: ${name} -> ${err?.message || err}`);
      exitCode = 1;
      throw err;
    }
  };

  console.log('\n[analytics-test] Starting isolated test server...');
  serverProc = spawn('npx', ['tsx', 'server.ts'], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      DB_PATH: TEST_DB_PATH,
      ADMIN_SETUP_KEY,
      DEMO_MODE: 'false',
      TRUST_PROXY: 'true',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(BASE_URL);

    // 1. Bootstrap Admin
    const adminEmail = 'sysadmin-an@smartcart.local';
    const setupRes = await api('/api/admin/setup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.30' },
      body: JSON.stringify({ email: adminEmail, name: 'Sys Admin', setupKey: ADMIN_SETUP_KEY }),
    });
    assert.equal(setupRes.status, 200);
    const adminTempPass = setupRes.data.tempPassword;
    const adminLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: adminEmail, password: adminTempPass, portal: 'admin' }),
    });
    const adminToken = adminLogin.data.token;
    const adminPass = makeTestSecret('AdminAn');
    await api('/api/admin/change-first-password', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ currentPassword: adminTempPass, newPassword: adminPass }),
    });

    // 2. Seed Active Supermarket + Pending Supermarket + Branch + Products + Staff + 2 Shoppers
    const ownerEmail = 'owner-secret-an@example.com';
    const ownerPhone = '+254711998877';
    const ownerPass = makeTestSecret('OwnerAn');
    const applyActive = await api('/api/supermarket/apply', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.31' },
      body: JSON.stringify({
        chainName: 'Savannah Mart',
        contactEmail: ownerEmail,
        contactPhone: ownerPhone,
        city: 'Nairobi',
        firstBranchName: 'Savannah Westlands',
        ownerName: 'Owner SecretName',
        password: ownerPass,
      }),
    });
    assert.equal(applyActive.status, 200);
    const activeSmId = applyActive.data.supermarket.id;

    // Pending supermarket
    const applyPending = await api('/api/supermarket/apply', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.32' },
      body: JSON.stringify({
        chainName: 'Horizon Grocers',
        contactEmail: 'pending-owner@example.com',
        contactPhone: '+254722887766',
        city: 'Kisumu',
        firstBranchName: 'Horizon Main',
        ownerName: 'Pending Owner',
        password: makeTestSecret('PendAn'),
      }),
    });
    assert.equal(applyPending.status, 200);
    const pendingSmId = applyPending.data.supermarket.id;

    await api(`/api/admin/supermarkets/${activeSmId}/status`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ status: 'active' }),
    });

    const ownerLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: ownerEmail, password: ownerPass, portal: 'management' }),
    });
    const ownerToken = ownerLogin.data.token;

    const overview = await api('/api/owner/overview', { token: ownerToken });
    const branchId = overview.data.branches[0].id;

    const coffeeBarcode = `616330111111${calculateEAN13CheckDigit('616330111111')}`;
    const sugarBarcode = `616330222222${calculateEAN13CheckDigit('616330222222')}`;
    const csvText = [
      'barcode,name,category,base_price,aisle,shelf,branch_price,stock,low_stock_threshold',
      `${coffeeBarcode},"Kenyan AA Coffee 250g",Beverages,450,Aisle 3,Shelf B,450,30,5`,
      `${sugarBarcode},"Cane Sugar 2kg",Pantry,320,Aisle 4,Shelf A,320,30,5`,
    ].join('\n');

    await api('/api/owner/products/csv-import', {
      method: 'POST',
      token: ownerToken,
      body: JSON.stringify({ csvText, branchId }),
    });

    // Staff
    const cashierEmail = 'cashier-an@example.com';
    const cashierPass = makeTestSecret('CashierAn');
    await api('/api/owner/staff', {
      method: 'POST',
      token: ownerToken,
      body: JSON.stringify({
        name: 'Cashier PrivateName',
        email: cashierEmail,
        phone: '+254733776655',
        password: cashierPass,
        branchId,
        preset: 'cashier',
      }),
    });
    const cashierLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: cashierEmail, password: cashierPass, portal: 'staff' }),
    });
    const cashierToken = cashierLogin.data.token;

    // 2 Shoppers
    const shopperAEmail = 'alice-private@example.com';
    const shopperAPhone = '+254700112233';
    const shopperAPass = makeTestSecret('AliceAn');
    const regA = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.33' },
      body: JSON.stringify({
        name: 'Alice SecretShopper',
        email: shopperAEmail,
        phone: shopperAPhone,
        password: shopperAPass,
      }),
    });
    assert.equal(regA.status, 200);
    const shopperAToken = regA.data.token;
    const shopperAId = regA.data.user.id;

    const shopperBEmail = 'bob-private@example.com';
    const shopperBPhone = '+254700445566';
    const regB = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.34' },
      body: JSON.stringify({
        name: 'Bob SecretShopper',
        email: shopperBEmail,
        phone: shopperBPhone,
        password: makeTestSecret('BobAn'),
      }),
    });
    assert.equal(regB.status, 200);

    // Cart 1 (Shopper A): 2x Coffee (900) + 1x Sugar (320) = 1220 KES, 3 items -> Finish & Cashier Verify (awards points)
    await api('/api/shopper/cart/add', {
      method: 'POST',
      token: shopperAToken,
      body: JSON.stringify({ branchId, barcode: coffeeBarcode, quantity: 2 }),
    });
    const addRes2 = await api('/api/shopper/cart/add', {
      method: 'POST',
      token: shopperAToken,
      body: JSON.stringify({ branchId, barcode: sugarBarcode, quantity: 1 }),
    });
    const cart1Id = addRes2.data.id;
    await api('/api/shopper/cart/finish', {
      method: 'POST',
      token: shopperAToken,
      body: JSON.stringify({ cartId: cart1Id }),
    });
    await api('/api/cashier/verify', {
      method: 'POST',
      token: cashierToken,
      body: JSON.stringify({ cartId: cart1Id }),
    });

    // Cart 2 (Shopper A): 1x Coffee (450) -> stays active (in progress)
    await api('/api/shopper/cart/add', {
      method: 'POST',
      token: shopperAToken,
      body: JSON.stringify({ branchId, barcode: coffeeBarcode, quantity: 1 }),
    });

    // Invalid barcode scan -> records 1 scan failure
    const badScan = await api('/api/shopper/scan-lookup', {
      method: 'POST',
      body: JSON.stringify({ branchId, barcode: '1234567890120' }),
    });
    assert.equal(badScan.status, 400);

    // Redeem a reward (Shopper A earned 1220/25 + 5 = 53 pts -> create low-cost cap or adjust/create 20pt reward as admin)
    const rewCreate = await api('/api/admin/rewards', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({
        name: 'Savannah Eco Tote',
        description: 'Reusable cloth bag',
        pointsCost: 20,
        unitCostKes: 250,
        colors: ['Emerald Green'],
        sizes: ['One Size'],
        stockBySize: { 'One Size': 10 },
        status: 'active',
      }),
    });
    assert.equal(rewCreate.status, 200);
    const rewardId = rewCreate.data.id;

    const redeemRes = await api('/api/shopper/rewards/redeem', {
      method: 'POST',
      token: shopperAToken,
      body: JSON.stringify({
        rewardId,
        size: 'One Size',
        color: 'Emerald Green',
        fulfillmentMethod: 'collection',
        branchId,
        contactPhone: shopperAPhone,
      }),
    });
    assert.equal(redeemRes.status, 200);

    // 1 Support Ticket + 1 Password Reset Request
    const supRes = await api('/api/support', {
      method: 'POST',
      token: shopperAToken,
      body: JSON.stringify({
        category: 'general',
        subject: 'Question about product aisle',
        message: 'Where is canned fruit located?',
      }),
    });
    assert.equal(supRes.status, 200);

    const pwReqRes = await api('/api/auth/password-reset-request', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.35' },
      body: JSON.stringify({
        identifier: shopperBEmail,
        fullName: 'Bob SecretShopper',
        note: 'Westlands branch',
      }),
    });
    assert.equal(pwReqRes.status, 200);

    // 5 Failed Sign-Ins -> triggers 5 failures + 1 lockout security event
    for (let i = 0; i < 5; i++) {
      const badLogin = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.36' },
        body: JSON.stringify({
          identifier: shopperBEmail,
          password: `WrongPass_${i}`,
          portal: 'shopper',
        }),
      });
      assert.equal(badLogin.status, 401);
    }

    // ---- ASSERTION 1: Only admin can access /api/admin/analytics and /csv ----
    await check('Only admin can call analytics & CSV endpoints (unauthenticated 401; owner/staff/shopper 403)', async () => {
      for (const endpoint of ['/api/admin/analytics?range=30d', '/api/admin/analytics/csv?range=30d']) {
        const unauth = await api(endpoint);
        assert.equal(unauth.status, 401, `${endpoint} unauth must be 401`);

        const shopperRes = await api(endpoint, { token: shopperAToken });
        assert.equal(shopperRes.status, 403, `${endpoint} shopper must be 403`);

        const staffRes = await api(endpoint, { token: cashierToken });
        assert.equal(staffRes.status, 403, `${endpoint} staff must be 403`);

        const ownerRes = await api(endpoint, { token: ownerToken });
        assert.equal(ownerRes.status, 403, `${endpoint} owner must be 403`);

        const adminRes = await api(endpoint, { token: adminToken });
        assert.equal(adminRes.status, 200, `${endpoint} admin must be 200`);
      }
    });

    // Fetch analytics JSON for remaining assertions
    const anRes = await api('/api/admin/analytics?range=30d', { token: adminToken });
    assert.equal(anRes.status, 200);
    const analytics = anRes.data;

    // ---- ASSERTION 2: Zero personal data, secrets, or payment/revenue words ----
    await check('Analytics responses contain no personal data, barcodes, passwords, or payment terms', () => {
      const serialized = JSON.stringify(analytics);
      const forbiddenLiterals = [
        shopperAEmail,
        shopperBEmail,
        ownerEmail,
        cashierEmail,
        adminEmail,
        shopperAPhone,
        shopperBPhone,
        ownerPhone,
        'Alice SecretShopper',
        'Bob SecretShopper',
        'Owner SecretName',
        'Cashier PrivateName',
        shopperAId,
        coffeeBarcode,
        sugarBarcode,
        'revenue',
        'payment',
      ];

      for (const forbidden of forbiddenLiterals) {
        assert.equal(
          serialized.toLowerCase().includes(forbidden.toLowerCase()),
          false,
          `Analytics JSON must never expose "${forbidden}"`
        );
      }

      // Most scanned products must contain productName + numeric counts only
      for (const prod of analytics.mostScannedProducts) {
        assert.deepEqual(
          Object.keys(prod).sort(),
          ['cartAppearances', 'productName', 'unitsScanned']
        );
      }
    });

    // ---- ASSERTION 3: Counts match seeded dataset accurately ----
    await check('Aggregated counts, cart values, scans, loyalty, support, and security match seeded data', () => {
      assert.equal(analytics.organizationCounts.supermarkets.total, 2);
      assert.equal(analytics.organizationCounts.supermarkets.active, 1);
      assert.equal(analytics.organizationCounts.supermarkets.pending, 1);
      assert.equal(analytics.organizationCounts.branches.active, 1);

      assert.equal(analytics.kpis.newSignups.value, 2);
      assert.equal(analytics.kpis.activeShoppers.value, 1);
      assert.equal(analytics.kpis.cartsStarted.value, 2);
      assert.equal(analytics.kpis.cartsFinished.value, 1);
      assert.equal(analytics.kpis.itemsScanned.value, 4); // 2 + 1 in cart 1, + 1 in cart 2
      // Cart 1 finalTotal = 1220, Cart 2 finalTotal = 450 -> avg = round((1220+450)/2) = 835
      assert.equal(analytics.kpis.averageCartValueKes.value, 835);

      assert.equal(analytics.topSupermarketsByCarts.length, 1);
      assert.equal(analytics.topSupermarketsByCarts[0].supermarketName, 'Savannah Mart');
      assert.equal(analytics.topSupermarketsByCarts[0].cartsStarted, 2);

      assert.equal(analytics.mostScannedProducts[0].productName, 'Kenyan AA Coffee 250g');
      assert.equal(analytics.mostScannedProducts[0].unitsScanned, 3);

      assert.equal(analytics.scanOutcomes.successes, 3);
      assert.equal(analytics.scanOutcomes.failures, 1);

      assert.ok(analytics.kpis.loyaltyPointsIssued.value > 0);
      assert.equal(analytics.kpis.loyaltyPointsRedeemed.value, 20);
      assert.equal(analytics.rewardsRedeemedByItem.length, 1);
      assert.equal(analytics.rewardsRedeemedByItem[0].rewardName, 'Savannah Eco Tote');
      assert.equal(analytics.rewardsRedeemedByItem[0].redemptionsCount, 1);

      assert.equal(analytics.supportSummary.passwordResetRequests.open, 1);
      assert.equal(analytics.supportSummary.supportTickets.open, 1);

      assert.equal(analytics.securitySummary.totalFailures, 5);
      assert.equal(analytics.securitySummary.totalLockouts, 1);
      assert.equal(analytics.securitySummary.currentlyLockedAccounts, 1);
    });

    // ---- ASSERTION 4: Range & Store Filters Work ----
    await check('Date range filter (including historical window isolation) and supermarket filter work', async () => {
      for (const r of ['today', '7d', '30d', '90d', 'year']) {
        const res = await api(`/api/admin/analytics?range=${r}`, { token: adminToken });
        assert.equal(res.status, 200);
        assert.equal(res.data.meta.range, r);
      }

      const invalidRange = await api('/api/admin/analytics?range=all_time_invalid', { token: adminToken });
      assert.equal(invalidRange.status, 400);

      // Supermarket filter: Horizon Grocers (pending) has 0 carts vs Savannah Mart has 2 carts
      const pendingFiltered = await api(`/api/admin/analytics?range=30d&supermarketId=${pendingSmId}`, {
        token: adminToken,
      });
      assert.equal(pendingFiltered.status, 200);
      assert.equal(pendingFiltered.data.kpis.cartsStarted.value, 0);

      // Unit test exact range window cutoff with 45-day-old cart vs today's cart
      clearAnalyticsCache();
      const mockDb = createInitialDatabase();
      const nowMs = Date.now();
      const day45AgoIso = new Date(nowMs - 45 * 24 * 60 * 60 * 1000).toISOString();
      const day2AgoIso = new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString();
      mockDb.supermarkets.push({
        id: 'sm_1',
        name: 'Test Store',
        code: 'TST',
        contactEmail: 'x@example.com',
        contactPhone: '+254700000000',
        status: 'active',
        currency: 'KES',
        createdAt: day45AgoIso,
      });
      mockDb.branches.push({
        id: 'br_1',
        supermarketId: 'sm_1',
        name: 'Test Branch',
        code: 'TST-1',
        address: 'Road 1',
        city: 'Nairobi',
        latitude: -1.2,
        longitude: 36.8,
        phone: '+254700000000',
        isActive: true,
      });
      mockDb.carts.push(
        {
          id: 'c_old',
          shortCode: 'SC-0001',
          shopperId: 'u1',
          shopperName: 'Hidden',
          shopperPhone: '',
          supermarketId: 'sm_1',
          branchId: 'br_1',
          status: 'verified',
          items: [],
          subtotal: 500,
          totalDiscount: 0,
          finalTotal: 500,
          createdAt: day45AgoIso,
          updatedAt: day45AgoIso,
        },
        {
          id: 'c_recent',
          shortCode: 'SC-0002',
          shopperId: 'u2',
          shopperName: 'Hidden',
          shopperPhone: '',
          supermarketId: 'sm_1',
          branchId: 'br_1',
          status: 'verified',
          items: [],
          subtotal: 300,
          totalDiscount: 0,
          finalTotal: 300,
          createdAt: day2AgoIso,
          updatedAt: day2AgoIso,
        }
      );

      const res7d = getAdminAnalytics(mockDb, { range: '7d', nowMs });
      const res30d = getAdminAnalytics(mockDb, { range: '30d', nowMs });
      const res90d = getAdminAnalytics(mockDb, { range: '90d', nowMs });
      assert.equal(res7d.kpis.cartsStarted.value, 1);
      assert.equal(res30d.kpis.cartsStarted.value, 1);
      assert.equal(res90d.kpis.cartsStarted.value, 2);
    });

    // ---- ASSERTION 5: CSV export contains aggregate rows and zero personal data ----
    await check('CSV export returns aggregate metrics only with zero personal data or payment wording', async () => {
      const csvRes = await api('/api/admin/analytics/csv?range=30d', { token: adminToken });
      assert.equal(csvRes.status, 200);
      const csv = csvRes.rawText;
      assert.ok(csv.startsWith('section,metric,period_or_category,value,unit'));
      assert.ok(csv.includes('"Savannah Mart"'));
      assert.ok(csv.includes('"Kenyan AA Coffee 250g"'));
      assert.ok(csv.includes('"Savannah Eco Tote"'));

      const forbiddenCsv = [
        shopperAEmail,
        shopperBEmail,
        ownerEmail,
        cashierEmail,
        shopperAPhone,
        shopperBPhone,
        'Alice SecretShopper',
        'Bob SecretShopper',
        coffeeBarcode,
        'revenue',
        'payment',
      ];
      for (const forbidden of forbiddenCsv) {
        assert.equal(
          csv.toLowerCase().includes(forbidden.toLowerCase()),
          false,
          `CSV must never contain "${forbidden}"`
        );
      }
    });

    console.log('\n[analytics-test] All Admin Analytics assertions PASSED.');
  } finally {
    killProc(serverProc);
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup
    }
  }

  process.exit(exitCode);
}

runTests().catch((err) => {
  console.error('[analytics-test] Aborted:', err);
  killProc(serverProc);
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup
  }
  process.exit(1);
});
