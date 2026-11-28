// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { ManualBarcodeModal } from '../components/ManualBarcodeModal';
import { PriceCheckModal } from '../components/PriceCheckModal';
import { CartCodeModal } from '../components/CartCodeModal';
import { BudgetAlert } from '../components/BudgetAlert';
import { LoyaltyPointsModal } from '../components/LoyaltyPointsModal';
import { BatteryStatus } from '../components/BatteryStatus';
import { ShopperTab, BottomNav } from '../components/BottomNav';
import { VoiceCartControl, VoiceCommandExecutionResult } from '../components/VoiceCartControl';
import { CartSummaryCardModal } from '../components/CartSummaryCardModal';
import { EmptyCartIllustration, EmptySearchIllustration } from '../components/Illustrations';
import { PortalBackgroundImage } from '../components/PortalBackgroundImage';
import { ShopperRewardsView } from '../components/ShopperRewardsView';
import { ParsedVoiceCommand } from '../utils/voiceCommands';
import { triggerPriceCheckHaptic, triggerScanSuccessHaptic } from '../utils/haptics';
import {
  OfflineQueueOperation,
  enqueueOfflineOperation,
  getOfflineQueue,
  removeOfflineQueueItem,
  clearOfflineQueueForBranch,
  saveOfflineCartSnapshot,
  loadOfflineCartSnapshot,
  saveOfflineBranchProducts,
  loadOfflineBranchProducts,
  isNetworkOfflineError,
} from '../utils/offlineQueue';
import {
  EnrichedProduct,
  Cart,
  TransactionReceipt,
  CartItem,
  Product,
  Promotion,
  ShoppingList,
  ShoppingListItem,
  LoyaltyPointsSummary,
  ProductHistoryEntry,
  GoodbyeSummaryData,
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
  ReceiptText,
  Search,
  ChevronDown,
  ChevronUp,
  UserCheck,
  Award,
  ArrowLeft,
} from 'lucide-react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface ShopperViewProps {
  onOpenStoreModal: () => void;
  onRequestSignIn?: () => void;
  initialTab?: ShopperTab;
  requestedTabNonce?: { tab: ShopperTab; nonce: number } | null;
  newCartNonce?: number;
  onShowGoodbye?: (summary: GoodbyeSummaryData) => void;
  onOfflineFinishSynced?: (summary: GoodbyeSummaryData) => void;
  onShopperActivityChange?: (info: { cart: Cart | null; lastClosedCartId: string | null }) => void;
}

