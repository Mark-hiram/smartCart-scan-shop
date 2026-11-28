// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import {
  db,
  hashPassword,
  verifyPassword,
  createDefaultLoyaltySettings,
  recordScanEvent,
  recordSecurityEvent,
} from './src/server/db';
import {
  getAdminAnalytics,
  buildAnalyticsCsv,
  normalizeAnalyticsRange,
} from './src/server/analytics';
import {
  sendEmail,
  normalizeAndValidateEmail,
  EmailLanguage,
  buildPasswordResetOtpEmail,
  buildAdminResetLinkEmail,
  buildPasswordChangedEmail,
  buildSupermarketApplicationEmail,
  buildSupermarketStatusEmail,
} from './src/server/mailer';
import { validateBarcode } from './src/utils/barcode';
import { GoogleGenAI, Content } from '@google/genai';
import {
  User,
  PortalType,
  Supermarket,
  Cart,
  CartItem,
  Product,
  BranchProduct,
  Promotion,
  AuditLog,
  Branch,
  Announcement,
  SupportTicket,
  PasswordResetRequestDetails,
  ShoppingList,
  LoyaltyTransaction,
  LoyaltyPointsSummary,
  LoyaltySettings,
  LoyaltyLedgerEntry,
  LoyaltyLedgerEntryType,
  RewardItem,
  RewardRedemptionOrder,
  RedemptionStatus,
  StaffPermissions,
  STAFF_PRESETS,
  PriceCheckProductInfo,
  PriceCheckBranchCompareItem,
  PriceCheckResponse,
} from './src/types';
import { computeBudgetSummary, doesProductMatchListItem } from './src/utils/shoppingHelpers';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const PORTAL_BY_ROLE: Record<string, string> = {
  shopper: 'shopper',
  staff: 'staff',
  owner: 'management',
  admin: 'admin',
};

const app = express();
app.use('/api/ai', express.json({ limit: '32kb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Handle oversized request bodies and invalid JSON cleanly (especially strict 32kb cap on /api/ai/*)
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({ error: 'Request payload is too large.' });
  }
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Invalid JSON request body.' });
  }
  next(err);
});

function getAppBaseUrl(req: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  const protoHeader = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const proto = protoHeader.split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || 'localhost:3000').split(',')[0].trim();
  return `${proto}://${host}`;
}

// Health check endpoint for Render / load balancers (unauthenticated, exposes no data)
app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

// Session record interface with sliding inactivity timeout
export interface SessionRecord {
  token: string;
  userId: string;
  portal: string;
  createdAt: number;
  expiresAt: number;
}
const sessions = new Map<string, SessionRecord>();

// Memory store for tracking failed login attempts on all identifiers (existing and non-existing)
interface FailedAttemptRecord {
  count: number;
  lockedUntil: number | null;
}
const memoryFailedAttempts = new Map<string, FailedAttemptRecord>();

// IP Rate Limiting helper
function getClientIp(req: Request): string {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
  }
  return req.socket.remoteAddress || req.ip || 'unknown';
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const ipRateLimits = new Map<string, RateLimitEntry>();

function createIpRateLimiter(maxRequests: number, windowMs: number, keyPrefix: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const entry = ipRateLimits.get(key);

    if (!entry || entry.resetAt <= now) {
      ipRateLimits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= maxRequests) {
      return res.status(429).json({
        error: 'Too many requests from this IP address. Please try again later.',
      });
    }

    entry.count += 1;
    next();
  };
}

// Rate limiters:
// Login: max 30 attempts per 10 minutes per IP
const loginRateLimiter = createIpRateLimiter(30, 10 * 60 * 1000, 'login');
// Sensitive operations: max 10 attempts per hour per IP
const sensitiveOpsRateLimiter = createIpRateLimiter(10, 60 * 60 * 1000, 'sensitive');
// Password reset requests (legacy code/link): max 5 attempts per hour per IP
const forgotPasswordIpRateLimiter = createIpRateLimiter(5, 60 * 60 * 1000, 'forgot_ip');
// Free support-assisted password reset requests: max 3 attempts per hour per IP
const passwordResetRequestIpRateLimiter = createIpRateLimiter(3, 60 * 60 * 1000, 'pw_reset_req_ip');
// Rewards redemption requests: max 12 attempts per 15 minutes per IP
const redemptionRateLimiter = createIpRateLimiter(12, 15 * 60 * 1000, 'redemption');
// Admin analytics endpoints: max 60 requests per 5 minutes per IP
const adminAnalyticsRateLimiter = createIpRateLimiter(60, 5 * 60 * 1000, 'admin_analytics');
// Shopper price check & compare endpoint: max 25 requests per minute per IP
const priceCheckRateLimiter = createIpRateLimiter(25, 60 * 1000, 'price_check');

const TEMP_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;
const PW_RESET_REQ_ONE_HOUR_MS = 60 * 60 * 1000;
const PW_RESET_REQ_PER_IDENTIFIER_LIMIT = 3;
const passwordResetIdentifierTimestamps = new Map<string, number[]>();

function isPasswordResetIdentifierRateLimited(keys: string[]): boolean {
  const now = Date.now();
  for (const key of keys) {
    if (!key) continue;
    const recent = (passwordResetIdentifierTimestamps.get(key) || []).filter(
      (ts) => now - ts < PW_RESET_REQ_ONE_HOUR_MS
    );
    if (recent.length === 0) {
      passwordResetIdentifierTimestamps.delete(key);
    } else {
      passwordResetIdentifierTimestamps.set(key, recent);
      if (recent.length >= PW_RESET_REQ_PER_IDENTIFIER_LIMIT) {
        return true;
      }
    }
  }
  return false;
}

function recordPasswordResetIdentifierAttempt(keys: string[]): void {
  const now = Date.now();
  for (const key of keys) {
    if (!key) continue;
    const recent = (passwordResetIdentifierTimestamps.get(key) || []).filter(
      (ts) => now - ts < PW_RESET_REQ_ONE_HOUR_MS
    );
    recent.push(now);
    passwordResetIdentifierTimestamps.set(key, recent);
  }
}

function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let randomPart = '';
  for (let i = 0; i < 12; i++) {
    randomPart += alphabet[bytes[i] % alphabet.length];
  }
  return `Sc!${randomPart}`; // 15 characters (>= 12 chars)
}

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(5, local.length - 2))}${local[local.length - 1]}@${domain}`;
}

function maskPhone(phone: string): string {
  const clean = phone.trim();
  if (!clean) return '';
  if (clean.length <= 4) return '****';
  const prefixLen = clean.startsWith('+') ? 4 : 2;
  const suffixLen = 3;
  if (clean.length <= prefixLen + suffixLen) {
    return `${clean.slice(0, 2)}***${clean.slice(-2)}`;
  }
  return `${clean.slice(0, prefixLen)}${'*'.repeat(Math.max(3, clean.length - prefixLen - suffixLen))}${clean.slice(-suffixLen)}`;
}

function getSessionDurationMs(portal?: string, role?: string): number {
  if (role === 'admin' || portal === 'admin') {
    return 2 * 60 * 60 * 1000; // 2 hours for admin
  }
  const customHours = process.env.SESSION_HOURS ? parseFloat(process.env.SESSION_HOURS) : 12;
  const hours = isNaN(customHours) || customHours <= 0 ? 12 : customHours;
  return hours * 60 * 60 * 1000;
}

function revokeUserSessions(userId: string) {
  for (const [token, session] of sessions.entries()) {
    if (session.userId === userId) {
      sessions.delete(token);
    }
  }
}

function revokeSupermarketSessions(supermarketId: string) {
  const data = db.getRaw();
  const smUsers = data.users.filter((u) => u.supermarketId === supermarketId);
  const smUserIds = new Set(smUsers.map((u) => u.id));
  for (const [token, session] of sessions.entries()) {
    if (smUserIds.has(session.userId)) {
      sessions.delete(token);
    }
  }
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}
setInterval(cleanupExpiredSessions, 15 * 60 * 1000).unref();

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// Helper to authenticate user from Authorization header
function getAuthUser(req: Request): User | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  const data = db.getRaw();
  const user = data.users.find((u) => u.id === session.userId);
  if (!user || user.status === 'suspended') {
    sessions.delete(token);
    return null;
  }

  // Enforce strict portal binding: a session created for one portal cannot impersonate another
  if (session.portal !== PORTAL_BY_ROLE[user.role]) {
    sessions.delete(token);
    return null;
  }

  // Reject requests if user belongs to a supermarket that is suspended, rejected, or pending approval
  if (user.supermarketId) {
    const supermarket = data.supermarkets.find((s) => s.id === user.supermarketId);
    if (
      supermarket &&
      (supermarket.status === 'suspended' || supermarket.status === 'pending' || supermarket.status === 'rejected')
    ) {
      sessions.delete(token);
      return null;
    }
  }

  // Sliding inactivity timeout: refresh expiresAt on valid request
  const duration = getSessionDurationMs(session.portal, user.role);
  session.expiresAt = Date.now() + duration;

  (req as any).session = session;
  return user;
}

const ALLOWED_PENDING_PASSWORD_PATHS = new Set([
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/change-required-password',
  '/api/admin/change-first-password',
]);

// Require authenticated user
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  const routePath = req.originalUrl.split('?')[0];
  if (user.mustChangePassword && !ALLOWED_PENDING_PASSWORD_PATHS.has(routePath)) {
    return res.status(403).json({
      error: 'You must change your temporary password before continuing.',
      mustChangePassword: true,
    });
  }
  (req as any).user = user;
  next();
}

// Role & portal authorization middleware
function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as User;
    const session = (req as any).session as SessionRecord | undefined;
    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient role privileges.' });
    }
    const allowedPortals = allowedRoles.map((r) => PORTAL_BY_ROLE[r]).filter(Boolean);
    if (session && !allowedPortals.includes(session.portal)) {
      return res.status(403).json({ error: 'Forbidden: Session portal not authorized for this route.' });
    }
    next();
  };
}

// Strict staff permission enforcement middleware
function checkStaffPermission(permission: keyof StaffPermissions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as User;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // Admin and Owner have chain-wide access
    if (user.role === 'admin' || user.role === 'owner') {
      return next();
    }

    if (user.role === 'staff') {
      if (!user.permissions || !user.permissions[permission]) {
        return res.status(403).json({
          error: `Staff permission denied: You do not have the "${permission}" permission level. Contact your store owner.`,
          requiredPermission: permission,
        });
      }
      return next();
    }

    return res.status(403).json({ error: 'Forbidden' });
  };
}

// Audit logger helper
function logAudit(
  user: User | null,
  action: string,
  entityType: any,
  entityId: string,
  details: string,
  supermarketId?: string | null,
  branchId?: string | null
) {
  const data = db.getRaw();
  const newLog: AuditLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    supermarketId: supermarketId ?? user?.supermarketId ?? null,
    branchId: branchId ?? user?.branchId ?? null,
    userId: user?.id ?? 'system',
    userName: user?.name ?? 'System',
    userRole: user?.role ?? 'admin',
    action,
    entityType,
    entityId,
    details,
    timestamp: new Date().toISOString(),
  };
  data.auditLogs.unshift(newLog);
  if (data.auditLogs.length > 1000) data.auditLogs.pop();
  db.save();
}

// Haversine formula to compute distance in km
function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

// Helper: Calculate promotion discount for an item
function computeItemDiscount(
  barcode: string,
  unitPrice: number,
  quantity: number,
  promotions: Promotion[],
  branchId: string
): { discount: number; promoId?: string; promoName?: string } {
  const now = new Date().toISOString();
  const promo = promotions.find(
    (p) =>
      p.isActive &&
      p.startDate <= now &&
      p.endDate >= now &&
      (!p.branchId || p.branchId === branchId) &&
      p.productBarcodes.includes(barcode)
  );

  if (!promo) return { discount: 0 };

  if (promo.type === 'percent_off' && promo.discountPercent) {
    const singleDiscount = (unitPrice * promo.discountPercent) / 100;
    const totalDiscount = Math.round(singleDiscount * quantity);
    return { discount: totalDiscount, promoId: promo.id, promoName: promo.name };
  }

  if (promo.type === 'fixed_price' && promo.fixedPrice && promo.fixedPrice < unitPrice) {
    const singleDiscount = unitPrice - promo.fixedPrice;
    const totalDiscount = Math.round(singleDiscount * quantity);
    return { discount: totalDiscount, promoId: promo.id, promoName: promo.name };
  }

  if (promo.type === 'bundle' && promo.bundleQuantity && promo.bundlePrice) {
    const bundles = Math.floor(quantity / promo.bundleQuantity);
    const normalBundleCost = promo.bundleQuantity * unitPrice;
    if (promo.bundlePrice < normalBundleCost && bundles > 0) {
      const bundleSavings = (normalBundleCost - promo.bundlePrice) * bundles;
      return { discount: bundleSavings, promoId: promo.id, promoName: promo.name };
    }
  }

  return { discount: 0 };
}

// Recalculate cart totals
function recalculateCart(cart: Cart, branchId: string, promotions: Promotion[]) {
  let subtotal = 0;
  let totalDiscount = 0;

  cart.items.forEach((item) => {
    const itemSubtotal = item.lockedPrice * item.quantity;
    const promoCalc = computeItemDiscount(item.barcode, item.lockedPrice, item.quantity, promotions, branchId);
    item.discount = promoCalc.discount;
    item.promoId = promoCalc.promoId;
    item.promoName = promoCalc.promoName;
    item.effectiveTotal = itemSubtotal - item.discount;

    subtotal += itemSubtotal;
    totalDiscount += item.discount;
  });

  cart.subtotal = subtotal;
  cart.totalDiscount = totalDiscount;
  cart.finalTotal = subtotal - totalDiscount;
  cart.budgetSummary = computeBudgetSummary(cart.finalTotal, cart.budgetLimit);
  cart.updatedAt = new Date().toISOString();
}

function computeSingleUnitPromoFinalPrice(
  unitPrice: number,
  promo: Promotion | null
): number {
  if (!promo) return unitPrice;
  if (promo.type === 'percent_off' && promo.discountPercent) {
    return Math.max(0, Math.round(unitPrice - (unitPrice * promo.discountPercent) / 100));
  }
  if (promo.type === 'fixed_price' && promo.fixedPrice && promo.fixedPrice < unitPrice) {
    return promo.fixedPrice;
  }
  return unitPrice;
}

// ==========================================
// STORE AND ROLE SEPARATION ACCESS HELPERS
// ==========================================

function canAccessSupermarket(user: User | null, smId: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'owner' && user.supermarketId === smId) return true;
  return false;
}

function canAccessBranch(user: User | null, branchId: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const data = db.getRaw();
  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch) return false;
  if (user.role === 'owner' && user.supermarketId === branch.supermarketId) return true;
  if (user.role === 'staff' && user.branchId === branchId) return true;
  return false;
}

function getShopperOrGuestId(req: Request, user: User | null): string {
  if (user) return user.id;
  const rawGuestId = (req.headers['x-guest-id'] as string) || (req.headers['guestcartid'] as string);
  if (rawGuestId && typeof rawGuestId === 'string' && rawGuestId.trim() && rawGuestId.trim() !== 'guest') {
    return `guest_${rawGuestId.trim()}`;
  }
  // If no guest ID header provided, generate unique ephemeral ID per connection so guests never share 'guest'
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `guest_${crypto.createHash('sha256').update(ip + Date.now().toString()).digest('hex').substring(0, 16)}`;
}

function canAccessCart(user: User | null, cart: Cart, guestId?: string): boolean {
  if (user) {
    if (user.role === 'admin') return true;
    if (user.role === 'owner' && user.supermarketId === cart.supermarketId) return true;
    if (user.role === 'staff' && user.branchId === cart.branchId) return true;
    if (cart.shopperId === user.id) return true;
    return false;
  }
  if (guestId && cart.shopperId === guestId && guestId !== 'guest') {
    return true;
  }
  return false;
}

// Generate collision-resistant short codes using crypto.randomInt (unique among open carts in branch & globally)
function generateShortCode(branchId?: string): string {
  const data = db.getRaw();
  const openShortCodes = new Set(
    data.carts
      .filter(
        (c) =>
          c.status !== 'completed' &&
          c.status !== 'cancelled' &&
          (!branchId || c.branchId === branchId)
      )
      .map((c) => c.shortCode.toUpperCase())
  );
  // Also include all open carts across platform to avoid lookup ambiguity
  for (const c of data.carts) {
    if (c.status !== 'completed' && c.status !== 'cancelled') {
      openShortCodes.add(c.shortCode.toUpperCase());
    }
  }

  for (let attempts = 0; attempts < 200; attempts++) {
    const digits = crypto.randomInt(1000, 10000);
    const code = `SC-${digits}`;
    if (!openShortCodes.has(code)) return code;
  }

  // Fallback to 5 digits if 4-digit space is saturated
  for (let attempts = 0; attempts < 200; attempts++) {
    const digits = crypto.randomInt(10000, 100000);
    const code = `SC-${digits}`;
    if (!openShortCodes.has(code)) return code;
  }

  return `SC-${crypto.randomInt(100000, 1000000)}`;
}

// ==========================================
// 1. AUTHENTICATION, SETUP & SECURITY ENDPOINTS
// ==========================================

// Check if System Admin first-time setup has been completed
// STRICT SECURITY RULE: Returns ONLY { isSetupComplete: boolean }. Never returns the admin's email.
app.get('/api/admin/setup-status', (req, res) => {
  const admin = db.getAdmin();
  res.json({
    isSetupComplete: Boolean(admin),
  });
});

// First-time System Admin setup endpoint
// Exactly ONE admin account can ever exist. Requires secret ADMIN_SETUP_KEY.
app.post('/api/admin/setup', sensitiveOpsRateLimiter, (req, res) => {
  const expectedKey = process.env.ADMIN_SETUP_KEY;
  const isProduction = process.env.NODE_ENV === 'production';

  // In production, if ADMIN_SETUP_KEY is not configured on the server, refuse setup
  if (isProduction && !expectedKey) {
    return res.status(503).json({
      error: 'Administrator setup is unavailable because ADMIN_SETUP_KEY environment variable is not configured on the server.',
    });
  }

  const { email, name, phone, setupKey, password } = req.body;

  // Validate setup key if expectedKey is configured
  if (expectedKey) {
    if (!setupKey || typeof setupKey !== 'string' || setupKey.trim() !== expectedKey.trim()) {
      logAudit(
        null,
        'ADMIN_SETUP_INVALID_KEY',
        'user',
        'unknown',
        'Failed administrator setup attempt due to invalid setup key.'
      );
      return res.status(401).json({ error: 'Invalid or missing administrator setup key.' });
    }
  }

  const data = db.getRaw();
  const existingAdmin = data.users.find((u) => u.role === 'admin');
  if (existingAdmin) {
    logAudit(
      null,
      'ADMIN_SETUP_DUPLICATE_ATTEMPT',
      'user',
      'unknown',
      'Rejected attempt to create secondary admin account. Exactly ONE admin account is permitted.'
    );
    return res.status(403).json({
      error: 'System admin account has already been initialized. Exactly ONE system admin is permitted on this platform, and no additional admin accounts can ever be created.',
    });
  }

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Valid email address is required for system administrator setup.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address format.' });
  }

  if (data.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
    return res.status(400).json({ error: 'This email is already in use by another user account.' });
  }

  let rawTempPassword: string | undefined;
  let initialPassword: string;
  let mustChangePassword = false;

  if (password !== undefined && password !== null && String(password).length > 0) {
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Administrator password must be at least 8 characters long.' });
    }
    initialPassword = password;
    mustChangePassword = false;
  } else {
    // Fallback for automated callers omitting password: generate high-entropy temporary password
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    const randomSuffix = crypto.randomInt(100, 1000);
    rawTempPassword = `Sc!${randomPart}${randomSuffix}`;
    initialPassword = rawTempPassword;
    mustChangePassword = true;
  }

  const adminId = `usr_sys_admin_${Date.now()}`;
  const now = new Date().toISOString();

  // Do not default the admin phone to any shared number
  const newAdmin: User = {
    id: adminId,
    name: name?.trim() || 'System Administrator',
    email: cleanEmail,
    phone: phone && phone.trim() ? phone.trim() : '',
    role: 'admin',
    status: 'active',
    failedAttempts: 0,
    lockedUntil: null,
    mustChangePassword,
    isPermanentAdmin: true,
    createdAt: now,
  };

  const { hash, salt } = hashPassword(initialPassword);
  data.users.push(newAdmin);
  data.passwords[adminId] = { hash, salt };

  logAudit(
    newAdmin,
    'SYSTEM_ADMIN_INITIALIZED',
    'user',
    adminId,
    `System Administrator account created with email ${cleanEmail}. Exactly ONE admin account permitted.`
  );
  db.save();

  res.json({
    success: true,
    message: 'System Administrator account created successfully.',
    requiresPasswordChange: mustChangePassword,
    ...(rawTempPassword ? { tempPassword: rawTempPassword } : {}),
  });
});

// Force Password Change on First Sign-In for Admin
app.post('/api/admin/change-first-password', requireAuth, requireRole(['admin']), async (req, res) => {
  const user = (req as any).user as User;
  const { currentPassword, newPassword, language } = req.body || {};
  const emailLang: EmailLanguage = language === 'sw' ? 'sw' : 'en';

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current temporary password and new password are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  const data = db.getRaw();
  const userPwd = data.passwords[user.id];
  if (!userPwd || !verifyPassword(currentPassword, userPwd.hash, userPwd.salt)) {
    return res.status(401).json({ error: 'Current temporary password is incorrect.' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password cannot be the same as the temporary password.' });
  }

  const { hash, salt } = hashPassword(newPassword);
  data.passwords[user.id] = { hash, salt };

  const dbUser = data.users.find((u) => u.id === user.id);
  if (dbUser) {
    dbUser.mustChangePassword = false;
    dbUser.failedAttempts = 0;
    dbUser.lockedUntil = null;
  }

  // Revoke any other existing admin sessions when password changes
  const currentSession = (req as any).session as SessionRecord | undefined;
  for (const [tok, sess] of sessions.entries()) {
    if (sess.userId === user.id && (!currentSession || tok !== currentSession.token)) {
      sessions.delete(tok);
    }
  }

  logAudit(
    user,
    'ADMIN_FIRST_PASSWORD_CHANGED',
    'user',
    user.id,
    'System Administrator changed temporary password upon first login at /admin/login.'
  );
  db.save();

  const notice = buildPasswordChangedEmail({ lang: emailLang, name: dbUser?.name || user.name });
  await sendEmail({
    to: dbUser?.email || user.email,
    ...notice,
    enforceAddressRateLimit: false,
  });

  res.json({
    success: true,
    message: 'Password changed successfully. You now have full access to platform administration.',
  });
});

// Time-Limited Admin Password Recovery via Link (SHA-256 hashed at rest, 10-minute expiry)
app.post('/api/admin/reset-password-with-token', sensitiveOpsRateLimiter, async (req, res) => {
  const { token, newPassword, language } = req.body || {};
  const emailLang: EmailLanguage = language === 'sw' ? 'sw' : 'en';
  if (!token || typeof token !== 'string' || !newPassword || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Reset token and new password are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  const data = db.getRaw();
  const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
  const tokenKey = `admin_token_${tokenHash}`;
  const record = data.resetCodes[tokenKey];

  if (!record || record.used || record.expiresAt < Date.now() || record.tokenHash !== tokenHash) {
    if (record && record.expiresAt < Date.now()) {
      delete data.resetCodes[tokenKey];
      db.save();
    }
    logAudit(
      null,
      'ADMIN_PASSWORD_RESET_FAILED',
      'user',
      'admin',
      'Attempted admin password recovery with invalid or expired time-limited token.'
    );
    return res.status(400).json({
      error: 'This password reset link is invalid or has expired. Time-limited recovery links expire after 10 minutes.',
    });
  }

  const admin = data.users.find(
    (u) =>
      u.role === 'admin' &&
      ((record.userId && u.id === record.userId) ||
        (record.email && u.email.toLowerCase() === record.email.toLowerCase()))
  );
  if (!admin) {
    return res.status(404).json({ error: 'System administrator account not found.' });
  }

  const { hash, salt } = hashPassword(newPassword);
  data.passwords[admin.id] = { hash, salt };
  admin.failedAttempts = 0;
  admin.lockedUntil = null;
  admin.mustChangePassword = false;

  // Mark token used and delete hashed token record
  record.used = true;
  delete data.resetCodes[tokenKey];

  // Revoke any active admin sessions on password reset
  revokeUserSessions(admin.id);

  logAudit(
    admin,
    'ADMIN_PASSWORD_RESET_COMPLETED',
    'user',
    admin.id,
    'Admin password successfully reset using single-use time-limited email link.'
  );
  db.save();

  const notice = buildPasswordChangedEmail({ lang: emailLang, name: admin.name });
  await sendEmail({
    to: admin.email,
    ...notice,
    enforceAddressRateLimit: false,
  });

  res.json({
    success: true,
    message: 'Your administrator password has been reset successfully. You can now sign in at /admin/login.',
  });
});

// Login with email or phone, strictly enforced portal separation, uniform timing, and audit logs
app.post('/api/auth/login', loginRateLimiter, async (req, res) => {
  const startTime = Date.now();
  const { identifier, password, portal } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Identifier (email or phone) and password are required' });
  }

  const validPortals = ['shopper', 'staff', 'management', 'admin'];
  const selectedPortal = portal && validPortals.includes(portal) ? portal : (portal ? null : 'shopper');
  if (!selectedPortal) {
    return res.status(400).json({ error: 'Valid portal parameter (shopper, staff, management, admin) is required' });
  }

  const cleanIdentifier = identifier.trim().toLowerCase();
  const cleanPhone = identifier.replace(/[\s\-()]/g, '');
  const data = db.getRaw();

  const user = data.users.find((u) => {
    if (selectedPortal === 'admin') {
      return u.email.toLowerCase() === cleanIdentifier;
    }
    return (
      u.email.toLowerCase() === cleanIdentifier ||
      (cleanPhone && u.phone.replace(/[\s\-()]/g, '') === cleanPhone)
    );
  });

  const memRecord = memoryFailedAttempts.get(cleanIdentifier);
  const isUserLocked = user?.lockedUntil && user.lockedUntil > Date.now();
  const isMemLocked = memRecord?.lockedUntil && memRecord.lockedUntil > Date.now();

  if (isUserLocked || isMemLocked) {
    const lockedUntil = (user?.lockedUntil && user.lockedUntil > Date.now()) ? user.lockedUntil : memRecord!.lockedUntil!;
    const remainingMinutes = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000));
    const elapsed = Date.now() - startTime;
    if (elapsed < 200) await new Promise((r) => setTimeout(r, 200 - elapsed));
    return res.status(429).json({
      error: `Account is temporarily locked due to repeated failed attempts. Please try again in ${remainingMinutes} minute(s) or reset your password.`,
      lockedUntil,
    });
  }

  // Validate portal against role
  let portalMatch = false;
  if (user) {
    if (selectedPortal === 'shopper' && user.role === 'shopper') portalMatch = true;
    if (selectedPortal === 'staff' && user.role === 'staff') portalMatch = true;
    if (selectedPortal === 'management' && user.role === 'owner') portalMatch = true;
    if (selectedPortal === 'admin' && user.role === 'admin') portalMatch = true;
  }

  const userPwd = user ? data.passwords[user.id] : null;
  const passwordMatch = userPwd ? verifyPassword(password, userPwd.hash, userPwd.salt) : false;
  const isValid = portalMatch && passwordMatch;

  // STRICT AUDIT RULE: Log every admin login attempt (success, failure, wrong portal)
  if (selectedPortal === 'admin' || user?.role === 'admin') {
    if (isValid && user?.role === 'admin') {
      logAudit(user, 'ADMIN_LOGIN_SUCCESS', 'user', user.id, 'System Administrator logged in successfully at /admin/login.');
    } else if (user?.role === 'admin' && selectedPortal !== 'admin') {
      logAudit(user, 'ADMIN_LOGIN_WRONG_PORTAL', 'user', user.id, `Admin account attempted login on non-admin portal: ${selectedPortal}`);
    } else {
      logAudit(user || null, 'ADMIN_LOGIN_FAILED', 'user', user?.id || 'unknown', `Failed admin login attempt on portal: ${selectedPortal}`);
    }
  }

  if (!isValid) {
    const safePortal = (['shopper', 'staff', 'management', 'admin'].includes(selectedPortal)
      ? selectedPortal
      : 'shopper') as PortalType | 'admin';
    const nowIso = new Date().toISOString();
    recordSecurityEvent(data, {
      createdAt: nowIso,
      type: 'login_failure',
      portal: safePortal,
    });

    // Increment failed attempts for account lock limit (5 attempts = 15 minute lock)
    if (user) {
      user.failedAttempts = (user.failedAttempts || 0) + 1;
      if (user.failedAttempts >= 5) {
        user.lockedUntil = Date.now() + 15 * 60 * 1000;
        recordSecurityEvent(data, {
          createdAt: nowIso,
          type: 'lockout',
          portal: safePortal,
        });
      }
      db.save();
    } else {
      const rec = memoryFailedAttempts.get(cleanIdentifier) || { count: 0, lockedUntil: null };
      rec.count += 1;
      if (rec.count >= 5) {
        rec.lockedUntil = Date.now() + 15 * 60 * 1000;
        recordSecurityEvent(data, {
          createdAt: nowIso,
          type: 'lockout',
          portal: safePortal,
        });
      }
      memoryFailedAttempts.set(cleanIdentifier, rec);
      db.save();
    }

    // Uniform timing (~200ms delay) to prevent user/portal enumeration
    const elapsed = Date.now() - startTime;
    if (elapsed < 200) {
      await new Promise((r) => setTimeout(r, 200 - elapsed));
    }

    return res.status(401).json({
      error: 'Incorrect details or wrong sign-in page.',
    });
  }

  // Account suspension check
  if (user!.status === 'suspended') {
    return res.status(403).json({ error: 'This account has been suspended by an administrator.' });
  }

  // Supermarket pending/rejected/suspended check for owner and staff
  if (user!.supermarketId) {
    const sm = data.supermarkets.find((s) => s.id === user!.supermarketId);
    if (sm) {
      if (sm.status === 'pending') {
        return res.status(403).json({ error: 'Your application is awaiting approval by the platform administrator.' });
      }
      if (sm.status === 'rejected') {
        return res.status(403).json({ error: 'Your store application was not approved. Please contact platform support for details.' });
      }
      if (sm.status === 'suspended') {
        return res.status(403).json({ error: 'This supermarket has been suspended.' });
      }
    }
  }

  // Enforce temporary password 24h expiry & single-use before granting session
  if (user!.tempPasswordExpiresAt && user!.tempPasswordExpiresAt < Date.now()) {
    const elapsed = Date.now() - startTime;
    if (elapsed < 200) await new Promise((r) => setTimeout(r, 200 - elapsed));
    return res.status(401).json({
      error: 'This temporary password has expired (24-hour limit). Please request a new password reset.',
    });
  }

  if (user!.mustChangePassword && user!.tempPasswordConsumed && user!.role !== 'admin') {
    const elapsed = Date.now() - startTime;
    if (elapsed < 200) await new Promise((r) => setTimeout(r, 200 - elapsed));
    return res.status(401).json({
      error: 'This temporary password has already been used. Please change your password or request a new temporary password.',
    });
  }

  // Reset failed attempts upon successful login
  user!.failedAttempts = 0;
  user!.lockedUntil = null;
  if (user!.mustChangePassword && user!.role !== 'admin') {
    user!.tempPasswordConsumed = true;
  }
  memoryFailedAttempts.delete(cleanIdentifier);
  db.save();

  const token = `tok_${crypto.randomBytes(24).toString('hex')}`;
  const duration = getSessionDurationMs(selectedPortal, user!.role);
  sessions.set(token, {
    token,
    userId: user!.id,
    portal: selectedPortal,
    createdAt: Date.now(),
    expiresAt: Date.now() + duration,
  });

  let supermarket = null;
  let branch = null;
  if (user!.supermarketId) {
    supermarket = data.supermarkets.find((s) => s.id === user!.supermarketId) || null;
  }
  if (user!.branchId) {
    branch = data.branches.find((b) => b.id === user!.branchId) || null;
  }

  res.json({
    token,
    user: {
      id: user!.id,
      name: user!.name,
      email: user!.email,
      phone: user!.phone,
      role: user!.role,
      supermarketId: user!.supermarketId,
      branchId: user!.branchId,
      permissions: user!.permissions,
      status: user!.status,
      mustChangePassword: user!.mustChangePassword ?? false,
      isPermanentAdmin: user!.isPermanentAdmin ?? false,
    },
    supermarket,
    branch,
  });
});

// Self-register for shoppers ONLY
// Strictly blocks any attempt to create an admin account and logs it
app.post('/api/auth/register', sensitiveOpsRateLimiter, (req, res) => {
  const { name, email, phone, password, role } = req.body;

  // Strict backend rule: reject any attempt to register an admin account
  if (role === 'admin' || req.body.isAdmin) {
    logAudit(
      null,
      'ADMIN_CREATION_ATTEMPT_REJECTED',
      'user',
      'unknown',
      `Rejected unauthorized attempt to register admin account with email ${email || 'unknown'}`
    );
    return res.status(403).json({
      error: 'Admin accounts cannot be registered. The platform has exactly ONE system administrator created during first-time setup.',
    });
  }

  if (!name || !email || !phone || !password) {
    return res.status(400).json({ error: 'Name, email, phone, and password are required' });
  }

  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanPhone = phone.replace(/[\s\-()]/g, '');
  const data = db.getRaw();

  if (data.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
    return res.status(400).json({ error: 'Email is already registered. Please log in or reset password.' });
  }

  if (data.users.some((u) => u.phone.replace(/[\s\-()]/g, '') === cleanPhone)) {
    return res.status(400).json({ error: 'Phone number is already registered. Please log in.' });
  }

  const userId = `usr_shopper_${Date.now()}`;
  const now = new Date().toISOString();
  const newUser: User = {
    id: userId,
    name: name.trim(),
    email: cleanEmail,
    phone: phone.trim(),
    role: 'shopper', // strictly forced to shopper
    status: 'active',
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: now,
  };

  const { hash, salt } = hashPassword(password);
  data.users.push(newUser);
  data.passwords[userId] = { hash, salt };

  logAudit(newUser, 'SHOPPER_REGISTERED', 'staff', userId, `Shopper ${newUser.name} registered`);
  db.save();

  const token = `tok_${crypto.randomBytes(24).toString('hex')}`;
  const duration = getSessionDurationMs('shopper', 'shopper');
  sessions.set(token, {
    token,
    userId: newUser.id,
    portal: 'shopper',
    createdAt: Date.now(),
    expiresAt: Date.now() + duration,
  });

  res.json({
    token,
    user: newUser,
  });
});

// Logout endpoint: deletes caller's session from store
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    sessions.delete(token);
  }
  res.json({ success: true, message: 'Logged out successfully.' });
});

app.get('/api/auth/me', (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const data = db.getRaw();
  const supermarket = user.supermarketId ? data.supermarkets.find((s) => s.id === user.supermarketId) : null;
  const branch = user.branchId ? data.branches.find((b) => b.id === user.branchId) : null;

  res.json({
    user: {
      ...user,
      mustChangePassword: user.mustChangePassword ?? false,
      isPermanentAdmin: user.isPermanentAdmin ?? false,
    },
    supermarket,
    branch,
  });
});

// Client configuration endpoint
app.get('/api/auth/config', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  const adminSetupKeyRequired = isProd || Boolean(process.env.ADMIN_SETUP_KEY?.trim());
  res.json({ adminSetupKeyRequired });
});

// Password recovery endpoint
// STRICT SECURITY RULES:
// 1. Dispatches email via sendEmail() with hashed codes/tokens stored in DB; NEVER returns code, token, or link in HTTP response and NEVER logs secrets in production.
// 2. Uniform response message and identical response timing (~200ms) for anti-enumeration.
// 3. Admin recovery is strictly email-only with a time-limited link. Do not reveal admin status.
// 4. Crypto.randomInt codes (scrypt salted hash), sha256 admin link token hash, 10-min expiry, single-use, 5 failed attempts invalidation.
app.post('/api/auth/forgot-password', forgotPasswordIpRateLimiter, async (req, res) => {
  const startTime = Date.now();
  const { identifier, language } = req.body || {};
  const emailLang: EmailLanguage = language === 'sw' ? 'sw' : 'en';

  if (!identifier || typeof identifier !== 'string') {
    return res.status(400).json({ error: 'Identifier (email or phone) is required.' });
  }

  // Reject header/CRLF/NUL injection attempts cleanly
  if (/[\r\n\0]/.test(identifier)) {
    return res.status(400).json({ error: 'Invalid email or phone identifier.' });
  }

  const trimmed = identifier.trim();
  const looksLikeEmail = trimmed.includes('@');
  const validatedEmail = looksLikeEmail ? normalizeAndValidateEmail(trimmed) : null;
  if (looksLikeEmail && !validatedEmail) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const clean = validatedEmail || trimmed.toLowerCase();
  const cleanPhone = looksLikeEmail ? '' : trimmed.replace(/[\s\-()]/g, '');
  const data = db.getRaw();

  const user = data.users.find(
    (u) => u.email.toLowerCase() === clean || (cleanPhone && u.phone.replace(/[\s\-()]/g, '') === cleanPhone)
  );

  if (user && user.status !== 'suspended') {
    const recipientEmail = normalizeAndValidateEmail(user.email);

    // Admin password recovery: strictly email-only time-limited link
    if (user.role === 'admin') {
      // If identifier was phone number, do NOT send link, and do NOT reveal that account is admin
      if (recipientEmail && clean === recipientEmail) {
        const resetToken = crypto.randomBytes(24).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
        const tokenKey = `admin_token_${tokenHash}`;
        data.resetCodes[tokenKey] = {
          email: recipientEmail,
          userId: user.id,
          tokenHash,
          identifier: recipientEmail,
          expiresAt: Date.now() + 10 * 60 * 1000,
          failedAttempts: 0,
          used: false,
        };
        db.save();

        const resetUrl = `${getAppBaseUrl(req)}/admin/login?resetToken=${resetToken}`;
        const emailContent = buildAdminResetLinkEmail({
          lang: emailLang,
          name: user.name,
          resetUrl,
        });
        await sendEmail({
          to: recipientEmail,
          ...emailContent,
        });

        logAudit(
          user,
          'ADMIN_PASSWORD_RESET_LINK_GENERATED',
          'user',
          user.id,
          'Time-limited password recovery link issued for admin email (expires in 10 minutes).'
        );
      }
    } else if (recipientEmail) {
      // Standard user recovery (shopper, staff, owner) via 6-digit code (stored ONLY as scrypt hash)
      const code = crypto.randomInt(100000, 1000000).toString();
      const { hash: codeHash, salt: codeSalt } = hashPassword(code);
      const record = {
        codeHash,
        codeSalt,
        userId: user.id,
        email: recipientEmail,
        identifier: recipientEmail,
        expiresAt: Date.now() + 10 * 60 * 1000,
        failedAttempts: 0,
        used: false,
      };
      data.resetCodes[recipientEmail] = record;
      if (clean && clean !== recipientEmail) data.resetCodes[clean] = record;
      if (cleanPhone) data.resetCodes[cleanPhone] = record;
      const userCleanPhone = user.phone.replace(/[\s\-()]/g, '');
      if (userCleanPhone && userCleanPhone !== cleanPhone) {
        data.resetCodes[userCleanPhone] = record;
      }
      db.save();

      const emailContent = buildPasswordResetOtpEmail({
        lang: emailLang,
        name: user.name,
        code,
      });
      await sendEmail({
        to: recipientEmail,
        ...emailContent,
      });

      logAudit(user, 'PASSWORD_RESET_REQUESTED', 'user', user.id, 'Password reset verification code issued (10-minute expiry).');
    }
  }

  // Enforce uniform response time (~200ms) regardless of whether user exists or email succeeded
  const minDuration = 200;
  const elapsed = Date.now() - startTime;
  if (elapsed < minDuration) {
    await new Promise((resolve) => setTimeout(resolve, minDuration - elapsed));
  }

  // Always return the exact same generic message without leaking code, link, or delivery failure
  res.json({
    success: true,
    message: 'If an account exists, a recovery message has been sent.',
  });
});

// Reset password using verification code
// Enforces single-use, 10-minute expiry, scrypt verification, invalidation after 5 wrong attempts, min 8-char password
app.post('/api/auth/reset-password', sensitiveOpsRateLimiter, async (req, res) => {
  const { identifier, code, newPassword, language } = req.body || {};
  const emailLang: EmailLanguage = language === 'sw' ? 'sw' : 'en';
  if (!identifier || !code || !newPassword || typeof identifier !== 'string' || typeof code !== 'string') {
    return res.status(400).json({ error: 'Identifier, verification code, and new password are required.' });
  }

  if (/[\r\n\0]/.test(identifier)) {
    return res.status(400).json({ error: 'Invalid identifier format.' });
  }

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  const clean = identifier.trim().toLowerCase();
  const cleanPhone = identifier.replace(/[\s\-()]/g, '');
  const data = db.getRaw();

  const resetRecord = data.resetCodes[clean] || (cleanPhone ? data.resetCodes[cleanPhone] : undefined);
  if (
    !resetRecord ||
    resetRecord.used ||
    resetRecord.expiresAt < Date.now() ||
    !resetRecord.codeHash ||
    !resetRecord.codeSalt
  ) {
    return res.status(400).json({ error: 'Invalid or expired verification code.' });
  }

  const deleteAllResetRefs = () => {
    for (const [k, v] of Object.entries(data.resetCodes)) {
      if (v === resetRecord || (resetRecord.userId && v.userId === resetRecord.userId && !k.startsWith('admin_token_'))) {
        delete data.resetCodes[k];
      }
    }
    delete data.resetCodes[clean];
    if (cleanPhone) delete data.resetCodes[cleanPhone];
  };

  if (!verifyPassword(code.trim(), resetRecord.codeHash, resetRecord.codeSalt)) {
    resetRecord.failedAttempts = (resetRecord.failedAttempts || 0) + 1;
    if (resetRecord.failedAttempts >= 5) {
      deleteAllResetRefs();
      db.save();
      return res.status(400).json({
        error: 'Too many incorrect attempts. This verification code has been invalidated. Please request a new code.',
      });
    }
    db.save();
    const remaining = 5 - resetRecord.failedAttempts;
    return res.status(400).json({
      error: `Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before code is invalidated.`,
    });
  }

  const user = data.users.find(
    (u) =>
      (resetRecord.userId && u.id === resetRecord.userId) ||
      u.email.toLowerCase() === clean ||
      (cleanPhone && u.phone.replace(/[\s\-()]/g, '') === cleanPhone)
  );

  if (!user) {
    return res.status(404).json({ error: 'User account not found.' });
  }

  // System admin cannot reset via 6-digit code, must use time-limited link
  if (user.role === 'admin') {
    return res.status(403).json({
      error: 'System administrator must use the time-limited email reset link flow at /admin/login.',
    });
  }

  const { hash, salt } = hashPassword(newPassword);
  data.passwords[user.id] = { hash, salt };
  user.failedAttempts = 0;
  user.lockedUntil = null;

  // Single-use: invalidate & delete all pointers to this reset code
  resetRecord.used = true;
  deleteAllResetRefs();

  // Revoke all active sessions immediately
  revokeUserSessions(user.id);

  logAudit(user, 'PASSWORD_RESET_COMPLETED', 'user', user.id, 'Password successfully reset.');
  db.save();

  const notice = buildPasswordChangedEmail({ lang: emailLang, name: user.name });
  await sendEmail({
    to: user.email,
    ...notice,
    enforceAddressRateLimit: false,
  });

  res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
});

// Change required temporary password upon sign-in (shopper, staff, owner)
app.post('/api/auth/change-required-password', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword || typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Current temporary password and new password are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password cannot be the same as your temporary password.' });
  }

  const data = db.getRaw();
  const userPwd = data.passwords[user.id];
  if (!userPwd || !verifyPassword(currentPassword, userPwd.hash, userPwd.salt)) {
    return res.status(401).json({ error: 'Current temporary password is incorrect.' });
  }

  const dbUser = data.users.find((u) => u.id === user.id);
  if (!dbUser) return res.status(404).json({ error: 'User account not found.' });

  if (dbUser.tempPasswordExpiresAt && dbUser.tempPasswordExpiresAt < Date.now()) {
    return res.status(401).json({ error: 'This temporary password has expired. Please request a new reset.' });
  }

  const { hash, salt } = hashPassword(newPassword);
  data.passwords[dbUser.id] = { hash, salt };
  dbUser.mustChangePassword = false;
  dbUser.tempPasswordExpiresAt = null;
  dbUser.tempPasswordConsumed = false;
  dbUser.failedAttempts = 0;
  dbUser.lockedUntil = null;

  // Revoke any other existing sessions for this user, keeping current session valid
  const currentSession = (req as any).session as SessionRecord | undefined;
  for (const [tok, sess] of sessions.entries()) {
    if (sess.userId === dbUser.id && (!currentSession || tok !== currentSession.token)) {
      sessions.delete(tok);
    }
  }

  logAudit(
    dbUser,
    'PASSWORD_CHANGED_AFTER_TEMP_RESET',
    'user',
    dbUser.id,
    `${dbUser.role} account ${dbUser.name} changed required temporary password.`,
    dbUser.supermarketId || null,
    dbUser.branchId || null
  );
  db.save();

  res.json({
    success: true,
    message: 'Your password has been updated.',
    user: {
      id: dbUser.id,
      name: dbUser.name,
      email: dbUser.email,
      phone: dbUser.phone,
      role: dbUser.role,
      supermarketId: dbUser.supermarketId,
      branchId: dbUser.branchId,
      permissions: dbUser.permissions,
      status: dbUser.status,
      mustChangePassword: false,
      isPermanentAdmin: dbUser.isPermanentAdmin ?? false,
    },
  });
});

// Free support-assisted Password Reset Request (no email or SMS service needed)
// Strict anti-enumeration: identical generic response and uniform timing (~200ms).
// Never reveals whether an account exists, never exposes codes/links, and never allows resetting admin account.
app.post('/api/auth/password-reset-request', passwordResetRequestIpRateLimiter, async (req, res) => {
  const startTime = Date.now();
  const { identifier, fullName, note, portal } = req.body || {};

  if (!identifier || typeof identifier !== 'string' || /[\r\n\0]/.test(identifier) || identifier.trim().length > 200) {
    return res.status(400).json({ error: 'A valid email or phone number is required.' });
  }

  if (!fullName || typeof fullName !== 'string' || /[\r\n\0]/.test(fullName) || fullName.trim().length < 2 || fullName.trim().length > 120) {
    return res.status(400).json({ error: 'Full name is required (2-120 characters).' });
  }

  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 500)) {
    return res.status(400).json({ error: 'Optional note must be 500 characters or fewer.' });
  }

  const allowedPortals: PortalType[] = ['shopper', 'staff', 'management'];
  const requestedPortal: PortalType = portal && allowedPortals.includes(portal) ? portal : portal ? null! : 'shopper';
  if (!requestedPortal) {
    return res.status(400).json({ error: 'Invalid sign-in portal for password reset request.' });
  }

  const cleanIdentifier = identifier.trim().toLowerCase();
  const cleanPhone = identifier.replace(/[\s\-()]/g, '').toLowerCase();
  const identifierKeys = Array.from(new Set([cleanIdentifier, cleanPhone].filter(Boolean)));

  if (isPasswordResetIdentifierRateLimited(identifierKeys)) {
    return res.status(429).json({
      error: 'Too many password reset requests for this email or phone. Please try again later.',
    });
  }
  recordPasswordResetIdentifierAttempt(identifierKeys);

  const data = db.getRaw();
  const cleanName = fullName.trim();
  const cleanNote = typeof note === 'string' ? note.trim() : '';

  // Never allow resetting or exposing the system admin account through this flow
  const candidate = data.users.find(
    (u) =>
      u.email.toLowerCase() === cleanIdentifier ||
      (cleanPhone && u.phone.replace(/[\s\-()]/g, '').toLowerCase() === cleanPhone)
  );
  const matchedUser = candidate && candidate.role !== 'admin' ? candidate : null;
  const matchedSm =
    matchedUser?.supermarketId
      ? data.supermarkets.find((s) => s.id === matchedUser.supermarketId) || null
      : null;

  const details: PasswordResetRequestDetails = {
    requestedIdentifier: identifier.trim(),
    requestedFullName: cleanName,
    note: cleanNote,
    portalRequested: requestedPortal,
    matchedAccount: Boolean(matchedUser),
    matchedUserId: matchedUser ? matchedUser.id : null,
    matchedRole: matchedUser ? (matchedUser.role as Exclude<User['role'], 'admin'>) : null,
    matchedSupermarketId: matchedSm ? matchedSm.id : null,
    matchedSupermarketName: matchedSm ? matchedSm.name : null,
    maskedEmail: matchedUser ? maskEmail(matchedUser.email) : null,
    maskedPhone: matchedUser ? maskPhone(matchedUser.phone) : null,
    identityChecked: {
      phoneConfirmed: false,
      lastPurchaseOrPointsConfirmed: false,
    },
  };

  const nowIso = new Date().toISOString();
  const ticket: SupportTicket = {
    id: `tkt_pwr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    userId: 'anonymous_reset_request',
    userName: cleanName,
    userEmail: '',
    userPhone: '',
    supermarketId: matchedSm?.id || null,
    category: 'password_reset',
    subject: 'Password reset request',
    message: cleanNote || 'Password reset requested via support form.',
    status: 'open',
    passwordResetDetails: details,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (!Array.isArray(data.supportTickets)) data.supportTickets = [];
  data.supportTickets.unshift(ticket);
  logAudit(
    null,
    'PASSWORD_RESET_SUPPORT_REQUESTED',
    'user',
    ticket.id,
    `Support password reset request submitted on portal "${requestedPortal}".`
  );
  db.save();

  const elapsed = Date.now() - startTime;
  if (elapsed < 200) {
    await new Promise((resolve) => setTimeout(resolve, 200 - elapsed));
  }

  res.json({
    success: true,
    message: 'If we find your account, support will contact you shortly.',
  });
});

