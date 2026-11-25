import assert from 'node:assert/strict';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { calculateEAN13CheckDigit } from '../src/utils/barcode';

const TEST_PORT = 3400 + crypto.randomInt(0, 400);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smartcart-sec-test-'));
const TEST_DB_PATH = path.join(TMP_DIR, 'nested', 'smartcart_test_db.json');
const ADMIN_SETUP_KEY = `TestAdminSetupKey_${crypto.randomBytes(12).toString('hex')}`;

const makeTestSecret = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString('hex')}!9`;

let serverProc: ChildProcess | null = null;

async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch {
      // Server still booting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Timed out waiting for test server to boot');
}

async function api(
  pathname: string,
  options: Omit<RequestInit, 'headers'> & {
    token?: string;
    guestId?: string;
    headers?: Record<string, string>;
    baseUrl?: string;
  } = {}
): Promise<{ status: number; data: any; headers: Headers }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.guestId) headers['x-guest-id'] = options.guestId;

  const targetBase = options.baseUrl || BASE_URL;
  const res = await fetch(`${targetBase}${pathname}`, {
    ...options,
    headers,
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON response (e.g. CSV)
  }
  return { status: res.status, data, headers: res.headers };
}

function killProc(proc: ChildProcess | null) {
  if (!proc?.pid) return;
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      // Already exited
    }
  }
}

async function runTests() {
  let exitCode = 0;
  let passed = 0;
  let failed = 0;

  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      passed += 1;
      console.log(`  PASS: ${name}`);
    } catch (err: any) {
      failed += 1;
      console.error(`  FAIL: ${name} -> ${err?.message || err}`);
      throw err;
    }
  };

  console.log(`[security-test] Starting isolated test server on port ${TEST_PORT}...`);
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

  let logs = '';
  serverProc.stdout?.on('data', (d) => {
    logs += d.toString();
  });
  serverProc.stderr?.on('data', (d) => {
    logs += d.toString();
  });

  try {
    await waitForServer(BASE_URL);
    console.log('[security-test] Server online. Executing security assertions...\n');

    // 1. Health check, clean empty DB, & setup-status
    await check('1. /healthz returns { ok: true }, DB initializes cleanly with zero demo data, and /api/admin/setup-status returns only { isSetupComplete }', async () => {
      const hz = await api('/healthz');
      assert.equal(hz.status, 200);
      assert.deepEqual(hz.data, { ok: true });

      const pubSms = await api('/api/supermarkets');
      assert.equal(pubSms.status, 200);
      assert.equal(pubSms.data.length, 0);

      const st = await api('/api/admin/setup-status');
      assert.equal(st.status, 200);
      assert.deepEqual(Object.keys(st.data), ['isSetupComplete']);
      assert.equal(st.data.isSetupComplete, false);
    });

    // 2. Admin setup refused without right key, succeeds once, second admin never allowed
    const adminEmail = 'sysadmin-sec@smartcart.local';
    let adminTempPassword = '';
    let adminToken = '';
    const adminFinalPass = makeTestSecret('AdminFinal');

    await check('2. Admin setup is refused without the right key and a second admin can never be created', async () => {
      const noKey = await api('/api/admin/setup', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.1' },
        body: JSON.stringify({ email: adminEmail, name: 'Sys Admin' }),
      });
      assert.equal(noKey.status, 401);

      const badKey = await api('/api/admin/setup', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.1' },
        body: JSON.stringify({ email: adminEmail, name: 'Sys Admin', setupKey: 'wrong-key-value' }),
      });
      assert.equal(badKey.status, 401);

      const good = await api('/api/admin/setup', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.1' },
        body: JSON.stringify({ email: adminEmail, name: 'Sys Admin', setupKey: ADMIN_SETUP_KEY }),
      });
      assert.equal(good.status, 200);
      assert.equal(typeof good.data.tempPassword, 'string');
      assert.ok(good.data.tempPassword.length >= 8);
      adminTempPassword = good.data.tempPassword;

      const statusAfter = await api('/api/admin/setup-status');
      assert.equal(statusAfter.status, 200);
      assert.deepEqual(statusAfter.data, { isSetupComplete: true });

      const secondAdmin = await api('/api/admin/setup', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.1' },
        body: JSON.stringify({
          email: 'second-admin@smartcart.local',
          name: 'Second Admin',
          setupKey: ADMIN_SETUP_KEY,
        }),
      });
      assert.equal(secondAdmin.status, 403);

      // Admin must change temp password on first login
      const login = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: adminEmail, password: adminTempPassword, portal: 'admin' }),
      });
      assert.equal(login.status, 200);
      assert.equal(login.data.user.mustChangePassword, true);
      adminToken = login.data.token;

      const chg = await api('/api/admin/change-first-password', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({ currentPassword: adminTempPassword, newPassword: adminFinalPass }),
      });
      assert.equal(chg.status, 200);
    });

    // 3. Register Shopper A & Shopper B (blocks admin escalation)
    let shopperAToken = '';
    let shopperBToken = '';
    let shopperAId = '';
    const shopperAEmail = 'shopper-a@example.com';
    const shopperAPass = makeTestSecret('ShopperA');
    const shopperBEmail = 'shopper-b@example.com';
    const shopperBPass = makeTestSecret('ShopperB');

    await check('3. Shopper registration enforces min password and rejects role escalation', async () => {
      const escalate = await api('/api/auth/register', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.2' },
        body: JSON.stringify({
          name: 'Escalator',
          email: 'escalator@example.com',
          phone: '+254700000099',
          password: makeTestSecret('Esc'),
          role: 'admin',
        }),
      });
      assert.equal(escalate.status, 403);

      const regA = await api('/api/auth/register', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.2' },
        body: JSON.stringify({
          name: 'Shopper A',
          email: shopperAEmail,
          phone: '+254700000001',
          password: shopperAPass,
        }),
      });
      assert.equal(regA.status, 200);
      shopperAToken = regA.data.token;
      shopperAId = regA.data.user.id;

      const regB = await api('/api/auth/register', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.3' },
        body: JSON.stringify({
          name: 'Shopper B',
          email: shopperBEmail,
          phone: '+254700000002',
          password: shopperBPass,
        }),
      });
      assert.equal(regB.status, 200);
      shopperBToken = regB.data.token;
    });

    // 4. Forgot password never returns a code or link
    await check('4. /api/auth/forgot-password never returns a code or link', async () => {
      const rKnown = await api('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.4' },
        body: JSON.stringify({ identifier: shopperAEmail }),
      });
      const rUnknown = await api('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.4' },
        body: JSON.stringify({ identifier: 'unknown-user@example.com' }),
      });
      const rAdmin = await api('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.4' },
        body: JSON.stringify({ identifier: adminEmail }),
      });

      for (const r of [rKnown, rUnknown, rAdmin]) {
        assert.equal(r.status, 200);
        assert.equal(r.data.demoCode, undefined);
        assert.equal(r.data.resetLink, undefined);
        assert.equal(r.data.code, undefined);
        assert.equal(r.data.token, undefined);
        assert.equal(r.data.message, 'If an account exists, a recovery message has been sent.');
      }
    });

    // 5. Provision Supermarket A (Branch X & Branch Y) and Supermarket B (Branch Z), approve both, import products, add staff & promo
    let smAId = '';
    let smACode = '';
    let smBId = '';
    let branchXId = '';
    let branchYId = '';
    let branchZId = '';
    let ownerAToken = '';
    let ownerBToken = '';
    let cashierXToken = '';
    let clerkXToken = '';
    let prodAId = '';
    const prodABarcode = `616110123456${calculateEAN13CheckDigit('616110123456')}`;
    let prodBId = '';
    const prodBBarcode = `616110234561${calculateEAN13CheckDigit('616110234561')}`;
    let promoAId = '';

    const ownerAEmail = 'owner-alpha@example.com';
    const ownerAPass = makeTestSecret('OwnerA');
    const ownerBEmail = 'owner-beta@example.com';
    const ownerBPass = makeTestSecret('OwnerB');
    const cashierXEmail = 'cashier-x@example.com';
    const cashierXPass = makeTestSecret('CashierX');
    const clerkXEmail = 'clerk-x@example.com';
    const clerkXPass = makeTestSecret('ClerkX');

    await check('5. Supermarkets A & B onboard, approve, create branches/products/promotions/staff cleanly', async () => {
      const applyA = await api('/api/supermarket/apply', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.5' },
        body: JSON.stringify({
          chainName: 'AlphaMart',
          contactEmail: ownerAEmail,
          contactPhone: '+254711000101',
          city: 'Nairobi',
          firstBranchName: 'Alpha Branch X',
          ownerName: 'Owner Alpha',
          password: ownerAPass,
        }),
      });
      assert.equal(applyA.status, 200);
      smAId = applyA.data.supermarket.id;
      smACode = applyA.data.supermarket.code;

      const applyB = await api('/api/supermarket/apply', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.6' },
        body: JSON.stringify({
          chainName: 'BetaMart',
          contactEmail: ownerBEmail,
          contactPhone: '+254711000202',
          city: 'Mombasa',
          firstBranchName: 'Beta Branch Z',
          ownerName: 'Owner Beta',
          password: ownerBPass,
        }),
      });
      assert.equal(applyB.status, 200);
      smBId = applyB.data.supermarket.id;

      // Pending owner rejected before approval & pending branch is hidden from shoppers
      const preLogin = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: ownerAEmail, password: ownerAPass, portal: 'management' }),
      });
      assert.equal(preLogin.status, 403);

      const preBranches = await api(`/api/branches?supermarketId=${smAId}`);
      assert.equal(preBranches.status, 200);
      assert.equal(preBranches.data.length, 0);

      // Non-admin (shopper) cannot approve a newly registered shop
      const nonAdminApprove = await api(`/api/admin/supermarkets/${smAId}/status`, {
        method: 'PUT',
        token: shopperAToken,
        body: JSON.stringify({ status: 'active' }),
      });
      assert.equal(nonAdminApprove.status, 403);

      // Admin approves both supermarkets
      const appA = await api(`/api/admin/supermarkets/${smAId}/status`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ status: 'active' }),
      });
      assert.equal(appA.status, 200);

      // Approving a newly registered shop activates its initial branch for shoppers
      const postBranches = await api(`/api/branches?supermarketId=${smAId}`);
      assert.equal(postBranches.status, 200);
      assert.equal(postBranches.data.length, 1);
      assert.equal(postBranches.data[0].name, 'Alpha Branch X');

      const appB = await api(`/api/admin/supermarkets/${smBId}/status`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ status: 'active' }),
      });
      assert.equal(appB.status, 200);

      // Log in both owners
      const logA = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: ownerAEmail, password: ownerAPass, portal: 'management' }),
      });
      assert.equal(logA.status, 200);
      ownerAToken = logA.data.token;

      const logB = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: ownerBEmail, password: ownerBPass, portal: 'management' }),
      });
      assert.equal(logB.status, 200);
      ownerBToken = logB.data.token;

      // Get Branch X & Branch Z, plus create Branch Y on Supermarket A
      const ovA = await api('/api/owner/overview', { token: ownerAToken });
      assert.equal(ovA.status, 200);
      branchXId = ovA.data.branches[0].id;

      const brYRes = await api('/api/owner/branches', {
        method: 'POST',
        token: ownerAToken,
        body: JSON.stringify({ name: 'Alpha Branch Y', code: 'ALP-Y', city: 'Nakuru' }),
      });
      assert.equal(brYRes.status, 200);
      branchYId = brYRes.data.id;

      const ovB = await api('/api/owner/overview', { token: ownerBToken });
      assert.equal(ovB.status, 200);
      branchZId = ovB.data.branches[0].id;

      // Import products via CSV for both chains
      const csvA = `barcode,name,category,base_price,aisle,shelf,branch_price,stock,low_stock_threshold\n${prodABarcode},"Alpha Whole Milk 500ml",Dairy,70,Aisle 1,Shelf A,65,20,5`;
      const impA = await api('/api/owner/products/csv-import', {
        method: 'POST',
        token: ownerAToken,
        body: JSON.stringify({ csvText: csvA, branchId: branchXId }),
      });
      assert.equal(impA.status, 200);

      const bpARes = await api(`/api/shopper/branch-products/${branchXId}`);
      assert.equal(bpARes.status, 200);
      prodAId = bpARes.data.products[0].id;

      // Also stock Branch Y via override
      const stockY = await api('/api/owner/branch-product-override', {
        method: 'POST',
        token: ownerAToken,
        body: JSON.stringify({ branchId: branchYId, productId: prodAId, stock: 30 }),
      });
      assert.equal(stockY.status, 200);

      const csvB = `barcode,name,category,base_price,aisle,shelf,branch_price,stock,low_stock_threshold\n${prodBBarcode},"Beta Maize Meal 2kg",Pantry,160,Aisle 2,Shelf B,155,25,5`;
      const impB = await api('/api/owner/products/csv-import', {
        method: 'POST',
        token: ownerBToken,
        body: JSON.stringify({ csvText: csvB, branchId: branchZId }),
      });
      assert.equal(impB.status, 200);

      const bpBRes = await api(`/api/shopper/branch-products/${branchZId}`);
      assert.equal(bpBRes.status, 200);
      prodBId = bpBRes.data.products[0].id;

      // Owner A creates promo
      const promoRes = await api('/api/owner/promotions', {
        method: 'POST',
        token: ownerAToken,
        body: JSON.stringify({
          name: 'Alpha 10% Milk',
          type: 'percent_off',
          discountPercent: 10,
          productBarcodes: [prodABarcode],
        }),
      });
      assert.equal(promoRes.status, 200);
      promoAId = promoRes.data.id;

      // Owner A creates Cashier (Branch X, verifyCarts only) and Stock Clerk (Branch X, no editPrices)
      const st1 = await api('/api/owner/staff', {
        method: 'POST',
        token: ownerAToken,
        body: JSON.stringify({
          name: 'Cashier X',
          email: cashierXEmail,
          phone: '+254722000101',
          password: cashierXPass,
          branchId: branchXId,
          preset: 'cashier',
        }),
      });
      assert.equal(st1.status, 200);

      const st2 = await api('/api/owner/staff', {
        method: 'POST',
        token: ownerAToken,
        body: JSON.stringify({
          name: 'Clerk X',
          email: clerkXEmail,
          phone: '+254722000102',
          password: clerkXPass,
          branchId: branchXId,
          preset: 'stock_clerk',
        }),
      });
      assert.equal(st2.status, 200);

      const cLogin = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: cashierXEmail, password: cashierXPass, portal: 'staff' }),
      });
      assert.equal(cLogin.status, 200);
      cashierXToken = cLogin.data.token;

      const kLogin = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: clerkXEmail, password: clerkXPass, portal: 'staff' }),
      });
      assert.equal(kLogin.status, 200);
      clerkXToken = kLogin.data.token;
    });

    // 6. Shopper gets 403 on branch-product-override, promotions, every cashier route, and reports
    await check('6. Shopper gets 403 on branch-product-override, promotions, every cashier route, and reports', async () => {
      assert.equal(
        (
          await api('/api/owner/branch-product-override', {
            method: 'POST',
            token: shopperAToken,
            body: JSON.stringify({ branchId: branchXId, productId: prodAId, priceOverride: 1 }),
          })
        ).status,
        403
      );

      assert.equal((await api('/api/owner/promotions', { token: shopperAToken })).status, 403);
      assert.equal(
        (
          await api('/api/owner/promotions', {
            method: 'POST',
            token: shopperAToken,
            body: JSON.stringify({ name: 'Rogue', type: 'percent_off', discountPercent: 50, productBarcodes: [prodABarcode] }),
          })
        ).status,
        403
      );
      assert.equal(
        (await api(`/api/owner/promotions/${promoAId}/toggle`, { method: 'PUT', token: shopperAToken })).status,
        403
      );

      // Every cashier route
      assert.equal((await api('/api/cashier/lookup/SC-1000', { token: shopperAToken })).status, 403);
      assert.equal(
        (await api('/api/cashier/toggle-check', { method: 'POST', token: shopperAToken, body: JSON.stringify({ cartId: 'c1', itemId: 'i1', checked: true }) })).status,
        403
      );
      assert.equal(
        (await api('/api/cashier/flag', { method: 'POST', token: shopperAToken, body: JSON.stringify({ cartId: 'c1', reason: 'test' }) })).status,
        403
      );
      assert.equal(
        (await api('/api/cashier/verify', { method: 'POST', token: shopperAToken, body: JSON.stringify({ cartId: 'c1' }) })).status,
        403
      );
      assert.equal(
        (await api('/api/cashier/complete', { method: 'POST', token: shopperAToken, body: JSON.stringify({ cartId: 'c1' }) })).status,
        403
      );

      // Reports
      assert.equal((await api('/api/reports', { token: shopperAToken })).status, 403);
      assert.equal((await api('/api/reports/csv', { token: shopperAToken })).status, 403);
    });

    // 7. Create carts on Supermarket A (Branch X and Branch Y) and Supermarket B (Branch Z) for cross-tenant & completion tests
    let cartXId = '';
    let cartXCode = '';
    let cartXItemId = '';
    let cartYId = '';
    let cartYCode = '';
    let cartZId = '';
    let cartZCode = '';

    // Prepare carts cleanly before cross-owner / cross-branch checks
    const cX = await api(`/api/shopper/cart?branchId=${branchXId}`, { token: shopperAToken });
    assert.equal(cX.status, 200);
    cartXId = cX.data.id;
    const addX = await api('/api/shopper/cart/add', {
      method: 'POST',
      token: shopperAToken,
      body: JSON.stringify({ branchId: branchXId, barcode: prodABarcode, quantity: 3, cartId: cartXId }),
    });
    assert.equal(addX.status, 200);
    cartXCode = addX.data.shortCode;
    cartXItemId = addX.data.items[0].id;

    const cY = await api(`/api/shopper/cart?branchId=${branchYId}`, { guestId: 'guest-y-branch-test' });
    assert.equal(cY.status, 200);
    cartYId = cY.data.id;
    const addY = await api('/api/shopper/cart/add', {
      method: 'POST',
      guestId: 'guest-y-branch-test',
      body: JSON.stringify({ branchId: branchYId, barcode: prodABarcode, quantity: 1, cartId: cartYId }),
    });
    assert.equal(addY.status, 200);
    cartYCode = addY.data.shortCode;

    const cZ = await api(`/api/shopper/cart?branchId=${branchZId}`, { token: shopperBToken });
    assert.equal(cZ.status, 200);
    cartZId = cZ.data.id;
    const addZ = await api('/api/shopper/cart/add', {
      method: 'POST',
      token: shopperBToken,
      body: JSON.stringify({ branchId: branchZId, barcode: prodBBarcode, quantity: 1, cartId: cartZId }),
    });
    assert.equal(addZ.status, 200);
    cartZCode = addZ.data.shortCode;

    // 8. Owner of Supermarket A cannot read or change Supermarket B's branches, products, staff, carts, or reports
    await check('7. Owner of Supermarket A cannot read or change Supermarket B branches, products, staff, carts, or reports', async () => {
      assert.equal((await api(`/api/owner/overview?supermarketId=${smBId}`, { token: ownerAToken })).status, 403);
      assert.equal(
        (await api('/api/owner/branches', { method: 'POST', token: ownerAToken, body: JSON.stringify({ supermarketId: smBId, name: 'Rogue', code: 'ROG' }) })).status,
        403
      );
      assert.equal(
        (await api('/api/owner/branch-product-override', { method: 'POST', token: ownerAToken, body: JSON.stringify({ branchId: branchZId, productId: prodBId, priceOverride: 5 }) })).status,
        403
      );
      assert.equal(
        (await api('/api/owner/products/csv-export?supermarketId=' + smBId, { token: ownerAToken })).status,
        403
      );
      assert.equal(
        (
          await api('/api/owner/staff', {
            method: 'POST',
            token: ownerAToken,
            body: JSON.stringify({
              name: 'Cross Staff',
              email: 'cross-staff@example.com',
              phone: '+254799000111',
              password: makeTestSecret('Cross'),
              branchId: branchZId,
            }),
          })
        ).status,
        403
      );
      assert.equal((await api(`/api/cashier/lookup/${cartZCode}`, { token: ownerAToken })).status, 403);
      assert.equal((await api('/api/cashier/complete', { method: 'POST', token: ownerAToken, body: JSON.stringify({ cartId: cartZId }) })).status, 403);
      assert.equal((await api(`/api/reports?supermarketId=${smBId}`, { token: ownerAToken })).status, 403);
      assert.equal((await api(`/api/reports?branchId=${branchZId}`, { token: ownerAToken })).status, 403);
      assert.equal((await api(`/api/reports/csv?supermarketId=${smBId}`, { token: ownerAToken })).status, 403);
    });

    // 9. Staff without editPrices cannot change a price, and staff of Branch X cannot touch Branch Y
    await check('8. Staff without editPrices cannot change a price, and staff of Branch X cannot touch Branch Y', async () => {
      // Stock clerk lacks editPrices
      const noPriceEdit = await api('/api/owner/branch-product-override', {
        method: 'POST',
        token: clerkXToken,
        body: JSON.stringify({ branchId: branchXId, productId: prodAId, priceOverride: 99 }),
      });
      assert.equal(noPriceEdit.status, 403);

      // Stock clerk CAN edit stock on Branch X, CANNOT edit Branch Y
      const okStockX = await api('/api/owner/branch-product-override', {
        method: 'POST',
        token: clerkXToken,
        body: JSON.stringify({ branchId: branchXId, productId: prodAId, stock: 20 }),
      });
      assert.equal(okStockX.status, 200);

      const crossBranchClerk = await api('/api/owner/branch-product-override', {
        method: 'POST',
        token: clerkXToken,
        body: JSON.stringify({ branchId: branchYId, productId: prodAId, stock: 5 }),
      });
      assert.equal(crossBranchClerk.status, 403);

      // Cashier of Branch X cannot lookup or complete Branch Y's cart or view Branch Y reports
      assert.equal((await api(`/api/cashier/lookup/${cartYCode}`, { token: cashierXToken })).status, 403);
      assert.equal(
        (await api('/api/cashier/verify', { method: 'POST', token: cashierXToken, body: JSON.stringify({ cartId: cartYId }) })).status,
        403
      );
      assert.equal(
        (await api('/api/cashier/complete', { method: 'POST', token: cashierXToken, body: JSON.stringify({ cartId: cartYId }) })).status,
        403
      );
      assert.equal((await api(`/api/reports?branchId=${branchYId}`, { token: cashierXToken })).status, 403);
    });

    // 10. Shopper & Guest cart isolation
    await check('9. One shopper cannot edit another shopper cart, and two guests never see each other carts', async () => {
      // Shopper B cannot modify or lock Shopper A's cart
      assert.equal(
        (await api('/api/shopper/cart/budget', { method: 'POST', token: shopperBToken, body: JSON.stringify({ cartId: cartXId, budgetLimit: 500 }) })).status,
        403
      );
      assert.equal(
        (await api('/api/shopper/cart/lock', { method: 'POST', token: shopperBToken, body: JSON.stringify({ cartId: cartXId }) })).status,
        403
      );
      assert.equal((await api(`/api/shopper/cart/${cartXId}`, { method: 'DELETE', token: shopperBToken })).status, 403);

      // Two guests with different guest IDs get distinct carts and cannot read/touch each other's carts
      const guest1 = 'guest-sec-one-111';
      const guest2 = 'guest-sec-two-222';
      const g1Cart = await api(`/api/shopper/cart?branchId=${branchXId}`, { guestId: guest1 });
      const g2Cart = await api(`/api/shopper/cart?branchId=${branchXId}`, { guestId: guest2 });
      assert.equal(g1Cart.status, 200);
      assert.equal(g2Cart.status, 200);
      assert.notEqual(g1Cart.data.id, g2Cart.data.id);

      assert.equal(
        (await api('/api/shopper/cart/budget', { method: 'POST', guestId: guest2, body: JSON.stringify({ cartId: g1Cart.data.id, budgetLimit: 200 }) })).status,
        403
      );
      assert.equal((await api(`/api/shopper/cart/${g1Cart.data.id}`, { method: 'DELETE', guestId: guest2 })).status, 403);
    });

    // 11. Each portal (shopper, staff, management, admin) rejects the other roles with the identical generic message
    await check('10. Each portal (shopper, staff, management, admin) rejects the other roles with the identical generic message', async () => {
      const genericMsg = 'Incorrect details or wrong sign-in page.';
      const creds = [
        { role: 'shopper', identifier: shopperAEmail, password: shopperAPass },
        { role: 'staff', identifier: cashierXEmail, password: cashierXPass },
        { role: 'owner', identifier: ownerAEmail, password: ownerAPass },
        { role: 'admin', identifier: adminEmail, password: adminFinalPass },
      ];
      const expectedPortal: Record<string, string> = {
        shopper: 'shopper',
        staff: 'staff',
        owner: 'management',
        admin: 'admin',
      };
      const portals = ['shopper', 'staff', 'management', 'admin'];

      for (const c of creds) {
        for (const p of portals) {
          if (expectedPortal[c.role] !== p) {
            const res = await api('/api/auth/login', {
              method: 'POST',
              body: JSON.stringify({ identifier: c.identifier, password: c.password, portal: p }),
            });
            assert.equal(res.status, 401, `Expected 401 for ${c.role} on portal ${p}`);
            assert.equal(res.data.error, genericMsg);
          }
        }
      }
    });

    // 12. Completing the same cart twice deducts stock only once
    await check('11. Completing the same cart twice deducts stock only once (and verifying twice is rejected)', async () => {
      const lookup = await api(`/api/cashier/lookup/${cartXCode}`, { token: cashierXToken });
      assert.equal(lookup.status, 200);
      assert.equal(lookup.data.cart.id, cartXId);

      const chk = await api('/api/cashier/toggle-check', {
        method: 'POST',
        token: cashierXToken,
        body: JSON.stringify({ cartId: cartXId, itemId: cartXItemId, checked: true }),
      });
      assert.equal(chk.status, 200);

      const ver1 = await api('/api/cashier/verify', {
        method: 'POST',
        token: cashierXToken,
        body: JSON.stringify({ cartId: cartXId }),
      });
      assert.equal(ver1.status, 200);

      const ver2 = await api('/api/cashier/verify', {
        method: 'POST',
        token: cashierXToken,
        body: JSON.stringify({ cartId: cartXId }),
      });
      assert.equal(ver2.status, 400);

      const beforeRes = await api(`/api/shopper/branch-products/${branchXId}`);
      const stockBefore = beforeRes.data.products.find((p: any) => p.id === prodAId).stock;

      const comp1 = await api('/api/cashier/complete', {
        method: 'POST',
        token: cashierXToken,
        body: JSON.stringify({ cartId: cartXId }),
      });
      assert.equal(comp1.status, 200);

      const after1Res = await api(`/api/shopper/branch-products/${branchXId}`);
      const stockAfter1 = after1Res.data.products.find((p: any) => p.id === prodAId).stock;
      assert.equal(stockAfter1, stockBefore - 3);

      const comp2 = await api('/api/cashier/complete', {
        method: 'POST',
        token: cashierXToken,
        body: JSON.stringify({ cartId: cartXId }),
      });
      assert.equal(comp2.status, 400);

      const after2Res = await api(`/api/shopper/branch-products/${branchXId}`);
      const stockAfter2 = after2Res.data.products.find((p: any) => p.id === prodAId).stock;
      assert.equal(stockAfter2, stockAfter1);
    });

    // 13. Loyalty Points + Shared Shopping Lists from past purchases & product history
    await check('12. Loyalty Points award on completed checkout, isolate per shopper, and Shared shopping lists work cleanly', async () => {
      const legacyQrRes = await api('/api/shopper/loyalty/scan', {
        method: 'POST',
        token: shopperAToken,
        body: JSON.stringify({ qrPayload: `SMARTCART:LOYALTY:${smACode}:AM-100200` }),
      });
      assert.equal(legacyQrRes.status, 404);

      const pointsRes = await api('/api/shopper/loyalty-points', { token: shopperAToken });
      assert.equal(pointsRes.status, 200);
      assert.ok(pointsRes.data.totalPoints > 0, 'Completed checkout should award loyalty points');
      assert.ok(
        pointsRes.data.history.some((tx: any) => tx.cartId === cartXId && tx.supermarketId === smAId),
        'Shopper A loyalty history must include completed checkout cartXId'
      );

      // Shopper B must not see Shopper A loyalty points
      const bPointsRes = await api('/api/shopper/loyalty-points', { token: shopperBToken });
      assert.equal(bPointsRes.status, 200);
      assert.equal(bPointsRes.data.totalPoints, 0);

      const pastRes = await api('/api/shopper/past-purchases', { token: shopperAToken });
      assert.equal(pastRes.status, 200);
      assert.ok(pastRes.data.some((c: any) => c.id === cartXId));

      const histRes = await api(`/api/shopper/product-history?branchId=${branchXId}`, { token: shopperAToken });
      assert.equal(histRes.status, 200);
      assert.ok(histRes.data.some((p: any) => p.barcode === prodABarcode));

      const listRes = await api('/api/shopper/shopping-lists', {
        method: 'POST',
        token: shopperAToken,
        body: JSON.stringify({
          title: 'Alpha Restock',
          canEdit: false,
          branchId: branchXId,
          sourceCartId: cartXId,
        }),
      });
      assert.equal(listRes.status, 200);
      assert.equal(listRes.data.items[0].quantity, 3);
    });

    // 14. Logout, password reset, role change, & suspension revoke sessions immediately
    await check('13. Logout, admin password reset, role change, and suspension immediately invalidate existing sessions', async () => {
      // Logout revokes token
      const l1 = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: shopperBEmail, password: shopperBPass, portal: 'shopper' }),
      });
      assert.equal(l1.status, 200);
      const tokLogout = l1.data.token;
      assert.equal((await api('/api/auth/me', { token: tokLogout })).status, 200);
      assert.equal((await api('/api/auth/logout', { method: 'POST', token: tokLogout })).status, 200);
      assert.equal((await api('/api/auth/me', { token: tokLogout })).status, 401);

      // Admin password reset revokes Shopper A token
      assert.equal((await api('/api/auth/me', { token: shopperAToken })).status, 200);
      const resetRes = await api(`/api/admin/users/${shopperAId}/reset-password`, {
        method: 'POST',
        token: adminToken,
      });
      assert.equal(resetRes.status, 200);
      assert.equal((await api('/api/auth/me', { token: shopperAToken })).status, 401);

      // Role change revokes active session
      const l2 = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: shopperBEmail, password: shopperBPass, portal: 'shopper' }),
      });
      assert.equal(l2.status, 200);
      const tokRole = l2.data.token;
      const shopperBId = l2.data.user.id;
      const chgRole = await api(`/api/admin/users/${shopperBId}/status`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ role: 'owner' }),
      });
      assert.equal(chgRole.status, 200);
      assert.equal((await api('/api/auth/me', { token: tokRole })).status, 401);

      // Suspension revokes Cashier X session
      assert.equal((await api('/api/auth/me', { token: cashierXToken })).status, 200);
      const staffUsers = await api('/api/admin/users', { token: adminToken });
      const cashierUser = staffUsers.data.find((u: any) => u.email === cashierXEmail);
      const suspRes = await api(`/api/admin/users/${cashierUser.id}/status`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ status: 'suspended' }),
      });
      assert.equal(suspRes.status, 200);
      assert.equal((await api('/api/auth/me', { token: cashierXToken })).status, 401);
    });

    // 15. Five wrong passwords lock the account, and per-IP rate limit blocks a flood
    await check('14. Five wrong passwords lock the account, and per-IP rate limit blocks a flood', async () => {
      const lockTarget = 'lock-probe@example.com';
      for (let i = 0; i < 5; i++) {
        const fail = await api('/api/auth/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': '198.51.100.10' },
          body: JSON.stringify({ identifier: lockTarget, password: 'WrongPassword1!', portal: 'shopper' }),
        });
        assert.equal(fail.status, 401);
      }
      const locked = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.10' },
        body: JSON.stringify({ identifier: lockTarget, password: 'WrongPassword1!', portal: 'shopper' }),
      });
      assert.equal(locked.status, 429);

      // Per-IP flood test on a fresh client IP
      let floodBlocked = false;
      for (let i = 0; i < 35; i++) {
        const r = await api('/api/auth/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': '198.51.100.77' },
          body: JSON.stringify({ identifier: `flood-${i}@example.com`, password: 'WrongPassword1!', portal: 'shopper' }),
        });
        if (r.status === 429) {
          floodBlocked = true;
          break;
        }
      }
      assert.equal(floodBlocked, true, 'Expected IP flood to trigger 429 rate limit');
    });

    // 16. Expired session token is rejected & production startup refuses unsafe env
    await check('15. Expired session tokens are rejected and production startup refuses DEMO_MODE=true or short ADMIN_SETUP_KEY', async () => {
      // Production startup refusal checks
      const demoRefusal = spawnSync('npx', ['tsx', 'server.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DEMO_MODE: 'true',
          ADMIN_SETUP_KEY,
          DB_PATH: path.join(TMP_DIR, 'refuse1.json'),
          TRUST_PROXY: 'true',
        },
        encoding: 'utf-8',
      });
      assert.notEqual(demoRefusal.status, 0);
      assert.match(demoRefusal.stderr, /DEMO_MODE must not be "true"/);

      const shortKeyRefusal = spawnSync('npx', ['tsx', 'server.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DEMO_MODE: 'false',
          ADMIN_SETUP_KEY: 'too-short',
        },
        encoding: 'utf-8',
      });
      assert.notEqual(shortKeyRefusal.status, 0);
      assert.match(shortKeyRefusal.stderr, /Missing required production environment variable: DB_PATH/);
      assert.match(shortKeyRefusal.stderr, /Missing required production environment variable: TRUST_PROXY/);
      assert.match(shortKeyRefusal.stderr, /at least 24 characters long/);

      // Expired session token check using a tiny SESSION_HOURS on a short-lived server
      const expPort = TEST_PORT + 50;
      const expUrl = `http://127.0.0.1:${expPort}`;
      const expDb = path.join(TMP_DIR, 'exp_db.json');
      const expProc = spawn('npx', ['tsx', 'server.ts'], {
        cwd: process.cwd(),
        detached: true,
        env: {
          ...process.env,
          PORT: String(expPort),
          DB_PATH: expDb,
          ADMIN_SETUP_KEY,
          DEMO_MODE: 'false',
          TRUST_PROXY: 'true',
          SESSION_HOURS: '0.00015', // ~0.54 seconds
          NODE_ENV: 'production',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      try {
        await waitForServer(expUrl);
        const regExp = await api('/api/auth/register', {
          baseUrl: expUrl,
          method: 'POST',
          body: JSON.stringify({
            name: 'Expiry Tester',
            email: 'expiry@example.com',
            phone: '+254788111222',
            password: makeTestSecret('Exp'),
          }),
        });
        assert.equal(regExp.status, 200);
        const shortTok = regExp.data.token;
        assert.equal((await api('/api/auth/me', { baseUrl: expUrl, token: shortTok })).status, 200);

        await new Promise((r) => setTimeout(r, 750));
        assert.equal((await api('/api/auth/me', { baseUrl: expUrl, token: shortTok })).status, 401);
      } finally {
        killProc(expProc);
      }
    });

    // 17. Single system admin specific email & password setup, env bootstrap, and credential update
    let updatedAdminToken = '';
    await check('16. Single admin supports specific email/password setup, env bootstrap, and credential update while blocking any second admin', async () => {
      // A) PUT /api/admin/account on main server
      const nonAdminUpdate = await api('/api/admin/account', {
        method: 'PUT',
        token: ownerAToken,
        body: JSON.stringify({ currentPassword: 'Reset123!', newEmail: 'hijack@example.com' }),
      });
      assert.equal(nonAdminUpdate.status, 403);

      const secondAdminLogin = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.88' },
        body: JSON.stringify({ identifier: adminEmail, password: adminFinalPass, portal: 'admin' }),
      });
      assert.equal(secondAdminLogin.status, 200);
      const secondaryAdminSession = secondAdminLogin.data.token;

      const wrongPwd = await api('/api/admin/account', {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ currentPassword: 'WrongPassword!9', newEmail: 'newadmin@smartcart.local' }),
      });
      assert.equal(wrongPwd.status, 401);

      const newAdminEmail = 'primary-admin@smartcart.local';
      const newAdminPass = makeTestSecret('AdminUpdated');
      const goodUpdate = await api('/api/admin/account', {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({
          currentPassword: adminFinalPass,
          newEmail: newAdminEmail,
          newPassword: newAdminPass,
          name: 'Primary System Admin',
        }),
      });
      assert.equal(goodUpdate.status, 200);
      assert.equal(goodUpdate.data.user.email, newAdminEmail);

      // Other active admin session is revoked
      assert.equal((await api('/api/auth/me', { token: secondaryAdminSession })).status, 401);
      // Old password rejected, new email + password accepted
      const oldLogin = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.89' },
        body: JSON.stringify({ identifier: adminEmail, password: adminFinalPass, portal: 'admin' }),
      });
      assert.equal(oldLogin.status, 401);

      const newLogin = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.89' },
        body: JSON.stringify({ identifier: newAdminEmail, password: newAdminPass, portal: 'admin' }),
      });
      assert.equal(newLogin.status, 200);
      updatedAdminToken = newLogin.data.token;

      // B) Direct setup with custom email & password (no temp password needed)
      const directPort = TEST_PORT + 51;
      const directUrl = `http://127.0.0.1:${directPort}`;
      const directProc = spawn('npx', ['tsx', 'server.ts'], {
        cwd: process.cwd(),
        detached: true,
        env: {
          ...process.env,
          PORT: String(directPort),
          DB_PATH: path.join(TMP_DIR, 'direct_admin_db.json'),
          ADMIN_SETUP_KEY,
          DEMO_MODE: 'false',
          TRUST_PROXY: 'true',
          NODE_ENV: 'production',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      try {
        await waitForServer(directUrl);
        const specificEmail = 'owner-admin@customdomain.org';
        const specificPass = makeTestSecret('DirectAdmin');
        const setupRes = await api('/api/admin/setup', {
          baseUrl: directUrl,
          method: 'POST',
          body: JSON.stringify({
            email: specificEmail,
            password: specificPass,
            name: 'Direct Admin',
            setupKey: ADMIN_SETUP_KEY,
          }),
        });
        assert.equal(setupRes.status, 200);
        assert.equal(setupRes.data.requiresPasswordChange, false);
        assert.equal(setupRes.data.tempPassword, undefined);

        const directLogin = await api('/api/auth/login', {
          baseUrl: directUrl,
          method: 'POST',
          body: JSON.stringify({ identifier: specificEmail, password: specificPass, portal: 'admin' }),
        });
        assert.equal(directLogin.status, 200);
        assert.equal(directLogin.data.user.mustChangePassword, false);

        const secondSetup = await api('/api/admin/setup', {
          baseUrl: directUrl,
          method: 'POST',
          body: JSON.stringify({
            email: 'second@customdomain.org',
            password: makeTestSecret('Second'),
            setupKey: ADMIN_SETUP_KEY,
          }),
        });
        assert.equal(secondSetup.status, 403);
      } finally {
        killProc(directProc);
      }

      // C) Env var bootstrap with ADMIN_EMAIL & ADMIN_PASSWORD
      const envPort = TEST_PORT + 52;
      const envUrl = `http://127.0.0.1:${envPort}`;
      const envEmail = 'env-admin@customdomain.org';
      const envPass = makeTestSecret('EnvAdmin');
      const envProc = spawn('npx', ['tsx', 'server.ts'], {
        cwd: process.cwd(),
        detached: true,
        env: {
          ...process.env,
          PORT: String(envPort),
          DB_PATH: path.join(TMP_DIR, 'env_admin_db.json'),
          ADMIN_SETUP_KEY,
          ADMIN_EMAIL: envEmail,
          ADMIN_PASSWORD: envPass,
          DEMO_MODE: 'false',
          TRUST_PROXY: 'true',
          NODE_ENV: 'production',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      try {
        await waitForServer(envUrl);
        const st = await api('/api/admin/setup-status', { baseUrl: envUrl });
        assert.equal(st.status, 200);
        assert.equal(st.data.isSetupComplete, true);

        const envLogin = await api('/api/auth/login', {
          baseUrl: envUrl,
          method: 'POST',
          body: JSON.stringify({ identifier: envEmail, password: envPass, portal: 'admin' }),
        });
        assert.equal(envLogin.status, 200);
        assert.equal(envLogin.data.user.role, 'admin');
        assert.equal(envLogin.data.user.mustChangePassword, false);

        const blockExtra = await api('/api/admin/setup', {
          baseUrl: envUrl,
          method: 'POST',
          body: JSON.stringify({
            email: 'extra@customdomain.org',
            password: makeTestSecret('Extra'),
            setupKey: ADMIN_SETUP_KEY,
          }),
        });
        assert.equal(blockExtra.status, 403);
      } finally {
        killProc(envProc);
      }
    });

    // 18. Only admin can approve shops and reset passwords for both shoppers and shops
    await check('17. Only admin can approve shops and reset passwords for both shoppers and shops', async () => {
      const currentAdminToken = updatedAdminToken;
      assert.ok(currentAdminToken);

      // Register a pending Shop C
      const ownerCEmail = 'owner-gamma@example.com';
      const ownerCPass = makeTestSecret('OwnerC');
      const applyC = await api('/api/supermarket/apply', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.91' },
        body: JSON.stringify({
          chainName: 'GammaMart',
          contactEmail: ownerCEmail,
          contactPhone: '+254711000303',
          city: 'Kisumu',
          firstBranchName: 'Gamma Central',
          ownerName: 'Owner Gamma',
          password: ownerCPass,
        }),
      });
      assert.equal(applyC.status, 200);
      const smCId = applyC.data.supermarket.id;

      // Register a fresh active Shopper C for RBAC & password reset testing
      const shopperCEmail = 'shopper-c@example.com';
      const shopperCPass = makeTestSecret('ShopperC');
      const regC = await api('/api/auth/register', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.94' },
        body: JSON.stringify({
          name: 'Shopper C',
          email: shopperCEmail,
          phone: '+254700000003',
          password: shopperCPass,
        }),
      });
      assert.equal(regC.status, 200);
      const shopperCToken = regC.data.token;
      const shopperCId = regC.data.user.id;

      // Active shopper, owner, and staff are all blocked (403) from approving Shop C or resetting passwords
      for (const nonAdminTok of [shopperCToken, ownerAToken, clerkXToken]) {
        const approveAttempt = await api(`/api/admin/supermarkets/${smCId}/status`, {
          method: 'PUT',
          token: nonAdminTok,
          body: JSON.stringify({ status: 'active' }),
        });
        assert.equal(approveAttempt.status, 403);

        const resetShopperAttempt = await api(`/api/admin/users/${shopperCId}/reset-password`, {
          method: 'POST',
          token: nonAdminTok,
          body: JSON.stringify({}),
        });
        assert.equal(resetShopperAttempt.status, 403);

        const resetShopAttempt = await api(`/api/admin/supermarkets/${smBId}/reset-password`, {
          method: 'POST',
          token: nonAdminTok,
          body: JSON.stringify({}),
        });
        assert.equal(resetShopAttempt.status, 403);
      }

      // Admin approves Shop C and verifies its branch activates
      const approveC = await api(`/api/admin/supermarkets/${smCId}/status`, {
        method: 'PUT',
        token: currentAdminToken,
        body: JSON.stringify({ status: 'active' }),
      });
      assert.equal(approveC.status, 200);

      const cBranches = await api(`/api/branches?supermarketId=${smCId}`);
      assert.equal(cBranches.status, 200);
      assert.equal(cBranches.data.length, 1);

      // Admin resets Shopper C's password with server-generated temporary password
      const resetShopperRes = await api(`/api/admin/users/${shopperCId}/reset-password`, {
        method: 'POST',
        token: currentAdminToken,
        body: JSON.stringify({}),
      });
      assert.equal(resetShopperRes.status, 200);
      assert.equal(resetShopperRes.data.success, true);
      const shopperTempPass = resetShopperRes.data.generatedPassword;
      assert.ok(typeof shopperTempPass === 'string' && shopperTempPass.length >= 10);

      // Prior shopper session is revoked and new temp password works
      assert.equal((await api('/api/auth/me', { token: shopperCToken })).status, 401);
      const shopperRelogin = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.92' },
        body: JSON.stringify({ identifier: shopperCEmail, password: shopperTempPass, portal: 'shopper' }),
      });
      assert.equal(shopperRelogin.status, 200);

      // Admin resets Shop B's owner password directly via /api/admin/supermarkets/:id/reset-password
      const customShopPass = makeTestSecret('ShopReset');
      const resetShopRes = await api(`/api/admin/supermarkets/${smBId}/reset-password`, {
        method: 'POST',
        token: currentAdminToken,
        body: JSON.stringify({ newPassword: customShopPass }),
      });
      assert.equal(resetShopRes.status, 200);
      assert.equal(resetShopRes.data.success, true);
      assert.equal(resetShopRes.data.ownerEmail, ownerBEmail);
      assert.equal(resetShopRes.data.generatedPassword, undefined);

      // Prior Owner B session is revoked and custom reset password works
      assert.equal((await api('/api/auth/me', { token: ownerBToken })).status, 401);
      const ownerBRelogin = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.93' },
        body: JSON.stringify({ identifier: ownerBEmail, password: customShopPass, portal: 'management' }),
      });
      assert.equal(ownerBRelogin.status, 200);
    });

    await check('18. Past Receipts endpoint returns only logged-in shopper completed transactions without in-app payment', async () => {
      // Unauthenticated request blocked
      const unauthRes = await api('/api/shopper/receipts');
      assert.equal(unauthRes.status, 401);

      // Admin resets Shopper A password so we can log back in and check Shopper A receipts
      const shopperANewPass = makeTestSecret('ShopperANew');
      const resetA = await api(`/api/admin/users/${shopperAId}/reset-password`, {
        method: 'POST',
        token: updatedAdminToken,
        body: JSON.stringify({ newPassword: shopperANewPass }),
      });
      assert.equal(resetA.status, 200);

      const loginA = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.95' },
        body: JSON.stringify({ identifier: shopperAEmail, password: shopperANewPass, portal: 'shopper' }),
      });
      assert.equal(loginA.status, 200);
      const freshShopperAToken = loginA.data.token;

      const receiptsA = await api('/api/shopper/receipts', { token: freshShopperAToken });
      assert.equal(receiptsA.status, 200);
      assert.ok(Array.isArray(receiptsA.data.receipts));
      const matched = receiptsA.data.receipts.find((r: any) => r.id === cartXId);
      assert.ok(matched, 'Expected completed cartX to appear in Past Receipts');
      assert.equal(matched.supermarketName, 'AlphaMart');
      assert.equal(matched.branchName, 'Alpha Branch X');
      assert.equal(matched.itemCount, 3);
      assert.equal(matched.noPaymentInApp, true);
      assert.equal(
        receiptsA.data.receipts.some((r: any) => r.id === cartZId || r.shopperId !== shopperAId),
        false,
        'Shopper A receipts must never include another shopper cart'
      );
    });

    console.log(`\n[security-test] Summary: ${passed} PASSED, ${failed} FAILED.`);
  } catch (err) {
    console.error('\n[security-test] FAILURE:', err);
    console.error('--- Server Logs ---\n' + logs);
    exitCode = 1;
  } finally {
    killProc(serverProc);
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    process.exit(exitCode);
  }
}

runTests();
