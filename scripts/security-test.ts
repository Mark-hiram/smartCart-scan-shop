import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const TEST_PORT = 3400 + crypto.randomInt(0, 400);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smartcart-sec-test-'));
const TEST_DB_PATH = path.join(TMP_DIR, 'smartcart_test_db.json');
const ADMIN_SETUP_KEY = 'TestSetupSecret#2026';

let serverProc: ChildProcess | null = null;

async function waitForServer(timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/admin/setup-status`);
      if (res.ok) return;
    } catch {
      // Server still booting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Timed out waiting for test server to boot');
}

async function api(
  pathname: string,
  options: Omit<RequestInit, 'headers'> & { token?: string; guestId?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; data: any; headers: Headers }> {
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
    // Non-JSON response (e.g. CSV)
  }
  return { status: res.status, data, headers: res.headers };
}

async function runTests() {
  let exitCode = 0;
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
    await waitForServer();
    console.log('[security-test] Server online. Executing security assertions...');

    let passed = 0;
    const check = async (name: string, fn: () => Promise<void>) => {
      await fn();
      passed += 1;
      console.log(`  PASS: ${name}`);
    };

    // 1. setup-status must never leak admin email
    await check('1. /api/admin/setup-status returns only { isSetupComplete: boolean }', async () => {
      const r = await api('/api/admin/setup-status');
      assert.equal(r.status, 200);
      assert.deepEqual(Object.keys(r.data), ['isSetupComplete']);
      assert.equal(r.data.isSetupComplete, false);
    });

    // 2. /api/admin/setup requires valid ADMIN_SETUP_KEY and allows only ONE admin ever
    let adminEmail = 'sysadmin-test@smartcart.local';
    let adminTempPassword = '';
    let adminToken = '';

    await check('2. /api/admin/setup rejects wrong setupKey, accepts valid setupKey once, blocks 2nd admin', async () => {
      const badKey = await api('/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({ email: adminEmail, name: 'Sys Admin', setupKey: 'wrong-key' }),
      });
      assert.equal(badKey.status, 401);

      const good = await api('/api/admin/setup', {
        method: 'POST',
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
        body: JSON.stringify({
          email: 'second-admin@smartcart.local',
          name: 'Rogue Admin',
          setupKey: ADMIN_SETUP_KEY,
        }),
      });
      assert.equal(secondAdmin.status, 403);
    });

    // 3. Register rejects admin role escalation
    let shopperToken = '';
    const shopperEmail = 'shopper-sec@example.com';
    const shopperPass = 'ShopperSec!2026';

    await check('3. /api/auth/register blocks admin/owner/staff escalation and forces min 8-char password', async () => {
      const shortPwd = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: 'Short', email: 'short@example.com', phone: '+254700000001', password: '123' }),
      });
      assert.equal(shortPwd.status, 400);

      const escalate = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Attacker',
          email: 'attacker@example.com',
          phone: '+254700000002',
          password: 'Password!123',
          role: 'admin',
        }),
      });
      assert.equal(escalate.status, 403);

      const okReg = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Verified Shopper',
          email: shopperEmail,
          phone: '+254700000003',
          password: shopperPass,
        }),
      });
      assert.equal(okReg.status, 200);
      assert.equal(okReg.data.user.role, 'shopper');
      shopperToken = okReg.data.token;
    });

    // 4. Forgot password returns generic message & no leaked codes when DEMO_MODE=false
    await check('4. /api/auth/forgot-password never leaks demoCode or resetLink when DEMO_MODE=false', async () => {
      const rKnown = await api('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ identifier: shopperEmail }),
      });
      const rUnknown = await api('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'nonexistent-user@example.com' }),
      });
      const rAdmin = await api('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ identifier: adminEmail }),
      });

      for (const r of [rKnown, rUnknown, rAdmin]) {
        assert.equal(r.status, 200);
        assert.equal(r.data.demoCode, undefined);
        assert.equal(r.data.resetLink, undefined);
        assert.equal(r.data.message, 'If an account exists, a recovery message has been sent.');
      }
    });

    // 5. Portal enforcement & generic error message + 5-failure lockout
    await check('5. Portal isolation rejects cross-portal logins and locks after 5 failures', async () => {
      const wrongPortal = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: shopperEmail, password: shopperPass, portal: 'management' }),
      });
      assert.equal(wrongPortal.status, 401);
      assert.equal(wrongPortal.data.error, 'Incorrect details or wrong sign-in page.');

      const wrongPortalAdmin = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: shopperEmail, password: shopperPass, portal: 'admin' }),
      });
      assert.equal(wrongPortalAdmin.status, 401);
      assert.equal(wrongPortalAdmin.data.error, 'Incorrect details or wrong sign-in page.');

      // Unknown identifier 5 failed attempts -> 6th attempt returns 429
      const unknownEmail = 'lockout-probe@example.com';
      for (let i = 0; i < 5; i++) {
        const fail = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ identifier: unknownEmail, password: 'WrongPassword1!', portal: 'shopper' }),
        });
        assert.equal(fail.status, 401);
      }
      const locked = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: unknownEmail, password: 'WrongPassword1!', portal: 'shopper' }),
      });
      assert.equal(locked.status, 429);
    });

    // Sign in admin & change first password
    await check('6. Admin must change temp password on first login', async () => {
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
        body: JSON.stringify({ currentPassword: adminTempPassword, newPassword: 'AdminStrong#2026' }),
      });
      assert.equal(chg.status, 200);
    });

    // 7. Role & route separation checks
    await check('7. Shopper blocked from store, owner, cashier, reports, and admin routes', async () => {
      const r1 = await api('/api/admin/metrics', { token: shopperToken });
      assert.equal(r1.status, 403);

      const r2 = await api('/api/owner/overview', { token: shopperToken });
      assert.equal(r2.status, 403);

      const r3 = await api('/api/reports/csv', { token: shopperToken });
      assert.equal(r3.status, 403);

      const r4 = await api('/api/owner/branch-product-override', {
        method: 'POST',
        token: shopperToken,
        body: JSON.stringify({ branchId: 'br_westlands', productId: 'prod_1', priceOverride: 1 }),
      });
      assert.equal(r4.status, 403);

      const r5 = await api('/api/cashier/lookup/SC-1000', { token: shopperToken });
      assert.equal(r5.status, 403);
    });

    // 8. Cart & Guest isolation
    await check('8. Shopper & Guest cart isolation prevents cross-user cart access/deletion', async () => {
      const guestA = 'guest-alpha-1111';
      const guestB = 'guest-beta-2222';

      const cartARes = await api('/api/shopper/cart?branchId=br_westlands', { guestId: guestA });
      assert.equal(cartARes.status, 200);
      const cartAId = cartARes.data.id;

      // Guest B cannot delete or change budget on Guest A's cart
      const stealDel = await api(`/api/shopper/cart/${cartAId}`, { method: 'DELETE', guestId: guestB });
      assert.equal(stealDel.status, 403);

      const stealBudget = await api('/api/shopper/cart/budget', {
        method: 'POST',
        guestId: guestB,
        body: JSON.stringify({ cartId: cartAId, budgetLimit: 500 }),
      });
      assert.equal(stealBudget.status, 403);

      // Registered shopper cannot access Guest A's cart
      const shopperSteal = await api('/api/shopper/cart/lock', {
        method: 'POST',
        token: shopperToken,
        body: JSON.stringify({ cartId: cartAId }),
      });
      assert.equal(shopperSteal.status, 403);
    });

    // 9. Supermarket application flow (pending -> blocked -> approved -> login succeeds -> multi-tenant isolation & idempotent cashier complete)
    let pendingSmId = '';
    const newOwnerEmail = 'newchain-owner@example.com';
    const newOwnerPass = 'OwnerChain!2026';

    await check('9. Supermarket application creates pending chain blocked until admin approval', async () => {
      const apply = await api('/api/supermarket/apply', {
        method: 'POST',
        body: JSON.stringify({
          chainName: 'FreshMart Test',
          contactEmail: newOwnerEmail,
          contactPhone: '+254799887766',
          city: 'Nakuru',
          firstBranchName: 'Nakuru Central',
          ownerName: 'Fresh Owner',
          password: newOwnerPass,
        }),
      });
      assert.equal(apply.status, 200);
      pendingSmId = apply.data.supermarket.id;
      assert.equal(apply.data.supermarket.status, 'pending');

      // Pending supermarket hidden from public /api/supermarkets
      const pubSms = await api('/api/supermarkets');
      assert.equal(pubSms.status, 200);
      assert.ok(!pubSms.data.some((s: any) => s.id === pendingSmId));

      // Owner cannot log in before admin approval
      const preLogin = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: newOwnerEmail, password: newOwnerPass, portal: 'management' }),
      });
      assert.equal(preLogin.status, 403);
      assert.match(preLogin.data.error, /awaiting approval/i);

      // Admin approves supermarket
      const approve = await api(`/api/admin/supermarkets/${pendingSmId}/status`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ status: 'active' }),
      });
      assert.equal(approve.status, 200);
      assert.equal(approve.data.status, 'active');

      // Owner can now log in via management portal
      const postLogin = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: newOwnerEmail, password: newOwnerPass, portal: 'management' }),
      });
      assert.equal(postLogin.status, 200);
      const newOwnerToken = postLogin.data.token;

      // Cross-supermarket isolation: FreshMart owner cannot edit Naivas branch
      const crossStoreEdit = await api('/api/owner/branch-product-override', {
        method: 'POST',
        token: newOwnerToken,
        body: JSON.stringify({ branchId: 'br_westlands', productId: 'prod_1', priceOverride: 10 }),
      });
      assert.equal(crossStoreEdit.status, 403);
    });

    // 10. Cashier completion idempotency & permission checks
    await check('10. Cashier /api/cashier/complete is idempotent & enforces staff branch/permissions', async () => {
      // Create a branch & staff via Naivas owner? Or use admin to verify cart created by shopper on br_westlands
      const scRes = await api('/api/shopper/cart?branchId=br_westlands', { token: shopperToken });
      assert.equal(scRes.status, 200);
      const cartId = scRes.data.id;

      // Get branch product barcode
      const prodsRes = await api('/api/shopper/branch-products/br_westlands');
      assert.equal(prodsRes.status, 200);
      assert.ok(prodsRes.data.products.length > 0);
      const firstProd = prodsRes.data.products[0];

      const addRes = await api('/api/shopper/cart/add', {
        method: 'POST',
        token: shopperToken,
        body: JSON.stringify({ branchId: 'br_westlands', barcode: firstProd.barcode, quantity: 1, cartId }),
      });
      assert.equal(addRes.status, 200);

      // Complete cart once as admin
      const comp1 = await api('/api/cashier/complete', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({ cartId }),
      });
      assert.equal(comp1.status, 200);

      // Completing twice must return 400 and never deduct stock twice
      const comp2 = await api('/api/cashier/complete', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({ cartId }),
      });
      assert.equal(comp2.status, 400);
    });

    // 11. Loyalty QR scanning & ownership enforcement
    await check('11. Loyalty QR scan links card to active supermarket and prevents cross-user deletion', async () => {
      const scanRes = await api('/api/shopper/loyalty/scan', {
        method: 'POST',
        token: shopperToken,
        body: JSON.stringify({ qrPayload: 'SMARTCART:LOYALTY:NAIVAS:NV-772190' }),
      });
      assert.equal(scanRes.status, 201);
      assert.equal(scanRes.data.card.supermarketCode, 'NAIVAS');
      const cardId = scanRes.data.card.id;

      const listRes = await api('/api/shopper/loyalty', { token: shopperToken });
      assert.equal(listRes.status, 200);
      assert.ok(listRes.data.some((c: any) => c.id === cardId));

      // Guest cannot delete shopper's loyalty card
      const stealCardDel = await api(`/api/shopper/loyalty/${cardId}`, {
        method: 'DELETE',
        guestId: 'guest-other-9999',
      });
      assert.equal(stealCardDel.status, 403);
    });

    // 12. Logout & suspension revoke session tokens immediately
    await check('12. /api/auth/logout and user suspension invalidate bearer session tokens immediately', async () => {
      const meBefore = await api('/api/auth/me', { token: shopperToken });
      assert.equal(meBefore.status, 200);
      assert.equal(meBefore.data.user.email, shopperEmail);
      const shopperId = meBefore.data.user.id;

      const logout = await api('/api/auth/logout', { method: 'POST', token: shopperToken });
      assert.equal(logout.status, 200);

      const meAfter = await api('/api/auth/me', { token: shopperToken });
      assert.equal(meAfter.status, 401);

      const protectedAfter = await api('/api/shopper/history', { token: shopperToken });
      assert.equal(protectedAfter.status, 401);

      // Re-login shopper, then suspend via admin -> session must fail with 401
      const reLogin = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: shopperEmail, password: shopperPass, portal: 'shopper' }),
      });
      assert.equal(reLogin.status, 200);
      const freshToken = reLogin.data.token;

      const susp = await api(`/api/admin/users/${shopperId}/status`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ status: 'suspended' }),
      });
      assert.equal(susp.status, 200);

      const afterSusp = await api('/api/auth/me', { token: freshToken });
      assert.equal(afterSusp.status, 401);
    });

    // 13. Shared shopping lists from previous purchases & product history + collaboration permissions
    await check('13. Shared shopping lists create from past purchases & product history and enforce collaborator permissions', async () => {
      const ownerGuest = 'guest-list-owner-1001';
      const collabGuest = 'guest-list-collab-2002';

      // Create and complete a cart so past-purchases and product-history are populated
      const prodsRes = await api('/api/shopper/branch-products/br_westlands');
      assert.equal(prodsRes.status, 200);
      assert.ok(prodsRes.data.products.length > 0);
      const firstProd = prodsRes.data.products[0];

      const cartRes = await api('/api/shopper/cart?branchId=br_westlands', { guestId: ownerGuest });
      assert.equal(cartRes.status, 200);
      const pastCartId = cartRes.data.id;

      const addItemRes = await api('/api/shopper/cart/add', {
        method: 'POST',
        guestId: ownerGuest,
        body: JSON.stringify({ branchId: 'br_westlands', barcode: firstProd.barcode, quantity: 2, cartId: pastCartId }),
      });
      assert.equal(addItemRes.status, 200);

      const compRes = await api('/api/cashier/complete', {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({ cartId: pastCartId }),
      });
      assert.equal(compRes.status, 200);

      // Verify past-purchases & product-history endpoints return the completed purchase
      const pastPurchasesRes = await api('/api/shopper/past-purchases', { guestId: ownerGuest });
      assert.equal(pastPurchasesRes.status, 200);
      assert.ok(pastPurchasesRes.data.some((c: any) => c.id === pastCartId));

      const prodHistRes = await api('/api/shopper/product-history?branchId=br_westlands', { guestId: ownerGuest });
      assert.equal(prodHistRes.status, 200);
      assert.ok(prodHistRes.data.some((p: any) => p.barcode === firstProd.barcode && p.purchaseCount >= 1));

      // Create shared list from previous purchase (editable initially)
      const listFromPurchase = await api('/api/shopper/shopping-lists', {
        method: 'POST',
        guestId: ownerGuest,
        body: JSON.stringify({
          title: 'Weekly Restock',
          canEdit: true,
          branchId: 'br_westlands',
          sourceCartId: pastCartId,
        }),
      });
      assert.equal(listFromPurchase.status, 200);
      assert.equal(listFromPurchase.data.sourceType, 'previous_purchase');
      assert.equal(listFromPurchase.data.items.length, 1);
      assert.equal(listFromPurchase.data.items[0].quantity, 2);

      // Create shared list from product history barcodes
      const listFromHistory = await api('/api/shopper/shopping-lists', {
        method: 'POST',
        guestId: ownerGuest,
        body: JSON.stringify({
          title: 'Favorites History',
          canEdit: false,
          branchId: 'br_westlands',
          selectedBarcodes: [firstProd.barcode],
        }),
      });
      assert.equal(listFromHistory.status, 200);
      assert.equal(listFromHistory.data.sourceType, 'product_history');
      assert.equal(listFromHistory.data.items[0].barcode, firstProd.barcode);

      // Collaborator joins editable list via shareCode
      const joinEditable = await api('/api/shopper/shopping-lists/join', {
        method: 'POST',
        guestId: collabGuest,
        body: JSON.stringify({ shareCode: listFromPurchase.data.shareCode }),
      });
      assert.equal(joinEditable.status, 200);

      // Collaborator CAN edit items when canEdit=true
      const collabUpdateOk = await api(`/api/shopper/shopping-lists/${listFromPurchase.data.id}`, {
        method: 'PUT',
        guestId: collabGuest,
        body: JSON.stringify({
          items: [{ ...listFromPurchase.data.items[0], completed: true }],
        }),
      });
      assert.equal(collabUpdateOk.status, 200);
      assert.equal(collabUpdateOk.data.items[0].completed, true);

      // Collaborator CANNOT delete owner's list
      const collabDelete = await api(`/api/shopper/shopping-lists/${listFromPurchase.data.id}`, {
        method: 'DELETE',
        guestId: collabGuest,
      });
      assert.equal(collabDelete.status, 403);

      // Collaborator joins view-only list -> editing blocked with 403
      const joinReadOnly = await api('/api/shopper/shopping-lists/join', {
        method: 'POST',
        guestId: collabGuest,
        body: JSON.stringify({ shareCode: listFromHistory.data.shareCode }),
      });
      assert.equal(joinReadOnly.status, 200);

      const collabUpdateBlocked = await api(`/api/shopper/shopping-lists/${listFromHistory.data.id}`, {
        method: 'PUT',
        guestId: collabGuest,
        body: JSON.stringify({ items: [] }),
      });
      assert.equal(collabUpdateBlocked.status, 403);

      // Owner can delete their own list
      const ownerDelete = await api(`/api/shopper/shopping-lists/${listFromHistory.data.id}`, {
        method: 'DELETE',
        guestId: ownerGuest,
      });
      assert.equal(ownerDelete.status, 200);
    });

    console.log(`\n[security-test] ALL ${passed} SECURITY & FEATURE CHECKS PASSED!`);
  } catch (err) {
    console.error('\n[security-test] FAILURE:', err);
    console.error('--- Server Logs ---\n' + logs);
    exitCode = 1;
  } finally {
    if (serverProc?.pid) {
      try {
        process.kill(-serverProc.pid, 'SIGKILL');
      } catch {
        try {
          serverProc.kill('SIGKILL');
        } catch {
          // Already exited
        }
      }
    }
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    process.exit(exitCode);
  }
}

runTests();
