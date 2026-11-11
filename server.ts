import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import crypto from 'crypto';
import { db, hashPassword, verifyPassword } from './src/server/db';
import { validateBarcode } from './src/utils/barcode';
import {
  User,
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
  StaffPermissions,
  STAFF_PRESETS,
} from './src/types';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Simple Bearer token session cache: token -> userId
const sessions = new Map<string, string>();

// Helper to authenticate user from Authorization header
function getAuthUser(req: Request): User | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  const userId = sessions.get(token);
  if (!userId) return null;
  const data = db.getRaw();
  const user = data.users.find((u) => u.id === userId);
  if (!user || user.status === 'suspended') return null;
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

// Role authorization middleware
function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as User;
    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient role privileges.' });
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

function generateShortCode(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `SC-${digits}`;
}

// ==========================================
// 1. AUTHENTICATION, SETUP & SECURITY ENDPOINTS
// ==========================================

// Check if System Admin first-time setup has been completed
app.get('/api/admin/setup-status', (req, res) => {
  const admin = db.getAdmin();
  res.json({
    isSetupComplete: Boolean(admin),
    adminEmail: admin ? admin.email : null,
    hasAdmin: Boolean(admin),
  });
});

// First-time System Admin setup endpoint
// Exactly ONE admin account can ever exist. Created once using the provided email.
app.post('/api/admin/setup', (req, res) => {
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

  const { email, name, phone } = req.body;
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

  // Generate a cryptographically strong, high-entropy temporary password
  // (e.g. Sc!7b4F92 + 3 random digits)
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  const rawTempPassword = `Sc!${randomPart}${randomSuffix}`;

  const adminId = `usr_sys_admin_${Date.now()}`;
  const now = new Date().toISOString();

  const newAdmin: User = {
    id: adminId,
    name: name?.trim() || 'System Administrator',
    email: cleanEmail,
    phone: phone ? phone.trim() : '+254700000000',
    role: 'admin',
    status: 'active',
    failedAttempts: 0,
    lockedUntil: null,
    mustChangePassword: true,
    isPermanentAdmin: true,
    createdAt: now,
  };

  const { hash, salt } = hashPassword(rawTempPassword);
  data.users.push(newAdmin);
  data.passwords[adminId] = { hash, salt };

  logAudit(
    newAdmin,
    'SYSTEM_ADMIN_INITIALIZED',
    'user',
    adminId,
    `System Administrator account created with email ${cleanEmail}. Exactly ONE admin account permitted. Temporary password generated.`
  );
  db.save();

  // Return the temporary password ONCE to the setup view
  res.json({
    success: true,
    message: 'System Administrator account created successfully.',
    adminEmail: cleanEmail,
    tempPassword: rawTempPassword,
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

// Login with either email or phone in the same field
app.post('/api/auth/login', async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Identifier (email or phone) and password are required' });
  }

  const cleanIdentifier = identifier.trim().toLowerCase();
  const cleanPhone = identifier.replace(/[\s\-()]/g, '');
  const data = db.getRaw();

  const user = data.users.find(
    (u) =>
      u.email.toLowerCase() === cleanIdentifier ||
      u.phone.replace(/[\s\-()]/g, '') === cleanPhone
  );

  if (!user) {
    return res.status(401).json({ error: 'Invalid email/phone or password' });
  }

  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'This account has been suspended by an administrator.' });
  }

  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    const remainingMinutes = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({
      error: `Account is temporarily locked due to repeated failed attempts. Please try again in ${remainingMinutes} minute(s) or reset your password.`,
      lockedUntil: user.lockedUntil,
    });
  }

  if (user.failedAttempts > 0) {
    const delay = Math.min(1000, user.failedAttempts * 200);
    await new Promise((r) => setTimeout(r, delay));
  }

  const userPwd = data.passwords[user.id];
  const isValid = userPwd && verifyPassword(password, userPwd.hash, userPwd.salt);

  if (!isValid) {
    user.failedAttempts = (user.failedAttempts || 0) + 1;
    let message = 'Invalid email/phone or password.';
    if (user.failedAttempts >= 5) {
      user.lockedUntil = Date.now() + 15 * 60 * 1000;
      message = 'Account temporarily locked for 15 minutes due to 5 failed login attempts.';
    } else {
      const remaining = 5 - user.failedAttempts;
      message += ` (${remaining} attempt${remaining === 1 ? '' : 's'} remaining before temporary lock)`;
    }
    db.save();
    return res.status(401).json({ error: message, remainingAttempts: Math.max(0, 5 - user.failedAttempts) });
  }

  user.failedAttempts = 0;
  user.lockedUntil = null;
  db.save();

  const token = `tok_${crypto.randomBytes(24).toString('hex')}`;
  sessions.set(token, user.id);

  let supermarket = null;
  let branch = null;
  if (user.supermarketId) {
    supermarket = data.supermarkets.find((s) => s.id === user.supermarketId) || null;
  }
  if (user.branchId) {
    branch = data.branches.find((b) => b.id === user.branchId) || null;
  }

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      supermarketId: user.supermarketId,
      branchId: user.branchId,
      permissions: user.permissions,
      status: user.status,
      mustChangePassword: user.mustChangePassword ?? false,
      isPermanentAdmin: user.isPermanentAdmin ?? false,
    },
    supermarket,
    branch,
  });
});

