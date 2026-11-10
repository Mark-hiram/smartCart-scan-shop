import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  User,
  Supermarket,
  Branch,
  Product,
  BranchProduct,
  Promotion,
  Cart,
  AuditLog,
  Announcement,
  SupportTicket,
  ShoppingList,
  BarcodeFormat,
  StaffPermissions,
  STAFF_PRESETS,
} from '../types';
import { calculateEAN13CheckDigit, calculateUPCACheckDigit, calculateEAN8CheckDigit, validateBarcode } from '../utils/barcode';

const DB_FILE = path.resolve(process.cwd(), 'smartcart_db.json');

export interface DatabaseSchema {
  users: User[];
  passwords: Record<string, { hash: string; salt: string }>; // userId -> hash, salt
  resetCodes: Record<string, { code: string; expiresAt: number }>; // identifier -> code, expiry
  supermarkets: Supermarket[];
  branches: Branch[];
  products: Product[];
  branchProducts: BranchProduct[];
  promotions: Promotion[];
  carts: Cart[];
  auditLogs: AuditLog[];
  announcements: Announcement[];
  supportTickets: SupportTicket[];
  shoppingLists: ShoppingList[];
  favourites: Record<string, string[]>; // userId -> array of barcodes
}

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return { hash, salt: actualSalt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

// Generate valid check-digit barcodes
function makeEAN13(twelveDigits: string): string {
  const cd = calculateEAN13CheckDigit(twelveDigits);
  return `${twelveDigits}${cd}`;
}

function makeUPCA(elevenDigits: string): string {
  const cd = calculateUPCACheckDigit(elevenDigits);
  return `${elevenDigits}${cd}`;
}

function makeEAN8(sevenDigits: string): string {
  const cd = calculateEAN8CheckDigit(sevenDigits);
  return `${sevenDigits}${cd}`;
}

export function createInitialDatabase(): DatabaseSchema {
  const now = new Date().toISOString();

  // Supermarkets
  const supermarkets: Supermarket[] = [
    {
      id: 'sm_naivas',
      name: 'Naivas Supermarket',
      code: 'NAIVAS',
      contactEmail: 'corporate@naivas.co.ke',
      contactPhone: '+254711000111',
      status: 'active',
      currency: 'KES',
      createdAt: now,
    },
    {
      id: 'sm_quickmart',
      name: 'Quickmart Kenya',
      code: 'QUICKMART',
      contactEmail: 'care@quickmart.co.ke',
      contactPhone: '+254733000222',
      status: 'active',
      currency: 'KES',
      createdAt: now,
    },
  ];

  // Branches with real GPS coordinates in Nairobi
  const branches: Branch[] = [
    {
      id: 'br_westlands',
      supermarketId: 'sm_naivas',
      name: 'Westlands Mall Branch',
      code: 'NAI-WST',
      address: 'Westlands Commercial District, Ring Road',
      city: 'Nairobi',
      latitude: -1.2685,
      longitude: 36.8049,
      phone: '+254711110001',
      isActive: true,
    },
    {
      id: 'br_kilimani',
      supermarketId: 'sm_naivas',
      name: 'Kilimani Urban Branch',
      code: 'NAI-KLM',
      address: 'Argwings Kodhek Road, Kilimani',
      city: 'Nairobi',
      latitude: -1.2980,
      longitude: 36.7865,
      phone: '+254711110002',
      isActive: true,
    },
    {
      id: 'br_cbd',
      supermarketId: 'sm_quickmart',
      name: 'CBD City Centre Branch',
      code: 'QMT-CBD',
      address: 'Kimathi Street, Central Business District',
      city: 'Nairobi',
      latitude: -1.2833,
      longitude: 36.8219,
      phone: '+254733330001',
      isActive: true,
    },
    {
      id: 'br_mombasa',
      supermarketId: 'sm_quickmart',
      name: 'Mombasa Road Hyper',
      code: 'QMT-MBA',
      address: 'NextGen Mall, Mombasa Road',
      city: 'Nairobi',
      latitude: -1.3210,
      longitude: 36.8520,
      phone: '+254733330002',
      isActive: true,
    },
  ];

  // Users with diverse Staff Permission Presets (Note: Exactly ONE System Admin is created via First-Time Setup)
  const users: User[] = [
    {
      id: 'usr_owner_naivas',
      name: 'Grace Wambui (Naivas Owner)',
      email: 'owner@naivas.com',
      phone: '+254711111111',
      role: 'owner',
      supermarketId: 'sm_naivas',
      status: 'active',
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now,
    },
    // Preset 1: Cashier (only verifyCarts)
    {
      id: 'usr_staff_westlands',
      name: 'Kevin Omondi (Cashier Preset)',
      email: 'staff.westlands@naivas.com',
      phone: '+254722222222',
      role: 'staff',
      supermarketId: 'sm_naivas',
      branchId: 'br_westlands',
      permissions: { ...STAFF_PRESETS.cashier },
      status: 'active',
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now,
    },
    // Preset 2: Stock Clerk (viewStock, editStock, viewPrices)
    {
      id: 'usr_staff_kilimani',
      name: 'Alice Chebet (Stock Clerk Preset)',
      email: 'staff.kilimani@naivas.com',
      phone: '+254722333444',
      role: 'staff',
      supermarketId: 'sm_naivas',
      branchId: 'br_kilimani',
      permissions: { ...STAFF_PRESETS.stock_clerk },
      status: 'active',
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now,
    },
    // Preset 3: Branch Manager (all permissions for that branch)
    {
      id: 'usr_manager_westlands',
      name: 'James Mwangi (Branch Manager Preset)',
      email: 'manager.westlands@naivas.com',
      phone: '+254722555666',
      role: 'staff',
      supermarketId: 'sm_naivas',
      branchId: 'br_westlands',
      permissions: { ...STAFF_PRESETS.branch_manager },
      status: 'active',
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now,
    },
    {
      id: 'usr_owner_quickmart',
      name: 'Peter Kiprono (Quickmart Owner)',
      email: 'owner@quickmart.com',
      phone: '+254733333333',
      role: 'owner',
      supermarketId: 'sm_quickmart',
      status: 'active',
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now,
    },
    {
      id: 'usr_staff_cbd',
      name: 'Sarah Achieng (CBD Cashier)',
      email: 'staff.cbd@quickmart.com',
      phone: '+254744444444',
      role: 'staff',
      supermarketId: 'sm_quickmart',
      branchId: 'br_cbd',
      permissions: { ...STAFF_PRESETS.cashier },
      status: 'active',
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now,
    },
    {
      id: 'usr_shopper',
      name: 'Brian Mwangi (Shopper)',
      email: 'shopper@gmail.com',
      phone: '+254755555555',
      role: 'shopper',
      status: 'active',
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now,
    },
  ];

  const passwords: Record<string, { hash: string; salt: string }> = {
    usr_owner_naivas: hashPassword('Owner123!'),
    usr_staff_westlands: hashPassword('Staff123!'),
    usr_staff_kilimani: hashPassword('Staff123!'),
    usr_manager_westlands: hashPassword('Staff123!'),
    usr_owner_quickmart: hashPassword('Owner123!'),
    usr_staff_cbd: hashPassword('Staff123!'),
    usr_shopper: hashPassword('Shopper123!'),
  };

  // Seed 30 authentic supermarket products with discrete aisle, shelf, and aisleShelf
  const rawProducts = [
    // Dairy & Eggs
    { name: 'Brookside Fresh Whole Milk 500ml', nameSw: 'Maziwa Safi ya Brookside 500ml', cat: 'Dairy', price: 65, aisle: 'Aisle 1', shelf: 'Shelf A', raw: '616110123456', fmt: 'EAN_13' as BarcodeFormat, unit: 'pouch' },
    { name: 'Bio Natural Plain Yoghurt 500g', nameSw: 'Mtindi wa Bio 500g', cat: 'Dairy', price: 145, aisle: 'Aisle 1', shelf: 'Shelf B', raw: '616110123457', fmt: 'EAN_13' as BarcodeFormat, unit: 'tub' },
    { name: 'Ilara Long Life Milk 1L', nameSw: 'Maziwa ya Ilara ya Kudumu 1L', cat: 'Dairy', price: 125, aisle: 'Aisle 1', shelf: 'Shelf C', raw: '616110123458', fmt: 'EAN_13' as BarcodeFormat, unit: 'carton' },
    { name: 'Fresh Farm Tray Eggs (30 Pcs)', nameSw: 'Mayai ya Kienyeji Trei (Mayai 30)', cat: 'Dairy', price: 480, aisle: 'Aisle 1', shelf: 'Stand D', raw: '616110123459', fmt: 'EAN_13' as BarcodeFormat, unit: 'tray' },
    { name: 'Dairyland Salted Butter 250g', nameSw: 'Siagi ya Dairyland 250g', cat: 'Dairy', price: 290, aisle: 'Aisle 1', shelf: 'Shelf E', raw: '616110123460', fmt: 'EAN_13' as BarcodeFormat, unit: 'block' },

    // Grains & Flours
    { name: 'Jogoo Premium Maize Meal 2kg', nameSw: 'Unga wa Mahindi wa Jogoo 2kg', cat: 'Pantry', price: 155, aisle: 'Aisle 2', shelf: 'Shelf 1', raw: '616110234561', fmt: 'EAN_13' as BarcodeFormat, unit: 'packet' },
    { name: 'Ajab All Purpose Wheat Flour 2kg', nameSw: 'Unga wa Ngano wa Ajab 2kg', cat: 'Pantry', price: 195, aisle: 'Aisle 2', shelf: 'Shelf 2', raw: '616110234562', fmt: 'EAN_13' as BarcodeFormat, unit: 'packet' },
    { name: 'Daawat Traditional Basmati Rice 2kg', nameSw: 'Mchele wa Basmati wa Daawat 2kg', cat: 'Pantry', price: 460, aisle: 'Aisle 2', shelf: 'Shelf 3', raw: '616110234563', fmt: 'EAN_13' as BarcodeFormat, unit: 'bag' },
    { name: 'Pearl Pure Pishori Rice 1kg', nameSw: 'Mchele wa Pishori wa Pearl 1kg', cat: 'Pantry', price: 240, aisle: 'Aisle 2', shelf: 'Shelf 4', raw: '616110234564', fmt: 'EAN_13' as BarcodeFormat, unit: 'bag' },

    // Cooking Essentials & Sugar
    { name: 'Rina Vegetable Cooking Oil 1L', nameSw: 'Mafuta ya Kupikia ya Rina 1L', cat: 'Pantry', price: 295, aisle: 'Aisle 3', shelf: 'Shelf A', raw: '616110345671', fmt: 'EAN_13' as BarcodeFormat, unit: 'bottle' },
    { name: 'Elianto Pure Corn Oil 2L', nameSw: 'Mafuta ya Mahindi ya Elianto 2L', cat: 'Pantry', price: 680, aisle: 'Aisle 3', shelf: 'Shelf B', raw: '616110345672', fmt: 'EAN_13' as BarcodeFormat, unit: 'bottle' },
    { name: 'Mumias Pure White Sugar 1kg', nameSw: 'Sukari Nyeupe ya Mumias 1kg', cat: 'Pantry', price: 180, aisle: 'Aisle 3', shelf: 'Shelf C', raw: '616110345673', fmt: 'EAN_13' as BarcodeFormat, unit: 'packet' },
    { name: 'Kensalt Iodised Table Salt 1kg', nameSw: 'Chumvi Safi ya Kensalt 1kg', cat: 'Pantry', price: 40, aisle: 'Aisle 3', shelf: 'Shelf D', raw: '616110345674', fmt: 'EAN_13' as BarcodeFormat, unit: 'packet' },

    // Bakery
    { name: 'Supaloaf White Sliced Bread 400g', nameSw: 'Mkate Mweupe wa Supaloaf 400g', cat: 'Bakery', price: 65, aisle: 'Aisle 4', shelf: 'Rack 1', raw: '616110456781', fmt: 'EAN_13' as BarcodeFormat, unit: 'loaf' },
    { name: 'Festive Brown Wholemeal Bread 400g', nameSw: 'Mkate wa Kikombe wa Festive 400g', cat: 'Bakery', price: 70, aisle: 'Aisle 4', shelf: 'Rack 2', raw: '616110456782', fmt: 'EAN_13' as BarcodeFormat, unit: 'loaf' },
    { name: 'Kenblest Sweet Brioche Buns 6 Pcs', nameSw: 'Mikate Midogo ya Kenblest Pakiti ya 6', cat: 'Bakery', price: 90, aisle: 'Aisle 4', shelf: 'Rack 3', raw: '616110456783', fmt: 'EAN_13' as BarcodeFormat, unit: 'pack' },

    // Beverages & Breakfast
    { name: 'Ketepa Pride Loose Black Tea 250g', nameSw: 'Chai ya Majani ya Ketepa 250g', cat: 'Beverages', price: 110, aisle: 'Aisle 5', shelf: 'Shelf 1', raw: '616110567891', fmt: 'EAN_13' as BarcodeFormat, unit: 'box' },
    { name: 'Nescafe Classic Instant Coffee 100g', nameSw: 'Kahawa ya Nescafe Classic 100g', cat: 'Beverages', price: 420, aisle: 'Aisle 5', shelf: 'Shelf 2', raw: '616110567892', fmt: 'EAN_13' as BarcodeFormat, unit: 'jar' },
    { name: 'Milo Chocolate Malt Drink 400g', nameSw: 'Kinywaji cha Chokoleti cha Milo 400g', cat: 'Beverages', price: 380, aisle: 'Aisle 5', shelf: 'Shelf 3', raw: '616110567893', fmt: 'EAN_13' as BarcodeFormat, unit: 'tin' },
    { name: 'Coca-Cola Zero Sugar Bottle 500ml', nameSw: 'Kinywaji cha Coca-Cola Zero 500ml', cat: 'Beverages', price: 70, aisle: 'Aisle 5', shelf: 'Shelf 4', raw: '04900000044', fmt: 'UPC_A' as BarcodeFormat, unit: 'bottle' },
    { name: 'Minute Maid Pulpy Orange Juice 1L', nameSw: 'Juisi ya Machungwa ya Minute Maid 1L', cat: 'Beverages', price: 185, aisle: 'Aisle 5', shelf: 'Shelf 5', raw: '616110567895', fmt: 'EAN_13' as BarcodeFormat, unit: 'bottle' },

    // Snacks & Confectionery
    { name: 'Tropical Heat Chilli Lemon Crisps 50g', nameSw: 'Krips za Pilipili na Ndimu za Tropical Heat', cat: 'Snacks', price: 65, aisle: 'Aisle 6', shelf: 'Rack A', raw: '616110678901', fmt: 'EAN_13' as BarcodeFormat, unit: 'packet' },
    { name: 'Cadbury Dairy Milk Chocolate 80g', nameSw: 'Chokoleti ya Cadbury Dairy Milk 80g', cat: 'Snacks', price: 160, aisle: 'Aisle 6', shelf: 'Stand B', raw: '7622210', fmt: 'EAN_8' as BarcodeFormat, unit: 'bar' },
    { name: 'Nuvita Glucose Biscuits 100g', nameSw: 'Biskuti za Nuvita Glucose 100g', cat: 'Snacks', price: 35, aisle: 'Aisle 6', shelf: 'Shelf C', raw: '616110678903', fmt: 'EAN_13' as BarcodeFormat, unit: 'packet' },

    // Household & Laundry
    { name: 'Ariel Complete Laundry Powder 1kg', nameSw: 'Omo/Sabuni ya Ariel ya Unga 1kg', cat: 'Household', price: 340, aisle: 'Aisle 7', shelf: 'Shelf 1', raw: '616110789011', fmt: 'EAN_13' as BarcodeFormat, unit: 'bag' },
    { name: 'Sunlight Dishwashing Liquid Lemon 750ml', nameSw: 'Sabuni ya Maji ya Sunlight ya Ndimu 750ml', cat: 'Household', price: 215, aisle: 'Aisle 7', shelf: 'Shelf 2', raw: '616110789012', fmt: 'EAN_13' as BarcodeFormat, unit: 'bottle' },
    { name: 'Geisha Beauty Bar Soap Rose 225g', nameSw: 'Sabuni ya Kuogea ya Geisha 225g', cat: 'Personal Care', price: 95, aisle: 'Aisle 7', shelf: 'Shelf 3', raw: '616110789013', fmt: 'EAN_13' as BarcodeFormat, unit: 'bar' },
    { name: 'Colgate Herbal White Toothpaste 140g', nameSw: 'Dawa ya Meno ya Colgate Herbal 140g', cat: 'Personal Care', price: 175, aisle: 'Aisle 7', shelf: 'Shelf 4', raw: '616110789014', fmt: 'EAN_13' as BarcodeFormat, unit: 'tube' },
    { name: 'Harpic Power Plus Toilet Cleaner 500ml', nameSw: 'Dawa ya Kusafisha Choo ya Harpic 500ml', cat: 'Household', price: 230, aisle: 'Aisle 7', shelf: 'Shelf 5', raw: '616110789015', fmt: 'EAN_13' as BarcodeFormat, unit: 'bottle' },

    // Fresh Produce
    { name: 'Organic Royal Gala Apples Pack 4 Pcs', nameSw: 'Tofaa Safi za Royal Gala Pakiti ya 4', cat: 'Produce', price: 260, aisle: 'Produce Bay', shelf: 'Stand 1', raw: '616110890121', fmt: 'EAN_13' as BarcodeFormat, unit: 'pack' },
  ];

  const products: Product[] = [];
  const branchProducts: BranchProduct[] = [];

  // Create products for Naivas
  rawProducts.forEach((item, idx) => {
    let finalBarcode = '';
    if (item.fmt === 'EAN_13') {
      finalBarcode = makeEAN13(item.raw);
    } else if (item.fmt === 'UPC_A') {
      finalBarcode = makeUPCA(item.raw);
    } else if (item.fmt === 'EAN_8') {
      finalBarcode = makeEAN8(item.raw);
    }

    const prodId = `prod_${idx + 1}`;
    const product: Product = {
      id: prodId,
      supermarketId: 'sm_naivas',
      barcode: finalBarcode,
      barcodeFormat: item.fmt,
      name: item.name,
      nameSwahili: item.nameSw,
      category: item.cat,
      basePrice: item.price,
      aisle: item.aisle,
      shelf: item.shelf,
      aisleShelf: `${item.aisle}, ${item.shelf}`,
      lowStockThreshold: 10,
      unit: item.unit,
      createdAt: now,
      updatedAt: now,
    };
    products.push(product);

    // Branch overrides for Westlands
    branchProducts.push({
      id: `bp_wst_${prodId}`,
      branchId: 'br_westlands',
      productId: prodId,
      priceOverride: idx === 0 ? 60 : (idx === 5 ? 150 : null),
      stock: 40 + (idx * 3) % 50,
      lowStockThresholdOverride: null,
      aisleOverride: null,
      shelfOverride: null,
    });

    // Branch overrides for Kilimani
    branchProducts.push({
      id: `bp_klm_${prodId}`,
      branchId: 'br_kilimani',
      productId: prodId,
      priceOverride: idx === 1 ? 140 : null,
      stock: 25 + (idx * 2) % 35,
      lowStockThresholdOverride: null,
      aisleOverride: null,
      shelfOverride: null,
    });
  });

  // Quickmart products
  products.slice(0, 15).forEach((item, idx) => {
    const qProdId = `qprod_${idx + 1}`;
    const qProduct: Product = {
      ...item,
      id: qProdId,
      supermarketId: 'sm_quickmart',
      basePrice: Math.round(item.basePrice * 0.98),
    };
    products.push(qProduct);

    branchProducts.push({
      id: `bp_cbd_${qProdId}`,
      branchId: 'br_cbd',
      productId: qProdId,
      priceOverride: null,
      stock: 35 + idx * 2,
      lowStockThresholdOverride: null,
    });

    branchProducts.push({
      id: `bp_mba_${qProdId}`,
      branchId: 'br_mombasa',
      productId: qProdId,
      priceOverride: null,
      stock: 28 + idx,
      lowStockThresholdOverride: null,
    });
  });

  // Sample promotions
  const promotions: Promotion[] = [
    {
      id: 'promo_milk_discount',
      supermarketId: 'sm_naivas',
      branchId: null, // all branches
      name: 'Fresh Milk Special: 10% Off',
      nameSwahili: 'Ofa ya Maziwa Safi: Punguzo la 10%',
      type: 'percent_off',
      discountPercent: 10,
      productBarcodes: [products[0].barcode], // Brookside milk
      startDate: new Date(Date.now() - 86400000 * 5).toISOString(),
      endDate: new Date(Date.now() + 86400000 * 25).toISOString(),
      isActive: true,
    },
    {
      id: 'promo_flour_bundle',
      supermarketId: 'sm_naivas',
      branchId: 'br_westlands',
      name: 'Jogoo Maize Meal Bundle: 3 for KES 420',
      nameSwahili: 'Ofa ya Unga wa Jogoo: 3 kwa KES 420',
      type: 'bundle',
      bundleQuantity: 3,
      bundlePrice: 420,
      productBarcodes: [products[5].barcode],
      startDate: new Date(Date.now() - 86400000 * 2).toISOString(),
      endDate: new Date(Date.now() + 86400000 * 14).toISOString(),
      isActive: true,
    },
    {
      id: 'promo_juice_fixed',
      supermarketId: 'sm_naivas',
      branchId: null,
      name: 'Minute Maid Juice Flash Sale at KES 165',
      nameSwahili: 'Ofa Maalum ya Juisi ya Minute Maid kwa KES 165',
      type: 'fixed_price',
      fixedPrice: 165,
      productBarcodes: [products[20].barcode],
      startDate: new Date(Date.now() - 86400000 * 1).toISOString(),
      endDate: new Date(Date.now() + 86400000 * 20).toISOString(),
      isActive: true,
    },
  ];

  // Initial audit logs
  const auditLogs: AuditLog[] = [
    {
      id: 'log_1',
      supermarketId: 'sm_naivas',
      branchId: 'br_westlands',
      userId: 'usr_owner_naivas',
      userName: 'Grace Wambui (Naivas Owner)',
      userRole: 'owner',
      action: 'STAFF_PERMISSIONS_UPDATED',
      entityType: 'staff',
      entityId: 'usr_staff_westlands',
      details: 'Assigned "Cashier" preset to staff Kevin Omondi (verifyCarts only)',
      timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      id: 'log_2',
      supermarketId: 'sm_naivas',
      branchId: 'br_westlands',
      userId: 'usr_owner_naivas',
      userName: 'Grace Wambui (Naivas Owner)',
      userRole: 'owner',
      action: 'PRICE_OVERRIDE_UPDATED',
      entityType: 'price',
      entityId: 'prod_1',
      details: 'Set Westlands branch price override for Brookside Fresh Milk from KES 65 to KES 60',
      timestamp: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
    {
      id: 'log_3',
      supermarketId: null,
      branchId: null,
      userId: 'system_init',
      userName: 'Platform Provisioning',
      userRole: 'admin',
      action: 'SUPERMARKET_APPROVED',
      entityType: 'supermarket',
      entityId: 'sm_naivas',
      details: 'Approved Naivas Supermarket onboarding and authorized 2 initial branches',
      timestamp: new Date(Date.now() - 86400000 * 10).toISOString(),
    },
  ];

  // Phase 2 Announcements with Expiry Date and Read Tracking
  const announcements: Announcement[] = [
    {
      id: 'anc_1',
      title: 'Self-Checkout Scanner Optimization',
      message: 'Barcode detection and offline caching have been upgraded. Please verify all shopper till codes before ringing register payment.',
      targetSupermarketId: null, // all supermarkets
      priority: 'normal',
      expiryDate: new Date(Date.now() + 86400000 * 14).toISOString(),
      readByUserIds: [],
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      authorName: 'System Administration',
    },
    {
      id: 'anc_2',
      title: 'Weekend High-Traffic Notice & Aisle Restock',
      message: 'Westlands Mall Branch will host weekend discount flash sales. Branch managers ensure dairy and bakery shelf stock is verified.',
      targetSupermarketId: 'sm_naivas',
      priority: 'urgent',
      expiryDate: new Date(Date.now() + 86400000 * 5).toISOString(),
      readByUserIds: [],
      createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
      authorName: 'Naivas Operations Head',
    },
  ];

  // Phase 2 Support Tickets with Categories and Replies
  const supportTickets: SupportTicket[] = [
    {
      id: 'tkt_1',
      userId: 'usr_shopper',
      userName: 'Brian Mwangi',
      userEmail: 'shopper@gmail.com',
      userPhone: '+254755555555',
      supermarketId: 'sm_naivas',
      category: 'scanner',
      subject: 'Barcode scanner camera illumination in low light aisles',
      message: 'Could the torch button stay on while scanning multiple items consecutively?',
      status: 'resolved',
      reply: 'Thanks Brian! We have updated the scanner with a persistent torch toggle button and offline cache.',
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    },
    {
      id: 'tkt_2',
      userId: 'usr_staff_westlands',
      userName: 'Kevin Omondi',
      userEmail: 'staff.westlands@naivas.com',
      userPhone: '+254722222222',
      supermarketId: 'sm_naivas',
      category: 'cashier',
      subject: 'Clarification on flagging damaged product barcodes',
      message: 'When a shopper brings a product with a ripped barcode, how should cashier note it?',
      status: 'in_progress',
      reply: 'Staff can tap "Flag Mismatch" and select "Damaged goods / Unreadable barcode".',
      createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
      updatedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    },
    {
      id: 'tkt_3',
      userId: 'usr_owner_quickmart',
      userName: 'Peter Kiprono',
      userEmail: 'owner@quickmart.com',
      userPhone: '+254733333333',
      supermarketId: 'sm_quickmart',
      category: 'stock',
      subject: 'CSV Import with new Aisle and Shelf columns',
      message: 'Inquiring if we can import aisle and shelf numbers directly via spreadsheet.',
      status: 'open',
      createdAt: new Date(Date.now() - 3600000 * 8).toISOString(),
      updatedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
    },
  ];

  // Phase 2 Carts (Demo active cart + 3 completed past carts for Shopper History & Re-Add)
  const cartItem1: any = {
    id: 'ci_1',
    productId: products[0].id,
    barcode: products[0].barcode,
    name: products[0].name,
    category: products[0].category,
    aisle: products[0].aisle,
    shelf: products[0].shelf,
    aisleShelf: products[0].aisleShelf,
    quantity: 2,
    lockedPrice: 60,
    originalBasePrice: 65,
    discount: 12,
    effectiveTotal: 108,
    promoId: 'promo_milk_discount',
    promoName: 'Fresh Milk Special: 10% Off',
    scannedAt: new Date(Date.now() - 1800000).toISOString(),
    verifiedByCashier: false,
  };
  const cartItem2: any = {
    id: 'ci_2',
    productId: products[5].id,
    barcode: products[5].barcode,
    name: products[5].name,
    category: products[5].category,
    aisle: products[5].aisle,
    shelf: products[5].shelf,
    aisleShelf: products[5].aisleShelf,
    quantity: 1,
    lockedPrice: 150,
    originalBasePrice: 155,
    discount: 0,
    effectiveTotal: 150,
    scannedAt: new Date(Date.now() - 1500000).toISOString(),
    verifiedByCashier: false,
  };

  const carts: Cart[] = [
    // Active / Locked cart for cashier verification demo
    {
      id: 'cart_demo_1',
      shortCode: 'SC-8429',
      shopperId: 'usr_shopper',
      shopperName: 'Brian Mwangi',
      shopperPhone: '+254755555555',
      supermarketId: 'sm_naivas',
      branchId: 'br_westlands',
      status: 'locked',
      items: [cartItem1, cartItem2],
      subtotal: 270,
      totalDiscount: 12,
      finalTotal: 258,
      budgetLimit: 500,
      createdAt: new Date(Date.now() - 1800000).toISOString(),
      updatedAt: new Date(Date.now() - 1200000).toISOString(),
    },
    // Past completed cart 1 (3 days ago at Westlands)
    {
      id: 'cart_past_1',
      shortCode: 'SC-5120',
      shopperId: 'usr_shopper',
      shopperName: 'Brian Mwangi',
      shopperPhone: '+254755555555',
      supermarketId: 'sm_naivas',
      branchId: 'br_westlands',
      status: 'completed',
      items: [
        {
          id: 'ci_p1',
          productId: products[0].id,
          barcode: products[0].barcode,
          name: products[0].name,
          category: products[0].category,
          aisle: products[0].aisle,
          shelf: products[0].shelf,
          aisleShelf: products[0].aisleShelf,
          quantity: 2,
          lockedPrice: 60,
          originalBasePrice: 65,
          discount: 12,
          effectiveTotal: 108,
          scannedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
          verifiedByCashier: true,
        },
        {
          id: 'ci_p2',
          productId: products[13].id, // Supaloaf Bread
          barcode: products[13].barcode,
          name: products[13].name,
          category: products[13].category,
          aisle: products[13].aisle,
          shelf: products[13].shelf,
          aisleShelf: products[13].aisleShelf,
          quantity: 1,
          lockedPrice: 65,
          originalBasePrice: 65,
          discount: 0,
          effectiveTotal: 65,
          scannedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
          verifiedByCashier: true,
        },
        {
          id: 'ci_p3',
          productId: products[9].id, // Rina Cooking Oil
          barcode: products[9].barcode,
          name: products[9].name,
          category: products[9].category,
          aisle: products[9].aisle,
          shelf: products[9].shelf,
          aisleShelf: products[9].aisleShelf,
          quantity: 1,
          lockedPrice: 295,
          originalBasePrice: 295,
          discount: 0,
          effectiveTotal: 295,
          scannedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
          verifiedByCashier: true,
        },
      ],
      subtotal: 480,
      totalDiscount: 12,
      finalTotal: 468,
      budgetLimit: 600,
      createdAt: new Date(Date.now() - 86400000 * 3 - 3600000 * 2).toISOString(),
      updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
    // Past completed cart 2 (7 days ago at Kilimani)
    {
      id: 'cart_past_2',
      shortCode: 'SC-3341',
      shopperId: 'usr_shopper',
      shopperName: 'Brian Mwangi',
      shopperPhone: '+254755555555',
      supermarketId: 'sm_naivas',
      branchId: 'br_kilimani',
      status: 'completed',
      items: [
        {
          id: 'ci_p4',
          productId: products[5].id, // Jogoo Maize Meal
          barcode: products[5].barcode,
          name: products[5].name,
          category: products[5].category,
          aisle: products[5].aisle,
          shelf: products[5].shelf,
          aisleShelf: products[5].aisleShelf,
          quantity: 3,
          lockedPrice: 155,
          originalBasePrice: 155,
          discount: 45,
          effectiveTotal: 420,
          scannedAt: new Date(Date.now() - 86400000 * 7).toISOString(),
          verifiedByCashier: true,
        },
        {
          id: 'ci_p5',
          productId: products[24].id, // Ariel Laundry Powder
          barcode: products[24].barcode,
          name: products[24].name,
          category: products[24].category,
          aisle: products[24].aisle,
          shelf: products[24].shelf,
          aisleShelf: products[24].aisleShelf,
          quantity: 1,
          lockedPrice: 340,
          originalBasePrice: 340,
          discount: 0,
          effectiveTotal: 340,
          scannedAt: new Date(Date.now() - 86400000 * 7).toISOString(),
          verifiedByCashier: true,
        },
      ],
      subtotal: 805,
      totalDiscount: 45,
      finalTotal: 760,
      budgetLimit: 1000,
      createdAt: new Date(Date.now() - 86400000 * 7 - 3600000 * 5).toISOString(),
      updatedAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    },
  ];

  // Phase 2 Shareable Shopping Lists
  const shoppingLists: ShoppingList[] = [
    {
      id: 'list_weekend_family',
      userId: 'usr_shopper',
      title: 'Weekend Family Grocery Run',
      shareCode: 'WKND-77',
      canEdit: true,
      items: [
        {
          id: 'li_1',
          barcode: products[0].barcode,
          productName: products[0].name,
          quantity: 2,
          completed: false,
          aisle: 'Aisle 1',
          shelf: 'Shelf A',
          estimatedPrice: 65,
        },
        {
          id: 'li_2',
          barcode: products[5].barcode,
          productName: products[5].name,
          quantity: 1,
          completed: true,
          aisle: 'Aisle 2',
          shelf: 'Shelf 1',
          estimatedPrice: 155,
        },
        {
          id: 'li_3',
          barcode: products[13].barcode,
          productName: products[13].name,
          quantity: 1,
          completed: false,
          aisle: 'Aisle 4',
          shelf: 'Rack 1',
          estimatedPrice: 65,
        },
        {
          id: 'li_4',
          barcode: products[9].barcode,
          productName: products[9].name,
          quantity: 1,
          completed: false,
          aisle: 'Aisle 3',
          shelf: 'Shelf A',
          estimatedPrice: 295,
        },
      ],
      createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    },
  ];

  // Phase 2 Favourites
  const favourites: Record<string, string[]> = {
    usr_shopper: [
      products[0].barcode, // Milk
      products[5].barcode, // Maize meal
      products[13].barcode, // Bread
      products[20].barcode, // Minute Maid juice
    ],
  };

  return {
    users,
    passwords,
    resetCodes: {},
    supermarkets,
    branches,
    products,
    branchProducts,
    promotions,
    carts,
    auditLogs,
    announcements,
    supportTickets,
    shoppingLists,
    favourites,
  };
}

export class Database {
  private data: DatabaseSchema;

  constructor() {
    this.data = this.load();
  }

  private load(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        // Ensure phase 2 schema arrays exist if reading older DB file
        if (!parsed.favourites) parsed.favourites = {};
        if (!parsed.shoppingLists) parsed.shoppingLists = [];

        // STRICT SECURITY INVARIANT: Purge all demo/seed admin accounts
        let needsSave = false;
        if (parsed.users) {
          const originalCount = parsed.users.length;
          parsed.users = parsed.users.filter(
            (u: any) => !(u.id === 'usr_admin' || u.email === 'admin@smartcart.com')
          );
          if (parsed.users.length !== originalCount) {
            needsSave = true;
          }
        }
        if (parsed.passwords && parsed.passwords['usr_admin']) {
          delete parsed.passwords['usr_admin'];
          needsSave = true;
        }

        // Enforce strictly at most ONE system admin
        const adminUsers = (parsed.users || []).filter((u: any) => u.role === 'admin');
        if (adminUsers.length > 1) {
          // Keep only the permanent admin, or the first one
          const primaryAdmin = adminUsers.find((u: any) => u.isPermanentAdmin) || adminUsers[0];
          parsed.users = parsed.users.filter((u: any) => u.role !== 'admin' || u.id === primaryAdmin.id);
          needsSave = true;
        }

        if (needsSave) {
          this.saveDirect(parsed);
        }
        return parsed;
      }
    } catch (e) {
      console.warn('Failed to load DB file, initializing fresh DB:', e);
    }
    const fresh = createInitialDatabase();
    this.saveDirect(fresh);
    return fresh;
  }

  private saveDirect(data: DatabaseSchema) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save DB file:', e);
    }
  }

  public save() {
    this.saveDirect(this.data);
  }

  public getRaw(): DatabaseSchema {
    return this.data;
  }

  public getAdmin(): User | null {
    return this.data.users.find((u) => u.role === 'admin') || null;
  }

  public hasAdmin(): boolean {
    return this.data.users.some((u) => u.role === 'admin');
  }
}

export const db = new Database();
