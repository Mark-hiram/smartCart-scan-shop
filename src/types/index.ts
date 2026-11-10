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
  isPermanentAdmin?: boolean;
  createdAt: string;
}

export interface Supermarket {
  id: string;
  name: string;
  code: string;
  contactEmail: string;
  contactPhone: string;
  status: 'active' | 'suspended';
  logo?: string;
  currency: string;
  createdAt: string;
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

export type CartStatus = 'active' | 'locked' | 'verified' | 'flagged' | 'completed';

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
  isOfflineCreated?: boolean;
  syncedAt?: string;
  verifiedByStaffId?: string;
  verifiedAt?: string;
  mismatchNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  supermarketId?: string | null;
  branchId?: string | null;
  userId: string;
  userName: string;
  userRole: UserRole;
  action: string;
  entityType: 'product' | 'price' | 'stock' | 'staff' | 'supermarket' | 'branch' | 'promotion' | 'cart';
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

export type SupportCategory = 'scanner' | 'pricing' | 'stock' | 'cashier' | 'app_issue' | 'other';

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
  status: 'open' | 'in_progress' | 'resolved';
  reply?: string;
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
  title: string;
  shareCode: string;
  canEdit: boolean;
  items: ShoppingListItem[];
  createdAt: string;
  updatedAt?: string;
}