export const ShopperView: React.FC<ShopperViewProps> = ({
  onOpenStoreModal,
  onRequestSignIn,
  initialTab = 'scan',
  requestedTabNonce,
  newCartNonce = 0,
  onShowGoodbye,
  onOfflineFinishSynced,
  onShopperActivityChange,
}) => {
  const { branch, supermarket, user, token } = useAuth();
  const { t, language } = useTranslation();

  const [activeTab, setActiveTab] = useState<ShopperTab>(initialTab);
  const [products, setProducts] = useState<EnrichedProduct[]>([]);
  const [cart, setCart] = useState<Cart | null>(null);
  const [favourites, setFavourites] = useState<string[]>([]);

  // Modals & Sheets
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isPriceCheckModalOpen, setIsPriceCheckModalOpen] = useState(false);
  const [isCartCodeModalOpen, setIsCartCodeModalOpen] = useState(false);
  const [summaryCardCart, setSummaryCardCart] = useState<Cart | null>(null);
  const [isLoyaltyModalOpen, setIsLoyaltyModalOpen] = useState(false);
  const [loyaltySummary, setLoyaltySummary] = useState<LoyaltyPointsSummary | null>(null);
  const [showFinishConfirmModal, setShowFinishConfirmModal] = useState(false);
  const [isFinishingCart, setIsFinishingCart] = useState(false);
  const [lastClosedCartId, setLastClosedCartId] = useState<string | null>(null);
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

  // Shopper history, receipts & lists
  const [history, setHistory] = useState<Cart[]>([]);
  const [receipts, setReceipts] = useState<TransactionReceipt[]>([]);
  const [isLoadingReceipts, setIsLoadingReceipts] = useState(false);
  const [receiptSearch, setReceiptSearch] = useState('');
  const [expandedReceiptIds, setExpandedReceiptIds] = useState<Record<string, boolean>>({});
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

  // Offline detection & IndexedDB state queue sync
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isSyncingCart, setIsSyncingCart] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [scanErrorNotice, setScanErrorNotice] = useState<string | null>(null);
  const [queuedOps, setQueuedOps] = useState<OfflineQueueOperation[]>([]);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'queued' | 'syncing' | 'synced' | 'error'>('idle');
  const [syncProgress, setSyncProgress] = useState<{ completed: number; total: number } | null>(null);
  const cartRef = useRef<Cart | null>(null);
  const syncInFlightRef = useRef<Promise<void> | null>(null);

  useBodyScrollLock(
    showCreateListModal ||
      (showImportHistoryModal && Boolean(selectedList)) ||
      showFinishConfirmModal
  );

  useEffect(() => {
    cartRef.current = cart;
    onShopperActivityChange?.({ cart, lastClosedCartId });
  }, [cart, lastClosedCartId]);

  const showScanError = (msg: string) => {
    setScanErrorNotice(msg);
    setTimeout(() => setScanErrorNotice(null), 4000);
  };

  // Fetch branch products catalogue (with IndexedDB caching for offline capability)
  const loadBranchProducts = async () => {
    if (!branch) return;
    const cachedProducts = await loadOfflineBranchProducts(branch.id);
    if (cachedProducts && cachedProducts.length > 0) {
      setProducts((prev) => (prev.length === 0 ? cachedProducts : prev));
    }
    if (!navigator.onLine) return;

    try {
      const res = await fetch(`/api/shopper/branch-products/${branch.id}`);
      if (res.ok) {
        const data = await res.json();
        const nextProducts: EnrichedProduct[] = data.products || [];
        setProducts(nextProducts);
        await saveOfflineBranchProducts(branch.id, nextProducts);
      } else if (cachedProducts) {
        setProducts(cachedProducts);
      }
    } catch {
      if (cachedProducts) setProducts(cachedProducts);
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

  // Fetch or initialize cart (hydrating IndexedDB snapshot & respecting queued offline mutations)
  const loadCart = async (specificCartId?: string) => {
    if (!branch) return;
    const snapshot = await loadOfflineCartSnapshot(branch.id, currentCallerId);
    const pending = await getOfflineQueue(branch.id, currentCallerId);
    setQueuedOps(pending);
    if (pending.length > 0 && !syncInFlightRef.current) {
      setSyncStatus('queued');
    }

    if (snapshot && (!cartRef.current || pending.length > 0 || !navigator.onLine)) {
      setCart(snapshot);
      if (snapshot.budgetLimit) {
        setBudgetInput(snapshot.budgetLimit.toString());
      }
    }

    // Do not clobber local cart with server state while offline mutations are queued
    if (!navigator.onLine || pending.length > 0) {
      return;
    }

    try {
      const query = specificCartId
        ? `/api/shopper/cart?branchId=${branch.id}&cartId=${encodeURIComponent(specificCartId)}`
        : `/api/shopper/cart?branchId=${branch.id}`;
      const res = await fetch(query, {
        headers: getGuestHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setCart(data);
        if (data?.budgetLimit) {
          setBudgetInput(data.budgetLimit.toString());
        }
        if (data) {
          await saveOfflineCartSnapshot(branch.id, currentCallerId, data);
        }
      }
    } catch {
      if (snapshot) setCart(snapshot);
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

  // Load shopper loyalty points balance & history
  const loadLoyaltyPoints = async () => {
    try {
      const res = await fetch('/api/shopper/loyalty-points', {
        headers: getGuestHeaders(),
      });
      if (res.ok) {
        const data: LoyaltyPointsSummary = await res.json();
        setLoyaltySummary(data);
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

  // Fetch completed/verified transaction receipts for logged-in shopper
  const loadReceipts = async () => {
    if (!user || !token) {
      setReceipts([]);
      return;
    }
    setIsLoadingReceipts(true);
    try {
      const res = await fetch('/api/shopper/receipts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setReceipts(Array.isArray(data?.receipts) ? data.receipts : []);
      }
    } catch (e) {
    } finally {
      setIsLoadingReceipts(false);
    }
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

  // Flush IndexedDB scan queue sequentially to server when connectivity returns
  const syncOfflineCartToServer = useCallback(async () => {
    if (!branch) return;
    if (syncInFlightRef.current) {
      return syncInFlightRef.current;
    }

    const activeBranchId = branch.id;
    const callerIdSnapshot = currentCallerId;

    const runSync = async () => {
      const queue = await getOfflineQueue(activeBranchId, callerIdSnapshot);
      setQueuedOps(queue);

      if (queue.length === 0) {
        // Legacy offline snapshot sync fallback if needed
        const snapshot = await loadOfflineCartSnapshot(activeBranchId, callerIdSnapshot);
        if (!snapshot || !snapshot.isOfflineCreated || !snapshot.items || snapshot.items.length === 0) {
          return;
        }
        setIsSyncingCart(true);
        setSyncStatus('syncing');
        setSyncProgress({ completed: 0, total: 1 });
        try {
          const res = await fetch('/api/shopper/cart/sync', {
            method: 'POST',
            headers: getGuestHeaders(),
            body: JSON.stringify({
              branchId: activeBranchId,
              cartId: snapshot.id,
              items: snapshot.items,
              budgetLimit: snapshot.budgetLimit,
            }),
          });
          if (res.ok) {
            const synced = await res.json();
            setCart(synced);
            await saveOfflineCartSnapshot(activeBranchId, callerIdSnapshot, synced);
            setSyncProgress({ completed: 1, total: 1 });
            setSyncStatus('synced');
            setSyncNotice(t.cartSyncSuccess);
            setTimeout(() => {
              setSyncNotice(null);
              setSyncStatus((prev) => (prev === 'synced' ? 'idle' : prev));
            }, 4000);
          } else {
            setSyncStatus('error');
          }
        } catch {
          setSyncStatus(navigator.onLine ? 'error' : 'queued');
        } finally {
          setIsSyncingCart(false);
          setSyncProgress(null);
        }
        return;
      }

      setIsSyncingCart(true);
      setSyncStatus('syncing');
      setSyncProgress({ completed: 0, total: queue.length });

      let workingCart: Cart | null =
        cartRef.current && !cartRef.current.id.startsWith('offline-cart-')
          ? cartRef.current
          : null;
      let completedCount = 0;

      const ensureServerCart = async (): Promise<Cart | null> => {
        if (workingCart && !workingCart.id.startsWith('offline-cart-')) {
          return workingCart;
        }
        const res = await fetch(`/api/shopper/cart?branchId=${activeBranchId}`, {
          headers: getGuestHeaders(),
        });
        if (!res.ok) return null;
        const serverCart: Cart = await res.json();
        workingCart = serverCart;
        return serverCart;
      };

      try {
        for (const op of queue) {
          if (!navigator.onLine) {
            throw new TypeError('Offline while syncing queue');
          }

          let res: Response | null = null;

          if (op.action === 'scan_add' && op.barcode) {
            const serverCart = workingCart && !workingCart.id.startsWith('offline-cart-') ? workingCart : null;
            res = await fetch('/api/shopper/cart/add', {
              method: 'POST',
              headers: getGuestHeaders(),
              body: JSON.stringify({
                branchId: activeBranchId,
                barcode: op.barcode,
                quantity: op.quantity ?? 1,
                cartId: serverCart?.id,
              }),
            });
          } else if (op.action === 'update_qty') {
            const serverCart = await ensureServerCart();
            if (serverCart) {
              const matchedItem = serverCart.items.find(
                (it) => it.id === op.itemId || (op.barcode && it.barcode === op.barcode)
              );
              if (matchedItem) {
                res = await fetch('/api/shopper/cart/quantity', {
                  method: 'PUT',
                  headers: getGuestHeaders(),
                  body: JSON.stringify({
                    cartId: serverCart.id,
                    itemId: matchedItem.id,
                    quantity: op.quantity ?? 0,
                  }),
                });
              } else {
                // Item no longer exists on server; mark op resolved
                await removeOfflineQueueItem(op.id);
              }
            }
          } else if (op.action === 'set_budget') {
            const serverCart = await ensureServerCart();
            if (serverCart) {
              res = await fetch('/api/shopper/cart/budget', {
                method: 'POST',
                headers: getGuestHeaders(),
                body: JSON.stringify({
                  cartId: serverCart.id,
                  budgetLimit: op.budgetLimit ?? null,
                }),
              });
            }
          } else if (op.action === 'clear_cart') {
            const serverCart = await ensureServerCart();
            if (serverCart) {
              res = await fetch(`/api/shopper/cart/${serverCart.id}`, {
                method: 'DELETE',
                headers: getGuestHeaders(),
              });
            }
          } else if (op.action === 'lock_cart') {
            const serverCart = await ensureServerCart();
            if (serverCart) {
              res = await fetch('/api/shopper/cart/lock', {
                method: 'POST',
                headers: getGuestHeaders(),
                body: JSON.stringify({ cartId: serverCart.id }),
              });
            }
          } else if (op.action === 'finish_cart') {
            const serverCart = await ensureServerCart();
            if (serverCart) {
              res = await fetch('/api/shopper/cart/finish', {
                method: 'POST',
                headers: getGuestHeaders(),
                body: JSON.stringify({ cartId: serverCart.id }),
              });
            }
          }

          if (res) {
            if (res.ok) {
              const payload = await res.json();
              const updatedCart: Cart = payload?.cart ? payload.cart : payload;
              workingCart = updatedCart;
              if (op.action === 'finish_cart') {
                setLastClosedCartId(updatedCart.id);
                if (payload?.summary && onOfflineFinishSynced) {
                  onOfflineFinishSynced({
                    ...payload.summary,
                    pendingOfflineFinish: false,
                    source: 'finish_button',
                  });
                }
                setCart(null);
              } else {
                setCart(updatedCart);
              }
              await saveOfflineCartSnapshot(activeBranchId, callerIdSnapshot, updatedCart);
              await removeOfflineQueueItem(op.id);
            } else if (res.status >= 400 && res.status < 500) {
              // Remove permanently invalid queued operation so queue does not stall
              await removeOfflineQueueItem(op.id);
            } else {
              throw new Error(`Server error ${res.status}`);
            }
          }

          completedCount += 1;
          setSyncProgress({ completed: completedCount, total: queue.length });
          const remaining = await getOfflineQueue(activeBranchId, callerIdSnapshot);
          setQueuedOps(remaining);
        }

        const remainingAfter = await getOfflineQueue(activeBranchId, callerIdSnapshot);
        setQueuedOps(remainingAfter);

        if (remainingAfter.length === 0) {
          if (workingCart) {
            setCart(workingCart);
            await saveOfflineCartSnapshot(activeBranchId, callerIdSnapshot, workingCart);
          } else {
            await loadCart();
          }
          setSyncStatus('synced');
          setSyncNotice(t.cartSyncSuccess);
          setTimeout(() => {
            setSyncNotice(null);
            setSyncStatus((prev) => (prev === 'synced' ? 'idle' : prev));
          }, 4000);
        } else {
          setSyncStatus(navigator.onLine ? 'error' : 'queued');
        }
      } catch (err) {
        console.warn('Offline queue sync interrupted:', err);
        const remaining = await getOfflineQueue(activeBranchId, callerIdSnapshot);
        setQueuedOps(remaining);
        setSyncStatus(!navigator.onLine || isNetworkOfflineError(err) ? 'queued' : 'error');
      } finally {
        setIsSyncingCart(false);
        setSyncProgress(null);
      }
    };

    const promise = runSync().finally(() => {
      syncInFlightRef.current = null;
    });
    syncInFlightRef.current = promise;
    return promise;
  }, [branch?.id, currentCallerId, token, t.cartSyncSuccess]);

  // Offline / Online listeners & auto-sync when connectivity returns
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      void syncOfflineCartToServer();
    };
    const handleOffline = () => {
      setIsOffline(true);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncOfflineCartToServer]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (requestedTabNonce?.tab) {
      setActiveTab(requestedTabNonce.tab);
    }
  }, [requestedTabNonce?.nonce]);

  const startFreshActiveCart = useCallback(async () => {
    if (!branch) return;
    setLastClosedCartId(null);
    if (!navigator.onLine || isOffline) {
      const freshLocal: Cart = {
        id: `offline-cart-${Date.now()}`,
        shortCode: `OFF-${Math.floor(1000 + Math.random() * 9000)}`,
        shopperId: currentCallerId,
        shopperName: user?.name || 'Shopper',
        shopperPhone: user?.phone || '',
        supermarketId: branch.supermarketId,
        branchId: branch.id,
        status: 'active',
        items: [],
        subtotal: 0,
        totalDiscount: 0,
        finalTotal: 0,
        budgetLimit: null,
        isOfflineCreated: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setCart(freshLocal);
      await saveOfflineCartSnapshot(branch.id, currentCallerId, freshLocal);
      setActiveTab('scan');
      return;
    }

    try {
      const res = await fetch('/api/shopper/cart/new', {
        method: 'POST',
        headers: getGuestHeaders(),
        body: JSON.stringify({ branchId: branch.id }),
      });
      if (res.ok) {
        const freshCart: Cart = await res.json();
        setCart(freshCart);
        await saveOfflineCartSnapshot(branch.id, currentCallerId, freshCart);
        setActiveTab('scan');
      } else {
        await loadCart();
        setActiveTab('scan');
      }
    } catch {
      await loadCart();
      setActiveTab('scan');
    }
  }, [branch?.id, currentCallerId, user?.name, user?.phone, isOffline, token]);

  useEffect(() => {
    if (newCartNonce > 0) {
      void startFreshActiveCart();
    }
  }, [newCartNonce]);

  useEffect(() => {
    if (user && token) {
      loadReceipts();
      loadHistory();
      loadProductHistory();
    } else {
      setReceipts([]);
    }
  }, [user?.id, token]);

  useEffect(() => {
    if (!branch) return;
    let cancelled = false;

    const bootstrapBranchState = async () => {
      await loadBranchProducts();
      const pending = await getOfflineQueue(branch.id, currentCallerId);
      if (cancelled) return;
      setQueuedOps(pending);

      if (pending.length > 0 && navigator.onLine) {
        const snapshot = await loadOfflineCartSnapshot(branch.id, currentCallerId);
        if (!cancelled && snapshot) {
          setCart(snapshot);
        }
        await syncOfflineCartToServer();
      } else {
        await loadCart();
      }

      if (!cancelled) {
        loadFavourites();
        loadShoppingLists();
        loadHistory();
        loadProductHistory();
        loadLoyaltyPoints();
      }
    };

    void bootstrapBranchState();
    return () => {
      cancelled = true;
    };
  }, [branch?.id, user?.id, token]);

  useEffect(() => {
    if (activeTab === 'history') {
      loadReceipts();
      loadHistory();
      loadProductHistory();
    } else if (activeTab === 'lists') {
      loadShoppingLists();
      loadFavourites();
      loadHistory();
      loadProductHistory();
    } else if (activeTab === 'rewards') {
      loadLoyaltyPoints();
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

  // Local helper: apply offline scanned/voice item to local cart snapshot & IndexedDB queue
  const queueOfflineProductAdd = async (
    product: EnrichedProduct,
    quantityToAdd: number
  ): Promise<Cart> => {
    const activeBranch = branch!;
    const baseCart: Cart = cartRef.current
      ? { ...cartRef.current, items: cartRef.current.items.map((it) => ({ ...it })) }
      : {
          id: `offline-cart-${Date.now()}`,
          shortCode: `OFF-${Math.floor(1000 + Math.random() * 9000)}`,
          shopperId: currentCallerId,
          shopperName: user?.name || 'Shopper',
          shopperPhone: user?.phone || '',
          supermarketId: activeBranch.supermarketId,
          branchId: activeBranch.id,
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

    const existingItem = baseCart.items.find((i) => i.barcode === product.barcode);
    if (existingItem) {
      existingItem.quantity += quantityToAdd;
      existingItem.effectiveTotal = existingItem.quantity * existingItem.lockedPrice;
    } else {
      baseCart.items.push({
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        productId: product.id,
        barcode: product.barcode,
        name: product.name,
        category: product.category,
        aisle: product.aisle || '',
        shelf: product.shelf || '',
        aisleShelf: product.aisleShelf,
        quantity: quantityToAdd,
        lockedPrice: product.effectivePrice,
        originalBasePrice: product.basePrice,
        discount: Math.max(0, product.basePrice - product.effectivePrice),
        effectiveTotal: product.effectivePrice * quantityToAdd,
        promoName: product.activePromotion?.name,
        scannedAt: new Date().toISOString(),
      });
    }

    let subtotal = 0;
    let finalTotal = 0;
    for (const it of baseCart.items) {
      subtotal += it.originalBasePrice * it.quantity;
      finalTotal += it.effectiveTotal;
    }
    baseCart.subtotal = subtotal;
    baseCart.finalTotal = finalTotal;
    baseCart.totalDiscount = Math.max(0, subtotal - finalTotal);
    baseCart.isOfflineCreated = true;
    baseCart.updatedAt = new Date().toISOString();

    setCart(baseCart);
    await saveOfflineCartSnapshot(activeBranch.id, currentCallerId, baseCart);
    await enqueueOfflineOperation({
      branchId: activeBranch.id,
      callerId: currentCallerId,
      action: 'scan_add',
      barcode: product.barcode,
      productName: product.name,
      quantity: quantityToAdd,
    });
    const nextQueue = await getOfflineQueue(activeBranch.id, currentCallerId);
    setQueuedOps(nextQueue);
    setSyncStatus('queued');
    triggerScanSuccessHaptic();
    return baseCart;
  };

  // Handle scanned barcode (Works seamlessly online and offline via IndexedDB queue)
  const handleBarcodeScanned = async (barcode: string) => {
    if (!branch) {
      onOpenStoreModal();
      return;
    }

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

      if (!isOffline && navigator.onLine) {
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
        } catch {
          // Network failure handled below
        }
      }
      showScanError(t.noProductFound);
      return;
    }

    // Offline or pending queue: persist scanned item into IndexedDB queue immediately
    if (isOffline || !navigator.onLine || queuedOps.length > 0) {
      if (!localProd) {
        showScanError(t.noProductFound);
        return;
      }
      await queueOfflineProductAdd(localProd, 1);
      return;
    }

    // Online Add to Cart (with seamless network-failure fallback to IndexedDB queue)
    try {
      const res = await fetch('/api/shopper/cart/add', {
        method: 'POST',
        headers: getGuestHeaders(),
        body: JSON.stringify({ branchId: branch.id, barcode, quantity: 1, cartId: cart?.id }),
      });
      const updatedCart = await res.json();
      if (res.ok) {
        setCart(updatedCart);
        await saveOfflineCartSnapshot(branch.id, currentCallerId, updatedCart);
        triggerScanSuccessHaptic();
      } else {
        showScanError(updatedCart.error || t.noProductFound);
      }
    } catch (err: any) {
      if (isNetworkOfflineError(err) && localProd) {
        setIsOffline(true);
        await queueOfflineProductAdd(localProd, 1);
      } else {
        showScanError(err?.message || t.noProductFound);
      }
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

    if (isOffline || !navigator.onLine || queuedOps.length > 0) {
      await queueOfflineProductAdd(matchedProduct, command.quantity);
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
        await saveOfflineCartSnapshot(branch.id, currentCallerId, updatedCart);
        triggerScanSuccessHaptic();
        return {
          ok: true,
          message: `${t.voiceAddedPrefix} ${command.quantity} × ${matchedProduct.name} ${t.voiceToCartSuffix}`,
        };
      }
      return { ok: false, message: updatedCart.error || t.noProductFound };
    } catch (err: any) {
      if (isNetworkOfflineError(err)) {
        setIsOffline(true);
        await queueOfflineProductAdd(matchedProduct, command.quantity);
        return {
          ok: true,
          message: `${t.voiceAddedPrefix} ${command.quantity} × ${matchedProduct.name} ${t.voiceToCartSuffix}`,
        };
      }
      return { ok: false, message: err?.message || 'Error adding item to cart' };
    }
  };

  // Helper: offline quantity mutation persisted to IndexedDB queue & snapshot
  const applyOfflineQuantityUpdate = async (
    currentCart: Cart,
    itemId: string,
    newQty: number
  ) => {
    const targetItem = currentCart.items.find((it) => it.id === itemId);
    const updatedItems = currentCart.items
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
      ...currentCart,
      items: updatedItems,
      subtotal,
      finalTotal,
      totalDiscount: Math.max(0, subtotal - finalTotal),
      isOfflineCreated: true,
      updatedAt: new Date().toISOString(),
    };
    const branchKey = branch?.id || currentCart.branchId;
    setCart(updatedCart);
    await saveOfflineCartSnapshot(branchKey, currentCallerId, updatedCart);
    await enqueueOfflineOperation({
      branchId: branchKey,
      callerId: currentCallerId,
      action: 'update_qty',
      itemId,
      barcode: targetItem?.barcode,
      productName: targetItem?.name,
      quantity: newQty,
    });
    const nextQueue = await getOfflineQueue(branchKey, currentCallerId);
    setQueuedOps(nextQueue);
    setSyncStatus('queued');
  };

  // Quantity adjustments (Online or queued in IndexedDB when offline)
  const handleUpdateQuantity = async (itemId: string, newQty: number) => {
    if (!cart) return;

    if (isOffline || !navigator.onLine || queuedOps.length > 0) {
      await applyOfflineQuantityUpdate(cart, itemId, newQty);
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
        await saveOfflineCartSnapshot(branchKey, currentCallerId, updated);
      }
    } catch (err) {
      if (isNetworkOfflineError(err)) {
        setIsOffline(true);
        await applyOfflineQuantityUpdate(cart, itemId, newQty);
      }
    }
  };

  // Update budget limit (Phase 2 Daily Spending Cap) via BudgetAlert component
  const handleUpdateBudgetLimit = async (limit: number | null) => {
    if (!cart) return;
    const branchKey = branch?.id || cart.branchId;
    const updatedCart = { ...cart, budgetLimit: limit };
    setCart(updatedCart);
    await saveOfflineCartSnapshot(branchKey, currentCallerId, updatedCart);

    const queueBudget = async () => {
      await enqueueOfflineOperation({
        branchId: branchKey,
        callerId: currentCallerId,
        action: 'set_budget',
        budgetLimit: limit,
      });
      setQueuedOps(await getOfflineQueue(branchKey, currentCallerId));
      setSyncStatus('queued');
    };

    if (isOffline || !navigator.onLine || queuedOps.length > 0) {
      await queueBudget();
      return;
    }

    try {
      await fetch('/api/shopper/cart/budget', {
        method: 'POST',
        headers: getGuestHeaders(),
        body: JSON.stringify({ cartId: cart.id, budgetLimit: limit }),
      });
    } catch (err) {
      if (isNetworkOfflineError(err)) {
        setIsOffline(true);
        await queueBudget();
      }
    }
  };

  // Show till QR code modal (keeps current code accessible without leaving cart)
  const handleShowTillQr = async () => {
    if (!cart || cart.items.length === 0) return;
    setIsCartCodeModalOpen(true);
  };

  // Finish shopping -> close cart on server (or queue offline) and open Goodbye screen
  const handleConfirmFinishShopping = async () => {
    if (!cart || cart.items.length === 0 || isFinishingCart) return;
    const branchKey = branch?.id || cart.branchId;
    setIsFinishingCart(true);

    const buildOfflineSummary = (): GoodbyeSummaryData => {
      const itemCount = cart.items.reduce((sum, it) => sum + (it.quantity || 1), 0);
      const earned =
        typeof cart.loyaltyPointsEarned === 'number' && cart.loyaltyPointsEarned > 0
          ? cart.loyaltyPointsEarned
          : null;
      const balance =
        user?.role === 'shopper' && loyaltySummary
          ? loyaltySummary.totalPoints
          : null;
      return {
        cartId: cart.id,
        shortCode: cart.shortCode,
        status: 'locked',
        itemCount,
        lineItemCount: cart.items.length,
        subtotal: cart.subtotal,
        totalDiscount: cart.totalDiscount,
        finalTotal: cart.finalTotal,
        branchId: branchKey,
        branchName: branch?.name || '',
        supermarketName: supermarket?.name || '',
        loyaltyEarnedOnCart: earned,
        loyaltyBalance: balance,
        pendingOfflineFinish: true,
        source: 'finish_button',
      };
    };

    const finishOffline = async () => {
      const closedSnapshot = { ...cart, status: 'locked' as const, finishedAt: new Date().toISOString() };
      await saveOfflineCartSnapshot(branchKey, currentCallerId, closedSnapshot);
      const existingQueue = await getOfflineQueue(branchKey, currentCallerId);
      const alreadyQueuedFinish = existingQueue.some((op) => op.action === 'finish_cart');
      if (!alreadyQueuedFinish) {
        await enqueueOfflineOperation({
          branchId: branchKey,
          callerId: currentCallerId,
          action: 'finish_cart',
        });
      }
      setQueuedOps(await getOfflineQueue(branchKey, currentCallerId));
      setSyncStatus('queued');
      setLastClosedCartId(cart.id);
      setCart(null);
      setShowFinishConfirmModal(false);
      setIsFinishingCart(false);
      onShowGoodbye?.(buildOfflineSummary());
    };

    if (isOffline || !navigator.onLine || queuedOps.length > 0) {
      await finishOffline();
      return;
    }

    try {
      const res = await fetch('/api/shopper/cart/finish', {
        method: 'POST',
        headers: getGuestHeaders(),
        body: JSON.stringify({ cartId: cart.id }),
      });
      const data = await res.json();
      if (res.ok && data?.summary) {
        const closedCart: Cart = data.cart;
        setLastClosedCartId(closedCart.id);
        setCart(null);
        await saveOfflineCartSnapshot(branchKey, currentCallerId, closedCart);
        void loadLoyaltyPoints();
        void loadHistory();
        setShowFinishConfirmModal(false);
        setIsFinishingCart(false);
        onShowGoodbye?.({
          ...data.summary,
          pendingOfflineFinish: false,
          source: 'finish_button',
        });
      } else {
        setShowFinishConfirmModal(false);
        setIsFinishingCart(false);
        showScanError(data?.error || 'Could not finish cart right now.');
      }
    } catch (err) {
      if (isNetworkOfflineError(err)) {
        setIsOffline(true);
        await finishOffline();
      } else {
        setShowFinishConfirmModal(false);
        setIsFinishingCart(false);
        showScanError('Could not finish cart. Please try again.');
      }
    }
  };

  // Empty cart
  const handleClearCart = async () => {
    if (!cart || !confirm('Are you sure you want to empty your cart?')) return;
    const branchKey = branch?.id || cart.branchId;

    const clearLocally = async () => {
      const emptyCart: Cart = {
        ...cart,
        items: [],
        subtotal: 0,
        totalDiscount: 0,
        finalTotal: 0,
      };
      setCart(emptyCart);
      await saveOfflineCartSnapshot(branchKey, currentCallerId, emptyCart);
      await clearOfflineQueueForBranch(branchKey, currentCallerId);
      if (!cart.id.startsWith('offline-cart-')) {
        await enqueueOfflineOperation({
          branchId: branchKey,
          callerId: currentCallerId,
          action: 'clear_cart',
        });
      }
      const nextQueue = await getOfflineQueue(branchKey, currentCallerId);
      setQueuedOps(nextQueue);
      setSyncStatus(nextQueue.length > 0 ? 'queued' : 'idle');
    };

    if (isOffline || !navigator.onLine || queuedOps.length > 0) {
      await clearLocally();
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
        await saveOfflineCartSnapshot(branchKey, currentCallerId, emptied);
        await clearOfflineQueueForBranch(branchKey, currentCallerId);
        setQueuedOps([]);
      }
    } catch (err) {
      if (isNetworkOfflineError(err)) {
        setIsOffline(true);
        await clearLocally();
      }
    }
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
        await saveOfflineCartSnapshot(branch.id, currentCallerId, nextCart);
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
        await saveOfflineCartSnapshot(branch.id, currentCallerId, nextCart);
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
    <div className="pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))] pt-3 max-w-xl mx-auto px-4">
      {/* Live IndexedDB Syncing Indicator Banner when connectivity returns */}
      {(isSyncingCart || syncStatus === 'syncing') && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 p-3 rounded-2xl bg-sky-600 text-white text-xs font-semibold shadow-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <RefreshCw className="w-4 h-4 shrink-0 animate-spin" />
              <span className="truncate">{t.syncingQueuedItems}</span>
            </div>
            {syncProgress && (
              <span className="text-[11px] font-mono tabular-nums shrink-0 bg-sky-700/80 px-2 py-0.5 rounded-md">
                {syncProgress.completed}/{syncProgress.total}
              </span>
            )}
          </div>
          {syncProgress && syncProgress.total > 0 && (
            <div className="mt-2 h-1.5 w-full rounded-full bg-sky-800/70 overflow-hidden">
              <div
                className="h-full bg-white transition-all duration-200"
                style={{
                  width: `${Math.min(100, Math.max(15, Math.round((syncProgress.completed / syncProgress.total) * 100)))}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Offline Alert Banner with IndexedDB Queue Counter */}
      {isOffline && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 p-3 rounded-2xl bg-amber-500 text-white text-xs font-semibold flex items-center justify-between gap-2 shadow-sm"
        >
          <div className="flex items-center gap-2 min-w-0">
            <WifiOff className="w-4 h-4 shrink-0 animate-pulse" />
            <span className="truncate">{t.offlineMode}</span>
          </div>
          {(queuedOps.length > 0 || (cart && cart.isOfflineCreated)) && (
            <span className="text-[10px] bg-amber-600 px-2 py-0.5 rounded-md font-mono tabular-nums shrink-0">
              {queuedOps.length > 0
                ? `${queuedOps.length} ${t.queuedItemsLabel}`
                : 'Offline Cart'}
            </span>
          )}
        </div>
      )}

      {/* Pending Queue Retry Banner if online and items still waiting */}
      {!isOffline && !isSyncingCart && syncStatus !== 'syncing' && queuedOps.length > 0 && (
        <div className="mb-3 p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs font-semibold flex items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Clock className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="truncate tabular-nums">
              {queuedOps.length} {t.queuedItemsLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void syncOfflineCartToServer()}
            className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold shrink-0 transition"
          >
            {t.retrySyncBtn}
          </button>
        </div>
      )}

      {/* Non-blocking Scan Error Notice */}
      {scanErrorNotice && (
        <div className="mb-3 p-3 rounded-2xl bg-rose-600 text-white text-xs font-semibold flex items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{scanErrorNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setScanErrorNotice(null)}
            className="p-1 hover:bg-rose-700 rounded-lg"
            aria-label="Close alert"
          >
            <X className="w-3.5 h-3.5" />
          </button>
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

      {/* Store Prompt Banner if no branch selected (except while viewing Past Receipts or Rewards) */}
      {!branch && activeTab !== 'history' && activeTab !== 'rewards' && (
        <div className="space-y-3 mb-4">
          {activeTab !== 'scan' && (
            <div>
              <button
                type="button"
                onClick={() => setActiveTab('scan')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition shadow-xs"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{t.backLabel}</span>
              </button>
            </div>
          )}
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md overflow-hidden">
          <div className="portal-banner-surface relative overflow-hidden p-5 text-center text-white">
            <PortalBackgroundImage portal="shopper" variant="banner" priority />
            <div className="relative z-10">
              <div className="w-12 h-12 rounded-2xl bg-white/15 border border-white/25 text-white flex items-center justify-center mx-auto mb-2.5">
                <Store className="w-6 h-6" />
              </div>
              <h2 className="text-base font-extrabold text-white">
                {t.selectSupermarket} &amp; {t.selectBranch}
              </h2>
              <p className="text-xs text-emerald-100 mt-1 max-w-xs mx-auto">
                Choose your supermarket chain and branch to view local prices and start scanning items.
              </p>
            </div>
          </div>
          <div className="p-4 bg-white dark:bg-slate-900">
            <button
              onClick={onOpenStoreModal}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition shadow-sm"
            >
              {t.nearestBranch}
            </button>
          </div>
          </div>
        </div>
      )}

      {/* Shopper Active Store Hero Banner */}
      {branch && activeTab !== 'history' && activeTab !== 'rewards' && (
        <div className="portal-banner-surface relative overflow-hidden rounded-3xl p-4 sm:p-5 shadow-md mb-4 flex items-center justify-between gap-3">
          <PortalBackgroundImage portal="shopper" variant="banner" priority />
          <div className="relative z-10 min-w-0">
            <span className="text-[11px] font-semibold text-emerald-100 uppercase tracking-wider block">
              {t.activeStore}
            </span>
            <h2 className="text-base sm:text-lg font-extrabold text-white truncate">
              {branch.name}
            </h2>
            <p className="text-[11px] text-emerald-50/90 truncate">
              {branch.address}, {branch.city}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenStoreModal}
            className="relative z-10 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-semibold shrink-0 transition"
          >
            {t.changeBranch}
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

      {/* Loyalty Points Summary Banner */}
      {branch && (() => {
        const totalPts = loyaltySummary?.totalPoints ?? 0;
        const storePts =
          loyaltySummary?.bySupermarket.find((s) => s.supermarketId === branch.supermarketId)?.points ?? 0;
        const tierName =
          loyaltySummary?.tier === 'Gold'
            ? t.loyaltyTierGold
            : loyaltySummary?.tier === 'Silver'
            ? t.loyaltyTierSilver
            : t.loyaltyTierBronze;

        return (
          <button
            type="button"
            onClick={() => {
              void loadLoyaltyPoints();
              setIsLoyaltyModalOpen(true);
            }}
            className="w-full mb-4 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-400 transition flex items-center justify-between gap-2 text-left shadow-xs"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Award className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  {t.loyaltyPointsTitle} · {tierName}
                </p>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-mono truncate">
                  {totalPts.toLocaleString()} {t.loyaltyPointsUnit}
                  {storePts > 0 ? ` (${storePts.toLocaleString()} @ ${branch.name})` : ''}
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold shrink-0">
              {t.loyaltyViewDetailsBtn}
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
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setActiveTab('scan')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{t.backLabel}</span>
              </button>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">
                {t.yourCart}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {(isSyncingCart || queuedOps.length > 0 || (cart && cart.isOfflineCreated)) && (
                <button
                  type="button"
                  onClick={() => void syncOfflineCartToServer()}
                  disabled={isSyncingCart || isOffline}
                  className="text-xs text-sky-600 dark:text-sky-400 font-semibold flex items-center gap-1 p-1 disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCart ? 'animate-spin' : ''}`} />
                  <span>{isSyncingCart ? t.syncingCartStatus : t.syncCartNow}</span>
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

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowFinishConfirmModal(true)}
                    className="w-full h-12 rounded-2xl bg-emerald-500 hover:bg-emerald-600 active:scale-98 text-slate-950 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-emerald-500/20"
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>{t.finishShoppingBtn}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleShowTillQr}
                    className="w-full h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-xs flex items-center justify-center gap-2 border border-slate-700 transition"
                  >
                    <QrCode className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{t.showTillQrBtn}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-3">
              <EmptyCartIllustration className="w-32 h-24" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {t.emptyCartTitle}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                {t.emptyCartDesc}
              </p>
              <button
                onClick={() => setActiveTab('scan')}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition"
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
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setActiveTab('scan')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition shadow-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t.backLabel}</span>
            </button>
          </div>
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
          <div>
            <button
              type="button"
              onClick={() => setActiveTab('scan')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition shadow-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t.backLabel}</span>
            </button>
          </div>
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

      {/* TAB 5: PAST RECEIPTS & HISTORY VIEW (Accessible to logged-in shoppers even before branch picker) */}
      {activeTab === 'history' && (
        <div className="space-y-5">
          <div>
            <button
              type="button"
              onClick={() => setActiveTab('scan')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition shadow-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t.backLabel}</span>
            </button>
          </div>
          <div className="portal-banner-surface relative overflow-hidden p-5 rounded-3xl shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <PortalBackgroundImage portal="shopper" variant="banner" />
            <div className="relative z-10">
              <div className="flex items-center gap-2">
                <ReceiptText className="w-5 h-5 text-emerald-200" />
                <h2 className="text-lg font-extrabold text-white">
                  {t.pastReceiptsTitle}
                </h2>
              </div>
              <p className="text-xs text-emerald-100 mt-0.5">
                {t.pastReceiptsSubtitle}
              </p>
            </div>
            {user && (history.length > 0 || receipts.length > 0) && (
              <button
                type="button"
                onClick={() => openCreateListModal('previous_purchase', (receipts[0] || history[0])?.id)}
                className="relative z-10 self-start sm:self-auto py-2 px-3 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <ListChecks className="w-3.5 h-3.5" />
                <span>{t.createList}</span>
              </button>
            )}
          </div>

          {!user ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <EmptySearchIllustration className="w-28 h-20" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {t.pastReceiptsTitle}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
                {t.receiptsSignInRequired}
              </p>
              {onRequestSignIn && (
                <button
                  type="button"
                  onClick={onRequestSignIn}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-sm"
                >
                  {t.receiptSignInBtn}
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Search Past Receipts */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  value={receiptSearch}
                  onChange={(e) => setReceiptSearch(e.target.value)}
                  placeholder={t.receiptSearchPlaceholder}
                  className="w-full h-10 pl-10 pr-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-emerald-500 shadow-xs"
                />
              </div>

              {/* Completed Transaction Summaries */}
              <div className="space-y-3">
                {isLoadingReceipts && receipts.length === 0 ? (
                  <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                    Loading receipts...
                  </div>
                ) : (() => {
                  const q = receiptSearch.trim().toLowerCase();
                  const filteredReceipts = receipts.filter((r) => {
                    if (!q) return true;
                    return (
                      r.shortCode.toLowerCase().includes(q) ||
                      r.supermarketName.toLowerCase().includes(q) ||
                      r.branchName.toLowerCase().includes(q) ||
                      r.items.some((it) => it.name.toLowerCase().includes(q))
                    );
                  });

                  if (filteredReceipts.length === 0) {
                    return (
                      <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-2.5">
                        <EmptySearchIllustration className="w-28 h-20" />
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {t.receiptEmptyTitle}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                          {t.receiptEmptyDesc}
                        </p>
                      </div>
                    );
                  }

                  return filteredReceipts.map((r) => {
                    const isExpanded = !!expandedReceiptIds[r.id];
                    const timestamp = r.verifiedAt || r.updatedAt || r.createdAt;
                    return (
                      <article
                        key={r.id}
                        className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md">
                                {r.shortCode}
                              </span>
                              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                {r.status}
                              </span>
                            </div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-1 truncate">
                              {r.supermarketName} — {r.branchName}
                            </h3>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {new Date(timestamp).toLocaleDateString()} ·{' '}
                              {new Date(timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}{' '}
                              · {r.itemCount} {t.itemsCount}
                            </p>
                          </div>

                          <div className="text-right shrink-0">
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                              {t.totalSpent}
                            </p>
                            <p className="text-base font-black text-slate-900 dark:text-white tabular-nums">
                              KES {r.finalTotal.toLocaleString()}
                            </p>
                            {r.totalDiscount > 0 && (
                              <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                - KES {r.totalDiscount.toLocaleString()} saved
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 rounded-xl border border-slate-100 dark:border-slate-800">
                          <span>{t.receiptNoPaymentNote}</span>
                          {r.verifiedByName && (
                            <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                              <UserCheck className="w-3 h-3 text-emerald-600" />
                              {t.receiptVerifiedBy}: {r.verifiedByName}
                            </span>
                          )}
                        </div>

                        {/* Collapsible Line Items */}
                        <div>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedReceiptIds((prev) => ({
                                ...prev,
                                [r.id]: !prev[r.id],
                              }))
                            }
                            className="w-full py-1.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between transition"
                          >
                            <span>
                              {isExpanded ? t.receiptHideItems : t.receiptShowItems} ({r.items.length})
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>

                          {isExpanded && (
                            <div className="mt-2 text-xs text-slate-700 dark:text-slate-300 divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800">
                              {r.items.map((it, idx) => (
                                <div key={idx} className="py-1.5 flex justify-between gap-2 text-[11px]">
                                  <span className="truncate">
                                    {it.quantity}x {it.name}
                                  </span>
                                  <span className="font-mono font-semibold text-slate-600 dark:text-slate-300 shrink-0 tabular-nums">
                                    KES {it.effectiveTotal.toLocaleString()}
                                  </span>
                                </div>
                              ))}
                              <div className="pt-2 mt-1 flex justify-between text-xs font-bold text-slate-900 dark:text-white">
                                <span>{t.subtotal}</span>
                                <span className="font-mono tabular-nums">
                                  KES {r.subtotal.toLocaleString()}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="pt-1 flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSummaryCardCart(r)}
                            className="py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
                          >
                            <Share2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{t.summaryCardBtn}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              openCreateListModal(
                                'previous_purchase',
                                r.id,
                                undefined,
                                `Restock (${r.shortCode})`
                              )
                            }
                            className="py-2 px-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
                          >
                            <ListChecks className="w-3.5 h-3.5" />
                            <span>{t.savePurchaseAsList}</span>
                          </button>

                          {branch && (
                            <button
                              type="button"
                              onClick={() => handleReAddPastCart(r.id)}
                              className="py-2 px-3.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
                            >
                              <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
                              <span>{t.reAddCart}</span>
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  });
                })()}
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
            </>
          )}
        </div>
      )}

      {/* TAB 6: MERCHANDISE REWARDS & POINTS LEDGER */}
      {activeTab === 'rewards' && (
        <ShopperRewardsView
          user={user}
          token={token}
          activeBranch={branch}
          loyaltySummary={loyaltySummary}
          onRefreshLoyalty={loadLoyaltyPoints}
          onRequestSignIn={onRequestSignIn}
          onBack={() => setActiveTab('scan')}
        />
      )}

      {/* ShopperView Footer: Device Battery Charge Status & Mobile Bottom Nav */}
      <footer
        aria-label={t.batteryStatusLabel}
        className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-[env(safe-area-inset-bottom,0px)]"
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
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="p-5 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{t.createList}</h3>
              <button
                type="button"
                onClick={() => setShowCreateListModal(false)}
                aria-label="Close"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 pt-4 overflow-y-auto overscroll-y-contain flex-1 min-h-0 space-y-4">

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
        </div>
      )}

      {/* Modal: Import Items from Product History into Active Shared List */}
      {showImportHistoryModal && selectedList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90dvh] flex flex-col overflow-hidden">
            <div className="p-5 pb-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-600" />
                <span>{t.importFromHistory}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowImportHistoryModal(false)}
                aria-label="Close"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 pt-3 overflow-y-auto overscroll-y-contain space-y-1.5 flex-1 min-h-0">
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

            <div className="p-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex gap-2 shrink-0">
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
        onClose={() => {
          const finishedCart = cart && (cart.status === 'completed' || cart.status === 'verified');
          setIsCartCodeModalOpen(false);
          if (finishedCart) {
            void loadCart();
            if (user && token) {
              void loadReceipts();
            }
            void loadHistory();
            void loadProductHistory();
            void loadLoyaltyPoints();
          }
        }}
        cart={cart}
        onRefreshCart={loadCart}
        onOpenSummaryCard={(finishedCart) => {
          setIsCartCodeModalOpen(false);
          setSummaryCardCart(finishedCart);
          void loadLoyaltyPoints();
        }}
      />

      {/* Post-Checkout Visual & Shareable Cart Summary Card Modal */}
      <CartSummaryCardModal
        isOpen={Boolean(summaryCardCart)}
        onClose={() => {
          const shouldRefreshFreshCart =
            cart && (cart.status === 'completed' || cart.status === 'verified');
          setSummaryCardCart(null);
          if (shouldRefreshFreshCart) {
            void loadCart();
            if (user && token) {
              void loadReceipts();
            }
            void loadHistory();
            void loadProductHistory();
            void loadLoyaltyPoints();
          }
        }}
        cart={summaryCardCart}
        branchName={branch?.name}
        branchLocation={branch ? `${branch.address}, ${branch.city}` : undefined}
      />

      {/* Shopper Loyalty Points Breakdown Modal */}
      <LoyaltyPointsModal
        isOpen={isLoyaltyModalOpen}
        onClose={() => setIsLoyaltyModalOpen(false)}
        summary={loyaltySummary}
        activeSupermarketId={branch?.supermarketId}
        onOpenRewards={() => setActiveTab('rewards')}
      />

      {/* Finish Shopping Confirmation Modal */}
      {showFinishConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="finish-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in"
        >
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <h3
                  id="finish-confirm-title"
                  className="text-base font-extrabold text-slate-900 dark:text-white"
                >
                  {t.finishConfirmTitle}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t.finishConfirmDesc}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFinishConfirmModal(false)}
                aria-label={t.finishConfirmKeep}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {cart && (
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3 flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  {totalItemCount} {t.itemsCount} · <span className="font-mono">{cart.shortCode}</span>
                </span>
                <span className="font-bold font-mono text-emerald-700 dark:text-emerald-400 tabular-nums">
                  KES {cart.finalTotal.toLocaleString()}
                </span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                disabled={isFinishingCart}
                onClick={() => setShowFinishConfirmModal(false)}
                className="flex-1 min-h-[42px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold transition"
              >
                {t.finishConfirmKeep}
              </button>
              <button
                type="button"
                disabled={isFinishingCart}
                onClick={handleConfirmFinishShopping}
                className="flex-1 min-h-[42px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-extrabold transition shadow-sm"
              >
                {isFinishingCart ? t.finishingCartProgress : t.finishConfirmYes}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
