// Copyright (c) 2026 SmartCart Owner. All rights reserved.

export type UserRole = 'admin' | 'owner' | 'staff' | 'shopper';
export type PortalType = 'shopper' | 'staff' | 'management';

export interface StaffPermissions {
  viewStock: boolean;
  editStock: boolean;
  viewPrices: boolean;
  editPrices: boolean;
  managePromotions: boolean;
  verifyCarts: boolean;
  viewReports: boolean;
}

export type StaffPreset = 'cashier' | 'stock_clerk' | 'branch_manager' | 'custom';

export const STAFF_PRESETS: Record<Exclude<StaffPreset, 'custom'>, StaffPermissions> = {
  cashier: {
    viewStock: false,
    editStock: false,
    viewPrices: true,
    editPrices: false,
    managePromotions: false,
    verifyCarts: true,
    viewReports: false,
  },
  stock_clerk: {
    viewStock: true,
    editStock: true,
    viewPrices: true,
    editPrices: false,
    managePromotions: false,
    verifyCarts: false,
    viewReports: false,
  },
  branch_manager: {
    viewStock: true,
    editStock: true,
    viewPrices: true,
    editPrices: true,
    managePromotions: true,
    verifyCarts: true,
    viewReports: true,
  },
};

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  supermarketId?: string;
  branchId?: string;
  permissions?: StaffPermissions;
  status: 'active' | 'suspended';
  failedAttempts: number;
  lockedUntil?: number | null;
  mustChangePassword?: boolean;
  tempPasswordExpiresAt?: number | null;
  tempPasswordConsumed?: boolean;
  isPermanentAdmin?: boolean;
  createdAt: string;
}

export interface Supermarket {
  id: string;
  name: string;
  code: string;
  contactEmail: string;
  contactPhone: string;
  status: 'active' | 'suspended' | 'pending' | 'rejected';
  city?: string;
  notes?: string;
  firstBranchName?: string;
  initialProductCount?: number;
  applicationDate?: string;
  logo?: string;
  currency: string;
  createdAt: string;
}

export interface AiUsageRecord {
  id: string;
  userId: string;
  userRole: UserRole;
  endpoint: '/api/ai/chat' | '/api/ai/maps-grounding';
  language: 'en' | 'sw';
  hasCoords: boolean;
  createdAt: number;
}

export interface Branch {
  id: string;
  supermarketId: string;
  name: string;
  code: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  phone: string;
  isActive: boolean;
  distanceKm?: number;
}

export type BarcodeFormat = 'EAN_13' | 'EAN_8' | 'UPC_A' | 'UPC_E' | 'CODE_128';