// Self-register for shoppers ONLY
// Strictly blocks any attempt to create an admin account and logs it
app.post('/api/auth/register', (req, res) => {
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
  sessions.set(token, newUser.id);

  res.json({
    token,
    user: newUser,
  });
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

// Password recovery endpoint
// STRICT RULE: Admin password recovery works ONLY through the registered email address with a time-limited link.
// Every recovery attempt is logged in the audit log.
app.post('/api/auth/forgot-password', (req, res) => {
  const { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: 'Identifier is required' });

  const clean = identifier.trim().toLowerCase();
  const cleanPhone = identifier.replace(/[\s\-()]/g, '');
  const data = db.getRaw();

  const user = data.users.find(
    (u) => u.email.toLowerCase() === clean || u.phone.replace(/[\s\-()]/g, '') === cleanPhone
  );

  if (!user) {
    return res.json({ success: true, message: 'If an account exists, a recovery code or link has been dispatched.' });
  }

  // Admin password recovery: EMAIL ONLY with time-limited link
  if (user.role === 'admin') {
    // If identifier was phone number, refuse phone reset for admin
    if (clean !== user.email.toLowerCase()) {
      logAudit(
        user,
        'ADMIN_PHONE_RESET_ATTEMPT_BLOCKED',
        'user',
        user.id,
        'Blocked phone number reset attempt for system admin account. Email recovery required.'
      );
      return res.status(403).json({
        error: 'System administrator password recovery is only allowed through the registered email address. Phone/SMS recovery is disabled for admin security.',
      });
    }

    // Generate high-entropy 48-char time-limited link token (15 mins)
    const resetToken = crypto.randomBytes(24).toString('hex');
    const tokenKey = `admin_token_${resetToken}`;
    (data.resetCodes as any)[tokenKey] = {
      email: user.email,
      token: resetToken,
      expiresAt: Date.now() + 15 * 60 * 1000,
      used: false,
    };
    db.save();

    logAudit(
      user,
      'ADMIN_PASSWORD_RESET_LINK_GENERATED',
      'user',
      user.id,
      `Time-limited password recovery link generated for admin email ${user.email} (expires in 15 minutes).`
    );

    return res.json({
      success: true,
      isAdminReset: true,
      message: 'A secure, time-limited password recovery link has been generated for your administrator email address.',
      resetLink: `/admin/login?resetToken=${resetToken}`,
      expiresMinutes: 15,
      demoCode: resetToken,
    });
  }

  // Standard recovery for shoppers and staff via 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  data.resetCodes[clean] = { code, expiresAt: Date.now() + 15 * 60 * 1000 };
  data.resetCodes[cleanPhone] = { code, expiresAt: Date.now() + 15 * 60 * 1000 };
  db.save();

  logAudit(user, 'PASSWORD_RESET_REQUESTED', 'staff', user.id, `Password reset code generated`);

  res.json({
    success: true,
    message: 'Verification code sent.',
    demoCode: code,
  });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { identifier, code, newPassword } = req.body;
  if (!identifier || !code || !newPassword) {
    return res.status(400).json({ error: 'Identifier, code, and new password are required' });
  }

  const clean = identifier.trim().toLowerCase();
  const cleanPhone = identifier.replace(/[\s\-()]/g, '');
  const data = db.getRaw();

  const resetRecord = data.resetCodes[clean] || data.resetCodes[cleanPhone];
  if (!resetRecord || resetRecord.code !== code.trim() || resetRecord.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired verification code' });
  }

  const user = data.users.find(
    (u) => u.email.toLowerCase() === clean || u.phone.replace(/[\s\-()]/g, '') === cleanPhone
  );

  if (!user) return res.status(404).json({ error: 'User not found' });

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
  delete data.resetCodes[clean];
  delete data.resetCodes[cleanPhone];

  logAudit(user, 'PASSWORD_RESET_COMPLETED', 'staff', user.id, `Password successfully reset`);
  db.save();

  res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
});

// ==========================================
// 2. SUPERMARKET & BRANCH APIS
// ==========================================

app.get('/api/supermarkets', (req, res) => {
  const user = getAuthUser(req);
  const data = db.getRaw();
  const list = user?.role === 'admin' ? data.supermarkets : data.supermarkets.filter((s) => s.status === 'active');
  res.json(list);
});

app.get('/api/branches', (req, res) => {
  const { supermarketId, lat, lng } = req.query;
  const data = db.getRaw();

  let branches = data.branches.filter((b) => b.isActive);
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
  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

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
  const { branchId } = req.query;
  const data = db.getRaw();

  let cart = data.carts.find(
    (c) =>
      c.shopperId === (user?.id || 'guest') &&
      (c.status === 'active' || c.status === 'locked') &&
      (!branchId || c.branchId === branchId)
  );

  if (!cart && branchId) {
    const branch = data.branches.find((b) => b.id === branchId);
    if (branch) {
      cart = {
        id: `cart_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        shortCode: generateShortCode(),
        shopperId: user?.id || 'guest',
        shopperName: user?.name || 'Shopper',
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
  const { branchId, barcode, quantity = 1 } = req.body;
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

  let cart = data.carts.find(
    (c) =>
      c.shopperId === (user?.id || 'guest') &&
      c.branchId === branchId &&
      (c.status === 'active' || c.status === 'locked')
  );

  if (!cart) {
    cart = {
      id: `cart_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      shortCode: generateShortCode(),
      shopperId: user?.id || 'guest',
      shopperName: user?.name || 'Shopper',
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
      id: `ci_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
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

// Update item quantity
app.put('/api/shopper/cart/quantity', (req, res) => {
  const { cartId, itemId, quantity } = req.body;
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

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

// Set daily budget limit
app.post('/api/shopper/cart/budget', (req, res) => {
  const { cartId, budgetLimit } = req.body;
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  cart.budgetLimit = budgetLimit ? parseFloat(budgetLimit) : null;
  db.save();
  res.json(cart);
});

// Lock cart & get till shortcode
app.post('/api/shopper/cart/lock', (req, res) => {
  const { cartId } = req.body;
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  if (cart.items.length === 0) {
    return res.status(400).json({ error: 'Cannot checkout an empty cart.' });
  }

  cart.status = 'locked';
  if (!cart.shortCode) cart.shortCode = generateShortCode();
  cart.updatedAt = new Date().toISOString();
  db.save();

  res.json(cart);
});

// Offline Sync Endpoint: seamlessly merges an offline created/scanned cart
app.post('/api/shopper/cart/sync', (req, res) => {
  const user = getAuthUser(req);
  const { offlineCart } = req.body;
  if (!offlineCart || !offlineCart.branchId) {
    return res.status(400).json({ error: 'Invalid offline cart data' });
  }

  const data = db.getRaw();
  const branch = data.branches.find((b) => b.id === offlineCart.branchId);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  let serverCart = data.carts.find(
    (c) =>
      c.shortCode === offlineCart.shortCode ||
      (c.shopperId === (user?.id || 'guest') && c.branchId === offlineCart.branchId && (c.status === 'active' || c.status === 'locked'))
  );

  if (!serverCart) {
    serverCart = {
      id: offlineCart.id || `cart_${Date.now()}`,
      shortCode: offlineCart.shortCode || generateShortCode(),
      shopperId: user?.id || 'guest',
      shopperName: user?.name || offlineCart.shopperName || 'Shopper',
      shopperPhone: user?.phone || offlineCart.shopperPhone || '',
      supermarketId: branch.supermarketId,
      branchId: branch.id,
      status: offlineCart.status || 'locked',
      items: offlineCart.items || [],
      subtotal: offlineCart.subtotal || 0,
      totalDiscount: offlineCart.totalDiscount || 0,
      finalTotal: offlineCart.finalTotal || 0,
      budgetLimit: offlineCart.budgetLimit || null,
      isOfflineCreated: true,
      syncedAt: new Date().toISOString(),
      createdAt: offlineCart.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.carts.push(serverCart);
  } else {
    // Preserve the locked price the shopper saw when scanning offline!
    serverCart.items = offlineCart.items;
    serverCart.status = offlineCart.status || serverCart.status;
    serverCart.isOfflineCreated = true;
    serverCart.syncedAt = new Date().toISOString();
  }

  recalculateCart(serverCart, serverCart.branchId, data.promotions);
  db.save();

  res.json({ success: true, cart: serverCart });
});

app.delete('/api/shopper/cart/:id', (req, res) => {
  const data = db.getRaw();
  const cartIndex = data.carts.findIndex((c) => c.id === req.params.id);
  if (cartIndex !== -1) {
    data.carts[cartIndex].items = [];
    recalculateCart(data.carts[cartIndex], data.carts[cartIndex].branchId, data.promotions);
    data.carts[cartIndex].status = 'active';
    db.save();
    return res.json(data.carts[cartIndex]);
  }
  res.status(404).json({ error: 'Cart not found' });
});

// ==========================================
// 5. SHOPPER PHASE 2: HISTORY & RE-ADD, FAVOURITES, LISTS
// ==========================================

// Shopper past cart history
app.get('/api/shopper/history', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const data = db.getRaw();
  const history = data.carts
    .filter((c) => c.shopperId === user.id && (c.status === 'completed' || c.status === 'verified'))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(history);
});

// Re-add items from a past cart into active cart
app.post('/api/shopper/cart/re-add', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const { pastCartId, targetBranchId } = req.body;
  const data = db.getRaw();

  const pastCart = data.carts.find((c) => c.id === pastCartId && c.shopperId === user.id);
  if (!pastCart) return res.status(404).json({ error: 'Past cart not found' });

  const branchId = targetBranchId || pastCart.branchId;
  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  let activeCart = data.carts.find(
    (c) => c.shopperId === user.id && c.branchId === branchId && c.status === 'active'
  );

  if (!activeCart) {
    activeCart = {
      id: `cart_${Date.now()}`,
      shortCode: generateShortCode(),
      shopperId: user.id,
      shopperName: user.name,
      shopperPhone: user.phone,
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
    const prod = data.products.find((p) => p.barcode === item.barcode);
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

// Shareable Shopping Lists
app.get('/api/shopper/shopping-lists', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const data = db.getRaw();
  const lists = (data.shoppingLists || []).filter((l) => l.userId === user.id);
  res.json(lists);
});

app.post('/api/shopper/shopping-lists', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const { title, canEdit = true, items = [] } = req.body;
  const data = db.getRaw();

  const shareCode = `LIST-${Math.floor(1000 + Math.random() * 9000)}`;
  const newList: ShoppingList = {
    id: `list_${Date.now()}`,
    userId: user.id,
    title: title || 'My Shopping List',
    shareCode,
    canEdit: Boolean(canEdit),
    items: items.map((it: any) => ({
      id: it.id || `li_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      barcode: it.barcode,
      productName: it.productName,
      quantity: it.quantity || 1,
      completed: false,
      aisle: it.aisle || 'Aisle 1',
      shelf: it.shelf || 'Shelf A',
      estimatedPrice: it.estimatedPrice || 0,
    })),
    createdAt: new Date().toISOString(),
  };

  if (!data.shoppingLists) data.shoppingLists = [];
  data.shoppingLists.push(newList);
  db.save();

  res.json(newList);
});