// ==========================================
// 2. SUPERMARKET & BRANCH APIS
// ==========================================

// Supermarket owner application endpoint
app.post(['/api/supermarket/apply', '/api/supermarkets/apply'], sensitiveOpsRateLimiter, async (req, res) => {
  const {
    chainName,
    contactEmail,
    contactPhone,
    city,
    firstBranchName,
    initialProductCount,
    notes,
    password,
    ownerName,
    language,
  } = req.body || {};
  const emailLang: EmailLanguage = language === 'sw' ? 'sw' : 'en';

  if (!chainName || !contactEmail || !contactPhone || !password) {
    return res.status(400).json({ error: 'Chain name, contact email, contact phone, and password are required.' });
  }

  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  const cleanEmail = normalizeAndValidateEmail(contactEmail);
  if (!cleanEmail) {
    return res.status(400).json({ error: 'Please enter a valid contact email address.' });
  }

  const cleanPhone = String(contactPhone).replace(/[\s\-()]/g, '');
  const data = db.getRaw();

  if (data.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
    return res.status(400).json({ error: 'This email is already in use by another user account.' });
  }

  if (data.users.some((u) => u.phone.replace(/[\s\-()]/g, '') === cleanPhone)) {
    return res.status(400).json({ error: 'This phone number is already registered.' });
  }

  const smId = `sm_${Date.now()}`;
  const ownerId = `usr_owner_${Date.now()}`;
  const now = new Date().toISOString();
  const cleanCode = chainName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase() || 'CHAIN';

  const newSupermarket: Supermarket = {
    id: smId,
    name: chainName.trim(),
    code: cleanCode,
    contactEmail: cleanEmail,
    contactPhone: contactPhone.trim(),
    status: 'pending',
    city: city?.trim() || '',
    notes: notes?.trim() || '',
    firstBranchName: firstBranchName?.trim() || '',
    initialProductCount: Number(initialProductCount) || 0,
    applicationDate: now,
    currency: 'KES',
    createdAt: now,
  };

  const newOwner: User = {
    id: ownerId,
    name: ownerName?.trim() || `${chainName.trim()} Owner`,
    email: cleanEmail,
    phone: contactPhone.trim(),
    role: 'owner',
    supermarketId: smId,
    status: 'active',
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: now,
  };

  const { hash, salt } = hashPassword(password);
  data.supermarkets.push(newSupermarket);
  data.users.push(newOwner);
  data.passwords[ownerId] = { hash, salt };

  if (firstBranchName && firstBranchName.trim()) {
    const branchId = `br_${Date.now()}`;
    const branch: Branch = {
      id: branchId,
      supermarketId: smId,
      name: firstBranchName.trim(),
      code: `${cleanCode}-01`,
      address: city?.trim() || 'Main Branch',
      city: city?.trim() || 'Nairobi',
      latitude: -1.286389,
      longitude: 36.817223,
      phone: contactPhone.trim(),
      isActive: false,
    };
    data.branches.push(branch);
    newOwner.branchId = branchId;
  }

  logAudit(
    newOwner,
    'SUPERMARKET_APPLICATION_SUBMITTED',
    'supermarket',
    smId,
    `New supermarket application submitted for "${newSupermarket.name}" (${newSupermarket.contactEmail}). Status: pending approval.`
  );
  db.save();

  const receivedNotice = buildSupermarketApplicationEmail({
    lang: emailLang,
    ownerName: newOwner.name,
    chainName: newSupermarket.name,
  });
  await sendEmail({
    to: newSupermarket.contactEmail,
    ...receivedNotice,
  });

  res.json({
    success: true,
    message: 'Application submitted. The Smart Cart team will review your application. Once approved, you will be able to sign in.',
    supermarket: newSupermarket,
  });
});

app.get('/api/supermarkets', (req, res) => {
  const user = getAuthUser(req);
  const data = db.getRaw();
  const list = user?.role === 'admin' ? data.supermarkets : data.supermarkets.filter((s) => s.status === 'active');
  res.json(list);
});

app.get('/api/branches', (req, res) => {
  const user = getAuthUser(req);
  const { supermarketId, lat, lng } = req.query;
  const data = db.getRaw();

  const activeSupermarkets = user?.role === 'admin'
    ? data.supermarkets
    : data.supermarkets.filter((s) => s.status === 'active');
  const activeSmIds = new Set(activeSupermarkets.map((s) => s.id));

  let branches = data.branches.filter((b) => b.isActive && activeSmIds.has(b.supermarketId));
  if (supermarketId) {
    branches = branches.filter((b) => b.supermarketId === supermarketId);
  }

  if (lat && lng) {
    const userLat = parseFloat(lat as string);
    const userLng = parseFloat(lng as string);
    if (!isNaN(userLat) && !isNaN(userLng)) {
      branches = branches.map((b) => ({
        ...b,
        distanceKm: calculateDistanceKm(userLat, userLng, b.latitude, b.longitude),
      }));
      branches.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
    }
  }

  res.json(branches);
});

// ==========================================
// 3. SHOPPER CATALOGUE, AISLE/SHELF & LOOKUP
// ==========================================

app.get('/api/shopper/branch-products/:branchId', (req, res) => {
  const { branchId } = req.params;
  const user = getAuthUser(req);
  const data = db.getRaw();

  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  const supermarket = data.supermarkets.find((s) => s.id === branch.supermarketId);
  if (!supermarket || (supermarket.status !== 'active' && user?.role !== 'admin')) {
    return res.status(404).json({ error: 'Store branch is currently unavailable' });
  }
  const now = new Date().toISOString();

  const activePromos = data.promotions.filter(
    (p) =>
      p.isActive &&
      p.supermarketId === branch.supermarketId &&
      p.startDate <= now &&
      p.endDate >= now &&
      (!p.branchId || p.branchId === branchId)
  );

  const userFavourites = user ? data.favourites?.[user.id] || [] : [];

  const products = data.products
    .filter((p) => p.supermarketId === branch.supermarketId)
    .map((p) => {
      const bp = data.branchProducts.find((b) => b.branchId === branchId && b.productId === p.id);
      const branchPrice = bp?.priceOverride ?? null;
      const effectivePrice = branchPrice ?? p.basePrice;
      const stock = bp?.stock ?? 50;
      const threshold = bp?.lowStockThresholdOverride ?? p.lowStockThreshold ?? 10;
      const isLowStock = stock <= threshold;
      const promo = activePromos.find((pr) => pr.productBarcodes.includes(p.barcode)) || null;

      const effectiveAisle = (bp?.aisleOverride || p.aisle || '').trim();
      const effectiveShelf = (bp?.shelfOverride || p.shelf || '').trim();
      const aisleShelfDisplay = [effectiveAisle, effectiveShelf].filter(Boolean).join(', ');

      return {
        ...p,
        aisle: effectiveAisle,
        shelf: effectiveShelf,
        aisleShelf: aisleShelfDisplay,
        branchPrice: effectivePrice,
        effectivePrice,
        stock,
        isLowStock,
        activePromotion: promo,
        isFavourite: userFavourites.includes(p.barcode),
      };
    });

  res.json({
    supermarket,
    branch,
    products,
  });
});

app.post('/api/shopper/scan-lookup', (req, res) => {
  const { branchId, barcode } = req.body;
  if (!branchId || !barcode) {
    return res.status(400).json({ error: 'branchId and barcode are required' });
  }

  const cleanBarcode = barcode.trim();
  const data = db.getRaw();
  const branch = data.branches.find((b) => b.id === branchId);

  const valResult = validateBarcode(cleanBarcode);
  if (!valResult.isValid) {
    if (branch) {
      recordScanEvent(data, {
        createdAt: new Date().toISOString(),
        branchId: branch.id,
        supermarketId: branch.supermarketId,
        success: false,
      });
      db.save();
    }
    return res.status(400).json({
      error: valResult.error || 'Invalid barcode check digit or format',
      format: valResult.format,
    });
  }

  const caller = getAuthUser(req);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  const supermarket = data.supermarkets.find((s) => s.id === branch.supermarketId);
  if (!supermarket || (supermarket.status !== 'active' && caller?.role !== 'admin')) {
    return res.status(404).json({ error: 'Store branch is currently unavailable' });
  }

  const product = data.products.find(
    (p) => p.supermarketId === branch.supermarketId && p.barcode === cleanBarcode
  );

  if (!product) {
    recordScanEvent(data, {
      createdAt: new Date().toISOString(),
      branchId: branch.id,
      supermarketId: branch.supermarketId,
      success: false,
    });
    db.save();
    return res.status(404).json({
      error: `Product with barcode ${cleanBarcode} is not in ${branch.name}'s catalogue.`,
      barcode: cleanBarcode,
    });
  }

  const bp = data.branchProducts.find((b) => b.branchId === branchId && b.productId === product.id);
  const effectivePrice = bp?.priceOverride ?? product.basePrice;
  const stock = bp?.stock ?? 50;

  const now = new Date().toISOString();
  const promo = data.promotions.find(
    (p) =>
      p.isActive &&
      p.supermarketId === branch.supermarketId &&
      p.startDate <= now &&
      p.endDate >= now &&
      (!p.branchId || p.branchId === branchId) &&
      p.productBarcodes.includes(product.barcode)
  );

  recordScanEvent(data, {
    createdAt: now,
    branchId: branch.id,
    supermarketId: branch.supermarketId,
    success: true,
  });
  db.save();

  res.json({
    product: {
      ...product,
      aisle: bp?.aisleOverride || product.aisle || 'Aisle 1',
      shelf: bp?.shelfOverride || product.shelf || 'Shelf A',
      aisleShelf: `${bp?.aisleOverride || product.aisle || 'Aisle 1'}, ${bp?.shelfOverride || product.shelf || 'Shelf A'}`,
    },
    effectivePrice,
    stock,
    isLowStock: stock <= (bp?.lowStockThresholdOverride ?? product.lowStockThreshold ?? 10),
    activePromotion: promo || null,
  });
});

