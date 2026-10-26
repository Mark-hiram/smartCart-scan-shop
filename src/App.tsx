import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { CustomerDashboard } from './components/CustomerDashboard.tsx';
import { SupermarketSelectorModal } from './components/SupermarketSelectorModal.tsx';
import { BarcodeScannerModal } from './components/BarcodeScannerModal.tsx';
import { CartModal } from './components/CartModal.tsx';
import { BudgetModal } from './components/BudgetModal.tsx';
import { ReceiptSummaryModal } from './components/ReceiptSummaryModal.tsx';
import { ProductSearchModal } from './components/ProductSearchModal.tsx';
import { HistoryModal } from './components/HistoryModal.tsx';
import { LoyaltyModal } from './components/LoyaltyModal.tsx';
import { AdminPortal } from './components/AdminPortal.tsx';
import { SystemAdminPortal } from './components/SystemAdminPortal.tsx';
import { StoreAdminSignIn } from './components/StoreAdminSignIn.tsx';
import { SystemAdminSignIn } from './components/SystemAdminSignIn.tsx';
import { CustomerAccountModal } from './components/CustomerAccountModal.tsx';
import { Store, Shield, Lock } from 'lucide-react';
import { api } from './api.ts';
import { Supermarket, User, ShoppingSession, CustomerLoyalty } from './types.ts';
import { playScanBeep } from './utils/audio.ts';