app.put('/api/shopper/shopping-lists/:id', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const { title, items, canEdit } = req.body;
  const data = db.getRaw();
  const list = data.shoppingLists.find((l) => l.id === req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found' });

  // Only owner or authorized editors can update
  if (list.userId !== user.id && !list.canEdit) {
    return res.status(403).json({ error: 'You do not have permission to edit this list.' });
  }

  if (title !== undefined) list.title = title;
  if (items !== undefined) list.items = items;
  if (canEdit !== undefined && list.userId === user.id) list.canEdit = canEdit;
  list.updatedAt = new Date().toISOString();
  db.save();

  res.json(list);
});

app.get('/api/shopper/shopping-lists/share/:shareCode', (req, res) => {
  const data = db.getRaw();
  const list = (data.shoppingLists || []).find((l) => l.shareCode.toUpperCase() === req.params.shareCode.toUpperCase());
  if (!list) return res.status(404).json({ error: 'Shopping list not found with this code' });
  res.json(list);
});

// Convert Shopping List into Active Cart
app.post('/api/shopper/shopping-lists/convert-to-cart', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const { listId, branchId } = req.body;
  if (!listId || !branchId) return res.status(400).json({ error: 'listId and branchId are required' });

  const data = db.getRaw();
  const list = (data.shoppingLists || []).find((l) => l.id === listId);
  if (!list) return res.status(404).json({ error: 'List not found' });

  const branch = data.branches.find((b) => b.id === branchId);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });

  let activeCart = data.carts.find(
    (c) => c.shopperId === user.id && c.branchId === branchId && (c.status === 'active' || c.status === 'locked')
  );

  if (!activeCart) {
    activeCart = {
      id: `cart_${Date.now()}`,
      shortCode: generateShortCode(),
      shopperId: user.id,
      shopperName: user.name,
      shopperPhone: user.phone,
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
  const rawCode = req.params.shortCode.trim().toUpperCase();
  const data = db.getRaw();

  // Verify staff permission
  if (user.role === 'staff' && !user.permissions?.verifyCarts) {
    return res.status(403).json({ error: 'Permission denied: Staff cannot verify carts.' });
  }

  const cart = data.carts.find(
    (c) => c.shortCode.toUpperCase() === rawCode || c.id === rawCode
  );

  if (!cart) {
    return res.status(404).json({ error: `No active cart found with code "${rawCode}".` });
  }

  if (user.role === 'staff' && user.branchId && cart.branchId !== user.branchId) {
    return res.status(403).json({ error: 'This cart belongs to a different branch.' });
  }
  if (user.role === 'owner' && user.supermarketId && cart.supermarketId !== user.supermarketId) {
    return res.status(403).json({ error: 'This cart belongs to a different supermarket chain.' });
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
  if (user.role === 'staff' && !user.permissions?.verifyCarts) {
    return res.status(403).json({ error: 'Permission denied: Staff cannot verify carts.' });
  }

  const { cartId, itemId, checked } = req.body;
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

  const item = cart.items.find((i) => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Item not in cart' });

  item.verifiedByCashier = checked;
  db.save();
  res.json({ success: true, cart });
});

app.post('/api/cashier/flag', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'staff' && !user.permissions?.verifyCarts) {
    return res.status(403).json({ error: 'Permission denied: Staff cannot flag carts.' });
  }

  const { cartId, reason } = req.body;
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

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
  if (user.role === 'staff' && !user.permissions?.verifyCarts) {
    return res.status(403).json({ error: 'Permission denied: Staff cannot verify carts.' });
  }

  const { cartId } = req.body;
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

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
  if (user.role === 'staff' && !user.permissions?.verifyCarts) {
    return res.status(403).json({ error: 'Permission denied: Staff cannot complete checkouts.' });
  }

  const { cartId } = req.body;
  const data = db.getRaw();
  const cart = data.carts.find((c) => c.id === cartId);
  if (!cart) return res.status(404).json({ error: 'Cart not found' });

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
  const targetSmId = user.role === 'admin' ? supermarketId : user.supermarketId;

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
  const targetSmId = user.role === 'admin' ? req.body.supermarketId : user.supermarketId;

  if (!name || !email || !phone || !password || !branchId) {
    return res.status(400).json({ error: 'Name, email, phone, password, and branchId are required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanPhone = phone.replace(/[\s\-()]/g, '');
  const data = db.getRaw();

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

  if (branchId) staff.branchId = branchId;
  if (status) staff.status = status;

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

  db.save();
  res.json(staff);
});

// Adjust Branch Product: Enforces backend permissions
app.post('/api/owner/branch-product-override', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const { branchId, productId, priceOverride, stock, lowStockThresholdOverride, aisleOverride, shelfOverride } = req.body;
  const data = db.getRaw();

  // Strict backend security rule enforcement
  if (user.role === 'staff') {
    if (user.branchId !== branchId) {
      return res.status(403).json({ error: 'Security violation: Staff cannot access another branch.' });
    }
    if (priceOverride !== undefined && !user.permissions?.editPrices) {
      return res.status(403).json({ error: 'Security violation: Staff account lacks "editPrices" permission.' });
    }
    if (stock !== undefined && !user.permissions?.editStock) {
      return res.status(403).json({ error: 'Security violation: Staff account lacks "editStock" permission.' });
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
    bp.priceOverride = priceOverride === null || priceOverride === '' ? null : parseFloat(priceOverride);
  }
  if (stock !== undefined) {
    bp.stock = parseInt(stock, 10);
  }
  if (lowStockThresholdOverride !== undefined) {
    bp.lowStockThresholdOverride =
      lowStockThresholdOverride === null || lowStockThresholdOverride === '' ? null : parseInt(lowStockThresholdOverride, 10);
  }
  if (aisleOverride !== undefined) {
    bp.aisleOverride = aisleOverride || null;
  }
  if (shelfOverride !== undefined) {
    bp.shelfOverride = shelfOverride || null;
  }

  const product = data.products.find((p) => p.id === productId);
  logAudit(
    user,
    'BRANCH_PRODUCT_UPDATED',
    'price',
    productId,
    `Updated branch stock/price/location for "${product?.name}": Price: ${bp.priceOverride ?? 'default'}, Stock: ${bp.stock}, Aisle: ${bp.aisleOverride || product?.aisle}, Shelf: ${bp.shelfOverride || product?.shelf}`,
    product?.supermarketId,
    branchId
  );
  db.save();

  res.json({ success: true, branchProduct: bp });
});

// CSV Export Catalogue with distinct Aisle and Shelf columns
app.get('/api/owner/products/csv-export', requireAuth, requireRole(['owner', 'admin']), (req, res) => {
  const user = (req as any).user as User;
  const supermarketId = user.role === 'admin' ? (req.query.supermarketId as string) : user.supermarketId;
  const branchId = (req.query.branchId as string) || null;
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
  const targetSmId = user.role === 'admin' ? req.body.supermarketId : user.supermarketId;

  if (!csvText) {
    return res.status(400).json({ error: 'csvText content is required' });
  }

  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return res.status(400).json({ error: 'CSV must contain a header line and at least one data row' });
  }

  const data = db.getRaw();
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
app.get('/api/owner/promotions', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const supermarketId = user.role === 'admin' ? (req.query.supermarketId as string) : user.supermarketId;
  const data = db.getRaw();
  const promos = data.promotions.filter((p) => p.supermarketId === supermarketId);
  res.json(promos);
});

app.post('/api/owner/promotions', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'staff' && !user.permissions?.managePromotions) {
    return res.status(403).json({ error: 'Permission denied: Staff cannot manage promotions.' });
  }

  const { name, type, discountPercent, fixedPrice, bundleQuantity, bundlePrice, productBarcodes, branchId, startDate, endDate } = req.body;
  const targetSmId = user.role === 'admin' ? req.body.supermarketId : user.supermarketId;

  if (!name || !type || !productBarcodes || productBarcodes.length === 0) {
    return res.status(400).json({ error: 'Promotion name, type, and at least one product barcode are required' });
  }

  const data = db.getRaw();
  const newPromo: Promotion = {
    id: `promo_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
    supermarketId: targetSmId,
    branchId: branchId || null,
    name: name.trim(),
    type,
    discountPercent: discountPercent ? parseFloat(discountPercent) : undefined,
    fixedPrice: fixedPrice ? parseFloat(fixedPrice) : undefined,
    bundleQuantity: bundleQuantity ? parseInt(bundleQuantity, 10) : undefined,
    bundlePrice: bundlePrice ? parseFloat(bundlePrice) : undefined,
    productBarcodes,
    startDate: startDate || new Date().toISOString(),
    endDate: endDate || new Date(Date.now() + 86400000 * 30).toISOString(),
    isActive: true,
  };

  data.promotions.push(newPromo);
  logAudit(user, 'PROMOTION_CREATED', 'promotion', newPromo.id, `Created promo "${newPromo.name}" (${newPromo.type})`, targetSmId, branchId);
  db.save();

  res.json(newPromo);
});

app.put('/api/owner/promotions/:id/toggle', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  if (user.role === 'staff' && !user.permissions?.managePromotions) {
    return res.status(403).json({ error: 'Permission denied: Staff cannot toggle promotions.' });
  }

  const data = db.getRaw();
  const promo = data.promotions.find((p) => p.id === req.params.id);
  if (!promo) return res.status(404).json({ error: 'Promotion not found' });

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
    targetSmId = user.supermarketId || null;
    targetBranchId = branchId || null;
  } else if (user.role === 'staff') {
    if (!user.permissions?.viewReports) {
      return res.status(403).json({ error: 'Permission denied: Staff cannot view branch reports.' });
    }
    // Staff restricted exclusively to their branch
    targetSmId = user.supermarketId || null;
    targetBranchId = user.branchId || null;
  } else {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const reports = computeReports(data, targetSmId, targetBranchId, startDate, endDate);
  res.json(reports);
});

// CSV Export for each report type
app.get('/api/reports/csv', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const data = db.getRaw();
  const { reportType, branchId, startDate, endDate, supermarketId } = req.query as Record<string, string>;

  let targetSmId = user.role === 'admin' ? supermarketId || null : user.supermarketId || null;
  let targetBranchId = user.role === 'staff' ? user.branchId || null : branchId || null;

  if (user.role === 'staff' && !user.permissions?.viewReports) {
    return res.status(403).json({ error: 'Permission denied' });
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
  const data = db.getRaw();
  const sm = data.supermarkets.find((s) => s.id === req.params.id);
  if (!sm) return res.status(404).json({ error: 'Supermarket not found' });

  sm.status = status;
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

  targetUser.status = status;
  logAudit(adminUser, `USER_${status.toUpperCase()}`, 'staff', targetUser.id, `User ${targetUser.name} status set to ${status}`);
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

  const { hash, salt } = hashPassword(newPassword || 'Reset123!');
  data.passwords[targetUser.id] = { hash, salt };
  targetUser.failedAttempts = 0;
  targetUser.lockedUntil = null;

  logAudit(adminUser, 'USER_PASSWORD_RESET', 'staff', targetUser.id, `Admin reset password for ${targetUser.name}`);
  db.save();
  res.json({ success: true, message: `Password reset to default for ${targetUser.name}` });
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
  const { subject, message, category = 'other', supermarketId } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required' });

  const data = db.getRaw();
  const newTicket: SupportTicket = {
    id: `tkt_${Date.now()}`,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    userPhone: user.phone,
    supermarketId: supermarketId || user.supermarketId || null,
    category,
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
// VITE DEV SERVER OR PRODUCTION SERVE
// ==========================================

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

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
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Smart Cart] Full-Stack Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