// Signed-in shopper-only Price Check & Same-Supermarket Branch Compare endpoint
// Strictly rate-limited, never exposes stock/cost data, and never shows other supermarkets' branches
const handleShopperPriceCheck = (req: Request, res: Response) => {
  const body = req.method === 'GET' ? req.query : req.body;
  const branchId = typeof body?.branchId === 'string' ? body.branchId.trim() : '';
  const barcode = typeof body?.barcode === 'string' ? body.barcode.trim() : '';

  if (!branchId || !barcode) {
    return res.status(400).json({ error: 'branchId and barcode are required' });
  }

  const data = db.getRaw();
  const branch = data.branches.find((b) => b.id === branchId && b.isActive);

  const valResult = validateBarcode(barcode);
  if (!valResult.isValid) {
    if (branch) {
      recordScanEvent(data, {
        createdAt: new Date().toISOString(),
        branchId: branch.id,
        supermarketId: branch.supermarketId,
        success: false,
      });
      db.save();
    }
    return res.status(400).json({
      error: valResult.error || 'Invalid barcode check digit or format',
      format: valResult.format,
    });
  }

  if (!branch) {
    return res.status(404).json({ error: 'Active store branch not found' });
  }

  const supermarket = data.supermarkets.find((s) => s.id === branch.supermarketId);
  if (!supermarket || supermarket.status !== 'active') {
    return res.status(404).json({ error: 'Store branch is currently unavailable' });
  }

  const product = data.products.find(
    (p) => p.supermarketId === branch.supermarketId && p.barcode === barcode
  );

  if (!product) {
    recordScanEvent(data, {
      createdAt: new Date().toISOString(),
      branchId: branch.id,
      supermarketId: branch.supermarketId,
      success: false,
    });
    db.save();
    return res.status(404).json({
      error: `Product with barcode ${barcode} is not in ${branch.name}'s catalogue.`,
      barcode,
    });
  }

  const bp = data.branchProducts.find((b) => b.branchId === branch.id && b.productId === product.id);
  const branchPrice = bp?.priceOverride ?? product.basePrice;
  const now = new Date().toISOString();

  const findActivePromoForBranch = (targetBranchId: string): Promotion | null =>
    data.promotions.find(
      (p) =>
        p.isActive &&
        p.supermarketId === branch.supermarketId &&
        p.startDate <= now &&
        p.endDate >= now &&
        (!p.branchId || p.branchId === targetBranchId) &&
        p.productBarcodes.includes(product.barcode)
    ) || null;

  const activePromotion = findActivePromoForBranch(branch.id);
  const finalPrice = computeSingleUnitPromoFinalPrice(branchPrice, activePromotion);

  const effectiveAisle = (bp?.aisleOverride || product.aisle || '').trim();
  const effectiveShelf = (bp?.shelfOverride || product.shelf || '').trim();
  const safeProduct: PriceCheckProductInfo = {
    id: product.id,
    supermarketId: product.supermarketId,
    barcode: product.barcode,
    barcodeFormat: product.barcodeFormat,
    name: product.name,
    nameSwahili: product.nameSwahili,
    category: product.category,
    basePrice: product.basePrice,
    unit: product.unit,
    aisle: effectiveAisle,
    shelf: effectiveShelf,
    aisleShelf: [effectiveAisle, effectiveShelf].filter(Boolean).join(', '),
    imageUrl: product.imageUrl,
  };

  // Compare ONLY active branches within the SAME supermarket chain — never other supermarkets, never stock/cost
  const sameChainBranches = data.branches.filter(
    (b) => b.supermarketId === branch.supermarketId && b.isActive
  );

  const compareBranches: PriceCheckBranchCompareItem[] = sameChainBranches
    .map((b) => {
      const otherBp = data.branchProducts.find(
        (entry) => entry.branchId === b.id && entry.productId === product.id
      );
      const bPrice = otherBp?.priceOverride ?? product.basePrice;
      const bPromo = findActivePromoForBranch(b.id);
      const bFinal = computeSingleUnitPromoFinalPrice(bPrice, bPromo);
      return {
        branchId: b.id,
        branchName: b.name,
        city: b.city,
        branchPrice: bPrice,
        finalPrice: bFinal,
        activePromotion: bPromo,
        isCurrentBranch: b.id === branch.id,
      };
    })
    .sort((a, b) => {
      if (a.isCurrentBranch !== b.isCurrentBranch) return a.isCurrentBranch ? -1 : 1;
      if (a.finalPrice !== b.finalPrice) return a.finalPrice - b.finalPrice;
      return a.branchName.localeCompare(b.branchName);
    });

  recordScanEvent(data, {
    createdAt: now,
    branchId: branch.id,
    supermarketId: branch.supermarketId,
    success: true,
  });
  db.save();

  const responsePayload: PriceCheckResponse = {
    product: safeProduct,
    branchPrice,
    effectivePrice: branchPrice,
    finalPrice,
    activePromotion,
    compareBranches,
  };

  return res.json(responsePayload);
};

app.post(
  '/api/shopper/price-check',
  priceCheckRateLimiter,
  requireAuth,
  requireRole(['shopper']),
  handleShopperPriceCheck
);

app.get(
  '/api/shopper/price-check',
  priceCheckRateLimiter,
  requireAuth,
  requireRole(['shopper']),
  handleShopperPriceCheck
);

// ==========================================
// 4. LIVE CART OPERATIONS & OFFLINE SYNC
// ==========================================

const buildServerCartSummary = (
  data: ReturnType<typeof db.getRaw>,
  cart: Cart,
  callerUser: User | null
) => {
  const sm = data.supermarkets.find((s) => s.id === cart.supermarketId);
  const br = data.branches.find((b) => b.id === cart.branchId);
  const itemCount = cart.items.reduce((sum, it) => sum + (it.quantity || 1), 0);

  let loyaltyEarnedOnCart: number | null = null;
  let loyaltyBalance: number | null = null;

  if (
    callerUser &&
    callerUser.role === 'shopper' &&
    callerUser.status === 'active' &&
    cart.shopperId === callerUser.id
  ) {
    ensureLoyaltyContainers(data);
    loyaltyEarnedOnCart =
      typeof cart.loyaltyPointsEarned === 'number' && cart.loyaltyPointsEarned > 0
        ? cart.loyaltyPointsEarned
        : null;
    loyaltyBalance = getLedgerBalance(data, callerUser.id);
  }

  return {
    cartId: cart.id,
    shortCode: cart.shortCode,
    status: cart.status,
    itemCount,
    lineItemCount: cart.items.length,
    subtotal: cart.subtotal,
    totalDiscount: cart.totalDiscount,
    finalTotal: cart.finalTotal,
    branchId: cart.branchId,
    branchName: br?.name || '',
    supermarketName: sm?.name || '',
    loyaltyEarnedOnCart,
    loyaltyBalance,
  };
};

app.get('/api/shopper/cart', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { branchId, cartId } = req.query;
  const data = db.getRaw();

  if (cartId && typeof cartId === 'string') {
    const specificCart = data.carts.find((c) => c.id === cartId);
    if (!specificCart) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    if (!canAccessCart(user, specificCart, callerId)) {
      return res.status(403).json({ error: 'Forbidden: You cannot view another shopper\'s cart.' });
    }
    return res.json(specificCart);
  }

  let cart = data.carts.find(
    (c) =>
      c.shopperId === callerId &&
      c.status === 'active' &&
      (!branchId || c.branchId === branchId)
  );

  if (!cart && branchId) {
    const branch = data.branches.find((b) => b.id === branchId);
    if (branch) {
      const defaultCap =
        user?.role === 'shopper' && typeof user.defaultBudgetKes === 'number' && user.defaultBudgetKes > 0
          ? user.defaultBudgetKes
          : null;
      cart = {
        id: `cart_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        shortCode: generateShortCode(branch.id),
        shopperId: callerId,
        shopperName: user?.name || 'Guest Shopper',
        shopperPhone: user?.phone || '',
        supermarketId: branch.supermarketId,
        branchId: branch.id,
        status: 'active',
        items: [],
        subtotal: 0,
        totalDiscount: 0,
        finalTotal: 0,
        budgetLimit: defaultCap,
        budgetSummary: computeBudgetSummary(0, defaultCap),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      data.carts.push(cart);
      db.save();
    }
  }

  if (cart && !cart.budgetSummary) {
    cart.budgetSummary = computeBudgetSummary(cart.finalTotal, cart.budgetLimit);
  }

  res.json(cart || null);
});

// Start a fresh active empty cart (used after finishing a cart on the Goodbye screen)
app.post('/api/shopper/cart/new', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { branchId } = req.body || {};
  if (!branchId || typeof branchId !== 'string') {
    return res.status(400).json({ error: 'branchId is required' });
  }

  const data = db.getRaw();
  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  const defaultCap =
    user?.role === 'shopper' && typeof user.defaultBudgetKes === 'number' && user.defaultBudgetKes > 0
      ? user.defaultBudgetKes
      : null;

  const existingEmpty = data.carts.find(
    (c) =>
      c.shopperId === callerId &&
      c.branchId === branch.id &&
      c.status === 'active' &&
      c.items.length === 0
  );
  if (existingEmpty) {
    if ((existingEmpty.budgetLimit === null || existingEmpty.budgetLimit === undefined) && defaultCap !== null) {
      existingEmpty.budgetLimit = defaultCap;
      existingEmpty.budgetSummary = computeBudgetSummary(existingEmpty.finalTotal, defaultCap);
      db.save();
    } else if (!existingEmpty.budgetSummary) {
      existingEmpty.budgetSummary = computeBudgetSummary(existingEmpty.finalTotal, existingEmpty.budgetLimit);
    }
    return res.json(existingEmpty);
  }

  const newCart: Cart = {
    id: `cart_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    shortCode: generateShortCode(branch.id),
    shopperId: callerId,
    shopperName: user?.name || 'Guest Shopper',
    shopperPhone: user?.phone || '',
    supermarketId: branch.supermarketId,
    branchId: branch.id,
    status: 'active',
    items: [],
    subtotal: 0,
    totalDiscount: 0,
    finalTotal: 0,
    budgetLimit: defaultCap,
    budgetSummary: computeBudgetSummary(0, defaultCap),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  data.carts.push(newCart);
  db.save();

  res.json(newCart);
});

// Server-authoritative summary for an owned cart (active, locked, verified, or completed)
app.get('/api/shopper/cart/summary', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { cartId, branchId } = req.query;
  const data = db.getRaw();

  let cart: Cart | undefined;
  if (cartId && typeof cartId === 'string') {
    cart = data.carts.find((c) => c.id === cartId);
    if (!cart) return res.status(404).json({ error: 'Cart not found' });
    if (!canAccessCart(user, cart, callerId)) {
      return res.status(403).json({ error: 'Forbidden: You cannot view another shopper\'s cart.' });
    }
  } else {
    cart = data.carts
      .filter(
        (c) =>
          c.shopperId === callerId &&
          c.items.length > 0 &&
          (!branchId || c.branchId === branchId)
      )
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    if (!cart) return res.status(404).json({ error: 'No recent shopping cart found.' });
  }

  return res.json({
    cart,
    summary: buildServerCartSummary(data, cart, user),
  });
});

// Add item with permanent locked price
app.post('/api/shopper/cart/add', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { branchId, barcode, quantity = 1, cartId } = req.body;
  if (!branchId || !barcode) {
    return res.status(400).json({ error: 'branchId and barcode are required' });
  }

  const cleanBarcode = barcode.trim();
  const data = db.getRaw();
  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  const product = data.products.find(
    (p) => p.supermarketId === branch.supermarketId && p.barcode === cleanBarcode
  );
  if (!product) {
    recordScanEvent(data, {
      createdAt: new Date().toISOString(),
      branchId: branch.id,
      supermarketId: branch.supermarketId,
      success: false,
    });
    db.save();
    return res.status(404).json({ error: `Product with barcode ${cleanBarcode} not found.` });
  }

  const bp = data.branchProducts.find((b) => b.branchId === branchId && b.productId === product.id);
  const currentBranchPrice = bp?.priceOverride ?? product.basePrice;

  let cart: Cart | undefined;
  if (cartId) {
    cart = data.carts.find((c) => c.id === cartId);
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }
    if (!canAccessCart(user, cart, callerId)) {
      return res.status(403).json({ error: 'Forbidden: You cannot modify another shopper\'s cart.' });
    }
    if (cart.status !== 'active') {
      return res.status(400).json({ error: 'This cart is closed and cannot be modified. Start a new cart instead.' });
    }
  }

  if (!cart) {
    cart = data.carts.find(
      (c) =>
        c.shopperId === callerId &&
        c.branchId === branchId &&
        c.status === 'active'
    );
  }

  if (!cart) {
    const defaultCap =
      user?.role === 'shopper' && typeof user.defaultBudgetKes === 'number' && user.defaultBudgetKes > 0
        ? user.defaultBudgetKes
        : null;
    cart = {
      id: `cart_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      shortCode: generateShortCode(branchId),
      shopperId: callerId,
      shopperName: user?.name || 'Guest Shopper',
      shopperPhone: user?.phone || '',
      supermarketId: branch.supermarketId,
      branchId: branch.id,
      status: 'active',
      items: [],
      subtotal: 0,
      totalDiscount: 0,
      finalTotal: 0,
      budgetLimit: defaultCap,
      budgetSummary: computeBudgetSummary(0, defaultCap),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.carts.push(cart);
  }

  const effectiveAisle = (bp?.aisleOverride || product.aisle || '').trim();
  const effectiveShelf = (bp?.shelfOverride || product.shelf || '').trim();
  const existingItem = cart.items.find((i) => i.barcode === cleanBarcode);
  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    const newItem: CartItem = {
      id: `ci_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      productId: product.id,
      barcode: product.barcode,
      name: product.name,
      category: product.category,
      aisle: effectiveAisle,
      shelf: effectiveShelf,
      aisleShelf: [effectiveAisle, effectiveShelf].filter(Boolean).join(', '),
      quantity,
      lockedPrice: currentBranchPrice,
      originalBasePrice: product.basePrice,
      discount: 0,
      effectiveTotal: currentBranchPrice * quantity,
      scannedAt: new Date().toISOString(),
      verifiedByCashier: false,
    };
    cart.items.push(newItem);
  }

  recalculateCart(cart, branchId, data.promotions);

  // Auto-tick matching unticked shopping list items owned/editable by this shopper
  const nowIso = new Date().toISOString();
  for (const list of data.shoppingLists || []) {
    const canEditList =
      list.userId === callerId ||
      (list.canEdit && Array.isArray(list.collaboratorIds) && list.collaboratorIds.includes(callerId));
    if (!canEditList) continue;

    let listChanged = false;
    for (const listItem of list.items) {
      if (!listItem.completed && doesProductMatchListItem(listItem, product)) {
        listItem.completed = true;
        if (!listItem.barcode) listItem.barcode = product.barcode;
        listChanged = true;
      }
    }
    if (listChanged) {
      list.updatedAt = nowIso;
    }
  }

  recordScanEvent(data, {
    createdAt: nowIso,
    branchId: branch.id,
    supermarketId: branch.supermarketId,
    success: true,
  });
  db.save();

  res.json(cart);
});

// Update item quantity with ownership verification & closed-cart lock guard
app.put('/api/shopper/cart/quantity', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { cartId, itemId, quantity } = req.body;
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  // Ownership verification: shopper can only modify their own cart
  if (!canAccessCart(user, cart, callerId)) {
    return res.status(403).json({ error: 'Forbidden: You cannot modify another shopper\'s cart.' });
  }

  if (cart.status !== 'active') {
    return res.status(400).json({ error: 'This cart is closed and cannot be modified.' });
  }

  const itemIndex = cart.items.findIndex((i) => i.id === itemId);
  if (itemIndex === -1) return res.status(404).json({ error: 'Item not in cart' });

  if (quantity <= 0) {
    cart.items.splice(itemIndex, 1);
  } else {
    cart.items[itemIndex].quantity = quantity;
  }

  recalculateCart(cart, cart.branchId, data.promotions);
  db.save();

  res.json(cart);
});

// Get or save default shopper budget (signed-in shoppers only)
app.get('/api/shopper/default-budget', requireAuth, requireRole(['shopper']), (req, res) => {
  const user = (req as any).user as User;
  res.json({ defaultBudgetKes: user.defaultBudgetKes ?? null });
});

app.put('/api/shopper/default-budget', requireAuth, requireRole(['shopper']), (req, res) => {
  const user = (req as any).user as User;
  const { defaultBudgetKes } = req.body || {};

  let normalizedBudget: number | null = null;
  if (defaultBudgetKes !== null && defaultBudgetKes !== undefined && defaultBudgetKes !== '') {
    const parsed = Number(defaultBudgetKes);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10000000) {
      return res.status(400).json({ error: 'Default budget must be a positive number in KES.' });
    }
    normalizedBudget = Math.round(parsed * 100) / 100;
  }

  const data = db.getRaw();
  const dbUser = data.users.find((u) => u.id === user.id);
  if (!dbUser) return res.status(404).json({ error: 'User not found' });

  dbUser.defaultBudgetKes = normalizedBudget;
  db.save();
  res.json({ defaultBudgetKes: normalizedBudget });
});

// Set daily budget limit with ownership verification, closed-cart guard, & server-computed budget summary
app.post('/api/shopper/cart/budget', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { cartId, budgetLimit } = req.body || {};
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  // Ownership verification
  if (!canAccessCart(user, cart, callerId)) {
    return res.status(403).json({ error: 'Forbidden: You cannot modify another shopper\'s cart.' });
  }

  if (cart.status !== 'active') {
    return res.status(400).json({ error: 'This cart is closed and cannot be modified.' });
  }

  let normalizedLimit: number | null = null;
  if (budgetLimit !== null && budgetLimit !== undefined && budgetLimit !== '') {
    const parsed = Number(budgetLimit);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10000000) {
      return res.status(400).json({ error: 'Budget limit must be a positive number in KES.' });
    }
    normalizedLimit = Math.round(parsed * 100) / 100;
  }

  cart.budgetLimit = normalizedLimit;
  // Always compute totals & budget status using server's locked prices (never browser values)
  recalculateCart(cart, cart.branchId, data.promotions);
  db.save();
  res.json(cart);
});

// Shared idempotent cart closing helper used by both /lock and /finish
const closeShopperCart = (
  data: ReturnType<typeof db.getRaw>,
  cart: Cart,
  callerUser: User | null
) => {
  const alreadyClosed = cart.status !== 'active';
  const nowIso = new Date().toISOString();

  if (cart.status === 'active') {
    cart.status = 'locked';
    if (!cart.shortCode) cart.shortCode = generateShortCode(cart.branchId);
    cart.finishedAt = cart.finishedAt || nowIso;
    cart.updatedAt = nowIso;
    db.save();
  } else {
    if (!cart.shortCode) {
      cart.shortCode = generateShortCode(cart.branchId);
      db.save();
    }
    if (!cart.finishedAt) {
      cart.finishedAt = nowIso;
      db.save();
    }
  }

  return {
    alreadyClosed,
    cart,
    summary: buildServerCartSummary(data, cart, callerUser),
  };
};

// Lock cart & get till shortcode with ownership verification
app.post('/api/shopper/cart/lock', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { cartId } = req.body || {};
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  // Ownership verification
  if (!canAccessCart(user, cart, callerId)) {
    return res.status(403).json({ error: 'Forbidden: You cannot lock another shopper\'s cart.' });
  }

  if (cart.items.length === 0) {
    return res.status(400).json({ error: 'Cannot checkout an empty cart.' });
  }
  if (cart.status === 'cancelled') {
    return res.status(400).json({ error: 'Cancelled cart cannot be finished.' });
  }

  const closed = closeShopperCart(data, cart, user);
  res.json(closed.cart);
});

// Finish shopping cleanly & idempotently -> closes cart & returns authoritative server summary
app.post('/api/shopper/cart/finish', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { cartId } = req.body || {};
  if (!cartId || typeof cartId !== 'string') {
    return res.status(400).json({ error: 'cartId is required' });
  }

  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  // Ownership verification
  if (!canAccessCart(user, cart, callerId)) {
    return res.status(403).json({ error: 'Forbidden: You cannot finish another shopper\'s cart.' });
  }

  if (cart.items.length === 0) {
    return res.status(400).json({ error: 'Cannot finish an empty cart.' });
  }
  if (cart.status === 'cancelled') {
    return res.status(400).json({ error: 'Cancelled cart cannot be finished.' });
  }

  const closed = closeShopperCart(data, cart, user);
  res.json({
    success: true,
    alreadyClosed: closed.alreadyClosed,
    cart: closed.cart,
    summary: closed.summary,
  });
});

// Offline Sync Endpoint: seamlessly merges an offline created/scanned cart with ownership check
app.post('/api/shopper/cart/sync', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const payload = req.body?.offlineCart || req.body;
  const branchId = payload?.branchId;
  if (!payload || !branchId) {
    return res.status(400).json({ error: 'Invalid offline cart data' });
  }

  const data = db.getRaw();
  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  const requestedCartId = payload.cartId || payload.id;
  let serverCart = requestedCartId
    ? data.carts.find((c) => c.id === requestedCartId)
    : undefined;

  if (serverCart && !canAccessCart(user, serverCart, callerId)) {
    return res.status(403).json({ error: 'Forbidden: You cannot sync into another shopper\'s cart.' });
  }

  // Never allow client sync to alter or forge an already closed/verified/completed/flagged/cancelled cart
  if (
    serverCart &&
    (serverCart.status === 'locked' ||
      serverCart.status === 'verified' ||
      serverCart.status === 'completed' ||
      serverCart.status === 'flagged' ||
      serverCart.status === 'cancelled')
  ) {
    return res.status(400).json({ error: 'Cannot modify a cart that has already been closed, verified, or finalized.' });
  }

  // Strictly limit client-supplied cart status to shopper-owned pre-till states only
  const safeClientStatus: Cart['status'] = payload.status === 'locked' ? 'locked' : 'active';

  if (!serverCart) {
    serverCart = data.carts.find(
      (c) =>
        c.shopperId === callerId &&
        c.branchId === branchId &&
        c.status === 'active'
    );
  }

  const normalizeSyncedItems = (rawItems: any[]): CartItem[] => {
    const sanitized: CartItem[] = [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue;
      const qty = Math.max(1, Math.round(Number(raw.quantity) || 1));
      const matchedProd = data.products.find(
        (p) =>
          p.supermarketId === branch.supermarketId &&
          ((raw.barcode && p.barcode === String(raw.barcode).trim()) ||
            (raw.productId && p.id === raw.productId))
      );
      if (matchedProd) {
        const bp = data.branchProducts.find(
          (b) => b.branchId === branch.id && b.productId === matchedProd.id
        );
        const authoritativePrice = bp?.priceOverride ?? matchedProd.basePrice;
        const effectiveAisle = (bp?.aisleOverride || matchedProd.aisle || '').trim();
        const effectiveShelf = (bp?.shelfOverride || matchedProd.shelf || '').trim();
        sanitized.push({
          id: typeof raw.id === 'string' && raw.id ? raw.id : `ci_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          productId: matchedProd.id,
          barcode: matchedProd.barcode,
          name: matchedProd.name,
          category: matchedProd.category,
          aisle: effectiveAisle,
          shelf: effectiveShelf,
          aisleShelf: [effectiveAisle, effectiveShelf].filter(Boolean).join(', '),
          quantity: qty,
          lockedPrice: authoritativePrice,
          originalBasePrice: matchedProd.basePrice,
          discount: 0,
          effectiveTotal: authoritativePrice * qty,
          scannedAt: typeof raw.scannedAt === 'string' ? raw.scannedAt : new Date().toISOString(),
          verifiedByCashier: false,
        });
      }
    }
    return sanitized;
  };

  const parsedBudget =
    payload.budgetLimit !== undefined && payload.budgetLimit !== null && payload.budgetLimit !== ''
      ? Number(payload.budgetLimit)
      : null;
  const safeBudgetLimit =
    parsedBudget !== null && Number.isFinite(parsedBudget) && parsedBudget > 0 ? parsedBudget : null;

  if (!serverCart) {
    serverCart = {
      id: requestedCartId && !String(requestedCartId).startsWith('offline-cart-')
        ? requestedCartId
        : `cart_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      shortCode: generateShortCode(branch.id),
      shopperId: callerId,
      shopperName: user?.name || payload.shopperName || 'Guest Shopper',
      shopperPhone: user?.phone || payload.shopperPhone || '',
      supermarketId: branch.supermarketId,
      branchId: branch.id,
      status: safeClientStatus,
      items: Array.isArray(payload.items) ? normalizeSyncedItems(payload.items) : [],
      subtotal: 0,
      totalDiscount: 0,
      finalTotal: 0,
      budgetLimit: safeBudgetLimit,
      isOfflineCreated: true,
      syncedAt: new Date().toISOString(),
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.carts.push(serverCart);
  } else {
    if (Array.isArray(payload.items)) serverCart.items = normalizeSyncedItems(payload.items);
    if (payload.budgetLimit !== undefined) serverCart.budgetLimit = safeBudgetLimit;
    serverCart.status = safeClientStatus;
    serverCart.isOfflineCreated = true;
    serverCart.syncedAt = new Date().toISOString();
  }

  recalculateCart(serverCart, serverCart.branchId, data.promotions);
  db.save();

  res.json(req.body?.offlineCart ? { success: true, cart: serverCart } : serverCart);
});

app.delete('/api/shopper/cart/:id', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === req.params.id);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  if (!canAccessCart(user, cart, callerId)) {
    return res.status(403).json({ error: 'Forbidden: You cannot modify another shopper\'s cart.' });
  }

  if (cart.status !== 'active') {
    return res.status(400).json({ error: 'This cart is closed and cannot be cleared.' });
  }

  cart.items = [];
  recalculateCart(cart, cart.branchId, data.promotions);
  cart.status = 'active';
  db.save();
  return res.json(cart);
});

// ==========================================
// 5. SHOPPER PHASE 2: HISTORY & RE-ADD, FAVOURITES, LISTS
// ==========================================

const buildShopperReceiptSummary = (c: Cart, data: ReturnType<typeof db.getRaw>) => {
  const sm = data.supermarkets.find((s) => s.id === c.supermarketId);
  const br = data.branches.find((b) => b.id === c.branchId);
  const verifier = c.verifiedByStaffId
    ? data.users.find((u) => u.id === c.verifiedByStaffId)
    : undefined;
  const itemCount = c.items.reduce((sum, it) => sum + (it.quantity || 1), 0);
  return {
    ...c,
    supermarketName: sm?.name || 'Supermarket',
    branchName: br?.name || 'Branch',
    branchAddress: br?.address || '',
    branchCity: br?.city || '',
    verifiedByName: verifier?.name || undefined,
    itemCount,
    noPaymentInApp: true,
  };
};

// Shopper Past Receipts (authenticated shopper completed/verified transaction summaries)
app.get('/api/shopper/receipts', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const data = db.getRaw();
  const receipts = data.carts
    .filter((c) => c.shopperId === user.id && (c.status === 'completed' || c.status === 'verified'))
    .sort(
      (a, b) =>
        new Date(b.verifiedAt || b.updatedAt || b.createdAt).getTime() -
        new Date(a.verifiedAt || a.updatedAt || a.createdAt).getTime()
    )
    .map((c) => buildShopperReceiptSummary(c, data));
  res.json({ receipts });
});

// Shopper past cart history (authenticated)
app.get('/api/shopper/history', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const data = db.getRaw();
  const history = data.carts
    .filter((c) => c.shopperId === user.id && (c.status === 'completed' || c.status === 'verified'))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((c) => buildShopperReceiptSummary(c, data));
  res.json(history);
});

// Past purchases for signed-in shoppers or browser-keyed guests (used by list builder)
app.get('/api/shopper/past-purchases', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const data = db.getRaw();
  const history = data.carts
    .filter((c) => c.shopperId === callerId && (c.status === 'completed' || c.status === 'verified'))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(history);
});

// Aggregated unique product purchase history across previous completed/verified carts
app.get('/api/shopper/product-history', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const branchId = (req.query.branchId as string) || '';
  const data = db.getRaw();

  const pastCarts = data.carts
    .filter((c) => c.shopperId === callerId && (c.status === 'completed' || c.status === 'verified'))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());

  const branch = branchId ? data.branches.find((b) => b.id === branchId) : undefined;
  const productMap = new Map<string, any>();

  for (const cart of pastCarts) {
    const cartDate = cart.updatedAt || cart.createdAt;
    for (const item of cart.items) {
      const existing = productMap.get(item.barcode);
      const liveProd = branch
        ? data.products.find((p) => p.supermarketId === branch.supermarketId && p.barcode === item.barcode)
        : data.products.find((p) => p.barcode === item.barcode);
      const bp = branch && liveProd
        ? data.branchProducts.find((b) => b.branchId === branch.id && b.productId === liveProd.id)
        : undefined;

      const currentBranchPrice = bp?.priceOverride ?? liveProd?.basePrice ?? item.lockedPrice;
      const aisle = bp?.aisleOverride || liveProd?.aisle || item.aisle || 'Aisle 1';
      const shelf = bp?.shelfOverride || liveProd?.shelf || item.shelf || 'Shelf A';

      if (!existing) {
        productMap.set(item.barcode, {
          barcode: item.barcode,
          productId: liveProd?.id || item.productId,
          name: liveProd?.name || item.name,
          category: liveProd?.category || item.category || 'General',
          aisle,
          shelf,
          lastPurchasedAt: cartDate,
          purchaseCount: 1,
          totalQuantityPurchased: item.quantity,
          lastPrice: item.lockedPrice,
          currentBranchPrice,
        });
      } else {
        existing.purchaseCount += 1;
        existing.totalQuantityPurchased += item.quantity;
        if (new Date(cartDate).getTime() > new Date(existing.lastPurchasedAt).getTime()) {
          existing.lastPurchasedAt = cartDate;
          existing.lastPrice = item.lockedPrice;
        }
      }
    }
  }

  const results = Array.from(productMap.values()).sort(
    (a, b) => new Date(b.lastPurchasedAt).getTime() - new Date(a.lastPurchasedAt).getTime()
  );
  res.json(results);
});

