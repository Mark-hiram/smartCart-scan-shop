// Copyright (c) 2026 SmartCart Owner. All rights reserved.

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
  LoyaltyTransaction,
  LoyaltySettings,
  LoyaltyLedgerEntry,
  RewardItem,
  RewardRedemptionOrder,
  AiUsageRecord,
} from '../types';

const DB_FILE = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.resolve(process.cwd(), 'smartcart_db.json');

export interface ResetCodeRecord {
  codeHash?: string;
  codeSalt?: string;
  tokenHash?: string;
  userId?: string;
  identifier?: string;
  email?: string;
  expiresAt: number;
  failedAttempts?: number;
  used?: boolean;
}

export interface DatabaseSchema {
  users: User[];
  passwords: Record<string, { hash: string; salt: string }>; // userId -> hash, salt
  resetCodes: Record<string, ResetCodeRecord>; // identifier/tokenHashKey -> hashed reset record
  aiUsageLogs: AiUsageRecord[];
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
  loyaltyTransactions: LoyaltyTransaction[];
  loyaltySettings: LoyaltySettings;
  loyaltyLedger: LoyaltyLedgerEntry[];
  loyaltyBalances: Record<string, number>;
  rewards: RewardItem[];
  rewardRedemptions: RewardRedemptionOrder[];
  favourites: Record<string, string[]>; // userId -> array of barcodes
}

export function createDefaultLoyaltySettings(): LoyaltySettings {
  return {
    pointsPerKesAmount: 25,
    bonusPointsPerVerifiedCart: 5,
    minCartValueKes: 100,
    dailyCapPoints: 500,
    monthlyCapPoints: 5000,
    maxOpenRedemptionsPerShopper: 3,
    pointsExpiryEnabled: false,
    pointsExpiryDays: 365,
    tierThresholds: {
      silver: 500,
      gold: 1500,
    },
    tierBonuses: {
      bronze: 0,
      silver: 2,
      gold: 5,
    },
  };
}

export function createSeedRewards(): RewardItem[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'rew_smartcart_tshirt',
      name: 'Smart Cart T-shirt',
      nameSw: 'Fulana ya Smart Cart',
      description: 'Soft 100% combed cotton crew-neck T-shirt featuring the official Smart Cart mark.',
      descriptionSw: 'Fulana laini ya pamba halisi yenye nembo rasmi ya Smart Cart.',
      imageUrl: '/images/rewards/smartcart-tshirt.svg',
      pointsCost: 250,
      unitCostKes: 850,
      colors: ['Emerald Green', 'Crisp White', 'Charcoal Slate'],
      sizes: ['S', 'M', 'L', 'XL', 'XXL'],
      stockBySize: { S: 8, M: 15, L: 15, XL: 10, XXL: 6 },
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'rew_smartcart_hoodie',
      name: 'Smart Cart Hoodie',
      nameSw: 'Sweta la Kofia la Smart Cart',
      description: 'Heavyweight fleece pullover hoodie branded with the Smart Cart emblem.',
      descriptionSw: 'Sweta zito la joto lenye nembo rasmi ya Smart Cart.',
      imageUrl: '/images/rewards/smartcart-hoodie.svg',
      pointsCost: 550,
      unitCostKes: 1850,
      colors: ['Midnight Navy', 'Emerald Green'],
      sizes: ['S', 'M', 'L', 'XL', 'XXL'],
      stockBySize: { S: 5, M: 10, L: 10, XL: 8, XXL: 4 },
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'rew_smartcart_cap',
      name: 'Smart Cart Cap',
      nameSw: 'Kofia ya Smart Cart',
      description: 'Breathable cotton twill cap embroidered with the Smart Cart logo.',
      descriptionSw: 'Kofia imara ya pamba yenye nembo ya Smart Cart iliyodariziwa.',
      imageUrl: '/images/rewards/smartcart-cap.svg',
      pointsCost: 150,
      unitCostKes: 550,
      colors: ['Emerald Green', 'Midnight Black'],
      sizes: ['One Size', 'S', 'M', 'L', 'XL', 'XXL'],
      stockBySize: { 'One Size': 20, S: 8, M: 12, L: 12, XL: 8, XXL: 4 },
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
  ];
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

export function createInitialDatabase(): DatabaseSchema {
  return {
    users: [],
    passwords: {},
    resetCodes: {},
    aiUsageLogs: [],
    supermarkets: [],
    branches: [],
    products: [],
    branchProducts: [],
    promotions: [],
    carts: [],
    auditLogs: [],
    announcements: [],
    supportTickets: [],
    shoppingLists: [],
    loyaltyTransactions: [],
    loyaltySettings: createDefaultLoyaltySettings(),
    loyaltyLedger: [],
    loyaltyBalances: {},
    rewards: createSeedRewards(),
    rewardRedemptions: [],
    favourites: {},
  };
}

const LEGACY_DEMO_USER_IDS = new Set([
  'usr_admin',
  'usr_owner_naivas',
  'usr_staff_westlands',
  'usr_staff_kilimani',
  'usr_manager_westlands',
  'usr_owner_quickmart',
  'usr_staff_cbd',
  'usr_shopper',
]);

