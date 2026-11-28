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
  readWelcomeDismissed,
  persistWelcomeDismissed,
  shouldShowWelcomeScreen,
  StorageLike,
} from '../src/utils/welcomeState';
import { User } from '../src/types';

const TEST_PORT = 3800 + crypto.randomInt(0, 300);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smartcart-wg-test-'));
const TEST_DB_PATH = path.join(TMP_DIR, 'smartcart_wg_test_db.json');
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
    guestId?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.guestId) headers['x-guest-id'] = options.guestId;

  const res = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers,
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // plain text
  }
  return { status: res.status, data };
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

  console.log('\n[welcome-goodbye-test] Part 1: Welcome Screen visibility, storage resilience, & UI assertions');

  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'silent',
  });

  try {
    const i18nMod = await vite.ssrLoadModule('/src/utils/i18n.tsx');
    const welcomeMod = await vite.ssrLoadModule('/src/components/WelcomeScreen.tsx');
    const goodbyeMod = await vite.ssrLoadModule('/src/components/GoodbyeScreen.tsx');
    const LanguageProvider = i18nMod.LanguageProvider;
    const WelcomeScreen = welcomeMod.WelcomeScreen;
    const GoodbyeScreen = goodbyeMod.GoodbyeScreen;

    await check('Welcome Screen renders on signed-out first visit and omits admin link', () => {
      assert.equal(
        shouldShowWelcomeScreen({
          isLoading: false,
          user: null,
          currentPath: '/',
          welcomeDismissed: false,
        }),
        true
      );
      assert.equal(
        shouldShowWelcomeScreen({
          isLoading: false,
          user: null,
          currentPath: '/login',
          welcomeDismissed: false,
        }),
        true
      );

      const html = renderToStaticMarkup(
        React.createElement(
          LanguageProvider,
          null,
          React.createElement(WelcomeScreen, {
            onGetStarted: () => {},
            onSelectOwnerPortal: () => {},
            onSelectStaffPortal: () => {},
          })
        )
      );

      assert.ok(html.includes('Welcome to Smart Cart'));
      assert.ok(html.includes('Scan as you shop and know your total before you reach the cashier.'));
      assert.ok(html.includes('Scan barcodes'));
      assert.ok(html.includes('See your running total'));
      assert.ok(html.includes('Earn loyalty points'));
      assert.ok(html.includes('Get started'));
      assert.ok(
        html.includes("I&#x27;m a supermarket or staff member") ||
          html.includes("I'm a supermarket or staff member")
      );
      assert.equal(html.toLowerCase().includes('/admin'), false);
    });

    await check('Welcome Screen is skipped whenever a user is signed in across all portals', () => {
      const roles: Array<User['role']> = ['shopper', 'staff', 'owner', 'admin'];
      for (const role of roles) {
        const signedInUser: User = {
          id: `u_${role}`,
          name: `Test ${role}`,
          email: `${role}@smartcart.local`,
          phone: '+254700000000',
          role,
          status: 'active',
          failedAttempts: 0,
          createdAt: new Date().toISOString(),
        };
        assert.equal(
          shouldShowWelcomeScreen({
            isLoading: false,
            user: signedInUser,
            currentPath: '/',
            welcomeDismissed: false,
            forceWelcomeOpen: true,
          }),
          false,
          `Signed-in ${role} must skip Welcome Screen`
        );
      }
    });

    await check('Welcome dismissal handles unavailable/throwing localStorage cleanly without blocking', () => {
      const brokenStorage: StorageLike = {
        getItem() {
          throw new Error('QuotaExceededError / disabled storage');
        },
        setItem() {
          throw new Error('QuotaExceededError / disabled storage');
        },
      };
      assert.equal(readWelcomeDismissed(brokenStorage), false);
      assert.equal(persistWelcomeDismissed(brokenStorage), false);
      assert.equal(readWelcomeDismissed(null), false);
      assert.equal(persistWelcomeDismissed(null), false);

      // Working storage persists dismissal cleanly and redirects returning visitors
      const storeMap = new Map<string, string>();
      const workingStorage: StorageLike = {
        getItem: (k) => storeMap.get(k) ?? null,
        setItem: (k, v) => {
          storeMap.set(k, v);
        },
      };
      assert.equal(persistWelcomeDismissed(workingStorage), true);
      assert.equal(readWelcomeDismissed(workingStorage), true);
      assert.equal(
        shouldShowWelcomeScreen({
          isLoading: false,
          user: null,
          currentPath: '/',
          welcomeDismissed: true,
        }),
        false
      );
      // Reopened explicitly via "About Smart Cart"
      assert.equal(
        shouldShowWelcomeScreen({
          isLoading: false,
          user: null,
          currentPath: '/login',
          welcomeDismissed: true,
          forceWelcomeOpen: true,
        }),
        true
      );
    });

    await check('Goodbye Screen renders summary, no-payment cashier note, and offline notice safely', () => {
      const html = renderToStaticMarkup(
        React.createElement(
          LanguageProvider,
          null,
          React.createElement(GoodbyeScreen, {
            isSignedIn: true,
            summary: {
              cartId: 'cart_test_1',
              shortCode: 'SC-7721',
              status: 'locked',
              itemCount: 3,
              lineItemCount: 2,
              subtotal: 390,
              totalDiscount: 0,
              finalTotal: 390,
              branchName: 'Test Branch',
              supermarketName: 'Test Mart',
              loyaltyEarnedOnCart: 16,
              loyaltyBalance: 16,
              pendingOfflineFinish: true,
              source: 'finish_button',
            },
            onStartNewCart: () => {},
            onViewRewards: () => {},
            onSignOutOrSignIn: () => {},
            onBackToDashboard: () => {},
          })
        )
      );

      assert.ok(html.includes('Thank you for shopping with Smart Cart. Goodbye and see you soon!'));
      assert.ok(html.includes('SC-7721'));
      assert.ok(html.includes('390'));
      assert.ok(html.includes('Show this code to the cashier and pay at the till (cash, card or M-Pesa at the cashier). Smart Cart does not take payment.'));
      assert.ok(
        html.includes("we&#x27;ll finish this when you&#x27;re back online") ||
          html.includes("we'll finish this when you're back online")
      );
      assert.ok(html.includes('Start a new cart'));
      assert.ok(html.includes('View my rewards'));
      assert.ok(html.includes('Back to dashboard'));
      assert.equal(html.toLowerCase().includes('/admin'), false);
    });
  } finally {
    await vite.close();
  }

  console.log(`\n[welcome-goodbye-test] Part 2: Starting isolated server on port ${TEST_PORT}...`);
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

    // Bootstrap Admin -> Supermarket -> Branch -> Product -> Cashier -> 2 Shoppers
    const adminEmail = 'sysadmin-wg@smartcart.local';
    const setupRes = await api('/api/admin/setup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.10' },
      body: JSON.stringify({ email: adminEmail, name: 'Sys Admin', setupKey: ADMIN_SETUP_KEY }),
    });
    assert.equal(setupRes.status, 200);
    const adminTempPass = setupRes.data.tempPassword;
    const adminLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: adminEmail, password: adminTempPass, portal: 'admin' }),
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.data.token;
    const adminNewPass = makeTestSecret('AdminWG');
    await api('/api/admin/change-first-password', {
      method: 'POST',
      token: adminToken,
      body: JSON.stringify({ currentPassword: adminTempPass, newPassword: adminNewPass }),
    });

    const ownerEmail = 'owner-wg@example.com';
    const ownerPass = makeTestSecret('OwnerWG');
    const applyRes = await api('/api/supermarket/apply', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.11' },
      body: JSON.stringify({
        chainName: 'FreshMart WG',
        contactEmail: ownerEmail,
        contactPhone: '+254711111222',
        city: 'Nairobi',
        firstBranchName: 'FreshMart Main',
        ownerName: 'Owner WG',
        password: ownerPass,
      }),
    });
    assert.equal(applyRes.status, 200);
    const smId = applyRes.data.supermarket.id;

    await api(`/api/admin/supermarkets/${smId}/status`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ status: 'active' }),
    });

    const ownerLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: ownerEmail, password: ownerPass, portal: 'management' }),
    });
    assert.equal(ownerLogin.status, 200);
    const ownerToken = ownerLogin.data.token;

    const overview = await api('/api/owner/overview', { token: ownerToken });
    const branchId = overview.data.branches[0].id;

    const milkBarcode = `616220111111${calculateEAN13CheckDigit('616220111111')}`;
    const breadBarcode = `616220222222${calculateEAN13CheckDigit('616220222222')}`;
    const csvText = [
      'barcode,name,category,base_price,aisle,shelf,branch_price,stock,low_stock_threshold',
      `${milkBarcode},"Fresh Milk 1L",Dairy,120,Aisle 1,Shelf A,120,50,5`,
      `${breadBarcode},"Brown Bread 400g",Bakery,65,Aisle 2,Shelf B,65,40,5`,
    ].join('\n');

    const csvRes = await api('/api/owner/products/csv-import', {
      method: 'POST',
      token: ownerToken,
      body: JSON.stringify({ csvText, branchId }),
    });
    assert.equal(csvRes.status, 200);

    const cashierEmail = 'cashier-wg@example.com';
    const cashierPass = makeTestSecret('CashierWG');
    const stRes = await api('/api/owner/staff', {
      method: 'POST',
      token: ownerToken,
      body: JSON.stringify({
        name: 'Cashier WG',
        email: cashierEmail,
        phone: '+254722222333',
        password: cashierPass,
        branchId,
        preset: 'cashier',
      }),
    });
    assert.equal(stRes.status, 200);
    const cashierLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: cashierEmail, password: cashierPass, portal: 'staff' }),
    });
    assert.equal(cashierLogin.status, 200);
    const cashierToken = cashierLogin.data.token;

    const regA = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.12' },
      body: JSON.stringify({
        name: 'Alice Shopper',
        email: 'alice-wg@example.com',
        phone: '+254700000101',
        password: makeTestSecret('AliceWG'),
      }),
    });
    assert.equal(regA.status, 200);
    const shopperAToken = regA.data.token;

    const regB = await api('/api/auth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.13' },
      body: JSON.stringify({
        name: 'Bob Shopper',
        email: 'bob-wg@example.com',
        phone: '+254700000102',
        password: makeTestSecret('BobWG'),
      }),
    });
    assert.equal(regB.status, 200);
    const shopperBToken = regB.data.token;

    // Populate Shopper A's cart: 2x Milk (240) + 1x Bread (65) = KES 305 (3 items)
    const add1 = await api('/api/shopper/cart/add', {
      method: 'POST',
      token: shopperAToken,
      body: JSON.stringify({ branchId, barcode: milkBarcode, quantity: 2 }),
    });
    assert.equal(add1.status, 200);

    const add2 = await api('/api/shopper/cart/add', {
      method: 'POST',
      token: shopperAToken,
      body: JSON.stringify({ branchId, barcode: breadBarcode, quantity: 1 }),
    });
    assert.equal(add2.status, 200);

    const cartA = add2.data;
    const cartAId = cartA.id;
    const cartAShortCode = cartA.shortCode;
    const firstItemId = cartA.items[0].id;
    assert.equal(cartA.finalTotal, 305);

    let finishResponseSummary: any = null;

    await check('Finishing a cart closes it, keeps cashier lookup working, and blocks further edits', async () => {
      const fin = await api('/api/shopper/cart/finish', {
        method: 'POST',
        token: shopperAToken,
        body: JSON.stringify({ cartId: cartAId }),
      });
      assert.equal(fin.status, 200);
      assert.equal(fin.data.success, true);
      assert.equal(fin.data.alreadyClosed, false);
      assert.equal(fin.data.cart.status, 'locked');
      finishResponseSummary = fin.data.summary;

      // Cashier short code still works after finish
      const lookup = await api(`/api/cashier/lookup/${encodeURIComponent(cartAShortCode)}`, {
        token: cashierToken,
      });
      assert.equal(lookup.status, 200);
      assert.equal(lookup.data.cart.id, cartAId);

      // Edits on closed cart are rejected with 400
      const editAdd = await api('/api/shopper/cart/add', {
        method: 'POST',
        token: shopperAToken,
        body: JSON.stringify({ branchId, barcode: milkBarcode, quantity: 1, cartId: cartAId }),
      });
      assert.equal(editAdd.status, 400);

      const editQty = await api('/api/shopper/cart/quantity', {
        method: 'PUT',
        token: shopperAToken,
        body: JSON.stringify({ cartId: cartAId, itemId: firstItemId, quantity: 5 }),
      });
      assert.equal(editQty.status, 400);

      const editBudget = await api('/api/shopper/cart/budget', {
        method: 'POST',
        token: shopperAToken,
        body: JSON.stringify({ cartId: cartAId, budgetLimit: 500 }),
      });
      assert.equal(editBudget.status, 400);

      const editSync = await api('/api/shopper/cart/sync', {
        method: 'POST',
        token: shopperAToken,
        body: JSON.stringify({
          offlineCart: {
            cartId: cartAId,
            branchId,
            items: [{ barcode: milkBarcode, quantity: 99 }],
          },
        }),
      });
      assert.equal(editSync.status, 400);

      const editDelete = await api(`/api/shopper/cart/${encodeURIComponent(cartAId)}`, {
        method: 'DELETE',
        token: shopperAToken,
      });
      assert.equal(editDelete.status, 400);
    });

    await check('Goodbye summary matches authoritative server cart totals and item counts', async () => {
      assert.equal(finishResponseSummary.cartId, cartAId);
      assert.equal(finishResponseSummary.shortCode, cartAShortCode);
      assert.equal(finishResponseSummary.itemCount, 3);
      assert.equal(finishResponseSummary.lineItemCount, 2);
      assert.equal(finishResponseSummary.subtotal, 305);
      assert.equal(finishResponseSummary.finalTotal, 305);

      const summaryRes = await api(`/api/shopper/cart/summary?cartId=${encodeURIComponent(cartAId)}`, {
        token: shopperAToken,
      });
      assert.equal(summaryRes.status, 200);
      assert.equal(summaryRes.data.summary.itemCount, 3);
      assert.equal(summaryRes.data.summary.finalTotal, 305);
      assert.equal(summaryRes.data.summary.shortCode, cartAShortCode);
    });

    await check('One shopper cannot finish or read summary of another shopper cart (403)', async () => {
      const otherFinish = await api('/api/shopper/cart/finish', {
        method: 'POST',
        token: shopperBToken,
        body: JSON.stringify({ cartId: cartAId }),
      });
      assert.equal(otherFinish.status, 403);

      const otherSummary = await api(`/api/shopper/cart/summary?cartId=${encodeURIComponent(cartAId)}`, {
        token: shopperBToken,
      });
      assert.equal(otherSummary.status, 403);

      const guestFinish = await api('/api/shopper/cart/finish', {
        method: 'POST',
        guestId: 'guest_intruder_1234',
        body: JSON.stringify({ cartId: cartAId }),
      });
      assert.equal(guestFinish.status, 403);
    });

    await check('Finishing twice is idempotent and does not double-count loyalty points', async () => {
      // Finish again while locked (pre-cashier)
      const secondFinish = await api('/api/shopper/cart/finish', {
        method: 'POST',
        token: shopperAToken,
        body: JSON.stringify({ cartId: cartAId }),
      });
      assert.equal(secondFinish.status, 200);
      assert.equal(secondFinish.data.alreadyClosed, true);

      // Cashier verifies cart at till -> awards loyalty points once
      const verify = await api('/api/cashier/verify', {
        method: 'POST',
        token: cashierToken,
        body: JSON.stringify({ cartId: cartAId }),
      });
      assert.equal(verify.status, 200);
      assert.ok(verify.data.loyaltyPointsEarned > 0);
      const earnedOnVerify = verify.data.loyaltyPointsEarned;

      // Finish again post-verify -> idempotent, status remains verified, no duplicate loyalty points
      const thirdFinish = await api('/api/shopper/cart/finish', {
        method: 'POST',
        token: shopperAToken,
        body: JSON.stringify({ cartId: cartAId }),
      });
      assert.equal(thirdFinish.status, 200);
      assert.equal(thirdFinish.data.alreadyClosed, true);
      assert.equal(thirdFinish.data.cart.status, 'verified');
      assert.equal(thirdFinish.data.summary.loyaltyEarnedOnCart, earnedOnVerify);
      assert.equal(thirdFinish.data.summary.loyaltyBalance, earnedOnVerify);

      const loyalty = await api('/api/shopper/loyalty-points', { token: shopperAToken });
      assert.equal(loyalty.status, 200);
      assert.equal(loyalty.data.totalPoints, earnedOnVerify);
      const earnEntries = loyalty.data.ledger.filter((e: any) => e.type === 'earn' && e.cartId === cartAId);
      assert.equal(earnEntries.length, 1);
    });

    await check('Start a new cart creates a fresh empty active cart after finishing', async () => {
      const newCartRes = await api('/api/shopper/cart/new', {
        method: 'POST',
        token: shopperAToken,
        body: JSON.stringify({ branchId }),
      });
      assert.equal(newCartRes.status, 200);
      assert.equal(newCartRes.data.status, 'active');
      assert.equal(newCartRes.data.items.length, 0);
      assert.notEqual(newCartRes.data.id, cartAId);
    });

    console.log('\n[welcome-goodbye-test] All Welcome & Goodbye checks PASSED.');
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
  console.error('[welcome-goodbye-test] Aborted:', err);
  killProc(serverProc);
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup
  }
  process.exit(1);
});