// Re-add items from a past cart into active cart (works for signed-in or guest shopper)
app.post('/api/shopper/cart/re-add', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { pastCartId, targetBranchId, cartId, branchId: reqBranchId } = req.body;
  const resolvedPastCartId = pastCartId || cartId;
  const data = db.getRaw();

  const pastCart = data.carts.find((c) => c.id === resolvedPastCartId && c.shopperId === callerId);
  if (!pastCart) return res.status(404).json({ error: 'Past cart not found' });

  const branchId = targetBranchId || reqBranchId || pastCart.branchId;
  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  let activeCart = data.carts.find(
    (c) => c.shopperId === callerId && c.branchId === branchId && c.status === 'active'
  );

  if (!activeCart) {
    activeCart = {
      id: `cart_${Date.now()}`,
      shortCode: generateShortCode(branchId),
      shopperId: callerId,
      shopperName: user?.name || 'Guest Shopper',
      shopperPhone: user?.phone || '',
      supermarketId: branch.supermarketId,
      branchId: branch.id,
      status: 'active',
      items: [],
      subtotal: 0,
      totalDiscount: 0,
      finalTotal: 0,
      budgetLimit: pastCart.budgetLimit || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.carts.push(activeCart);
  }

  // Add items from past cart, locking current branch prices
  pastCart.items.forEach((item) => {
    const prod = data.products.find((p) => p.supermarketId === branch.supermarketId && p.barcode === item.barcode)
      || data.products.find((p) => p.barcode === item.barcode);
    if (!prod) return;

    const bp = data.branchProducts.find((b) => b.branchId === branchId && b.productId === prod.id);
    const effectivePrice = bp?.priceOverride ?? prod.basePrice;

    const existing = activeCart!.items.find((i) => i.barcode === item.barcode);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      activeCart!.items.push({
        id: `ci_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        productId: prod.id,
        barcode: prod.barcode,
        name: prod.name,
        category: prod.category,
        aisle: bp?.aisleOverride || prod.aisle || 'Aisle 1',
        shelf: bp?.shelfOverride || prod.shelf || 'Shelf A',
        aisleShelf: `${bp?.aisleOverride || prod.aisle || 'Aisle 1'}, ${bp?.shelfOverride || prod.shelf || 'Shelf A'}`,
        quantity: item.quantity,
        lockedPrice: effectivePrice,
        originalBasePrice: prod.basePrice,
        discount: 0,
        effectiveTotal: effectivePrice * item.quantity,
        scannedAt: new Date().toISOString(),
        verifiedByCashier: false,
      });
    }
  });

  recalculateCart(activeCart, branchId, data.promotions);
  db.save();

  res.json({ success: true, cart: activeCart });
});

// Favourites: Get and Toggle
app.get('/api/shopper/favourites', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const branchId = (req.query.branchId as string) || '';
  const data = db.getRaw();
  const userFavs = data.favourites?.[user.id] || [];

  const branch = data.branches.find((b) => b.id === branchId);
  const products = data.products
    .filter((p) => userFavs.includes(p.barcode))
    .map((p) => {
      let branchPrice = p.basePrice;
      let aisle = p.aisle;
      let shelf = p.shelf;
      if (branch) {
        const bp = data.branchProducts.find((b) => b.branchId === branchId && b.productId === p.id);
        if (bp?.priceOverride !== null && bp?.priceOverride !== undefined) {
          branchPrice = bp.priceOverride;
        }
        if (bp?.aisleOverride) aisle = bp.aisleOverride;
        if (bp?.shelfOverride) shelf = bp.shelfOverride;
      }
      return {
        ...p,
        aisle,
        shelf,
        aisleShelf: `${aisle}, ${shelf}`,
        effectivePrice: branchPrice,
        isFavourite: true,
      };
    });

  res.json({ barcodes: userFavs, products });
});

app.post('/api/shopper/favourites/toggle', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const { barcode } = req.body;
  if (!barcode) return res.status(400).json({ error: 'Barcode required' });

  const data = db.getRaw();
  if (!data.favourites) data.favourites = {};
  if (!data.favourites[user.id]) data.favourites[user.id] = [];

  const index = data.favourites[user.id].indexOf(barcode);
  let isFavourite = false;
  if (index !== -1) {
    data.favourites[user.id].splice(index, 1);
  } else {
    data.favourites[user.id].push(barcode);
    isFavourite = true;
  }
  db.save();

  res.json({ success: true, isFavourite, favourites: data.favourites[user.id] });
});

function generateListShareCode(existingLists: ShoppingList[]): string {
  const used = new Set(existingLists.map((l) => l.shareCode.toUpperCase()));
  for (let i = 0; i < 30; i++) {
    const code = `LIST-${crypto.randomInt(1000, 10000)}`;
    if (!used.has(code)) return code;
  }
  return `LIST-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function enrichListItemFromBranch(
  rawItem: {
    barcode?: string;
    productName: string;
    category?: string;
    quantity?: number;
    aisle?: string;
    shelf?: string;
    estimatedPrice?: number;
  },
  branchId: string | undefined,
  data: ReturnType<typeof db.getRaw>
) {
  const branch = branchId ? data.branches.find((b) => b.id === branchId) : undefined;
  let product: Product | undefined;
  if (rawItem.barcode) {
    product = branch
      ? data.products.find((p) => p.supermarketId === branch.supermarketId && p.barcode === rawItem.barcode)
      : data.products.find((p) => p.barcode === rawItem.barcode);
  } else if (branch && rawItem.productName) {
    const targetName = rawItem.productName.trim().toLowerCase();
    product = data.products.find(
      (p) => p.supermarketId === branch.supermarketId && p.name.trim().toLowerCase() === targetName
    );
  }
  const bp = branch && product
    ? data.branchProducts.find((b) => b.branchId === branch.id && b.productId === product!.id)
    : undefined;

  const resolvedAisle = (bp?.aisleOverride || product?.aisle || rawItem.aisle || '').trim();
  const resolvedShelf = (bp?.shelfOverride || product?.shelf || rawItem.shelf || '').trim();
  const resolvedCategory = (product?.category || rawItem.category || '').trim();

  return {
    id: `li_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    barcode: rawItem.barcode || product?.barcode,
    productName: product?.name || rawItem.productName,
    category: resolvedCategory || undefined,
    quantity: Math.max(1, Math.round(Number(rawItem.quantity) || 1)),
    completed: false,
    aisle: resolvedAisle || undefined,
    shelf: resolvedShelf || undefined,
    estimatedPrice: bp?.priceOverride ?? product?.basePrice ?? rawItem.estimatedPrice ?? 0,
  };
}

// Shareable Shopping Lists (Owned or Joined Collaborator Lists)
app.get('/api/shopper/shopping-lists', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const data = db.getRaw();
  const lists = (data.shoppingLists || [])
    .filter((l) => l.userId === callerId || (Array.isArray(l.collaboratorIds) && l.collaboratorIds.includes(callerId)))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  res.json(lists);
});

// Create a Shared Shopping List (blank, from previous purchase, or from product history)
app.post('/api/shopper/shopping-lists', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const {
    title,
    canEdit = true,
    items = [],
    sourceCartId,
    selectedBarcodes,
    branchId,
    sourceType,
  } = req.body;
  const data = db.getRaw();
  if (!data.shoppingLists) data.shoppingLists = [];

  let resolvedItems: any[] = [];
  let resolvedTitle = typeof title === 'string' && title.trim() ? title.trim() : '';
  let resolvedSourceType: ShoppingList['sourceType'] = sourceType || 'blank';

  if (sourceCartId) {
    const pastCart = data.carts.find(
      (c) => c.id === sourceCartId && (c.shopperId === callerId || user?.role === 'admin')
    );
    if (!pastCart) {
      return res.status(404).json({ error: 'Previous purchase not found.' });
    }
    resolvedSourceType = 'previous_purchase';
    if (!resolvedTitle) {
      resolvedTitle = `Restock (${pastCart.shortCode})`;
    }
    resolvedItems = pastCart.items.map((it) =>
      enrichListItemFromBranch(
        {
          barcode: it.barcode,
          productName: it.name,
          quantity: it.quantity,
          aisle: it.aisle,
          shelf: it.shelf,
          estimatedPrice: it.lockedPrice,
        },
        branchId || pastCart.branchId,
        data
      )
    );
  } else if (Array.isArray(selectedBarcodes) && selectedBarcodes.length > 0) {
    resolvedSourceType = 'product_history';
    if (!resolvedTitle) {
      resolvedTitle = `History List (${new Date().toLocaleDateString()})`;
    }
    const barcodeSet = new Set(selectedBarcodes.map((b: any) => String(b).trim()).filter(Boolean));
    const pastCarts = data.carts.filter((c) => c.shopperId === callerId && (c.status === 'completed' || c.status === 'verified'));

    const matchedByBarcode = new Map<string, any>();
    for (const c of pastCarts) {
      for (const it of c.items) {
        if (barcodeSet.has(it.barcode) && !matchedByBarcode.has(it.barcode)) {
          matchedByBarcode.set(it.barcode, it);
        }
      }
    }

    for (const bc of barcodeSet) {
      const fromHistory = matchedByBarcode.get(bc);
      const fromCatalog = data.products.find((p) => p.barcode === bc);
      if (fromHistory) {
        resolvedItems.push(
          enrichListItemFromBranch(
            {
              barcode: bc,
              productName: fromHistory.name,
              quantity: 1,
              aisle: fromHistory.aisle,
              shelf: fromHistory.shelf,
              estimatedPrice: fromHistory.lockedPrice,
            },
            branchId,
            data
          )
        );
      } else if (fromCatalog) {
        resolvedItems.push(
          enrichListItemFromBranch(
            {
              barcode: bc,
              productName: fromCatalog.name,
              quantity: 1,
              aisle: fromCatalog.aisle,
              shelf: fromCatalog.shelf,
              estimatedPrice: fromCatalog.basePrice,
            },
            branchId,
            data
          )
        );
      }
    }
  } else {
    resolvedItems = (Array.isArray(items) ? items : []).map((it: any) =>
      enrichListItemFromBranch(
        {
          barcode: it.barcode,
          productName: it.productName || 'Item',
          quantity: it.quantity || 1,
          aisle: it.aisle,
          shelf: it.shelf,
          estimatedPrice: it.estimatedPrice,
        },
        branchId,
        data
      )
    );
  }

  const shareCode = generateListShareCode(data.shoppingLists);
  const newList: ShoppingList = {
    id: `list_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    userId: callerId,
    ownerName: user?.name || 'Guest Shopper',
    collaboratorIds: [],
    sourceType: resolvedSourceType,
    sourceCartId: sourceCartId || undefined,
    title: resolvedTitle || 'My Shopping List',
    shareCode,
    canEdit: Boolean(canEdit),
    items: resolvedItems,
    createdAt: new Date().toISOString(),
  };

  data.shoppingLists.unshift(newList);
  db.save();

  res.json(newList);
});

// Join a shared shopping list via shareCode
app.post('/api/shopper/shopping-lists/join', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { shareCode } = req.body;

  if (!shareCode || typeof shareCode !== 'string' || !shareCode.trim()) {
    return res.status(400).json({ error: 'Share code is required.' });
  }

  const cleanCode = shareCode.trim().toUpperCase();
  const data = db.getRaw();
  const list = (data.shoppingLists || []).find((l) => l.shareCode.toUpperCase() === cleanCode);
  if (!list) {
    return res.status(404).json({ error: 'Shared shopping list not found for that code.' });
  }

  if (list.userId !== callerId) {
    if (!Array.isArray(list.collaboratorIds)) list.collaboratorIds = [];
    if (!list.collaboratorIds.includes(callerId)) {
      list.collaboratorIds.push(callerId);
      db.save();
    }
  }

  res.json(list);
});

app.put('/api/shopper/shopping-lists/:id', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { title, items, canEdit } = req.body;
  const data = db.getRaw();
  const list = (data.shoppingLists || []).find((l) => l.id === req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found' });

  const isOwner = list.userId === callerId;
  const isCollaborator = Array.isArray(list.collaboratorIds) && list.collaboratorIds.includes(callerId);

  if (!isOwner && !(list.canEdit && isCollaborator)) {
    return res.status(403).json({ error: 'You do not have permission to edit this list.' });
  }

  if (title !== undefined && isOwner && typeof title === 'string' && title.trim()) {
    list.title = title.trim();
  }
  if (items !== undefined && Array.isArray(items)) {
    list.items = items;
  }
  if (canEdit !== undefined && isOwner) {
    list.canEdit = Boolean(canEdit);
  }
  list.updatedAt = new Date().toISOString();
  db.save();

  res.json(list);
});

app.delete('/api/shopper/shopping-lists/:id', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const data = db.getRaw();
  if (!data.shoppingLists) data.shoppingLists = [];

  const idx = data.shoppingLists.findIndex((l) => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'List not found' });

  const list = data.shoppingLists[idx];
  if (list.userId !== callerId && user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only the list creator can delete this shared list.' });
  }

  data.shoppingLists.splice(idx, 1);
  db.save();
  res.json({ success: true });
});

app.get('/api/shopper/shopping-lists/share/:shareCode', (req, res) => {
  const data = db.getRaw();
  const list = (data.shoppingLists || []).find((l) => l.shareCode.toUpperCase() === req.params.shareCode.toUpperCase());
  if (!list) return res.status(404).json({ error: 'Shopping list not found with this code' });
  res.json(list);
});

// Convert Shopping List into Active Cart
app.post('/api/shopper/shopping-lists/convert-to-cart', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { listId, branchId } = req.body;
  if (!listId || !branchId) return res.status(400).json({ error: 'listId and branchId are required' });

  const data = db.getRaw();
  const list = (data.shoppingLists || []).find((l) => l.id === listId);
  if (!list) return res.status(404).json({ error: 'List not found' });

  const canUseList =
    list.userId === callerId || (Array.isArray(list.collaboratorIds) && list.collaboratorIds.includes(callerId));
  if (!canUseList && user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: You do not have access to this list.' });
  }

  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  let activeCart = data.carts.find(
    (c) => c.shopperId === callerId && c.branchId === branchId && (c.status === 'active' || c.status === 'locked')
  );

  if (!activeCart) {
    const defaultCap =
      user?.role === 'shopper' && typeof user.defaultBudgetKes === 'number' && user.defaultBudgetKes > 0
        ? user.defaultBudgetKes
        : null;
    activeCart = {
      id: `cart_${Date.now()}`,
      shortCode: generateShortCode(branchId),
      shopperId: callerId,
      shopperName: user?.name || 'Guest Shopper',
      shopperPhone: user?.phone || '',
      supermarketId: branch.supermarketId,
      branchId: branch.id,
      status: 'active',
      items: [],
      subtotal: 0,
      totalDiscount: 0,
      finalTotal: 0,
      budgetLimit: defaultCap,
      budgetSummary: computeBudgetSummary(0, defaultCap),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.carts.push(activeCart);
  }

  // Populate products
  let matchedCount = 0;
  list.items.forEach((item) => {
    let product: Product | undefined;
    if (item.barcode) {
      product = data.products.find((p) => p.supermarketId === branch.supermarketId && p.barcode === item.barcode);
    }
    if (!product) {
      product = data.products.find(
        (p) => p.supermarketId === branch.supermarketId && p.name.toLowerCase().includes(item.productName.toLowerCase())
      );
    }

    if (product) {
      matchedCount++;
      const bp = data.branchProducts.find((b) => b.branchId === branchId && b.productId === product!.id);
      const effectivePrice = bp?.priceOverride ?? product.basePrice;

      const existing = activeCart!.items.find((i) => i.barcode === product!.barcode);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        activeCart!.items.push({
          id: `ci_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          productId: product.id,
          barcode: product.barcode,
          name: product.name,
          category: product.category,
          aisle: bp?.aisleOverride || product.aisle || 'Aisle 1',
          shelf: bp?.shelfOverride || product.shelf || 'Shelf A',
          aisleShelf: `${bp?.aisleOverride || product.aisle || 'Aisle 1'}, ${bp?.shelfOverride || product.shelf || 'Shelf A'}`,
          quantity: item.quantity,
          lockedPrice: effectivePrice,
          originalBasePrice: product.basePrice,
          discount: 0,
          effectiveTotal: effectivePrice * item.quantity,
          scannedAt: new Date().toISOString(),
          verifiedByCashier: false,
        });
      }
    }
  });

  recalculateCart(activeCart, branchId, data.promotions);
  db.save();

  res.json({
    success: true,
    matchedCount,
    cart: activeCart,
    expectedTotal: activeCart.finalTotal,
  });
});

// ==========================================
// 6. CASHIER VERIFICATION FLOW
// ==========================================

app.get('/api/cashier/lookup/:shortCode', requireAuth, (req, res) => {
  const user = (req as any).user as User;

  // Block shoppers completely
  if (user.role === 'shopper') {
    return res.status(403).json({ error: 'Forbidden: Shoppers cannot access cashier verification.' });
  }

  // Verify staff permission
  if (user.role === 'staff' && !user.permissions?.verifyCarts) {
    return res.status(403).json({ error: 'Permission denied: Staff cannot verify carts.' });
  }

  const rawCode = req.params.shortCode.trim().toUpperCase();
  const data = db.getRaw();

  const matches = data.carts.filter(
    (c) => c.shortCode.toUpperCase() === rawCode || c.id.toUpperCase() === rawCode
  );
  if (matches.length === 0) {
    return res.status(404).json({ error: `No active cart found with code "${rawCode}".` });
  }

  const sortOpenFirst = (a: Cart, b: Cart) => {
    const aOpen = a.status !== 'completed' && a.status !== 'cancelled' ? 0 : 1;
    const bOpen = b.status !== 'completed' && b.status !== 'cancelled' ? 0 : 1;
    return aOpen - bOpen;
  };

  let cart: Cart | undefined;
  if (user.role === 'staff') {
    cart = matches.filter((c) => c.branchId === user.branchId).sort(sortOpenFirst)[0];
    if (!cart) {
      return res.status(403).json({ error: 'Forbidden: This cart belongs to a different branch.' });
    }
  } else if (user.role === 'owner') {
    cart = matches.filter((c) => c.supermarketId === user.supermarketId).sort(sortOpenFirst)[0];
    if (!cart) {
      return res.status(403).json({ error: 'Forbidden: This cart belongs to a different supermarket chain.' });
    }
  } else {
    cart = matches.sort(sortOpenFirst)[0];
  }

  const branch = data.branches.find((b) => b.id === cart.branchId);
  const supermarket = data.supermarkets.find((s) => s.id === cart.supermarketId);

  res.json({
    cart,
    branch,
    supermarket,
    isOfflineCreated: Boolean(cart.isOfflineCreated),
    syncedAt: cart.syncedAt,
  });
});

app.post('/api/cashier/toggle-check', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'shopper') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (user.role === 'staff' && !user.permissions?.verifyCarts) {
    return res.status(403).json({ error: 'Permission denied: Staff cannot verify carts.' });
  }

  const { cartId, itemId, checked } = req.body;
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  if (user.role === 'staff' && cart.branchId !== user.branchId) {
    return res.status(403).json({ error: 'Forbidden: Cart belongs to another branch.' });
  }
  if (user.role === 'owner' && cart.supermarketId !== user.supermarketId) {
    return res.status(403).json({ error: 'Forbidden: Cart belongs to another supermarket.' });
  }

  if (cart.status === 'completed') {
    return res.status(400).json({ error: 'Cart is already completed' });
  }

  const item = cart.items.find((i) => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Item not in cart' });

  item.verifiedByCashier = checked;
  db.save();
  res.json({ success: true, cart });
});

app.post('/api/cashier/flag', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'shopper') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (user.role === 'staff' && !user.permissions?.verifyCarts) {
    return res.status(403).json({ error: 'Permission denied: Staff cannot flag carts.' });
  }

  const { cartId, reason } = req.body;
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  if (user.role === 'staff' && cart.branchId !== user.branchId) {
    return res.status(403).json({ error: 'Forbidden: Cart belongs to another branch.' });
  }
  if (user.role === 'owner' && cart.supermarketId !== user.supermarketId) {
    return res.status(403).json({ error: 'Forbidden: Cart belongs to another supermarket.' });
  }

  if (cart.status === 'completed') {
    return res.status(400).json({ error: 'Cart is already completed' });
  }

  cart.status = 'flagged';
  cart.mismatchNotes = reason;
  cart.updatedAt = new Date().toISOString();

  // Reverse any loyalty points previously earned on this cart
  const reversedPts = reversePointsForCart(
    data,
    cart,
    user,
    `Cart ${cart.shortCode} flagged: ${reason || 'Mismatch reported'}`
  );

  logAudit(
    user,
    'CART_FLAGGED',
    'cart',
    cart.id,
    `Cart ${cart.shortCode} flagged for mismatch: ${reason}${reversedPts > 0 ? ` (reversed ${reversedPts} pts)` : ''}`,
    cart.supermarketId,
    cart.branchId
  );
  db.save();

  res.json({ success: true, cart, reversedPoints: reversedPts });
});

app.post('/api/cashier/verify', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'shopper') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (user.role === 'staff' && !user.permissions?.verifyCarts) {
    return res.status(403).json({ error: 'Permission denied: Staff cannot verify carts.' });
  }

  const { cartId } = req.body;
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  if (user.role === 'staff' && cart.branchId !== user.branchId) {
    return res.status(403).json({ error: 'Forbidden: Cart belongs to another branch.' });
  }
  if (user.role === 'owner' && cart.supermarketId !== user.supermarketId) {
    return res.status(403).json({ error: 'Forbidden: Cart belongs to another supermarket.' });
  }

  if (
    cart.status === 'completed' ||
    cart.status === 'verified' ||
    cart.status === 'cancelled' ||
    cart.status === 'flagged'
  ) {
    return res.status(400).json({ error: `Cart is already ${cart.status}` });
  }

  cart.status = 'verified';
  cart.verifiedByStaffId = user.id;
  cart.verifiedAt = new Date().toISOString();
  cart.updatedAt = new Date().toISOString();

  // Award Loyalty Points strictly on cashier verification (idempotent, configurable rates/caps/min spend)
  const pointsEarned = awardPointsForVerifiedCart(data, cart, user);

  logAudit(
    user,
    'CART_VERIFIED',
    'cart',
    cart.id,
    `Cart ${cart.shortCode} verified by ${user.name}${pointsEarned > 0 ? ` (+${pointsEarned} loyalty pts)` : ''}`,
    cart.supermarketId,
    cart.branchId
  );
  db.save();

  res.json({ success: true, cart, loyaltyPointsEarned: pointsEarned });
});

app.post('/api/cashier/complete', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'shopper') {
    return res.status(403).json({ error: 'Forbidden: Shoppers cannot complete checkouts.' });
  }
  if (user.role === 'staff' && !user.permissions?.verifyCarts) {
    return res.status(403).json({ error: 'Permission denied: Staff cannot complete checkouts.' });
  }

  const { cartId } = req.body;
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  if (user.role === 'staff' && cart.branchId !== user.branchId) {
    return res.status(403).json({ error: 'Forbidden: Cart belongs to another branch.' });
  }
  if (user.role === 'owner' && cart.supermarketId !== user.supermarketId) {
    return res.status(403).json({ error: 'Forbidden: Cart belongs to another supermarket.' });
  }

  // Idempotency: return clear 400 error if already completed or cancelled
  if (cart.status === 'completed') {
    return res.status(400).json({ error: 'Cart is already completed' });
  }
  if (cart.status === 'cancelled') {
    return res.status(400).json({ error: 'Cart is cancelled' });
  }
  if (cart.status !== 'verified') {
    return res.status(400).json({
      error: 'Unverified carts cannot be completed or earn loyalty points. Verify the cart at the till first.',
    });
  }

  cart.status = 'completed';
  cart.updatedAt = new Date().toISOString();

  // Deduct branch stock
  cart.items.forEach((item) => {
    const bp = data.branchProducts.find((b) => b.branchId === cart.branchId && b.productId === item.productId);
    if (bp) {
      bp.stock = Math.max(0, bp.stock - item.quantity);
    }
  });

  // Never double-award points on completion; verify already awarded idempotently
  const pointsEarned = awardPointsForVerifiedCart(data, cart, user);

  logAudit(
    user,
    'CART_COMPLETED',
    'cart',
    cart.id,
    `Cart ${cart.shortCode} checkout finalized at till${(cart.loyaltyPointsEarned || 0) > 0 ? ` (${cart.loyaltyPointsEarned} loyalty pts)` : ''}`,
    cart.supermarketId,
    cart.branchId
  );
  db.save();

  res.json({ success: true, cart, loyaltyPointsEarned: cart.loyaltyPointsEarned || pointsEarned || 0 });
});

// ==========================================
// 7. OWNER & STAFF MANAGEMENT & PERMISSIONS
// ==========================================

app.get('/api/owner/overview', requireAuth, requireRole(['owner', 'admin']), (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'owner' && req.query.supermarketId && req.query.supermarketId !== user.supermarketId) {
    return res.status(403).json({ error: 'Forbidden: Cannot access overview for another supermarket.' });
  }
  const supermarketId = user.role === 'admin' ? (req.query.supermarketId as string) : user.supermarketId;
  const data = db.getRaw();

  const supermarket = data.supermarkets.find((s) => s.id === supermarketId);
  if (!supermarket) return res.status(404).json({ error: 'Supermarket not found' });

  const branches = data.branches.filter((b) => b.supermarketId === supermarketId);
  const staff = data.users.filter((u) => u.supermarketId === supermarketId && u.role === 'staff');
  const products = data.products.filter((p) => p.supermarketId === supermarketId);
  const promotions = data.promotions.filter((p) => p.supermarketId === supermarketId);
  const auditLogs = data.auditLogs.filter((l) => l.supermarketId === supermarketId).slice(0, 50);

  let lowStockCount = 0;
  branches.forEach((branch) => {
    products.forEach((p) => {
      const bp = data.branchProducts.find((b) => b.branchId === branch.id && b.productId === p.id);
      const stock = bp?.stock ?? 0;
      const thresh = bp?.lowStockThresholdOverride ?? p.lowStockThreshold ?? 10;
      if (stock <= thresh) lowStockCount++;
    });
  });

  res.json({
    supermarket,
    branches,
    staff,
    productsCount: products.length,
    promotionsCount: promotions.length,
    lowStockCount,
    auditLogs,
  });
});

app.post('/api/owner/branches', requireAuth, requireRole(['owner', 'admin']), (req, res) => {
  const user = (req as any).user as User;
  const { supermarketId, name, code, address, city, latitude, longitude, phone } = req.body;
  if (user.role === 'owner' && supermarketId && supermarketId !== user.supermarketId) {
    return res.status(403).json({ error: 'Forbidden: Cannot create branches for another supermarket.' });
  }
  const targetSmId = user.role === 'admin' ? supermarketId : user.supermarketId;
  if (!targetSmId || !canAccessSupermarket(user, targetSmId)) {
    return res.status(403).json({ error: 'Forbidden: Cannot create branch for this supermarket.' });
  }

  if (!name || !code) return res.status(400).json({ error: 'Name and branch code are required' });

  const data = db.getRaw();
  const newBranch: Branch = {
    id: `br_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
    supermarketId: targetSmId,
    name: name.trim(),
    code: code.trim().toUpperCase(),
    address: address?.trim() || 'Commercial District',
    city: city?.trim() || 'Nairobi',
    latitude: parseFloat(latitude) || -1.2833,
    longitude: parseFloat(longitude) || 36.8219,
    phone: phone?.trim() || '+254700000000',
    isActive: true,
  };

  data.branches.push(newBranch);

  // Initialize branch products for all existing catalogue items
  const smProducts = data.products.filter((p) => p.supermarketId === targetSmId);
  smProducts.forEach((p) => {
    data.branchProducts.push({
      id: `bp_${newBranch.id}_${p.id}`,
      branchId: newBranch.id,
      productId: p.id,
      priceOverride: null,
      stock: 50,
      lowStockThresholdOverride: null,
      aisleOverride: null,
      shelfOverride: null,
    });
  });

  logAudit(user, 'BRANCH_CREATED', 'branch', newBranch.id, `Created branch ${newBranch.name} (${newBranch.code})`, targetSmId, newBranch.id);
  db.save();

  res.json(newBranch);
});

// Create Staff Member with Preset or Custom Permissions
app.post('/api/owner/staff', requireAuth, requireRole(['owner', 'admin']), (req, res) => {
  const user = (req as any).user as User;
  const { name, email, phone, password, branchId, permissions, preset } = req.body;
  if (user.role === 'owner' && req.body.supermarketId && req.body.supermarketId !== user.supermarketId) {
    return res.status(403).json({ error: 'Forbidden: Cannot create staff for another supermarket.' });
  }
  const targetSmId = user.role === 'admin' ? req.body.supermarketId : user.supermarketId;

  if (!targetSmId || !canAccessSupermarket(user, targetSmId)) {
    return res.status(403).json({ error: 'Forbidden: Cannot create staff for another supermarket.' });
  }

  if (!name || !email || !phone || !password || !branchId) {
    return res.status(400).json({ error: 'Name, email, phone, password, and branchId are required' });
  }

  // Minimum password length of at least 8 characters
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanPhone = phone.replace(/[\s\-()]/g, '');
  const data = db.getRaw();

  // Verify that branchId belongs to the owner's supermarket
  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch || branch.supermarketId !== targetSmId) {
    return res.status(403).json({ error: 'Cannot assign staff to a branch of another supermarket.' });
  }

  if (data.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
    return res.status(400).json({ error: 'Email already exists across the platform' });
  }
  if (data.users.some((u) => u.phone.replace(/[\s\-()]/g, '') === cleanPhone)) {
    return res.status(400).json({ error: 'Phone number already exists across the platform' });
  }

  // Determine permissions based on preset or custom
  let finalPermissions: StaffPermissions = { ...STAFF_PRESETS.cashier };
  if (preset && STAFF_PRESETS[preset as keyof typeof STAFF_PRESETS]) {
    finalPermissions = { ...STAFF_PRESETS[preset as keyof typeof STAFF_PRESETS] };
  } else if (permissions) {
    finalPermissions = {
      viewStock: Boolean(permissions.viewStock),
      editStock: Boolean(permissions.editStock),
      viewPrices: Boolean(permissions.viewPrices),
      editPrices: Boolean(permissions.editPrices),
      managePromotions: Boolean(permissions.managePromotions),
      verifyCarts: Boolean(permissions.verifyCarts),
      viewReports: Boolean(permissions.viewReports),
    };
  }

  const newStaffId = `usr_staff_${Date.now()}`;
  const newStaff: User = {
    id: newStaffId,
    name: name.trim(),
    email: cleanEmail,
    phone: phone.trim(),
    role: 'staff',
    supermarketId: targetSmId,
    branchId,
    permissions: finalPermissions,
    status: 'active',
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: new Date().toISOString(),
  };

  const { hash, salt } = hashPassword(password);
  data.users.push(newStaff);
  data.passwords[newStaffId] = { hash, salt };

  logAudit(
    user,
    'STAFF_CREATED',
    'staff',
    newStaff.id,
    `Created staff account for ${newStaff.name} with preset: ${preset || 'custom'}`,
    targetSmId,
    branchId
  );
  db.save();

  res.json(newStaff);
});

// Update Staff Member (Permissions, Preset, Status)
app.put('/api/owner/staff/:id', requireAuth, requireRole(['owner', 'admin']), (req, res) => {
  const user = (req as any).user as User;
  const { permissions, preset, status, branchId } = req.body;
  const data = db.getRaw();
  const staff = data.users.find((u) => u.id === req.params.id);
  if (!staff) return res.status(404).json({ error: 'Staff not found' });

  if (staff.role !== 'staff' || !staff.supermarketId || !canAccessSupermarket(user, staff.supermarketId)) {
    return res.status(403).json({ error: 'Forbidden: Cannot edit staff belonging to another supermarket.' });
  }

  if (branchId) {
    const branch = data.branches.find((b) => b.id === branchId);
    if (!branch || branch.supermarketId !== staff.supermarketId) {
      return res.status(403).json({ error: 'Cannot assign staff to a branch of another supermarket.' });
    }
    staff.branchId = branchId;
  }

  // Allowed status values: only "active" and "suspended"
  if (status !== undefined) {
    if (status !== 'active' && status !== 'suspended') {
      return res.status(400).json({ error: 'Invalid status. Allowed values are "active" and "suspended".' });
    }
    staff.status = status;
  }

  if (preset && STAFF_PRESETS[preset as keyof typeof STAFF_PRESETS]) {
    staff.permissions = { ...STAFF_PRESETS[preset as keyof typeof STAFF_PRESETS] };
    logAudit(
      user,
      'STAFF_PERMISSIONS_UPDATED',
      'staff',
      staff.id,
      `Assigned preset "${preset}" to staff ${staff.name}`,
      staff.supermarketId,
      staff.branchId
    );
  } else if (permissions) {
    staff.permissions = {
      viewStock: Boolean(permissions.viewStock),
      editStock: Boolean(permissions.editStock),
      viewPrices: Boolean(permissions.viewPrices),
      editPrices: Boolean(permissions.editPrices),
      managePromotions: Boolean(permissions.managePromotions),
      verifyCarts: Boolean(permissions.verifyCarts),
      viewReports: Boolean(permissions.viewReports),
    };
    logAudit(
      user,
      'STAFF_PERMISSIONS_UPDATED',
      'staff',
      staff.id,
      `Customized permissions for staff ${staff.name}: Stock(${staff.permissions.editStock ? 'RW' : 'RO'}), Price(${staff.permissions.editPrices ? 'RW' : 'RO'}), Reports(${staff.permissions.viewReports})`,
      staff.supermarketId,
      staff.branchId
    );
  }
  // Revoke active sessions for this staff member when permissions or status change
  revokeUserSessions(staff.id);

  db.save();
  res.json(staff);
});

// Store Owner (or Admin) generates a 24-hour single-use temporary password for their own staff member
app.post('/api/owner/staff/:id/temp-password', requireAuth, requireRole(['owner', 'admin']), (req, res) => {
  const caller = (req as any).user as User;
  const data = db.getRaw();
  const target = data.users.find((u) => u.id === req.params.id);
  if (!target) {
    return res.status(404).json({ error: 'Staff member not found.' });
  }

  if (target.role === 'admin') {
    return res.status(403).json({ error: 'System administrator account cannot be reset through this flow.' });
  }

  if (caller.role === 'owner') {
    if (target.role !== 'staff' || !target.supermarketId || target.supermarketId !== caller.supermarketId) {
      return res.status(403).json({
        error: 'Forbidden: Store owners can only generate temporary passwords for their own staff.',
      });
    }
  } else if (caller.role === 'admin') {
    if (target.role !== 'staff') {
      return res.status(403).json({
        error: 'Use admin user or shop reset controls for non-staff accounts.',
      });
    }
  }

  const tempPassword = generateTemporaryPassword();
  const { hash, salt } = hashPassword(tempPassword);
  data.passwords[target.id] = { hash, salt };
  target.mustChangePassword = true;
  target.tempPasswordExpiresAt = Date.now() + TEMP_PASSWORD_TTL_MS;
  target.tempPasswordConsumed = false;
  target.failedAttempts = 0;
  target.lockedUntil = null;

  revokeUserSessions(target.id);

  const whenIso = new Date().toISOString();
  logAudit(
    caller,
    'STAFF_TEMP_PASSWORD_GENERATED',
    'staff',
    target.id,
    `${caller.name} (${caller.role}) generated a 24h single-use temporary password for staff ${target.name} (${maskEmail(target.email)}) at ${whenIso}.`,
    target.supermarketId || null,
    target.branchId || null
  );
  db.save();

  res.json({
    success: true,
    tempPassword,
    expiresAt: target.tempPasswordExpiresAt,
    message: `Temporary password generated for ${target.name}. Share it securely and advise them to change it immediately at next sign-in.`,
  });
});

// Adjust Branch Product: Enforces backend branch access, supermarket product ownership, role permissions, and input validation
app.post('/api/owner/branch-product-override', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const { branchId, productId, priceOverride, stock, lowStockThresholdOverride, aisleOverride, shelfOverride } = req.body;
  const data = db.getRaw();

  // Block shoppers completely
  if (user.role === 'shopper') {
    return res.status(403).json({ error: 'Forbidden: Shoppers cannot modify branch products.' });
  }

  // Caller must be able to access the branch (admin, owner of this chain, or staff of this branch)
  if (!canAccessBranch(user, branchId)) {
    return res.status(403).json({ error: 'Security violation: You do not have access to manage this branch.' });
  }

  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch) {
    return res.status(404).json({ error: 'Branch not found.' });
  }

  const product = data.products.find((p) => p.id === productId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found.' });
  }
  if (product.supermarketId !== branch.supermarketId) {
    return res.status(403).json({ error: 'Forbidden: Product does not belong to this supermarket chain.' });
  }

  // Staff permission checks
  if (user.role === 'staff') {
    if (priceOverride !== undefined && !user.permissions?.editPrices) {
      return res.status(403).json({ error: 'Security violation: Staff account lacks "editPrices" permission.' });
    }
    if (
      (stock !== undefined ||
        lowStockThresholdOverride !== undefined ||
        aisleOverride !== undefined ||
        shelfOverride !== undefined) &&
      !user.permissions?.editStock
    ) {
      return res.status(403).json({ error: 'Security violation: Staff account lacks "editStock" permission.' });
    }
  }

  // Number validation: price >= 0, stock >= 0 and integer. Reject negative or NaN.
  if (priceOverride !== undefined && priceOverride !== null && priceOverride !== '') {
    const numPrice = Number(priceOverride);
    if (isNaN(numPrice) || numPrice < 0) {
      return res.status(400).json({ error: 'Price override must be a non-negative number.' });
    }
  }

  if (stock !== undefined && stock !== null && stock !== '') {
    const numStock = Number(stock);
    if (isNaN(numStock) || numStock < 0 || !Number.isInteger(numStock)) {
      return res.status(400).json({ error: 'Stock must be a non-negative integer.' });
    }
  }

  if (lowStockThresholdOverride !== undefined && lowStockThresholdOverride !== null && lowStockThresholdOverride !== '') {
    const numThreshold = Number(lowStockThresholdOverride);
    if (isNaN(numThreshold) || numThreshold < 0 || !Number.isInteger(numThreshold)) {
      return res.status(400).json({ error: 'Low stock threshold override must be a non-negative integer.' });
    }
  }

  let bp = data.branchProducts.find((b) => b.branchId === branchId && b.productId === productId);
  if (!bp) {
    bp = {
      id: `bp_${branchId}_${productId}`,
      branchId,
      productId,
      priceOverride: null,
      stock: 50,
      lowStockThresholdOverride: null,
      aisleOverride: null,
      shelfOverride: null,
    };
    data.branchProducts.push(bp);
  }

  if (priceOverride !== undefined) {
    bp.priceOverride = priceOverride === null || priceOverride === '' ? null : Number(priceOverride);
  }
  if (stock !== undefined) {
    bp.stock = stock === null || stock === '' ? 0 : Number(stock);
  }
  if (lowStockThresholdOverride !== undefined) {
    bp.lowStockThresholdOverride =
      lowStockThresholdOverride === null || lowStockThresholdOverride === '' ? null : Number(lowStockThresholdOverride);
  }
  if (aisleOverride !== undefined) {
    bp.aisleOverride = aisleOverride || null;
  }
  if (shelfOverride !== undefined) {
    bp.shelfOverride = shelfOverride || null;
  }

  logAudit(
    user,
    'BRANCH_PRODUCT_UPDATED',
    'price',
    productId,
    `Updated branch stock/price/location for "${product.name}": Price: ${bp.priceOverride ?? 'default'}, Stock: ${bp.stock}, Aisle: ${bp.aisleOverride || product.aisle}, Shelf: ${bp.shelfOverride || product.shelf}`,
    product.supermarketId,
    branchId
  );
  db.save();

  res.json({ success: true, branchProduct: bp });
});

// CSV Export Catalogue with distinct Aisle and Shelf columns
app.get('/api/owner/products/csv-export', requireAuth, requireRole(['owner', 'admin']), (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'owner' && req.query.supermarketId && req.query.supermarketId !== user.supermarketId) {
    return res.status(403).json({ error: 'Forbidden: Cannot export catalogue for another supermarket.' });
  }
  const supermarketId = user.role === 'admin' ? (req.query.supermarketId as string) : user.supermarketId;
  const branchId = (req.query.branchId as string) || null;
  if (branchId && !canAccessBranch(user, branchId)) {
    return res.status(403).json({ error: 'Forbidden: Branch does not belong to your supermarket.' });
  }
  const data = db.getRaw();

  const products = data.products.filter((p) => p.supermarketId === supermarketId);
  const rows = ['barcode,name,category,base_price,aisle,shelf,branch_price,stock,low_stock_threshold'];

  products.forEach((p) => {
    let bpPrice = '';
    let bpStock = '';
    let bpThresh = p.lowStockThreshold || 10;
    let bpAisle = p.aisle || 'Aisle 1';
    let bpShelf = p.shelf || 'Shelf A';

    if (branchId) {
      const bp = data.branchProducts.find((b) => b.branchId === branchId && b.productId === p.id);
      if (bp) {
        bpPrice = bp.priceOverride !== null ? bp.priceOverride.toString() : '';
        bpStock = bp.stock.toString();
        if (bp.lowStockThresholdOverride !== null) bpThresh = bp.lowStockThresholdOverride;
        if (bp.aisleOverride) bpAisle = bp.aisleOverride;
        if (bp.shelfOverride) bpShelf = bp.shelfOverride;
      }
    }

    const cleanName = `"${p.name.replace(/"/g, '""')}"`;
    const cleanCat = `"${p.category.replace(/"/g, '""')}"`;
    const cleanAisle = `"${bpAisle.replace(/"/g, '""')}"`;
    const cleanShelf = `"${bpShelf.replace(/"/g, '""')}"`;

    rows.push(`${p.barcode},${cleanName},${cleanCat},${p.basePrice},${cleanAisle},${cleanShelf},${bpPrice},${bpStock},${bpThresh}`);
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="smartcart_catalogue_${supermarketId}.csv"`);
  res.send(rows.join('\n'));
});

// CSV Import Catalogue with distinct Aisle and Shelf columns & Row-by-Row Error Validation
app.post('/api/owner/products/csv-import', requireAuth, requireRole(['owner', 'admin']), (req, res) => {
  const user = (req as any).user as User;
  const { csvText, branchId } = req.body;
  if (user.role === 'owner' && req.body.supermarketId && req.body.supermarketId !== user.supermarketId) {
    return res.status(403).json({ error: 'Forbidden: Cannot import catalogue for another supermarket.' });
  }
  const targetSmId = user.role === 'admin' ? req.body.supermarketId : user.supermarketId;
  if (!targetSmId || !canAccessSupermarket(user, targetSmId)) {
    return res.status(403).json({ error: 'Forbidden: Cannot import catalogue for this supermarket.' });
  }

  const data = db.getRaw();
  if (branchId) {
    const branch = data.branches.find((b) => b.id === branchId);
    if (!branch || branch.supermarketId !== targetSmId) {
      return res.status(403).json({ error: 'Forbidden: Branch does not belong to your supermarket.' });
    }
  }

  if (!csvText) {
    return res.status(400).json({ error: 'csvText content is required' });
  }

  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return res.status(400).json({ error: 'CSV must contain a header line and at least one data row' });
  }

  const errors: { row: number; barcode?: string; field?: string; message: string }[] = [];
  const validRows: any[] = [];
  const seenBarcodes = new Set<string>();

  const header = lines[0].toLowerCase().split(',').map((h: string) => h.trim().replace(/^"|"$/g, ''));
  const barcodeIdx = header.indexOf('barcode');
  const nameIdx = header.indexOf('name');
  const catIdx = header.indexOf('category');
  const basePriceIdx = header.indexOf('base_price');
  const aisleIdx = header.indexOf('aisle');
  const shelfIdx = header.indexOf('shelf');
  const aisleShelfIdx = header.indexOf('aisle_shelf');
  const branchPriceIdx = header.indexOf('branch_price');
  const stockIdx = header.indexOf('stock');
  const threshIdx = header.indexOf('low_stock_threshold');

  if (barcodeIdx === -1 || nameIdx === -1 || basePriceIdx === -1) {
    return res.status(400).json({
      error: 'CSV missing required columns: "barcode", "name", and "base_price" must be present.',
    });
  }

  const parseCSVLine = (text: string) => {
    const result: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    const rowNum = i + 1;

    const rawBarcode = cols[barcodeIdx]?.replace(/^"|"$/g, '').trim();
    const rawName = cols[nameIdx]?.replace(/^"|"$/g, '').trim();
    const rawCat = catIdx !== -1 ? cols[catIdx]?.replace(/^"|"$/g, '').trim() : 'General';
    const rawBasePrice = cols[basePriceIdx]?.replace(/^"|"$/g, '').trim();

    let rawAisle = 'Aisle 1';
    let rawShelf = 'Shelf A';
    if (aisleIdx !== -1) rawAisle = cols[aisleIdx]?.replace(/^"|"$/g, '').trim() || 'Aisle 1';
    if (shelfIdx !== -1) rawShelf = cols[shelfIdx]?.replace(/^"|"$/g, '').trim() || 'Shelf A';
    if (aisleShelfIdx !== -1 && (aisleIdx === -1 || shelfIdx === -1)) {
      const parts = (cols[aisleShelfIdx] || '').split(',');
      if (parts[0]) rawAisle = parts[0].trim();
      if (parts[1]) rawShelf = parts[1].trim();
    }

    const rawBranchPrice = branchPriceIdx !== -1 ? cols[branchPriceIdx]?.replace(/^"|"$/g, '').trim() : '';
    const rawStock = stockIdx !== -1 ? cols[stockIdx]?.replace(/^"|"$/g, '').trim() : '50';
    const rawThresh = threshIdx !== -1 ? cols[threshIdx]?.replace(/^"|"$/g, '').trim() : '10';

    if (!rawBarcode) {
      errors.push({ row: rowNum, field: 'barcode', message: 'Barcode cannot be empty' });
      continue;
    }

    const barcodeCheck = validateBarcode(rawBarcode);
    if (!barcodeCheck.isValid) {
      errors.push({
        row: rowNum,
        barcode: rawBarcode,
        field: 'barcode',
        message: barcodeCheck.error || 'Invalid barcode check digit or format',
      });
      continue;
    }

    if (seenBarcodes.has(rawBarcode)) {
      errors.push({ row: rowNum, barcode: rawBarcode, field: 'barcode', message: 'Duplicate barcode within CSV file' });
      continue;
    }
    seenBarcodes.add(rawBarcode);

    if (!rawName) {
      errors.push({ row: rowNum, barcode: rawBarcode, field: 'name', message: 'Product name cannot be empty' });
      continue;
    }

    const basePrice = parseFloat(rawBasePrice);
    if (isNaN(basePrice) || basePrice <= 0) {
      errors.push({ row: rowNum, barcode: rawBarcode, field: 'base_price', message: 'Base price must be a positive number' });
      continue;
    }

    const branchPrice = rawBranchPrice && !isNaN(parseFloat(rawBranchPrice)) ? parseFloat(rawBranchPrice) : null;
    const stock = !isNaN(parseInt(rawStock, 10)) ? parseInt(rawStock, 10) : 50;
    const threshold = !isNaN(parseInt(rawThresh, 10)) ? parseInt(rawThresh, 10) : 10;

    validRows.push({
      barcode: rawBarcode,
      barcodeFormat: barcodeCheck.format,
      name: rawName,
      category: rawCat,
      basePrice,
      aisle: rawAisle,
      shelf: rawShelf,
      branchPrice,
      stock,
      threshold,
    });
  }

  if (errors.length > 0) {
    return res.status(422).json({
      success: false,
      message: `Encountered ${errors.length} validation error(s) in CSV. No products were imported.`,
      errors,
    });
  }

  let updatedCount = 0;
  let createdCount = 0;

  validRows.forEach((row) => {
    let existingProd = data.products.find(
      (p) => p.supermarketId === targetSmId && p.barcode === row.barcode
    );

    if (existingProd) {
      existingProd.name = row.name;
      existingProd.category = row.category;
      existingProd.basePrice = row.basePrice;
      existingProd.aisle = row.aisle;
      existingProd.shelf = row.shelf;
      existingProd.aisleShelf = `${row.aisle}, ${row.shelf}`;
      existingProd.lowStockThreshold = row.threshold;
      existingProd.updatedAt = new Date().toISOString();
      updatedCount++;
    } else {
      existingProd = {
        id: `prod_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
        supermarketId: targetSmId,
        barcode: row.barcode,
        barcodeFormat: row.barcodeFormat,
        name: row.name,
        category: row.category,
        basePrice: row.basePrice,
        aisle: row.aisle,
        shelf: row.shelf,
        aisleShelf: `${row.aisle}, ${row.shelf}`,
        lowStockThreshold: row.threshold,
        unit: 'item',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      data.products.push(existingProd);
      createdCount++;
    }

    if (branchId) {
      let bp = data.branchProducts.find((b) => b.branchId === branchId && b.productId === existingProd!.id);
      if (!bp) {
        bp = {
          id: `bp_${branchId}_${existingProd.id}`,
          branchId,
          productId: existingProd.id,
          priceOverride: row.branchPrice,
          stock: row.stock,
          lowStockThresholdOverride: null,
          aisleOverride: row.aisle,
          shelfOverride: row.shelf,
        };
        data.branchProducts.push(bp);
      } else {
        if (row.branchPrice !== null) bp.priceOverride = row.branchPrice;
        bp.stock = row.stock;
        bp.aisleOverride = row.aisle;
        bp.shelfOverride = row.shelf;
      }
    }
  });

  logAudit(
    user,
    'CATALOGUE_CSV_IMPORTED',
    'product',
    targetSmId,
    `CSV import: Created ${createdCount} new products, updated ${updatedCount} products with aisle & shelf locations`,
    targetSmId,
    branchId || null
  );
  db.save();

  res.json({
    success: true,
    createdCount,
    updatedCount,
    totalProcessed: validRows.length,
  });
});

// Promotions CRUD
// Promotions CRUD with strict supermarket scoping and input validation
app.get('/api/owner/promotions', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'shopper') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (user.role !== 'admin' && req.query.supermarketId && req.query.supermarketId !== user.supermarketId) {
    return res.status(403).json({ error: 'Forbidden: Cannot access promotions for another supermarket.' });
  }

  const supermarketId = user.role === 'admin' ? (req.query.supermarketId as string) : user.supermarketId;
  if (!supermarketId) {
    return res.status(400).json({ error: 'Supermarket ID is required' });
  }

  if (user.role !== 'admin' && user.supermarketId !== supermarketId) {
    return res.status(403).json({ error: 'Forbidden: Cannot access promotions for another supermarket' });
  }

  const data = db.getRaw();
  let promos = data.promotions.filter((p) => p.supermarketId === supermarketId);
  if (user.role === 'staff' && user.branchId) {
    promos = promos.filter((p) => !p.branchId || p.branchId === user.branchId);
  }
  res.json(promos);
});

