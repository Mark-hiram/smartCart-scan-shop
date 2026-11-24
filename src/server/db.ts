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
  LoyaltyCard,
} from '../types';

const DB_FILE = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.resolve(process.cwd(), 'smartcart_db.json');

export interface ResetCodeRecord {
  code?: string;
  token?: string;
  identifier?: string;
  email?: string;
  expiresAt: number;
  failedAttempts?: number;
  used?: boolean;
}

export interface DatabaseSchema {
  users: User[];
  passwords: Record<string, { hash: string; salt: string }>; // userId -> hash, salt
  resetCodes: Record<string, ResetCodeRecord>; // identifier/tokenKey -> reset code record
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
  loyaltyCards: LoyaltyCard[];
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

export function createInitialDatabase(): DatabaseSchema {
  return {
    users: [],
    passwords: {},
    resetCodes: {},
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
    loyaltyCards: [],
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
        if (!parsed.favourites) parsed.favourites = {};
        if (!parsed.shoppingLists) parsed.shoppingLists = [];
        if (!parsed.loyaltyCards) parsed.loyaltyCards = [];
        if (!parsed.resetCodes) parsed.resetCodes = {};
        if (!parsed.passwords) parsed.passwords = {};

        let needsSave = false;

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
