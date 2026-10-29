import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { db } from './src/server/db.ts';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ==========================================
// AUTHENTICATION ENDPOINTS
// ==========================================
app.post('/api/auth/login', (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }
    const user = db.authenticate(email, password || '');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. Please verify your email and password.' });
    }
    return res.json({ success: true, user });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/store-admin-login', (req: Request, res: Response) => {
  try {
    const { supermarket_code, password, username_or_email } = req.body;
    if (!supermarket_code || !password) {
      return res.status(400).json({
        success: false,
        message: 'Supermarket Code and Password are required.',
      });
    }

    const authResult = db.authenticateStoreAdmin(supermarket_code, password, username_or_email);
    return res.json({
      success: true,
      user: authResult.user,
      supermarket: authResult.supermarket,
      isStaff: authResult.isStaff,
      staffTitle: authResult.staffTitle,
    });
  } catch (error: any) {
    return res.status(401).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/register', (req: Request, res: Response) => {
  try {
    const { name, email, role, phone, supermarket_id } = req.body;
    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Name and email are required.' });
    }
    const user = db.registerUser(name, email, role || 'CUSTOMER', phone, supermarket_id);
    return res.json({ success: true, user });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// ==========================================
// SUPERMARKETS ENDPOINTS
// ==========================================
app.get('/api/supermarkets/list', (_req: Request, res: Response) => {
  try {
    const list = db.getSupermarkets();
    return res.json({ success: true, supermarkets: list });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/supermarkets/get', (req: Request, res: Response) => {
  try {
    const { id, code } = req.query;
    let supermarket = null;
    if (id) {
      supermarket = db.getSupermarketById(id as string);
    } else if (code) {
      supermarket = db.getSupermarketByCode(code as string);
    }
    if (!supermarket) {
      return res.status(404).json({ success: false, message: 'Supermarket not found.' });
    }
    return res.json({ success: true, supermarket });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/supermarkets/create', (req: Request, res: Response) => {
  try {
    const sm = db.createSupermarket(req.body);
    return res.json({ success: true, supermarket: sm });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/supermarkets/update', (req: Request, res: Response) => {
  try {
    const { id, ...updates } = req.body;
    if (!id) return res.status(400).json({ success: false, message: 'ID required' });
    const sm = db.updateSupermarket(id, updates);
    return res.json({ success: true, supermarket: sm });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/supermarkets/delete', (req: Request, res: Response) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, message: 'Supermarket ID is required.' });
    const result = db.deleteSupermarket(id);
    return res.json({
      success: true,
      message: `Supermarket "${result.deleted.name}" deleted successfully.`,
      ...result,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// ==========================================
// BARCODE LOOKUP & PRODUCT SEARCH
// Strictly bound to (supermarket_id, barcode)
// ==========================================
app.get('/api/products/barcode', (req: Request, res: Response) => {
  try {
    const { supermarket_id, barcode } = req.query;
    if (!supermarket_id || !barcode) {
      return res.status(400).json({
        success: false,
        message: 'Both supermarket_id and barcode are required.',
      });
    }

    const sm = db.getSupermarketById(supermarket_id as string);
    if (!sm) {
      return res.status(404).json({
        success: false,
        message: 'Invalid supermarket. Please reconnect.',
      });
    }

    const product = db.getProductByBarcode(supermarket_id as string, barcode as string);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found in this supermarket.',
      });
    }

    return res.json({
      success: true,
      product: {
        id: product.id,
        barcode: product.barcode,
        name: product.product_name,
        product_name: product.product_name,
        brand: product.brand,
        unit: product.unit,
        price: product.selling_price,
        selling_price: product.selling_price,
        discount_price: product.discount_price,
        stock: product.stock_quantity,
        stock_quantity: product.stock_quantity,
        category: product.category,
        description: product.description,
        status: product.status,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/products/search', (req: Request, res: Response) => {
  try {
    const { supermarket_id, query, category } = req.query;
    if (!supermarket_id) {
      return res.status(400).json({
        success: false,
        message: 'supermarket_id is required.',
      });
    }

    const products = db.searchProducts(
      supermarket_id as string,
      (query as string) || '',
      (category as string) || ''
    );

    return res.json({ success: true, products });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/categories', (req: Request, res: Response) => {
  try {
    const { supermarket_id } = req.query;
    const categories = db.getCategories(supermarket_id as string);
    return res.json({ success: true, categories });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/categories/create', (req: Request, res: Response) => {
  try {
    const { supermarket_id, name } = req.body;
    if (!supermarket_id || !name) {
      return res.status(400).json({ success: false, message: 'Supermarket and name required' });
    }
    const cat = db.addCategory(supermarket_id, name);
    return res.json({ success: true, category: cat });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// ==========================================
// SHOPPING SESSIONS & CART ENDPOINTS
// Authoritative server-side price & total calculation
// ==========================================
app.post('/api/sessions/create', (req: Request, res: Response) => {
  try {
    const { customer_id, supermarket_id, customer_name, budget } = req.body;
    if (!customer_id || !supermarket_id) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID and Supermarket ID are required.',
      });
    }

    const session = db.getOrCreateActiveSession(
      customer_id,
      supermarket_id,
      customer_name || 'Valued Shopper',
      budget ? Number(budget) : undefined
    );

    return res.json({ success: true, session });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.get('/api/sessions/current', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID required.' });
    }
    const session = db.getSessionById(sessionId as string);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found.' });
    }
    return res.json({ success: true, session });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/cart/add', (req: Request, res: Response) => {
  try {
    const { sessionId, barcode, quantity } = req.body;
    if (!sessionId || !barcode) {
      return res.status(400).json({
        success: false,
        message: 'Session ID and barcode are required.',
      });
    }

    const result = db.addItemToCart(sessionId, barcode, quantity ? Number(quantity) : 1);
    return res.json({ success: true, session: result.session, item: result.item });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/cart/update', (req: Request, res: Response) => {
  try {
    const { sessionId, itemId, quantity } = req.body;
    if (!sessionId || !itemId || quantity === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Session ID, item ID and quantity required.',
      });
    }

    const updatedSession = db.updateCartItem(sessionId, itemId, Number(quantity));
    return res.json({ success: true, session: updatedSession });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/cart/remove', (req: Request, res: Response) => {
  try {
    const { sessionId, itemId } = req.body;
    if (!sessionId || !itemId) {
      return res.status(400).json({ success: false, message: 'Session ID and item ID required.' });
    }
    const updatedSession = db.removeCartItem(sessionId, itemId);
    return res.json({ success: true, session: updatedSession });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/sessions/complete', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID required.' });
    }
    const completed = db.completeShoppingSession(sessionId);
    return res.json({ success: true, session: completed });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.get('/api/customer/history', (req: Request, res: Response) => {
  try {
    const { customer_id } = req.query;
    if (!customer_id) {
      return res.status(400).json({ success: false, message: 'Customer ID required.' });
    }
    const sessions = db.getCustomerSessions(customer_id as string);
    return res.json({ success: true, sessions });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/customer/loyalty', (req: Request, res: Response) => {
  try {
    const { customer_id } = req.query;
    if (!customer_id) {
      return res.status(400).json({ success: false, message: 'Customer ID required.' });
    }
    const loyalty = db.getCustomerLoyalty(customer_id as string);
    return res.json({ success: true, loyalty });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});


// ==========================================
// CUSTOMER EMAIL-LINKED ACCOUNT ENDPOINTS
// ==========================================
app.get('/api/customer/list', (_req: Request, res: Response) => {
  try {
    const customers = db.getCustomers();
    return res.json({ success: true, customers });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/customer/by-email', (req: Request, res: Response) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }
    const customer = db.getCustomerByEmail(email as string);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer account not found.' });
    }
    return res.json({ success: true, customer });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/customer/login', (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }
    const user = db.customerLogin(email, password);
    return res.json({ success: true, user });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/customer/login-or-create', (req: Request, res: Response) => {
  try {
    const { email, name, phone, password } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }
    const user = db.loginOrCreateCustomer(email, name, phone, password);
    return res.json({ success: true, user });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/customer/register', (req: Request, res: Response) => {
  try {
    const { name, email, id_number, phone, password } = req.body;
    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Customer name and email are required.' });
    }
    const user = db.registerCustomer(name, email, id_number, phone, password);
    return res.json({ success: true, user });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// Customer Google Sign In / Sign Up
app.post('/api/customer/google-auth', (req: Request, res: Response) => {
  try {
    const { email, name } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Google email is required.' });
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name?.trim() || cleanEmail.split('@')[0];
    const user = db.loginOrCreateCustomer(cleanEmail, cleanName);
    return res.json({
      success: true,
      user,
      message: `Signed in with Google as ${cleanEmail}`,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// Customer Forgot Password (receives newly generated password via email)
app.post('/api/auth/customer/forgot-password', (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }
    const result = db.forgotPasswordCustomer(email);
    return res.json({
      success: true,
      newPassword: result.newPassword,
      email: result.email,
      name: result.name,
      message: `A new password has been generated and sent to ${result.email}.`,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// Store Admin / Staff Forgot Password (receives newly generated password via email)
app.post('/api/auth/store-admin/forgot-password', (req: Request, res: Response) => {
  try {
    const { supermarket_code, staff_username_or_email } = req.body;
    if (!supermarket_code) {
      return res.status(400).json({ success: false, message: 'Supermarket Code is required.' });
    }
    const result = db.forgotPasswordStoreAdmin(supermarket_code, staff_username_or_email);
    return res.json({
      success: true,
      newPassword: result.newPassword,
      targetEmail: result.targetEmail,
      supermarketName: result.supermarketName,
      accountType: result.accountType,
      message: `A new store admin password has been generated and sent to ${result.targetEmail}.`,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// Admin can edit customer details: name, id_number, phone, and password incase forgotten
app.post('/api/customer/update', (req: Request, res: Response) => {
  try {
    const { customer_id, name, id_number, phone, password, email } = req.body;
    if (!customer_id) {
      return res.status(400).json({ success: false, message: 'Customer ID is required.' });
    }
    const updatedUser = db.updateCustomer(customer_id, { name, id_number, phone, password, email });
    return res.json({ success: true, user: updatedUser, message: 'Customer profile updated successfully.' });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// System admin can add customer
app.post('/api/customer/add', (req: Request, res: Response) => {
  try {
    const { name, email, id_number, phone, password } = req.body;
    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Customer name and email are required.' });
    }
    const newCustomer = db.addCustomer({ name, email, id_number, phone, password });
    return res.json({ success: true, user: newCustomer, message: 'Customer added successfully.' });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// System admin can delete customer
app.post('/api/customer/delete', (req: Request, res: Response) => {
  try {
    const { customer_id } = req.body;
    if (!customer_id) {
      return res.status(400).json({ success: false, message: 'Customer ID is required.' });
    }
    db.deleteCustomer(customer_id);
    return res.json({ success: true, message: 'Customer account deleted successfully.' });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// ==========================================
// STORE STAFF MANAGEMENT (UP TO 3 LOGINS)
// ==========================================
app.get('/api/admin/staff', (req: Request, res: Response) => {
  try {
    const { supermarket_id } = req.query;
    if (!supermarket_id) {
      return res.status(400).json({ success: false, message: 'Supermarket ID is required.' });
    }
    const staff = db.getStoreStaff(supermarket_id as string);
    return res.json({
      success: true,
      staff,
      slotsUsed: staff.length,
      maxSlots: 3,
      slotsAvailable: Math.max(0, 3 - staff.length),
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/staff/create', (req: Request, res: Response) => {
  try {
    const { supermarket_id, name, username, email, password, staff_title, permissions } = req.body;
    if (!supermarket_id || !name || !username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Supermarket ID, name, username, and password are required.',
      });
    }
    const newStaff = db.createStoreStaff(supermarket_id, {
      name,
      username,
      email,
      password,
      staff_title: staff_title || 'Floor Supervisor',
      permissions,
    });
    return res.json({ success: true, staff: newStaff });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/staff/update', (req: Request, res: Response) => {
  try {
    const { supermarket_id, staff_id, updates } = req.body;
    if (!supermarket_id || !staff_id) {
      return res.status(400).json({ success: false, message: 'Supermarket ID and staff ID required.' });
    }
    const updated = db.updateStoreStaff(supermarket_id, staff_id, updates || {});
    return res.json({ success: true, staff: updated });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/staff/delete', (req: Request, res: Response) => {
  try {
    const { supermarket_id, staff_id } = req.body;
    if (!supermarket_id || !staff_id) {
      return res.status(400).json({ success: false, message: 'Supermarket ID and staff ID required.' });
    }
    db.deleteStoreStaff(supermarket_id, staff_id);
    return res.json({ success: true, message: 'Staff account deleted successfully.' });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/staff-login', (req: Request, res: Response) => {
  try {
    const { username_or_email, password } = req.body;
    if (!username_or_email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username/Email and Password are required.',
      });
    }
    const result = db.authenticateStaffLogin(username_or_email, password);
    return res.json({
      success: true,
      user: result.user,
      supermarket: result.supermarket,
      staffTitle: result.staffTitle,
    });
  } catch (error: any) {
    return res.status(401).json({ success: false, message: error.message });
  }
});

app.post('/api/supermarkets/reset-password', (req: Request, res: Response) => {
  try {
    const { supermarket_id, new_password } = req.body;
    if (!supermarket_id) {
      return res.status(400).json({ success: false, message: 'Supermarket ID is required.' });
    }
    const result = db.resetSupermarketPassword(supermarket_id, new_password);
    return res.json({
      success: true,
      supermarket: result.supermarket,
      newPassword: result.newPassword,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// ==========================================
// SUPERMARKET ADMIN ENDPOINTS
// ==========================================
app.get('/api/admin/dashboard', (req: Request, res: Response) => {
  try {
    const { supermarket_id } = req.query;
    if (!supermarket_id) {
      return res.status(400).json({ success: false, message: 'Supermarket ID required.' });
    }
    const stats = db.getAdminDashboardStats(supermarket_id as string);
    const sm = db.getSupermarketById(supermarket_id as string);
    return res.json({ success: true, stats, supermarket: sm });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/admin/products/list', (req: Request, res: Response) => {
  try {
    const { supermarket_id } = req.query;
    if (!supermarket_id) {
      return res.status(400).json({ success: false, message: 'Supermarket ID required.' });
    }
    const products = db.getProductsForSupermarket(supermarket_id as string);
    return res.json({ success: true, products });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/products/create', (req: Request, res: Response) => {
  try {
    const { supermarket_id, ...productData } = req.body;
    if (!supermarket_id) {
      return res.status(400).json({ success: false, message: 'Supermarket ID required.' });
    }
    const product = db.createProduct(supermarket_id, productData);
    return res.json({ success: true, product });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/products/update', (req: Request, res: Response) => {
  try {
    const { supermarket_id, product_id, ...updates } = req.body;
    if (!supermarket_id || !product_id) {
      return res.status(400).json({ success: false, message: 'Supermarket ID and product ID required.' });
    }
    const product = db.updateProduct(supermarket_id, product_id, updates);
    return res.json({ success: true, product });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/products/delete', (req: Request, res: Response) => {
  try {
    const { supermarket_id, product_id } = req.body;
    if (!supermarket_id || !product_id) {
      return res.status(400).json({ success: false, message: 'Supermarket ID and product ID required.' });
    }
    db.deleteProduct(supermarket_id, product_id);
    return res.json({ success: true, message: 'Product deleted successfully.' });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/products/import', (req: Request, res: Response) => {
  try {
    const { supermarket_id, csv_content, action_type } = req.body;
    if (!supermarket_id || !csv_content) {
      return res.status(400).json({ success: false, message: 'Supermarket ID and CSV content required.' });
    }
    const result = db.importProductsCSV(supermarket_id, csv_content, action_type || 'upsert');
    return res.json({ success: true, ...result });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

app.get('/api/admin/sessions', (req: Request, res: Response) => {
  try {
    const { supermarket_id } = req.query;
    if (!supermarket_id) {
      return res.status(400).json({ success: false, message: 'Supermarket ID required.' });
    }
    const sessions = db.getAdminSessions(supermarket_id as string);
    return res.json({ success: true, sessions });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// SYSTEM ADMIN & EXPORT SCRIPT
// ==========================================
app.get('/api/system/sql-script', (_req: Request, res: Response) => {
  try {
    const sqlPath = path.resolve(process.cwd(), 'database', 'smartcart.sql');
    if (fs.existsSync(sqlPath)) {
      const content = fs.readFileSync(sqlPath, 'utf-8');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="smartcart.sql"');
      return res.send(content);
    }
    return res.status(404).send('-- smartcart.sql not found');
  } catch (error: any) {
    return res.status(500).send(error.message);
  }
});

app.post('/api/system/demo-reset', (_req: Request, res: Response) => {
  try {
    db.resetToDemo();
    return res.json({ success: true, message: 'Demo data restored successfully.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/activity-logs', (req: Request, res: Response) => {
  try {
    const { supermarket_id } = req.query;
    const logs = db.getActivityLogs(supermarket_id as string);
    return res.json({ success: true, logs });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ==========================================
// VITE MIDDLEWARE / STATIC ASSETS
// ==========================================
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SmartCart Server] Listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