app.post('/api/owner/promotions', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'shopper') {
    return res.status(403).json({ error: 'Forbidden: Shoppers cannot create promotions.' });
  }

  if (user.role !== 'admin' && req.body.supermarketId && req.body.supermarketId !== user.supermarketId) {
    return res.status(403).json({ error: 'Forbidden: You cannot manage promotions for another supermarket.' });
  }

  const targetSmId = user.role === 'admin' ? req.body.supermarketId : user.supermarketId;
  if (!targetSmId || (user.role !== 'admin' && user.supermarketId !== targetSmId)) {
    return res.status(403).json({ error: 'Forbidden: You do not have permission to manage promotions for this supermarket.' });
  }

  if (user.role === 'staff' && !user.permissions?.managePromotions) {
    return res.status(403).json({ error: 'Permission denied: Staff account lacks "managePromotions" permission.' });
  }

  const { name, type, discountPercent, fixedPrice, bundleQuantity, bundlePrice, productBarcodes, branchId, startDate, endDate } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Promotion name is required.' });
  }

  if (!type || !['percent_off', 'fixed_price', 'bundle'].includes(type)) {
    return res.status(400).json({ error: 'Invalid promotion type. Allowed types: percent_off, fixed_price, bundle.' });
  }

  if (!Array.isArray(productBarcodes) || productBarcodes.length === 0) {
    return res.status(400).json({ error: 'At least one product barcode is required.' });
  }

  const data = db.getRaw();

  // Verify branchId belongs to target supermarket if provided
  if (branchId) {
    const branch = data.branches.find((b) => b.id === branchId);
    if (!branch || branch.supermarketId !== targetSmId) {
      return res.status(403).json({ error: 'Branch does not belong to this supermarket.' });
    }
    if (user.role === 'staff' && user.branchId && user.branchId !== branchId) {
      return res.status(403).json({ error: 'Staff can only create promotions for their own branch.' });
    }
  }

  // Validate all product barcodes belong to this supermarket
  const smProducts = data.products.filter((p) => p.supermarketId === targetSmId);
  const smBarcodes = new Set(smProducts.map((p) => p.barcode));
  for (const bc of productBarcodes) {
    if (!smBarcodes.has(bc)) {
      return res.status(400).json({ error: `Product barcode "${bc}" does not belong to this supermarket catalogue.` });
    }
  }

  // Validate discount percentage (1-100)
  if (type === 'percent_off') {
    const pct = Number(discountPercent);
    if (isNaN(pct) || pct < 1 || pct > 100) {
      return res.status(400).json({ error: 'Discount percent must be a number between 1 and 100.' });
    }
  }

  if (type === 'fixed_price') {
    const fp = Number(fixedPrice);
    if (isNaN(fp) || fp <= 0) {
      return res.status(400).json({ error: 'Fixed price must be a positive number.' });
    }
  }

  if (type === 'bundle') {
    const bq = Number(bundleQuantity);
    const bp = Number(bundlePrice);
    if (isNaN(bq) || bq < 2 || !Number.isInteger(bq) || isNaN(bp) || bp <= 0) {
      return res.status(400).json({ error: 'Bundle must specify quantity (at least 2) and positive bundle price.' });
    }
  }

  // Validate dates: valid ISO and endDate >= startDate
  const sDate = startDate ? new Date(startDate) : new Date();
  const eDate = endDate ? new Date(endDate) : new Date(Date.now() + 86400000 * 30);
  if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
    return res.status(400).json({ error: 'Invalid promotion start or end date format.' });
  }
  if (eDate < sDate) {
    return res.status(400).json({ error: 'Promotion end date must be after start date.' });
  }

  const newPromo: Promotion = {
    id: `promo_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    supermarketId: targetSmId,
    branchId: branchId || null,
    name: name.trim(),
    type,
    discountPercent: discountPercent ? Number(discountPercent) : undefined,
    fixedPrice: fixedPrice ? Number(fixedPrice) : undefined,
    bundleQuantity: bundleQuantity ? Number(bundleQuantity) : undefined,
    bundlePrice: bundlePrice ? Number(bundlePrice) : undefined,
    productBarcodes,
    startDate: sDate.toISOString(),
    endDate: eDate.toISOString(),
    isActive: true,
  };

  data.promotions.push(newPromo);
  logAudit(user, 'PROMOTION_CREATED', 'promotion', newPromo.id, `Created promo "${newPromo.name}" (${newPromo.type})`, targetSmId, branchId);
  db.save();

  res.json(newPromo);
});

app.put('/api/owner/promotions/:id/toggle', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'shopper') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const data = db.getRaw();
  const promo = data.promotions.find((p) => p.id === req.params.id);
  if (!promo) return res.status(404).json({ error: 'Promotion not found' });

  if (user.role !== 'admin' && user.supermarketId !== promo.supermarketId) {
    return res.status(403).json({ error: 'Forbidden: You cannot modify promotions for this supermarket.' });
  }

  if (user.role === 'staff') {
    if (!user.permissions?.managePromotions) {
      return res.status(403).json({ error: 'Permission denied: Staff cannot toggle promotions.' });
    }
    if (promo.branchId && promo.branchId !== user.branchId) {
      return res.status(403).json({ error: 'Forbidden: Staff can only toggle promotions for their own branch.' });
    }
  }

  promo.isActive = !promo.isActive;
  logAudit(user, 'PROMOTION_TOGGLED', 'promotion', promo.id, `Promotion "${promo.name}" set to ${promo.isActive ? 'active' : 'inactive'}`, promo.supermarketId);
  db.save();

  res.json(promo);
});

// ==========================================
// 8. PHASE 2 COMPREHENSIVE REPORTS (OWNER, STAFF, ADMIN)
// ==========================================

// Report computation helper
function computeReports(data: any, supermarketId?: string | null, branchId?: string | null, startDate?: string, endDate?: string) {
  let carts = data.carts.filter((c: Cart) => c.status === 'completed' || c.status === 'verified');

  if (supermarketId) {
    carts = carts.filter((c: Cart) => c.supermarketId === supermarketId);
  }
  if (branchId) {
    carts = carts.filter((c: Cart) => c.branchId === branchId);
  }
  if (startDate) {
    carts = carts.filter((c: Cart) => new Date(c.createdAt) >= new Date(startDate));
  }
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    carts = carts.filter((c: Cart) => new Date(c.createdAt) <= end);
  }

  // 1. Busiest Hours (0-23)
  const hourCounts = new Array(24).fill(0);
  // 2. Busiest Days (0=Sun, 1=Mon... 6=Sat)
  const dayCounts = new Array(7).fill(0);

  // 3. Most Scanned Products
  const itemCounts: Record<string, {
    barcode: string;
    name: string;
    count: number;
    scanCount: number;
    quantityPurchased: number;
    totalValue: number;
    revenue: number;
    aisle: string;
    shelf: string;
  }> = {};

  let totalItems = 0;
  let totalRevenue = 0;

  carts.forEach((c: Cart) => {
    const d = new Date(c.createdAt);
    hourCounts[d.getHours()] += 1;
    dayCounts[d.getDay()] += 1;

    totalRevenue += c.finalTotal;

    c.items.forEach((item) => {
      totalItems += item.quantity;
      if (!itemCounts[item.barcode]) {
        itemCounts[item.barcode] = {
          barcode: item.barcode,
          name: item.name,
          count: 0,
          scanCount: 0,
          quantityPurchased: 0,
          totalValue: 0,
          revenue: 0,
          aisle: item.aisle || 'Aisle 1',
          shelf: item.shelf || 'Shelf A',
        };
      }
      itemCounts[item.barcode].count += item.quantity;
      itemCounts[item.barcode].scanCount += 1;
      itemCounts[item.barcode].quantityPurchased += item.quantity;
      itemCounts[item.barcode].totalValue += item.effectiveTotal;
      itemCounts[item.barcode].revenue += item.effectiveTotal;
    });
  });

  const topProducts = Object.values(itemCounts).sort((a, b) => b.count - a.count).slice(0, 10);

  // 4. Branch Comparison
  let relevantBranches = data.branches;
  if (supermarketId) relevantBranches = relevantBranches.filter((b: Branch) => b.supermarketId === supermarketId);
  if (branchId) relevantBranches = relevantBranches.filter((b: Branch) => b.id === branchId);

  const branchStats = relevantBranches.map((br: Branch) => {
    const brCarts = carts.filter((c: Cart) => c.branchId === br.id);
    const rev = brCarts.reduce((acc: number, cur: Cart) => acc + cur.finalTotal, 0);
    const items = brCarts.reduce((acc: number, cur: Cart) => acc + cur.items.reduce((sum: number, it: CartItem) => sum + it.quantity, 0), 0);
    return {
      branchId: br.id,
      branchName: br.name,
      cartsCount: brCarts.length,
      completedCarts: brCarts.length,
      revenue: rev,
      avgCartValue: brCarts.length > 0 ? Math.round(rev / brCarts.length) : 0,
      avgCartSize: brCarts.length > 0 ? Math.round((items / brCarts.length) * 10) / 10 : 0,
      totalItemsScanned: items,
    };
  });

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const busiestHours = hourCounts.map((count: number, hour: number) => ({ hour, count }));
  const busiestDays = dayNames.map((day: string, idx: number) => ({ day, count: dayCounts[idx] || 0 }));
  const avgCartValue = carts.length > 0 ? Math.round(totalRevenue / carts.length) : 0;
  const avgCartSize = carts.length > 0 ? Math.round((totalItems / carts.length) * 10) / 10 : 0;

  return {
    kpis: {
      totalCarts: carts.length,
      totalRevenue,
      totalItems,
      avgCartValue,
      avgCartSize,
    },
    totals: {
      completedCarts: carts.length,
      totalRevenue,
      totalItems,
      avgCartValue,
      avgCartSize,
    },
    hourCounts,
    dayCounts,
    busiestHours,
    busiestDays,
    topProducts,
    branchStats,
  };
}

// Get Reports JSON (Owner, Staff with permission, Admin)
app.get('/api/reports', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const data = db.getRaw();
  const { branchId, startDate, endDate, supermarketId } = req.query as Record<string, string>;

  // Security enforcement
  let targetSmId: string | null = null;
  let targetBranchId: string | null = null;

  if (user.role === 'admin') {
    targetSmId = supermarketId || null;
    targetBranchId = branchId || null;
  } else if (user.role === 'owner') {
    if (supermarketId && supermarketId !== user.supermarketId) {
      return res.status(403).json({ error: 'Forbidden: Cannot access reports for another supermarket.' });
    }
    targetSmId = user.supermarketId || null;
    if (branchId) {
      if (!canAccessBranch(user, branchId)) {
        return res.status(403).json({ error: 'Forbidden: Branch does not belong to your supermarket.' });
      }
      targetBranchId = branchId;
    }
  } else if (user.role === 'staff') {
    if (!user.permissions?.viewReports) {
      return res.status(403).json({ error: 'Permission denied: Staff cannot view branch reports.' });
    }
    if (branchId && branchId !== user.branchId) {
      return res.status(403).json({ error: 'Forbidden: Staff can only access reports for their assigned branch.' });
    }
    targetSmId = user.supermarketId || null;
    targetBranchId = user.branchId || null;
  } else {
    return res.status(403).json({ error: 'Forbidden: Insufficient role privileges to view reports.' });
  }

  const reports = computeReports(data, targetSmId, targetBranchId, startDate, endDate);
  res.json(reports);
});

// CSV Export for each report type
app.get('/api/reports/csv', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const data = db.getRaw();
  const { reportType, type, branchId, startDate, endDate, supermarketId } = req.query as Record<string, string>;
  const resolvedType = reportType || type || 'branches';

  let targetSmId: string | null = null;
  let targetBranchId: string | null = null;

  if (user.role === 'admin') {
    targetSmId = supermarketId || null;
    targetBranchId = branchId || null;
  } else if (user.role === 'owner') {
    if (supermarketId && supermarketId !== user.supermarketId) {
      return res.status(403).json({ error: 'Forbidden: Cannot access reports for another supermarket.' });
    }
    targetSmId = user.supermarketId || null;
    if (branchId) {
      if (!canAccessBranch(user, branchId)) {
        return res.status(403).json({ error: 'Forbidden: Branch does not belong to your supermarket.' });
      }
      targetBranchId = branchId;
    }
  } else if (user.role === 'staff') {
    if (!user.permissions?.viewReports) {
      return res.status(403).json({ error: 'Permission denied: Staff cannot view reports.' });
    }
    if (branchId && branchId !== user.branchId) {
      return res.status(403).json({ error: 'Forbidden: Staff can only access reports for their assigned branch.' });
    }
    targetSmId = user.supermarketId || null;
    targetBranchId = user.branchId || null;
  } else {
    return res.status(403).json({ error: 'Forbidden: Insufficient role privileges to view reports.' });
  }

  const reports = computeReports(data, targetSmId, targetBranchId, startDate, endDate);

  let csvContent = '';
  let filename = 'smartcart_report.csv';

  const safeCell = (raw: unknown) => {
    const str = String(raw ?? '');
    const trimmed = str.trimStart();
    const guarded =
      trimmed.startsWith('=') ||
      trimmed.startsWith('+') ||
      trimmed.startsWith('-') ||
      trimmed.startsWith('@') ||
      trimmed.startsWith('\t') ||
      trimmed.startsWith('\r')
        ? `'${str}`
        : str;
    return `"${guarded.replace(/"/g, '""')}"`;
  };

  if (resolvedType === 'busiest_hours' || resolvedType === 'traffic') {
    filename = 'busiest_hours_report.csv';
    csvContent = 'hour_of_day,carts_checked_out\n' + reports.hourCounts.map((count: number, hr: number) => `${hr}:00,${count}`).join('\n');
  } else if (resolvedType === 'busiest_days') {
    filename = 'busiest_days_report.csv';
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    csvContent = 'day_of_week,carts_checked_out\n' + reports.dayCounts.map((count: number, d: number) => `${days[d]},${count}`).join('\n');
  } else if (resolvedType === 'most_scanned' || resolvedType === 'products') {
    filename = 'most_scanned_products.csv';
    if (user.role === 'admin') {
      csvContent =
        'name,aisle,shelf,scans_count,total_cart_value_kes\n' +
        reports.topProducts
          .map((p: any) => [p.name, p.aisle, p.shelf, p.count, p.totalValue].map(safeCell).join(','))
          .join('\n');
    } else {
      csvContent =
        'barcode,name,aisle,shelf,scans_count,total_revenue_kes\n' +
        reports.topProducts
          .map((p: any) => `${p.barcode},"${p.name.replace(/"/g, '""')}",${p.aisle},${p.shelf},${p.count},${p.totalValue}`)
          .join('\n');
    }
  } else {
    filename = 'branch_comparison_report.csv';
    if (user.role === 'admin') {
      csvContent =
        'branch_id,branch_name,completed_carts,items_scanned,total_cart_value_kes,avg_cart_value_kes,avg_cart_size\n' +
        reports.branchStats
          .map((b: any) =>
            [b.branchId, b.branchName, b.cartsCount, b.totalItemsScanned, b.revenue, b.avgCartValue, b.avgCartSize]
              .map(safeCell)
              .join(',')
          )
          .join('\n');
    } else {
      csvContent =
        'branch_id,branch_name,completed_carts,items_scanned,total_revenue_kes,avg_cart_value_kes,avg_cart_size\n' +
        reports.branchStats
          .map((b: any) => `${b.branchId},"${b.branchName.replace(/"/g, '""')}",${b.cartsCount},${b.totalItemsScanned},${b.revenue},${b.avgCartValue},${b.avgCartSize}`)
          .join('\n');
    }
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csvContent);
});