export interface Product {
  id: string;
  supermarketId: string;
  barcode: string;
  barcodeFormat: BarcodeFormat;
  name: string;
  nameSwahili?: string;
  category: string;
  basePrice: number;
  aisle: string; // e.g. "3" or "Aisle 3"
  shelf: string; // e.g. "B" or "Shelf B"
  aisleShelf: string; // e.g. "Aisle 3, Shelf B"
  lowStockThreshold: number;
  unit: string;
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BranchProduct {
  id: string;
  branchId: string;
  productId: string;
  priceOverride: number | null;
  stock: number;
  lowStockThresholdOverride: number | null;
  aisleOverride?: string | null;
  shelfOverride?: string | null;
}

export interface EnrichedProduct extends Product {
  branchPrice: number;
  effectivePrice: number;
  stock: number;
  isLowStock: boolean;
  activePromotion?: Promotion | null;
  isFavourite?: boolean;
}

export type PromotionType = 'percent_off' | 'fixed_price' | 'bundle';

export interface Promotion {
  id: string;
  supermarketId: string;
  branchId: string | null; // null means all branches
  name: string;
  nameSwahili?: string;
  type: PromotionType;
  discountPercent?: number; // e.g. 15 for 15% off
  fixedPrice?: number; // e.g. 150
  bundleQuantity?: number; // e.g. 3
  bundlePrice?: number; // e.g. 500
  productBarcodes: string[];
  startDate: string; // ISO
  endDate: string; // ISO
  isActive: boolean;
}

export interface CartItem {
  id: string;
  productId: string;
  barcode: string;
  name: string;
  category: string;
  aisle: string;
  shelf: string;
  aisleShelf: string;
  quantity: number;
  lockedPrice: number; // locked at scan time
  originalBasePrice: number;
  discount: number;
  effectiveTotal: number;
  promoId?: string;
  promoName?: string;
  scannedAt: string;
  verifiedByCashier?: boolean;
}

export type CartStatus = 'active' | 'locked' | 'verified' | 'flagged' | 'completed' | 'cancelled';

export interface LoyaltySettings {
  pointsPerKesAmount: number;
  bonusPointsPerVerifiedCart: number;
  minCartValueKes: number;
  dailyCapPoints: number;
  monthlyCapPoints: number;
  maxOpenRedemptionsPerShopper: number;
  pointsExpiryEnabled: boolean;
  pointsExpiryDays: number;
  tierThresholds: {
    silver: number;
    gold: number;
  };
  tierBonuses: {
    bronze: number;
    silver: number;
    gold: number;
  };
}

export type LoyaltyLedgerEntryType =
  | 'earn'
  | 'redemption_reserve'
  | 'redemption_refund'
  | 'reversal'
  | 'adjustment'
  | 'expiry';

export interface LoyaltyLedgerEntry {
  id: string;
  userId: string;
  type: LoyaltyLedgerEntryType;
  amount: number;
  balanceAfter: number;
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
  createdAt: string;
}

export interface LoyaltyTransaction {
  id: string;
  ownerKey: string;
  userId?: string | null;
  supermarketId: string;
  supermarketName: string;
  branchId: string;
  branchName: string;
  cartId: string;
  cartShortCode: string;
  amountSpent: number;
  pointsEarned: number;
  createdAt: string;
}

export interface LoyaltyPointsSummary {
  totalPoints: number;
  storedBalance: number;
  ledgerBalance: number;
  lifetimePoints: number;
  earnedToday: number;
  earnedThisMonth: number;
  tier: 'Bronze' | 'Silver' | 'Gold';
  nextTier: 'Silver' | 'Gold' | null;
  pointsToNextTier: number;
  tierBonusPerCart: number;
  earnRateKes: number;
  bonusPointsPerVerifiedCart: number;
  minCartValueKes: number;
  dailyCapPoints: number;
  monthlyCapPoints: number;
  maxOpenRedemptionsPerShopper: number;
  isFrozen?: boolean;
  bySupermarket: Array<{
    supermarketId: string;
    supermarketName: string;
    points: number;
    completedCheckouts: number;
  }>;
  history: LoyaltyTransaction[];
  ledger: LoyaltyLedgerEntry[];
}

export type RewardStatus = 'active' | 'hidden';

export interface RewardItem {
  id: string;
  name: string;
  nameSw?: string;
  description: string;
  descriptionSw?: string;
  imageUrl: string;
  pointsCost: number;
  unitCostKes: number;
  colors: string[];
  sizes: string[];
  stockBySize: Record<string, number>;
  status: RewardStatus;
  createdAt: string;
  updatedAt: string;
}

export type RedemptionStatus =
  | 'requested'
  | 'approved'
  | 'ready'
  | 'dispatched'
  | 'completed'
  | 'cancelled';

export type FulfillmentMethod = 'collection' | 'delivery';

export interface RewardRedemptionOrder {
  id: string;
  referenceCode: string;
  shopperId: string;
  shopperName: string;
  shopperEmail: string;
  rewardId: string;
  rewardName: string;
  rewardImageUrl: string;
  pointsCost: number;
  unitCostKes: number;
  size: string;
  color: string;
  fulfillmentMethod: FulfillmentMethod;
  branchId?: string | null;
  branchName?: string | null;
  supermarketName?: string | null;
  contactPhone: string;
  deliveryAddress?: string | null;
  status: RedemptionStatus;
  rejectionReason?: string | null;
  stockDecreased?: boolean;
  pointsRefunded?: boolean;
  notificationMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Cart {
  id: string;
  shortCode: string; // e.g. "SC-8429"
  shopperId: string;
  shopperName: string;
  shopperPhone: string;
  supermarketId: string;
  branchId: string;
  status: CartStatus;
  items: CartItem[];
  subtotal: number;
  totalDiscount: number;
  finalTotal: number;
  budgetLimit?: number | null;
  loyaltyPointsEarned?: number;
  loyaltyEvaluated?: boolean;
  isOfflineCreated?: boolean;
  syncedAt?: string;
  verifiedByStaffId?: string;
  verifiedAt?: string;
  finishedAt?: string;
  mismatchNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GoodbyeSummaryData {
  cartId: string;
  shortCode: string;
  status: CartStatus;
  itemCount: number;
  lineItemCount: number;
  subtotal: number;
  totalDiscount: number;
  finalTotal: number;
  branchId?: string;
  branchName?: string;
  supermarketName?: string;
  loyaltyEarnedOnCart: number | null;
  loyaltyBalance: number | null;
  pendingOfflineFinish?: boolean;
  signedOutAfterShopping?: boolean;
  source?: 'finish_button' | 'sign_out';
}

export interface TransactionReceipt extends Cart {
  supermarketName: string;
  branchName: string;
  branchAddress?: string;
  branchCity?: string;
  verifiedByName?: string;
  itemCount: number;
  noPaymentInApp?: boolean;
}

export interface AuditLog {
  id: string;
  supermarketId?: string | null;
  branchId?: string | null;
  userId: string;
  userName: string;
  userRole: UserRole;
  action: string;
  entityType:
    | 'product'
    | 'price'
    | 'stock'
    | 'staff'
    | 'supermarket'
    | 'branch'
    | 'promotion'
    | 'cart'
    | 'user'
    | 'loyalty'
    | 'reward'
    | 'redemption';
  entityId: string;
  details: string;
  timestamp: string;
}

export interface Announcement {
  id: string;
  title: string;
  message: string;
  targetSupermarketId: string | null; // null for all
  priority: 'normal' | 'urgent';
  expiryDate?: string | null;
  readByUserIds?: string[];
  createdAt: string;
  authorName: string;
}

export type SupportCategory =
  | 'password_reset'
  | 'scanner'
  | 'pricing'
  | 'stock'
  | 'cashier'
  | 'app_issue'
  | 'other';

export type SupportTicketStatus =
  | 'open'
  | 'verified'
  | 'completed'
  | 'rejected'
  | 'in_progress'
  | 'resolved';

export interface PasswordResetRequestDetails {
  requestedIdentifier: string;
  requestedFullName: string;
  note?: string;
  portalRequested: PortalType;
  matchedAccount: boolean;
  matchedUserId?: string | null;
  matchedRole?: Exclude<UserRole, 'admin'> | null;
  matchedSupermarketId?: string | null;
  matchedSupermarketName?: string | null;
  maskedEmail?: string | null;
  maskedPhone?: string | null;
  identityHintPointsBalance?: number | null;
  identityHintLastPurchase?: string | null;
  identityChecked?: {
    phoneConfirmed: boolean;
    lastPurchaseOrPointsConfirmed: boolean;
    verifiedByUserId?: string;
    verifiedByName?: string;
    verifiedAt?: string;
  } | null;
  tempPasswordExpiresAt?: number | null;
  rejectionReason?: string | null;
  resolvedByUserId?: string | null;
  resolvedByName?: string | null;
  resolvedAt?: string | null;
}

export interface SupportTicket {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  supermarketId?: string | null;
  category: SupportCategory;
  subject: string;
  message: string;
  status: SupportTicketStatus;
  reply?: string;
  passwordResetDetails?: PasswordResetRequestDetails;
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingListItem {
  id: string;
  barcode?: string;
  productName: string;
  quantity: number;
  completed: boolean;
  aisle?: string;
  shelf?: string;
  estimatedPrice?: number;
}

export interface ShoppingList {
  id: string;
  userId: string;
  ownerName?: string;
  collaboratorIds?: string[];
  sourceType?: 'blank' | 'previous_purchase' | 'product_history';
  sourceCartId?: string;
  title: string;
  shareCode: string;
  canEdit: boolean;
  items: ShoppingListItem[];
  createdAt: string;
  updatedAt?: string;
}

export interface ProductHistoryEntry {
  barcode: string;
  productId: string;
  name: string;
  category: string;
  aisle: string;
  shelf: string;
  lastPurchasedAt: string;
  purchaseCount: number;
  totalQuantityPurchased: number;
  lastPrice: number;
  currentBranchPrice: number;
}

export type AnalyticsRange = 'today' | '7d' | '30d' | '90d' | 'year';

export interface ScanTelemetryEvent {
  createdAt: string;
  branchId: string;
  supermarketId: string;
  success: boolean;
}

export interface SecurityTelemetryEvent {
  createdAt: string;
  type: 'login_failure' | 'lockout';
  portal: PortalType | 'admin';
}

export interface AnalyticsKpiMetric {
  value: number;
  previous: number;
  changePct: number | null;
  sparkline: number[];
}

export interface AdminAnalyticsPayload {
  meta: {
    range: AnalyticsRange;
    supermarketId: string | null;
    branchId: string | null;
    startIso: string;
    endIso: string;
  };
  filterOptions: {
    supermarkets: Array<{
      id: string;
      name: string;
      status: Supermarket['status'];
    }>;
    branches: Array<{
      id: string;
      supermarketId: string;
      name: string;
      isActive: boolean;
    }>;
  };
  kpis: {
    activeShoppers: AnalyticsKpiMetric;
    newSignups: AnalyticsKpiMetric;
    cartsStarted: AnalyticsKpiMetric;
    cartsFinished: AnalyticsKpiMetric;
    itemsScanned: AnalyticsKpiMetric;
    averageCartValueKes: AnalyticsKpiMetric;
    loyaltyPointsIssued: AnalyticsKpiMetric;
    loyaltyPointsRedeemed: AnalyticsKpiMetric;
    scanSuccessRatePct: AnalyticsKpiMetric & {
      successes: number;
      failures: number;
    };
    securityEventsCount: AnalyticsKpiMetric & {
      failures: number;
      lockouts: number;
    };
  };
  organizationCounts: {
    supermarkets: {
      total: number;
      active: number;
      pending: number;
      suspended: number;
      rejected: number;
    };
    branches: {
      total: number;
      active: number;
      inactive: number;
    };
  };
  supermarketStatusSeries: Array<{
    status: 'active' | 'pending' | 'suspended';
    label: string;
    count: number;
  }>;
  cartCompletionSeries: Array<{
    key: 'finished' | 'in_progress';
    label: string;
    count: number;
  }>;
  activityOverTime: Array<{
    bucketKey: string;
    label: string;
    signups: number;
    cartsStarted: number;
    cartsFinished: number;
    itemsScanned: number;
    avgCartValueKes: number;
  }>;
  topSupermarketsByCarts: Array<{
    supermarketName: string;
    cartsStarted: number;
    cartsFinished: number;
    itemsScanned: number;
    avgCartValueKes: number;
    totalCartValueKes: number;
  }>;
  busiestHours: Array<{
    hour: number;
    label: string;
    cartsCount: number;
  }>;
  busiestDays: Array<{
    dayIndex: number;
    dayName: string;
    shortDay: string;
    cartsCount: number;
  }>;
  activityHeatmap: Array<{
    dayIndex: number;
    dayName: string;
    shortDay: string;
    hours: Array<{
      hour: number;
      count: number;
    }>;
  }>;
  mostScannedProducts: Array<{
    productName: string;
    unitsScanned: number;
    cartAppearances: number;
  }>;
  scanOutcomes: {
    successes: number;
    failures: number;
    overTime: Array<{
      bucketKey: string;
      label: string;
      successes: number;
      failures: number;
    }>;
  };
  loyaltyOverTime: Array<{
    bucketKey: string;
    label: string;
    issued: number;
    redeemed: number;
  }>;
  rewardsRedeemedByItem: Array<{
    rewardName: string;
    redemptionsCount: number;
    pointsRedeemed: number;
  }>;
  supportSummary: {
    passwordResetRequests: {
      total: number;
      open: number;
      closed: number;
    };
    supportTickets: {
      total: number;
      open: number;
      closed: number;
    };
  };
  securitySummary: {
    totalFailures: number;
    totalLockouts: number;
    currentlyLockedAccounts: number;
    byPortal: Array<{
      portal: string;
      failures: number;
      lockouts: number;
    }>;
    perDay: Array<{
      date: string;
      label: string;
      failures: number;
      lockouts: number;
    }>;
  };
}
