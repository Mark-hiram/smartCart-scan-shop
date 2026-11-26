// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smartcart-support-reset-test-'));
const ADMIN_SETUP_KEY = `TestAdminSetupKey_${crypto.randomBytes(12).toString('hex')}`;
const makeTestSecret = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString('hex')}!9`;

const activeProcs: ChildProcess[] = [];

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

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Could not acquire free port'));
        return;
      }
      const p = addr.port;
      srv.close(() => resolve(p));
    });
  });
}

async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch {
      // Server still booting
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function api(
  baseUrl: string,
  pathname: string,
  options: Omit<RequestInit, 'headers'> & {
    token?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  const res = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON
  }
  return { status: res.status, data };
}

function startServer(port: number, dbPath: string, logs: { stdout: string; stderr: string }) {
  const proc = spawn('npx', ['tsx', 'server.ts'], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      DEMO_MODE: 'false',
      TRUST_PROXY: 'true',
      DB_PATH: dbPath,
      ADMIN_SETUP_KEY,
      GEMINI_API_KEY: '',
      EMAIL_PROVIDER: '',
    },
  });

  proc.stdout?.on('data', (d) => {
    logs.stdout += d.toString();
  });
  proc.stderr?.on('data', (d) => {
    logs.stderr += d.toString();
  });
  activeProcs.push(proc);
  return proc;
}

async function runTests() {
  const dbPath = path.join(TMP_DIR, 'smartcart_db.json');
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = { stdout: '', stderr: '' };

  let proc: ChildProcess | null = startServer(port, dbPath, logs);
  await waitForServer(baseUrl);

  const generatedPlaintextPasswords: string[] = [];
  let passed = 0;
  let failed = 0;

  async function check(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      passed += 1;
      console.log(`PASS: ${name}`);
    } catch (err: any) {
      failed += 1;
      console.error(`FAIL: ${name} -> ${err?.message || err}`);
    }
  }

  try {
    // Bootstrap Admin + 2 Supermarkets + Staff + Shopper
    const adminEmail = 'sysadmin@smartcart.test';
    const adminPass = makeTestSecret('AdminPass');
    const setupRes = await api(baseUrl, '/api/admin/setup', {
      method: 'POST',
      body: JSON.stringify({
        email: adminEmail,
        name: 'System Admin One',
        phone: '+254700000001',
        setupKey: ADMIN_SETUP_KEY,
        password: adminPass,
      }),
    });
    assert.equal(setupRes.status, 200);

    const adminLogin = await api(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: adminEmail, password: adminPass, portal: 'admin' }),
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.data.token as string;
    const adminUserId = adminLogin.data.user.id as string;

    // Register Shopper
    const shopperEmail = 'jane.shopper@example.com';
    const shopperPhone = '+254712345601';
    const shopperPass = makeTestSecret('ShopperPass');
    const regShopper = await api(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Jane Wambui',
        email: shopperEmail,
        phone: shopperPhone,
        password: shopperPass,
      }),
    });
    assert.equal(regShopper.status, 200);
    let shopperToken = regShopper.data.token as string;
    const shopperUserId = regShopper.data.user.id as string;

    // Apply & Approve Store A + Owner A + Staff A
    const ownerAEmail = 'owner.alpha@store.com';
    const ownerAPass = makeTestSecret('OwnerAPass');
    const applyA = await api(baseUrl, '/api/supermarket/apply', {
      method: 'POST',
      body: JSON.stringify({
        chainName: 'Alpha Mart',
        ownerName: 'Alpha Owner',
        contactEmail: ownerAEmail,
        contactPhone: '+254722111111',
        city: 'Nairobi',
        firstBranchName: 'Alpha CBD',
        password: ownerAPass,
      }),
    });
    assert.equal(applyA.status, 200);
    const smAId = applyA.data.supermarket.id as string;
    await api(baseUrl, `/api/admin/supermarkets/${smAId}/status`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ status: 'active' }),
    });

    const ownerALogin = await api(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: ownerAEmail, password: ownerAPass, portal: 'management' }),
    });
    assert.equal(ownerALogin.status, 200);
    const ownerAToken = ownerALogin.data.token as string;

    const overviewARes = await api(baseUrl, '/api/owner/overview', { token: ownerAToken });
    assert.equal(overviewARes.status, 200);
    const branchAId = overviewARes.data.branches[0].id as string;

    const staffAEmail = 'cashier.alpha@store.com';
    const staffAPass = makeTestSecret('StaffAPass');
    const createStaffA = await api(baseUrl, '/api/owner/staff', {
      method: 'POST',
      token: ownerAToken,
      body: JSON.stringify({
        name: 'Cashier Alpha',
        email: staffAEmail,
        phone: '+254733111111',
        password: staffAPass,
        branchId: branchAId,
      }),
    });
    assert.equal(createStaffA.status, 200);
    const staffAId = createStaffA.data.id as string;

    const staffALogin = await api(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: staffAEmail, password: staffAPass, portal: 'staff' }),
    });
    assert.equal(staffALogin.status, 200);
    let staffAToken = staffALogin.data.token as string;

    // Apply & Approve Store B + Staff B (for cross-store RBAC isolation test)
    const ownerBEmail = 'owner.beta@store.com';
    const ownerBPass = makeTestSecret('OwnerBPass');
    const applyB = await api(baseUrl, '/api/supermarket/apply', {
      method: 'POST',
      body: JSON.stringify({
        chainName: 'Beta Mart',
        ownerName: 'Beta Owner',
        contactEmail: ownerBEmail,
        contactPhone: '+254722222222',
        city: 'Mombasa',
        firstBranchName: 'Beta Coast',
        password: ownerBPass,
      }),
    });
    assert.equal(applyB.status, 200);
    const smBId = applyB.data.supermarket.id as string;
    await api(baseUrl, `/api/admin/supermarkets/${smBId}/status`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ status: 'active' }),
    });
    const ownerBLogin = await api(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: ownerBEmail, password: ownerBPass, portal: 'management' }),
    });
    const ownerBToken = ownerBLogin.data.token as string;
    const overviewBRes = await api(baseUrl, '/api/owner/overview', { token: ownerBToken });
    assert.equal(overviewBRes.status, 200);
    const branchBId = overviewBRes.data.branches[0].id as string;

    const createStaffB = await api(baseUrl, '/api/owner/staff', {
      method: 'POST',
      token: ownerBToken,
      body: JSON.stringify({
        name: 'Cashier Beta',
        email: 'cashier.beta@store.com',
        phone: '+254733222222',
        password: makeTestSecret('StaffBPass'),
        branchId: branchBId,
      }),
    });
    assert.equal(createStaffB.status, 200);
    const staffBId = createStaffB.data.id as string;

    // TEST 1: Anti-enumeration, identical generic response, no code/link, uniform ~200ms timing
    let shopperTicketId = '';
    let adminProbeTicketId = '';
    await check('Anti-enumeration response, zero code/link leak & uniform timing', async () => {
      const t1Start = Date.now();
      const knownRes = await api(baseUrl, '/api/auth/password-reset-request', {
        method: 'POST',
        headers: { 'X-Forwarded-For': '10.10.1.1' },
        body: JSON.stringify({
          identifier: shopperEmail,
          fullName: 'Jane Wambui',
          note: 'Last shopped at Alpha Mart CBD',
          portal: 'shopper',
        }),
      });
      const t1 = Date.now() - t1Start;

      const t2Start = Date.now();
      const unknownRes = await api(baseUrl, '/api/auth/password-reset-request', {
        method: 'POST',
        headers: { 'X-Forwarded-For': '10.10.1.2' },
        body: JSON.stringify({
          identifier: 'nobody.nonexistent@example.com',
          fullName: 'Unknown Person',
          note: 'Forgot email',
          portal: 'shopper',
        }),
      });
      const t2 = Date.now() - t2Start;

      const adminProbeRes = await api(baseUrl, '/api/auth/password-reset-request', {
        method: 'POST',
        headers: { 'X-Forwarded-For': '10.10.1.3' },
        body: JSON.stringify({
          identifier: adminEmail,
          fullName: 'Trying Admin Reset',
          note: 'Attempt admin probe',
          portal: 'management',
        }),
      });

      assert.equal(knownRes.status, 200);
      assert.equal(unknownRes.status, 200);
      assert.equal(adminProbeRes.status, 200);
      assert.equal(knownRes.data.message, 'If we find your account, support will contact you shortly.');
      assert.equal(unknownRes.data.message, knownRes.data.message);
      assert.equal(adminProbeRes.data.message, knownRes.data.message);
      assert.equal(knownRes.data.code, undefined);
      assert.equal(knownRes.data.resetLink, undefined);
      assert.equal(knownRes.data.matchedAccount, undefined);
      assert.ok(t1 >= 180 && t2 >= 180, `Expected >=180ms timing floor (got ${t1}ms, ${t2}ms)`);
      assert.ok(Math.abs(t1 - t2) < 250, `Timing variance too high (${t1}ms vs ${t2}ms)`);

      const inboxRes = await api(baseUrl, '/api/support?category=password_reset', { token: adminToken });
      assert.equal(inboxRes.status, 200);
      const shopperTicket = inboxRes.data.find(
        (t: any) => t.passwordResetDetails?.requestedIdentifier === shopperEmail
      );
      const adminTicket = inboxRes.data.find(
        (t: any) => t.passwordResetDetails?.requestedIdentifier === adminEmail
      );
      assert.ok(shopperTicket, 'Expected shopper reset ticket in admin inbox');
      assert.ok(adminTicket, 'Expected admin probe ticket in admin inbox');
      shopperTicketId = shopperTicket.id;
      adminProbeTicketId = adminTicket.id;
    });

    // TEST 2: Per-identifier (max 3/hr) and per-IP (max 3/hr) rate limits
    await check('Per-identifier & per-IP rate limits (3/hr)', async () => {
      const targetId = 'ratelimit.target@example.com';
      for (let i = 1; i <= 3; i++) {
        const okRes = await api(baseUrl, '/api/auth/password-reset-request', {
          method: 'POST',
          headers: { 'X-Forwarded-For': `10.20.1.${i}` },
          body: JSON.stringify({ identifier: targetId, fullName: 'Rate Test', portal: 'shopper' }),
        });
        assert.equal(okRes.status, 200);
      }
      const idBlocked = await api(baseUrl, '/api/auth/password-reset-request', {
        method: 'POST',
        headers: { 'X-Forwarded-For': '10.20.1.99' },
        body: JSON.stringify({ identifier: targetId, fullName: 'Rate Test', portal: 'shopper' }),
      });
      assert.equal(idBlocked.status, 429);

      const sharedIp = '10.30.1.50';
      for (let i = 1; i <= 3; i++) {
        const okRes = await api(baseUrl, '/api/auth/password-reset-request', {
          method: 'POST',
          headers: { 'X-Forwarded-For': sharedIp },
          body: JSON.stringify({ identifier: `iptest${i}@example.com`, fullName: 'IP Test', portal: 'shopper' }),
        });
        assert.equal(okRes.status, 200);
      }
      const ipBlocked = await api(baseUrl, '/api/auth/password-reset-request', {
        method: 'POST',
        headers: { 'X-Forwarded-For': sharedIp },
        body: JSON.stringify({ identifier: 'iptest4@example.com', fullName: 'IP Test', portal: 'shopper' }),
      });
      assert.equal(ipBlocked.status, 429);
    });

    // TEST 3: Admin-only visibility, masked contact info, and admin account never matched
    await check('Support inbox admin-only details, masked contacts & admin protection', async () => {
      const shopperInbox = await api(baseUrl, '/api/support', { token: shopperToken });
      assert.equal(shopperInbox.status, 200);
      const leaked = shopperInbox.data.find((t: any) => t.category === 'password_reset');
      assert.equal(leaked, undefined, 'Non-admin must not see password reset inbox tickets');

      const adminInbox = await api(baseUrl, '/api/support?category=password_reset', { token: adminToken });
      const shopperTicket = adminInbox.data.find((t: any) => t.id === shopperTicketId);
      const adminTicket = adminInbox.data.find((t: any) => t.id === adminProbeTicketId);

      assert.equal(shopperTicket.subject, 'Password reset request');
      assert.equal(shopperTicket.status, 'open');
      assert.equal(shopperTicket.passwordResetDetails.matchedAccount, true);
      assert.ok(shopperTicket.passwordResetDetails.maskedEmail.includes('***'));
      assert.notEqual(shopperTicket.passwordResetDetails.maskedEmail, shopperEmail);
      assert.ok(shopperTicket.passwordResetDetails.maskedPhone.includes('*'));
      assert.notEqual(shopperTicket.passwordResetDetails.maskedPhone, shopperPhone);

      assert.equal(adminTicket.passwordResetDetails.matchedAccount, false, 'Admin account must never match reset requests');
      assert.equal(adminTicket.passwordResetDetails.matchedUserId, null);
    });

    // TEST 4: Identity verification checklist required & Reject workflow with reason
    await check('Identity check requirement & reject with reason workflow', async () => {
      const uncheckedGen = await api(baseUrl, `/api/support/${shopperTicketId}/generate-temp-password`, {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({}),
      });
      assert.equal(uncheckedGen.status, 400);

      const emptyReject = await api(baseUrl, `/api/support/${adminProbeTicketId}/reject`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ reason: '' }),
      });
      assert.equal(emptyReject.status, 400);

      const validReject = await api(baseUrl, `/api/support/${adminProbeTicketId}/reject`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ reason: 'Account belongs to platform administrator or could not be verified.' }),
      });
      assert.equal(validReject.status, 200);
      assert.equal(validReject.data.ticket.status, 'rejected');

      const afterRejectGen = await api(baseUrl, `/api/support/${adminProbeTicketId}/generate-temp-password`, {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({ phoneConfirmed: true, lastPurchaseOrPointsConfirmed: true }),
      });
      assert.equal(afterRejectGen.status, 400);
    });

    // TEST 5: RBAC separation (only admin resets shoppers/owners; owner resets ONLY own staff; nobody resets admin)
    let staffTempPass = '';
    await check('RBAC isolation across shopper, owner, staff, and admin', async () => {
      const verifyReq = await api(baseUrl, `/api/support/${shopperTicketId}/verify-identity`, {
        method: 'PUT',
        token: adminToken,
        body: JSON.stringify({ phoneConfirmed: true, lastPurchaseOrPointsConfirmed: true }),
      });
      assert.equal(verifyReq.status, 200);
      assert.equal(verifyReq.data.status, 'verified');

      // Owner cannot use admin support temp-password endpoint
      const ownerOnSupport = await api(baseUrl, `/api/support/${shopperTicketId}/generate-temp-password`, {
        method: 'POST',
        token: ownerAToken,
        body: JSON.stringify({ phoneConfirmed: true, lastPurchaseOrPointsConfirmed: true }),
      });
      assert.equal(ownerOnSupport.status, 403);

      // Owner A cannot reset Staff B (another supermarket)
      const crossChain = await api(baseUrl, `/api/owner/staff/${staffBId}/temp-password`, {
        method: 'POST',
        token: ownerAToken,
      });
      assert.equal(crossChain.status, 403);

      // Owner A cannot reset Shopper or Admin
      const ownerOnShopper = await api(baseUrl, `/api/owner/staff/${shopperUserId}/temp-password`, {
        method: 'POST',
        token: ownerAToken,
      });
      assert.equal(ownerOnShopper.status, 403);

      const ownerOnAdmin = await api(baseUrl, `/api/owner/staff/${adminUserId}/temp-password`, {
        method: 'POST',
        token: ownerAToken,
      });
      assert.equal(ownerOnAdmin.status, 403);

      const adminOnAdmin = await api(baseUrl, `/api/owner/staff/${adminUserId}/temp-password`, {
        method: 'POST',
        token: adminToken,
      });
      assert.equal(adminOnAdmin.status, 403);

      // Owner A CAN reset own Staff A
      const ownerOnOwnStaff = await api(baseUrl, `/api/owner/staff/${staffAId}/temp-password`, {
        method: 'POST',
        token: ownerAToken,
      });
      assert.equal(ownerOnOwnStaff.status, 200);
      assert.ok(typeof ownerOnOwnStaff.data.tempPassword === 'string' && ownerOnOwnStaff.data.tempPassword.length >= 12);
      staffTempPass = ownerOnOwnStaff.data.tempPassword;
      generatedPlaintextPasswords.push(staffTempPass);

      // Staff A's prior session was immediately ended
      const oldStaffSession = await api(baseUrl, '/api/auth/me', { token: staffAToken });
      assert.equal(oldStaffSession.status, 401);
    });

    // TEST 6: Single-use 24h temp password, session termination & forced password change on sign-in
    let shopperTempPass = '';
    const newShopperPass = makeTestSecret('NewShopperPass');
    await check('Temp password length >= 12, session revocation, single-use, and forced password change', async () => {
      const genRes = await api(baseUrl, `/api/support/${shopperTicketId}/generate-temp-password`, {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({ phoneConfirmed: true, lastPurchaseOrPointsConfirmed: true }),
      });
      assert.equal(genRes.status, 200);
      assert.equal(genRes.data.ticket.status, 'completed');
      shopperTempPass = genRes.data.tempPassword;
      generatedPlaintextPasswords.push(shopperTempPass);
      assert.ok(shopperTempPass.length >= 12, `Temp password length must be >= 12, got ${shopperTempPass.length}`);
      assert.ok(genRes.data.expiresAt > Date.now() + 23 * 60 * 60 * 1000, 'Expected ~24h expiration');

      // Re-generating on completed request fails
      const secondGen = await api(baseUrl, `/api/support/${shopperTicketId}/generate-temp-password`, {
        method: 'POST',
        token: adminToken,
        body: JSON.stringify({ phoneConfirmed: true, lastPurchaseOrPointsConfirmed: true }),
      });
      assert.equal(secondGen.status, 400);

      // Old shopper session terminated
      const oldSessionCheck = await api(baseUrl, '/api/auth/me', { token: shopperToken });
      assert.equal(oldSessionCheck.status, 401);

      // Old password no longer works
      const oldPassLogin = await api(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: shopperEmail, password: shopperPass, portal: 'shopper' }),
      });
      assert.equal(oldPassLogin.status, 401);

      // First login with temp password works & flags mustChangePassword
      const tempLogin1 = await api(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: shopperEmail, password: shopperTempPass, portal: 'shopper' }),
      });
      assert.equal(tempLogin1.status, 200);
      assert.equal(tempLogin1.data.user.mustChangePassword, true);
      shopperToken = tempLogin1.data.token;

      // Second login with same temp password is rejected (works once!)
      const tempLogin2 = await api(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: shopperEmail, password: shopperTempPass, portal: 'shopper' }),
      });
      assert.equal(tempLogin2.status, 401);

      // API access blocked until forced password change completes
      const blockedReceipts = await api(baseUrl, '/api/shopper/receipts', { token: shopperToken });
      assert.equal(blockedReceipts.status, 403);
      assert.equal(blockedReceipts.data.mustChangePassword, true);

      // Complete forced password change
      const changeRes = await api(baseUrl, '/api/auth/change-required-password', {
        method: 'POST',
        token: shopperToken,
        body: JSON.stringify({ currentPassword: shopperTempPass, newPassword: newShopperPass }),
      });
      assert.equal(changeRes.status, 200);
      assert.equal(changeRes.data.user.mustChangePassword, false);

      // Protected route now works
      const allowedReceipts = await api(baseUrl, '/api/shopper/receipts', { token: shopperToken });
      assert.equal(allowedReceipts.status, 200);

      // Re-login with new permanent password succeeds
      const finalLogin = await api(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: shopperEmail, password: newShopperPass, portal: 'shopper' }),
      });
      assert.equal(finalLogin.status, 200);
      assert.equal(finalLogin.data.user.mustChangePassword, false);
    });

    // TEST 7: 24-hour expiration enforced on expired temp password
    await check('Expired temporary password (after 24 hours) rejected', async () => {
      // Shut down server briefly, expire staffA's unused temp password in DB, restart server cleanly
      killProc(proc);
      proc = null;

      const raw = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      const staffUser = raw.users.find((u: any) => u.id === staffAId);
      assert.ok(staffUser, 'Expected staff user in DB');
      staffUser.tempPasswordExpiresAt = Date.now() - 60_000;
      fs.writeFileSync(dbPath, JSON.stringify(raw, null, 2));

      proc = startServer(port, dbPath, logs);
      await waitForServer(baseUrl);

      const expiredLogin = await api(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: staffAEmail, password: staffTempPass, portal: 'staff' }),
      });
      assert.equal(expiredLogin.status, 401);
      assert.match(String(expiredLogin.data.error || ''), /expired/i);

      // Re-authenticate admin to inspect audit logs
      const adminRelogin = await api(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: adminEmail, password: adminPass, portal: 'admin' }),
      });
      assert.equal(adminRelogin.status, 200);
      const freshAdminToken = adminRelogin.data.token as string;

      // TEST 8 check inside: audit logs exist and NO plaintext temp password anywhere
      const auditRes = await api(baseUrl, '/api/audit-logs', { token: freshAdminToken });
      assert.equal(auditRes.status, 200);
      const resetAudit = auditRes.data.find((l: any) => l.action === 'PASSWORD_RESET_TEMP_GENERATED');
      const staffAudit = auditRes.data.find((l: any) => l.action === 'STAFF_TEMP_PASSWORD_GENERATED');
      assert.ok(resetAudit && resetAudit.details.includes('System Admin One'), 'Audit log missing admin identity/when');
      assert.ok(staffAudit && staffAudit.details.includes('Alpha Owner'), 'Audit log missing owner identity/when');

      const dbText = fs.readFileSync(dbPath, 'utf-8');
      const auditJson = JSON.stringify(auditRes.data);
      for (const secret of generatedPlaintextPasswords) {
        assert.ok(!dbText.includes(secret), 'Plaintext temp password leaked into DB file');
        assert.ok(!auditJson.includes(secret), 'Plaintext temp password leaked into audit logs');
        assert.ok(!logs.stdout.includes(secret), 'Plaintext temp password leaked into stdout logs');
        assert.ok(!logs.stderr.includes(secret), 'Plaintext temp password leaked into stderr logs');
      }
      console.log('PASS: Zero plaintext temporary passwords in DB, audit logs, or server logs');
      passed += 1;
    });
  } finally {
    killProc(proc);
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('FAIL: Unexpected test runner error:', err);
  for (const p of activeProcs) killProc(p);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  process.exit(1);
});