const LEGACY_DEMO_SUPERMARKET_IDS = new Set(['sm_naivas', 'sm_quickmart']);
const LEGACY_DEMO_BRANCH_IDS = new Set(['br_westlands', 'br_kilimani', 'br_cbd', 'br_mombasa']);
const LEGACY_DEMO_CART_IDS = new Set(['cart_demo_1', 'cart_past_1', 'cart_past_2']);
const LEGACY_DEMO_PROMO_IDS = new Set(['promo_milk_discount', 'promo_flour_bundle', 'promo_juice_fixed']);
const LEGACY_DEMO_LIST_IDS = new Set(['list_weekend_family']);
const LEGACY_DEMO_ANNOUNCEMENT_IDS = new Set(['anc_1', 'anc_2']);
const LEGACY_DEMO_TICKET_IDS = new Set(['tkt_1', 'tkt_2', 'tkt_3']);
const LEGACY_DEMO_LOG_IDS = new Set(['log_1', 'log_2', 'log_3']);

export class Database {
  private data: DatabaseSchema;

  constructor() {
    this.data = this.load();
  }

  private load(): DatabaseSchema {
    try {
      const dir = path.dirname(DB_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        let needsSave = false;

        if (!parsed.favourites) { parsed.favourites = {}; needsSave = true; }
        if (!parsed.shoppingLists) { parsed.shoppingLists = []; needsSave = true; }
        if (!parsed.loyaltyTransactions) { parsed.loyaltyTransactions = []; needsSave = true; }
        if (!parsed.loyaltySettings) {
          parsed.loyaltySettings = createDefaultLoyaltySettings();
          needsSave = true;
        }
        if (!Array.isArray(parsed.loyaltyLedger)) {
          parsed.loyaltyLedger = [];
          needsSave = true;
        }
        if (!parsed.loyaltyBalances || typeof parsed.loyaltyBalances !== 'object') {
          parsed.loyaltyBalances = {};
          needsSave = true;
        }
        if (!Array.isArray(parsed.rewards) || parsed.rewards.length === 0) {
          parsed.rewards = createSeedRewards();
          needsSave = true;
        }
        if (!Array.isArray(parsed.rewardRedemptions)) {
          parsed.rewardRedemptions = [];
          needsSave = true;
        }
        if (parsed.loyaltyCards !== undefined) {
          delete parsed.loyaltyCards;
          needsSave = true;
        }
        if (!parsed.resetCodes) {
          parsed.resetCodes = {};
        } else {
          // Strip any legacy plaintext reset code/token records on load
          for (const key of Object.keys(parsed.resetCodes)) {
            const rec = parsed.resetCodes[key];
            if (!rec || (!rec.codeHash && !rec.tokenHash) || rec.code !== undefined || rec.token !== undefined) {
              delete parsed.resetCodes[key];
              needsSave = true;
            }
          }
        }
        if (!Array.isArray(parsed.aiUsageLogs)) {
          parsed.aiUsageLogs = [];
          needsSave = true;
        }
        if (!parsed.passwords) parsed.passwords = {};

        // Purge legacy demo users & hardcoded seed admin
        if (Array.isArray(parsed.users)) {
          const before = parsed.users.length;
          parsed.users = parsed.users.filter(
            (u: any) => !LEGACY_DEMO_USER_IDS.has(u.id) && u.email !== 'admin@smartcart.com'
          );
          if (parsed.users.length !== before) needsSave = true;
        }
        if (parsed.passwords) {
          for (const id of LEGACY_DEMO_USER_IDS) {
            if (parsed.passwords[id]) {
              delete parsed.passwords[id];
              needsSave = true;
            }
          }
        }

        // Enforce strictly at most ONE system admin
        const adminUsers = (parsed.users || []).filter((u: any) => u.role === 'admin');
        if (adminUsers.length > 1) {
          const primaryAdmin = adminUsers.find((u: any) => u.isPermanentAdmin) || adminUsers[0];
          parsed.users = parsed.users.filter((u: any) => u.role !== 'admin' || u.id === primaryAdmin.id);
          needsSave = true;
        }

        // Purge legacy demo entities if present from an older DB file
        const filterOut = (key: keyof DatabaseSchema, ids: Set<string>) => {
          const arr = parsed[key];
          if (Array.isArray(arr)) {
            const before = arr.length;
            parsed[key] = arr.filter((item: any) => !ids.has(item.id));
            if (parsed[key].length !== before) needsSave = true;
          }
        };

        filterOut('supermarkets', LEGACY_DEMO_SUPERMARKET_IDS);
        filterOut('branches', LEGACY_DEMO_BRANCH_IDS);
        filterOut('carts', LEGACY_DEMO_CART_IDS);
        filterOut('promotions', LEGACY_DEMO_PROMO_IDS);
        filterOut('shoppingLists', LEGACY_DEMO_LIST_IDS);
        filterOut('announcements', LEGACY_DEMO_ANNOUNCEMENT_IDS);
        filterOut('supportTickets', LEGACY_DEMO_TICKET_IDS);
        filterOut('auditLogs', LEGACY_DEMO_LOG_IDS);

        if (Array.isArray(parsed.products)) {
          const before = parsed.products.length;
          parsed.products = parsed.products.filter(
            (p: any) => !LEGACY_DEMO_SUPERMARKET_IDS.has(p.supermarketId)
          );
          if (parsed.products.length !== before) needsSave = true;
        }
        if (Array.isArray(parsed.branchProducts)) {
          const before = parsed.branchProducts.length;
          parsed.branchProducts = parsed.branchProducts.filter(
            (bp: any) => !LEGACY_DEMO_BRANCH_IDS.has(bp.branchId)
          );
          if (parsed.branchProducts.length !== before) needsSave = true;
        }
        if (parsed.favourites && parsed.favourites['usr_shopper']) {
          delete parsed.favourites['usr_shopper'];
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
      const dir = path.dirname(DB_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tempFile = `${DB_FILE}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tempFile, DB_FILE);
    } catch (e) {
      console.error('Failed to save DB file atomically:', e);
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
