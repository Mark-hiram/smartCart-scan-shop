import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer as createViteServer } from 'vite';
import { calculateEAN13CheckDigit } from '../src/utils/barcode';
import {
  computeBudgetSummary,
  doesProductMatchListItem,
  groupAndOrderShoppingListItems,
} from '../src/utils/shoppingHelpers';
import { LanguageProvider, translations } from '../src/utils/i18n';

const TEST_PORT = 4400 + crypto.randomInt(0, 200);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smartcart-shopper-features-'));
const TEST_DB_PATH = path.join(TMP_DIR, 'smartcart_shopper_features_db.json');
const ADMIN_SETUP_KEY = `TestAdminKey_${crypto.randomBytes(12).toString('hex')}`;

const makeSecret = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString('hex')}!9`;

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
  throw new Error('Timed out waiting for test server');
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
    // non-json response
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

function assertNoForbiddenInventoryKeys(obj: unknown, pathLabel = 'root') {
  const forbidden = new Set([
    'stock',
    'isLowStock',
    'lowStockThreshold',
    'lowStockThresholdOverride',
    'cost',
    'costPrice',
    'wholesalePrice',
  ]);
  if (Array.isArray(obj)) {
    obj.forEach((entry, idx) => assertNoForbiddenInventoryKeys(entry, `${pathLabel}[${idx}]`));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj)) {
      if (forbidden.has(key)) {
        throw new Error(`Forbidden inventory/cost key "${key}" exposed at ${pathLabel}.${key}`);
      }
      assertNoForbiddenInventoryKeys(val, `${pathLabel}.${key}`);
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

  console.log('\n[shopper-features-test] Part 1: Pure helper & pay-at-till UI copy checks...');

  await check('Aisle grouping orders numeric aisles first, category second, Other last', () => {
    const groups = groupAndOrderShoppingListItems(
      [
        { id: '1', productName: 'Mystery Snack', quantity: 1, completed: false },
        { id: '2', productName: 'Fresh Milk', quantity: 1, completed: false, category: 'Dairy' },
        { id: '3', productName: 'Brown Bread', quantity: 1, completed: false, aisle: 'Aisle 10' },
        { id: '4', productName: 'Arabica Coffee', quantity: 1, completed: false, aisle: '2' },
      ],
      [],
      'Other'
    );
    assert.deepEqual(
      groups.map((g) => g.groupLabel),
      ['Aisle 2', 'Aisle 10', 'Dairy', 'Other']
    );
  });

  await check('Scan matcher matches typed names & barcodes accurately', () => {
    assert.equal(
      doesProductMatchListItem(
        { productName: 'Whole Milk' },
        { barcode: '123', name: 'Brookside Whole Milk 1L' }
      ),
      true
    );
    assert.equal(
      doesProductMatchListItem(
        { productName: 'Butter' },
        { barcode: '456', name: 'White Bread 400g' }
      ),
      false
    );
  });

  await check('Budget summary thresholds (normal < 80%, near >= 80%, over > 100%)', () => {
    assert.equal(computeBudgetSummary(790, 1000).level, 'normal');
    assert.equal(computeBudgetSummary(800, 1000).level, 'near');
    assert.equal(computeBudgetSummary(1000, 1000).level, 'near');
    const over = computeBudgetSummary(1250, 1000);
    assert.equal(over.level, 'over');
    assert.equal(over.overBy, 250);
  });

  await check('Pay-at-till reminder appears on GoodbyeScreen and finish checkout copy', async () => {
    const expected =
      'Show this code to the cashier and pay at the till (cash, card or M-Pesa at the cashier). Smart Cart does not take payment.';
    assert.equal(translations.en.checkoutNotice, expected);
    assert.equal(translations.en.goodbyeCashierInstruction, expected);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
      logLevel: 'silent',
    });
    try {
      const mod = await vite.ssrLoadModule('/src/components/GoodbyeScreen.tsx');
      const GoodbyeScreen = mod.GoodbyeScreen;
      const html = renderToStaticMarkup(
        React.createElement(
          LanguageProvider,
          null,
          React.createElement(GoodbyeScreen, {
            isSignedIn: true,
            summary: {
              cartId: 'cart_pay_test',
              shortCode: 'SC-1001',
              status: 'locked',
              itemCount: 2,
              lineItemCount: 2,
              subtotal: 400,
              totalDiscount: 0,
              finalTotal: 400,
              branchName: 'Kilimani Branch',
              supermarketName: 'Alpha Mart',
              loyaltyEarnedOnCart: 10,
              loyaltyBalance: 20,
              source: 'finish_button',
            },
            onStartNewCart: () => {},
            onViewRewards: () => {},
            onSignOutOrSignIn: () => {},
            onBackToDashboard: () => {},
          })
        )
      );
      assert.ok(html.includes(expected));
    } finally {
      await vite.close();
    }
  });

  console.log(`\n[shopper-features-test] Part 2: Starting isolated server on port ${TEST_PORT}...`);
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

    // 1. Setup Admin + 2 Supermarkets (Chain A with 2 active branches + 1 inactive branch; Chain B with 1 active branch)
    const adminEmail = 'admin-sf@smartcart.local';
    const setupRes = await api('/api/admin/setup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.1' },
      body: JSON.stringify({ email: adminEmail, name: 'Admin SF', setupKey: ADMIN_SETUP_KEY }),
    });
    assert.equal(setupRes.status, 200);
    const adminTempPass = setupRes.data.tempPassword;
    const adminLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: adminEmail, password: adminTempPass, portal: 'admin' }),
    });
    const adminToken = adminLogin.data.token;
    const adminPass = makeSecret('AdminSF');
    await api('/api/admin/change-first-password', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ currentPassword: adminTempPass, newPassword: adminPass }),
    });

    // Chain A: Alpha Supermarket (2 branches)
    const ownerAEmail = 'owner-alpha@example.com';
    const ownerAPass = makeSecret('OwnerA');
    const applyA = await api('/api/supermarket/apply', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.2' },
      body: JSON.stringify({
        chainName: 'Alpha Supermarket',
        contactEmail: ownerAEmail,
        contactPhone: '+254711100100',
        city: 'Nairobi',
        firstBranchName: 'Alpha Westlands',
        ownerName: 'Alpha Owner',
        password: ownerAPass,
      }),
    });
    assert.equal(applyA.status, 200);
    const smAId = applyA.data.supermarket.id;

    // Chain B: Beta Supermarket (1 branch)
    const ownerBEmail = 'owner-beta@example.com';
    const ownerBPass = makeSecret('OwnerB');
    const applyB = await api('/api/supermarket/apply', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.3' },
      body: JSON.stringify({
        chainName: 'Beta Grocers',
        contactEmail: ownerBEmail,
        contactPhone: '+254722200200',
        city: 'Mombasa',
        firstBranchName: 'Beta Nyali',
        ownerName: 'Beta Owner',
        password: ownerBPass,
      }),
    });
    assert.equal(applyB.status, 200);
    const smBId = applyB.data.supermarket.id;

    // Activate both chains
    await api(`/api/admin/supermarkets/${smAId}/status`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ status: 'active' }),
    });
    await api(`/api/admin/supermarkets/${smBId}/status`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ status: 'active' }),
    });

    const ownerALogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: ownerAEmail, password: ownerAPass, portal: 'management' }),
    });
    const ownerAToken = ownerALogin.data.token;
    const ownerAOverview = await api('/api/owner/overview', { token: ownerAToken });
    const branchA1Id = ownerAOverview.data.branches[0].id;

    // Create second active branch in Alpha Supermarket
    const createBranchA2 = await api('/api/owner/branches', {
      method: 'POST',
      token: ownerAToken,
      body: JSON.stringify({
        name: 'Alpha Kilimani',
        code: 'ALK-02',
        city: 'Nairobi',
        address: 'Argwings Kodhek Rd',
      }),
    });
    assert.equal(createBranchA2.status, 200);
    const branchA2Id = createBranchA2.data.id;

    // Login Owner B and get Beta branch
    const ownerBLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: ownerBEmail, password: ownerBPass, portal: 'management' }),
    });
    const ownerBToken = ownerBLogin.data.token;
    const ownerBOverview = await api('/api/owner/overview', { token: ownerBToken });
    const branchB1Id = ownerBOverview.data.branches[0].id;

    // Create shared barcode product in Alpha (price 200 at A1, 180 override at A2) and Beta (price 99)
    const sharedBarcode = `616991000001${calculateEAN13CheckDigit('616991000001')}`;
    const teaBarcode = `616992000002${calculateEAN13CheckDigit('616992000002')}`;

    const csvAlpha = [
      'barcode,name,category,base_price,aisle,shelf,branch_price,stock,low_stock_threshold',
      `${sharedBarcode},"Brookside Fresh Milk 1L",Dairy,200,,Shelf 1,200,50,5`,
      `${teaBarcode},"Kericho Gold Tea 250g",Beverages,300,3,Shelf 2,300,40,5`,
    ].join('\n');
    const importAlpha = await api('/api/owner/products/csv-import', {
      method: 'POST',
      token: ownerAToken,
      body: JSON.stringify({ csvText: csvAlpha, branchId: branchA1Id }),
    });
    assert.equal(importAlpha.status, 200);

    // Price & aisle override on A2
    const catalogA1 = await api(`/api/shopper/branch-products/${branchA1Id}`);
    const milkProdA = catalogA1.data.products.find((p: any) => p.barcode === sharedBarcode);
    assert.ok(milkProdA);

    await api('/api/owner/branch-product-override', {
      method: 'POST',
      token: ownerAToken,
      body: JSON.stringify({
        branchId: branchA2Id,
        productId: milkProdA.id,
        priceOverride: 180,
        aisleOverride: '5',
      }),
    });

    // Promo on A1: 10% off Milk => branchPrice 200, finalPrice 180
    const promoRes = await api('/api/owner/promotions', {
      method: 'POST',
      token: ownerAToken,
      body: JSON.stringify({
        name: '10% Dairy Promo',
        type: 'percent_off',
        discountPercent: 10,
        productBarcodes: [sharedBarcode],
        branchId: branchA1Id,
      }),
    });
    assert.equal(promoRes.status, 200);

    // Same barcode in Beta Supermarket (MUST NEVER appear in Alpha compare!)
    const csvBeta = [
      'barcode,name,category,base_price,aisle,shelf,branch_price,stock,low_stock_threshold',
      `${sharedBarcode},"Brookside Fresh Milk 1L",Dairy,99,1,Shelf 1,99,25,3`,
    ].join('\n');
    await api('/api/owner/products/csv-import', {
      method: 'POST',
      token: ownerBToken,
      body: JSON.stringify({ csvText: csvBeta, branchId: branchB1Id }),
    });

    // Create Staff user in Alpha to test 403 on price-check
    const staffEmail = 'staff-alpha@example.com';
    const staffPass = makeSecret('StaffA');
    await api('/api/owner/staff', {
      method: 'POST',
      token: ownerAToken,
      body: JSON.stringify({
        name: 'Alpha Cashier',
        email: staffEmail,
        phone: '+254733300300',
        password: staffPass,
        branchId: branchA1Id,
        preset: 'cashier',
      }),
    });
    const staffLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: staffEmail, password: staffPass, portal: 'staff' }),
    });
    const staffToken = staffLogin.data.token;

    // Register 2 Shoppers
    const shopper1Pass = makeSecret('Shopper1');
    const regS1 = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.11' },
      body: JSON.stringify({
        name: 'Amina Shopper',
        email: 'amina-sf@example.com',
        phone: '+254700111222',
        password: shopper1Pass,
      }),
    });
    assert.equal(regS1.status, 200);
    const shopper1Token = regS1.data.token;

    const shopper2Pass = makeSecret('Shopper2');
    const regS2 = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.12' },
      body: JSON.stringify({
        name: 'Brian Shopper',
        email: 'brian-sf@example.com',
        phone: '+254700333444',
        password: shopper2Pass,
      }),
    });
    assert.equal(regS2.status, 200);
    const shopper2Token = regS2.data.token;

    // TEST 1: List ownership isolation
    let shopper1ListId = '';
    await check('1. Shopping list belongs strictly to one shopper unless shared', async () => {
      const createRes = await api('/api/shopper/shopping-lists', {
        method: 'POST',
        token: shopper1Token,
        body: JSON.stringify({
          title: 'Amina Weekly List',
          canEdit: false,
          branchId: branchA1Id,
          sourceType: 'blank',
          items: [
            {
              id: 'item_typed_milk',
              productName: 'Fresh Milk',
              quantity: 1,
              completed: false,
            },
            {
              id: 'item_barcode_tea',
              barcode: teaBarcode,
              productName: 'Kericho Gold Tea 250g',
              quantity: 1,
              completed: false,
            },
          ],
        }),
      });
      assert.equal(createRes.status, 200);
      shopper1ListId = createRes.data.id;

      // Shopper 2 does NOT see Shopper 1's unshared list
      const s2Lists = await api('/api/shopper/shopping-lists', { token: shopper2Token });
      assert.equal(s2Lists.status, 200);
      assert.equal(
        s2Lists.data.some((l: any) => l.id === shopper1ListId),
        false
      );

      // Shopper 2 cannot update, delete, or convert Shopper 1's list
      const s2Update = await api(`/api/shopper/shopping-lists/${shopper1ListId}`, {
        method: 'PUT',
        token: shopper2Token,
        body: JSON.stringify({ title: 'Hijacked' }),
      });
      assert.equal(s2Update.status, 403);

      const s2Delete = await api(`/api/shopper/shopping-lists/${shopper1ListId}`, {
        method: 'DELETE',
        token: shopper2Token,
      });
      assert.equal(s2Delete.status, 403);

      const s2Convert = await api('/api/shopper/shopping-lists/convert-to-cart', {
        method: 'POST',
        token: shopper2Token,
        body: JSON.stringify({ listId: shopper1ListId, branchId: branchA1Id }),
      });
      assert.equal(s2Convert.status, 403);
    });

    // TEST 2: Scan auto-ticks matching list item
    await check('2. Scanning a product auto-ticks matching list items on server', async () => {
      // Scan Milk (matches typed item "Fresh Milk")
      const scanMilk = await api('/api/shopper/cart/add', {
        method: 'POST',
        token: shopper1Token,
        body: JSON.stringify({ branchId: branchA1Id, barcode: sharedBarcode, quantity: 1 }),
      });
      assert.equal(scanMilk.status, 200);

      const listsAfter = await api('/api/shopper/shopping-lists', { token: shopper1Token });
      assert.equal(listsAfter.status, 200);
      const listObj = listsAfter.data.find((l: any) => l.id === shopper1ListId);
      assert.ok(listObj);
      const milkListItem = listObj.items.find((it: any) => it.productName === 'Fresh Milk');
      const teaListItem = listObj.items.find((it: any) => it.barcode === teaBarcode);
      assert.ok(milkListItem);
      assert.ok(teaListItem);
      assert.equal(milkListItem.completed, true);
      assert.equal(teaListItem.completed, false);

      // Clean up test cart before price-check and budget tests
      await api(`/api/shopper/cart/${scanMilk.data.id}`, {
        method: 'DELETE',
        token: shopper1Token,
      });
    });

    // TEST 3: Budget thresholds computed from server locked prices + default budget
    await check('3. Budget thresholds & default budget use server locked prices', async () => {
      // Save default budget of KES 350 for Shopper 1
      const defRes = await api('/api/shopper/default-budget', {
        method: 'PUT',
        token: shopper1Token,
        body: JSON.stringify({ defaultBudgetKes: 350 }),
      });
      assert.equal(defRes.status, 200);
      assert.equal(defRes.data.defaultBudgetKes, 350);

      // Start fresh cart -> inherits 350 default budget automatically
      const newCartRes = await api('/api/shopper/cart/new', {
        method: 'POST',
        token: shopper1Token,
        body: JSON.stringify({ branchId: branchA1Id }),
      });
      assert.equal(newCartRes.status, 200);
      const cartId = newCartRes.data.id;
      assert.equal(newCartRes.data.budgetLimit, 350);

      // Attempt offline sync forgery with fake low prices -> server enforces locked prices (Tea 300 => 300/350 = 86% -> near)
      const syncRes = await api('/api/shopper/cart/sync', {
        method: 'POST',
        token: shopper1Token,
        body: JSON.stringify({
          branchId: branchA1Id,
          cartId,
          budgetLimit: 350,
          items: [
            {
              id: 'forged',
              productId: 'fake',
              barcode: teaBarcode,
              name: 'Forged Tea',
              quantity: 1,
              lockedPrice: 5,
              originalBasePrice: 5,
              discount: 0,
              effectiveTotal: 5,
            },
          ],
          finalTotal: 5,
          subtotal: 5,
        }),
      });
      assert.equal(syncRes.status, 200);
      assert.equal(syncRes.data.finalTotal, 300);
      assert.equal(syncRes.data.budgetSummary.level, 'near');
      assert.equal(syncRes.data.budgetSummary.remaining, 50);

      // Add 1 more Tea (server total 600 vs 350 -> over by 250; scanning is NOT blocked)
      const addOver = await api('/api/shopper/cart/add', {
        method: 'POST',
        token: shopper1Token,
        body: JSON.stringify({ branchId: branchA1Id, barcode: teaBarcode, quantity: 1, cartId }),
      });
      assert.equal(addOver.status, 200);
      assert.equal(addOver.data.finalTotal, 600);
      assert.equal(addOver.data.budgetSummary.level, 'over');
      assert.equal(addOver.data.budgetSummary.overBy, 250);

      // Empty cart for next check
      await api(`/api/shopper/cart/${cartId}`, {
        method: 'DELETE',
        token: shopper1Token,
      });
    });

    // TEST 4: Price check does NOT add to cart & shows active promotion finalPrice
    await check('4. Price check shows promo & final price without adding to cart', async () => {
      const cartBefore = await api(`/api/shopper/cart?branchId=${branchA1Id}`, {
        token: shopper1Token,
      });
      assert.equal(cartBefore.status, 200);
      const countBefore = cartBefore.data.items.length;

      const pcRes = await api('/api/shopper/price-check', {
        method: 'POST',
        token: shopper1Token,
        headers: { 'x-forwarded-for': '198.51.100.88' },
        body: JSON.stringify({ branchId: branchA1Id, barcode: sharedBarcode }),
      });
      assert.equal(pcRes.status, 200);
      assert.equal(pcRes.data.branchPrice, 200);
      assert.equal(pcRes.data.finalPrice, 180);
      assert.equal(pcRes.data.activePromotion?.name, '10% Dairy Promo');

      const cartAfter = await api(`/api/shopper/cart?branchId=${branchA1Id}`, {
        token: shopper1Token,
      });
      assert.equal(cartAfter.status, 200);
      assert.equal(cartAfter.data.items.length, countBefore);
    });

    // TEST 5: Compare shows only active branches of the SAME supermarket & zero stock/cost
    await check('5. Compare returns only same-supermarket branches with zero stock or cost data', async () => {
      const pcRes = await api('/api/shopper/price-check', {
        method: 'POST',
        token: shopper1Token,
        headers: { 'x-forwarded-for': '198.51.100.89' },
        body: JSON.stringify({ branchId: branchA1Id, barcode: sharedBarcode }),
      });
      assert.equal(pcRes.status, 200);
      const branches = pcRes.data.compareBranches;
      assert.equal(Array.isArray(branches), true);
      assert.equal(branches.length, 2);
      const branchIds = branches.map((b: any) => b.branchId);
      assert.ok(branchIds.includes(branchA1Id));
      assert.ok(branchIds.includes(branchA2Id));
      // Must NEVER include Beta Supermarket branch
      assert.equal(branchIds.includes(branchB1Id), false);
      // Must NEVER contain stock / threshold / cost anywhere in response
      assertNoForbiddenInventoryKeys(pcRes.data, 'priceCheckResponse');
    });

    // TEST 6: Signed-in shopper role enforcement & rate limit on price-check
    await check('6. Price-check & compare requires signed-in shopper (401/403) and rate-limits (429)', async () => {
      const unauth = await api('/api/shopper/price-check', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.90' },
        body: JSON.stringify({ branchId: branchA1Id, barcode: sharedBarcode }),
      });
      assert.equal(unauth.status, 401);

      for (const nonShopperToken of [ownerAToken, staffToken, adminToken]) {
        const forbidden = await api('/api/shopper/price-check', {
          method: 'POST',
          token: nonShopperToken,
          headers: { 'x-forwarded-for': '198.51.100.91' },
          body: JSON.stringify({ branchId: branchA1Id, barcode: sharedBarcode }),
        });
        assert.equal(forbidden.status, 403);
      }

      // Trigger rate limit (25 per minute per IP) from a dedicated IP
      let hit429 = false;
      for (let i = 0; i < 30; i += 1) {
        const res = await api('/api/shopper/price-check', {
          method: 'POST',
          token: shopper2Token,
          headers: { 'x-forwarded-for': '198.51.100.99' },
          body: JSON.stringify({ branchId: branchA1Id, barcode: sharedBarcode }),
        });
        if (res.status === 429) {
          hit429 = true;
          break;
        }
      }
      assert.equal(hit429, true);
    });
  } finally {
    killProc(serverProc);
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup
    }
  }

  if (exitCode === 0) {
    console.log('\n[shopper-features-test] ALL CHECKS PASSED.');
  }
  process.exit(exitCode);
}

runTests().catch((err) => {
  console.error(err);
  killProc(serverProc);
  process.exit(1);
});
