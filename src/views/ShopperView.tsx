import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { ManualBarcodeModal } from '../components/ManualBarcodeModal';
import { PriceCheckModal } from '../components/PriceCheckModal';
import { CartCodeModal } from '../components/CartCodeModal';
import { BudgetAlert } from '../components/BudgetAlert';
import { ShopperTab, BottomNav } from '../components/BottomNav';
import {
  EnrichedProduct,
  Cart,
  CartItem,
  Product,
  Promotion,
  ShoppingList,
  ShoppingListItem,
} from '../types';
import {
  ShoppingBag,
  Trash2,
  Plus,
  Minus,
  AlertTriangle,
  QrCode,
  Tag,
  CheckCircle,
  Clock,
  ListChecks,
  Share2,
  Sparkles,
  Store,
  WifiOff,
  Heart,
  RotateCcw,
  ArrowUpDown,
  Copy,
  ExternalLink,
  MapPin,
  Check,
  RefreshCw,
} from 'lucide-react';

interface ShopperViewProps {
  onOpenStoreModal: () => void;
}

export const ShopperView: React.FC<ShopperViewProps> = ({ onOpenStoreModal }) => {
  const { branch, user, token } = useAuth();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<ShopperTab>('scan');
  const [products, setProducts] = useState<EnrichedProduct[]>([]);
  const [cart, setCart] = useState<Cart | null>(null);
  const [favourites, setFavourites] = useState<string[]>([]);

  // Modals & Sheets
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isPriceCheckModalOpen, setIsPriceCheckModalOpen] = useState(false);
  const [isCartCodeModalOpen, setIsCartCodeModalOpen] = useState(false);
  const [priceCheckData, setPriceCheckData] = useState<{
    product: Product;
    effectivePrice: number;
    stock: number;
    isLowStock: boolean;
    promotion: Promotion | null;
  } | null>(null);

  // Budget limit input state (Phase 2 Daily Spending Cap)
  const [budgetInput, setBudgetInput] = useState<string>('');
  const [isEditingBudget, setIsEditingBudget] = useState(false);

  // Shopper history & lists (Phase 2)
  const [history, setHistory] = useState<Cart[]>([]);
  const [shoppingLists, setShoppingLists] = useState<ShoppingList[]>([]);
  const [selectedList, setSelectedList] = useState<ShoppingList | null>(null);
  const [newListTitle, setNewListTitle] = useState('');
  const [newListCanEdit, setNewListCanEdit] = useState(true);
  const [showCreateListModal, setShowCreateListModal] = useState(false);
  const [searchItemForList, setSearchItemForList] = useState('');
  const [listSortByAisle, setListSortByAisle] = useState(false);
  const [reAddSuccessMsg, setReAddSuccessMsg] = useState<string | null>(null);
  const [copyShareSuccess, setCopyShareSuccess] = useState<string | null>(null);

  // Lists Subtab: 'lists' | 'favourites'
  const [listsSubTab, setListsSubTab] = useState<'lists' | 'favourites'>('lists');

  // Offline detection & local cart sync
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isSyncingCart, setIsSyncingCart] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // Fetch branch products catalogue (with local caching for offline capability)
  const loadBranchProducts = async () => {
    if (!branch) return;
    try {
      const res = await fetch(`/api/shopper/branch-products/${branch.id}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
        // Save to offline cache
        try {
          localStorage.setItem(`offline_products_${branch.id}`, JSON.stringify(data.products || []));
        } catch (e) {}
      } else {
        // Fallback to local storage if offline
        const cached = localStorage.getItem(`offline_products_${branch.id}`);
        if (cached) setProducts(JSON.parse(cached));
      }
    } catch (e) {
      // Network failed: fallback to offline cache
      const cached = localStorage.getItem(`offline_products_${branch.id}`);
      if (cached) setProducts(JSON.parse(cached));
    }
  };

  // Fetch or initialize cart
  const loadCart = async () => {
    if (!branch) return;
    try {
      const res = await fetch(`/api/shopper/cart?branchId=${branch.id}`);
      if (res.ok) {
        const data = await res.json();
        setCart(data);
        if (data?.budgetLimit) {
          setBudgetInput(data.budgetLimit.toString());
        }
        // Save cart to local storage for offline continuity
        localStorage.setItem(`offline_cart_${branch.id}`, JSON.stringify(data));
      }
    } catch (e) {
      // Offline fallback: load cached cart
      const cached = localStorage.getItem(`offline_cart_${branch.id}`);
      if (cached) setCart(JSON.parse(cached));
    }
  };

  // Load favourites
  const loadFavourites = async () => {
    try {
      const saved = localStorage.getItem(`shopper_favourites_${user?.id || 'guest'}`);
      if (saved) {
        setFavourites(JSON.parse(saved));
      }
      if (token) {
        const res = await fetch('/api/shopper/favourites', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setFavourites(data);
          localStorage.setItem(`shopper_favourites_${user?.id || 'guest'}`, JSON.stringify(data));
        }
      }
    } catch (e) {}
  };

  // Toggle Favourite
  const handleToggleFavourite = async (productId: string, barcode: string) => {
    const isFav = favourites.includes(productId);
    const updated = isFav ? favourites.filter((id) => id !== productId) : [...favourites, productId];
    setFavourites(updated);
    localStorage.setItem(`shopper_favourites_${user?.id || 'guest'}`, JSON.stringify(updated));

    if (token) {
      try {
        await fetch('/api/shopper/favourites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ productId, barcode }),
        });
      } catch (e) {}
    }
  };

  // Load shopping lists
  const loadShoppingLists = async () => {
    try {
      const res = await fetch('/api/shopper/shopping-lists', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setShoppingLists(data);
        if (data.length > 0 && !selectedList) {
          setSelectedList(data[0]);
        }
      }
    } catch (e) {}
  };

  // Fetch shopper past history
  const loadHistory = async () => {
    try {
      const res = await fetch('/api/shopper/history', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (e) {}
  };

  // Sync offline cart to server
  const syncOfflineCartToServer = async () => {
    if (!branch) return;
    const cached = localStorage.getItem(`offline_cart_${branch.id}`);
    if (!cached) return;
    const localCart: Cart = JSON.parse(cached);
    if (!localCart.items || localCart.items.length === 0) return;

    setIsSyncingCart(true);
    try {
      const res = await fetch('/api/shopper/cart/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          branchId: branch.id,
          cartId: localCart.id,
          items: localCart.items,
          budgetLimit: localCart.budgetLimit,
        }),
      });
      if (res.ok) {
        const synced = await res.json();
        setCart(synced);
        localStorage.setItem(`offline_cart_${branch.id}`, JSON.stringify(synced));
        setSyncNotice(t.cartSyncSuccess);
        setTimeout(() => setSyncNotice(null), 4000);
      }
    } catch (e) {
      console.warn('Sync failed:', e);
    } finally {
      setIsSyncingCart(false);
    }
  };

  // Offline / Online listeners & auto-sync
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      syncOfflineCartToServer();
    };
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [branch]);

  useEffect(() => {
    if (branch) {
      loadBranchProducts();
      loadCart();
      loadFavourites();
      loadShoppingLists();
    }
  }, [branch]);

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    } else if (activeTab === 'lists') {
      loadShoppingLists();
      loadFavourites();
    }
  }, [activeTab]);

  // Handle scanned barcode (Works seamlessly online and offline)
  const handleBarcodeScanned = async (barcode: string) => {
    if (!branch) {
      onOpenStoreModal();
      return;
    }

    // Try finding product in local product catalogue
    const localProd = products.find((p) => p.barcode === barcode);

    if (activeTab === 'price_check') {
      if (localProd) {
        setPriceCheckData({
          product: localProd,
          effectivePrice: localProd.effectivePrice,
          stock: localProd.stock,
          isLowStock: localProd.isLowStock,
          promotion: localProd.activePromotion || null,
        });
        setIsPriceCheckModalOpen(true);
        return;
      }

      // Try server lookup if online
      if (!isOffline) {
        try {
          const res = await fetch('/api/shopper/scan-lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ branchId: branch.id, barcode }),
          });
          const data = await res.json();
          if (res.ok) {
            setPriceCheckData({
              product: data.product,
              effectivePrice: data.effectivePrice,
              stock: data.stock,
              isLowStock: data.isLowStock,
              promotion: data.activePromotion,
            });
            setIsPriceCheckModalOpen(true);
            return;
          }
        } catch (e) {}
      }
      alert(t.noProductFound);
      return;
    }

    // NORMAL ADD TO CART (Works both Online & Offline)
    if (isOffline || !navigator.onLine) {
      // Offline mode cart handling
      if (!localProd) {
        alert(t.noProductFound);
        return;
      }

      // Build local item with locked price
      const existingCart: Cart = cart || {
        id: `offline-cart-${Date.now()}`,
        shortCode: `OFF-${Math.floor(1000 + Math.random() * 9000)}`,
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
        budgetLimit: budgetInput ? parseFloat(budgetInput) : null,
        isOfflineCreated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const existingItem = existingCart.items.find((i) => i.barcode === barcode);
      if (existingItem) {
        existingItem.quantity += 1;
        existingItem.effectiveTotal = existingItem.quantity * existingItem.lockedPrice;
      } else {
        existingCart.items.push({
          id: `item-${Date.now()}`,
          productId: localProd.id,
          barcode: localProd.barcode,
          name: localProd.name,
          category: localProd.category,
          aisle: localProd.aisle || '',
          shelf: localProd.shelf || '',
          aisleShelf: localProd.aisleShelf,
          quantity: 1,
          lockedPrice: localProd.effectivePrice,
          originalBasePrice: localProd.basePrice,
          discount: Math.max(0, localProd.basePrice - localProd.effectivePrice),
          effectiveTotal: localProd.effectivePrice,
          promoName: localProd.activePromotion?.name,
          scannedAt: new Date().toISOString(),
        });
      }

      // Recompute totals
      let subtotal = 0;
      let finalTotal = 0;
      for (const it of existingCart.items) {
        subtotal += it.originalBasePrice * it.quantity;
        finalTotal += it.effectiveTotal;
      }
      existingCart.subtotal = subtotal;
      existingCart.finalTotal = finalTotal;
      existingCart.totalDiscount = Math.max(0, subtotal - finalTotal);
      existingCart.isOfflineCreated = true;

      setCart({ ...existingCart });
      localStorage.setItem(`offline_cart_${branch.id}`, JSON.stringify(existingCart));
      return;
    }

    // Online Add to Cart
    try {
      const res = await fetch('/api/shopper/cart/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: branch.id, barcode, quantity: 1 }),
      });
      const updatedCart = await res.json();
      if (res.ok) {
        setCart(updatedCart);
        localStorage.setItem(`offline_cart_${branch.id}`, JSON.stringify(updatedCart));
      } else {
        alert(updatedCart.error || t.noProductFound);
      }
    } catch (e: any) {
      alert(e.message || 'Error processing barcode');
    }
  };

  // Quantity adjustments
  const handleUpdateQuantity = async (itemId: string, newQty: number) => {
    if (!cart) return;

    if (isOffline) {
      // Local offline update
      const updatedItems = cart.items
        .map((it) => {
          if (it.id === itemId) {
            return {
              ...it,
              quantity: newQty,
              effectiveTotal: newQty * it.lockedPrice,
            };
          }
          return it;
        })
        .filter((it) => it.quantity > 0);

      let subtotal = 0;
      let finalTotal = 0;
      for (const it of updatedItems) {
        subtotal += it.originalBasePrice * it.quantity;
        finalTotal += it.effectiveTotal;
      }
      const updatedCart: Cart = {
        ...cart,
        items: updatedItems,
        subtotal,
        finalTotal,
        totalDiscount: Math.max(0, subtotal - finalTotal),
        isOfflineCreated: true,
      };
      setCart(updatedCart);
      const branchKey = branch?.id || cart.branchId;
      localStorage.setItem(`offline_cart_${branchKey}`, JSON.stringify(updatedCart));
      return;
    }

    try {
      const res = await fetch('/api/shopper/cart/quantity', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartId: cart.id, itemId, quantity: newQty }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCart(updated);
        const branchKey = branch?.id || cart.branchId;
        localStorage.setItem(`offline_cart_${branchKey}`, JSON.stringify(updated));
      }
    } catch (e) {}
  };

  // Update budget limit (Phase 2 Daily Spending Cap) via BudgetAlert component
  const handleUpdateBudgetLimit = async (limit: number | null) => {
    if (cart) {
      const updatedCart = { ...cart, budgetLimit: limit };
      setCart(updatedCart);
      const branchKey = branch?.id || cart.branchId;
      localStorage.setItem(`offline_cart_${branchKey}`, JSON.stringify(updatedCart));

      if (!isOffline) {
        try {
          await fetch('/api/shopper/cart/budget', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cartId: cart.id, budgetLimit: limit }),
          });
        } catch (e) {}
      }
    }
  };

  // Finish shopping & generate till checkout code
  const handleFinishShopping = async () => {
    if (!cart || cart.items.length === 0) return;
    if (isOffline) {
      // Offline lock: generate till code locally
      const lockedCart = { ...cart, status: 'locked' as const };
      setCart(lockedCart);
      setIsCartCodeModalOpen(true);
      return;
    }

    try {
      const res = await fetch('/api/shopper/cart/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartId: cart.id }),
      });
      if (res.ok) {
        const lockedCart = await res.json();
        setCart(lockedCart);
        setIsCartCodeModalOpen(true);
      }
    } catch (e) {}
  };

  // Empty cart
  const handleClearCart = async () => {
    if (!cart || !confirm('Are you sure you want to empty your cart?')) return;
    if (isOffline) {
      const emptyCart: Cart = {
        ...cart,
        items: [],
        subtotal: 0,
        totalDiscount: 0,
        finalTotal: 0,
      };
      setCart(emptyCart);
      const branchKey = branch?.id || cart.branchId;
      localStorage.setItem(`offline_cart_${branchKey}`, JSON.stringify(emptyCart));
      return;
    }

    try {
      const res = await fetch(`/api/shopper/cart/${cart.id}`, { method: 'DELETE' });
      if (res.ok) {
        const emptied = await res.json();
        setCart(emptied);
      }
    } catch (e) {}
  };

  // Phase 2: Re-add past cart items
  const handleReAddPastCart = async (pastCartId: string) => {
    if (!branch) return;
    try {
      const res = await fetch('/api/shopper/cart/re-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ branchId: branch.id, cartId: pastCartId }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCart(updated);
        setReAddSuccessMsg(t.reAddSuccess);
        setActiveTab('cart');
        setTimeout(() => setReAddSuccessMsg(null), 4000);
      }
    } catch (e) {}
  };

  // Phase 2: Create new shopping list
  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListTitle.trim()) return;
    try {
      const res = await fetch('/api/shopper/shopping-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: newListTitle.trim(),
          canEdit: newListCanEdit,
          items: [],
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setShoppingLists([created, ...shoppingLists]);
        setSelectedList(created);
        setNewListTitle('');
        setShowCreateListModal(false);
      }
    } catch (e) {}
  };

  // Phase 2: Add item to shopping list
  const handleAddItemToCurrentList = async (product: EnrichedProduct) => {
    if (!selectedList) return;
    const newItem: ShoppingListItem = {
      id: `li-${Date.now()}`,
      barcode: product.barcode,
      productName: product.name,
      quantity: 1,
      completed: false,
      aisle: product.aisle,
      shelf: product.shelf,
      estimatedPrice: product.effectivePrice,
    };
    const updatedItems = [...selectedList.items, newItem];
    const updatedList = { ...selectedList, items: updatedItems };
    setSelectedList(updatedList);
    setShoppingLists(shoppingLists.map((l) => (l.id === updatedList.id ? updatedList : l)));

    try {
      await fetch(`/api/shopper/shopping-lists/${selectedList.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items: updatedItems }),
      });
    } catch (e) {}
  };

  // Phase 2: Toggle item completion in shopping list
  const handleToggleListItemDone = async (itemId: string) => {
    if (!selectedList) return;
    const updatedItems = selectedList.items.map((it) =>
      it.id === itemId ? { ...it, completed: !it.completed } : it
    );
    const updatedList = { ...selectedList, items: updatedItems };
    setSelectedList(updatedList);
    setShoppingLists(shoppingLists.map((l) => (l.id === updatedList.id ? updatedList : l)));

    try {
      await fetch(`/api/shopper/shopping-lists/${selectedList.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items: updatedItems }),
      });
    } catch (e) {}
  };

  // Phase 2: Turn shopping list into active cart
  const handleConvertListToCart = async (listId: string) => {
    if (!branch) return;
    try {
      const res = await fetch('/api/shopper/shopping-lists/convert-to-cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listId, branchId: branch.id }),
      });
      if (res.ok) {
        const updatedCart = await res.json();
        setCart(updatedCart);
        setActiveTab('cart');
      }
    } catch (e) {}
  };

  // Phase 2: Sort list items by Aisle sequence
  const sortedListItems = useMemo(() => {
    if (!selectedList) return [];
    if (!listSortByAisle) return selectedList.items;
    return [...selectedList.items].sort((a, b) => {
      const aisleA = parseInt(a.aisle || '999', 10);
      const aisleB = parseInt(b.aisle || '999', 10);
      return aisleA - aisleB;
    });
  }, [selectedList, listSortByAisle]);

  // Expected total for selected shopping list
  const listExpectedTotal = useMemo(() => {
    if (!selectedList) return 0;
    return selectedList.items.reduce((sum, item) => sum + (item.estimatedPrice || 0) * item.quantity, 0);
  }, [selectedList]);

  // Budget calculations (Daily Spending Cap)
  const budgetLimit = cart?.budgetLimit || 0;
  const currentTotal = cart?.finalTotal || 0;
  const budgetRatio = budgetLimit > 0 ? currentTotal / budgetLimit : 0;
  const isBudgetApproaching = budgetLimit > 0 && budgetRatio >= 0.85 && budgetRatio < 1;
  const isBudgetExceeded = budgetLimit > 0 && budgetRatio >= 1;

  // Total items in cart
  const totalItemCount = cart?.items.reduce((sum, item) => sum + item.quantity, 0) || 0;

  // Favourite products list
  const favouriteProducts = useMemo(() => {
    return products.filter((p) => favourites.includes(p.id));
  }, [products, favourites]);

  return (
    <div className="pb-24 pt-3 max-w-xl mx-auto px-4">
      {/* Offline Alert Banner */}
      {isOffline && (
        <div className="mb-3 p-3 rounded-2xl bg-amber-500 text-white text-xs font-semibold flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 shrink-0 animate-pulse" />
            <span>{t.offlineMode}</span>
          </div>
          {cart && cart.isOfflineCreated && (
            <span className="text-[10px] bg-amber-600 px-2 py-0.5 rounded-full font-mono">
              Offline Cart Active
            </span>
          )}
        </div>
      )}

      {/* Sync Notification Banner */}
      {syncNotice && (
        <div className="mb-3 p-3 rounded-2xl bg-emerald-600 text-white text-xs font-semibold flex items-center gap-2 shadow-sm animate-in fade-in">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{syncNotice}</span>
        </div>
      )}

      {/* Re-add Notification */}
      {reAddSuccessMsg && (
        <div className="mb-3 p-3 rounded-2xl bg-emerald-600 text-white text-xs font-semibold flex items-center gap-2 shadow-sm animate-in fade-in">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{reAddSuccessMsg}</span>
        </div>
      )}

      {/* Store Prompt if no branch selected */}
      {!branch && (
        <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md text-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center mx-auto mb-3">
            <Store className="w-7 h-7" />
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-1">
            {t.selectSupermarket} &amp; {t.selectBranch}
          </h2>
          <p className="text-xs text-slate-500 mb-4 max-w-xs mx-auto">
            Choose your supermarket chain and branch to view local prices and start scanning items.
          </p>
          <button
            onClick={onOpenStoreModal}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition shadow-sm"
          >
            {t.nearestBranch}
          </button>
        </div>
      )}

      {/* New BudgetAlert component displaying cart total against user-configurable limit with approach warnings */}
      {branch && (
        <div className="mb-4">
          <BudgetAlert
            cartTotal={cart?.finalTotal || 0}
            budgetLimit={cart?.budgetLimit}
            onUpdateBudget={handleUpdateBudgetLimit}
            currency="KES"
          />
        </div>
      )}

      {/* TAB 1: SCAN VIEW */}
      {branch && activeTab === 'scan' && (
        <div className="space-y-4">
          <BarcodeScanner
            onScan={handleBarcodeScanned}
            isPriceCheckMode={false}
            onTogglePriceCheckMode={() => setActiveTab('price_check')}
            onOpenManualInput={() => setIsManualModalOpen(true)}
            sampleBarcodes={products.map((p) => ({
              name: p.name,
              barcode: p.barcode,
              price: p.effectivePrice,
            }))}
          />

          {/* Quick Mini Running Total Bar */}
          {cart && cart.items.length > 0 && (
            <div
              onClick={() => setActiveTab('cart')}
              className="p-3.5 rounded-2xl bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-between cursor-pointer active:scale-98 transition shadow-lg shadow-slate-900/10"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center">
                  <ShoppingBag className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-xs font-semibold">
                    {totalItemCount} {t.itemsCount} in cart
                  </p>
                  <p className="text-[10px] text-slate-400">Tap to review cart items</p>
                </div>
              </div>

              <div className="text-right">
                <p className="text-xs text-slate-400">{t.runningTotal}</p>
                <p className="text-base font-black text-emerald-400 tabular-nums">
                  KES {cart.finalTotal.toLocaleString()}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CART VIEW */}
      {branch && activeTab === 'cart' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          {/* Header Summary */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {t.yourCart}
            </h2>
            <div className="flex items-center gap-2">
              {isOffline && cart && cart.isOfflineCreated && (
                <button
                  onClick={syncOfflineCartToServer}
                  disabled={isSyncingCart}
                  className="text-xs text-emerald-600 font-semibold flex items-center gap-1 p-1"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCart ? 'animate-spin' : ''}`} />
                  <span>{t.syncCartNow}</span>
                </button>
              )}
              {cart && cart.items.length > 0 && (
                <button
                  onClick={handleClearCart}
                  className="text-xs text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1 p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t.clearCart}</span>
                </button>
              )}
            </div>
          </div>

          {/* Cart Item List with discrete Aisle and Shelf Badges */}
          {cart && cart.items.length > 0 ? (
            <div className="space-y-2.5">
              {cart.items.map((item) => (
                <div
                  key={item.id}
                  className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between gap-2"
                >
                  <div className="flex items-start justify-between">
                    <div className="pr-2">
                      <p className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                        {item.name}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1">
                        <span className="font-mono tabular-nums">{item.barcode}</span>
                        <span>·</span>
                        <span className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          Aisle {item.aisle || '—'} · Shelf {item.shelf || '—'}
                        </span>
                      </div>
                      {item.promoName && (
                        <span className="inline-block mt-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
                          {item.promoName}
                        </span>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-white tabular-nums">
                        KES {item.effectiveTotal.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-slate-400 tabular-nums">
                        KES {item.lockedPrice} each
                      </p>
                    </div>
                  </div>

                  {/* Quantity Stepper & Delete */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-[10px] text-slate-400 italic">
                      Price locked at scan
                    </span>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-800">
                        <button
                          onClick={() => handleUpdateQuantity(item.id, item.quantity - 1)}
                          className="w-8 h-8 flex items-center justify-center text-slate-600 hover:text-slate-900 dark:text-slate-300"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-8 text-center text-xs font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => handleUpdateQuantity(item.id, item.quantity + 1)}
                          className="w-8 h-8 flex items-center justify-center text-slate-600 hover:text-slate-900 dark:text-slate-300"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <button
                        onClick={() => handleUpdateQuantity(item.id, 0)}
                        className="p-2 text-slate-400 hover:text-rose-600 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {/* Running Total Card & Finish Button */}
              <div className="p-4 rounded-3xl bg-slate-900 text-white shadow-xl space-y-3 mt-4">
                <div className="space-y-1.5 text-xs text-slate-300">
                  <div className="flex justify-between">
                    <span>{t.subtotal}</span>
                    <span className="font-mono tabular-nums">KES {cart.subtotal.toLocaleString()}</span>
                  </div>
                  {cart.totalDiscount > 0 && (
                    <div className="flex justify-between text-emerald-400 font-semibold">
                      <span>{t.promoSavings}</span>
                      <span className="font-mono tabular-nums">- KES {cart.totalDiscount.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-black text-white pt-2 border-t border-slate-800">
                    <span>{t.finalPayable}</span>
                    <span className="font-mono tabular-nums text-emerald-400">
                      KES {cart.finalTotal.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="text-[10px] text-slate-400 text-center leading-relaxed">
                  {t.checkoutNotice}
                </div>

                <button
                  onClick={handleFinishShopping}
                  className="w-full h-12 rounded-2xl bg-emerald-500 hover:bg-emerald-600 active:scale-98 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition shadow-lg shadow-emerald-500/20"
                >
                  <QrCode className="w-4 h-4" />
                  <span>{t.generateCashierCode}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
              <ShoppingBag className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
                {t.emptyCartTitle}
              </h3>
              <p className="text-xs text-slate-500 max-w-xs mx-auto mb-4">
                {t.emptyCartDesc}
              </p>
              <button
                onClick={() => setActiveTab('scan')}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-xs transition"
              >
                Start Scanning
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: PRICE CHECK VIEW */}
      {branch && activeTab === 'price_check' && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
            <Tag className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                {t.priceCheckMode}
              </p>
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                {t.priceCheckDesc}
              </p>
            </div>
          </div>

          <BarcodeScanner
            onScan={handleBarcodeScanned}
            isPriceCheckMode={true}
            onTogglePriceCheckMode={() => setActiveTab('scan')}
            onOpenManualInput={() => setIsManualModalOpen(true)}
            sampleBarcodes={products.map((p) => ({
              name: p.name,
              barcode: p.barcode,
              price: p.effectivePrice,
            }))}
          />
        </div>
      )}

      {/* TAB 4: SHOPPING LISTS & FAVOURITES (PHASE 2) */}
      {branch && activeTab === 'lists' && (
        <div className="space-y-4">
          {/* Subtabs: Lists vs Favourites */}
          <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
            <button
              onClick={() => setListsSubTab('lists')}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition ${
                listsSubTab === 'lists'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {t.shoppingLists}
            </button>
            <button
              onClick={() => setListsSubTab('favourites')}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 ${
                listsSubTab === 'favourites'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
              <span>{t.favourites} ({favourites.length})</span>
            </button>
          </div>

          {/* Subtab Content: Favourites */}
          {listsSubTab === 'favourites' && (
            <div className="space-y-3">
              {favouriteProducts.length > 0 ? (
                favouriteProducts.map((p) => (
                  <div
                    key={p.id}
                    className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {p.name}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                        <span className="font-mono">{p.barcode}</span>
                        <span>·</span>
                        <span className="text-slate-600 dark:text-slate-300">
                          Aisle {p.aisle || '—'} · Shelf {p.shelf || '—'}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-emerald-600 mt-1 tabular-nums">
                        KES {p.effectivePrice}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleFavourite(p.id, p.barcode)}
                        className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl"
                      >
                        <Heart className="w-4 h-4 fill-rose-500" />
                      </button>
                      <button
                        onClick={() => handleBarcodeScanned(p.barcode)}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition"
                      >
                        {t.addToCart}
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-2">
                  <Heart className="w-10 h-10 text-slate-300 mx-auto" />
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">{t.noFavouritesYet}</h4>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    {t.noFavouritesDesc}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Subtab Content: Shopping Lists */}
          {listsSubTab === 'lists' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <select
                  value={selectedList?.id || ''}
                  onChange={(e) => {
                    const found = shoppingLists.find((l) => l.id === e.target.value);
                    if (found) setSelectedList(found);
                  }}
                  className="h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-900 dark:text-white"
                >
                  {shoppingLists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title} ({l.items.length} items)
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => setShowCreateListModal(true)}
                  className="py-2 px-3 rounded-xl bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t.createList}</span>
                </button>
              </div>

              {selectedList && (
                <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                  {/* List Header & Share code */}
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        {selectedList.title}
                      </h3>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                        Share Code: <strong className="text-emerald-600">{selectedList.shareCode}</strong>
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const url = `${window.location.origin}/#list=${selectedList.shareCode}`;
                          navigator.clipboard.writeText(url);
                          setCopyShareSuccess(t.linkCopied);
                          setTimeout(() => setCopyShareSuccess(null), 3000);
                        }}
                        className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 text-xs flex items-center gap-1 font-semibold"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>{t.shareLink}</span>
                      </button>

                      {/* Sort by Aisle sequence button */}
                      <button
                        onClick={() => setListSortByAisle(!listSortByAisle)}
                        className={`p-2 rounded-xl text-xs font-semibold flex items-center gap-1 border transition ${
                          listSortByAisle
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                        title="Sort items by aisle number so you walk the store in order"
                      >
                        <ArrowUpDown className="w-3.5 h-3.5" />
                        <span>{t.sortByAisle}</span>
                      </button>
                    </div>
                  </div>

                  {copyShareSuccess && (
                    <div className="p-2 rounded-xl bg-emerald-50 text-emerald-800 text-[11px] font-semibold flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{copyShareSuccess}</span>
                    </div>
                  )}

                  {/* Add item to list search input */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {t.addItemToList}
                    </label>
                    <input
                      type="text"
                      value={searchItemForList}
                      onChange={(e) => setSearchItemForList(e.target.value)}
                      placeholder={t.searchProductToAdd}
                      className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:outline-emerald-500"
                    />

                    {searchItemForList.trim() && (
                      <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
                        {products
                          .filter((p) => p.name.toLowerCase().includes(searchItemForList.toLowerCase()))
                          .slice(0, 5)
                          .map((p) => (
                            <div
                              key={p.id}
                              onClick={() => {
                                handleAddItemToCurrentList(p);
                                setSearchItemForList('');
                              }}
                              className="p-2.5 flex items-center justify-between text-xs hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <div>
                                <p className="font-semibold">{p.name}</p>
                                <p className="text-[10px] text-slate-400">
                                  Aisle {p.aisle || '—'} · Shelf {p.shelf || '—'}
                                </p>
                              </div>
                              <span className="font-mono text-emerald-600 font-bold">
                                KES {p.effectivePrice}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Checkable items in Aisle order */}
                  <div className="space-y-2">
                    {sortedListItems.map((it) => (
                      <div
                        key={it.id}
                        onClick={() => handleToggleListItemDone(it.id)}
                        className={`p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between ${
                          it.completed
                            ? 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 opacity-60'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xs'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={it.completed}
                            onChange={() => {}}
                            className="w-4 h-4 rounded text-emerald-600 pointer-events-none"
                          />
                          <div>
                            <p className={`text-xs font-bold ${it.completed ? 'line-through text-slate-400' : 'text-slate-900 dark:text-white'}`}>
                              {it.productName}
                            </p>
                            <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5 font-medium">
                              <MapPin className="w-3 h-3" />
                              Aisle {it.aisle || '—'} · Shelf {it.shelf || '—'}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                            KES {it.estimatedPrice || '—'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Convert List to Cart Banner */}
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">{t.expectedTotal}</p>
                      <p className="text-base font-black text-emerald-600 tabular-nums">
                        KES {listExpectedTotal.toLocaleString()}
                      </p>
                    </div>

                    <button
                      onClick={() => handleConvertListToCart(selectedList.id)}
                      className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
                    >
                      <ShoppingBag className="w-4 h-4" />
                      <span>{t.convertListToCart}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: PAST HISTORY VIEW (PHASE 2) */}
      {branch && activeTab === 'history' && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {t.navHistory}
          </h2>

          <div className="space-y-3">
            {history.length > 0 ? (
              history.map((h) => (
                <div
                  key={h.id}
                  className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-mono font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md">
                        {h.shortCode}
                      </span>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {new Date(h.createdAt).toLocaleDateString()} at {new Date(h.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-xs text-slate-400">{t.totalSpent}</p>
                      <p className="text-sm font-black text-slate-900 dark:text-white tabular-nums">
                        KES {h.finalTotal.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {/* List of items in that past cart */}
                  <div className="text-xs text-slate-600 dark:text-slate-300 divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-2xl">
                    {h.items.map((it, idx) => (
                      <div key={idx} className="py-1 flex justify-between text-[11px]">
                        <span>{it.quantity}x {it.name}</span>
                        <span className="font-mono text-slate-400">KES {it.effectiveTotal}</span>
                      </div>
                    ))}
                  </div>

                  {/* Re-add all items to active cart button */}
                  <div className="pt-1 flex justify-end">
                    <button
                      onClick={() => handleReAddPastCart(h.id)}
                      className="py-2 px-3.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{t.reAddCart}</span>
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
                <Clock className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-slate-400">{t.noPastCarts}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Bottom Nav for Mobile Touch Thumb Reach */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        cartItemCount={totalItemCount}
        cartRunningTotal={cart?.finalTotal || 0}
      />

      {/* Modal: Create New Shopping List */}
      {showCreateListModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{t.createList}</h3>
            <form onSubmit={handleCreateList} className="space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1">{t.listName}</label>
                <input
                  type="text"
                  required
                  value={newListTitle}
                  onChange={(e) => setNewListTitle(e.target.value)}
                  placeholder="e.g. Weekly Groceries, BBQ Party..."
                  className="w-full h-10 px-3 rounded-xl border text-xs"
                />
              </div>

              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={newListCanEdit}
                  onChange={(e) => setNewListCanEdit(e.target.checked)}
                  className="rounded text-emerald-600"
                />
                <span>{t.allowEditing}</span>
              </label>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateListModal(false)}
                  className="flex-1 py-2.5 rounded-xl border text-xs font-semibold"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
                >
                  Create List
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Search & Code Modal with Aisle / Shelf */}
      <ManualBarcodeModal
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        products={products}
        onSelectProduct={handleBarcodeScanned}
        isPriceCheckMode={activeTab === 'price_check'}
      />

      {/* Price Check Result Modal */}
      <PriceCheckModal
        product={priceCheckData?.product || null}
        effectivePrice={priceCheckData?.effectivePrice || 0}
        stock={priceCheckData?.stock || 0}
        isLowStock={priceCheckData?.isLowStock || false}
        promotion={priceCheckData?.promotion || null}
        onClose={() => setIsPriceCheckModalOpen(false)}
        onAddToCart={handleBarcodeScanned}
      />

      {/* Cart Till Checkout Code & QR Modal */}
      <CartCodeModal
        isOpen={isCartCodeModalOpen}
        onClose={() => setIsCartCodeModalOpen(false)}
        cart={cart}
        onRefreshCart={loadCart}
      />
    </div>
  );
};