// ==========================================
// 9. SYSTEM ADMIN ENDPOINTS & ANNOUNCEMENTS & SUPPORT
// ==========================================

app.get('/api/admin/metrics', requireAuth, requireRole(['admin']), (req, res) => {
  const data = db.getRaw();
  res.json({
    totalChains: data.supermarkets.length,
    totalBranches: data.branches.length,
    totalShoppers: data.users.filter((u) => u.role === 'shopper').length,
    totalStaff: data.users.filter((u) => u.role === 'staff' || u.role === 'owner').length,
    totalCarts: data.carts.length,
    totalItemsScanned: data.carts.reduce((acc, cur) => acc + cur.items.reduce((sum, it) => sum + it.quantity, 0), 0),
  });
});

// Admin-only Aggregated Analytics Endpoint (60s server cache, strict zero-PII outputs, rate limited)
app.get('/api/admin/analytics', adminAnalyticsRateLimiter, requireAuth, requireRole(['admin']), (req, res) => {
  const range = normalizeAnalyticsRange(req.query.range);
  if (!range) {
    return res.status(400).json({ error: 'Invalid range. Allowed: today, 7d, 30d, 90d, year.' });
  }
  const supermarketId =
    typeof req.query.supermarketId === 'string' && req.query.supermarketId.trim()
      ? req.query.supermarketId.trim()
      : null;
  const branchId =
    typeof req.query.branchId === 'string' && req.query.branchId.trim()
      ? req.query.branchId.trim()
      : null;

  const data = db.getRaw();
  if (supermarketId && !data.supermarkets.some((s) => s.id === supermarketId)) {
    return res.status(404).json({ error: 'Supermarket not found' });
  }
  if (branchId && !data.branches.some((b) => b.id === branchId)) {
    return res.status(404).json({ error: 'Branch not found' });
  }

  const payload = getAdminAnalytics(data, { range, supermarketId, branchId });
  return res.json(payload);
});

// Admin-only Aggregated Analytics CSV Export (strictly counts/totals only, formula-safe, zero PII)
app.get('/api/admin/analytics/csv', adminAnalyticsRateLimiter, requireAuth, requireRole(['admin']), (req, res) => {
  const range = normalizeAnalyticsRange(req.query.range);
  if (!range) {
    return res.status(400).json({ error: 'Invalid range. Allowed: today, 7d, 30d, 90d, year.' });
  }
  const supermarketId =
    typeof req.query.supermarketId === 'string' && req.query.supermarketId.trim()
      ? req.query.supermarketId.trim()
      : null;
  const branchId =
    typeof req.query.branchId === 'string' && req.query.branchId.trim()
      ? req.query.branchId.trim()
      : null;

  const data = db.getRaw();
  if (supermarketId && !data.supermarkets.some((s) => s.id === supermarketId)) {
    return res.status(404).json({ error: 'Supermarket not found' });
  }
  if (branchId && !data.branches.some((b) => b.id === branchId)) {
    return res.status(404).json({ error: 'Branch not found' });
  }

  const payload = getAdminAnalytics(data, { range, supermarketId, branchId });
  const csv = buildAnalyticsCsv(payload);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="smartcart_admin_analytics_${range}.csv"`
  );
  return res.send(csv);
});

app.put('/api/admin/supermarkets/:id/status', requireAuth, requireRole(['admin']), async (req, res) => {
  const user = (req as any).user as User;
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only the System Administrator can approve or manage shops.' });
  }
  const { status, language } = req.body || {};
  const emailLang: EmailLanguage = language === 'sw' ? 'sw' : 'en';
  if (!['active', 'suspended', 'pending', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Allowed: active, suspended, rejected, pending.' });
  }
  const data = db.getRaw();
  const sm = data.supermarkets.find((s) => s.id === req.params.id);
  if (!sm) return res.status(404).json({ error: 'Supermarket not found' });

  const prevStatus = sm.status;
  sm.status = status;

  if (status === 'active') {
    // Activate the shop's branches when approved by admin so shoppers can immediately select the store
    data.branches.forEach((b) => {
      if (b.supermarketId === sm.id && (prevStatus === 'pending' || !b.isActive)) {
        b.isActive = true;
      }
    });
  } else if (status === 'suspended' || status === 'pending' || status === 'rejected') {
    revokeSupermarketSessions(sm.id);
  }
  logAudit(user, `SUPERMARKET_${status.toUpperCase()}`, 'supermarket', sm.id, `Supermarket ${sm.name} ${status} by admin`);
  db.save();

  if (status === 'active' || status === 'rejected' || status === 'suspended') {
    const ownerUser =
      data.users.find((u) => u.supermarketId === sm.id && u.role === 'owner') ||
      data.users.find((u) => u.email.toLowerCase() === sm.contactEmail.toLowerCase());
    const recipient = ownerUser?.email || sm.contactEmail;
    const statusEmail = buildSupermarketStatusEmail({
      lang: emailLang,
      ownerName: ownerUser?.name || `${sm.name} Owner`,
      chainName: sm.name,
      status,
      portalUrl: status === 'active' ? `${getAppBaseUrl(req)}/store/login` : undefined,
    });
    await sendEmail({
      to: recipient,
      ...statusEmail,
      enforceAddressRateLimit: false,
    });
  }

  res.json(sm);
});

app.get('/api/admin/users', requireAuth, requireRole(['admin']), (req, res) => {
  const data = db.getRaw();
  res.json(data.users);
});

app.put('/api/admin/users/:id/status', requireAuth, requireRole(['admin']), (req, res) => {
  const adminUser = (req as any).user as User;
  const { status, role } = req.body;
  const data = db.getRaw();
  const targetUser = data.users.find((u) => u.id === req.params.id);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  // STRICT RULE: The admin account cannot be deleted, suspended or demoted by anyone
  if (targetUser.role === 'admin') {
    logAudit(
      adminUser,
      'ADMIN_SUSPENSION_BLOCKED',
      'user',
      targetUser.id,
      'Blocked attempt to suspend, demote, or modify the permanent system administrator account.'
    );
    return res.status(403).json({
      error: 'The system administrator account is permanent and cannot be deleted, suspended, or demoted by anyone.',
    });
  }

  // STRICT RULE: The admin role cannot be assigned to anyone else
  if (role === 'admin') {
    logAudit(
      adminUser,
      'ADMIN_PROMOTION_BLOCKED',
      'user',
      targetUser.id,
      `Blocked attempt to assign admin role to user ${targetUser.name}. Exactly ONE admin account is permitted.`
    );
    return res.status(403).json({
      error: 'The system administrator role cannot be assigned to any other account. Exactly ONE admin account is permitted.',
    });
  }

  if (status !== undefined && status !== 'active' && status !== 'suspended') {
    return res.status(400).json({ error: 'Invalid status. Allowed values are "active" and "suspended".' });
  }

  if (role !== undefined && !['shopper', 'staff', 'owner'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Allowed values are "shopper", "staff", and "owner".' });
  }

  const roleChanged = Boolean(role && role !== targetUser.role);
  const suspended = status === 'suspended';

  if (status !== undefined) {
    targetUser.status = status;
  }
  if (roleChanged) {
    targetUser.role = role;
  }

  if (suspended || roleChanged) {
    revokeUserSessions(targetUser.id);
  }

  logAudit(
    adminUser,
    `USER_${targetUser.status.toUpperCase()}`,
    'staff',
    targetUser.id,
    `User ${targetUser.name} updated (status=${targetUser.status}, role=${targetUser.role})`
  );
  db.save();
  res.json(targetUser);
});

app.post('/api/admin/users/:id/reset-password', requireAuth, requireRole(['admin']), async (req, res) => {
  const adminUser = (req as any).user as User;
  const { newPassword, language } = req.body || {};
  const emailLang: EmailLanguage = language === 'sw' ? 'sw' : 'en';
  const data = db.getRaw();
  const targetUser = data.users.find((u) => u.id === req.params.id);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  // Admin password cannot be reset via user management
  if (targetUser.role === 'admin') {
    return res.status(403).json({
      error: 'The system administrator password cannot be reset via user management. Password recovery works only through the registered email address with a time-limited link.',
    });
  }

  let customPassword = typeof newPassword === 'string' && newPassword.trim() ? newPassword.trim() : '';
  if (customPassword && customPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  let generatedPassword: string | undefined;
  let finalPassword = customPassword;
  if (!finalPassword) {
    generatedPassword = generateTemporaryPassword();
    finalPassword = generatedPassword;
    targetUser.mustChangePassword = true;
    targetUser.tempPasswordExpiresAt = Date.now() + TEMP_PASSWORD_TTL_MS;
    targetUser.tempPasswordConsumed = false;
  } else {
    targetUser.mustChangePassword = false;
    targetUser.tempPasswordExpiresAt = null;
    targetUser.tempPasswordConsumed = false;
  }

  const { hash, salt } = hashPassword(finalPassword);
  data.passwords[targetUser.id] = { hash, salt };
  targetUser.failedAttempts = 0;
  targetUser.lockedUntil = null;

  revokeUserSessions(targetUser.id);

  logAudit(
    adminUser,
    'USER_PASSWORD_RESET',
    targetUser.role === 'shopper' ? 'user' : 'staff',
    targetUser.id,
    `Admin ${adminUser.name} reset password for ${targetUser.role} account ${targetUser.name} (${maskEmail(targetUser.email)}) at ${new Date().toISOString()}`,
    targetUser.supermarketId || null,
    targetUser.branchId || null
  );
  db.save();

  const notice = buildPasswordChangedEmail({ lang: emailLang, name: targetUser.name });
  await sendEmail({
    to: targetUser.email,
    ...notice,
    enforceAddressRateLimit: false,
  });

  res.json({
    success: true,
    message: `Password reset for ${targetUser.name}`,
    ...(generatedPassword
      ? { generatedPassword, expiresAt: targetUser.tempPasswordExpiresAt }
      : {}),
  });
});

// Admin helper: reset primary shop owner password directly from the Supermarkets / Shops view
app.post('/api/admin/supermarkets/:id/reset-password', requireAuth, requireRole(['admin']), async (req, res) => {
  const adminUser = (req as any).user as User;
  const { newPassword, language } = req.body || {};
  const emailLang: EmailLanguage = language === 'sw' ? 'sw' : 'en';
  const data = db.getRaw();
  const sm = data.supermarkets.find((s) => s.id === req.params.id);
  if (!sm) return res.status(404).json({ error: 'Supermarket not found' });

  const ownerUser =
    data.users.find((u) => u.supermarketId === sm.id && u.role === 'owner') ||
    data.users.find((u) => u.email.toLowerCase() === sm.contactEmail.toLowerCase() && u.role !== 'admin');

  if (!ownerUser) {
    return res.status(404).json({ error: 'No shop owner account found for this supermarket.' });
  }

  const customPassword = typeof newPassword === 'string' && newPassword.trim() ? newPassword.trim() : '';
  if (customPassword && customPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  let generatedPassword: string | undefined;
  let finalPassword = customPassword;
  if (!finalPassword) {
    generatedPassword = generateTemporaryPassword();
    finalPassword = generatedPassword;
    ownerUser.mustChangePassword = true;
    ownerUser.tempPasswordExpiresAt = Date.now() + TEMP_PASSWORD_TTL_MS;
    ownerUser.tempPasswordConsumed = false;
  } else {
    ownerUser.mustChangePassword = false;
    ownerUser.tempPasswordExpiresAt = null;
    ownerUser.tempPasswordConsumed = false;
  }

  const { hash, salt } = hashPassword(finalPassword);
  data.passwords[ownerUser.id] = { hash, salt };
  ownerUser.failedAttempts = 0;
  ownerUser.lockedUntil = null;

  revokeUserSessions(ownerUser.id);

  logAudit(
    adminUser,
    'SHOP_PASSWORD_RESET',
    'supermarket',
    sm.id,
    `Admin ${adminUser.name} reset shop owner password for "${sm.name}" (${maskEmail(ownerUser.email)}) at ${new Date().toISOString()}`,
    sm.id
  );
  db.save();

  const notice = buildPasswordChangedEmail({ lang: emailLang, name: ownerUser.name });
  await sendEmail({
    to: ownerUser.email,
    ...notice,
    enforceAddressRateLimit: false,
  });

  res.json({
    success: true,
    message: `Shop password reset for ${sm.name} (${ownerUser.email})`,
    ownerEmail: ownerUser.email,
    ...(generatedPassword
      ? { generatedPassword, expiresAt: ownerUser.tempPasswordExpiresAt }
      : {}),
  });
});

// Update the single System Administrator's credentials (email, name, and/or password)
app.put('/api/admin/account', requireAuth, requireRole(['admin']), async (req, res) => {
  const adminUser = (req as any).user as User;
  const { currentPassword, newEmail, newPassword, name, language } = req.body || {};
  const emailLang: EmailLanguage = language === 'sw' ? 'sw' : 'en';

  if (!currentPassword || typeof currentPassword !== 'string') {
    return res.status(400).json({ error: 'Current password is required to update administrator credentials.' });
  }

  const data = db.getRaw();
  const dbAdmin = data.users.find((u) => u.id === adminUser.id && u.role === 'admin');
  if (!dbAdmin) {
    return res.status(404).json({ error: 'System administrator account not found.' });
  }

  const userPwd = data.passwords[dbAdmin.id];
  if (!userPwd || !verifyPassword(currentPassword, userPwd.hash, userPwd.salt)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  let emailChanged = false;
  let passwordChanged = false;

  if (newEmail !== undefined && typeof newEmail === 'string' && newEmail.trim()) {
    const cleanEmail = normalizeAndValidateEmail(newEmail);
    if (!cleanEmail) {
      return res.status(400).json({ error: 'Please enter a valid email address format.' });
    }
    if (data.users.some((u) => u.id !== dbAdmin.id && u.email.toLowerCase() === cleanEmail)) {
      return res.status(400).json({ error: 'This email is already in use by another account.' });
    }
    if (dbAdmin.email.toLowerCase() !== cleanEmail) {
      dbAdmin.email = cleanEmail;
      emailChanged = true;
    }
  }

  if (newPassword !== undefined && typeof newPassword === 'string' && newPassword.length > 0) {
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }
    const { hash, salt } = hashPassword(newPassword);
    data.passwords[dbAdmin.id] = { hash, salt };
    dbAdmin.mustChangePassword = false;
    dbAdmin.failedAttempts = 0;
    dbAdmin.lockedUntil = null;
    passwordChanged = true;
  }

  if (name !== undefined && typeof name === 'string' && name.trim()) {
    dbAdmin.name = name.trim();
  }

  if (emailChanged || passwordChanged) {
    // Revoke any other active admin sessions on credential change
    const currentSession = (req as any).session as SessionRecord | undefined;
    for (const [tok, sess] of sessions.entries()) {
      if (sess.userId === dbAdmin.id && (!currentSession || tok !== currentSession.token)) {
        sessions.delete(tok);
      }
    }
  }

  logAudit(
    dbAdmin,
    'ADMIN_ACCOUNT_UPDATED',
    'user',
    dbAdmin.id,
    `System Administrator updated account credentials${emailChanged ? ` (email changed to ${dbAdmin.email})` : ''}${passwordChanged ? ' (password updated)' : ''}.`
  );
  db.save();

  if (passwordChanged) {
    const notice = buildPasswordChangedEmail({ lang: emailLang, name: dbAdmin.name });
    await sendEmail({
      to: dbAdmin.email,
      ...notice,
      enforceAddressRateLimit: false,
    });
  }

  res.json({
    success: true,
    message: 'System Administrator credentials updated successfully.',
    user: {
      ...dbAdmin,
      mustChangePassword: dbAdmin.mustChangePassword ?? false,
      isPermanentAdmin: dbAdmin.isPermanentAdmin ?? true,
    },
  });
});

// Announcements: Filters out expired announcements
app.get('/api/announcements', (req, res) => {
  const user = getAuthUser(req);
  const data = db.getRaw();
  const now = new Date();

  const list = (data.announcements || []).filter((a) => {
    // Expiry check
    if (a.expiryDate && new Date(a.expiryDate) < now) return false;
    // Supermarket scope
    if (user?.role === 'admin') return true;
    if (!a.targetSupermarketId) return true;
    return a.targetSupermarketId === user?.supermarketId;
  });

  res.json(list);
});

app.post('/api/admin/announcements', requireAuth, requireRole(['admin']), (req, res) => {
  const user = (req as any).user as User;
  const { title, message, targetSupermarketId, priority, expiryDate } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'Title and message are required' });

  const data = db.getRaw();
  const newAnc: Announcement = {
    id: `anc_${Date.now()}`,
    title: title.trim(),
    message: message.trim(),
    targetSupermarketId: targetSupermarketId || null,
    priority: priority || 'normal',
    expiryDate: expiryDate ? new Date(expiryDate).toISOString() : null,
    readByUserIds: [],
    createdAt: new Date().toISOString(),
    authorName: user.name,
  };

  data.announcements.unshift(newAnc);
  db.save();

  res.json(newAnc);
});

// Mark announcement as read
app.post('/api/announcements/:id/read', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const data = db.getRaw();
  const anc = (data.announcements || []).find((a) => a.id === req.params.id);
  if (!anc) return res.status(404).json({ error: 'Announcement not found' });

  if (anc.targetSupermarketId && user.role !== 'admin' && anc.targetSupermarketId !== user.supermarketId) {
    return res.status(403).json({ error: 'Forbidden: Announcement is for another supermarket.' });
  }

  if (!anc.readByUserIds) anc.readByUserIds = [];
  if (!anc.readByUserIds.includes(user.id)) {
    anc.readByUserIds.push(user.id);
    db.save();
  }

  res.json({ success: true, announcement: anc });
});

// Support & Complaints Inbox (includes admin-only enrichment for password reset requests)
app.get('/api/support', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const { status, category } = req.query as Record<string, string>;
  const data = db.getRaw();

  let tickets = data.supportTickets || [];

  if (user.role !== 'admin') {
    tickets = tickets.filter((t) => t.userId === user.id);
  }

  if (status) tickets = tickets.filter((t) => t.status === status);
  if (category) tickets = tickets.filter((t) => t.category === category);

  if (user.role === 'admin') {
    tickets = tickets.map((t) => {
      if (t.category !== 'password_reset' || !t.passwordResetDetails) return t;
      const details = { ...t.passwordResetDetails };
      const matched =
        details.matchedUserId
          ? data.users.find((u) => u.id === details.matchedUserId && u.role !== 'admin')
          : null;

      if (matched) {
        const sm = matched.supermarketId
          ? data.supermarkets.find((s) => s.id === matched.supermarketId)
          : null;
        const pointsBal = getLedgerBalance(data, matched.id);
        const lastCart = data.carts
          .filter((c) => c.shopperId === matched.id && c.status === 'completed')
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
        const lastBranch = lastCart ? data.branches.find((b) => b.id === lastCart.branchId) : null;
        const lastSm = lastCart ? data.supermarkets.find((s) => s.id === lastCart.supermarketId) : null;

        details.matchedAccount = true;
        details.matchedRole = matched.role as Exclude<User['role'], 'admin'>;
        details.matchedSupermarketId = sm?.id || null;
        details.matchedSupermarketName = sm?.name || null;
        details.maskedEmail = maskEmail(matched.email);
        details.maskedPhone = maskPhone(matched.phone);
        details.identityHintPointsBalance = pointsBal;
        details.identityHintLastPurchase = lastCart
          ? `${lastSm?.name || 'Store'} (${lastBranch?.name || 'Branch'}) · ${new Date(lastCart.updatedAt).toLocaleDateString()} · KES ${lastCart.finalTotal.toLocaleString()}`
          : 'No completed carts yet';
      } else {
        details.matchedAccount = false;
        details.matchedUserId = null;
        details.matchedRole = null;
        details.maskedEmail = null;
        details.maskedPhone = null;
        details.identityHintPointsBalance = null;
        details.identityHintLastPurchase = null;
      }

      return { ...t, passwordResetDetails: details };
    });
  }

  res.json(tickets);
});

app.post('/api/support', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const { subject, message, category, supermarketId } = req.body;

  const allowedCategories = ['general', 'technical', 'billing', 'catalogue', 'scanner', 'cashier', 'stock', 'other'];

  if (!subject || typeof subject !== 'string' || subject.trim().length < 3 || subject.trim().length > 100) {
    return res.status(400).json({ error: 'Ticket subject must be between 3 and 100 characters.' });
  }

  if (!message || typeof message !== 'string' || message.trim().length < 10 || message.trim().length > 2000) {
    return res.status(400).json({ error: 'Ticket message must be between 10 and 2000 characters.' });
  }

  const cleanCategory = (category || 'other').toString().trim().toLowerCase();
  if (!allowedCategories.includes(cleanCategory)) {
    return res.status(400).json({ error: `Invalid category. Allowed categories: ${allowedCategories.join(', ')}` });
  }

  const data = db.getRaw();
  const newTicket: SupportTicket = {
    id: `tkt_${Date.now()}`,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    userPhone: user.phone,
    supermarketId: supermarketId || user.supermarketId || null,
    category: cleanCategory as any,
    subject: subject.trim(),
    message: message.trim(),
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!data.supportTickets) data.supportTickets = [];
  data.supportTickets.unshift(newTicket);
  db.save();

  res.json(newTicket);
});

app.put('/api/support/:id/reply', requireAuth, requireRole(['admin']), (req, res) => {
  const { reply, status } = req.body;
  const data = db.getRaw();
  const ticket = data.supportTickets.find((t) => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  if (reply) ticket.reply = reply;
  if (status) ticket.status = status;
  ticket.updatedAt = new Date().toISOString();
  db.save();

  res.json(ticket);
});

// Admin updates identity verification checklist on a password reset support request
app.put('/api/support/:id/verify-identity', requireAuth, requireRole(['admin']), (req, res) => {
  const adminUser = (req as any).user as User;
  const { phoneConfirmed, lastPurchaseOrPointsConfirmed } = req.body || {};
  const data = db.getRaw();
  const ticket = (data.supportTickets || []).find((t) => t.id === req.params.id);
  if (!ticket || ticket.category !== 'password_reset' || !ticket.passwordResetDetails) {
    return res.status(404).json({ error: 'Password reset request not found.' });
  }
  if (ticket.status === 'completed' || ticket.status === 'rejected') {
    return res.status(400).json({ error: `Request is already ${ticket.status}.` });
  }

  const nextPhone = Boolean(phoneConfirmed);
  const nextSecondary = Boolean(lastPurchaseOrPointsConfirmed);
  const nowIso = new Date().toISOString();
  ticket.passwordResetDetails.identityChecked = {
    phoneConfirmed: nextPhone,
    lastPurchaseOrPointsConfirmed: nextSecondary,
    verifiedByUserId: adminUser.id,
    verifiedByName: adminUser.name,
    verifiedAt: nowIso,
  };
  if (nextPhone && nextSecondary) {
    ticket.status = 'verified';
  } else if (ticket.status === 'verified') {
    ticket.status = 'open';
  }
  ticket.updatedAt = nowIso;

  logAudit(
    adminUser,
    'PASSWORD_RESET_IDENTITY_CHECKED',
    'user',
    ticket.passwordResetDetails.matchedUserId || ticket.id,
    `Admin ${adminUser.name} updated identity checklist on password reset request ${ticket.id} (phoneConfirmed=${nextPhone}, purchaseOrPointsConfirmed=${nextSecondary}).`
  );
  db.save();

  res.json(ticket);
});

// Admin generates a one-time 24h temporary password for a matching non-admin account from a support request
app.post('/api/support/:id/generate-temp-password', requireAuth, requireRole(['admin']), (req, res) => {
  const adminUser = (req as any).user as User;
  const { phoneConfirmed, lastPurchaseOrPointsConfirmed } = req.body || {};
  const data = db.getRaw();
  const ticket = (data.supportTickets || []).find((t) => t.id === req.params.id);
  if (!ticket || ticket.category !== 'password_reset' || !ticket.passwordResetDetails) {
    return res.status(404).json({ error: 'Password reset request not found.' });
  }

  if (ticket.status === 'completed' || ticket.status === 'rejected') {
    return res.status(400).json({ error: `Cannot generate password for ${ticket.status} request.` });
  }

  const existingChecklist = ticket.passwordResetDetails.identityChecked;
  const isPhoneOk = phoneConfirmed !== undefined ? Boolean(phoneConfirmed) : Boolean(existingChecklist?.phoneConfirmed);
  const isSecondaryOk =
    lastPurchaseOrPointsConfirmed !== undefined
      ? Boolean(lastPurchaseOrPointsConfirmed)
      : Boolean(existingChecklist?.lastPurchaseOrPointsConfirmed);

  if (!isPhoneOk || !isSecondaryOk) {
    return res.status(400).json({
      error: 'Complete both identity verification checks (phone number and last purchase or points balance) before generating a temporary password.',
    });
  }

  const targetId = ticket.passwordResetDetails.matchedUserId;
  if (!targetId) {
    return res.status(400).json({ error: 'No matching account found for this request.' });
  }

  const targetUser = data.users.find((u) => u.id === targetId);
  if (!targetUser) {
    return res.status(404).json({ error: 'Matched user account no longer exists.' });
  }

  // Strictly block resetting system admin account through this flow
  if (targetUser.role === 'admin') {
    return res.status(403).json({
      error: 'The system administrator account cannot be reset through this flow.',
    });
  }

  const tempPassword = generateTemporaryPassword();
  const { hash, salt } = hashPassword(tempPassword);
  data.passwords[targetUser.id] = { hash, salt };
  targetUser.mustChangePassword = true;
  targetUser.tempPasswordExpiresAt = Date.now() + TEMP_PASSWORD_TTL_MS;
  targetUser.tempPasswordConsumed = false;
  targetUser.failedAttempts = 0;
  targetUser.lockedUntil = null;

  revokeUserSessions(targetUser.id);

  const nowIso = new Date().toISOString();
  ticket.status = 'completed';
  ticket.updatedAt = nowIso;
  ticket.passwordResetDetails.identityChecked = {
    phoneConfirmed: true,
    lastPurchaseOrPointsConfirmed: true,
    verifiedByUserId: adminUser.id,
    verifiedByName: adminUser.name,
    verifiedAt: nowIso,
  };
  ticket.passwordResetDetails.tempPasswordExpiresAt = targetUser.tempPasswordExpiresAt;
  ticket.passwordResetDetails.resolvedByUserId = adminUser.id;
  ticket.passwordResetDetails.resolvedByName = adminUser.name;
  ticket.passwordResetDetails.resolvedAt = nowIso;

  logAudit(
    adminUser,
    'PASSWORD_RESET_TEMP_GENERATED',
    targetUser.role === 'owner' ? 'supermarket' : 'user',
    targetUser.id,
    `Admin ${adminUser.name} verified identity and generated a 24h temporary password for ${targetUser.role} account ${targetUser.name} (${maskEmail(targetUser.email)}) for request ${ticket.id} at ${nowIso}.`,
    targetUser.supermarketId || null,
    targetUser.branchId || null
  );
  db.save();

  res.json({
    success: true,
    tempPassword,
    expiresAt: targetUser.tempPasswordExpiresAt,
    ticket,
  });
});

// Admin rejects a password reset request with a reason
app.put('/api/support/:id/reject', requireAuth, requireRole(['admin']), (req, res) => {
  const adminUser = (req as any).user as User;
  const { reason } = req.body || {};
  if (!reason || typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 300) {
    return res.status(400).json({ error: 'Rejection reason is required (3-300 characters).' });
  }

  const data = db.getRaw();
  const ticket = (data.supportTickets || []).find((t) => t.id === req.params.id);
  if (!ticket || ticket.category !== 'password_reset' || !ticket.passwordResetDetails) {
    return res.status(404).json({ error: 'Password reset request not found.' });
  }

  if (ticket.status === 'completed') {
    return res.status(400).json({ error: 'Completed request cannot be rejected.' });
  }

  const nowIso = new Date().toISOString();
  ticket.status = 'rejected';
  ticket.updatedAt = nowIso;
  ticket.passwordResetDetails.rejectionReason = reason.trim();
  ticket.passwordResetDetails.resolvedByUserId = adminUser.id;
  ticket.passwordResetDetails.resolvedByName = adminUser.name;
  ticket.passwordResetDetails.resolvedAt = nowIso;

  logAudit(
    adminUser,
    'PASSWORD_RESET_REQUEST_REJECTED',
    'user',
    ticket.passwordResetDetails.matchedUserId || ticket.id,
    `Admin ${adminUser.name} rejected password reset request ${ticket.id} at ${nowIso}: ${reason.trim()}`
  );
  db.save();

  res.json({ success: true, ticket });
});

// Platform Audit Logs (Admin: everything, Owner: chain-scoped)
app.get('/api/audit-logs', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const data = db.getRaw();
  if (user.role === 'admin') {
    return res.json(data.auditLogs.slice(0, 150));
  }
  if (user.role === 'owner') {
    return res.json(data.auditLogs.filter((l) => l.supermarketId === user.supermarketId).slice(0, 150));
  }
  res.status(403).json({ error: 'Forbidden' });
});

// ==========================================
// 11. LOYALTY LEDGER, REWARDS CATALOGUE & REDEMPTION APIS
// ==========================================

function ensureLoyaltyContainers(data: ReturnType<typeof db.getRaw>) {
  if (!data.loyaltySettings) data.loyaltySettings = createDefaultLoyaltySettings();
  if (!Array.isArray(data.loyaltyLedger)) data.loyaltyLedger = [];
  if (!data.loyaltyBalances || typeof data.loyaltyBalances !== 'object') data.loyaltyBalances = {};
  if (!Array.isArray(data.loyaltyTransactions)) data.loyaltyTransactions = [];
  if (!Array.isArray(data.rewards)) data.rewards = [];
  if (!Array.isArray(data.rewardRedemptions)) data.rewardRedemptions = [];
}

function getLedgerBalance(data: ReturnType<typeof db.getRaw>, userId: string): number {
  ensureLoyaltyContainers(data);
  return data.loyaltyLedger
    .filter((e) => e.userId === userId)
    .reduce((sum, e) => sum + e.amount, 0);
}

function getStoredBalance(data: ReturnType<typeof db.getRaw>, userId: string): number {
  ensureLoyaltyContainers(data);
  return data.loyaltyBalances[userId] ?? 0;
}

function getLifetimeEarnedPoints(data: ReturnType<typeof db.getRaw>, userId: string): number {
  ensureLoyaltyContainers(data);
  const netEarned = data.loyaltyLedger
    .filter((e) => e.userId === userId && (e.type === 'earn' || e.type === 'reversal' || (e.type === 'adjustment' && e.amount > 0)))
    .reduce((sum, e) => sum + e.amount, 0);
  return Math.max(0, netEarned);
}

function computeTierFromLifetime(lifetimePoints: number, settings: LoyaltySettings): {
  tier: 'Bronze' | 'Silver' | 'Gold';
  nextTier: 'Silver' | 'Gold' | null;
  pointsToNextTier: number;
  tierBonusPerCart: number;
} {
  const silverThresh = Math.max(1, settings.tierThresholds?.silver ?? 500);
  const goldThresh = Math.max(silverThresh + 1, settings.tierThresholds?.gold ?? 1500);
  if (lifetimePoints >= goldThresh) {
    return {
      tier: 'Gold',
      nextTier: null,
      pointsToNextTier: 0,
      tierBonusPerCart: settings.tierBonuses?.gold ?? 5,
    };
  }
  if (lifetimePoints >= silverThresh) {
    return {
      tier: 'Silver',
      nextTier: 'Gold',
      pointsToNextTier: goldThresh - lifetimePoints,
      tierBonusPerCart: settings.tierBonuses?.silver ?? 2,
    };
  }
  return {
    tier: 'Bronze',
    nextTier: 'Silver',
    pointsToNextTier: silverThresh - lifetimePoints,
    tierBonusPerCart: settings.tierBonuses?.bronze ?? 0,
  };
}

function appendLedgerEntry(
  data: ReturnType<typeof db.getRaw>,
  params: {
    userId: string;
    type: LoyaltyLedgerEntryType;
    amount: number;
    reason: string;
    cartId?: string | null;
    cartShortCode?: string | null;
    redemptionId?: string | null;
    supermarketId?: string | null;
    supermarketName?: string | null;
    branchId?: string | null;
    branchName?: string | null;
    amountSpent?: number | null;
    createdByUserId?: string | null;
  }
): LoyaltyLedgerEntry {
  ensureLoyaltyContainers(data);
  const currentBal = getLedgerBalance(data, params.userId);
  const nextBalance = currentBal + params.amount;
  if (nextBalance < 0) {
    throw new Error('Loyalty points balance cannot go negative.');
  }

  const entry: LoyaltyLedgerEntry = {
    id: `led_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    userId: params.userId,
    type: params.type,
    amount: params.amount,
    balanceAfter: nextBalance,
    reason: params.reason,
    cartId: params.cartId ?? null,
    cartShortCode: params.cartShortCode ?? null,
    redemptionId: params.redemptionId ?? null,
    supermarketId: params.supermarketId ?? null,
    supermarketName: params.supermarketName ?? null,
    branchId: params.branchId ?? null,
    branchName: params.branchName ?? null,
    amountSpent: params.amountSpent ?? null,
    createdByUserId: params.createdByUserId ?? null,
    createdAt: new Date().toISOString(),
  };

  data.loyaltyLedger.unshift(entry);
  data.loyaltyBalances[params.userId] = nextBalance;
  return entry;
}

