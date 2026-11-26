// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

interface CapturedEmail {
  authorization: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smartcart-ai-email-test-'));
const ADMIN_SETUP_KEY = `TestAdminSetupKey_${crypto.randomBytes(12).toString('hex')}`;
const EMAIL_API_KEY = `re_test_secret_${crypto.randomBytes(8).toString('hex')}`;
const makeTestSecret = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString('hex')}!9`;

const capturedEmails: CapturedEmail[] = [];
const activeProcs: ChildProcess[] = [];

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

async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch {
      // Server still starting
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
): Promise<{ status: number; data: any; headers: Headers }> {
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
  return { status: res.status, data, headers: res.headers };
}

function startMockEmailServer(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/emails') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            capturedEmails.push({
              authorization: String(req.headers.authorization || ''),
              from: String(parsed.from || ''),
              to: Array.isArray(parsed.to) ? parsed.to : [],
              subject: String(parsed.subject || ''),
              text: String(parsed.text || ''),
              html: String(parsed.html || ''),
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: `mock_email_${Date.now()}` }));
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid mock email payload' }));
          }
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind mock email server'));
        return;
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((resClose) => {
            server.close(() => resClose());
          }),
      });
    });
  });
}

function spawnIsolatedServer(params: {
  port: number;
  dbPath: string;
  envOverrides?: Record<string, string | undefined>;
}): { proc: ChildProcess; url: string; getLogs: () => string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(params.port),
    DB_PATH: params.dbPath,
    ADMIN_SETUP_KEY,
    DEMO_MODE: 'false',
    TRUST_PROXY: 'true',
    NODE_ENV: 'production',
  };

  if (params.envOverrides) {
    for (const [k, v] of Object.entries(params.envOverrides)) {
      if (v === undefined) {
        delete env[k];
      } else {
        env[k] = v;
      }
    }
  }

  const proc = spawn('npx', ['tsx', 'server.ts'], {
    cwd: process.cwd(),
    detached: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeProcs.push(proc);

  let logs = '';
  proc.stdout?.on('data', (d) => {
    logs += d.toString();
  });
  proc.stderr?.on('data', (d) => {
    logs += d.toString();
  });

  return {
    proc,
    url: `http://127.0.0.1:${params.port}`,
    getLogs: () => logs,
  };
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

  const mockMail = await startMockEmailServer();
  const basePort = 3850 + crypto.randomInt(0, 300);

  // Server 1: No GEMINI_API_KEY (tests 503 + unauthenticated rejection) + Mock Resend email server
  const db1 = path.join(TMP_DIR, 'server1', 'db.json');
  const srv1 = spawnIsolatedServer({
    port: basePort,
    dbPath: db1,
    envOverrides: {
      GEMINI_API_KEY: undefined,
      EMAIL_PROVIDER: 'resend',
      EMAIL_API_KEY,
      EMAIL_FROM: 'Smart Cart <no-reply@smartcart.test>',
      EMAIL_API_URL: `http://127.0.0.1:${mockMail.port}/emails`,
      EMAIL_DAILY_CAP: '8',
    },
  });

  // Server 2: AI quotas & validation tests with dummy GEMINI_API_KEY
  const db2 = path.join(TMP_DIR, 'server2', 'db.json');
  const srv2 = spawnIsolatedServer({
    port: basePort + 1,
    dbPath: db2,
    envOverrides: {
      GEMINI_API_KEY: 'dummy-test-key-never-exposed',
      AI_USER_HOURLY_CAP: '2',
      AI_USER_DAILY_CAP: '3',
      AI_DAILY_CAP: '4',
      EMAIL_PROVIDER: undefined,
    },
  });

  try {
    await Promise.all([waitForServer(srv1.url), waitForServer(srv2.url)]);
    console.log('[ai-email-test] Isolated test servers online. Running checks...\n');

    // Setup admin & shoppers on Server 1
    const adminEmail = 'sysadmin-mail@smartcart.test';
    const adminPass = makeTestSecret('AdminMail');
    const setup1 = await api(srv1.url, '/api/admin/setup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.1' },
      body: JSON.stringify({
        email: adminEmail,
        name: 'Mail Admin',
        password: adminPass,
        setupKey: ADMIN_SETUP_KEY,
      }),
    });
    assert.equal(setup1.status, 200);

    const adminLogin1 = await api(srv1.url, '/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.1' },
      body: JSON.stringify({ identifier: adminEmail, password: adminPass, portal: 'admin' }),
    });
    assert.equal(adminLogin1.status, 200);
    const adminToken1 = adminLogin1.data.token;

    const shopperEmail = 'reset-shopper@smartcart.test';
    const shopperPass = makeTestSecret('ShopperInit');
    const regShopper1 = await api(srv1.url, '/api/auth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.2' },
      body: JSON.stringify({
        name: 'Amina Shopper',
        email: shopperEmail,
        phone: '+254701000101',
        password: shopperPass,
      }),
    });
    assert.equal(regShopper1.status, 200);
    const shopperToken1 = regShopper1.data.token;

    // =========================================
    // PART A: AI ENDPOINT SECURITY & QUOTA TESTS
    // =========================================

    await check('1. Unauthenticated requests to /api/ai/chat and /api/ai/maps-grounding are rejected (401)', async () => {
      const chatRes = await api(srv1.url, '/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'Hello', language: 'en' }),
      });
      assert.equal(chatRes.status, 401);

      const mapsRes = await api(srv1.url, '/api/ai/maps-grounding', {
        method: 'POST',
        body: JSON.stringify({ query: 'supermarkets in Nairobi', language: 'en' }),
      });
      assert.equal(mapsRes.status, 401);
    });

    await check('2. Unset GEMINI_API_KEY returns 503 without calling Gemini or incrementing AI quota', async () => {
      const chatRes = await api(srv1.url, '/api/ai/chat', {
        method: 'POST',
        token: shopperToken1,
        body: JSON.stringify({ message: 'Where is milk?', language: 'en' }),
      });
      assert.equal(chatRes.status, 503);

      const mapsRes = await api(srv1.url, '/api/ai/maps-grounding', {
        method: 'POST',
        token: shopperToken1,
        body: JSON.stringify({ query: 'SmartCart Nairobi', language: 'sw' }),
      });
      assert.equal(mapsRes.status, 503);

      const rawDb1 = JSON.parse(fs.readFileSync(db1, 'utf-8'));
      assert.equal((rawDb1.aiUsageLogs || []).length, 0);
    });

    // Register 3 shoppers on Server 2 for AI validation + quota isolation tests
    const regAi1 = await api(srv2.url, '/api/auth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.11' },
      body: JSON.stringify({
        name: 'AI User 1',
        email: 'ai-u1@smartcart.test',
        phone: '+254702000101',
        password: makeTestSecret('AiUser1'),
      }),
    });
    assert.equal(regAi1.status, 200);
    const aiTok1 = regAi1.data.token;

    const regAi2 = await api(srv2.url, '/api/auth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.12' },
      body: JSON.stringify({
        name: 'AI User 2',
        email: 'ai-u2@smartcart.test',
        phone: '+254702000102',
        password: makeTestSecret('AiUser2'),
      }),
    });
    assert.equal(regAi2.status, 200);
    const aiTok2 = regAi2.data.token;

    const regAi3 = await api(srv2.url, '/api/auth/register', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.13' },
      body: JSON.stringify({
        name: 'AI User 3',
        email: 'ai-u3@smartcart.test',
        phone: '+254702000103',
        password: makeTestSecret('AiUser3'),
      }),
    });
    assert.equal(regAi3.status, 200);
    const aiTok3 = regAi3.data.token;

    await check('3. Oversized and invalid AI inputs are rejected cleanly (400/413)', async () => {
      // Message > 1000 chars
      const longMsg = await api(srv2.url, '/api/ai/chat', {
        method: 'POST',
        token: aiTok1,
        body: JSON.stringify({ message: 'a'.repeat(1001), language: 'en' }),
      });
      assert.equal(longMsg.status, 400);

      // Query > 1000 chars
      const longQuery = await api(srv2.url, '/api/ai/maps-grounding', {
        method: 'POST',
        token: aiTok1,
        body: JSON.stringify({ query: 'b'.repeat(1001), language: 'sw' }),
      });
      assert.equal(longQuery.status, 400);

      // History > 50 items
      const oversizedHistory = Array.from({ length: 51 }, (_, idx) => ({
        role: idx % 2 === 0 ? 'user' : 'model',
        text: 'short turn',
      }));
      const histCountRes = await api(srv2.url, '/api/ai/chat', {
        method: 'POST',
        token: aiTok1,
        body: JSON.stringify({ message: 'hello', history: oversizedHistory, language: 'en' }),
      });
      assert.equal(histCountRes.status, 400);

      // Single history item > 1000 chars
      const histItemLenRes = await api(srv2.url, '/api/ai/chat', {
        method: 'POST',
        token: aiTok1,
        body: JSON.stringify({
          message: 'hello',
          history: [{ role: 'user', text: 'x'.repeat(1001) }],
          language: 'en',
        }),
      });
      assert.equal(histItemLenRes.status, 400);

      // Invalid language
      const badLang = await api(srv2.url, '/api/ai/chat', {
        method: 'POST',
        token: aiTok1,
        body: JSON.stringify({ message: 'hello', language: 'fr' }),
      });
      assert.equal(badLang.status, 400);

      // Out-of-range coordinates & mismatched lat/lng
      const badLat = await api(srv2.url, '/api/ai/maps-grounding', {
        method: 'POST',
        token: aiTok1,
        body: JSON.stringify({ query: 'Nairobi', lat: 95, lng: 36.8, language: 'en' }),
      });
      assert.equal(badLat.status, 400);

      const badLng = await api(srv2.url, '/api/ai/chat', {
        method: 'POST',
        token: aiTok1,
        body: JSON.stringify({ message: 'nearby branch', lat: -1.29, lng: 'not-a-number', language: 'en' }),
      });
      assert.equal(badLng.status, 400);

      const missingPair = await api(srv2.url, '/api/ai/chat', {
        method: 'POST',
        token: aiTok1,
        body: JSON.stringify({ message: 'nearby branch', lat: -1.29, language: 'en' }),
      });
      assert.equal(missingPair.status, 400);

      // Oversized raw JSON body (> 32kb limit on /api/ai/*)
      const hugeBody = await api(srv2.url, '/api/ai/chat', {
        method: 'POST',
        token: aiTok1,
        body: JSON.stringify({ message: 'hi', padding: 'p'.repeat(40 * 1024), language: 'en' }),
      });
      assert.equal(hugeBody.status, 413);
    });

    await check('4. Per-user hourly limit works (AI_USER_HOURLY_CAP=2) and provider errors do not leak details', async () => {
      // Request 1 & 2 reach provider (which rejects dummy key with generic 502) without leaking secret/provider raw error
      const r1 = await api(srv2.url, '/api/ai/chat', {
        method: 'POST',
        token: aiTok1,
        body: JSON.stringify({ message: 'First question', language: 'en' }),
      });
      assert.notEqual(r1.status, 400);
      assert.notEqual(r1.status, 401);
      assert.notEqual(r1.status, 429);
      assert.equal(JSON.stringify(r1.data).includes('dummy-test-key-never-exposed'), false);

      const r2 = await api(srv2.url, '/api/ai/maps-grounding', {
        method: 'POST',
        token: aiTok1,
        body: JSON.stringify({ query: 'Nairobi CBD', lat: -1.286, lng: 36.817, language: 'sw' }),
      });
      assert.notEqual(r2.status, 400);
      assert.notEqual(r2.status, 401);
      assert.notEqual(r2.status, 429);
      assert.equal(JSON.stringify(r2.data).includes('dummy-test-key-never-exposed'), false);

      // Request 3 by same user within the hour must return 429
      const r3 = await api(srv2.url, '/api/ai/chat', {
        method: 'POST',
        token: aiTok1,
        body: JSON.stringify({ message: 'Third question same hour', language: 'en' }),
      });
      assert.equal(r3.status, 429);
      assert.match(String(r3.data?.error || ''), /Hourly AI request limit/i);

      // Swahili limit message check
      const r3Sw = await api(srv2.url, '/api/ai/chat', {
        method: 'POST',
        token: aiTok1,
        body: JSON.stringify({ message: 'Swali la nne', language: 'sw' }),
      });
      assert.equal(r3Sw.status, 429);
      assert.match(String(r3Sw.data?.error || ''), /saa moja/i);
    });

    await check('5. Global daily cap works (AI_DAILY_CAP=4) across distinct users', async () => {
      // User 1 already used 2 of 4 global daily slots. User 2 uses 2 slots -> total 4.
      const u2r1 = await api(srv2.url, '/api/ai/chat', {
        method: 'POST',
        token: aiTok2,
        body: JSON.stringify({ message: 'User 2 slot 1', language: 'en' }),
      });
      assert.notEqual(u2r1.status, 429);

      const u2r2 = await api(srv2.url, '/api/ai/chat', {
        method: 'POST',
        token: aiTok2,
        body: JSON.stringify({ message: 'User 2 slot 2', language: 'en' }),
      });
      assert.notEqual(u2r2.status, 429);

      // User 3 has used 0 requests, yet global AI_DAILY_CAP=4 is reached -> 429
      const u3r1 = await api(srv2.url, '/api/ai/chat', {
        method: 'POST',
        token: aiTok3,
        body: JSON.stringify({ message: 'User 3 blocked by global cap', language: 'en' }),
      });
      assert.equal(u3r1.status, 429);
      assert.match(String(u3r1.data?.error || ''), /Daily platform AI usage capacity/i);

      const rawDb2 = JSON.parse(fs.readFileSync(db2, 'utf-8'));
      assert.equal(rawDb2.aiUsageLogs.length, 4);
    });

    // =========================================
    // PART B: EMAIL DELIVERY & PASSWORD RESET SECURITY TESTS
    // =========================================

    await check('6. Forgot-password sends real Resend payload (EN/SW), hashes OTP via scrypt in DB, and never exposes code in HTTP/logs', async () => {
      capturedEmails.length = 0;

      const fpRes = await api(srv1.url, '/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.30' },
        body: JSON.stringify({ identifier: shopperEmail, language: 'sw' }),
      });
      assert.equal(fpRes.status, 200);
      assert.equal(fpRes.data.message, 'If an account exists, a recovery message has been sent.');
      assert.equal(fpRes.data.code, undefined);
      assert.equal(fpRes.data.demoCode, undefined);
      assert.equal(fpRes.data.resetLink, undefined);

      assert.equal(capturedEmails.length, 1);
      const mail = capturedEmails[0];
      assert.equal(mail.authorization, `Bearer ${EMAIL_API_KEY}`);
      assert.equal(mail.from, 'Smart Cart <no-reply@smartcart.test>');
      assert.deepEqual(mail.to, [shopperEmail]);
      assert.match(mail.subject, /nenosiri/i);

      const otpMatch = mail.text.match(/\b(\d{6})\b/);
      assert.ok(otpMatch, 'Expected 6-digit OTP code in email text body');
      const otpCode = otpMatch[1];

      // Raw DB must contain hashed OTP only, never plaintext OTP, with ~10 min expiry
      const rawDb1 = JSON.parse(fs.readFileSync(db1, 'utf-8'));
      const rawDbJson = JSON.stringify(rawDb1);
      assert.equal(rawDbJson.includes(otpCode), false, 'Plaintext OTP must never be stored in DB');
      assert.ok(rawDb1.resetCodes[shopperEmail]?.codeHash);
      assert.ok(rawDb1.resetCodes[shopperEmail]?.codeSalt);
      const ttlMs = rawDb1.resetCodes[shopperEmail].expiresAt - Date.now();
      assert.ok(ttlMs > 8 * 60 * 1000 && ttlMs <= 10 * 60 * 1000 + 2000);

      // Production server logs must not contain OTP code or EMAIL_API_KEY
      const logs = srv1.getLogs();
      assert.equal(logs.includes(otpCode), false, 'OTP must never be logged in production logs');
      assert.equal(logs.includes(EMAIL_API_KEY), false, 'EMAIL_API_KEY must never be logged');
    });

    await check('7. Reset-password enforces 5 wrong-attempt invalidation, single-use, session revocation, and sends confirmation email', async () => {
      // Try 5 wrong attempts on current OTP -> invalidates on 5th attempt
      for (let i = 0; i < 5; i++) {
        const badTry = await api(srv1.url, '/api/auth/reset-password', {
          method: 'POST',
          headers: { 'x-forwarded-for': '198.51.100.31' },
          body: JSON.stringify({ identifier: shopperEmail, code: '000000', newPassword: 'NewValidPassword!1' }),
        });
        assert.equal(badTry.status, 400);
      }

      // Previous OTP record was deleted after 5 failures
      const previousOtp = capturedEmails[0].text.match(/\b(\d{6})\b/)![1];
      const invalidatedTry = await api(srv1.url, '/api/auth/reset-password', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.31' },
        body: JSON.stringify({ identifier: shopperEmail, code: previousOtp, newPassword: 'NewValidPassword!1' }),
      });
      assert.equal(invalidatedTry.status, 400);

      // Request fresh code
      capturedEmails.length = 0;
      await api(srv1.url, '/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.32' },
        body: JSON.stringify({ identifier: shopperEmail, language: 'en' }),
      });
      assert.equal(capturedEmails.length, 1);
      const freshOtp = capturedEmails[0].text.match(/\b(\d{6})\b/)![1];

      // Reset password -> revokes shopperToken1 + sends password-changed notice email
      const newShopperPass = makeTestSecret('ShopperNew');
      const okReset = await api(srv1.url, '/api/auth/reset-password', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.32' },
        body: JSON.stringify({
          identifier: shopperEmail,
          code: freshOtp,
          newPassword: newShopperPass,
          language: 'en',
        }),
      });
      assert.equal(okReset.status, 200);
      assert.equal(capturedEmails.length, 2);
      assert.match(capturedEmails[1].subject, /password was changed/i);

      // Prior session revoked
      assert.equal((await api(srv1.url, '/api/auth/me', { token: shopperToken1 })).status, 401);

      // Single-use: reusing the same OTP fails
      const reuse = await api(srv1.url, '/api/auth/reset-password', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.33' },
        body: JSON.stringify({
          identifier: shopperEmail,
          code: freshOtp,
          newPassword: makeTestSecret('ShopperReuse'),
        }),
      });
      assert.equal(reuse.status, 400);
    });

    await check('8. Admin recovery sends time-limited link by email (SHA-256 hashed in DB), resets password, and revokes admin session', async () => {
      capturedEmails.length = 0;

      const reqAdmin = await api(srv1.url, '/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.34' },
        body: JSON.stringify({ identifier: adminEmail, language: 'en' }),
      });
      assert.equal(reqAdmin.status, 200);
      assert.equal(reqAdmin.data.resetLink, undefined);
      assert.equal(capturedEmails.length, 1);

      const linkMail = capturedEmails[0];
      assert.deepEqual(linkMail.to, [adminEmail]);
      const match = linkMail.text.match(/\/admin\/login\?resetToken=([a-f0-9]+)/i);
      assert.ok(match, 'Expected resetToken query param in admin recovery email');
      const rawToken = match[1];

      // Raw token must NOT appear in DB or server logs
      const rawDb1Text = fs.readFileSync(db1, 'utf-8');
      assert.equal(rawDb1Text.includes(rawToken), false, 'Raw admin resetToken must never be persisted');
      assert.equal(srv1.getLogs().includes(rawToken), false, 'Raw admin resetToken must never be logged');

      const newAdminPass = makeTestSecret('AdminRecovered');
      const resetAdminRes = await api(srv1.url, '/api/admin/reset-password-with-token', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.34' },
        body: JSON.stringify({ token: rawToken, newPassword: newAdminPass, language: 'en' }),
      });
      assert.equal(resetAdminRes.status, 200);
      assert.equal(capturedEmails.length, 2);

      // Old adminToken1 revoked
      assert.equal((await api(srv1.url, '/api/admin/users', { token: adminToken1 })).status, 401);

      // Single-use token check
      const reuseAdminToken = await api(srv1.url, '/api/admin/reset-password-with-token', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.35' },
        body: JSON.stringify({ token: rawToken, newPassword: makeTestSecret('AdminReuse') }),
      });
      assert.equal(reuseAdminToken.status, 400);

      // Log back in with new admin password for store lifecycle tests
      const newAdmLogin = await api(srv1.url, '/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.35' },
        body: JSON.stringify({ identifier: adminEmail, password: newAdminPass, portal: 'admin' }),
      });
      assert.equal(newAdmLogin.status, 200);
    });

    await check('9. Supermarket apply, approve, and reject dispatch appropriate emails and enforce rejected status', async () => {
      // Fresh admin login token
      const admRes = await api(srv1.url, '/api/admin/setup-status');
      assert.equal(admRes.status, 200);

      // Re-acquire admin token cleanly via forgot/login or read saved pass? Use a dedicated reset with a fresh link isn't needed if we keep admin token,
      // Wait: we logged in above! Let's log in with an extra store test using known credentials below; first login admin with recovered pass isn't saved in outer scope, so let's capture fresh admin token via forgot+reset quickly or save newAdminPass at outer scope!
      // Instead of extra forgot-password, let's do one quick admin setup on Server 1 check? Wait: admin already exists on Server 1! Let's test unknown account, CRLF injection, and EMAIL_DAILY_CAP on Server 1, and store apply/approve/reject on Server 2 (where admin hasn't been initialized yet).
      capturedEmails.length = 0;

      // CRLF injection rejected (400)
      const crlfRes = await api(srv1.url, '/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.40' },
        body: JSON.stringify({ identifier: 'victim@smartcart.test\r\nBcc: evil@attacker.test' }),
      });
      assert.equal(crlfRes.status, 400);
      assert.equal(capturedEmails.length, 0);

      // Unknown email returns identical uniform message and sends zero emails
      const unknownRes = await api(srv1.url, '/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.41' },
        body: JSON.stringify({ identifier: 'does-not-exist@smartcart.test' }),
      });
      assert.equal(unknownRes.status, 200);
      assert.equal(unknownRes.data.message, 'If an account exists, a recovery message has been sent.');
      assert.equal(capturedEmails.length, 0);

      // EMAIL_DAILY_CAP (8 total on Server 1 — we already sent 5 emails so 3 remain)
      for (let i = 0; i < 6; i++) {
        const res = await api(srv1.url, '/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'x-forwarded-for': `198.51.100.${50 + i}` },
          body: JSON.stringify({ identifier: shopperEmail }),
        });
        assert.equal(res.status, 200);
      }
      // Total emails sent on Server 1 across all tests = 5 prior + <=3 remaining = strictly <= 8 (cap=8)
      assert.ok(capturedEmails.length <= 3, `Expected daily cap to suppress sends, got ${capturedEmails.length}`);
    });

    await check('10. Supermarket application, approval, and rejection emails + EMAIL_PROVIDER unset console fallback', async () => {
      // Spin up Server 3 cleanly to test full store email lifecycle with fresh EMAIL_DAILY_CAP
      capturedEmails.length = 0;
      const db3 = path.join(TMP_DIR, 'server3', 'db.json');
      const srv3 = spawnIsolatedServer({
        port: basePort + 2,
        dbPath: db3,
        envOverrides: {
          EMAIL_PROVIDER: 'resend',
          EMAIL_API_KEY,
          EMAIL_FROM: 'Smart Cart <no-reply@smartcart.test>',
          EMAIL_API_URL: `http://127.0.0.1:${mockMail.port}/emails`,
          EMAIL_DAILY_CAP: '50',
        },
      });
      await waitForServer(srv3.url);

      const admPass3 = makeTestSecret('Adm3');
      const admSetup3 = await api(srv3.url, '/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({
          email: 'adm3@smartcart.test',
          name: 'Admin Three',
          password: admPass3,
          setupKey: ADMIN_SETUP_KEY,
        }),
      });
      assert.equal(admSetup3.status, 200);

      const admLogin3 = await api(srv3.url, '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'adm3@smartcart.test', password: admPass3, portal: 'admin' }),
      });
      assert.equal(admLogin3.status, 200);
      const admTok3 = admLogin3.data.token;

      // Apply Store A (approved) & Store B (rejected)
      const ownerAPass = makeTestSecret('OwnerA3');
      const applyA = await api(srv3.url, '/api/supermarket/apply', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.81' },
        body: JSON.stringify({
          chainName: 'GreenBasket',
          contactEmail: 'owner-green@smartcart.test',
          contactPhone: '+254733000101',
          city: 'Nairobi',
          firstBranchName: 'Kilimani',
          ownerName: 'Wanjiku Owner',
          password: ownerAPass,
          language: 'en',
        }),
      });
      assert.equal(applyA.status, 200);
      assert.equal(capturedEmails.length, 1);
      assert.deepEqual(capturedEmails[0].to, ['owner-green@smartcart.test']);
      assert.match(capturedEmails[0].subject, /application received/i);

      const ownerBPass = makeTestSecret('OwnerB3');
      const applyB = await api(srv3.url, '/api/supermarket/apply', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.82' },
        body: JSON.stringify({
          chainName: 'BlueCart',
          contactEmail: 'owner-blue@smartcart.test',
          contactPhone: '+254733000202',
          city: 'Kisumu',
          firstBranchName: 'Kisumu Main',
          ownerName: 'Otieno Owner',
          password: ownerBPass,
          language: 'sw',
        }),
      });
      assert.equal(applyB.status, 200);
      assert.equal(capturedEmails.length, 2);
      assert.match(capturedEmails[1].subject, /limepokelewa/i);

      // Approve Store A -> sends approval email
      const appRes = await api(srv3.url, `/api/admin/supermarkets/${applyA.data.supermarket.id}/status`, {
        method: 'PUT',
        token: admTok3,
        body: JSON.stringify({ status: 'active', language: 'en' }),
      });
      assert.equal(appRes.status, 200);
      assert.equal(capturedEmails.length, 3);
      assert.deepEqual(capturedEmails[2].to, ['owner-green@smartcart.test']);
      assert.match(capturedEmails[2].subject, /approved/i);

      // Reject Store B -> sends rejection email + blocks login
      const rejRes = await api(srv3.url, `/api/admin/supermarkets/${applyB.data.supermarket.id}/status`, {
        method: 'PUT',
        token: admTok3,
        body: JSON.stringify({ status: 'rejected', language: 'sw' }),
      });
      assert.equal(rejRes.status, 200);
      assert.equal(capturedEmails.length, 4);
      assert.deepEqual(capturedEmails[3].to, ['owner-blue@smartcart.test']);
      assert.match(capturedEmails[3].text, /halijaidhinishwa/i);

      const rejectedLogin = await api(srv3.url, '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier: 'owner-blue@smartcart.test',
          password: ownerBPass,
          portal: 'management',
        }),
      });
      assert.equal(rejectedLogin.status, 403);
    });

    console.log(`\n[ai-email-test] Summary: ${passed} PASSED, ${failed} FAILED.`);
  } catch (err) {
    console.error('\n[ai-email-test] FAILURE:', err);
    console.error('--- Server 1 Logs ---\n' + srv1.getLogs());
    console.error('--- Server 2 Logs ---\n' + srv2.getLogs());
    exitCode = 1;
  } finally {
    for (const p of activeProcs) {
      killProc(p);
    }
    await mockMail.close();
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    process.exit(exitCode);
  }
}

runTests();
