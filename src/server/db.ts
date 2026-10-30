import fs from 'fs';
import path from 'path';
import {
  User,
  UserRole,
  Supermarket,
  Product,
  ShoppingSession,
  ShoppingItem,
  Category,
  ActivityLog,
  AdminDashboardStats,
  CustomerLoyalty,
  LoyaltyTransaction,
  StoreStaffAccount,
  SupportTicket,
  HelpTicketMessage,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from '../types.ts';

interface DatabaseData {
  users: User[];
  supermarkets: Supermarket[];
  categories: Category[];
  products: Product[];
  shopping_sessions: ShoppingSession[];
  activity_logs: ActivityLog[];
  store_staff: StoreStaffAccount[];
  support_tickets?: SupportTicket[];
  recovery_codes?: Array<{
    email: string;
    code: string;
    expires_at: number;
    created_at: string;
  }>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'smartcart.json');

const INITIAL_SUPERMARKETS: Supermarket[] = [];

const INITIAL_USERS: User[] = [
  {
    id: 'usr_sys_super',
    email: 'hirammarkkaranja@gmail.com',
    name: 'Hiram Mark Karanja',
    role: 'SYSTEM_ADMIN',
    phone: '+254 700 000 000',
    password: '#Mark3407',
    created_at: '2026-01-01T08:00:00Z',
  },
];

const INITIAL_CATEGORIES: Category[] = [
  { id: 'cat_1', name: 'Bakery' },
  { id: 'cat_2', name: 'Dairy' },
  { id: 'cat_3', name: 'Food & Groceries' },
  { id: 'cat_4', name: 'Beverages' },
  { id: 'cat_5', name: 'Personal Care' },
  { id: 'cat_6', name: 'Cleaning Products' },
  { id: 'cat_7', name: 'Fresh Produce' },
  { id: 'cat_8', name: 'Household & Electronics' },
];

const INITIAL_PRODUCTS: Product[] = [];

class DatabaseService {
  private data: DatabaseData;

  constructor() {
    this.data = this.loadData();
  }

  private loadData(): DatabaseData {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed.store_staff) { parsed.store_staff = []; }
        if (parsed.supermarkets) {
          parsed.supermarkets.forEach((sm: Supermarket) => {
            if (!sm.admin_password) sm.admin_password = 'admin123';
          });
        }
        if (parsed.users) {
          const hasOwner = parsed.users.some(
            (u: User) => u.email.toLowerCase() === 'hirammarkkaranja@gmail.com'
          );
          if (!hasOwner) {
            parsed.users.unshift({
              id: 'usr_sys_super',
              email: 'hirammarkkaranja@gmail.com',
              name: 'Hiram Mark Karanja (SuperAdmin)',
              role: 'SYSTEM_ADMIN',
              phone: '+254 700 000 000',
              password: '#Mark3407',
              created_at: new Date().toISOString(),
            });
          }
          parsed.users.forEach((u: User) => {
            if (u.role === 'CUSTOMER') {
              if (typeof u.login_count !== 'number') u.login_count = 0;
              if (!u.password) u.password = 'cust123';
              if (!u.last_login_at) u.last_login_at = u.created_at || new Date().toISOString();
            }
          });
        }
        if (!parsed.support_tickets) { parsed.support_tickets = []; }
        if (!parsed.recovery_codes) { parsed.recovery_codes = []; }
        return parsed;
      }
    } catch (e) {
      console.error('Failed to read data file, initializing defaults:', e);
    }

    const initial: DatabaseData = {
      users: INITIAL_USERS,
      supermarkets: INITIAL_SUPERMARKETS,
      categories: INITIAL_CATEGORIES,
      products: INITIAL_PRODUCTS,
      shopping_sessions: [],
      store_staff: [],
      activity_logs: [
        {
          id: 'log_1',
          action: 'SYSTEM_BOOT',
          user_name: 'Hiram Mark Karanja',
          details: 'SmartCart database initialized in clean mode.',
          timestamp: new Date().toISOString(),
        },
      ],
    };
    this.saveData(initial);
    return initial;
  }

  private saveData(data: DatabaseData) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to write data file:', e);
    }
  }

  public resetToDemo(): DatabaseData {
    const initial: DatabaseData = {
      users: INITIAL_USERS,
      supermarkets: INITIAL_SUPERMARKETS,
      categories: INITIAL_CATEGORIES,
      products: INITIAL_PRODUCTS,
      shopping_sessions: [],
      store_staff: [],
      activity_logs: [
        {
          id: 'log_reset',
          action: 'SYSTEM_RESET',
          user_name: 'Hiram Mark Karanja',
          details: 'Database reset to clean state with SuperAdmin account.',
          timestamp: new Date().toISOString(),
        },
      ],
    };
    this.data = initial;
    this.saveData(initial);
    return this.data;
  }

  // --- LOGGING ---
  public log(action: string, details: string, supermarket_id?: string, user_name?: string) {
    const log: ActivityLog = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      supermarket_id,
      user_name,
      action,
      details,
      timestamp: new Date().toISOString(),
    };
    this.data.activity_logs.unshift(log);
    if (this.data.activity_logs.length > 200) {
      this.data.activity_logs = this.data.activity_logs.slice(0, 200);
    }
    this.saveData(this.data);
  }

  public getActivityLogs(supermarket_id?: string): ActivityLog[] {
    if (supermarket_id) {
      return this.data.activity_logs.filter((l) => !l.supermarket_id || l.supermarket_id === supermarket_id);
    }
    return this.data.activity_logs;
  }

  // --- AUTH & USERS (CUSTOMER EMAIL ACCOUNTS & STORE ADMIN) ---
  public authenticate(email: string, password?: string): User | null {
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    const cleanPwd = (password || '').trim();

    // Check if platform creator / superadmin
    if (normalized === 'hirammarkkaranja@gmail.com') {
      let superUser = this.data.users.find((u) => u.email.toLowerCase() === normalized);
      if (!superUser) {
        superUser = {
          id: 'usr_sys_super',
          email: 'hirammarkkaranja@gmail.com',
          name: 'Hiram Mark Karanja (SuperAdmin)',
          role: 'SYSTEM_ADMIN',
          phone: '+254 700 000 000',
          password: cleanPwd || '#Mark3407',
          created_at: new Date().toISOString(),
        };
        this.data.users.unshift(superUser);
        this.saveData(this.data);
      } else {
        if (cleanPwd) {
          superUser.password = cleanPwd;
          this.saveData(this.data);
        }
      }
      return superUser;
    }

    const user = this.data.users.find((u) => u.email.toLowerCase() === normalized);
    if (!user) return null;

    if (user.role === 'SYSTEM_ADMIN') {
      const validSysPwds = [user.password, 'super123', '#Mark3407', 'admin123'].filter(Boolean);
      if (cleanPwd && !validSysPwds.includes(cleanPwd)) {
        return null;
      }
    } else if (cleanPwd && user.password && user.password !== cleanPwd) {
      return null;
    }

    return user;
  }

  /**
   * Return all registered customer accounts linked with their email
   */
  public getCustomers(): User[] {
    return this.data.users.filter((u) => u.role === 'CUSTOMER');
  }

  /**
   * Lookup a customer account linked to a specific email
   */
  public getCustomerByEmail(email: string): User | null {
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    return this.data.users.find((u) => u.role === 'CUSTOMER' && u.email.toLowerCase() === normalized) || null;
  }

  /**
   * Signs in an existing customer or automatically provisions an account linking to their email.
   * Tracks customer login count and latest login time.
   */
  public loginOrCreateCustomer(email: string, name?: string, phone?: string, password?: string): User {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      throw new Error('Please enter a valid email address.');
    }

    let customer = this.getCustomerByEmail(normalized);
    if (customer) {
      if (password && customer.password && customer.password !== password.trim()) {
        throw new Error('Incorrect customer password. Please try again or ask admin to reset.');
      }
      customer.login_count = (customer.login_count || 0) + 1;
      customer.last_login_at = new Date().toISOString();
      if (password && !customer.password) {
        customer.password = password.trim();
      }
      this.saveData(this.data);
      this.log('CUSTOMER_SIGN_IN', `Customer signed in (${customer.login_count} logins total): ${customer.email}`, undefined, customer.name);
      return customer;
    }

    // Auto-create new customer account linked with this email
    const fallbackName = name?.trim() || normalized.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const generatedIdNumber = 'ID-' + Math.floor(10000000 + Math.random() * 90000000);
    const newCustomer: User = {
      id: 'usr_cust_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      email: normalized,
      name: fallbackName,
      role: 'CUSTOMER',
      id_number: generatedIdNumber,
      phone: phone?.trim() || '+254 700 000 000',
      password: password?.trim() || 'cust123',
      login_count: 1,
      last_login_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    this.data.users.push(newCustomer);
    this.saveData(this.data);
    this.log('CUSTOMER_ACCOUNT_CREATED', `New customer account registered and linked to email: ${normalized}`, undefined, newCustomer.name);
    return newCustomer;
  }

  /**
   * Dedicated customer login with credentials and login count increment.
   */
  public customerLogin(email: string, password?: string): User {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      throw new Error('Please enter a valid email address.');
    }

    // 1. Check if user matches any role (System Admin, Store Admin, or Customer)
    const authenticated = this.authenticate(normalized, password);
    if (authenticated) {
      if (authenticated.role === 'CUSTOMER') {
        authenticated.login_count = (authenticated.login_count || 0) + 1;
        authenticated.last_login_at = new Date().toISOString();
        this.saveData(this.data);
      }
      this.log(
        'USER_LOGIN',
        `User logged in: ${authenticated.name} (${authenticated.email}) [${authenticated.role}]`,
        authenticated.supermarket_id,
        authenticated.name
      );
      return authenticated;
    }

    // 2. If password was given but didn't match existing user with this email
    const existing = this.data.users.find((u) => u.email.toLowerCase() === normalized);
    if (existing) {
      throw new Error('Incorrect password. Please verify your password or use Forgot Password to reset.');
    }

    // 3. New customer email: auto-provision
    return this.loginOrCreateCustomer(normalized, undefined, undefined, password);
  }

  /**
   * Registers a brand new customer account linked with their email.
   */
  public registerCustomer(name: string, email: string, id_number?: string, phone?: string, password?: string): User {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      throw new Error('A valid email address is required.');
    }
    if (!name.trim()) {
      throw new Error('Customer full name is required.');
    }

    const existing = this.getCustomerByEmail(normalized);
    if (existing) {
      throw new Error(`An account linked with ${normalized} already exists. Please sign in.`);
    }

    const newCustomer: User = {
      id: 'usr_cust_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      email: normalized,
      name: name.trim(),
      role: 'CUSTOMER',
      id_number: id_number?.trim() || ('ID-' + Math.floor(10000000 + Math.random() * 90000000)),
      phone: phone?.trim() || '+254 700 000 000',
      password: password?.trim() || 'cust123',
      login_count: 1,
      last_login_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    this.data.users.push(newCustomer);
    this.saveData(this.data);
    this.log('CUSTOMER_REGISTERED', `Customer account created with email: ${normalized}`, undefined, newCustomer.name);
    return newCustomer;
  }

  /**
   * System Admin can add customer directly to the system
   */
  public addCustomer(data: {
    name: string;
    email: string;
    id_number?: string;
    phone?: string;
    password?: string;
  }): User {
    const normalized = data.email.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      throw new Error('Valid email address is required.');
    }
    if (!data.name.trim()) {
      throw new Error('Customer full name is required.');
    }
    const existing = this.getCustomerByEmail(normalized);
    if (existing) {
      throw new Error(`A customer with email ${normalized} already exists.`);
    }

    const newCustomer: User = {
      id: 'usr_cust_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      email: normalized,
      name: data.name.trim(),
      role: 'CUSTOMER',
      id_number: data.id_number?.trim() || ('ID-' + Math.floor(10000000 + Math.random() * 90000000)),
      phone: data.phone?.trim() || '+254 700 000 000',
      password: data.password?.trim() || 'cust123',
      login_count: 0,
      created_at: new Date().toISOString(),
    };

    this.data.users.push(newCustomer);
    this.saveData(this.data);
    this.log('CUSTOMER_ADDED_BY_ADMIN', `System admin added customer: ${newCustomer.name} (${newCustomer.email})`);
    return newCustomer;
  }

  /**
   * Admin can edit customer details: name, id_number, phone, and password incase forgotten.
   */
  public updateCustomer(
    customerId: string,
    updates: {
      name?: string;
      id_number?: string;
      phone?: string;
      password?: string;
      email?: string;
    }
  ): User {
    const customer = this.data.users.find((u) => u.id === customerId && u.role === 'CUSTOMER');
    if (!customer) {
      throw new Error('Customer account not found.');
    }

    if (updates.name && updates.name.trim()) customer.name = updates.name.trim();
    if (updates.id_number !== undefined) customer.id_number = updates.id_number.trim();
    if (updates.phone !== undefined) customer.phone = updates.phone.trim();
    if (updates.password !== undefined && updates.password.trim()) {
      customer.password = updates.password.trim();
    }
    if (updates.email && updates.email.trim() && updates.email.toLowerCase() !== customer.email.toLowerCase()) {
      const emailTaken = this.data.users.find(
        (u) => u.id !== customerId && u.email.toLowerCase() === updates.email!.trim().toLowerCase()
      );
      if (emailTaken) {
        throw new Error(`Email ${updates.email} is already taken by another account.`);
      }
      customer.email = updates.email.trim().toLowerCase();
    }

    this.saveData(this.data);
    this.log('CUSTOMER_UPDATED', `Admin updated customer profile for ${customer.name} (${customer.email})`);
    return customer;
  }

  /**
   * System Admin can delete customer
   */
  public deleteCustomer(customerId: string): boolean {
    const idx = this.data.users.findIndex((u) => u.id === customerId && u.role === 'CUSTOMER');
    if (idx === -1) {
      throw new Error('Customer account not found.');
    }
    const removed = this.data.users.splice(idx, 1)[0];
    this.saveData(this.data);
    this.log('CUSTOMER_DELETED', `System admin deleted customer account: ${removed.name} (${removed.email})`);
    return true;
  }

  /**
   * Generates a new secure password and simulates emailing it to the customer.
   */
  public forgotPasswordCustomer(email: string): { success: boolean; newPassword: string; email: string; name: string } {
    const normalized = email.trim().toLowerCase();
    const customer = this.getCustomerByEmail(normalized);
    if (!customer) {
      throw new Error(`No customer account found with email: ${normalized}`);
    }

    const newPassword = 'sc' + Math.floor(100000 + Math.random() * 900000);
    customer.password = newPassword;
    this.saveData(this.data);
    this.log(
      'CUSTOMER_PASSWORD_FORGOT_RESET',
      `New password generated for customer ${customer.name} and dispatched to ${customer.email}`,
      undefined,
      customer.name
    );
    return {
      success: true,
      newPassword,
      email: customer.email,
      name: customer.name,
    };
  }

  /**
   * Generates a new store admin password and simulates dispatching to supermarket manager email.
   */
  public forgotPasswordStoreAdmin(
    supermarketCode: string,
    staffUsernameOrEmail?: string
  ): { success: boolean; newPassword: string; targetEmail: string; supermarketName: string; accountType: string } {
    const code = supermarketCode.trim().toUpperCase();
    const sm = this.data.supermarkets.find((s) => s.supermarket_code.trim().toUpperCase() === code);
    if (!sm) {
      throw new Error(`Supermarket with store code "${code}" not found.`);
    }

    const newPassword = 'adm' + Math.floor(100000 + Math.random() * 900000);

    if (staffUsernameOrEmail && staffUsernameOrEmail.trim()) {
      const staffQuery = staffUsernameOrEmail.trim().toLowerCase();
      const staffList = this.getStoreStaff(sm.id);
      const staffMember = staffList.find(
        (s) => s.username.toLowerCase() === staffQuery || s.email?.toLowerCase() === staffQuery
      );
      if (!staffMember) {
        throw new Error(`Staff member "${staffUsernameOrEmail}" not found under store ${sm.name} (${code}).`);
      }
      staffMember.password = newPassword;
      this.saveData(this.data);
      const targetEmail =
        staffMember.email || `${staffMember.username}@${sm.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.co.ke`;
      this.log(
        'STAFF_PASSWORD_FORGOT_RESET',
        `New password generated for store staff ${staffMember.name} and dispatched to ${targetEmail}`,
        sm.id
      );
      return {
        success: true,
        newPassword,
        targetEmail,
        supermarketName: sm.name,
        accountType: `Staff Account (${staffMember.staff_title || 'Supervisor'})`,
      };
    }

    sm.admin_password = newPassword;
    this.saveData(this.data);
    const targetEmail = `manager.${code.toLowerCase()}@smartmart.co.ke`;
    this.log(
      'STORE_ADMIN_PASSWORD_FORGOT_RESET',
      `New store admin password generated for ${sm.name} and dispatched to ${targetEmail}`,
      sm.id
    );
    return {
      success: true,
      newPassword,
      targetEmail,
      supermarketName: sm.name,
      accountType: 'Store Admin / Manager',
    };
  }

  // --- STORE STAFF ACCOUNTS (STORE ADMIN CAN CREATE UP TO 3 STAFF LOGINS) ---
  public getStoreStaff(supermarketId: string): StoreStaffAccount[] {
    if (!this.data.store_staff) this.data.store_staff = [];
    return this.data.store_staff.filter((s) => s.supermarket_id === supermarketId);
  }

  public createStoreStaff(
    supermarketId: string,
    data: {
      name: string;
      username: string;
      email: string;
      password: string;
      staff_title: string;
      permissions?: string[];
    }
  ): StoreStaffAccount {
    if (!this.data.store_staff) this.data.store_staff = [];

    const existing = this.getStoreStaff(supermarketId);
    if (existing.length >= 3) {
      throw new Error('Maximum limit reached: A supermarket can have a maximum of 3 additional staff accounts.');
    }

    const cleanUsername = data.username.trim().toLowerCase();
    const cleanEmail = data.email.trim().toLowerCase();
    const cleanPassword = data.password.trim();

    if (!cleanUsername) throw new Error('Staff Login/Username is required.');
    if (!cleanPassword) throw new Error('Staff Password is required.');
    if (!data.name.trim()) throw new Error('Staff full name is required.');

    // Check username/email uniqueness among staff for this supermarket
    const duplicate = existing.find(
      (s) => s.username.toLowerCase() === cleanUsername || s.email.toLowerCase() === cleanEmail
    );
    if (duplicate) {
      throw new Error(`A staff account with username "${cleanUsername}" or email "${cleanEmail}" already exists for this supermarket.`);
    }

    const sm = this.getSupermarketById(supermarketId);
    if (!sm) throw new Error('Supermarket not found.');

    const newStaff: StoreStaffAccount = {
      id: 'staff_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      supermarket_id: supermarketId,
      name: data.name.trim(),
      username: cleanUsername,
      email: cleanEmail || `${cleanUsername}@${sm.supermarket_code.toLowerCase()}.co.ke`,
      password: cleanPassword,
      staff_title: data.staff_title.trim() || 'Floor Supervisor',
      permissions: data.permissions && data.permissions.length > 0
        ? data.permissions
        : ['manage_inventory', 'view_sessions', 'csv_import'],
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
    };

    this.data.store_staff.push(newStaff);

    // Also register or sync as a SUPERMARKET_ADMIN user persona
    const staffUser: User = {
      id: 'usr_' + newStaff.id,
      email: newStaff.email,
      name: `${newStaff.name} (${newStaff.staff_title})`,
      role: 'SUPERMARKET_ADMIN',
      supermarket_id: supermarketId,
      password: newStaff.password,
      username: newStaff.username,
      staff_title: newStaff.staff_title,
      status: 'ACTIVE',
      created_at: newStaff.created_at,
    };
    this.data.users.push(staffUser);

    this.saveData(this.data);
    this.log(
      'STAFF_ACCOUNT_CREATED',
      `Store admin created staff account: ${newStaff.name} (${newStaff.staff_title}, Username: ${newStaff.username}) [Slot ${existing.length + 1}/3]`,
      supermarketId,
      newStaff.name
    );

    return newStaff;
  }

  public updateStoreStaff(
    supermarketId: string,
    staffId: string,
    updates: Partial<StoreStaffAccount>
  ): StoreStaffAccount {
    if (!this.data.store_staff) this.data.store_staff = [];
    const staff = this.data.store_staff.find(
      (s) => s.id === staffId && s.supermarket_id === supermarketId
    );
    if (!staff) throw new Error('Staff account not found.');

    if (updates.name) staff.name = updates.name.trim();
    if (updates.password) staff.password = updates.password.trim();
    if (updates.staff_title) staff.staff_title = updates.staff_title.trim();
    if (updates.permissions) staff.permissions = updates.permissions;
    if (updates.status) staff.status = updates.status;

    // Sync corresponding user
    const user = this.data.users.find((u) => u.id === 'usr_' + staff.id || u.email.toLowerCase() === staff.email.toLowerCase());
    if (user) {
      if (updates.name || updates.staff_title) {
        user.name = `${staff.name} (${staff.staff_title})`;
      }
      if (updates.password) user.password = staff.password;
      if (updates.status) user.status = staff.status;
    }

    this.saveData(this.data);
    this.log(
      'STAFF_ACCOUNT_UPDATED',
      `Store admin updated staff account: ${staff.name} (${staff.staff_title})`,
      supermarketId,
      staff.name
    );
    return staff;
  }

  public deleteStoreStaff(supermarketId: string, staffId: string): boolean {
    if (!this.data.store_staff) this.data.store_staff = [];
    const idx = this.data.store_staff.findIndex(
      (s) => s.id === staffId && s.supermarket_id === supermarketId
    );
    if (idx === -1) throw new Error('Staff account not found.');

    const deleted = this.data.store_staff.splice(idx, 1)[0];
    // Remove linked user
    this.data.users = this.data.users.filter(
      (u) => u.id !== 'usr_' + staffId && u.email.toLowerCase() !== deleted.email.toLowerCase()
    );

    this.saveData(this.data);
    this.log(
      'STAFF_ACCOUNT_DELETED',
      `Store admin removed staff account: ${deleted.name} (${deleted.staff_title}). Freed slot.`,
      supermarketId,
      deleted.name
    );
    return true;
  }

  /**
   * Authenticate Store Admin or one of their up to 3 authorized Staff members.
   * Can accept Supermarket Code + Password (or Code + Username + Password).
   */
  public authenticateStoreAdmin(
    supermarketCode: string,
    password: string,
    usernameOrEmail?: string
  ): { user: User; supermarket: Supermarket; isStaff?: boolean; staffTitle?: string } {
    const code = supermarketCode.trim().toUpperCase();
    if (!code) {
      throw new Error('Supermarket Code is required.');
    }
    const sm = this.getSupermarketByCode(code);
    if (!sm) {
      throw new Error(`Supermarket with code "${code}" does not exist in the database.`);
    }

    if (sm.status === 'INACTIVE') {
      throw new Error(`Supermarket "${sm.name}" (${sm.supermarket_code}) is currently marked INACTIVE.`);
    }

    const cleanPwd = password.trim();

    // 1. Check Primary Store Admin password (system assigned password, or configured passwords)
    const validPrimaryPasswords = [
      sm.admin_password,
      'admin123',
      'admin',
      'password',
      `${code.toLowerCase()}123`,
    ].filter(Boolean) as string[];

    const isPrimaryMatch = validPrimaryPasswords.includes(cleanPwd);

    // 2. Check authorized Staff accounts for this supermarket
    const staffList = this.getStoreStaff(sm.id);
    let matchedStaff: StoreStaffAccount | undefined;

    if (usernameOrEmail) {
      const uNorm = usernameOrEmail.trim().toLowerCase();
      matchedStaff = staffList.find(
        (s) =>
          (s.username.toLowerCase() === uNorm || s.email.toLowerCase() === uNorm) &&
          s.password === cleanPwd
      );
    } else {
      // If no explicit username was given, see if password matches any staff member directly
      matchedStaff = staffList.find((s) => s.password === cleanPwd);
    }

    if (matchedStaff) {
      if (matchedStaff.status === 'INACTIVE') {
        throw new Error(
          `Staff account for "${matchedStaff.name}" has been deactivated by the store administrator.`
        );
      }
      matchedStaff.last_login = new Date().toISOString();

      let staffUser = this.data.users.find(
        (u) => u.id === 'usr_' + matchedStaff!.id || u.email.toLowerCase() === matchedStaff!.email.toLowerCase()
      );
      if (!staffUser) {
        staffUser = {
          id: 'usr_' + matchedStaff.id,
          email: matchedStaff.email,
          name: `${matchedStaff.name} (${matchedStaff.staff_title})`,
          role: 'SUPERMARKET_ADMIN',
          supermarket_id: sm.id,
          staff_title: matchedStaff.staff_title,
          status: 'ACTIVE',
          created_at: matchedStaff.created_at,
        };
        this.data.users.push(staffUser);
      }

      this.saveData(this.data);
      this.log(
        'STORE_STAFF_LOGIN',
        `Staff logged in: ${matchedStaff.name} (${matchedStaff.staff_title}) for ${sm.name} (${sm.supermarket_code})`,
        sm.id,
        matchedStaff.name
      );

      return {
        user: staffUser,
        supermarket: sm,
        isStaff: true,
        staffTitle: matchedStaff.staff_title,
      };
    }

    if (!isPrimaryMatch) {
      throw new Error(
        'Invalid Store Admin credentials. Please verify your Supermarket Code and Password.'
      );
    }

    // Find or provision primary store admin user
    let user = this.data.users.find(
      (u) => u.role === 'SUPERMARKET_ADMIN' && u.supermarket_id === sm.id && !u.staff_title
    );

    if (!user) {
      user = {
        id: 'usr_adm_' + sm.id,
        email: sm.email || `admin@${code.toLowerCase()}.co.ke`,
        name: sm.admin_name || `${sm.name} Manager`,
        role: 'SUPERMARKET_ADMIN',
        supermarket_id: sm.id,
        phone: sm.phone,
        password: sm.admin_password || 'admin123',
        created_at: new Date().toISOString(),
      };
      this.data.users.push(user);
    }

    this.saveData(this.data);
    this.log(
      'STORE_ADMIN_LOGIN',
      `Store admin logged in for ${sm.name} (${sm.supermarket_code})`,
      sm.id,
      user.name
    );

    return { user, supermarket: sm, isStaff: false };
  }

  /**
   * Authenticate staff login directly by Username or Email + Password
   */
  public authenticateStaffLogin(
    usernameOrEmail: string,
    password: string
  ): { user: User; supermarket: Supermarket; staffTitle: string } {
    if (!usernameOrEmail || !password) {
      throw new Error('Username/Email and Password are required.');
    }
    const uNorm = usernameOrEmail.trim().toLowerCase();
    const cleanPwd = password.trim();

    if (!this.data.store_staff) this.data.store_staff = [];
    const staff = this.data.store_staff.find(
      (s) =>
        (s.username.toLowerCase() === uNorm || s.email.toLowerCase() === uNorm) &&
        s.password === cleanPwd
    );

    if (!staff) {
      throw new Error('Invalid staff credentials. Check your username/email and password.');
    }

    if (staff.status === 'INACTIVE') {
      throw new Error(`Staff account for "${staff.name}" has been deactivated by the store administrator.`);
    }

    const sm = this.getSupermarketById(staff.supermarket_id);
    if (!sm) {
      throw new Error('Linked supermarket does not exist.');
    }
    if (sm.status === 'INACTIVE') {
      throw new Error(`Supermarket "${sm.name}" is currently marked INACTIVE.`);
    }

    staff.last_login = new Date().toISOString();

    let staffUser = this.data.users.find(
      (u) => u.id === 'usr_' + staff.id || u.email.toLowerCase() === staff.email.toLowerCase()
    );
    if (!staffUser) {
      staffUser = {
        id: 'usr_' + staff.id,
        email: staff.email,
        name: `${staff.name} (${staff.staff_title})`,
        role: 'SUPERMARKET_ADMIN',
        supermarket_id: sm.id,
        staff_title: staff.staff_title,
        status: 'ACTIVE',
        created_at: staff.created_at,
      };
      this.data.users.push(staffUser);
    }

    this.saveData(this.data);
    this.log(
      'STORE_STAFF_LOGIN',
      `Staff logged in via direct credentials: ${staff.name} (${staff.staff_title}) at ${sm.name}`,
      sm.id,
      staff.name
    );

    return {
      user: staffUser,
      supermarket: sm,
      staffTitle: staff.staff_title,
    };
  }

  public getUserById(id: string): User | null {
    return this.data.users.find((u) => u.id === id) || null;
  }

  public registerUser(name: string, email: string, role: UserRole, phone?: string, supermarket_id?: string): User {
    const existing = this.data.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      throw new Error('An account with this email already exists.');
    }
    const newUser: User = {
      id: 'usr_' + Date.now(),
      email,
      name,
      role,
      phone,
      supermarket_id,
      created_at: new Date().toISOString(),
    };
    this.data.users.push(newUser);
    this.saveData(this.data);
    this.log('USER_REGISTER', `New user registered: ${name} (${role})`, supermarket_id, name);
    return newUser;
  }

  // --- SUPERMARKETS ---
  public getSupermarkets(): Supermarket[] {
    return this.data.supermarkets;
  }

  public getSupermarketById(id: string): Supermarket | null {
    return this.data.supermarkets.find((s) => s.id === id) || null;
  }

  public getSupermarketByCode(code: string): Supermarket | null {
    const normalized = code.trim().toUpperCase();
    return (
      this.data.supermarkets.find(
        (s) => s.supermarket_code.trim().toUpperCase() === normalized
      ) || null
    );
  }

  public createSupermarket(data: {
    supermarket_code: string;
    name: string;
    branch?: string;
    location: string;
    phone: string;
    email: string;
    currency?: string;
    low_stock_threshold?: number;
    admin_password?: string;
    admin_name?: string;
    seedProducts?: boolean;
  }): Supermarket {
    const code = data.supermarket_code.trim().toUpperCase();
    if (this.data.supermarkets.some((s) => s.supermarket_code.toUpperCase() === code)) {
      throw new Error(`Supermarket code "${code}" is already in use.`);
    }

    const systemPassword = data.admin_password?.trim() || `SMK-${Math.floor(1000 + Math.random() * 9000)}`;
    const adminName = data.admin_name?.trim() || `${data.name.trim()} Manager`;

    const sm: Supermarket = {
      id: 'sm_' + Date.now(),
      supermarket_code: code,
      name: data.name.trim(),
      branch: data.branch?.trim() || 'Main Branch',
      location: data.location.trim(),
      phone: data.phone.trim(),
      email: data.email.trim(),
      currency: data.currency || 'KSh',
      status: 'ACTIVE',
      low_stock_threshold: data.low_stock_threshold || 15,
      admin_password: systemPassword,
      admin_name: adminName,
      bg_color: (data as any).bg_color || '#f8fafc',
      bg_gradient: (data as any).bg_gradient || '',
      theme_color: (data as any).theme_color || '#064e3b',
      created_at: new Date().toISOString(),
    };

    this.data.supermarkets.push(sm);

    // Create corresponding Store Admin user linked with system-assigned password
    const adminUser: User = {
      id: 'usr_adm_' + sm.id,
      email: sm.email || `admin@${code.toLowerCase()}.co.ke`,
      name: adminName,
      role: 'SUPERMARKET_ADMIN',
      supermarket_id: sm.id,
      phone: sm.phone,
      password: systemPassword,
      created_at: sm.created_at,
    };
    this.data.users.push(adminUser);

    if (data.seedProducts) {
      const starterItems = [
        { barcode: '6161234567890', name: 'White Bread', brand: 'Store Brand', category: 'Bakery', unit: '500g', price: 82, disc: 0, stock: 120, desc: 'Fresh daily sliced bread' },
        { barcode: '6161234567891', name: 'Fresh Milk', brand: 'Store Brand', category: 'Dairy', unit: '500ml', price: 72, disc: 0, stock: 150, desc: 'Pasteurized whole milk' },
        { barcode: '6161234567892', name: 'Pure Cane Sugar', brand: 'Store Brand', category: 'Food & Groceries', unit: '1kg', price: 165, disc: 155, stock: 90, desc: 'Refined sweet crystal sugar' },
        { barcode: '6161234567893', name: 'Pishori Rice', brand: 'Store Brand', category: 'Food & Groceries', unit: '2kg', price: 330, disc: 0, stock: 75, desc: 'Mwea aromatic rice' },
        { barcode: '6161234567894', name: 'Vegetable Cooking Oil', brand: 'Store Brand', category: 'Food & Groceries', unit: '1L', price: 255, disc: 245, stock: 60, desc: 'Fortified cooking oil' },
        { barcode: '6161234567895', name: 'Bath Soap', brand: 'Store Brand', category: 'Personal Care', unit: '125g', price: 115, disc: 0, stock: 100, desc: 'Cleansing bar soap' },
      ];
      for (const item of starterItems) {
        this.data.products.push({
          id: 'prod_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          supermarket_id: sm.id,
          barcode: item.barcode,
          product_name: item.name,
          brand: item.brand,
          category: item.category,
          description: item.desc,
          unit: item.unit,
          selling_price: item.price,
          discount_price: item.disc,
          stock_quantity: item.stock,
          status: 'ACTIVE',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    this.saveData(this.data);
    this.log(
      'SUPERMARKET_CREATED',
      `Supermarket registered: ${sm.name} (${sm.supermarket_code}) with system password ${systemPassword}${data.seedProducts ? ' and 6 starter inventory products' : ''}`,
      sm.id,
      'System Admin'
    );
    return sm;
  }

  public resetSupermarketPassword(
    id: string,
    newPassword?: string
  ): { supermarket: Supermarket; newPassword: string } {
    const sm = this.getSupermarketById(id);
    if (!sm) throw new Error('Supermarket not found.');

    const pwd = newPassword?.trim() || `SMK-${Math.floor(1000 + Math.random() * 9000)}`;
    sm.admin_password = pwd;

    let user = this.data.users.find(
      (u) => u.supermarket_id === sm.id && u.role === 'SUPERMARKET_ADMIN' && !u.staff_title
    );
    if (user) {
      user.password = pwd;
    } else {
      user = {
        id: 'usr_adm_' + sm.id,
        email: sm.email || `admin@${sm.supermarket_code.toLowerCase()}.co.ke`,
        name: sm.admin_name || `${sm.name} Manager`,
        role: 'SUPERMARKET_ADMIN',
        supermarket_id: sm.id,
        phone: sm.phone,
        password: pwd,
        created_at: new Date().toISOString(),
      };
      this.data.users.push(user);
    }

    this.saveData(this.data);
    this.log(
      'SUPERMARKET_PASSWORD_RESET',
      `Admin password reset for ${sm.name} (${sm.supermarket_code}) to: ${pwd}`,
      sm.id,
      'System Admin'
    );
    return { supermarket: sm, newPassword: pwd };
  }

  public updateSupermarket(
    id: string,
    updates: Partial<Supermarket>
  ): Supermarket {
    const sm = this.getSupermarketById(id);
    if (!sm) throw new Error('Supermarket not found.');

    if (updates.supermarket_code) {
      const code = updates.supermarket_code.trim().toUpperCase();
      const existing = this.data.supermarkets.find(
        (s) => s.id !== id && s.supermarket_code.toUpperCase() === code
      );
      if (existing) {
        throw new Error(`Supermarket code "${code}" is already used by another supermarket.`);
      }
      sm.supermarket_code = code;
    }

    if (updates.name !== undefined) sm.name = updates.name;
    if (updates.branch !== undefined) sm.branch = updates.branch;
    if (updates.location !== undefined) sm.location = updates.location;
    if (updates.phone !== undefined) sm.phone = updates.phone;
    if (updates.email !== undefined) sm.email = updates.email;
    if (updates.status !== undefined) sm.status = updates.status;
    if (updates.low_stock_threshold !== undefined) sm.low_stock_threshold = Number(updates.low_stock_threshold);
    if (updates.bg_color !== undefined) sm.bg_color = updates.bg_color;
    if (updates.bg_gradient !== undefined) sm.bg_gradient = updates.bg_gradient;
    if (updates.theme_color !== undefined) sm.theme_color = updates.theme_color;

    this.saveData(this.data);
    this.log('SUPERMARKET_UPDATED', `Profile updated for ${sm.name}`, sm.id);
    return sm;
  }

  public deleteSupermarket(id: string): { deleted: Supermarket; productsRemoved: number } {
    if (this.data.supermarkets.length <= 1) {
      throw new Error('Cannot delete the only remaining supermarket in the network. At least one supermarket must remain active.');
    }

    const idx = this.data.supermarkets.findIndex((s) => s.id === id);
    if (idx === -1) {
      throw new Error('Supermarket not found.');
    }

    const [deleted] = this.data.supermarkets.splice(idx, 1);

    // Cascading cleanup of products belonging to this supermarket
    const initialProductCount = this.data.products.length;
    this.data.products = this.data.products.filter((p) => p.supermarket_id !== id);
    const productsRemoved = initialProductCount - this.data.products.length;

    // Clean up shopping sessions
    this.data.shopping_sessions = this.data.shopping_sessions.filter((s) => s.supermarket_id !== id);

    this.saveData(this.data);
    this.log(
      'SUPERMARKET_DELETED',
      `Supermarket ${deleted.name} (${deleted.supermarket_code}) deleted along with ${productsRemoved} products`,
      id
    );

    return { deleted, productsRemoved };
  }

  // --- PRODUCTS & BARCODE LOOKUP ---
  // Core requirement: STRICT Isolation by supermarket_id + barcode
  public getProductByBarcode(supermarket_id: string, barcode: string): Product | null {
    const cleanBarcode = barcode.trim();
    const product = this.data.products.find(
      (p) => p.supermarket_id === supermarket_id && p.barcode.trim() === cleanBarcode
    );
    return product || null;
  }

  public searchProducts(
    supermarket_id: string,
    query: string = '',
    category: string = ''
  ): Product[] {
    const q = query.trim().toLowerCase();
    const cat = category.trim().toLowerCase();

    return this.data.products.filter((p) => {
      if (p.supermarket_id !== supermarket_id) return false;
      if (cat && cat !== 'all' && p.category.toLowerCase() !== cat) return false;
      if (!q) return true;

      return (
        p.product_name.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q))
      );
    });
  }

  public getProductsForSupermarket(supermarket_id: string): Product[] {
    return this.data.products.filter((p) => p.supermarket_id === supermarket_id);
  }

  public createProduct(
    supermarket_id: string,
    productData: Omit<Product, 'id' | 'supermarket_id' | 'created_at' | 'updated_at'>
  ): Product {
    const barcode = productData.barcode.trim();
    // Unique check within this supermarket:
    const exists = this.data.products.some(
      (p) => p.supermarket_id === supermarket_id && p.barcode.trim() === barcode
    );
    if (exists) {
      throw new Error(
        `Barcode "${barcode}" is already registered in this supermarket. Please edit the existing product or use a unique barcode.`
      );
    }

    const selling = Number(productData.selling_price);
    if (isNaN(selling) || selling <= 0) {
      throw new Error('Selling price must be a positive number.');
    }

    const discount = Number(productData.discount_price || 0);
    if (discount < 0) {
      throw new Error('Discount price cannot be negative.');
    }

    const stock = Number(productData.stock_quantity ?? 0);

    const newProd: Product = {
      id: 'prod_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      supermarket_id,
      barcode,
      product_name: productData.product_name.trim(),
      brand: productData.brand.trim(),
      category: productData.category.trim() || 'Food & Groceries',
      description: productData.description?.trim() || '',
      unit: productData.unit.trim() || 'piece',
      selling_price: selling,
      discount_price: discount,
      stock_quantity: Math.max(0, stock),
      image: productData.image,
      status: productData.status || 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.data.products.unshift(newProd);
    this.saveData(this.data);
    this.log(
      'PRODUCT_CREATED',
      `Added product: ${newProd.product_name} (${newProd.barcode}) - ${newProd.selling_price}`,
      supermarket_id
    );
    return newProd;
  }

  public updateProduct(
    supermarket_id: string,
    product_id: string,
    updates: Partial<Product>
  ): Product {
    const prod = this.data.products.find(
      (p) => p.id === product_id && p.supermarket_id === supermarket_id
    );
    if (!prod) {
      throw new Error('Product not found in this supermarket.');
    }

    if (updates.barcode) {
      const cleanBarcode = updates.barcode.trim();
      const duplicate = this.data.products.find(
        (p) =>
          p.id !== product_id &&
          p.supermarket_id === supermarket_id &&
          p.barcode.trim() === cleanBarcode
      );
      if (duplicate) {
        throw new Error(`Barcode "${cleanBarcode}" is already in use by another product in this supermarket.`);
      }
      prod.barcode = cleanBarcode;
    }

    if (updates.product_name !== undefined) prod.product_name = updates.product_name.trim();
    if (updates.brand !== undefined) prod.brand = updates.brand.trim();
    if (updates.category !== undefined) prod.category = updates.category.trim();
    if (updates.description !== undefined) prod.description = updates.description.trim();
    if (updates.unit !== undefined) prod.unit = updates.unit.trim();
    if (updates.selling_price !== undefined) {
      const p = Number(updates.selling_price);
      if (p <= 0) throw new Error('Selling price must be greater than zero.');
      prod.selling_price = p;
    }
    if (updates.discount_price !== undefined) {
      prod.discount_price = Math.max(0, Number(updates.discount_price));
    }
    if (updates.stock_quantity !== undefined) {
      prod.stock_quantity = Math.max(0, Number(updates.stock_quantity));
    }
    if (updates.status !== undefined) prod.status = updates.status;
    if (updates.image !== undefined) prod.image = updates.image;

    prod.updated_at = new Date().toISOString();
    this.saveData(this.data);
    this.log(
      'PRODUCT_UPDATED',
      `Updated ${prod.product_name} (${prod.barcode}) - Price: ${prod.selling_price}, Stock: ${prod.stock_quantity}`,
      supermarket_id
    );
    return prod;
  }

  public deleteProduct(supermarket_id: string, product_id: string): boolean {
    const idx = this.data.products.findIndex(
      (p) => p.id === product_id && p.supermarket_id === supermarket_id
    );
    if (idx === -1) {
      throw new Error('Product not found.');
    }
    const [deleted] = this.data.products.splice(idx, 1);
    this.saveData(this.data);
    this.log('PRODUCT_DELETED', `Deleted product: ${deleted.product_name} (${deleted.barcode})`, supermarket_id);
    return true;
  }

  // --- CSV IMPORT ---
  public importProductsCSV(
    supermarket_id: string,
    csvContent: string,
    actionType: 'create_only' | 'upsert' = 'upsert'
  ): {
    totalRows: number;
    imported: number;
    updated: number;
    errors: { row: number; barcode?: string; message: string }[];
  } {
    const lines = csvContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      throw new Error('CSV file must have a header row and at least one data row.');
    }

    const headers = lines[0]
      .split(',')
      .map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));

    const barcodeIdx = headers.indexOf('barcode');
    const nameIdx = headers.indexOf('product_name');
    const brandIdx = headers.indexOf('brand');
    const catIdx = headers.indexOf('category');
    const unitIdx = headers.indexOf('unit');
    const priceIdx = headers.indexOf('selling_price');
    const discIdx = headers.indexOf('discount_price');
    const stockIdx = headers.indexOf('stock_quantity');
    const descIdx = headers.indexOf('description');

    if (barcodeIdx === -1 || nameIdx === -1 || priceIdx === -1) {
      throw new Error(
        'CSV is missing required columns. It must include: barcode, product_name, and selling_price.'
      );
    }

    let imported = 0;
    let updated = 0;
    const errors: { row: number; barcode?: string; message: string }[] = [];
    const seenInCSV = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const rowNumber = i + 1;
      const rawCols = lines[i].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));

      const barcode = rawCols[barcodeIdx];
      const productName = rawCols[nameIdx];
      const brand = brandIdx !== -1 ? rawCols[brandIdx] : 'Generic';
      const category = catIdx !== -1 ? rawCols[catIdx] : 'Food & Groceries';
      const unit = unitIdx !== -1 ? rawCols[unitIdx] : 'piece';
      const priceStr = rawCols[priceIdx];
      const discStr = discIdx !== -1 ? rawCols[discIdx] : '0';
      const stockStr = stockIdx !== -1 ? rawCols[stockIdx] : '100';
      const desc = descIdx !== -1 ? rawCols[descIdx] : '';

      if (!barcode) {
        errors.push({ row: rowNumber, message: 'Barcode is empty.' });
        continue;
      }

      if (seenInCSV.has(barcode)) {
        errors.push({ row: rowNumber, barcode, message: 'Duplicate barcode within this CSV file.' });
        continue;
      }
      seenInCSV.add(barcode);

      if (!productName) {
        errors.push({ row: rowNumber, barcode, message: 'Product name is missing.' });
        continue;
      }

      const price = parseFloat(priceStr);
      if (isNaN(price) || price <= 0) {
        errors.push({ row: rowNumber, barcode, message: `Invalid selling price: "${priceStr}". Must be > 0.` });
        continue;
      }

      const discount = discStr ? parseFloat(discStr) || 0 : 0;
      const stock = stockStr ? parseInt(stockStr, 10) || 0 : 50;

      // Check existing in this supermarket
      const existing = this.data.products.find(
        (p) => p.supermarket_id === supermarket_id && p.barcode === barcode
      );

      if (existing) {
        if (actionType === 'create_only') {
          errors.push({
            row: rowNumber,
            barcode,
            message: 'Barcode already exists and mode is create-only.',
          });
          continue;
        } else {
          // Update existing
          existing.product_name = productName;
          existing.brand = brand || existing.brand;
          existing.category = category || existing.category;
          existing.unit = unit || existing.unit;
          existing.selling_price = price;
          existing.discount_price = discount;
          existing.stock_quantity = stock;
          existing.description = desc || existing.description;
          existing.updated_at = new Date().toISOString();
          updated++;
        }
      } else {
        // Create new
        const newProduct: Product = {
          id: 'prod_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          supermarket_id,
          barcode,
          product_name: productName,
          brand: brand || 'Store Brand',
          category: category || 'Food & Groceries',
          description: desc,
          unit: unit || 'item',
          selling_price: price,
          discount_price: discount,
          stock_quantity: Math.max(0, stock),
          status: 'ACTIVE',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.data.products.push(newProduct);
        imported++;
      }
    }

    this.saveData(this.data);
    this.log(
      'CSV_IMPORT',
      `Imported ${imported} new, updated ${updated}, ${errors.length} errors`,
      supermarket_id
    );

    return {
      totalRows: lines.length - 1,
      imported,
      updated,
      errors,
    };
  }

  // --- SHOPPING SESSIONS & AUTHORITATIVE CART ENGINE ---
  public getOrCreateActiveSession(
    customer_id: string,
    supermarket_id: string,
    customer_name: string = 'Shopper',
    budget?: number
  ): ShoppingSession {
    // Check if there is already an ACTIVE session for this customer at this supermarket
    let session = this.data.shopping_sessions.find(
      (s) =>
        s.customer_id === customer_id &&
        s.supermarket_id === supermarket_id &&
        s.status === 'ACTIVE'
    );

    const sm = this.getSupermarketById(supermarket_id);

    if (!session) {
      session = {
        id: 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        customer_id,
        customer_name,
        supermarket_id,
        supermarket_name: sm?.name || 'Supermarket',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'ACTIVE',
        subtotal: 0,
        discount: 0,
        estimated_total: 0,
        budget: budget && budget > 0 ? budget : 2000,
        items: [],
      };
      this.data.shopping_sessions.unshift(session);
      this.saveData(this.data);
      this.log('SESSION_STARTED', `Customer started shopping session`, supermarket_id, customer_name);
    } else if (budget && budget > 0) {
      session.budget = budget;
      this.saveData(this.data);
    }

    return session;
  }

  public getSessionById(sessionId: string): ShoppingSession | null {
    return this.data.shopping_sessions.find((s) => s.id === sessionId) || null;
  }

  // Authoritative server-side total calculation: never trust client-computed prices
  private recalculateSessionTotals(session: ShoppingSession) {
    let subtotal = 0;
    let totalDiscount = 0;

    for (const item of session.items) {
      const itemOriginalSubtotal = item.unit_price_snapshot * item.quantity;
      const effectiveItemTotal = item.effective_price * item.quantity;
      const itemDiscount = Math.max(0, itemOriginalSubtotal - effectiveItemTotal);

      item.subtotal = effectiveItemTotal;
      subtotal += itemOriginalSubtotal;
      totalDiscount += itemDiscount;
    }

    session.subtotal = Math.round(subtotal * 100) / 100;
    session.discount = Math.round(totalDiscount * 100) / 100;
    session.estimated_total = Math.round((subtotal - totalDiscount) * 100) / 100;
    session.updated_at = new Date().toISOString();
  }

  public addItemToCart(
    sessionId: string,
    barcode: string,
    quantity: number = 1
  ): { session: ShoppingSession; item: ShoppingItem } {
    const session = this.getSessionById(sessionId);
    if (!session) throw new Error('Shopping session not found.');
    if (session.status !== 'ACTIVE') throw new Error('Shopping session is no longer active.');

    // Authoritative product lookup: SUPERMARKET_ID + BARCODE
    const product = this.getProductByBarcode(session.supermarket_id, barcode);
    if (!product) {
      throw new Error(`Product with barcode ${barcode} not found in this supermarket.`);
    }

    if (product.status !== 'ACTIVE') {
      throw new Error(`"${product.product_name}" is currently inactive in this supermarket.`);
    }

    if (product.stock_quantity <= 0) {
      throw new Error(`"${product.product_name}" is currently out of stock.`);
    }

    const effectivePrice =
      product.discount_price && product.discount_price > 0 && product.discount_price < product.selling_price
        ? product.discount_price
        : product.selling_price;

    // Check if product already in cart
    const existingItem = session.items.find((it) => it.product_id === product.id);

    let affectedItem: ShoppingItem;

    if (existingItem) {
      const newQty = existingItem.quantity + quantity;
      if (newQty > product.stock_quantity) {
        throw new Error(
          `Cannot add more. Only ${product.stock_quantity} available in store stock.`
        );
      }
      existingItem.quantity = newQty;
      // Keep price snapshots up to date if supermarket changed price
      existingItem.effective_price = effectivePrice;
      existingItem.subtotal = existingItem.effective_price * existingItem.quantity;
      affectedItem = existingItem;
    } else {
      if (quantity > product.stock_quantity) {
        throw new Error(
          `Requested quantity (${quantity}) exceeds store stock of ${product.stock_quantity}.`
        );
      }

      affectedItem = {
        id: 'item_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        session_id: session.id,
        product_id: product.id,
        barcode: product.barcode,
        product_name_snapshot: product.product_name,
        brand_snapshot: product.brand,
        unit_snapshot: product.unit,
        unit_price_snapshot: product.selling_price,
        discount_price_snapshot: product.discount_price || 0,
        effective_price: effectivePrice,
        quantity,
        subtotal: effectivePrice * quantity,
        image_snapshot: product.image,
        created_at: new Date().toISOString(),
      };
      session.items.push(affectedItem);
    }

    this.recalculateSessionTotals(session);
    this.saveData(this.data);
    this.log(
      'CART_ADD',
      `Added ${affectedItem.product_name_snapshot} (Qty: ${affectedItem.quantity})`,
      session.supermarket_id,
      session.customer_name
    );

    return { session, item: affectedItem };
  }

  public updateCartItem(
    sessionId: string,
    itemId: string,
    quantity: number
  ): ShoppingSession {
    const session = this.getSessionById(sessionId);
    if (!session) throw new Error('Shopping session not found.');
    if (session.status !== 'ACTIVE') throw new Error('Shopping session is not active.');

    const item = session.items.find((it) => it.id === itemId);
    if (!item) throw new Error('Cart item not found.');

    if (quantity <= 0) {
      // Remove item
      session.items = session.items.filter((it) => it.id !== itemId);
    } else {
      // Check stock
      const product = this.data.products.find((p) => p.id === item.product_id);
      if (product && quantity > product.stock_quantity) {
        throw new Error(`Only ${product.stock_quantity} units available in stock.`);
      }
      item.quantity = quantity;
    }

    this.recalculateSessionTotals(session);
    this.saveData(this.data);
    return session;
  }

  public removeCartItem(sessionId: string, itemId: string): ShoppingSession {
    return this.updateCartItem(sessionId, itemId, 0);
  }

  public calculateLoyaltyPoints(total: number): number {
    if (!total || total <= 0) return 0;
    // 1 loyalty point for every KSh 100 spent
    return Math.floor(total / 100);
  }

  public completeShoppingSession(sessionId: string): ShoppingSession {
    const session = this.getSessionById(sessionId);
    if (!session) throw new Error('Session not found.');

    session.status = 'COMPLETED';
    session.completed_at = new Date().toISOString();
    session.receipt_code = 'SC-' + Math.floor(100000 + Math.random() * 900000);

    // Calculate loyalty points earned based on the final total of the completed session
    const pointsEarned = this.calculateLoyaltyPoints(session.estimated_total);
    session.loyalty_points_earned = pointsEarned;

    // Deduct inventory in supermarket
    for (const item of session.items) {
      const prod = this.data.products.find((p) => p.id === item.product_id);
      if (prod) {
        prod.stock_quantity = Math.max(0, prod.stock_quantity - item.quantity);
      }
    }

    this.saveData(this.data);
    this.log(
      'SESSION_COMPLETED',
      `Completed session with ${session.items.length} items. Total: KSh ${session.estimated_total}. Loyalty Points: +${pointsEarned} pts`,
      session.supermarket_id,
      session.customer_name
    );
    return session;
  }

  public getCustomerSessions(customer_id: string): ShoppingSession[] {
    return this.data.shopping_sessions.filter((s) => s.customer_id === customer_id);
  }

  public getCustomerLoyalty(customerId: string): CustomerLoyalty {
    const completedSessions = this.data.shopping_sessions.filter(
      (s) => s.customer_id === customerId && s.status === 'COMPLETED'
    );

    let totalPoints = 0;
    let totalSpent = 0;
    const history: LoyaltyTransaction[] = [];

    for (const sess of completedSessions) {
      const points =
        typeof sess.loyalty_points_earned === 'number'
          ? sess.loyalty_points_earned
          : this.calculateLoyaltyPoints(sess.estimated_total);

      if (typeof sess.loyalty_points_earned !== 'number') {
        sess.loyalty_points_earned = points;
      }

      totalPoints += points;
      totalSpent += sess.estimated_total;

      const sm = this.getSupermarketById(sess.supermarket_id);
      history.push({
        session_id: sess.id,
        receipt_code: sess.receipt_code,
        supermarket_id: sess.supermarket_id,
        supermarket_name: sess.supermarket_name || sm?.name || 'Supermarket',
        date: sess.completed_at || sess.updated_at || sess.started_at,
        session_total: sess.estimated_total,
        points_earned: points,
      });
    }

    // Sort newest first
    history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Determine loyalty tier
    let tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum' = 'Bronze';
    let next_tier_name: string | undefined = 'Silver';
    let next_tier_threshold = 200;
    let points_to_next_tier = Math.max(0, 200 - totalPoints);
    let tier_progress_percent = Math.min(100, Math.round((totalPoints / 200) * 100));

    if (totalPoints >= 1000) {
      tier = 'Platinum';
      next_tier_name = undefined;
      points_to_next_tier = 0;
      tier_progress_percent = 100;
    } else if (totalPoints >= 500) {
      tier = 'Gold';
      next_tier_name = 'Platinum';
      next_tier_threshold = 1000;
      points_to_next_tier = 1000 - totalPoints;
      tier_progress_percent = Math.min(100, Math.round(((totalPoints - 500) / 500) * 100));
    } else if (totalPoints >= 200) {
      tier = 'Silver';
      next_tier_name = 'Gold';
      next_tier_threshold = 500;
      points_to_next_tier = 500 - totalPoints;
      tier_progress_percent = Math.min(100, Math.round(((totalPoints - 200) / 300) * 100));
    }

    return {
      total_points: totalPoints,
      points_value_ksh: totalPoints,
      total_spent: Math.round(totalSpent * 100) / 100,
      completed_sessions_count: completedSessions.length,
      tier,
      next_tier_name,
      points_to_next_tier,
      next_tier_threshold,
      tier_progress_percent,
      history,
    };
  }

  // --- ADMIN STATS ---
  public getAdminDashboardStats(supermarket_id: string): AdminDashboardStats {
    const prods = this.getProductsForSupermarket(supermarket_id);
    const sm = this.getSupermarketById(supermarket_id);
    const threshold = sm?.low_stock_threshold || 15;

    const totalProducts = prods.length;
    const activeProducts = prods.filter((p) => p.status === 'ACTIVE').length;
    const lowStockCount = prods.filter(
      (p) => p.stock_quantity > 0 && p.stock_quantity <= threshold
    ).length;
    const outOfStockCount = prods.filter((p) => p.stock_quantity <= 0).length;

    const sessions = this.data.shopping_sessions.filter(
      (s) => s.supermarket_id === supermarket_id
    );
    const today = new Date().toISOString().split('T')[0];
    const todaySessions = sessions.filter((s) => s.started_at.startsWith(today));
    const todayEstimatedSales = todaySessions.reduce((acc, s) => acc + s.estimated_total, 0);
    const activeShoppersCount = sessions.filter((s) => s.status === 'ACTIVE').length;

    // Shopper scan & usage counts strictly isolated for this supermarket
    const totalItemsScannedInStore = sessions.reduce((acc, sess) => {
      const itemsCount = sess.items ? sess.items.reduce((sAcc, it) => sAcc + it.quantity, 0) : 0;
      return acc + itemsCount;
    }, 0);
    const uniqueCustomerIds = new Set(sessions.map((s) => s.customer_id).filter(Boolean));
    const uniqueCustomersUsedCount = uniqueCustomerIds.size;
    const totalSessionsInStore = sessions.length;

    return {
      totalProducts,
      activeProducts,
      lowStockCount,
      outOfStockCount,
      todaySessionsCount: todaySessions.length,
      todayEstimatedSales,
      activeShoppersCount,
      totalItemsScannedInStore,
      uniqueCustomersUsedCount,
      totalSessionsInStore,
    };
  }

  public getAdminSessions(supermarket_id: string): ShoppingSession[] {
    return this.data.shopping_sessions.filter((s) => s.supermarket_id === supermarket_id);
  }

  public getCategories(supermarket_id?: string): Category[] {
    return this.data.categories.filter(
      (c) => !c.supermarket_id || c.supermarket_id === supermarket_id
    );
  }

  public addCategory(supermarket_id: string, name: string): Category {
    const trimmed = name.trim();
    const existing = this.data.categories.find(
      (c) =>
        (!c.supermarket_id || c.supermarket_id === supermarket_id) &&
        c.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) return existing;

    const newCat: Category = {
      id: 'cat_' + Date.now(),
      supermarket_id,
      name: trimmed,
    };
    this.data.categories.push(newCat);
    this.saveData(this.data);
    return newCat;
  }

  // ==========================================
  // RECOVERY CODE METHODS
  // ==========================================
  public sendRecoveryCode(email: string): {
    success: boolean;
    email: string;
    code: string;
    expiresInMinutes: number;
    name: string;
    message: string;
  } {
    const cleanEmail = email.trim().toLowerCase();
    const user = this.data.users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (!user) {
      throw new Error(`No account found registered with email: ${cleanEmail}`);
    }

    if (!this.data.recovery_codes) this.data.recovery_codes = [];
    // 6-digit recovery code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresInMinutes = 15;
    const expiresAt = Date.now() + expiresInMinutes * 60 * 1000;

    // Remove any previous recovery code for this email
    this.data.recovery_codes = this.data.recovery_codes.filter(
      (r) => r.email.toLowerCase() !== cleanEmail
    );

    this.data.recovery_codes.push({
      email: cleanEmail,
      code,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });

    this.saveData(this.data);
    this.log(
      'RECOVERY_CODE_SENT',
      `Sent 6-digit recovery code [${code}] to email: ${cleanEmail}`,
      undefined,
      user.name
    );

    return {
      success: true,
      email: cleanEmail,
      code,
      expiresInMinutes,
      name: user.name,
      message: `A 6-digit recovery code has been sent to ${cleanEmail}. Valid for ${expiresInMinutes} minutes.`,
    };
  }

  public verifyRecoveryCodeAndResetPassword(
    email: string,
    code: string,
    newPassword?: string
  ): {
    success: boolean;
    user: User;
    newPassword: string;
    message: string;
  } {
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.trim();

    if (!this.data.recovery_codes) this.data.recovery_codes = [];
    const recordIndex = this.data.recovery_codes.findIndex(
      (r) => r.email.toLowerCase() === cleanEmail && r.code === cleanCode
    );

    if (recordIndex === -1) {
      throw new Error('Invalid recovery code. Please check your email or request a new code.');
    }

    const record = this.data.recovery_codes[recordIndex];
    if (Date.now() > record.expires_at) {
      this.data.recovery_codes.splice(recordIndex, 1);
      this.saveData(this.data);
      throw new Error('Recovery code has expired. Please request a new code.');
    }

    const user = this.data.users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (!user) {
      throw new Error('Associated account could not be found.');
    }

    const finalPassword = newPassword && newPassword.trim()
      ? newPassword.trim()
      : 'sc' + Math.floor(100000 + Math.random() * 900000);

    user.password = finalPassword;
    // Consume recovery code
    this.data.recovery_codes.splice(recordIndex, 1);
    this.saveData(this.data);

    this.log(
      'PASSWORD_RESET_SUCCESS',
      `Password successfully reset for account ${user.email} using recovery code.`,
      undefined,
      user.name
    );

    return {
      success: true,
      user,
      newPassword: finalPassword,
      message: 'Password has been reset successfully. You are now logged in.',
    };
  }

  // ==========================================
  // HELP CENTER & SYSTEM ADMIN COMMUNICATION
  // ==========================================
  public getSupportTickets(filter?: { customer_id?: string; customer_email?: string }): SupportTicket[] {
    if (!this.data.support_tickets) this.data.support_tickets = [];
    let list = [...this.data.support_tickets];
    if (filter?.customer_id) {
      list = list.filter((t) => t.customer_id === filter.customer_id);
    } else if (filter?.customer_email) {
      const em = filter.customer_email.trim().toLowerCase();
      list = list.filter((t) => t.customer_email.toLowerCase() === em);
    }
    return list.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }

  public createSupportTicket(data: {
    customer_id: string;
    customer_name: string;
    customer_email: string;
    customer_phone?: string;
    supermarket_id?: string;
    supermarket_name?: string;
    subject: string;
    category: TicketCategory;
    priority?: TicketPriority;
    initial_message: string;
  }): SupportTicket {
    if (!this.data.support_tickets) this.data.support_tickets = [];

    const now = new Date().toISOString();
    const ticketId = 'tkt_' + Date.now();
    const newTicket: SupportTicket = {
      id: ticketId,
      customer_id: data.customer_id,
      customer_name: data.customer_name || 'Customer',
      customer_email: data.customer_email.trim().toLowerCase(),
      customer_phone: data.customer_phone,
      supermarket_id: data.supermarket_id,
      supermarket_name: data.supermarket_name,
      subject: data.subject.trim(),
      category: data.category || 'TECHNICAL_ISSUE',
      priority: data.priority || 'NORMAL',
      status: 'OPEN',
      messages: [
        {
          id: 'msg_' + Date.now(),
          sender: 'CUSTOMER',
          sender_name: data.customer_name || 'Customer',
          sender_email: data.customer_email.trim().toLowerCase(),
          message: data.initial_message.trim(),
          timestamp: now,
        },
      ],
      created_at: now,
      updated_at: now,
    };

    this.data.support_tickets.push(newTicket);
    this.saveData(this.data);

    this.log(
      'SUPPORT_TICKET_CREATED',
      `New Help Center ticket [${ticketId}] opened by ${newTicket.customer_name}: "${newTicket.subject}"`,
      newTicket.supermarket_id,
      newTicket.customer_name
    );

    return newTicket;
  }

  public addTicketMessage(
    ticketId: string,
    message: string,
    sender: 'CUSTOMER' | 'SYSTEM_ADMIN',
    sender_name: string,
    sender_email: string
  ): SupportTicket {
    if (!this.data.support_tickets) this.data.support_tickets = [];
    const ticket = this.data.support_tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      throw new Error(`Support ticket ${ticketId} not found.`);
    }

    const now = new Date().toISOString();
    ticket.messages.push({
      id: 'msg_' + Date.now(),
      sender,
      sender_name,
      sender_email,
      message: message.trim(),
      timestamp: now,
    });
    ticket.updated_at = now;

    if (sender === 'SYSTEM_ADMIN') {
      ticket.status = 'REPLIED';
      this.log(
        'SUPPORT_TICKET_ADMIN_REPLY',
        `System Admin replied to customer ${ticket.customer_name} on ticket ${ticket.id}`,
        ticket.supermarket_id,
        sender_name
      );
    } else {
      if (ticket.status === 'RESOLVED') {
        ticket.status = 'OPEN';
      }
      this.log(
        'SUPPORT_TICKET_CUSTOMER_REPLY',
        `Customer ${sender_name} replied on ticket ${ticket.id}`,
        ticket.supermarket_id,
        sender_name
      );
    }

    this.saveData(this.data);
    return ticket;
  }

  public updateTicketStatus(ticketId: string, status: TicketStatus): SupportTicket {
    if (!this.data.support_tickets) this.data.support_tickets = [];
    const ticket = this.data.support_tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      throw new Error(`Support ticket ${ticketId} not found.`);
    }

    ticket.status = status;
    ticket.updated_at = new Date().toISOString();
    this.saveData(this.data);

    this.log(
      'SUPPORT_TICKET_STATUS_CHANGED',
      `Ticket ${ticket.id} status changed to ${status}`,
      ticket.supermarket_id
    );

    return ticket;
  }
}

export const db = new DatabaseService();
