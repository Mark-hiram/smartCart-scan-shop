import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { ManualBarcodeModal } from '../components/ManualBarcodeModal';
import { PriceCheckModal } from '../components/PriceCheckModal';
import { CartCodeModal } from '../components/CartCodeModal';
import { BudgetAlert } from '../components/BudgetAlert';
import { LoyaltyQRScannerModal } from '../components/LoyaltyQRScannerModal';
import { BatteryStatus } from '../components/BatteryStatus';
import { ShopperTab, BottomNav } from '../components/BottomNav';
import { VoiceCartControl, VoiceCommandExecutionResult } from '../components/VoiceCartControl';
import { ParsedVoiceCommand } from '../utils/voiceCommands';
import { triggerPriceCheckHaptic, triggerScanSuccessHaptic } from '../utils/haptics';
import {
  EnrichedProduct,
  Cart,
  CartItem,
  Product,
  Promotion,
  ShoppingList,
  ShoppingListItem,
  LoyaltyCard,
  ProductHistoryEntry,
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
  Users,
  History,
  Lock,
  Unlock,
  X,
} from 'lucide-react';

interface ShopperViewProps {
  onOpenStoreModal: () => void;
}

export const ShopperView: React.FC<ShopperViewProps> = ({ onOpenStoreModal }) => {
  const { branch, user, token } = useAuth();
  const { t, language } = useTranslation();

  const [activeTab, setActiveTab] = useState<ShopperTab>('scan');
  const [products, setProducts] = useState<EnrichedProduct[]>([]);
  const [cart, setCart] = useState<Cart | null>(null);
  const [favourites, setFavourites] = useState<string[]>([]);

  // Modals & Sheets
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isPriceCheckModalOpen, setIsPriceCheckModalOpen] = useState(false);
  const [isCartCodeModalOpen, setIsCartCodeModalOpen] = useState(false);
  const [isLoyaltyModalOpen, setIsLoyaltyModalOpen] = useState(false);
  const [loyaltyCards, setLoyaltyCards] = useState<LoyaltyCard[]>([]);
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

  // Shopper history & lists (Phase 2 + Shared Lists)
  const [history, setHistory] = useState<Cart[]>([]);
  const [productHistory, setProductHistory] = useState<ProductHistoryEntry[]>([]);
  const [shoppingLists, setShoppingLists] = useState<ShoppingList[]>([]);
  const [selectedList, setSelectedList] = useState<ShoppingList | null>(null);
  const [newListTitle, setNewListTitle] = useState('');
  const [newListCanEdit, setNewListCanEdit] = useState(true);
  const [showCreateListModal, setShowCreateListModal] = useState(false);
  const [createListMode, setCreateListMode] = useState<'previous_purchase' | 'product_history' | 'blank'>('previous_purchase');
  const [selectedSourceCartId, setSelectedSourceCartId] = useState('');
  const [selectedHistoryBarcodes, setSelectedHistoryBarcodes] = useState<string[]>([]);
  const [historySearchFilter, setHistorySearchFilter] = useState('');
  const [quickHistorySelection, setQuickHistorySelection] = useState<string[]>([]);
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [showImportHistoryModal, setShowImportHistoryModal] = useState(false);
  const [importHistoryBarcodes, setImportHistoryBarcodes] = useState<string[]>([]);
  const [joinShareCode, setJoinShareCode] = useState('');
  const [confirmDeleteListId, setConfirmDeleteListId] = useState<string | null>(null);
  const [listNotice, setListNotice] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
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

  // Helper to ensure guest carts and lists are uniquely keyed by random ID in localStorage, sent via x-guest-id
  const getGuestId = (): string => {
    let gid = localStorage.getItem('smartcart_guest_id');
    if (!gid) {
      gid = 'g_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem('smartcart_guest_id', gid);
    }
    return gid;
  };

  const currentCallerId = user?.id || `guest_${getGuestId()}`;

  const getGuestHeaders = (): Record<string, string> => {
    const gid = getGuestId();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-guest-id': gid,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  // Fetch or initialize cart
  const loadCart = async () => {
    if (!branch) return;
    try {
      const res = await fetch(`/api/shopper/cart?branchId=${branch.id}`, {
        headers: getGuestHeaders(),
      });
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

  // Load linked loyalty cards
  const loadLoyaltyCards = async () => {
    try {
      const res = await fetch('/api/shopper/loyalty', {
        headers: getGuestHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setLoyaltyCards(Array.isArray(data) ? data : []);
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

  // Load shopping lists (owned + joined shared lists)
  const loadShoppingLists = async () => {
    try {
      const res = await fetch('/api/shopper/shopping-lists', {
        headers: getGuestHeaders(),
      });
      if (res.ok) {
        const data: ShoppingList[] = await res.json();
        setShoppingLists(data);
        setSelectedList((prev) => {
          if (prev) {
            const refreshed = data.find((l) => l.id === prev.id);
            if (refreshed) return refreshed;
          }
          return data.length > 0 ? data[0] : null;
        });
      }
    } catch (e) {}
  };

  // Fetch shopper past purchases (supports both signed-in and guest shoppers)
  const loadHistory = async () => {
    try {
      const res = await fetch('/api/shopper/past-purchases', {
        headers: getGuestHeaders(),
      });
      if (res.ok) {
        const data: Cart[] = await res.json();
        setHistory(data);
        if (data.length > 0) {
          setSelectedSourceCartId((prev) => prev || data[0].id);
        }
      }
    } catch (e) {}
  };

  // Fetch aggregated unique product history across completed/verified purchases
  const loadProductHistory = async () => {
    try {
      const query = branch?.id ? `?branchId=${encodeURIComponent(branch.id)}` : '';
      const res = await fetch(`/api/shopper/product-history${query}`, {
        headers: getGuestHeaders(),
      });
      if (res.ok) {
        const data: ProductHistoryEntry[] = await res.json();
        setProductHistory(Array.isArray(data) ? data : []);
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
        headers: getGuestHeaders(),
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
      loadHistory();
      loadProductHistory();
      loadLoyaltyCards();
    }
  }, [branch, user?.id, token]);

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
      loadProductHistory();
    } else if (activeTab === 'lists') {
      loadShoppingLists();
      loadFavourites();
      loadHistory();
      loadProductHistory();
    }
  }, [activeTab]);

  // Auto-open shared list when navigating with #list=LIST-XXXX
  useEffect(() => {
    const checkHashForSharedList = () => {
      const match = window.location.hash.match(/^#list=([A-Za-z0-9-]+)/);
      if (match && match[1]) {
        const code = match[1].toUpperCase();
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        handleJoinSharedList(code);
      }
    };
    checkHashForSharedList();
    window.addEventListener('hashchange', checkHashForSharedList);
    return () => window.removeEventListener('hashchange', checkHashForSharedList);
  }, [user?.id, token]);

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
        triggerPriceCheckHaptic();
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
            triggerPriceCheckHaptic();
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
      triggerScanSuccessHaptic();
      return;
    }

    // Online Add to Cart
    try {
      const res = await fetch('/api/shopper/cart/add', {
        method: 'POST',
        headers: getGuestHeaders(),
        body: JSON.stringify({ branchId: branch.id, barcode, quantity: 1, cartId: cart?.id }),
      });
      const updatedCart = await res.json();
      if (res.ok) {
        setCart(updatedCart);
        localStorage.setItem(`offline_cart_${branch.id}`, JSON.stringify(updatedCart));
        triggerScanSuccessHaptic();
      } else {
        alert(updatedCart.error || t.noProductFound);
      }
    } catch (e: any) {
      alert(e.message || 'Error processing barcode');
    }
  };

  // Handle Web Speech API voice commands (e.g. "Add milk to cart", "Add 2 bread")
  const handleVoiceCommand = async (
    command: ParsedVoiceCommand,
    matchedProduct: EnrichedProduct | null
  ): Promise<VoiceCommandExecutionResult> => {
    if (!branch) {
      onOpenStoreModal();
      return { ok: false, message: t.selectBranch };
    }

    if (!matchedProduct) {
      return {
        ok: false,
        message: `${t.voiceNotFoundPrefix} "${command.itemQuery}"`,
      };
    }

    if (command.action === 'price_check') {
      setPriceCheckData({
        product: matchedProduct,
        effectivePrice: matchedProduct.effectivePrice,
        stock: matchedProduct.stock,
        isLowStock: matchedProduct.isLowStock,
        promotion: matchedProduct.activePromotion || null,
      });
      setIsPriceCheckModalOpen(true);
      triggerPriceCheckHaptic();
      return {
        ok: true,
        message: `${matchedProduct.name} — KES ${matchedProduct.effectivePrice.toLocaleString()}`,
      };
    }

    if (command.action === 'remove') {
      const existingItem = cart?.items.find(
        (i) => i.barcode === matchedProduct.barcode || i.productId === matchedProduct.id
      );
      if (!existingItem) {
        return {
          ok: false,
          message: `${matchedProduct.name} ${t.voiceNotInCart}`,
        };
      }
      const nextQty = Math.max(0, existingItem.quantity - command.quantity);
      const removedQty = Math.min(command.quantity, existingItem.quantity);
      await handleUpdateQuantity(existingItem.id, nextQty);
      triggerScanSuccessHaptic();
      return {
        ok: true,
        message: `${t.voiceRemovedPrefix} ${removedQty} × ${matchedProduct.name} ${t.voiceFromCartSuffix}`,
      };
    }

    // Add item(s) to cart (works both offline & online)
    if (isOffline || !navigator.onLine) {
      const existingCart: Cart = cart
        ? { ...cart, items: cart.items.map((it) => ({ ...it })) }
        : {
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

      const existingItem = existingCart.items.find((i) => i.barcode === matchedProduct.barcode);
      if (existingItem) {
        existingItem.quantity += command.quantity;
        existingItem.effectiveTotal = existingItem.quantity * existingItem.lockedPrice;
      } else {
        existingCart.items.push({
          id: `item-${Date.now()}`,
          productId: matchedProduct.id,
          barcode: matchedProduct.barcode,
          name: matchedProduct.name,
          category: matchedProduct.category,
          aisle: matchedProduct.aisle || '',
          shelf: matchedProduct.shelf || '',
          aisleShelf: matchedProduct.aisleShelf,
          quantity: command.quantity,
          lockedPrice: matchedProduct.effectivePrice,
          originalBasePrice: matchedProduct.basePrice,
          discount: Math.max(0, matchedProduct.basePrice - matchedProduct.effectivePrice),
          effectiveTotal: matchedProduct.effectivePrice * command.quantity,
          promoName: matchedProduct.activePromotion?.name,
          scannedAt: new Date().toISOString(),
        });
      }

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
      triggerScanSuccessHaptic();
      return {
        ok: true,
        message: `${t.voiceAddedPrefix} ${command.quantity} × ${matchedProduct.name} ${t.voiceToCartSuffix}`,
      };
    }

    try {
      const res = await fetch('/api/shopper/cart/add', {
        method: 'POST',
        headers: getGuestHeaders(),
        body: JSON.stringify({
          branchId: branch.id,
          barcode: matchedProduct.barcode,
          quantity: command.quantity,
          cartId: cart?.id,
        }),
      });
      const updatedCart = await res.json();
      if (res.ok) {
        setCart(updatedCart);
        localStorage.setItem(`offline_cart_${branch.id}`, JSON.stringify(updatedCart));
        triggerScanSuccessHaptic();
        return {
          ok: true,
          message: `${t.voiceAddedPrefix} ${command.quantity} × ${matchedProduct.name} ${t.voiceToCartSuffix}`,
        };
      }
      return { ok: false, message: updatedCart.error || t.noProductFound };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Error adding item to cart' };
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
        headers: getGuestHeaders(),
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
            headers: getGuestHeaders(),
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
        headers: getGuestHeaders(),
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
      const res = await fetch(`/api/shopper/cart/${cart.id}`, {
        method: 'DELETE',
        headers: getGuestHeaders(),
      });
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
        headers: getGuestHeaders(),
        body: JSON.stringify({ targetBranchId: branch.id, pastCartId }),
      });
      if (res.ok) {
        const data = await res.json();
        const nextCart = data.cart || data;
        setCart(nextCart);
        localStorage.setItem(`offline_cart_${branch.id}`, JSON.stringify(nextCart));
        setReAddSuccessMsg(t.reAddSuccess);
        setActiveTab('cart');
        setTimeout(() => setReAddSuccessMsg(null), 4000);
      }
    } catch (e) {}
  };

  // Join shared shopping list by share code
  const handleJoinSharedList = async (explicitCode?: string) => {
    const codeToJoin = (explicitCode ?? joinShareCode).trim().toUpperCase();
    if (!codeToJoin) return;
    setListError(null);
    setListNotice(null);
    try {
      const res = await fetch('/api/shopper/shopping-lists/join', {
        method: 'POST',
        headers: getGuestHeaders(),
        body: JSON.stringify({ shareCode: codeToJoin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setListError(data.error || 'Shared shopping list not found.');
        return;
      }
      setShoppingLists((prev) => {
        const exists = prev.some((l) => l.id === data.id);
        return exists ? prev.map((l) => (l.id === data.id ? data : l)) : [data, ...prev];
      });
      setSelectedList(data);
      setJoinShareCode('');
      setActiveTab('lists');
      setListsSubTab('lists');
      setListNotice(t.joinedSharedListSuccess);
      setTimeout(() => setListNotice(null), 4000);
    } catch (e: any) {
      setListError(e.message || 'Failed to open shared list.');
    }
  };

  // Open Create List Modal with fresh history & optional preselection
  const openCreateListModal = (
    preferredMode?: 'previous_purchase' | 'product_history' | 'blank',
    preselectedCartId?: string,
    preselectedBarcodes?: string[],
    suggestedTitle?: string
  ) => {
    loadHistory();
    loadProductHistory();
    setListError(null);
    setHistorySearchFilter('');

    const resolvedMode =
      preferredMode ||
      (history.length > 0
        ? 'previous_purchase'
        : productHistory.length > 0
        ? 'product_history'
        : 'blank');

    setCreateListMode(resolvedMode);
    setSelectedSourceCartId(preselectedCartId || history[0]?.id || '');
    setSelectedHistoryBarcodes(preselectedBarcodes || []);
    setNewListTitle(suggestedTitle || '');
    setNewListCanEdit(true);
    setShowCreateListModal(true);
  };

  // Create new shopping list (blank, from previous purchase, or from product history)
  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    setListError(null);

    if (createListMode === 'previous_purchase' && !selectedSourceCartId) {
      setListError(t.selectPastPurchase);
      return;
    }
    if (createListMode === 'product_history' && selectedHistoryBarcodes.length === 0) {
      setListError(t.selectHistoryProducts);
      return;
    }
    if (createListMode === 'blank' && !newListTitle.trim()) {
      setListError(t.listName);
      return;
    }

    setIsCreatingList(true);
    try {
      const payload: Record<string, any> = {
        title: newListTitle.trim(),
        canEdit: newListCanEdit,
        branchId: branch?.id,
        sourceType: createListMode,
      };
      if (createListMode === 'previous_purchase') {
        payload.sourceCartId = selectedSourceCartId;
      } else if (createListMode === 'product_history') {
        payload.selectedBarcodes = selectedHistoryBarcodes;
      } else {
        payload.items = [];
      }

      const res = await fetch('/api/shopper/shopping-lists', {
        method: 'POST',
        headers: getGuestHeaders(),
        body: JSON.stringify(payload),
      });
      const created = await res.json();
      if (!res.ok) {
        setListError(created.error || 'Could not create list.');
        return;
      }

      setShoppingLists((prev) => [created, ...prev]);
      setSelectedList(created);
      setNewListTitle('');
      setSelectedHistoryBarcodes([]);
      setQuickHistorySelection([]);
      setShowCreateListModal(false);
      setActiveTab('lists');
      setListsSubTab('lists');
    } catch (e: any) {
      setListError(e.message || 'Could not create list.');
    } finally {
      setIsCreatingList(false);
    }
  };

  // Persist list updates (handles owner / collaborator permissions cleanly)
  const persistSelectedListUpdate = async (
    listId: string,
    payload: { items?: ShoppingListItem[]; canEdit?: boolean; title?: string }
  ) => {
    setListError(null);
    try {
      const res = await fetch(`/api/shopper/shopping-lists/${listId}`, {
        method: 'PUT',
        headers: getGuestHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setListError(data.error || 'You do not have permission to update this list.');
        await loadShoppingLists();
        return;
      }
      setSelectedList(data);
      setShoppingLists((prev) => prev.map((l) => (l.id === data.id ? data : l)));
    } catch (e) {}
  };

  // Add item to shopping list
  const handleAddItemToCurrentList = async (product: EnrichedProduct) => {
    if (!selectedList) return;
    const existing = selectedList.items.find((it) => it.barcode && it.barcode === product.barcode);
    const updatedItems: ShoppingListItem[] = existing
      ? selectedList.items.map((it) =>
          it.id === existing.id ? { ...it, quantity: it.quantity + 1 } : it
        )
      : [
          ...selectedList.items,
          {
            id: `li-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
            barcode: product.barcode,
            productName: product.name,
            quantity: 1,
            completed: false,
            aisle: product.aisle,
            shelf: product.shelf,
            estimatedPrice: product.effectivePrice,
          },
        ];

    const updatedList = { ...selectedList, items: updatedItems };
    setSelectedList(updatedList);
    setShoppingLists((prev) => prev.map((l) => (l.id === updatedList.id ? updatedList : l)));
    await persistSelectedListUpdate(selectedList.id, { items: updatedItems });
  };

  // Toggle item completion in shopping list
  const handleToggleListItemDone = async (itemId: string) => {
    if (!selectedList) return;
    const isOwner = selectedList.userId === currentCallerId;
    if (!isOwner && !selectedList.canEdit) {
      setListError(t.viewOnlyList);
      return;
    }
    const updatedItems = selectedList.items.map((it) =>
      it.id === itemId ? { ...it, completed: !it.completed } : it
    );
    const updatedList = { ...selectedList, items: updatedItems };
    setSelectedList(updatedList);
    setShoppingLists((prev) => prev.map((l) => (l.id === updatedList.id ? updatedList : l)));
    await persistSelectedListUpdate(selectedList.id, { items: updatedItems });
  };

  // Adjust item quantity or remove item from shopping list
  const handleUpdateListItemQuantity = async (itemId: string, nextQty: number) => {
    if (!selectedList) return;
    const updatedItems =
      nextQty <= 0
        ? selectedList.items.filter((it) => it.id !== itemId)
        : selectedList.items.map((it) => (it.id === itemId ? { ...it, quantity: nextQty } : it));
    const updatedList = { ...selectedList, items: updatedItems };
    setSelectedList(updatedList);
    setShoppingLists((prev) => prev.map((l) => (l.id === updatedList.id ? updatedList : l)));
    await persistSelectedListUpdate(selectedList.id, { items: updatedItems });
  };

  // Toggle collaborative editing permission (owner only)
  const handleToggleListCanEdit = async () => {
    if (!selectedList || selectedList.userId !== currentCallerId) return;
    await persistSelectedListUpdate(selectedList.id, { canEdit: !selectedList.canEdit });
  };

  // Delete shopping list (owner only)
  const handleDeleteList = async (listId: string) => {
    setListError(null);
    try {
      const res = await fetch(`/api/shopper/shopping-lists/${listId}`, {
        method: 'DELETE',
        headers: getGuestHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setListError(data.error || 'Could not delete list.');
        return;
      }
      setConfirmDeleteListId(null);
      setShoppingLists((prev) => {
        const remaining = prev.filter((l) => l.id !== listId);
        setSelectedList(remaining.length > 0 ? remaining[0] : null);
        return remaining;
      });
    } catch (e) {}
  };

  // Import selected product history items into current active shared list
  const handleImportHistoryIntoList = async () => {
    if (!selectedList || importHistoryBarcodes.length === 0) return;
    const updatedItems = [...selectedList.items];
    for (const bc of importHistoryBarcodes) {
      const entry = productHistory.find((p) => p.barcode === bc);
      if (!entry) continue;
      const existingIdx = updatedItems.findIndex((it) => it.barcode === bc);
      if (existingIdx !== -1) {
        updatedItems[existingIdx] = {
          ...updatedItems[existingIdx],
          quantity: updatedItems[existingIdx].quantity + 1,
        };
      } else {
        updatedItems.push({
          id: `li-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          barcode: entry.barcode,
          productName: entry.name,
          quantity: 1,
          completed: false,
          aisle: entry.aisle,
          shelf: entry.shelf,
          estimatedPrice: entry.currentBranchPrice,
        });
      }
    }
    setShowImportHistoryModal(false);
    setImportHistoryBarcodes([]);
    await persistSelectedListUpdate(selectedList.id, { items: updatedItems });
  };

  // Phase 2: Turn shopping list into active cart
  const handleConvertListToCart = async (listId: string) => {
    if (!branch) return;
    setListError(null);
    try {
      const res = await fetch('/api/shopper/shopping-lists/convert-to-cart', {
        method: 'POST',
        headers: getGuestHeaders(),
        body: JSON.stringify({ listId, branchId: branch.id }),
      });
      const data = await res.json();
      if (res.ok) {
        const nextCart = data.cart || data;
        setCart(nextCart);
        localStorage.setItem(`offline_cart_${branch.id}`, JSON.stringify(nextCart));
        setActiveTab('cart');
      } else {
        setListError(data.error || 'Could not convert list to cart.');
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
    <div className="pb-28 pt-3 max-w-xl mx-auto px-4">
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
        <div className="mb-3">
          <BudgetAlert
            cartTotal={cart?.finalTotal || 0}
            budgetLimit={cart?.budgetLimit}
            onUpdateBudget={handleUpdateBudgetLimit}
            currency="KES"
          />
        </div>
      )}

      {/* Store Loyalty Card QR Banner */}
      {branch && (() => {
        const activeLoyalty = loyaltyCards.find((c) => c.supermarketId === branch.supermarketId);
        return (
          <button
            type="button"
            onClick={() => setIsLoyaltyModalOpen(true)}
            className="w-full mb-4 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-400 transition flex items-center justify-between text-left shadow-xs"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center shrink-0">
                <QrCode className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                {activeLoyalty ? (
                  <>
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {activeLoyalty.supermarketName} · {activeLoyalty.tier}
                    </p>
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono truncate">
                      {activeLoyalty.cardNumber} · {activeLoyalty.points.toLocaleString()} pts
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {t.loyaltyQrTitle}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {t.loyaltyQrScanBtn}
                    </p>
                  </>
                )}
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold shrink-0">
              {activeLoyalty ? t.loyaltyLinkedBadge : t.loyaltyQrScanBtn}
            </span>
          </button>
        );
      })()}

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

          <VoiceCartControl
            products={products}
            language={language}
            onExecuteCommand={handleVoiceCommand}
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

          <VoiceCartControl
            products={products}
            language={language}
            onExecuteCommand={handleVoiceCommand}
          />

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
              {/* Join Shared List by Code */}
              <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{t.joinSharedList}</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={joinShareCode}
                    onChange={(e) => setJoinShareCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleJoinSharedList();
                      }
                    }}
                    placeholder={t.enterShareCode}
                    className="flex-1 h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono uppercase focus:outline-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleJoinSharedList()}
                    disabled={!joinShareCode.trim()}
                    className="px-3.5 h-9 rounded-xl bg-slate-900 dark:bg-slate-700 disabled:opacity-40 text-white text-xs font-semibold hover:bg-slate-800 transition shrink-0"
                  >
                    {t.joinListBtn}
                  </button>
                </div>
              </div>

              {listNotice && (
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{listNotice}</span>
                </div>
              )}

              {listError && (
                <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{listError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setListError(null)}
                    className="p-0.5 text-rose-500 hover:text-rose-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Selector + Create New List */}
              <div className="flex items-center justify-between gap-2">
                {shoppingLists.length > 0 ? (
                  <select
                    value={selectedList?.id || ''}
                    onChange={(e) => {
                      const found = shoppingLists.find((l) => l.id === e.target.value);
                      if (found) {
                        setSelectedList(found);
                        setConfirmDeleteListId(null);
                        setListError(null);
                      }
                    }}
                    className="flex-1 min-w-0 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-900 dark:text-white"
                  >
                    {shoppingLists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title} ({l.items.length} items) · {l.shareCode}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-slate-500 font-medium">{t.shoppingLists}</span>
                )}

                <button
                  type="button"
                  onClick={() => openCreateListModal()}
                  className="py-2.5 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t.createList}</span>
                </button>
              </div>

              {selectedList ? (() => {
                const isOwner = selectedList.userId === currentCallerId;
                const canUserEdit = isOwner || selectedList.canEdit;
                const collabCount = selectedList.collaboratorIds?.length || 0;

                return (
                  <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                    {/* List Header & Share code */}
                    <div className="space-y-2.5 pb-3 border-b border-slate-100 dark:border-slate-800">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {selectedList.title}
                          </h3>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px]">
                            <span className="font-mono text-slate-500">
                              {t.shareCode}: <strong className="text-emerald-600">{selectedList.shareCode}</strong>
                            </span>
                            {selectedList.sourceType === 'previous_purchase' && (
                              <span className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold">
                                {t.createFromPastPurchase}
                              </span>
                            )}
                            {selectedList.sourceType === 'product_history' && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-semibold">
                                {t.createFromProductHistory}
                              </span>
                            )}
                            <span
                              className={`px-1.5 py-0.5 rounded font-semibold flex items-center gap-1 ${
                                selectedList.canEdit
                                  ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {selectedList.canEdit ? (
                                <Unlock className="w-2.5 h-2.5" />
                              ) : (
                                <Lock className="w-2.5 h-2.5" />
                              )}
                              {selectedList.canEdit ? t.editableSharedList : t.viewOnlyList}
                            </span>
                            {collabCount > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold flex items-center gap-1">
                                <Users className="w-2.5 h-2.5" />
                                +{collabCount}
                              </span>
                            )}
                          </div>
                        </div>

                        {isOwner && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={handleToggleListCanEdit}
                              title={selectedList.canEdit ? t.editableSharedList : t.viewOnlyList}
                              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              {selectedList.canEdit ? (
                                <Unlock className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Lock className="w-3.5 h-3.5 text-amber-600" />
                              )}
                            </button>
                            {confirmDeleteListId === selectedList.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteList(selectedList.id)}
                                  className="px-2 py-1.5 rounded-xl bg-rose-600 text-white text-[10px] font-bold"
                                >
                                  Delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteListId(null)}
                                  className="p-1.5 rounded-xl border border-slate-200 text-slate-500 text-[10px]"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteListId(selectedList.id)}
                                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-600 hover:border-rose-200"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const url = `${window.location.origin}/#list=${selectedList.shareCode}`;
                            navigator.clipboard?.writeText(url);
                            setCopyShareSuccess(t.linkCopied);
                            setTimeout(() => setCopyShareSuccess(null), 3000);
                          }}
                          className="py-1.5 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs flex items-center gap-1 font-semibold"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          <span>{t.shareLink}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setListSortByAisle(!listSortByAisle)}
                          className={`py-1.5 px-2.5 rounded-xl text-xs font-semibold flex items-center gap-1 border transition ${
                            listSortByAisle
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                          }`}
                          title="Sort items by aisle number so you walk the store in order"
                        >
                          <ArrowUpDown className="w-3.5 h-3.5" />
                          <span>{t.sortByAisle}</span>
                        </button>

                        {canUserEdit && productHistory.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              loadProductHistory();
                              setImportHistoryBarcodes([]);
                              setShowImportHistoryModal(true);
                            }}
                            className="py-1.5 px-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-1"
                          >
                            <History className="w-3.5 h-3.5" />
                            <span>{t.importFromHistory}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {copyShareSuccess && (
                      <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 text-[11px] font-semibold flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{copyShareSuccess}</span>
                      </div>
                    )}

                    {/* Add item to list search input (editable lists only) */}
                    {canUserEdit ? (
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
                              .filter(
                                (p) =>
                                  p.name.toLowerCase().includes(searchItemForList.toLowerCase()) ||
                                  p.barcode.includes(searchItemForList.trim())
                              )
                              .slice(0, 6)
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
                    ) : (
                      <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-500 flex items-center gap-2">
                        <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{t.viewOnlyList}</span>
                      </div>
                    )}

                    {/* Checkable items in Aisle order with quantities */}
                    <div className="space-y-2">
                      {sortedListItems.length === 0 ? (
                        <div className="p-6 text-center rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-400">
                          {t.searchProductToAdd}
                        </div>
                      ) : (
                        sortedListItems.map((it) => (
                          <div
                            key={it.id}
                            className={`p-3 rounded-2xl border transition flex items-center justify-between gap-2 ${
                              it.completed
                                ? 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 opacity-65'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xs'
                            }`}
                          >
                            <div
                              onClick={() => handleToggleListItemDone(it.id)}
                              className={`flex items-center gap-2.5 min-w-0 flex-1 ${
                                canUserEdit ? 'cursor-pointer' : ''
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={it.completed}
                                onChange={() => {}}
                                className="w-4 h-4 rounded text-emerald-600 pointer-events-none shrink-0"
                              />
                              <div className="min-w-0">
                                <p
                                  className={`text-xs font-bold truncate ${
                                    it.completed
                                      ? 'line-through text-slate-400'
                                      : 'text-slate-900 dark:text-white'
                                  }`}
                                >
                                  {it.productName}
                                </p>
                                <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5 font-medium">
                                  <MapPin className="w-3 h-3 shrink-0" />
                                  Aisle {it.aisle || '—'} · Shelf {it.shelf || '—'}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {canUserEdit ? (
                                <div className="flex items-center border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-slate-50 dark:bg-slate-800">
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateListItemQuantity(it.id, it.quantity - 1)}
                                    className="w-6 h-6 flex items-center justify-center text-slate-600 dark:text-slate-300"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <span className="w-6 text-center text-[11px] font-bold font-mono tabular-nums">
                                    {it.quantity}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateListItemQuantity(it.id, it.quantity + 1)}
                                    className="w-6 h-6 flex items-center justify-center text-slate-600 dark:text-slate-300"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[11px] font-mono font-semibold text-slate-500">
                                  x{it.quantity}
                                </span>
                              )}

                              <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 min-w-[58px] text-right tabular-nums">
                                KES {((it.estimatedPrice || 0) * it.quantity).toLocaleString()}
                              </span>

                              {canUserEdit && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateListItemQuantity(it.id, 0)}
                                  className="p-1 text-slate-400 hover:text-rose-600"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Convert List to Cart Banner */}
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider">{t.expectedTotal}</p>
                        <p className="text-base font-black text-emerald-600 tabular-nums">
                          KES {listExpectedTotal.toLocaleString()}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleConvertListToCart(selectedList.id)}
                        disabled={selectedList.items.length === 0}
                        className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
                      >
                        <ShoppingBag className="w-4 h-4" />
                        <span>{t.convertListToCart}</span>
                      </button>
                    </div>
                  </div>
                );
              })() : (
                <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-3">
                  <ListChecks className="w-10 h-10 text-emerald-500 mx-auto" />
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t.shoppingLists}</h4>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                      {t.createFromPastPurchase} · {t.createFromProductHistory} · {t.joinSharedList}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCreateListModal()}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t.createList}</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: PAST HISTORY VIEW (PHASE 2 + PRODUCT HISTORY LIST BUILDER) */}
      {branch && activeTab === 'history' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {t.navHistory}
            </h2>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => openCreateListModal('previous_purchase', history[0]?.id)}
                className="py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <ListChecks className="w-3.5 h-3.5" />
                <span>{t.createList}</span>
              </button>
            )}
          </div>

          {/* Product History Quick Shared-List Builder */}
          {productHistory.length > 0 && (
            <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <History className="w-4 h-4 text-emerald-600" />
                    <span>{t.createFromProductHistory}</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">{t.selectHistoryProducts}</p>
                </div>
                <div className="flex items-center gap-2 text-[11px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setQuickHistorySelection(productHistory.map((p) => p.barcode))}
                    className="text-emerald-600 hover:underline"
                  >
                    {t.selectAllItems}
                  </button>
                  {quickHistorySelection.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setQuickHistorySelection([])}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      {t.clearSelection}
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                {productHistory.map((ph) => {
                  const selected = quickHistorySelection.includes(ph.barcode);
                  return (
                    <label
                      key={ph.barcode}
                      className={`p-2.5 rounded-2xl border flex items-center justify-between gap-2 cursor-pointer transition ${
                        selected
                          ? 'border-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/30'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            setQuickHistorySelection((prev) =>
                              prev.includes(ph.barcode)
                                ? prev.filter((b) => b !== ph.barcode)
                                : [...prev, ph.barcode]
                            );
                          }}
                          className="w-4 h-4 rounded text-emerald-600 shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {ph.name}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {t.boughtTimes} {ph.purchaseCount}x · Aisle {ph.aisle}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-mono font-bold text-emerald-600 shrink-0 tabular-nums">
                        KES {ph.currentBranchPrice.toLocaleString()}
                      </span>
                    </label>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={quickHistorySelection.length === 0}
                onClick={() =>
                  openCreateListModal(
                    'product_history',
                    undefined,
                    quickHistorySelection,
                    `My Restock (${quickHistorySelection.length} items)`
                  )
                }
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>
                  {t.savePurchaseAsList} ({quickHistorySelection.length})
                </span>
              </button>
            </div>
          )}

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

                  {/* Save as Shared List + Re-add all items to active cart */}
                  <div className="pt-1 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        openCreateListModal(
                          'previous_purchase',
                          h.id,
                          undefined,
                          `Restock (${h.shortCode})`
                        )
                      }
                      className="py-2 px-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>{t.savePurchaseAsList}</span>
                    </button>

                    <button
                      type="button"
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

      {/* ShopperView Footer: Device Battery Charge Status & Mobile Bottom Nav */}
      <footer
        aria-label={t.batteryStatusLabel}
        className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800"
      >
        <BatteryStatus />
        <BottomNav
          activeTab={activeTab}
          onTabChange={setActiveTab}
          cartItemCount={totalItemCount}
          cartRunningTotal={cart?.finalTotal || 0}
        />
      </footer>

      {/* Modal: Create New Shared Shopping List (Blank, Previous Purchase, or Product History) */}
      {showCreateListModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{t.createList}</h3>
              <button
                type="button"
                onClick={() => setShowCreateListModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Source Mode Tabs */}
            <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => {
                  setCreateListMode('previous_purchase');
                  setListError(null);
                }}
                className={`py-2 px-1.5 rounded-xl text-[11px] font-bold transition ${
                  createListMode === 'previous_purchase'
                    ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.createFromPastPurchase}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateListMode('product_history');
                  setListError(null);
                }}
                className={`py-2 px-1.5 rounded-xl text-[11px] font-bold transition ${
                  createListMode === 'product_history'
                    ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.createFromProductHistory}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateListMode('blank');
                  setListError(null);
                }}
                className={`py-2 px-1.5 rounded-xl text-[11px] font-bold transition ${
                  createListMode === 'blank'
                    ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.createFromBlank}
              </button>
            </div>

            <form onSubmit={handleCreateList} className="space-y-3">
              <div>
                <label className="text-xs font-semibold block mb-1 text-slate-700 dark:text-slate-300">
                  {t.listName}
                </label>
                <input
                  type="text"
                  required={createListMode === 'blank'}
                  value={newListTitle}
                  onChange={(e) => setNewListTitle(e.target.value)}
                  placeholder={
                    createListMode === 'previous_purchase'
                      ? 'Optional (defaults to Restock code)'
                      : createListMode === 'product_history'
                      ? 'Optional (defaults to History List)'
                      : 'e.g. Weekly Groceries, BBQ Party...'
                  }
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:outline-emerald-500"
                />
              </div>

              {/* Mode 1: Previous Purchase Picker */}
              {createListMode === 'previous_purchase' && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold block text-slate-700 dark:text-slate-300">
                    {t.selectPastPurchase}
                  </label>
                  {history.length > 0 ? (
                    <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                      {history.map((h) => {
                        const isChosen = selectedSourceCartId === h.id;
                        return (
                          <label
                            key={h.id}
                            className={`block p-3 rounded-2xl border cursor-pointer transition ${
                              isChosen
                                ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30'
                                : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  name="sourceCart"
                                  checked={isChosen}
                                  onChange={() => setSelectedSourceCartId(h.id)}
                                  className="text-emerald-600"
                                />
                                <div>
                                  <p className="text-xs font-bold font-mono text-slate-900 dark:text-white">
                                    {h.shortCode} · {h.items.length} {t.itemsCount}
                                  </p>
                                  <p className="text-[10px] text-slate-400">
                                    {new Date(h.createdAt).toLocaleDateString()}
                                  </p>
                                </div>
                              </div>
                              <span className="text-xs font-bold text-emerald-600 tabular-nums">
                                KES {h.finalTotal.toLocaleString()}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-1.5 truncate">
                              {h.items.map((it) => `${it.quantity}x ${it.name}`).join(', ')}
                            </p>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 text-center">
                      {t.noProductHistoryYet}
                    </p>
                  )}
                </div>
              )}

              {/* Mode 2: Product History Multi-select Picker */}
              {createListMode === 'product_history' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {t.selectHistoryProducts}
                    </label>
                    {productHistory.length > 0 && (
                      <div className="flex items-center gap-2 text-[11px] font-semibold">
                        <button
                          type="button"
                          onClick={() => setSelectedHistoryBarcodes(productHistory.map((p) => p.barcode))}
                          className="text-emerald-600 hover:underline"
                        >
                          {t.selectAllItems}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedHistoryBarcodes([])}
                          className="text-slate-400 hover:text-slate-600"
                        >
                          {t.clearSelection}
                        </button>
                      </div>
                    )}
                  </div>

                  {productHistory.length > 0 ? (
                    <>
                      <input
                        type="text"
                        value={historySearchFilter}
                        onChange={(e) => setHistorySearchFilter(e.target.value)}
                        placeholder={t.searchProductToAdd}
                        className="w-full h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                      />
                      <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                        {productHistory
                          .filter(
                            (ph) =>
                              !historySearchFilter.trim() ||
                              ph.name.toLowerCase().includes(historySearchFilter.toLowerCase()) ||
                              ph.barcode.includes(historySearchFilter.trim())
                          )
                          .map((ph) => {
                            const checked = selectedHistoryBarcodes.includes(ph.barcode);
                            return (
                              <label
                                key={ph.barcode}
                                className={`p-2.5 rounded-2xl border flex items-center justify-between gap-2 cursor-pointer transition ${
                                  checked
                                    ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30'
                                    : 'border-slate-200 dark:border-slate-800'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() =>
                                      setSelectedHistoryBarcodes((prev) =>
                                        prev.includes(ph.barcode)
                                          ? prev.filter((b) => b !== ph.barcode)
                                          : [...prev, ph.barcode]
                                      )
                                    }
                                    className="rounded text-emerald-600 shrink-0"
                                  />
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                      {ph.name}
                                    </p>
                                    <p className="text-[10px] text-slate-400">
                                      {t.boughtTimes} {ph.purchaseCount}x · Aisle {ph.aisle}
                                    </p>
                                  </div>
                                </div>
                                <span className="text-xs font-mono font-bold text-emerald-600 shrink-0">
                                  KES {ph.currentBranchPrice}
                                </span>
                              </label>
                            );
                          })}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 text-center">
                      {t.noProductHistoryYet}
                    </p>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={newListCanEdit}
                  onChange={(e) => setNewListCanEdit(e.target.checked)}
                  className="rounded text-emerald-600"
                />
                <span>{t.allowEditing}</span>
              </label>

              {listError && (
                <p className="text-xs font-semibold text-rose-600">{listError}</p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateListModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={
                    isCreatingList ||
                    (createListMode === 'previous_purchase' && !selectedSourceCartId) ||
                    (createListMode === 'product_history' && selectedHistoryBarcodes.length === 0)
                  }
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold"
                >
                  {t.createList}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Import Items from Product History into Active Shared List */}
      {showImportHistoryModal && selectedList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-5 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-600" />
                <span>{t.importFromHistory}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowImportHistoryModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-1.5 flex-1 pr-1">
              {productHistory.map((ph) => {
                const checked = importHistoryBarcodes.includes(ph.barcode);
                return (
                  <label
                    key={ph.barcode}
                    className={`p-2.5 rounded-2xl border flex items-center justify-between gap-2 cursor-pointer transition ${
                      checked
                        ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setImportHistoryBarcodes((prev) =>
                            prev.includes(ph.barcode)
                              ? prev.filter((b) => b !== ph.barcode)
                              : [...prev, ph.barcode]
                          )
                        }
                        className="rounded text-emerald-600 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {ph.name}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {t.boughtTimes} {ph.purchaseCount}x · Aisle {ph.aisle}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-600 shrink-0">
                      KES {ph.currentBranchPrice}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowImportHistoryModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                disabled={importHistoryBarcodes.length === 0}
                onClick={handleImportHistoryIntoList}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 disabled:opacity-40 text-white text-xs font-semibold"
              >
                {t.importFromHistory} ({importHistoryBarcodes.length})
              </button>
            </div>
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

      {/* Store-Specific Loyalty QR Scanner Modal */}
      <LoyaltyQRScannerModal
        isOpen={isLoyaltyModalOpen}
        onClose={() => setIsLoyaltyModalOpen(false)}
        branchId={branch?.id}
        activeSupermarketId={branch?.supermarketId}
        loyaltyCards={loyaltyCards}
        onCardLinked={(card) => {
          setLoyaltyCards((prev) => {
            const exists = prev.some((c) => c.id === card.id);
            return exists ? prev.map((c) => (c.id === card.id ? card : c)) : [card, ...prev];
          });
        }}
        onCardRemoved={(cardId) => {
          setLoyaltyCards((prev) => prev.filter((c) => c.id !== cardId));
        }}
        getHeaders={getGuestHeaders}
      />
    </div>
  );
};