function getEarnedWindowTotals(data: ReturnType<typeof db.getRaw>, userId: string): {
  earnedToday: number;
  earnedThisMonth: number;
} {
  ensureLoyaltyContainers(data);
  const now = new Date();
  const todayPrefix = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const monthPrefix = now.toISOString().slice(0, 7); // YYYY-MM

  let earnedToday = 0;
  let earnedThisMonth = 0;

  for (const e of data.loyaltyLedger) {
    if (e.userId !== userId) continue;
    if (e.type !== 'earn' && e.type !== 'reversal') continue;
    if (e.createdAt.startsWith(monthPrefix)) {
      earnedThisMonth += e.amount;
    }
    if (e.createdAt.startsWith(todayPrefix)) {
      earnedToday += e.amount;
    }
  }

  return {
    earnedToday: Math.max(0, earnedToday),
    earnedThisMonth: Math.max(0, earnedThisMonth),
  };
}

function applyPointsExpiryIfEnabled(data: ReturnType<typeof db.getRaw>, userId: string): number {
  ensureLoyaltyContainers(data);
  const settings = data.loyaltySettings;
  if (!settings.pointsExpiryEnabled || !settings.pointsExpiryDays || settings.pointsExpiryDays <= 0) {
    return 0;
  }

  const cutoffMs = Date.now() - settings.pointsExpiryDays * 86400 * 1000;
  const expiredAlready = Math.abs(
    data.loyaltyLedger
      .filter((e) => e.userId === userId && e.type === 'expiry')
      .reduce((s, e) => s + e.amount, 0)
  );
  const spentOrReversed = Math.abs(
    data.loyaltyLedger
      .filter((e) => e.userId === userId && e.amount < 0 && e.type !== 'expiry')
      .reduce((s, e) => s + e.amount, 0)
  );
  const oldEarned = data.loyaltyLedger
    .filter((e) => e.userId === userId && e.amount > 0 && new Date(e.createdAt).getTime() < cutoffMs)
    .reduce((s, e) => s + e.amount, 0);

  const unspentExpired = Math.max(0, oldEarned - spentOrReversed - expiredAlready);
  const currentBal = getLedgerBalance(data, userId);
  const toExpire = Math.min(currentBal, unspentExpired);

  if (toExpire > 0) {
    appendLedgerEntry(data, {
      userId,
      type: 'expiry',
      amount: -toExpire,
      reason: `Points expired after ${settings.pointsExpiryDays} days`,
      createdByUserId: 'system',
    });
    db.save();
  }
  return toExpire;
}

function awardPointsForVerifiedCart(
  data: ReturnType<typeof db.getRaw>,
  cart: Cart,
  verifierUser: User
): number {
  ensureLoyaltyContainers(data);

  // Never award from unverified carts
  if (cart.status !== 'verified' && cart.status !== 'completed') {
    return 0;
  }

  // Strict idempotency: a cart can be evaluated & awarded at most once
  if (
    cart.loyaltyEvaluated ||
    data.loyaltyLedger.some((e) => e.cartId === cart.id && e.type === 'earn') ||
    data.loyaltyTransactions.some((tx) => tx.cartId === cart.id)
  ) {
    return 0;
  }

  cart.loyaltyEvaluated = true;

  // Only registered active shopper accounts accrue points (frozen if suspended; guests cannot farm)
  const shopperUser = data.users.find((u) => u.id === cart.shopperId);
  if (!shopperUser || shopperUser.role !== 'shopper' || shopperUser.status !== 'active') {
    cart.loyaltyPointsEarned = 0;
    return 0;
  }

  const settings = data.loyaltySettings;
  if (cart.finalTotal < Math.max(0, settings.minCartValueKes)) {
    cart.loyaltyPointsEarned = 0;
    return 0;
  }

  const lifetimeBefore = getLifetimeEarnedPoints(data, shopperUser.id);
  const tierInfo = computeTierFromLifetime(lifetimeBefore, settings);
  const spendPoints = Math.floor(cart.finalTotal / Math.max(1, settings.pointsPerKesAmount));
  const rawPoints = Math.max(
    0,
    spendPoints + Math.max(0, settings.bonusPointsPerVerifiedCart) + Math.max(0, tierInfo.tierBonusPerCart)
  );

  const { earnedToday, earnedThisMonth } = getEarnedWindowTotals(data, shopperUser.id);
  const dailyRemaining = Math.max(0, settings.dailyCapPoints - earnedToday);
  const monthlyRemaining = Math.max(0, settings.monthlyCapPoints - earnedThisMonth);
  const awardedPoints = Math.max(0, Math.min(rawPoints, dailyRemaining, monthlyRemaining));

  if (awardedPoints <= 0) {
    cart.loyaltyPointsEarned = 0;
    return 0;
  }

  const sm = data.supermarkets.find((s) => s.id === cart.supermarketId);
  const br = data.branches.find((b) => b.id === cart.branchId);
  const createdAt = cart.verifiedAt || new Date().toISOString();

  appendLedgerEntry(data, {
    userId: shopperUser.id,
    type: 'earn',
    amount: awardedPoints,
    reason: `Verified cart ${cart.shortCode} at ${br?.name || 'branch'} (KES ${cart.finalTotal.toLocaleString()})`,
    cartId: cart.id,
    cartShortCode: cart.shortCode,
    supermarketId: cart.supermarketId,
    supermarketName: sm?.name || 'Supermarket',
    branchId: cart.branchId,
    branchName: br?.name || 'Branch',
    amountSpent: cart.finalTotal,
    createdByUserId: verifierUser.id,
  });

  data.loyaltyTransactions.unshift({
    id: `lpt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    ownerKey: shopperUser.id,
    userId: shopperUser.id,
    supermarketId: cart.supermarketId,
    supermarketName: sm?.name || 'Supermarket',
    branchId: cart.branchId,
    branchName: br?.name || 'Branch',
    cartId: cart.id,
    cartShortCode: cart.shortCode,
    amountSpent: cart.finalTotal,
    pointsEarned: awardedPoints,
    createdAt,
  });

  cart.loyaltyPointsEarned = awardedPoints;

  logAudit(
    verifierUser,
    'LOYALTY_POINTS_EARNED',
    'loyalty',
    cart.id,
    `Awarded ${awardedPoints} pts to ${shopperUser.email} for verified cart ${cart.shortCode}`,
    cart.supermarketId,
    cart.branchId
  );

  return awardedPoints;
}

function reversePointsForCart(
  data: ReturnType<typeof db.getRaw>,
  cart: Cart,
  actorUser: User,
  reason: string
): number {
  ensureLoyaltyContainers(data);
  const cartEntries = data.loyaltyLedger.filter((e) => e.cartId === cart.id);
  const netAwarded = cartEntries
    .filter((e) => e.type === 'earn' || e.type === 'reversal')
    .reduce((s, e) => s + e.amount, 0);

  if (netAwarded <= 0) return 0;

  const currentBal = getLedgerBalance(data, cart.shopperId);
  const deduct = Math.min(currentBal, netAwarded);

  if (deduct > 0) {
    const sm = data.supermarkets.find((s) => s.id === cart.supermarketId);
    const br = data.branches.find((b) => b.id === cart.branchId);
    appendLedgerEntry(data, {
      userId: cart.shopperId,
      type: 'reversal',
      amount: -deduct,
      reason,
      cartId: cart.id,
      cartShortCode: cart.shortCode,
      supermarketId: cart.supermarketId,
      supermarketName: sm?.name || 'Supermarket',
      branchId: cart.branchId,
      branchName: br?.name || 'Branch',
      createdByUserId: actorUser.id,
    });
  }

  cart.loyaltyPointsEarned = 0;

  logAudit(
    actorUser,
    'LOYALTY_POINTS_REVERSED',
    'loyalty',
    cart.id,
    `Reversed ${deduct} pts for cart ${cart.shortCode}${deduct < netAwarded ? ` (shortfall ${netAwarded - deduct} already redeemed)` : ''}: ${reason}`,
    cart.supermarketId,
    cart.branchId
  );

  return deduct;
}

function generateRedemptionReference(existing: RewardRedemptionOrder[]): string {
  const used = new Set(existing.map((r) => r.referenceCode.toUpperCase()));
  for (let i = 0; i < 50; i++) {
    const code = `RW-${crypto.randomInt(100000, 1000000)}`;
    if (!used.has(code)) return code;
  }
  return `RW-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function buildLoyaltySummary(data: ReturnType<typeof db.getRaw>, userId: string, isFrozen = false): LoyaltyPointsSummary {
  ensureLoyaltyContainers(data);
  const settings = data.loyaltySettings;
  const ledgerBalance = getLedgerBalance(data, userId);
  const storedBalance = getStoredBalance(data, userId);
  const lifetimePoints = getLifetimeEarnedPoints(data, userId);
  const tierInfo = computeTierFromLifetime(lifetimePoints, settings);
  const { earnedToday, earnedThisMonth } = getEarnedWindowTotals(data, userId);

  const history = data.loyaltyTransactions
    .filter((tx) => tx.ownerKey === userId || tx.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const ledger = data.loyaltyLedger
    .filter((e) => e.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const storeMap = new Map<
    string,
    { supermarketId: string; supermarketName: string; points: number; completedCheckouts: number }
  >();

  for (const tx of history) {
    const cur = storeMap.get(tx.supermarketId);
    if (cur) {
      cur.points += tx.pointsEarned;
      cur.completedCheckouts += 1;
    } else {
      storeMap.set(tx.supermarketId, {
        supermarketId: tx.supermarketId,
        supermarketName: tx.supermarketName,
        points: tx.pointsEarned,
        completedCheckouts: 1,
      });
    }
  }

  return {
    totalPoints: ledgerBalance,
    storedBalance,
    ledgerBalance,
    lifetimePoints,
    earnedToday,
    earnedThisMonth,
    tier: tierInfo.tier,
    nextTier: tierInfo.nextTier,
    pointsToNextTier: tierInfo.pointsToNextTier,
    tierBonusPerCart: tierInfo.tierBonusPerCart,
    earnRateKes: settings.pointsPerKesAmount,
    bonusPointsPerVerifiedCart: settings.bonusPointsPerVerifiedCart,
    minCartValueKes: settings.minCartValueKes,
    dailyCapPoints: settings.dailyCapPoints,
    monthlyCapPoints: settings.monthlyCapPoints,
    maxOpenRedemptionsPerShopper: settings.maxOpenRedemptionsPerShopper,
    isFrozen,
    bySupermarket: Array.from(storeMap.values()).sort((a, b) => b.points - a.points),
    history: history.slice(0, 50),
    ledger: ledger.slice(0, 80),
  };
}

// Shopper Loyalty Points summary & ledger (never allows guest points farming)
app.get('/api/shopper/loyalty-points', (req, res) => {
  const user = getAuthUser(req);
  const data = db.getRaw();
  ensureLoyaltyContainers(data);

  if (!user || user.role !== 'shopper') {
    return res.json(buildLoyaltySummary(data, '__guest__', false));
  }

  applyPointsExpiryIfEnabled(data, user.id);
  const summary = buildLoyaltySummary(data, user.id, user.status === 'suspended');
  res.json(summary);
});

// Explicitly block client-supplied points claims / forged receipt claims
app.post(['/api/shopper/loyalty/claim', '/api/shopper/receipts/import'], requireAuth, (req, res) => {
  const user = (req as any).user as User;
  logAudit(
    user,
    'LOYALTY_FORGED_CLAIM_BLOCKED',
    'loyalty',
    user.id,
    'Blocked attempt to claim loyalty points directly from client or supplied receipt.'
  );
  res.status(403).json({
    error: 'Loyalty points can only be awarded when a cashier verifies your cart at the supermarket till.',
  });
});

// Public / Shopper Rewards Catalogue (active items only)
app.get('/api/rewards', (req, res) => {
  const data = db.getRaw();
  ensureLoyaltyContainers(data);
  const activeRewards = data.rewards.filter((r) => r.status === 'active');
  res.json(activeRewards);
});

// Shopper: view own redemption orders
app.get('/api/shopper/rewards/redemptions', requireAuth, requireRole(['shopper']), (req, res) => {
  const user = (req as any).user as User;
  const data = db.getRaw();
  ensureLoyaltyContainers(data);
  const orders = data.rewardRedemptions
    .filter((r) => r.shopperId === user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(orders);
});

// Shopper: Atomic Reward Redemption (check balance, check stock, reserve points, create order in one step)
app.post('/api/shopper/rewards/redeem', redemptionRateLimiter, requireAuth, requireRole(['shopper']), (req, res) => {
  const user = (req as any).user as User;
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'Account suspended. Loyalty points are frozen and cannot be redeemed.' });
  }

  const {
    rewardId,
    size,
    color,
    fulfillmentMethod,
    branchId,
    contactPhone,
    deliveryAddress,
  } = req.body || {};

  const data = db.getRaw();
  ensureLoyaltyContainers(data);
  const settings = data.loyaltySettings;

  // Validate reward
  const reward = data.rewards.find((r) => r.id === rewardId && r.status === 'active');
  if (!reward) {
    return res.status(404).json({ error: 'Reward item is unavailable or not found.' });
  }

  // Validate size & stock for that size
  const cleanSize = typeof size === 'string' ? size.trim() : '';
  if (!cleanSize || !reward.sizes.includes(cleanSize)) {
    return res.status(400).json({ error: 'Please choose a valid size for this reward.' });
  }
  const availableStock = Number(reward.stockBySize?.[cleanSize] ?? 0);
  if (availableStock <= 0) {
    return res.status(400).json({ error: `Size "${cleanSize}" is currently out of stock.` });
  }

  // Validate colour
  const cleanColor = typeof color === 'string' && color.trim()
    ? color.trim()
    : (reward.colors[0] || 'Default');
  if (reward.colors.length > 0 && !reward.colors.includes(cleanColor)) {
    return res.status(400).json({ error: 'Please select an available colour.' });
  }

  // Validate fulfillment & minimal personal data
  if (fulfillmentMethod !== 'collection' && fulfillmentMethod !== 'delivery') {
    return res.status(400).json({ error: 'Choose either branch collection or delivery.' });
  }

  const cleanPhone = typeof contactPhone === 'string' && contactPhone.trim()
    ? contactPhone.trim()
    : (user.phone || '').trim();
  if (cleanPhone.length < 6) {
    return res.status(400).json({ error: 'A valid contact phone number is required.' });
  }

  let resolvedBranch: Branch | undefined;
  let resolvedSm: Supermarket | undefined;
  let cleanAddress: string | null = null;

  if (fulfillmentMethod === 'collection') {
    resolvedBranch = data.branches.find((b) => b.id === branchId && b.isActive);
    if (!resolvedBranch) {
      return res.status(400).json({ error: 'Please select an active participating branch for collection.' });
    }
    resolvedSm = data.supermarkets.find((s) => s.id === resolvedBranch!.supermarketId && s.status === 'active');
    if (!resolvedSm) {
      return res.status(400).json({ error: 'Selected supermarket is not active.' });
    }
  } else {
    const rawAddr = typeof deliveryAddress === 'string' ? deliveryAddress.trim() : '';
    if (rawAddr.length < 5) {
      return res.status(400).json({ error: 'Please enter your delivery address.' });
    }
    cleanAddress = rawAddr.slice(0, 240);
  }

  // Check max open redemptions per shopper
  const openRedemptionsCount = data.rewardRedemptions.filter(
    (o) =>
      o.shopperId === user.id &&
      (o.status === 'requested' || o.status === 'approved' || o.status === 'ready' || o.status === 'dispatched')
  ).length;

  if (openRedemptionsCount >= Math.max(1, settings.maxOpenRedemptionsPerShopper)) {
    return res.status(429).json({
      error: `You have reached the limit of ${settings.maxOpenRedemptionsPerShopper} open reward redemptions. Wait for existing orders to finish before placing another.`,
    });
  }

  // Apply expiry if enabled before checking balance
  applyPointsExpiryIfEnabled(data, user.id);

  // Critical atomic section (synchronous): verify balance >= cost, reserve points, create order
  const ledgerBalance = getLedgerBalance(data, user.id);
  const storedBalance = getStoredBalance(data, user.id);
  const effectiveBalance = Math.min(ledgerBalance, storedBalance);

  if (effectiveBalance < reward.pointsCost) {
    return res.status(400).json({
      error: `Not enough points. You need ${reward.pointsCost - effectiveBalance} more points.`,
      pointsNeeded: reward.pointsCost - effectiveBalance,
    });
  }

  const now = new Date().toISOString();
  const orderId = `red_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const referenceCode = generateRedemptionReference(data.rewardRedemptions);

  appendLedgerEntry(data, {
    userId: user.id,
    type: 'redemption_reserve',
    amount: -reward.pointsCost,
    reason: `Reserved for ${reward.name} (${cleanSize}, ${cleanColor}) · Ref ${referenceCode}`,
    redemptionId: orderId,
    branchId: resolvedBranch?.id ?? null,
    branchName: resolvedBranch?.name ?? null,
    supermarketId: resolvedSm?.id ?? null,
    supermarketName: resolvedSm?.name ?? null,
    createdByUserId: user.id,
  });

  const newOrder: RewardRedemptionOrder = {
    id: orderId,
    referenceCode,
    shopperId: user.id,
    shopperName: user.name,
    shopperEmail: user.email,
    rewardId: reward.id,
    rewardName: reward.name,
    rewardImageUrl: reward.imageUrl,
    pointsCost: reward.pointsCost,
    unitCostKes: reward.unitCostKes,
    size: cleanSize,
    color: cleanColor,
    fulfillmentMethod,
    branchId: resolvedBranch?.id ?? null,
    branchName: resolvedBranch?.name ?? null,
    supermarketName: resolvedSm?.name ?? null,
    contactPhone: cleanPhone,
    deliveryAddress: cleanAddress,
    status: 'requested',
    stockDecreased: false,
    pointsRefunded: false,
    notificationMessage: `Redemption ${referenceCode} requested. ${reward.pointsCost} points reserved awaiting admin review.`,
    createdAt: now,
    updatedAt: now,
  };

  data.rewardRedemptions.unshift(newOrder);

  logAudit(
    user,
    'REWARD_REDEMPTION_REQUESTED',
    'redemption',
    orderId,
    `Shopper ${user.email} redeemed ${reward.pointsCost} pts for ${reward.name} (${cleanSize}, ${cleanColor}) [${fulfillmentMethod}] Ref ${referenceCode}`
  );
  db.save();

  res.json({
    success: true,
    order: newOrder,
    summary: buildLoyaltySummary(data, user.id, false),
  });
});

// Admin: Get & Update Loyalty Settings
app.get('/api/admin/loyalty/settings', requireAuth, requireRole(['admin']), (req, res) => {
  const data = db.getRaw();
  ensureLoyaltyContainers(data);
  res.json(data.loyaltySettings);
});

app.put('/api/admin/loyalty/settings', requireAuth, requireRole(['admin']), (req, res) => {
  const adminUser = (req as any).user as User;
  const data = db.getRaw();
  ensureLoyaltyContainers(data);

  const body = req.body || {};
  const next: LoyaltySettings = {
    pointsPerKesAmount: Math.max(1, Math.round(Number(body.pointsPerKesAmount ?? data.loyaltySettings.pointsPerKesAmount))),
    bonusPointsPerVerifiedCart: Math.max(0, Math.round(Number(body.bonusPointsPerVerifiedCart ?? data.loyaltySettings.bonusPointsPerVerifiedCart))),
    minCartValueKes: Math.max(0, Math.round(Number(body.minCartValueKes ?? data.loyaltySettings.minCartValueKes))),
    dailyCapPoints: Math.max(0, Math.round(Number(body.dailyCapPoints ?? data.loyaltySettings.dailyCapPoints))),
    monthlyCapPoints: Math.max(0, Math.round(Number(body.monthlyCapPoints ?? data.loyaltySettings.monthlyCapPoints))),
    maxOpenRedemptionsPerShopper: Math.max(1, Math.round(Number(body.maxOpenRedemptionsPerShopper ?? data.loyaltySettings.maxOpenRedemptionsPerShopper))),
    pointsExpiryEnabled: Boolean(body.pointsExpiryEnabled ?? data.loyaltySettings.pointsExpiryEnabled),
    pointsExpiryDays: Math.max(1, Math.round(Number(body.pointsExpiryDays ?? data.loyaltySettings.pointsExpiryDays))),
    tierThresholds: {
      silver: Math.max(10, Math.round(Number(body.tierThresholds?.silver ?? data.loyaltySettings.tierThresholds.silver))),
      gold: Math.max(20, Math.round(Number(body.tierThresholds?.gold ?? data.loyaltySettings.tierThresholds.gold))),
    },
    tierBonuses: {
      bronze: Math.max(0, Math.round(Number(body.tierBonuses?.bronze ?? data.loyaltySettings.tierBonuses.bronze))),
      silver: Math.max(0, Math.round(Number(body.tierBonuses?.silver ?? data.loyaltySettings.tierBonuses.silver))),
      gold: Math.max(0, Math.round(Number(body.tierBonuses?.gold ?? data.loyaltySettings.tierBonuses.gold))),
    },
  };

  if (next.tierThresholds.gold <= next.tierThresholds.silver) {
    next.tierThresholds.gold = next.tierThresholds.silver + 100;
  }

  data.loyaltySettings = next;
  logAudit(
    adminUser,
    'LOYALTY_SETTINGS_UPDATED',
    'loyalty',
    'settings',
    `Admin updated loyalty rules: 1 pt/KES ${next.pointsPerKesAmount}, bonus=${next.bonusPointsPerVerifiedCart}, minCart=KES ${next.minCartValueKes}, dailyCap=${next.dailyCapPoints}, monthlyCap=${next.monthlyCapPoints}, maxOpen=${next.maxOpenRedemptionsPerShopper}`
  );
  db.save();

  res.json(next);
});

// Admin: Reversal of points for an already verified/completed cart
app.post('/api/admin/carts/:id/reverse-points', requireAuth, requireRole(['admin']), (req, res) => {
  const adminUser = (req as any).user as User;
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === req.params.id);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
    ? req.body.reason.trim()
    : 'Admin fraud / audit reversal';

  const reversed = reversePointsForCart(data, cart, adminUser, reason);
  cart.status = 'flagged';
  cart.mismatchNotes = reason;
  cart.updatedAt = new Date().toISOString();
  db.save();

  res.json({ success: true, cart, reversedPoints: reversed });
});

// Admin: Rewards Catalogue CRUD (admin only; owners/staff/shoppers get 403)
app.get('/api/admin/rewards', requireAuth, requireRole(['admin']), (req, res) => {
  const data = db.getRaw();
  ensureLoyaltyContainers(data);
  res.json(data.rewards);
});

app.post('/api/admin/rewards', requireAuth, requireRole(['admin']), (req, res) => {
  const adminUser = (req as any).user as User;
  const { name, nameSw, description, descriptionSw, imageUrl, pointsCost, unitCostKes, colors, sizes, stockBySize, status } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Reward name is required.' });
  }
  const cost = Number(pointsCost);
  if (!Number.isFinite(cost) || cost < 1) {
    return res.status(400).json({ error: 'Points cost must be at least 1.' });
  }

  const parsedSizes: string[] = Array.isArray(sizes) && sizes.length > 0
    ? sizes.map((s: any) => String(s).trim()).filter(Boolean)
    : ['S', 'M', 'L', 'XL', 'XXL'];
  const parsedColors: string[] = Array.isArray(colors) && colors.length > 0
    ? colors.map((c: any) => String(c).trim()).filter(Boolean)
    : ['Emerald Green'];

  const normalizedStock: Record<string, number> = {};
  for (const sz of parsedSizes) {
    normalizedStock[sz] = Math.max(0, Math.round(Number(stockBySize?.[sz] ?? 0)));
  }

  const now = new Date().toISOString();
  const item: RewardItem = {
    id: `rew_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    name: name.trim(),
    nameSw: typeof nameSw === 'string' && nameSw.trim() ? nameSw.trim() : undefined,
    description: typeof description === 'string' ? description.trim() : '',
    descriptionSw: typeof descriptionSw === 'string' && descriptionSw.trim() ? descriptionSw.trim() : undefined,
    imageUrl: typeof imageUrl === 'string' && imageUrl.trim() ? imageUrl.trim() : '/images/rewards/smartcart-tshirt.svg',
    pointsCost: Math.round(cost),
    unitCostKes: Math.max(0, Math.round(Number(unitCostKes || 0))),
    colors: parsedColors,
    sizes: parsedSizes,
    stockBySize: normalizedStock,
    status: status === 'hidden' ? 'hidden' : 'active',
    createdAt: now,
    updatedAt: now,
  };

  const data = db.getRaw();
  ensureLoyaltyContainers(data);
  data.rewards.unshift(item);

  logAudit(adminUser, 'REWARD_CREATED', 'reward', item.id, `Created reward "${item.name}" (${item.pointsCost} pts)`);
  db.save();

  res.json(item);
});

app.put('/api/admin/rewards/:id', requireAuth, requireRole(['admin']), (req, res) => {
  const adminUser = (req as any).user as User;
  const data = db.getRaw();
  ensureLoyaltyContainers(data);
  const reward = data.rewards.find((r) => r.id === req.params.id);
  if (!reward) return res.status(404).json({ error: 'Reward not found.' });

  const { name, nameSw, description, descriptionSw, imageUrl, pointsCost, unitCostKes, colors, sizes, stockBySize, status } = req.body || {};

  if (name !== undefined && typeof name === 'string' && name.trim()) reward.name = name.trim();
  if (nameSw !== undefined) reward.nameSw = typeof nameSw === 'string' && nameSw.trim() ? nameSw.trim() : undefined;
  if (description !== undefined && typeof description === 'string') reward.description = description.trim();
  if (descriptionSw !== undefined) reward.descriptionSw = typeof descriptionSw === 'string' && descriptionSw.trim() ? descriptionSw.trim() : undefined;
  if (imageUrl !== undefined && typeof imageUrl === 'string' && imageUrl.trim()) reward.imageUrl = imageUrl.trim();
  if (pointsCost !== undefined) {
    const cost = Number(pointsCost);
    if (!Number.isFinite(cost) || cost < 1) return res.status(400).json({ error: 'Points cost must be at least 1.' });
    reward.pointsCost = Math.round(cost);
  }
  if (unitCostKes !== undefined) reward.unitCostKes = Math.max(0, Math.round(Number(unitCostKes || 0)));
  if (Array.isArray(colors) && colors.length > 0) {
    reward.colors = colors.map((c: any) => String(c).trim()).filter(Boolean);
  }
  if (Array.isArray(sizes) && sizes.length > 0) {
    reward.sizes = sizes.map((s: any) => String(s).trim()).filter(Boolean);
  }
  if (stockBySize && typeof stockBySize === 'object') {
    const nextStock: Record<string, number> = {};
    for (const sz of reward.sizes) {
      nextStock[sz] = Math.max(0, Math.round(Number(stockBySize[sz] ?? reward.stockBySize[sz] ?? 0)));
    }
    reward.stockBySize = nextStock;
  }
  if (status === 'active' || status === 'hidden') {
    reward.status = status;
  }
  reward.updatedAt = new Date().toISOString();

  logAudit(adminUser, 'REWARD_UPDATED', 'reward', reward.id, `Updated reward "${reward.name}" (${reward.pointsCost} pts, status=${reward.status})`);
  db.save();

  res.json(reward);
});

app.delete('/api/admin/rewards/:id', requireAuth, requireRole(['admin']), (req, res) => {
  const adminUser = (req as any).user as User;
  const data = db.getRaw();
  ensureLoyaltyContainers(data);
  const idx = data.rewards.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Reward not found.' });

  const reward = data.rewards[idx];
  const hasOpenOrders = data.rewardRedemptions.some(
    (o) => o.rewardId === reward.id && (o.status === 'requested' || o.status === 'approved' || o.status === 'ready' || o.status === 'dispatched')
  );
  if (hasOpenOrders) {
    return res.status(400).json({ error: 'Cannot delete a reward that has open redemption orders. Hide it instead.' });
  }

  data.rewards.splice(idx, 1);
  logAudit(adminUser, 'REWARD_DELETED', 'reward', reward.id, `Deleted reward "${reward.name}"`);
  db.save();

  res.json({ success: true });
});

function computeAdminLoyaltyTotals(data: ReturnType<typeof db.getRaw>) {
  ensureLoyaltyContainers(data);
  let pointsIssued = 0;
  let pointsReversed = 0;
  let pointsExpired = 0;
  for (const e of data.loyaltyLedger) {
    if (e.type === 'earn' || (e.type === 'adjustment' && e.amount > 0)) {
      pointsIssued += e.amount;
    } else if (e.type === 'reversal') {
      pointsReversed += Math.abs(e.amount);
    } else if (e.type === 'expiry') {
      pointsExpired += Math.abs(e.amount);
    }
  }

  const pointsRedeemed = data.rewardRedemptions
    .filter((o) => o.status !== 'cancelled')
    .reduce((sum, o) => sum + o.pointsCost, 0);

  const pointsOutstanding = Object.values(data.loyaltyBalances).reduce((s, b) => s + Math.max(0, b), 0);

  const currentMonthPrefix = new Date().toISOString().slice(0, 7);
  const fulfilledThisMonth = data.rewardRedemptions.filter(
    (o) => o.status === 'completed' && (o.updatedAt || o.createdAt).startsWith(currentMonthPrefix)
  );
  const fulfilledCostThisMonthKes = fulfilledThisMonth.reduce((sum, o) => sum + (o.unitCostKes || 0), 0);

  return {
    pointsIssued: Math.max(0, pointsIssued - pointsReversed),
    pointsRedeemed,
    pointsOutstanding,
    pointsExpired,
    fulfilledCountThisMonth: fulfilledThisMonth.length,
    fulfilledCostThisMonthKes,
  };
}

// Admin: Rewards Orders Queue + Totals
app.get('/api/admin/redemptions', requireAuth, requireRole(['admin']), (req, res) => {
  const data = db.getRaw();
  ensureLoyaltyContainers(data);
  const statusFilter = (req.query.status as string) || '';
  const q = ((req.query.q as string) || '').trim().toLowerCase();

  let orders = [...data.rewardRedemptions];
  if (statusFilter && statusFilter !== 'all') {
    orders = orders.filter((o) => o.status === statusFilter);
  }
  if (q) {
    orders = orders.filter(
      (o) =>
        o.referenceCode.toLowerCase().includes(q) ||
        o.shopperName.toLowerCase().includes(q) ||
        o.shopperEmail.toLowerCase().includes(q) ||
        o.contactPhone.toLowerCase().includes(q) ||
        o.rewardName.toLowerCase().includes(q)
    );
  }

  orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({
    orders,
    totals: computeAdminLoyaltyTotals(data),
  });
});

// Admin: Approve, Reject/Cancel, Mark Ready/Dispatched, or Complete a Redemption Order
app.put('/api/admin/redemptions/:id/status', requireAuth, requireRole(['admin']), (req, res) => {
  const adminUser = (req as any).user as User;
  const { status, reason } = req.body || {};
  const allowed: RedemptionStatus[] = ['approved', 'ready', 'dispatched', 'completed', 'cancelled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid redemption status.' });
  }

  const data = db.getRaw();
  ensureLoyaltyContainers(data);
  const order = data.rewardRedemptions.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Redemption order not found.' });

  if (order.status === 'completed' || order.status === 'cancelled') {
    return res.status(400).json({ error: `Order ${order.referenceCode} is already ${order.status} and cannot be changed.` });
  }

  const reward = data.rewards.find((r) => r.id === order.rewardId);
  const now = new Date().toISOString();

  if (status === 'approved') {
    if (order.status !== 'requested') {
      return res.status(400).json({ error: 'Only requested orders can be approved.' });
    }
    if (!reward) {
      return res.status(404).json({ error: 'Reward item no longer exists in catalogue.' });
    }
    const curStock = Number(reward.stockBySize?.[order.size] ?? 0);
    if (curStock <= 0) {
      return res.status(400).json({ error: `Size "${order.size}" is out of stock; cannot approve.` });
    }
    reward.stockBySize[order.size] = curStock - 1;
    reward.updatedAt = now;
    order.stockDecreased = true;
    order.status = 'approved';
    order.notificationMessage = `Your reward ${order.referenceCode} (${order.rewardName}, ${order.size}) has been approved!`;
  } else if (status === 'ready') {
    if (order.status !== 'approved') {
      return res.status(400).json({ error: 'Approve the order before marking it ready for collection.' });
    }
    order.status = 'ready';
    order.notificationMessage = `Your reward ${order.referenceCode} is ready for collection${order.branchName ? ` at ${order.branchName}` : ''}.`;
  } else if (status === 'dispatched') {
    if (order.status !== 'approved') {
      return res.status(400).json({ error: 'Approve the order before marking it dispatched.' });
    }
    order.status = 'dispatched';
    order.notificationMessage = `Your reward ${order.referenceCode} has been dispatched for delivery.`;
  } else if (status === 'completed') {
    if (order.status !== 'approved' && order.status !== 'ready' && order.status !== 'dispatched') {
      return res.status(400).json({ error: 'Order must be approved before marking completed.' });
    }
    order.status = 'completed';
    order.notificationMessage = `Reward ${order.referenceCode} fulfilled and completed. Thank you for shopping with Smart Cart!`;
  } else if (status === 'cancelled') {
    const cleanReason = typeof reason === 'string' && reason.trim()
      ? reason.trim()
      : 'Rejected / cancelled by platform administrator';

    // Refund reserved points ONCE
    if (!order.pointsRefunded) {
      appendLedgerEntry(data, {
        userId: order.shopperId,
        type: 'redemption_refund',
        amount: order.pointsCost,
        reason: `Refund for cancelled reward ${order.referenceCode}: ${cleanReason}`,
        redemptionId: order.id,
        createdByUserId: adminUser.id,
      });
      order.pointsRefunded = true;
    }

    // Restore stock ONCE if it had been decreased upon approval
    if (order.stockDecreased && reward) {
      reward.stockBySize[order.size] = Number(reward.stockBySize?.[order.size] ?? 0) + 1;
      reward.updatedAt = now;
      order.stockDecreased = false;
    }

    order.status = 'cancelled';
    order.rejectionReason = cleanReason;
    order.notificationMessage = `Order ${order.referenceCode} was cancelled (${cleanReason}). ${order.pointsCost} points returned to your balance.`;
  }

  order.updatedAt = now;

  logAudit(
    adminUser,
    `REDEMPTION_${status.toUpperCase()}`,
    'redemption',
    order.id,
    `Order ${order.referenceCode} (${order.shopperEmail}, ${order.rewardName} ${order.size}) -> ${status}${order.rejectionReason ? `: ${order.rejectionReason}` : ''}`
  );
  db.save();

  res.json({
    success: true,
    order,
    totals: computeAdminLoyaltyTotals(data),
  });
});

