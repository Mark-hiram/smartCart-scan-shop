import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';
import { Cart, CartItem, Branch, Supermarket, Promotion } from '../types';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  User,
  ShoppingBag,
  ArrowRight,
  ShieldAlert,
  Barcode,
  Package,
  Layers,
  BarChart3,
  Tag,
  Download,
  Plus,
} from 'lucide-react';

export const CashierView: React.FC = () => {
  const { user, branch, token } = useAuth();
  const { t } = useTranslation();

  const permissions = user?.permissions || {
    viewStock: false,
    editStock: false,
    viewPrices: false,
    editPrices: false,
    managePromotions: false,
    verifyCarts: true,
    viewReports: false,
  };

  // Determine initial active tab based on staff permissions
  const initialTab = permissions.verifyCarts
    ? 'till'
    : permissions.viewStock
    ? 'stock'
    : permissions.viewReports
    ? 'reports'
    : 'till';

  const [activeTab, setActiveTab] = useState<'till' | 'stock' | 'promotions' | 'reports'>(initialTab);

  // Till Station State
  const [cartCodeInput, setCartCodeInput] = useState('');
  const [activeCart, setActiveCart] = useState<Cart | null>(null);
  const [cartBranch, setCartBranch] = useState<Branch | null>(null);
  const [cartSupermarket, setCartSupermarket] = useState<Supermarket | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Flag mismatch modal
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagReason, setFlagReason] = useState('');

  // Stock / Catalogue State
  const [branchProducts, setBranchProducts] = useState<any[]>([]);
  const [stockSearchTerm, setStockSearchTerm] = useState('');
  const [editProductModal, setEditProductModal] = useState<any>(null);

  // Promotions State
  const [promotions, setPromotions] = useState<Promotion[]>([]);

  // Branch Reports State
  const [reportsData, setReportsData] = useState<any>(null);

  // Fetch branch products if staff has viewStock permission
  const loadBranchProducts = async () => {
    if (!branch) return;
    try {
      const res = await fetch(`/api/shopper/branch-products/${branch.id}`);
      if (res.ok) {
        const data = await res.json();
        setBranchProducts(data.products || []);
      }
    } catch (e) {}
  };

  // Fetch branch promotions
  const loadPromotions = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/owner/promotions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setPromotions(await res.json());
      }
    } catch (e) {}
  };

  // Fetch branch reports if staff has viewReports permission
  const loadBranchReports = async () => {
    if (!branch || !token) return;
    try {
      const res = await fetch(`/api/reports?branchId=${branch.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setReportsData(await res.json());
      }
    } catch (e) {}
  };

  useEffect(() => {
    if (activeTab === 'stock' && permissions.viewStock) {
      loadBranchProducts();
    } else if (activeTab === 'promotions' && permissions.managePromotions) {
      loadPromotions();
    } else if (activeTab === 'reports' && permissions.viewReports) {
      loadBranchReports();
    }
  }, [activeTab, branch]);

  // Lookup cart by short code
  const handleLookupCart = async (e?: React.FormEvent, customCode?: string) => {
    if (e) e.preventDefault();
    const code = (customCode || cartCodeInput).trim().toUpperCase();
    if (!code) return;

    setErrorMsg(null);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/cashier/lookup/${code}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setIsLoading(false);

      if (res.ok) {
        setActiveCart(data.cart);
        setCartBranch(data.branch);
        setCartSupermarket(data.supermarket);
      } else {
        setErrorMsg(data.error || 'Cart not found');
        setActiveCart(null);
      }
    } catch (e: any) {
      setIsLoading(false);
      setErrorMsg(e.message || 'Network error');
    }
  };

  // Toggle item checkmark
  const handleToggleItemCheck = async (item: CartItem) => {
    if (!activeCart) return;
    const newChecked = !item.verifiedByCashier;

    // Optimistic UI update
    const updatedItems = activeCart.items.map((i) =>
      i.id === item.id ? { ...i, verifiedByCashier: newChecked } : i
    );
    setActiveCart({ ...activeCart, items: updatedItems });

    try {
      await fetch('/api/cashier/toggle-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          cartId: activeCart.id,
          itemId: item.id,
          checked: newChecked,
        }),
      });
    } catch (e) {}
  };

  // Flag mismatch
  const handleConfirmFlag = async () => {
    if (!activeCart || !flagReason.trim()) return;
    try {
      const res = await fetch('/api/cashier/flag', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          cartId: activeCart.id,
          reason: flagReason.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveCart(data.cart);
        setShowFlagModal(false);
        setFlagReason('');
      }
    } catch (e) {}
  };

  // Mark Cart as Verified
  const handleVerifyCart = async () => {
    if (!activeCart) return;
    try {
      const res = await fetch('/api/cashier/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cartId: activeCart.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveCart(data.cart);
      }
    } catch (e) {}
  };

  // Complete Checkout at Till
  const handleCompleteCheckout = async () => {
    if (!activeCart) return;
    try {
      const res = await fetch('/api/cashier/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cartId: activeCart.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveCart(data.cart);
      }
    } catch (e) {}
  };

  // Save stock / price adjustment by authorized staff
  const handleSaveStockPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editProductModal || !branch) return;
    try {
      const res = await fetch('/api/owner/branch-product-override', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          branchId: branch.id,
          productId: editProductModal.id,
          stock: editProductModal.newStock,
          priceOverride: permissions.editPrices ? editProductModal.newPrice : undefined,
          lowStockThresholdOverride: editProductModal.newThreshold,
          aisleOverride: editProductModal.newAisle,
          shelfOverride: editProductModal.newShelf,
        }),
      });
      if (res.ok) {
        setEditProductModal(null);
        loadBranchProducts();
      } else {
        const err = await res.json();
        alert(err.error || t.permissionDenied);
      }
    } catch (e) {}
  };

  const verifiedItemsCount = activeCart?.items.filter((i) => i.verifiedByCashier).length || 0;
  const totalItemsCount = activeCart?.items.length || 0;
  const allVerified = totalItemsCount > 0 && verifiedItemsCount === totalItemsCount;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Title & Station Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Branch Staff Station
            </h1>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
              {branch?.name}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Logged in as <strong>{user?.name}</strong> ({user?.email})
          </p>
        </div>

        {/* Demo Shortcut buttons to load pre-seeded cart */}
        {permissions.verifyCarts && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setCartCodeInput('SC-8429');
                handleLookupCart(undefined, 'SC-8429');
              }}
              className="px-3 py-1.5 rounded-xl border border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold hover:bg-emerald-100 transition active:scale-95"
            >
              Load Demo Cart (SC-8429)
            </button>
          </div>
        )}
      </div>

      {/* Staff Segmented Navigation based on active permissions */}
      <div className="flex items-center gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-800 rounded-2xl overflow-x-auto">
        {permissions.verifyCarts && (
          <button
            onClick={() => setActiveTab('till')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === 'till'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Barcode className="w-4 h-4" />
            <span>Till Verification</span>
          </button>
        )}

        {permissions.viewStock && (
          <button
            onClick={() => setActiveTab('stock')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === 'stock'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>Branch Inventory &amp; Aisle</span>
          </button>
        )}

        {permissions.managePromotions && (
          <button
            onClick={() => setActiveTab('promotions')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === 'promotions'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Tag className="w-4 h-4" />
            <span>Branch Offers</span>
          </button>
        )}

        {permissions.viewReports && (
          <button
            onClick={() => setActiveTab('reports')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === 'reports'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Branch Analytics</span>
          </button>
        )}
      </div>

      {/* 1. TILL VERIFICATION TAB */}
      {activeTab === 'till' && permissions.verifyCarts && (
        <div className="space-y-4">
          {/* Cart Code Search Input */}
          <form onSubmit={handleLookupCart} className="flex gap-2">
            <div className="relative flex-1">
              <Barcode className="w-5 h-5 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={cartCodeInput}
                onChange={(e) => setCartCodeInput(e.target.value)}
                placeholder="Enter customer code e.g. SC-8429 or scan QR..."
                className="w-full h-11 pl-11 pr-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold text-sm tracking-wider uppercase focus:outline-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="h-11 px-5 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 text-white font-semibold text-xs flex items-center gap-2 transition active:scale-95 shrink-0"
            >
              <Search className="w-4 h-4" />
              <span>{isLoading ? 'Loading...' : t.lookupCart}</span>
            </button>
          </form>

          {/* Error Feedback */}
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Active Cart Verification Panel */}
          {activeCart && (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-md overflow-hidden animate-in fade-in">
              {/* Cart Header Card */}
              <div className="p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-black font-mono tracking-wider text-emerald-600">
                      {activeCart.shortCode}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        activeCart.status === 'verified'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                          : activeCart.status === 'flagged'
                          ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300'
                          : activeCart.status === 'completed'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                      }`}
                    >
                      {activeCart.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {activeCart.shopperName}
                    </span>
                    <span>·</span>
                    <span>{activeCart.shopperPhone}</span>
                    <span>·</span>
                    <span>{cartBranch?.name}</span>
                  </div>

                  {/* Phase 2: Offline cart indicator & warning */}
                  {activeCart.isOfflineCreated && (
                    <div className="mt-2 p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>{t.offlineWarningCashier}</span>
                    </div>
                  )}
                </div>

                <div className="text-right">
                  <span className="text-xs text-slate-400">Total to Ring at Register:</span>
                  <p className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">
                    KES {activeCart.finalTotal.toLocaleString()}
                  </p>
                  {activeCart.totalDiscount > 0 && (
                    <p className="text-[11px] text-emerald-600 font-semibold tabular-nums">
                      Includes KES {activeCart.totalDiscount} in verified promos
                    </p>
                  )}
                </div>
              </div>

              {/* Verification Progress Bar */}
              <div className="px-5 py-3 bg-slate-100/60 dark:bg-slate-800/80 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {t.verificationProgress}: {verifiedItemsCount} of {totalItemsCount} items checked
                </span>
                <span
                  className={`font-bold ${
                    allVerified ? 'text-emerald-600' : 'text-slate-500'
                  }`}
                >
                  {allVerified ? `✓ ${t.allVerified}` : `${Math.round((verifiedItemsCount / totalItemsCount) * 100)}%`}
                </span>
              </div>

              {/* Trolley Items Checklist */}
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
                {activeCart.items.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleToggleItemCheck(item)}
                    className={`p-4 flex items-center justify-between cursor-pointer transition select-none ${
                      item.verifiedByCashier
                        ? 'bg-emerald-50/40 dark:bg-emerald-950/20'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-3">
                      <input
                        type="checkbox"
                        checked={!!item.verifiedByCashier}
                        onChange={() => {}}
                        className="w-5 h-5 rounded-md text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer"
                      />
                      <div>
                        <p
                          className={`text-xs font-bold leading-tight ${
                            item.verifiedByCashier
                              ? 'line-through text-slate-400'
                              : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {item.name}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1">
                          <span className="font-mono tabular-nums">{item.barcode}</span>
                          <span>·</span>
                          <span className="font-medium text-slate-600 dark:text-slate-300">
                            Qty in Trolley: <strong className="text-xs text-emerald-600 font-bold">{item.quantity}</strong>
                          </span>
                          <span>·</span>
                          <span>Aisle {item.aisle || '—'} · Shelf {item.shelf || '—'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-white tabular-nums">
                        KES {item.effectiveTotal.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-slate-400 tabular-nums">
                        KES {item.lockedPrice} ea
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Buttons: Flag Mismatch vs Confirm Verification vs Complete */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <button
                  onClick={() => setShowFlagModal(true)}
                  className="py-2.5 px-4 rounded-xl border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-800 text-rose-600 font-semibold text-xs flex items-center gap-1.5 hover:bg-rose-50 transition active:scale-95"
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span>{t.flagMismatch}</span>
                </button>

                <div className="flex items-center gap-2">
                  {activeCart.status !== 'completed' && (
                    <button
                      onClick={handleVerifyCart}
                      disabled={activeCart.status === 'verified'}
                      className={`py-2.5 px-4 rounded-xl font-semibold text-xs flex items-center gap-1.5 transition active:scale-95 ${
                        activeCart.status === 'verified'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 cursor-default'
                          : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-md shadow-emerald-600/20'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        {activeCart.status === 'verified' ? 'Cart Verified' : t.confirmVerification}
                      </span>
                    </button>
                  )}

                  <button
                    onClick={handleCompleteCheckout}
                    disabled={activeCart.status === 'completed'}
                    className="py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 transition active:scale-95"
                  >
                    <span>{t.markCompleted}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. BRANCH STOCK & INVENTORY TAB */}
      {activeTab === 'stock' && permissions.viewStock && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Branch Inventory &amp; Aisle Locations ({branch?.name})
            </h2>
            <div className="relative w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={stockSearchTerm}
                onChange={(e) => setStockSearchTerm(e.target.value)}
                placeholder="Search stock..."
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs"
              />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b font-semibold">
                <tr>
                  <th className="p-3">Product</th>
                  <th className="p-3">{t.aisleShelfLocation}</th>
                  <th className="p-3">Current Stock</th>
                  <th className="p-3">Branch Price</th>
                  {permissions.editStock && <th className="p-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {branchProducts
                  .filter((p) => p.name.toLowerCase().includes(stockSearchTerm.toLowerCase()))
                  .map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="p-3">
                        <p className="font-bold text-slate-900 dark:text-white">{p.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{p.barcode}</p>
                      </td>
                      <td className="p-3">
                        <span className="font-mono text-slate-700 dark:text-slate-300">
                          Aisle {p.aisle || '—'} · Shelf {p.shelf || '—'}
                        </span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`font-bold font-mono ${
                            p.isLowStock ? 'text-amber-600' : 'text-emerald-600'
                          }`}
                        >
                          {p.stock} units
                        </span>
                      </td>
                      <td className="p-3 font-mono font-bold text-slate-900 dark:text-white">
                        KES {p.effectivePrice}
                      </td>
                      {permissions.editStock && (
                        <td className="p-3 text-right">
                          <button
                            onClick={() =>
                              setEditProductModal({
                                ...p,
                                newStock: p.stock,
                                newPrice: p.branchPrice,
                                newThreshold: p.lowStockThreshold,
                                newAisle: p.aisle,
                                newShelf: p.shelf,
                              })
                            }
                            className="px-2.5 py-1 rounded-lg border text-xs font-semibold hover:border-emerald-500"
                          >
                            Update
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. BRANCH REPORTS TAB */}
      {activeTab === 'reports' && permissions.viewReports && reportsData && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Branch Analytics ({branch?.name})
            </h2>
            <button
              onClick={() => window.open(`/api/reports/csv?type=traffic&branchId=${branch?.id}`, '_blank')}
              className="py-1.5 px-3 rounded-xl border text-xs font-semibold flex items-center gap-1 text-slate-700 dark:text-slate-300"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-xs text-slate-500">{t.totalCompletedCarts}</span>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                {reportsData.totals?.completedCarts || 0}
              </p>
            </div>
            <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-xs text-slate-500">{t.revenueLabel}</span>
              <p className="text-2xl font-black text-emerald-600 mt-1 tabular-nums">
                KES {(reportsData.totals?.totalRevenue || 0).toLocaleString()}
              </p>
            </div>
            <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-xs text-slate-500">{t.avgCartSize}</span>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                {reportsData.totals?.avgCartSize || 0} items
              </p>
            </div>
            <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
              <span className="text-xs text-slate-500">{t.avgCartValue}</span>
              <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">
                KES {(reportsData.totals?.avgCartValue || 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Flag Mismatch Modal */}
      {showFlagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center gap-2 text-rose-600">
              <ShieldAlert className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {t.flagMismatch}
              </h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Provide details of the discrepancy found during physical trolley inspection. This will be recorded in the audit log for store review.
            </p>

            <textarea
              rows={3}
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              placeholder={t.flagReasonPlaceholder}
              className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:outline-rose-500"
            />

            <div className="flex gap-2">
              <button
                onClick={() => setShowFlagModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                {t.cancel}
              </button>
              <button
                onClick={handleConfirmFlag}
                disabled={!flagReason.trim()}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-semibold text-xs transition"
              >
                Submit Flag
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Product Modal for Stock Clerk / Branch Manager */}
      {editProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Update Stock &amp; Location: {editProductModal.name}
            </h3>

            <form onSubmit={handleSaveStockPrice} className="space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1">Stock Level</label>
                <input
                  type="number"
                  value={editProductModal.newStock}
                  onChange={(e) =>
                    setEditProductModal({
                      ...editProductModal,
                      newStock: parseInt(e.target.value, 10),
                    })
                  }
                  className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                />
              </div>

              {permissions.editPrices && (
                <div>
                  <label className="text-xs font-semibold block mb-1">Branch Price (KES)</label>
                  <input
                    type="number"
                    value={editProductModal.newPrice || ''}
                    onChange={(e) =>
                      setEditProductModal({
                        ...editProductModal,
                        newPrice: e.target.value === '' ? null : parseFloat(e.target.value),
                      })
                    }
                    className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold block mb-1">{t.aisle}</label>
                  <input
                    type="text"
                    value={editProductModal.newAisle || ''}
                    onChange={(e) =>
                      setEditProductModal({ ...editProductModal, newAisle: e.target.value })
                    }
                    placeholder="e.g. 3"
                    className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">{t.shelf}</label>
                  <input
                    type="text"
                    value={editProductModal.newShelf || ''}
                    onChange={(e) =>
                      setEditProductModal({ ...editProductModal, newShelf: e.target.value })
                    }
                    placeholder="e.g. B"
                    className="w-full h-10 px-3 rounded-xl border text-xs font-mono"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditProductModal(null)}
                  className="flex-1 py-2.5 rounded-xl border text-xs font-semibold"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
