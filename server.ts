import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import crypto from 'crypto';
import { db, hashPassword, verifyPassword } from './src/server/db';
import { validateBarcode } from './src/utils/barcode';
import { GoogleGenAI, Content } from '@google/genai';
import {
  User,
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
  ShoppingList,
  LoyaltyCard,
  StaffPermissions,
  STAFF_PRESETS,
} from './src/types';

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

  // Reject requests if user belongs to a supermarket that is suspended or pending approval
  if (user.supermarketId) {
    const supermarket = data.supermarkets.find((s) => s.id === user.supermarketId);
    if (supermarket && (supermarket.status === 'suspended' || supermarket.status === 'pending')) {
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

// Require authenticated user
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
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
  cart.updatedAt = new Date().toISOString();
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
app.post('/api/admin/change-first-password', requireAuth, requireRole(['admin']), (req, res) => {
  const user = (req as any).user as User;
  const { currentPassword, newPassword } = req.body;

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

  res.json({
    success: true,
    message: 'Password changed successfully. You now have full access to platform administration.',
  });
});

// Time-Limited Admin Password Recovery via Link
app.post('/api/admin/reset-password-with-token', (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Reset token and new password are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  const data = db.getRaw();
  const tokenKey = `admin_token_${token.trim()}`;
  const record = (data.resetCodes as any)[tokenKey];

  if (!record || record.used || record.expiresAt < Date.now()) {
    logAudit(
      null,
      'ADMIN_PASSWORD_RESET_FAILED',
      'user',
      'admin',
      'Attempted admin password recovery with invalid or expired time-limited token.'
    );
    return res.status(400).json({
      error: 'This password reset link is invalid or has expired. Time-limited recovery links expire after 15 minutes.',
    });
  }

  const admin = data.users.find((u) => u.role === 'admin' && u.email.toLowerCase() === record.email.toLowerCase());
  if (!admin) {
    return res.status(404).json({ error: 'System administrator account not found.' });
  }

  const { hash, salt } = hashPassword(newPassword);
  data.passwords[admin.id] = { hash, salt };
  admin.failedAttempts = 0;
  admin.lockedUntil = null;
  admin.mustChangePassword = false;

  // Mark token used and clean up
  record.used = true;
  delete (data.resetCodes as any)[tokenKey];

  // Revoke any active admin sessions on password reset
  revokeUserSessions(admin.id);

  logAudit(
    admin,
    'ADMIN_PASSWORD_RESET_COMPLETED',
    'user',
    admin.id,
    `Admin password successfully reset using time-limited email link (Token: ${token.substring(0, 8)}...).`
  );
  db.save();

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
    // Increment failed attempts for account lock limit (5 attempts = 15 minute lock)
    if (user) {
      user.failedAttempts = (user.failedAttempts || 0) + 1;
      if (user.failedAttempts >= 5) {
        user.lockedUntil = Date.now() + 15 * 60 * 1000;
      }
      db.save();
    } else {
      const rec = memoryFailedAttempts.get(cleanIdentifier) || { count: 0, lockedUntil: null };
      rec.count += 1;
      if (rec.count >= 5) {
        rec.lockedUntil = Date.now() + 15 * 60 * 1000;
      }
      memoryFailedAttempts.set(cleanIdentifier, rec);
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

  // Supermarket pending/suspended check for owner and staff
  if (user!.supermarketId) {
    const sm = data.supermarkets.find((s) => s.id === user!.supermarketId);
    if (sm) {
      if (sm.status === 'pending') {
        return res.status(403).json({ error: 'Your application is awaiting approval by the platform administrator.' });
      }
      if (sm.status === 'suspended') {
        return res.status(403).json({ error: 'This supermarket has been suspended.' });
      }
    }
  }

  // Reset failed attempts upon successful login
  user!.failedAttempts = 0;
  user!.lockedUntil = null;
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

// Message delivery helper: console log in non-configured environments
function sendResetMessage(target: string, type: 'email' | 'sms' | 'admin_link', content: string) {
  // If email/SMS provider is configured (e.g. SMTP/SendGrid/Twilio), deliver here.
  // When unconfigured, write safely to the server console only.
  console.log(`[RESET MESSAGE] [${type.toUpperCase()}] Delivered to ${target}: ${content}`);
}

// Client configuration endpoint
app.get('/api/auth/config', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  const adminSetupKeyRequired = isProd || Boolean(process.env.ADMIN_SETUP_KEY?.trim());
  res.json({ adminSetupKeyRequired });
});

// Password recovery endpoint
// STRICT SECURITY RULES:
// 1. Write code/link to server console only when no email provider is configured; NEVER return code, token, or link in HTTP response.
// 2. Uniform response message and identical response timing (anti-enumeration).
// 3. Admin recovery is strictly email-only with a time-limited link. Do not reveal admin status.
// 4. Crypto.randomInt codes, 15-min expiry, single-use, 5 failed attempts invalidation.
app.post('/api/auth/forgot-password', sensitiveOpsRateLimiter, async (req, res) => {
  const startTime = Date.now();
  const { identifier } = req.body;

  if (!identifier || typeof identifier !== 'string') {
    return res.status(400).json({ error: 'Identifier (email or phone) is required.' });
  }

  const clean = identifier.trim().toLowerCase();
  const cleanPhone = identifier.replace(/[\s\-()]/g, '');
  const data = db.getRaw();

  const user = data.users.find(
    (u) => u.email.toLowerCase() === clean || u.phone.replace(/[\s\-()]/g, '') === cleanPhone
  );

  if (user) {
    // Admin password recovery: strictly email-only time-limited link
    if (user.role === 'admin') {
      // If identifier was phone number, do NOT send link, and do NOT reveal that account is admin
      if (clean === user.email.toLowerCase()) {
        const resetToken = crypto.randomBytes(24).toString('hex');
        const tokenKey = `admin_token_${resetToken}`;
        data.resetCodes[tokenKey] = {
          email: user.email,
          token: resetToken,
          identifier: user.email,
          expiresAt: Date.now() + 15 * 60 * 1000,
          failedAttempts: 0,
          used: false,
        };
        db.save();

        const resetLink = `/admin/login?resetToken=${resetToken}`;
        sendResetMessage(user.email, 'admin_link', resetLink);
        logAudit(
          user,
          'ADMIN_PASSWORD_RESET_LINK_GENERATED',
          'user',
          user.id,
          'Time-limited password recovery link generated for admin email (expires in 15 minutes).'
        );
      }
    } else {
      // Standard user recovery (shopper, staff, owner) via 6-digit code using crypto.randomInt
      const code = crypto.randomInt(100000, 1000000).toString();
      const record = {
        code,
        identifier: clean,
        expiresAt: Date.now() + 15 * 60 * 1000,
        failedAttempts: 0,
        used: false,
      };
      data.resetCodes[clean] = record;
      if (cleanPhone) data.resetCodes[cleanPhone] = record;
      db.save();

      const deliveryTarget = user.email || user.phone;
      const deliveryType = user.email && clean === user.email.toLowerCase() ? 'email' : 'sms';
      sendResetMessage(deliveryTarget, deliveryType as any, code);
      logAudit(user, 'PASSWORD_RESET_REQUESTED', 'user', user.id, 'Password reset verification code generated.');
    }
  }

  // Enforce uniform response time (~200ms) regardless of whether user exists
  const minDuration = 200;
  const elapsed = Date.now() - startTime;
  if (elapsed < minDuration) {
    await new Promise((resolve) => setTimeout(resolve, minDuration - elapsed));
  }

  // Always return the exact same generic message without leaking code or link
  res.json({
    success: true,
    message: 'If an account exists, a recovery message has been sent.',
  });
});

// Reset password using verification code
// Enforces single-use, 15-minute expiry, invalidation after 5 wrong attempts, min 8-char password
app.post('/api/auth/reset-password', sensitiveOpsRateLimiter, (req, res) => {
  const { identifier, code, newPassword } = req.body;
  if (!identifier || !code || !newPassword) {
    return res.status(400).json({ error: 'Identifier, verification code, and new password are required.' });
  }

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  const clean = identifier.trim().toLowerCase();
  const cleanPhone = identifier.replace(/[\s\-()]/g, '');
  const data = db.getRaw();

  const resetRecord = data.resetCodes[clean] || (cleanPhone ? data.resetCodes[cleanPhone] : undefined);
  if (!resetRecord || resetRecord.used || resetRecord.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired verification code.' });
  }

  if (resetRecord.code !== code.trim()) {
    resetRecord.failedAttempts = (resetRecord.failedAttempts || 0) + 1;
    if (resetRecord.failedAttempts >= 5) {
      delete data.resetCodes[clean];
      if (cleanPhone) delete data.resetCodes[cleanPhone];
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
    (u) => u.email.toLowerCase() === clean || u.phone.replace(/[\s\-()]/g, '') === cleanPhone
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

  // Single-use: delete reset code
  resetRecord.used = true;
  delete data.resetCodes[clean];
  if (cleanPhone) delete data.resetCodes[cleanPhone];

  // Revoke all active sessions immediately
  revokeUserSessions(user.id);

  logAudit(user, 'PASSWORD_RESET_COMPLETED', 'user', user.id, 'Password successfully reset.');
  db.save();

  res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
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
  } = req.body;

  if (!chainName || !contactEmail || !contactPhone || !password) {
    return res.status(400).json({ error: 'Chain name, contact email, contact phone, and password are required.' });
  }

  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  const cleanEmail = contactEmail.trim().toLowerCase();
  const cleanPhone = contactPhone.replace(/[\s\-()]/g, '');
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

      const effectiveAisle = bp?.aisleOverride || p.aisle || 'Aisle 1';
      const effectiveShelf = bp?.shelfOverride || p.shelf || 'Shelf A';

      return {
        ...p,
        aisle: effectiveAisle,
        shelf: effectiveShelf,
        aisleShelf: `${effectiveAisle}, ${effectiveShelf}`,
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
  const valResult = validateBarcode(cleanBarcode);
  if (!valResult.isValid) {
    return res.status(400).json({
      error: valResult.error || 'Invalid barcode check digit or format',
      format: valResult.format,
    });
  }

  const data = db.getRaw();
  const caller = getAuthUser(req);
  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  const supermarket = data.supermarkets.find((s) => s.id === branch.supermarketId);
  if (!supermarket || (supermarket.status !== 'active' && caller?.role !== 'admin')) {
    return res.status(404).json({ error: 'Store branch is currently unavailable' });
  }

  const product = data.products.find(
    (p) => p.supermarketId === branch.supermarketId && p.barcode === cleanBarcode
  );

  if (!product) {
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

// ==========================================
// 4. LIVE CART OPERATIONS & OFFLINE SYNC
// ==========================================

app.get('/api/shopper/cart', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { branchId } = req.query;
  const data = db.getRaw();

  let cart = data.carts.find(
    (c) =>
      c.shopperId === callerId &&
      (c.status === 'active' || c.status === 'locked') &&
      (!branchId || c.branchId === branchId)
  );

  if (!cart && branchId) {
    const branch = data.branches.find((b) => b.id === branchId);
    if (branch) {
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
        budgetLimit: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      data.carts.push(cart);
      db.save();
    }
  }

  res.json(cart || null);
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
    return res.status(404).json({ error: `Product with barcode ${cleanBarcode} not found.` });
  }

  const bp = data.branchProducts.find((b) => b.branchId === branchId && b.productId === product.id);
  const currentBranchPrice = bp?.priceOverride ?? product.basePrice;

  let cart: Cart | undefined;
  if (cartId) {
    cart = data.carts.find((c) => c.id === cartId);
    if (cart && !canAccessCart(user, cart, callerId)) {
      return res.status(403).json({ error: 'Forbidden: You cannot modify another shopper\'s cart.' });
    }
  }

  if (!cart) {
    cart = data.carts.find(
      (c) =>
        c.shopperId === callerId &&
        c.branchId === branchId &&
        (c.status === 'active' || c.status === 'locked')
    );
  }

  if (!cart) {
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
      budgetLimit: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.carts.push(cart);
  }

  if (cart.status === 'locked') {
    cart.status = 'active';
  }

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
      aisle: bp?.aisleOverride || product.aisle || 'Aisle 1',
      shelf: bp?.shelfOverride || product.shelf || 'Shelf A',
      aisleShelf: `${bp?.aisleOverride || product.aisle || 'Aisle 1'}, ${bp?.shelfOverride || product.shelf || 'Shelf A'}`,
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
  db.save();

  res.json(cart);
});

// Update item quantity with ownership verification
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

// Set daily budget limit with ownership verification
app.post('/api/shopper/cart/budget', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { cartId, budgetLimit } = req.body;
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  // Ownership verification
  if (!canAccessCart(user, cart, callerId)) {
    return res.status(403).json({ error: 'Forbidden: You cannot modify another shopper\'s cart.' });
  }

  cart.budgetLimit = budgetLimit ? parseFloat(budgetLimit) : null;
  db.save();
  res.json(cart);
});

// Lock cart & get till shortcode with ownership verification
app.post('/api/shopper/cart/lock', (req, res) => {
  const user = getAuthUser(req);
  const callerId = getShopperOrGuestId(req, user);
  const { cartId } = req.body;
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

  cart.status = 'locked';
  if (!cart.shortCode) cart.shortCode = generateShortCode(cart.branchId);
  cart.updatedAt = new Date().toISOString();
  db.save();

  res.json(cart);
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

  if (!serverCart) {
    serverCart = data.carts.find(
      (c) =>
        c.shopperId === callerId &&
        c.branchId === branchId &&
        (c.status === 'active' || c.status === 'locked')
    );
  }

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
      status: payload.status || 'active',
      items: Array.isArray(payload.items) ? payload.items : [],
      subtotal: payload.subtotal || 0,
      totalDiscount: payload.totalDiscount || 0,
      finalTotal: payload.finalTotal || 0,
      budgetLimit: payload.budgetLimit ?? null,
      isOfflineCreated: true,
      syncedAt: new Date().toISOString(),
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.carts.push(serverCart);
  } else {
    // Preserve the locked price the shopper saw when scanning offline!
    if (Array.isArray(payload.items)) serverCart.items = payload.items;
    if (payload.budgetLimit !== undefined) serverCart.budgetLimit = payload.budgetLimit;
    if (payload.status) serverCart.status = payload.status;
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

  cart.items = [];
  recalculateCart(cart, cart.branchId, data.promotions);
  cart.status = 'active';
  db.save();
  return res.json(cart);
});

// ==========================================
// 5. SHOPPER PHASE 2: HISTORY & RE-ADD, FAVOURITES, LISTS
// ==========================================

// Shopper past cart history (authenticated)
app.get('/api/shopper/history', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const data = db.getRaw();
  const history = data.carts
    .filter((c) => c.shopperId === user.id && (c.status === 'completed' || c.status === 'verified'))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
  rawItem: { barcode?: string; productName: string; quantity?: number; aisle?: string; shelf?: string; estimatedPrice?: number },
  branchId: string | undefined,
  data: ReturnType<typeof db.getRaw>
) {
  const branch = branchId ? data.branches.find((b) => b.id === branchId) : undefined;
  let product: Product | undefined;
  if (rawItem.barcode) {
    product = branch
      ? data.products.find((p) => p.supermarketId === branch.supermarketId && p.barcode === rawItem.barcode)
      : data.products.find((p) => p.barcode === rawItem.barcode);
  }
  const bp = branch && product
    ? data.branchProducts.find((b) => b.branchId === branch.id && b.productId === product!.id)
    : undefined;

  return {
    id: `li_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    barcode: rawItem.barcode || product?.barcode,
    productName: product?.name || rawItem.productName,
    quantity: Math.max(1, Math.round(Number(rawItem.quantity) || 1)),
    completed: false,
    aisle: bp?.aisleOverride || product?.aisle || rawItem.aisle || 'Aisle 1',
    shelf: bp?.shelfOverride || product?.shelf || rawItem.shelf || 'Shelf A',
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
      budgetLimit: null,
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

  logAudit(
    user,
    'CART_FLAGGED',
    'cart',
    cart.id,
    `Cart ${cart.shortCode} flagged for mismatch: ${reason}`,
    cart.supermarketId,
    cart.branchId
  );
  db.save();

  res.json({ success: true, cart });
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

  if (cart.status === 'completed' || cart.status === 'verified' || cart.status === 'cancelled') {
    return res.status(400).json({ error: `Cart is already ${cart.status}` });
  }

  cart.status = 'verified';
  cart.verifiedByStaffId = user.id;
  cart.verifiedAt = new Date().toISOString();
  cart.updatedAt = new Date().toISOString();

  logAudit(
    user,
    'CART_VERIFIED',
    'cart',
    cart.id,
    `Cart ${cart.shortCode} verified by ${user.name}`,
    cart.supermarketId,
    cart.branchId
  );
  db.save();

  res.json({ success: true, cart });
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

  cart.status = 'completed';
  cart.updatedAt = new Date().toISOString();

  // Deduct branch stock
  cart.items.forEach((item) => {
    const bp = data.branchProducts.find((b) => b.branchId === cart.branchId && b.productId === item.productId);
    if (bp) {
      bp.stock = Math.max(0, bp.stock - item.quantity);
    }
  });

  logAudit(
    user,
    'CART_COMPLETED',
    'cart',
    cart.id,
    `Cart ${cart.shortCode} payment finalized at till`,
    cart.supermarketId,
    cart.branchId
  );
  db.save();

  res.json({ success: true, cart });
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
  const itemCounts: Record<string, { barcode: string; name: string; count: number; totalValue: number; aisle: string; shelf: string }> = {};

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
          totalValue: 0,
          aisle: item.aisle || 'Aisle 1',
          shelf: item.shelf || 'Shelf A',
        };
      }
      itemCounts[item.barcode].count += item.quantity;
      itemCounts[item.barcode].totalValue += item.effectiveTotal;
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
      revenue: rev,
      avgCartValue: brCarts.length > 0 ? Math.round(rev / brCarts.length) : 0,
      avgCartSize: brCarts.length > 0 ? Math.round((items / brCarts.length) * 10) / 10 : 0,
      totalItemsScanned: items,
    };
  });

  return {
    kpis: {
      totalCarts: carts.length,
      totalRevenue,
      totalItems,
      avgCartValue: carts.length > 0 ? Math.round(totalRevenue / carts.length) : 0,
      avgCartSize: carts.length > 0 ? Math.round((totalItems / carts.length) * 10) / 10 : 0,
    },
    hourCounts,
    dayCounts,
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
  const { reportType, branchId, startDate, endDate, supermarketId } = req.query as Record<string, string>;

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

  if (reportType === 'busiest_hours') {
    filename = 'busiest_hours_report.csv';
    csvContent = 'hour_of_day,carts_checked_out\n' + reports.hourCounts.map((count: number, hr: number) => `${hr}:00,${count}`).join('\n');
  } else if (reportType === 'busiest_days') {
    filename = 'busiest_days_report.csv';
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    csvContent = 'day_of_week,carts_checked_out\n' + reports.dayCounts.map((count: number, d: number) => `${days[d]},${count}`).join('\n');
  } else if (reportType === 'most_scanned') {
    filename = 'most_scanned_products.csv';
    csvContent = 'barcode,name,aisle,shelf,scans_count,total_revenue_kes\n' + reports.topProducts.map((p: any) => `${p.barcode},"${p.name.replace(/"/g, '""')}",${p.aisle},${p.shelf},${p.count},${p.totalValue}`).join('\n');
  } else {
    filename = 'branch_comparison_report.csv';
    csvContent = 'branch_id,branch_name,completed_carts,items_scanned,total_revenue_kes,avg_cart_value_kes,avg_cart_size\n' + reports.branchStats.map((b: any) => `${b.branchId},"${b.branchName.replace(/"/g, '""')}",${b.cartsCount},${b.totalItemsScanned},${b.revenue},${b.avgCartValue},${b.avgCartSize}`).join('\n');
  }

  res.setHeader('Content-Type', 'text/csv');
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

app.put('/api/admin/supermarkets/:id/status', requireAuth, requireRole(['admin']), (req, res) => {
  const user = (req as any).user as User;
  const { status } = req.body;
  if (!['active', 'suspended', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Allowed: active, suspended, pending.' });
  }
  const data = db.getRaw();
  const sm = data.supermarkets.find((s) => s.id === req.params.id);
  if (!sm) return res.status(404).json({ error: 'Supermarket not found' });

  sm.status = status;
  if (status === 'suspended' || status === 'pending') {
    revokeSupermarketSessions(sm.id);
  }
  logAudit(user, `SUPERMARKET_${status.toUpperCase()}`, 'supermarket', sm.id, `Supermarket ${sm.name} ${status} by admin`);
  db.save();
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

app.post('/api/admin/users/:id/reset-password', requireAuth, requireRole(['admin']), (req, res) => {
  const adminUser = (req as any).user as User;
  const { newPassword } = req.body;
  const data = db.getRaw();
  const targetUser = data.users.find((u) => u.id === req.params.id);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  // Admin password cannot be reset via user management
  if (targetUser.role === 'admin') {
    return res.status(403).json({
      error: 'The system administrator password cannot be reset via user management. Password recovery works only through the registered email address with a time-limited link.',
    });
  }

  let finalPassword = typeof newPassword === 'string' && newPassword.trim() ? newPassword.trim() : '';
  if (finalPassword && finalPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }
  if (!finalPassword) {
    finalPassword = `Sc!${crypto.randomBytes(4).toString('hex')}${crypto.randomInt(100, 1000)}`;
  }

  const { hash, salt } = hashPassword(finalPassword);
  data.passwords[targetUser.id] = { hash, salt };
  targetUser.failedAttempts = 0;
  targetUser.lockedUntil = null;

  revokeUserSessions(targetUser.id);

  logAudit(adminUser, 'USER_PASSWORD_RESET', 'staff', targetUser.id, `Admin reset password for ${targetUser.name}`);
  db.save();
  res.json({ success: true, message: `Password reset for ${targetUser.name}` });
});

// Update the single System Administrator's credentials (email, name, and/or password)
app.put('/api/admin/account', requireAuth, requireRole(['admin']), (req, res) => {
  const adminUser = (req as any).user as User;
  const { currentPassword, newEmail, newPassword, name } = req.body;

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
    const cleanEmail = newEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
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

// Support & Complaints Inbox
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
// 11. STORE LOYALTY QR SCANNING APIS
// ==========================================

function parseLoyaltyQrPayload(
  rawPayload: string,
  activeSupermarkets: Supermarket[],
  branchSupermarketId?: string
): { supermarket: Supermarket; cardNumber: string; memberName?: string; tier?: string; points?: number } | null {
  const raw = (rawPayload || '').trim();
  if (!raw || raw.length > 500) return null;

  let codeHint = '';
  let cardNumber = '';
  let memberName: string | undefined;
  let tier: string | undefined;
  let points: number | undefined;

  // Format 1: SMARTCART:LOYALTY:<CHAIN_CODE>:<CARD_NUMBER>[:<MEMBER_NAME>]
  if (raw.toUpperCase().startsWith('SMARTCART:LOYALTY:')) {
    const parts = raw.split(':');
    codeHint = (parts[2] || '').trim().toUpperCase();
    cardNumber = (parts[3] || '').trim();
    if (parts[4]) memberName = parts.slice(4).join(':').trim();
  } else if (raw.startsWith('{') && raw.endsWith('}')) {
    // Format 2: JSON payload { supermarketCode | chain, cardNumber | loyaltyId, memberName, tier, points }
    try {
      const parsed = JSON.parse(raw);
      codeHint = String(parsed.supermarketCode || parsed.chain || parsed.storeCode || '').trim().toUpperCase();
      cardNumber = String(parsed.cardNumber || parsed.loyaltyId || parsed.code || '').trim();
      if (parsed.memberName) memberName = String(parsed.memberName).trim();
      if (parsed.tier) tier = String(parsed.tier).trim();
      if (parsed.points !== undefined && !isNaN(Number(parsed.points))) points = Math.max(0, Math.round(Number(parsed.points)));
    } catch {
      return null;
    }
  } else if (/^https?:\/\//i.test(raw)) {
    // Format 3: URL query params ?chain=NAIVAS&card=NV-12345
    try {
      const url = new URL(raw);
      codeHint = (url.searchParams.get('chain') || url.searchParams.get('store') || '').trim().toUpperCase();
      cardNumber = (url.searchParams.get('card') || url.searchParams.get('loyaltyId') || url.searchParams.get('code') || '').trim();
      const mName = url.searchParams.get('name');
      if (mName) memberName = mName.trim();
    } catch {
      return null;
    }
  } else if (raw.includes(':')) {
    // Format 4: <CHAIN_CODE>:<CARD_NUMBER>
    const [prefix, ...rest] = raw.split(':');
    codeHint = prefix.trim().toUpperCase();
    cardNumber = rest.join(':').trim();
  } else {
    // Format 5: Direct card number matching chain prefix or active branch's chain
    cardNumber = raw;
    const matchedByPrefix = activeSupermarkets.find((s) =>
      raw.toUpperCase().startsWith(s.code.substring(0, 2).toUpperCase())
    );
    if (matchedByPrefix) {
      codeHint = matchedByPrefix.code.toUpperCase();
    }
  }

  if (!cardNumber || cardNumber.length < 3 || cardNumber.length > 64) {
    return null;
  }

  let supermarket = codeHint
    ? activeSupermarkets.find(
        (s) =>
          s.code.toUpperCase() === codeHint ||
          s.name.toUpperCase().includes(codeHint) ||
          s.id.toUpperCase() === codeHint
      )
    : undefined;

  if (!supermarket && branchSupermarketId) {
    supermarket = activeSupermarkets.find((s) => s.id === branchSupermarketId);
  }

  if (!supermarket) return null;

  return { supermarket, cardNumber, memberName, tier, points };
}

app.get('/api/shopper/loyalty', (req, res) => {
  const user = getAuthUser(req);
  const ownerKey = getShopperOrGuestId(req, user);
  const data = db.getRaw();
  if (!data.loyaltyCards) data.loyaltyCards = [];

  const cards = data.loyaltyCards.filter((c) => c.ownerKey === ownerKey || (user && c.userId === user.id));
  res.json(cards);
});

app.post('/api/shopper/loyalty/scan', (req, res) => {
  const user = getAuthUser(req);
  const ownerKey = getShopperOrGuestId(req, user);
  const { qrPayload, branchId } = req.body;

  if (!qrPayload || typeof qrPayload !== 'string') {
    return res.status(400).json({ error: 'qrPayload is required.' });
  }

  const data = db.getRaw();
  if (!data.loyaltyCards) data.loyaltyCards = [];

  const activeSupermarkets = data.supermarkets.filter((s) => s.status === 'active');
  const activeBranch = branchId ? data.branches.find((b) => b.id === branchId) : undefined;

  const parsed = parseLoyaltyQrPayload(qrPayload, activeSupermarkets, activeBranch?.supermarketId);
  if (!parsed) {
    return res.status(400).json({
      error:
        'Unrecognized store loyalty QR code. Expected store code (e.g. SMARTCART:LOYALTY:STORE:CARD-001) or active branch loyalty card number.',
    });
  }

  const existing = data.loyaltyCards.find(
    (c) =>
      (c.ownerKey === ownerKey || (user && c.userId === user.id)) &&
      c.supermarketId === parsed.supermarket.id
  );

  const stableSeed = crypto.createHash('sha256').update(parsed.cardNumber).digest();
  const derivedPoints = parsed.points ?? 120 + (stableSeed.readUInt16BE(0) % 1800);
  const derivedTier = parsed.tier || (derivedPoints >= 1000 ? 'Gold Member' : derivedPoints >= 500 ? 'Silver Member' : 'Member');

  if (existing) {
    existing.cardNumber = parsed.cardNumber;
    existing.memberName = parsed.memberName || user?.name || existing.memberName;
    existing.tier = derivedTier;
    existing.points = derivedPoints;
    existing.rawPayload = qrPayload.trim();
    existing.linkedAt = new Date().toISOString();
    db.save();
    return res.json({ success: true, updated: true, card: existing });
  }

  const newCard: LoyaltyCard = {
    id: `loy_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    ownerKey,
    userId: user?.id || null,
    supermarketId: parsed.supermarket.id,
    supermarketName: parsed.supermarket.name,
    supermarketCode: parsed.supermarket.code,
    cardNumber: parsed.cardNumber,
    memberName: parsed.memberName || user?.name || 'Smart Cart Member',
    tier: derivedTier,
    points: derivedPoints,
    rawPayload: qrPayload.trim(),
    linkedAt: new Date().toISOString(),
  };

  data.loyaltyCards.unshift(newCard);
  db.save();

  res.status(201).json({ success: true, updated: false, card: newCard });
});

app.delete('/api/shopper/loyalty/:id', (req, res) => {
  const user = getAuthUser(req);
  const ownerKey = getShopperOrGuestId(req, user);
  const data = db.getRaw();
  if (!data.loyaltyCards) data.loyaltyCards = [];

  const idx = data.loyaltyCards.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Loyalty card not found.' });

  const card = data.loyaltyCards[idx];
  const isOwner = card.ownerKey === ownerKey || (user && card.userId === user.id);
  if (!isOwner && user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: You cannot remove another shopper\'s loyalty card.' });
  }

  data.loyaltyCards.splice(idx, 1);
  db.save();
  res.json({ success: true });
});

// ==========================================
// 12. GEMINI AI ASSISTANT & GOOGLE MAPS GROUNDING
// ==========================================

app.post('/api/ai/maps-grounding', async (req, res) => {
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'Gemini AI service is not configured. Please check GEMINI_API_KEY in Settings > Secrets.',
    });
  }

  const { query, lat, lng, language = 'en' } = req.body;
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return res.status(400).json({ error: 'A location query is required.' });
  }

  try {
    const config: any = {
      tools: [{ googleMaps: {} }],
      systemInstruction:
        language === 'sw'
          ? 'Wewe ni msaidizi wa Smart Cart wa kutafuta maduka makubwa karibu na mtumiaji. Jibu kwa Kiswahili ukitumia matokeo halisi ya Google Maps.'
          : 'You are Smart Cart\'s live store locator assistant. Help shoppers find nearby supermarket branches, directions, and store details using real Google Maps data.',
    };

    const numLat = Number(lat);
    const numLng = Number(lng);
    if (!isNaN(numLat) && !isNaN(numLng) && isFinite(numLat) && isFinite(numLng)) {
      config.toolConfig = {
        retrievalConfig: {
          latLng: {
            latitude: numLat,
            longitude: numLng,
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
    console.error('[Smart Cart AI Maps Grounding Error]', err?.message || err);
    res.status(err?.status || 500).json({
      error: err?.message || 'Failed to query Google Maps grounding.',
    });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  const ai = getGeminiClient();
  if (!ai) {
    return res.status(503).json({
      error: 'Gemini AI service is not configured. Please check GEMINI_API_KEY in Settings > Secrets.',
    });
  }

  const {
    message,
    history = [],
    branchId,
    language = 'en',
    fastMode = false,
    useMapsGrounding = false,
    lat,
    lng,
  } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }

  const user = getAuthUser(req);
  const data = db.getRaw();

  const activeBranch = branchId ? data.branches.find((b) => b.id === branchId) : undefined;
  const activeSupermarket = activeBranch
    ? data.supermarkets.find((s) => s.id === activeBranch.supermarketId && s.status === 'active')
    : user?.supermarketId
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

  const roleNote = user
    ? `Signed-in User Role: ${user.role} (${user.name}).`
    : 'User is an unauthenticated Guest Shopper.';

  const systemInstruction = [
    language === 'sw'
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
        .slice(-20)
        .map((m: any) => ({
          role: m.role === 'model' ? 'model' : 'user',
          parts: [{ text: m.text.trim() }],
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
      const numLat = Number(lat);
      const numLng = Number(lng);
      if (!isNaN(numLat) && !isNaN(numLng) && isFinite(numLat) && isFinite(numLng)) {
        config.toolConfig = {
          retrievalConfig: {
            latLng: { latitude: numLat, longitude: numLng },
          },
        };
      }
    }

    const chat = ai.chats.create({
      model,
      history: formattedHistory,
      config,
    });

    const response = await chat.sendMessage({ message: message.trim() });

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
    console.error('[Smart Cart AI Chat Error]', err?.message || err);
    res.status(err?.status || 500).json({
      error: err?.message || 'Failed to generate AI response.',
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
      ['/login', '/store/login', '/staff/login', '/admin/login', '/admin/dashboard', '*'],
      (req, res, next) => {
        if (req.path.startsWith('/api/')) {
          return next();
        }
        res.sendFile(indexFile);
      }
    );
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Smart Cart] Full-Stack Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