const GUEST_CUSTOMER: User = {
  id: 'usr_guest',
  email: 'guest@smartcart.co.ke',
  name: 'Shopper',
  role: 'CUSTOMER',
  created_at: '2026-01-01T08:00:00Z',
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<User>(() => {
    try {
      const saved = localStorage.getItem('smartcart_active_user');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return GUEST_CUSTOMER;
  });
  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([]);
  const [currentSupermarket, setCurrentSupermarket] = useState<Supermarket | null>(null);
  const [session, setSession] = useState<ShoppingSession | null>(null);
  const [currentView, setCurrentView] = useState<'customer' | 'admin' | 'system'>(() => {
    try {
      const saved = localStorage.getItem('smartcart_active_user');
      if (saved) {
        const u = JSON.parse(saved);
        if (u.role === 'SYSTEM_ADMIN') return 'system';
        if (u.role === 'SUPERMARKET_ADMIN') return 'admin';
      }
    } catch {
      // ignore
    }
    return 'customer';
  });
  const [loading, setLoading] = useState(true);

  // Modal controls
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isBudgetOpen, setIsBudgetOpen] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isLoyaltyOpen, setIsLoyaltyOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [loyalty, setLoyalty] = useState<CustomerLoyalty | null>(null);

  // Initial startup
  useEffect(() => {
    loadSupermarkets();
    loadCustomerLoyalty(currentUser.id);
  }, []);

  const loadCustomerLoyalty = async (customerId: string) => {
    try {
      const res = await api.getCustomerLoyalty(customerId);
      if (res.success) {
        setLoyalty(res.loyalty);
      }
    } catch (e) {
      console.error('Failed to load customer loyalty:', e);
    }
  };

  const loadSupermarkets = async () => {
    try {
      const res = await api.getSupermarkets();
      if (res.success && res.supermarkets.length > 0) {
        setSupermarkets(res.supermarkets);
        // Default to first supermarket if current is not set or was deleted
        if (!currentSupermarket || !res.supermarkets.some((s) => s.id === currentSupermarket.id)) {
          const defaultSm = res.supermarkets[0];
          setCurrentSupermarket(defaultSm);
          if (currentUser.role === 'CUSTOMER') {
            initSession(currentUser.id, defaultSm.id, currentUser.name);
          }
        } else {
          // Sync any updates
          const updated = res.supermarkets.find((s) => s.id === currentSupermarket.id);
          if (updated) setCurrentSupermarket(updated);
        }
      } else {
        setSupermarkets([]);
        setCurrentSupermarket(null);
        setSession(null);
      }
    } catch (e) {
      console.error('Failed to load supermarkets:', e);
    } finally {
      setLoading(false);
    }
  };

  const initSession = async (customerId: string, supermarketId: string, customerName: string) => {
    try {
      const res = await api.createSession({
        customer_id: customerId,
        supermarket_id: supermarketId,
        customer_name: customerName,
      });
      if (res.success) {
        setSession(res.session);
      }
    } catch (e) {
      console.error('Failed to init session:', e);
    }
  };

  const handleSelectSupermarket = (sm: Supermarket) => {
    setCurrentSupermarket(sm);
    initSession(currentUser.id, sm.id, currentUser.name);
  };

  const handleSwitchUser = (user: User) => {
    setCurrentUser(user);
    if (user.role === 'SUPERMARKET_ADMIN') {
      setCurrentView('admin');
      if (user.supermarket_id) {
        const sm = supermarkets.find((s) => s.id === user.supermarket_id);
        if (sm) setCurrentSupermarket(sm);
      }
    } else if (user.role === 'SYSTEM_ADMIN') {
      setCurrentView('system');
    } else {
      setCurrentView('customer');
      if (currentSupermarket) {
        initSession(user.id, currentSupermarket.id, user.name);
      }
    }
  };

  // Cart actions with server-side authoritative pricing
  const handleItemAdded = async (barcode: string, quantity: number) => {
    if (!session) return;
    const res = await api.addToCart(session.id, barcode, quantity);
    if (res.success) {
      setSession(res.session);
    }
  };

  const handleUpdateCartItem = async (itemId: string, newQty: number) => {
    if (!session) return;
    try {
      const res = await api.updateCartItem(session.id, itemId, newQty);
      if (res.success) {
        setSession(res.session);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to update item');
    }
  };

  const handleRemoveCartItem = async (itemId: string) => {
    if (!session) return;
    try {
      const res = await api.removeCartItem(session.id, itemId);
      if (res.success) {
        setSession(res.session);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to remove item');
    }
  };

  const handleSaveBudget = (budgetAmount: number) => {
    if (!session) return;
    setSession({
      ...session,
      budget: budgetAmount,
    });
  };

  const handleFinishShopping = async () => {
    if (!session) return;
    try {
      const res = await api.completeSession(session.id);
      if (res.success) {
        setSession(res.session);
        await loadCustomerLoyalty(currentUser.id);
        // Start fresh active session for next shopping trip
        if (currentSupermarket) {
          setTimeout(() => {
            initSession(currentUser.id, currentSupermarket.id, currentUser.name);
          }, 1500);
        }
      }
    } catch (err: any) {
      alert(err.message || 'Failed to complete session');
    }
  };

  // Quick scan barcode from shortcuts or dashboard
  const handleQuickScanBarcode = async (barcode: string) => {
    if (!session || !currentSupermarket) return;
    try {
      const lookup = await api.lookupBarcode(currentSupermarket.id, barcode);
      if (lookup.success && lookup.product) {
        playScanBeep(true);
        await handleItemAdded(barcode, 1);
        setIsCartOpen(true);
      }
    } catch (err: any) {
      playScanBeep(false);
      alert(err.message || 'Product not found in this store.');
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem('smartcart_active_user');
    setCurrentUser(GUEST_CUSTOMER);
    setCurrentView('customer');
    setSession(null);
  };

  // Dynamic store background color & gradient styling
  const storeBgStyle: React.CSSProperties = {
    background: currentSupermarket?.bg_gradient || currentSupermarket?.bg_color || '#f8fafc',
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-400 text-emerald-950 font-black flex items-center justify-center mx-auto animate-bounce text-xl shadow-lg">
            SC
          </div>
          <h2 className="text-base font-extrabold tracking-tight">SmartCart Scan &amp; Shop</h2>
          <p className="text-xs text-slate-400">Loading supermarket databases...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col font-['Plus_Jakarta_Sans'] text-slate-900 antialiased transition-colors duration-300"
      style={currentView === 'customer' && currentSupermarket ? storeBgStyle : { backgroundColor: '#f8fafc' }}
    >
      {/* Top Navigation */}
      <Navbar
        currentUser={currentUser}
        currentSupermarket={currentSupermarket}
        itemCount={session?.items.reduce((acc, it) => acc + it.quantity, 0) || 0}
        estimatedTotal={session?.estimated_total || 0}
        onOpenSupermarketSelector={() => setIsSelectorOpen(true)}
        onOpenCart={() => setIsCartOpen(true)}
        onOpenAccount={() => setIsAccountOpen(true)}
        onSignOut={handleSignOut}
        currentView={currentView}
        onNavigateView={(view) => setCurrentView(view)}
      />

      {/* Main View Router */}
      <main className="flex-1 pb-16">
        {currentView === 'customer' && (
          currentSupermarket ? (
            <CustomerDashboard
              currentUser={currentUser}
              supermarket={currentSupermarket}
              session={session}
              loyalty={loyalty}
              onOpenAccount={() => setIsAccountOpen(true)}
              onOpenScanner={() => setIsScannerOpen(true)}
              onOpenSearch={() => setIsSearchOpen(true)}
              onOpenCart={() => setIsCartOpen(true)}
              onOpenBudget={() => setIsBudgetOpen(true)}
              onOpenSummary={() => setIsSummaryOpen(true)}
              onOpenHistory={() => setIsHistoryOpen(true)}
              onOpenLoyalty={() => setIsLoyaltyOpen(true)}
              onOpenStoreSelector={() => setIsSelectorOpen(true)}
              onQuickScanBarcode={handleQuickScanBarcode}
              onUpdateCartItemQty={handleUpdateCartItem}
              onRemoveCartItem={handleRemoveCartItem}
            />
          ) : (
            <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-6">
              <div className="w-16 h-16 rounded-3xl bg-amber-400 text-emerald-950 flex items-center justify-center mx-auto shadow-xl">
                <Store className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <span className="text-xs font-black tracking-wider uppercase bg-emerald-100 text-emerald-900 px-3 py-1 rounded-full">
                  Clean Database Initialized
                </span>
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                  No Supermarkets Registered Yet
                </h2>
                <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
                  The system is clean with zero demo stores and zero demo customers. Log in as System Admin ({currentUser.email}) to add your first supermarket and customer account from scratch.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setCurrentView('system')}
                  className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-emerald-900 hover:bg-emerald-800 text-white font-extrabold text-sm shadow-lg shadow-emerald-950/20 transition flex items-center justify-center gap-2"
                >
                  <Shield className="w-4 h-4 text-amber-400" />
                  <span>Open System Admin (Add Store / Customer)</span>
                </button>
                <button
                  onClick={() => setIsAccountOpen(true)}
                  className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 font-bold text-sm shadow-sm transition"
                >
                  Customer Account / Sign Up
                </button>
              </div>
            </div>
          )
        )}

        {currentView === 'admin' && (
          currentUser.role === 'SUPERMARKET_ADMIN' || currentUser.role === 'SYSTEM_ADMIN' ? (
            currentSupermarket ? (
              <AdminPortal
                currentSupermarket={currentSupermarket}
                onRefreshSupermarkets={loadSupermarkets}
                onSignOut={handleSignOut}
              />
            ) : (
              <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-6">
                <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto shadow-sm">
                  <Store className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">
                    No Store Selected or Registered
                  </h2>
                  <p className="text-sm text-slate-600 max-w-md mx-auto">
                    There are currently no supermarkets registered in the system. Add a supermarket in System Admin to manage inventory, staff, and pricing.
                  </p>
                </div>
                <button
                  onClick={() => setCurrentView('system')}
                  className="px-6 py-3 rounded-2xl bg-emerald-900 hover:bg-emerald-800 text-white font-bold text-sm transition"
                >
                  Open System Admin Portal
                </button>
              </div>
            )
          ) : (
            <StoreAdminSignIn
              supermarkets={supermarkets}
              selectedSupermarket={currentSupermarket}
              onSuccess={(user, sm) => {
                localStorage.setItem('smartcart_active_user', JSON.stringify(user));
                setCurrentUser(user);
                setCurrentSupermarket(sm);
                setCurrentView('admin');
              }}
              onSwitchToSystemAdmin={() => setCurrentView('system')}
              onBackToCustomer={() => setCurrentView('customer')}
            />
          )
        )}

        {currentView === 'system' && (
          currentUser.role === 'SYSTEM_ADMIN' ? (
            <SystemAdminPortal
              supermarkets={supermarkets}
              onRefreshSupermarkets={loadSupermarkets}
              onSelectSupermarket={(sm) => {
                handleSelectSupermarket(sm);
                setCurrentView('admin');
              }}
              onSignOut={handleSignOut}
            />
          ) : (
            <SystemAdminSignIn
              onSuccess={(user) => {
                localStorage.setItem('smartcart_active_user', JSON.stringify(user));
                setCurrentUser(user);
              }}
              onSwitchToStoreAdmin={() => setCurrentView('admin')}
              onBackToCustomer={() => setCurrentView('customer')}
            />
          )
        )}
      </main>

      {/* Modals */}
      <SupermarketSelectorModal
        isOpen={isSelectorOpen}
        onClose={() => setIsSelectorOpen(false)}
        supermarkets={supermarkets}
        currentSupermarket={currentSupermarket}
        onSelectSupermarket={handleSelectSupermarket}
      />

      {currentSupermarket && session && (
        <BarcodeScannerModal
          isOpen={isScannerOpen}
          onClose={() => setIsScannerOpen(false)}
          supermarket={currentSupermarket}
          sessionId={session.id}
          onItemAdded={handleItemAdded}
          onOpenSearch={() => setIsSearchOpen(true)}
        />
      )}

      <CartModal
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        session={session}
        supermarket={currentSupermarket}
        onUpdateQuantity={handleUpdateCartItem}
        onRemoveItem={handleRemoveCartItem}
        onOpenScanner={() => setIsScannerOpen(true)}
        onOpenSummary={() => setIsSummaryOpen(true)}
        onOpenBudget={() => setIsBudgetOpen(true)}
      />

      {session && (
        <BudgetModal
          isOpen={isBudgetOpen}
          onClose={() => setIsBudgetOpen(false)}
          currentBudget={session.budget || 2000}
          currentTotal={session.estimated_total}
          onSaveBudget={handleSaveBudget}
        />
      )}

      <ReceiptSummaryModal
        isOpen={isSummaryOpen}
        onClose={() => setIsSummaryOpen(false)}
        session={session}
        supermarket={currentSupermarket}
        onFinishShopping={handleFinishShopping}
      />

      {currentSupermarket && (
        <ProductSearchModal
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          supermarket={currentSupermarket}
          onAddToCart={handleItemAdded}
        />
      )}

      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        customerId={currentUser.id}
        onViewSessionDetails={(historicalSession) => {
          setSession(historicalSession);
          setIsSummaryOpen(true);
        }}
      />

      <LoyaltyModal
        isOpen={isLoyaltyOpen}
        onClose={() => setIsLoyaltyOpen(false)}
        loyalty={loyalty}
        customerName={currentUser.name}
      />

      <CustomerAccountModal
        isOpen={isAccountOpen}
        onClose={() => setIsAccountOpen(false)}
        currentUser={currentUser}
        onUserChanged={(user) => {
          setCurrentUser(user);
          if (currentSupermarket) {
            initSession(user.id, currentSupermarket.id, user.name);
          }
          loadCustomerLoyalty(user.id);
        }}
        currentSupermarket={currentSupermarket}
        loyalty={loyalty}
        onRefreshLoyalty={loadCustomerLoyalty}
      />

      {/* Discreet Private Staff & Admin Access Footer */}
      <footer className="mt-auto py-5 px-4 border-t border-slate-200/60 text-xs text-slate-500 bg-white/40 backdrop-blur-xs">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <p className="text-[11px] text-slate-500">
            SmartCart Scan &amp; Shop &bull; Self-Checkout Retail System
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (currentUser.role === 'SYSTEM_ADMIN') {
                  setCurrentView('system');
                } else if (currentUser.role === 'SUPERMARKET_ADMIN') {
                  setCurrentView('admin');
                } else {
                  setCurrentView('admin');
                }
              }}
              className="text-[11px] font-semibold text-slate-400 hover:text-emerald-800 flex items-center gap-1.5 transition px-2.5 py-1 rounded-lg hover:bg-slate-100"
              title="Private Staff and System Admin Sign In"
            >
              <Lock className="w-3 h-3 text-slate-400" />
              <span>Staff &amp; Admin Access</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