// Admin: CSV exports for each loyalty metric & orders queue
app.get('/api/admin/redemptions/export-csv', requireAuth, requireRole(['admin']), (req, res) => {
  const adminUser = (req as any).user as User;
  const data = db.getRaw();
  ensureLoyaltyContainers(data);
  const type = ((req.query.type as string) || 'orders').toLowerCase();
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  let csv = '';
  let filename = 'loyalty_orders.csv';

  if (type === 'issued') {
    filename = 'loyalty_points_issued.csv';
    const rows = data.loyaltyLedger.filter((e) => e.type === 'earn' || e.type === 'reversal' || e.type === 'adjustment');
    csv =
      'entry_id,user_id,type,points_amount,balance_after,cart_code,supermarket,branch,reason,created_at\n' +
      rows
        .map((e) =>
          [e.id, e.userId, e.type, e.amount, e.balanceAfter, e.cartShortCode || '', e.supermarketName || '', e.branchName || '', e.reason, e.createdAt]
            .map(esc)
            .join(',')
        )
        .join('\n');
  } else if (type === 'redeemed') {
    filename = 'loyalty_points_redeemed.csv';
    const rows = data.rewardRedemptions.filter((o) => o.status !== 'cancelled');
    csv =
      'reference_code,shopper_name,shopper_email,reward_name,size,color,points_cost,fulfillment_method,status,created_at\n' +
      rows
        .map((o) =>
          [o.referenceCode, o.shopperName, o.shopperEmail, o.rewardName, o.size, o.color, o.pointsCost, o.fulfillmentMethod, o.status, o.createdAt]
            .map(esc)
            .join(',')
        )
        .join('\n');
  } else if (type === 'outstanding') {
    filename = 'loyalty_points_outstanding.csv';
    const shoppers = data.users.filter((u) => u.role === 'shopper');
    csv =
      'user_id,name,email,status,stored_balance,ledger_balance,lifetime_earned\n' +
      shoppers
        .map((u) =>
          [
            u.id,
            u.name,
            u.email,
            u.status,
            getStoredBalance(data, u.id),
            getLedgerBalance(data, u.id),
            getLifetimeEarnedPoints(data, u.id),
          ]
            .map(esc)
            .join(',')
        )
        .join('\n');
  } else if (type === 'fulfilled_cost') {
    filename = 'loyalty_fulfilled_cost_this_month.csv';
    const monthPrefix = new Date().toISOString().slice(0, 7);
    const rows = data.rewardRedemptions.filter(
      (o) => o.status === 'completed' && (o.updatedAt || o.createdAt).startsWith(monthPrefix)
    );
    csv =
      'reference_code,reward_name,size,color,unit_cost_kes,points_cost,shopper_email,completed_at\n' +
      rows
        .map((o) =>
          [o.referenceCode, o.rewardName, o.size, o.color, o.unitCostKes, o.pointsCost, o.shopperEmail, o.updatedAt]
            .map(esc)
            .join(',')
        )
        .join('\n');
  } else {
    filename = 'loyalty_redemption_orders.csv';
    csv =
      'reference_code,shopper_name,shopper_email,contact_phone,reward_name,size,color,points_cost,unit_cost_kes,fulfillment,branch,delivery_address,status,rejection_reason,created_at,updated_at\n' +
      data.rewardRedemptions
        .map((o) =>
          [
            o.referenceCode,
            o.shopperName,
            o.shopperEmail,
            o.contactPhone,
            o.rewardName,
            o.size,
            o.color,
            o.pointsCost,
            o.unitCostKes,
            o.fulfillmentMethod,
            o.branchName || '',
            o.deliveryAddress || '',
            o.status,
            o.rejectionReason || '',
            o.createdAt,
            o.updatedAt,
          ]
            .map(esc)
            .join(',')
        )
        .join('\n');
  }

  logAudit(adminUser, 'LOYALTY_CSV_EXPORTED', 'loyalty', type, `Exported loyalty CSV report: ${type}`);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// ==========================================
// 12. PROTECTED GEMINI AI ASSISTANT & GOOGLE MAPS GROUNDING
// ==========================================

const AI_MAX_MESSAGE_LENGTH = 1000;
const AI_MAX_HISTORY_TURNS = 10;
const AI_MAX_HISTORY_INPUT = 50;

function getAiUserHourlyCap(): number {
  const parsed = Number(process.env.AI_USER_HOURLY_CAP);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 20;
}

function getAiUserDailyCap(): number {
  const parsed = Number(process.env.AI_USER_DAILY_CAP);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 50;
}

function getAiGlobalDailyCap(): number {
  const parsed = Number(process.env.AI_DAILY_CAP);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 500;
}

function validateAiLanguage(raw: unknown): 'en' | 'sw' | null {
  if (raw === undefined || raw === null) return 'en';
  if (raw === 'en' || raw === 'sw') return raw;
  return null;
}

function validateOptionalCoordinates(
  rawLat: unknown,
  rawLng: unknown
): { valid: boolean; lat?: number; lng?: number; error?: string } {
  const hasLat = rawLat !== undefined && rawLat !== null;
  const hasLng = rawLng !== undefined && rawLng !== null;
  if (!hasLat && !hasLng) return { valid: true };
  if (hasLat !== hasLng) {
    return { valid: false, error: 'Both lat and lng coordinates must be provided together.' };
  }
  if (typeof rawLat === 'boolean' || typeof rawLng === 'boolean' || rawLat === '' || rawLng === '') {
    return { valid: false, error: 'Coordinates lat and lng must be valid finite numbers.' };
  }
  const lat = typeof rawLat === 'number' ? rawLat : Number(rawLat);
  const lng = typeof rawLng === 'number' ? rawLng : Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { valid: false, error: 'Coordinates lat and lng must be valid finite numbers.' };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { valid: false, error: 'Coordinates out of range (lat -90..90, lng -180..180).' };
  }
  return { valid: true, lat, lng };
}

function consumeAiQuota(
  user: User,
  endpoint: '/api/ai/chat' | '/api/ai/maps-grounding',
  lang: 'en' | 'sw',
  hasCoords: boolean
): { allowed: boolean; error?: string } {
  const data = db.getRaw();
  if (!Array.isArray(data.aiUsageLogs)) {
    data.aiUsageLogs = [];
  }

  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const todayUtc = new Date(now).toISOString().slice(0, 10);
  const cutoffPrune = now - 48 * 60 * 60 * 1000;

  // Prune entries older than 48h to keep file storage bounded
  if (data.aiUsageLogs.length > 500) {
    data.aiUsageLogs = data.aiUsageLogs.filter((entry) => entry.createdAt >= cutoffPrune);
  }

  let userHourlyCount = 0;
  let userDailyCount = 0;
  let globalDailyCount = 0;

  for (const entry of data.aiUsageLogs) {
    const ts = Number(entry.createdAt);
    if (!Number.isFinite(ts)) continue;
    const isToday = new Date(ts).toISOString().slice(0, 10) === todayUtc;
    if (isToday) {
      globalDailyCount += 1;
      if (entry.userId === user.id) {
        userDailyCount += 1;
      }
    }
    if (ts >= oneHourAgo && entry.userId === user.id) {
      userHourlyCount += 1;
    }
  }

  const globalCap = getAiGlobalDailyCap();
  if (globalDailyCount >= globalCap) {
    return {
      allowed: false,
      error:
        lang === 'sw'
          ? 'Kiwango cha juu cha matumizi ya msaidizi wa AI kwa siku nzima kimefikiwa. Tafadhali jaribu tena kesho.'
          : 'Daily platform AI usage capacity has been reached. Please try again tomorrow.',
    };
  }

  const userDailyCap = getAiUserDailyCap();
  if (userDailyCount >= userDailyCap) {
    return {
      allowed: false,
      error:
        lang === 'sw'
          ? 'Umefikia kikomo chako cha maombi ya AI kwa leo. Tafadhali jaribu tena kesho.'
          : 'You have reached your daily AI assistant quota. Please try again tomorrow.',
    };
  }

  const userHourlyCap = getAiUserHourlyCap();
  if (userHourlyCount >= userHourlyCap) {
    return {
      allowed: false,
      error:
        lang === 'sw'
          ? 'Umetuma maombi mengi kwa saa moja. Tafadhali subiri kidogo kabla ya kuuliza tena.'
          : 'Hourly AI request limit reached. Please wait a little before asking again.',
    };
  }

  data.aiUsageLogs.push({
    id: `ai_${now}_${crypto.randomBytes(3).toString('hex')}`,
    userId: user.id,
    userRole: user.role,
    endpoint,
    language: lang,
    hasCoords,
    createdAt: now,
  });
  if (data.aiUsageLogs.length > 5000) {
    data.aiUsageLogs.splice(0, data.aiUsageLogs.length - 5000);
  }
  db.save();

  console.log(
    `[AI USAGE] user=${user.id} role=${user.role} endpoint=${endpoint} hour=${userHourlyCount + 1}/${userHourlyCap} day=${userDailyCount + 1}/${userDailyCap} globalDay=${globalDailyCount + 1}/${globalCap}`
  );
  return { allowed: true };
}

app.post('/api/ai/maps-grounding', requireAuth, async (req, res) => {
  const user = (req as any).user as User;
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'AI store finder is currently unavailable. GEMINI_API_KEY is not configured on the server.',
    });
  }

  const { query, lat, lng, language } = req.body || {};
  const validLang = validateAiLanguage(language);
  if (!validLang) {
    return res.status(400).json({ error: 'Invalid language. Must be "en" or "sw".' });
  }

  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return res.status(400).json({ error: 'A location query is required (minimum 2 characters).' });
  }

  if (query.trim().length > AI_MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      error: `Query exceeds maximum length of ${AI_MAX_MESSAGE_LENGTH} characters.`,
    });
  }

  const coordCheck = validateOptionalCoordinates(lat, lng);
  if (!coordCheck.valid) {
    return res.status(400).json({ error: coordCheck.error });
  }

  const quota = consumeAiQuota(
    user,
    '/api/ai/maps-grounding',
    validLang,
    coordCheck.lat !== undefined && coordCheck.lng !== undefined
  );
  if (!quota.allowed) {
    return res.status(429).json({ error: quota.error });
  }

  try {
    const config: any = {
      tools: [{ googleMaps: {} }],
      systemInstruction:
        validLang === 'sw'
          ? 'Wewe ni msaidizi wa Smart Cart wa kutafuta maduka makubwa karibu na mtumiaji. Jibu kwa Kiswahili ukitumia matokeo halisi ya Google Maps.'
          : "You are Smart Cart's live store locator assistant. Help shoppers find nearby supermarket branches, directions, and store details using real Google Maps data.",
    };

    if (coordCheck.lat !== undefined && coordCheck.lng !== undefined) {
      config.toolConfig = {
        retrievalConfig: {
          latLng: {
            latitude: coordCheck.lat,
            longitude: coordCheck.lng,
          },
        },
      };
    }

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: query.trim(),
      config,
    });

    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const places = rawChunks
      .filter((c: any) => c?.maps?.uri || c?.maps?.title)
      .map((c: any) => ({
        title: c.maps.title || 'View on Google Maps',
        uri: c.maps.uri || '',
        placeId: c.maps.placeId || '',
        reviewSnippets: (c.maps.placeAnswerSources?.reviewSnippets || [])
          .map((s: any) => s?.content || s?.text || '')
          .filter(Boolean),
      }));

    res.json({
      text: response.text || '',
      places,
    });
  } catch (err: any) {
    console.error(`[Smart Cart AI Maps Error] user=${user.id} status=${err?.status || 'unknown'}`);
    res.status(502).json({
      error:
        validLang === 'sw'
          ? 'Huduma ya kutafuta maduka haipatikani kwa sasa. Tafadhali jaribu tena baadaye.'
          : 'Unable to reach store finder service right now. Please try again shortly.',
    });
  }
});

app.post('/api/ai/chat', requireAuth, async (req, res) => {
  const user = (req as any).user as User;
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'AI assistant is currently unavailable. GEMINI_API_KEY is not configured on the server.',
    });
  }

  const {
    message,
    history = [],
    branchId,
    language,
    fastMode = false,
    useMapsGrounding = false,
    lat,
    lng,
  } = req.body || {};

  const validLang = validateAiLanguage(language);
  if (!validLang) {
    return res.status(400).json({ error: 'Invalid language. Must be "en" or "sw".' });
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }

  const trimmedMessage = message.trim();
  if (trimmedMessage.length > AI_MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      error: `Message exceeds maximum length of ${AI_MAX_MESSAGE_LENGTH} characters.`,
    });
  }

  if (history !== undefined && !Array.isArray(history)) {
    return res.status(400).json({ error: 'history must be an array.' });
  }

  if (Array.isArray(history) && history.length > AI_MAX_HISTORY_INPUT) {
    return res.status(400).json({
      error: `Conversation history exceeds allowed maximum (${AI_MAX_HISTORY_INPUT} items).`,
    });
  }

  if (Array.isArray(history)) {
    for (const item of history) {
      if (typeof item?.text === 'string' && item.text.length > AI_MAX_MESSAGE_LENGTH) {
        return res.status(400).json({
          error: `History message entry exceeds maximum length of ${AI_MAX_MESSAGE_LENGTH} characters.`,
        });
      }
    }
  }

  const coordCheck = validateOptionalCoordinates(lat, lng);
  if (!coordCheck.valid) {
    return res.status(400).json({ error: coordCheck.error });
  }

  const quota = consumeAiQuota(
    user,
    '/api/ai/chat',
    validLang,
    coordCheck.lat !== undefined && coordCheck.lng !== undefined
  );
  if (!quota.allowed) {
    return res.status(429).json({ error: quota.error });
  }

  const data = db.getRaw();

  const activeBranch = branchId ? data.branches.find((b) => b.id === branchId) : undefined;
  const activeSupermarket = activeBranch
    ? data.supermarkets.find((s) => s.id === activeBranch.supermarketId && s.status === 'active')
    : user.supermarketId
    ? data.supermarkets.find((s) => s.id === user.supermarketId)
    : undefined;

  let storeContext = '';
  if (activeBranch && activeSupermarket) {
    const branchProducts = data.products
      .filter((p) => p.supermarketId === activeSupermarket.id)
      .slice(0, 18)
      .map((p) => {
        const bp = data.branchProducts.find((b) => b.branchId === activeBranch.id && b.productId === p.id);
        const price = bp?.priceOverride ?? p.basePrice;
        const stock = bp?.stock ?? 50;
        const aisle = bp?.aisleOverride || p.aisle || '1';
        const shelf = bp?.shelfOverride || p.shelf || 'A';
        return `${p.name} (Barcode ${p.barcode}, KES ${price}, Aisle ${aisle} Shelf ${shelf}, Stock ${stock})`;
      });
    const activePromos = data.promotions
      .filter((pr) => pr.isActive && pr.supermarketId === activeSupermarket.id)
      .slice(0, 6)
      .map((pr) => pr.name);

    storeContext = `\nActive Branch Context: ${activeSupermarket.name} — ${activeBranch.name} (${activeBranch.address}, ${activeBranch.city}).\nSample Branch Catalogue: ${branchProducts.join('; ')}.\nActive Promotions: ${activePromos.join(', ') || 'None'}.`;
  }

  const roleNote = `Signed-in User Role: ${user.role} (${user.name}).`;

  const systemInstruction = [
    validLang === 'sw'
      ? 'Wewe ni Msaidizi wa Smart Cart. Jibu kwa Kiswahili au lugha aliyotumia mtumiaji, kwa ufupi na kwa uwazi.'
      : 'You are the Smart Cart Assistant — helpful, concise, and accurate.',
    'Smart Cart is a scan-as-you-shop supermarket platform with NO in-app payments; shoppers present their cart code to a cashier at the till.',
    roleNote,
    storeContext,
  ]
    .filter(Boolean)
    .join('\n');

  const formattedHistory: Content[] = Array.isArray(history)
    ? history
        .filter((m: any) => (m?.role === 'user' || m?.role === 'model') && typeof m?.text === 'string' && m.text.trim())
        .slice(-AI_MAX_HISTORY_TURNS)
        .map((m: any) => ({
          role: m.role === 'model' ? 'model' : 'user',
          parts: [{ text: m.text.trim().slice(0, AI_MAX_MESSAGE_LENGTH) }],
        }))
    : [];

  try {
    const model = useMapsGrounding
      ? 'gemini-4-hydrogen'
      : fastMode
      ? 'gemini-3.1-flash-lite'
      : 'gemini-4-hydrogen';

    const config: any = {
      systemInstruction,
    };

    if (useMapsGrounding) {
      config.tools = [{ googleMaps: {} }];
      if (coordCheck.lat !== undefined && coordCheck.lng !== undefined) {
        config.toolConfig = {
          retrievalConfig: {
            latLng: { latitude: coordCheck.lat, longitude: coordCheck.lng },
          },
        };
      }
    }

    const chat = ai.chats.create({
      model,
      history: formattedHistory,
      config,
    });

    const response = await chat.sendMessage({ message: trimmedMessage });

    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const places = rawChunks
      .filter((c: any) => c?.maps?.uri || c?.maps?.title)
      .map((c: any) => ({
        title: c.maps.title || 'Google Maps Place',
        uri: c.maps.uri || '',
        reviewSnippets: (c.maps.placeAnswerSources?.reviewSnippets || [])
          .map((s: any) => s?.content || s?.text || '')
          .filter(Boolean),
      }));

    res.json({
      reply: response.text || '',
      model,
      places,
    });
  } catch (err: any) {
    console.error(`[Smart Cart AI Chat Error] user=${user.id} status=${err?.status || 'unknown'}`);
    res.status(502).json({
      error:
        validLang === 'sw'
          ? 'Msaidizi wa AI hapatikani kwa sasa. Tafadhali jaribu tena baadaye.'
          : 'AI assistant service is temporarily unavailable. Please try again shortly.',
    });
  }
});

// ==========================================
// VITE DEV SERVER OR PRODUCTION SERVE
// ==========================================

function validateProductionStartup() {
  if (process.env.NODE_ENV !== 'production') return;

  const requiredVars = ['ADMIN_SETUP_KEY', 'DB_PATH', 'TRUST_PROXY'] as const;
  for (const name of requiredVars) {
    const val = process.env[name];
    if (!val || !val.trim()) {
      console.error(`[Startup Config] Missing required production environment variable: ${name}`);
    }
  }

  let fatal = false;
  const adminSetupKey = process.env.ADMIN_SETUP_KEY?.trim() || '';
  if (!adminSetupKey || adminSetupKey.length < 24) {
    console.error(
      '[Startup Config] Refusing to start in production: ADMIN_SETUP_KEY must be set and at least 24 characters long.'
    );
    fatal = true;
  }

  if (process.env.DEMO_MODE === 'true') {
    console.error(
      '[Startup Config] Refusing to start in production: DEMO_MODE must not be "true" in production.'
    );
    fatal = true;
  }

  if (fatal) {
    process.exit(1);
  }
}

function bootstrapEnvAdmin() {
  const envEmail = process.env.ADMIN_EMAIL?.trim();
  const envPassword = process.env.ADMIN_PASSWORD;
  if (!envEmail && !envPassword) return;

  if (!envEmail || !envPassword) {
    console.warn(
      '[Startup Config] Ignoring partial admin environment bootstrap: both ADMIN_EMAIL and ADMIN_PASSWORD must be set together.'
    );
    return;
  }

  const cleanEmail = envEmail.toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    console.error('[Startup Config] Invalid ADMIN_EMAIL format.');
    if (process.env.NODE_ENV === 'production') process.exit(1);
    return;
  }

  if (envPassword.length < 8) {
    console.error('[Startup Config] ADMIN_PASSWORD must be at least 8 characters long.');
    if (process.env.NODE_ENV === 'production') process.exit(1);
    return;
  }

  if (db.hasAdmin()) {
    // Strictly preserve single-admin invariant: never create a second admin account
    return;
  }

  const data = db.getRaw();
  if (data.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
    console.error('[Startup Config] Cannot bootstrap ADMIN_EMAIL because a non-admin account already uses that email.');
    return;
  }

  const adminId = `usr_sys_admin_${Date.now()}`;
  const newAdmin: User = {
    id: adminId,
    name: process.env.ADMIN_NAME?.trim() || 'System Administrator',
    email: cleanEmail,
    phone: '',
    role: 'admin',
    status: 'active',
    failedAttempts: 0,
    lockedUntil: null,
    mustChangePassword: false,
    isPermanentAdmin: true,
    createdAt: new Date().toISOString(),
  };

  const { hash, salt } = hashPassword(envPassword);
  data.users.push(newAdmin);
  data.passwords[adminId] = { hash, salt };

  logAudit(
    newAdmin,
    'SYSTEM_ADMIN_ENV_INITIALIZED',
    'user',
    adminId,
    `Single System Administrator account bootstrapped from environment configuration (${cleanEmail}).`
  );
  db.save();
  console.log(`[Startup Config] Single System Administrator account initialized for ${cleanEmail}.`);
}

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  validateProductionStartup();
  bootstrapEnvAdmin();

  // Explicitly serve /public assets (sw.js, offline.html, manifest.json, icons)
  app.use(
    express.static(path.resolve(process.cwd(), 'public'), {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('sw.js')) {
          res.setHeader('Service-Worker-Allowed', '/');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    })
  );

  if (isProd) {
    const distDir = path.resolve(process.cwd(), 'dist');
    const indexFile = path.resolve(distDir, 'index.html');
    app.use(express.static(distDir));
    app.get(
      ['/login', '/store/login', '/staff/login', '/admin/login', '/admin/dashboard', '/about', '/receipts', '*'],
      (req, res, next) => {
        if (req.path.startsWith('/api/')) {
          return next();
        }
        res.sendFile(indexFile);
      }
    );
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.PORT) || 3000;
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Smart Cart] Full-Stack Server running at http://0.0.0.0:${PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[Smart Cart] Received ${signal}, shutting down gracefully...`);
    server.closeIdleConnections?.();
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 8000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();
