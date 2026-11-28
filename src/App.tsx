// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useTranslation } from './utils/i18n';
import { Header } from './components/Header';
import { StoreModal } from './components/StoreModal';
import { AuthModal } from './components/AuthModal';
import { LegalFooter } from './components/LegalFooter';
import { ShopperView } from './views/ShopperView';
import { CashierView } from './views/CashierView';
import { OwnerView } from './views/OwnerView';
import { AdminView } from './views/AdminView';
import { AboutView } from './views/AboutView';
import { AdminLoginView } from './components/AdminLoginView';
import { PortalLoginView } from './components/PortalLoginView';
import { ForcePasswordChangeModal } from './components/ForcePasswordChangeModal';
import { SmartCartChat } from './components/SmartCartChat';
import { WelcomeScreen } from './components/WelcomeScreen';
import { GoodbyeScreen } from './components/GoodbyeScreen';
import { ShopperTab } from './components/BottomNav';
import {
  readWelcomeDismissed,
  persistWelcomeDismissed,
  shouldShowWelcomeScreen,
} from './utils/welcomeState';
import { Cart, GoodbyeSummaryData, PortalType } from './types';

function AppContent() {
  const { user, token, logout, isLoading } = useAuth();
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState<string>(() => window.location.pathname);
  const [activePortal, setActivePortal] = useState<PortalType>(() => {
    const p = window.location.pathname;
    if (p.startsWith('/staff')) return 'staff';
    if (p.startsWith('/store')) return 'management';
    return 'shopper';
  });
  const [isStoreModalOpen, setIsStoreModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('smartcart_theme');
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch {
      return false;
    }
  });

  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [isPowerSave, setIsPowerSave] = useState<boolean>(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const refreshingRef = useRef(false);

  // Welcome & Goodbye screen state
  const [welcomeDismissed, setWelcomeDismissed] = useState<boolean>(() => readWelcomeDismissed());
  const [forceWelcomeOpen, setForceWelcomeOpen] = useState<boolean>(false);
  const [guestSessionActive, setGuestSessionActive] = useState<boolean>(false);
  const [goodbyeData, setGoodbyeData] = useState<GoodbyeSummaryData | null>(null);
  const [isStartingNewCart, setIsStartingNewCart] = useState<boolean>(false);
  const [shopperTabRequest, setShopperTabRequest] = useState<{ tab: ShopperTab; nonce: number } | null>(null);
  const [newCartNonce, setNewCartNonce] = useState<number>(0);
  const shopperActivityRef = useRef<{ cart: Cart | null; lastClosedCartId: string | null }>({
    cart: null,
    lastClosedCartId: null,
  });

  const navigateTo = (path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  // Sync light/dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem('smartcart_theme', isDarkMode ? 'dark' : 'light');
    } catch {
      // ignore storage errors
    }
  }, [isDarkMode]);

  // Sync route path on popstate
  useEffect(() => {
    const handleLocationChange = () => {
      const p = window.location.pathname;
      setCurrentPath(p);
      if (p.startsWith('/staff')) setActivePortal('staff');
      else if (p.startsWith('/store')) setActivePortal('management');
      else if (p.startsWith('/login') || p === '/' || p === '/receipts' || p === '/about') {
        setActivePortal('shopper');
      }
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  // Monitor network connectivity & low-battery / data-saver to pause ambient motion automatically
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const nav = navigator as unknown as {
      connection?: { saveData?: boolean };
      getBattery?: () => Promise<{
        level: number;
        charging: boolean;
        addEventListener: (ev: string, fn: () => void) => void;
        removeEventListener: (ev: string, fn: () => void) => void;
      }>;
    };

    const saveData = Boolean(nav.connection?.saveData);
    if (saveData) setIsPowerSave(true);

    let batteryObj: Awaited<ReturnType<NonNullable<typeof nav.getBattery>>> | null = null;
    const syncBatterySave = () => {
      if (!batteryObj) return;
      const lowPower = !batteryObj.charging && batteryObj.level <= 0.2;
      setIsPowerSave(saveData || lowPower);
    };

    if (typeof nav.getBattery === 'function') {
      nav
        .getBattery()
        .then((bat) => {
          batteryObj = bat;
          syncBatterySave();
          bat.addEventListener('levelchange', syncBatterySave);
          bat.addEventListener('chargingchange', syncBatterySave);
        })
        .catch(() => {});
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (batteryObj) {
        batteryObj.removeEventListener('levelchange', syncBatterySave);
        batteryObj.removeEventListener('chargingchange', syncBatterySave);
      }
    };
  }, []);

  // Register Service Worker for PWA & listen for waiting updates
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleControllerChange = () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(reg.waiting);
        }
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              setWaitingWorker(newWorker);
            }
          });
        });
      })
      .catch((err) => console.warn('Service Worker registration failed:', err));

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  const handleApplySwUpdate = () => {
    if (!waitingWorker) return;
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  };

  // Automatically align portal & URL when user logs in or logs out
  useEffect(() => {
    if (user) {
      setForceWelcomeOpen(false);
      setGoodbyeData(null);
      if (user.role === 'staff') {
        setActivePortal('staff');
      } else if (user.role === 'owner') {
        setActivePortal('management');
      } else if (user.role === 'admin') {
        setActivePortal('management');
        if (!user.mustChangePassword && currentPath === '/admin/login') {
          navigateTo('/admin/dashboard');
        }
      } else if (user.role === 'shopper') {
        setActivePortal('shopper');
      }
    } else if (currentPath.startsWith('/admin') && currentPath !== '/admin/login') {
      navigateTo('/admin/login');
    }
  }, [user]);

  const handleDismissWelcomeToLogin = (portal: PortalType, path: string) => {
    persistWelcomeDismissed();
    setWelcomeDismissed(true);
    setForceWelcomeOpen(false);
    setGuestSessionActive(false);
    setActivePortal(portal);
    navigateTo(path);
  };

  const handleHeaderLogout = async () => {
    if (user?.role === 'shopper') {
      const { cart, lastClosedCartId } = shopperActivityRef.current;
      const hasActiveItems = Boolean(cart && cart.items.length > 0);
      const targetCartId = hasActiveItems ? cart?.id : lastClosedCartId || cart?.id;

      if (hasActiveItems || lastClosedCartId) {
        let guestId = '';
        try {
          guestId = localStorage.getItem('smartcart_guest_id') || '';
        } catch {
          // ignore storage errors
        }

        const authHeaders: Record<string, string> = {};
        if (token) authHeaders['Authorization'] = `Bearer ${token}`;
        if (guestId) authHeaders['x-guest-id'] = guestId;

        if (hasActiveItems && cart?.status === 'active' && isOnline) {
          try {
            const finishRes = await fetch('/api/shopper/cart/finish', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...authHeaders,
              },
              body: JSON.stringify({ cartId: cart.id }),
            });
            if (finishRes.ok) {
              const finishPayload = await finishRes.json();
              if (finishPayload?.summary) {
                logout();
                setGoodbyeData({
                  ...finishPayload.summary,
                  signedOutAfterShopping: true,
                  source: 'sign_out',
                });
                return;
              }
            }
          } catch {
            // Fall through to summary lookup / offline fallback
          }
        }

        if (isOnline) {
          try {
            const query = targetCartId ? `?cartId=${encodeURIComponent(targetCartId)}` : '';
            const res = await fetch(`/api/shopper/cart/summary${query}`, { headers: authHeaders });
            if (res.ok) {
              const payload = await res.json();
              const summary: GoodbyeSummaryData = payload?.summary || payload;
              if (summary && typeof summary.finalTotal === 'number') {
                logout();
                setGoodbyeData({
                  ...summary,
                  signedOutAfterShopping: true,
                  source: 'sign_out',
                });
                return;
              }
            }
          } catch {
            // Fall through to offline / local fallback
          }
        }

        if (cart) {
          const subtotal =
            typeof cart.subtotal === 'number'
              ? cart.subtotal
              : cart.items.reduce((sum, item) => sum + item.lockedPrice * item.quantity, 0);
          const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
          logout();
          setGoodbyeData({
            cartId: cart.id,
            shortCode: cart.shortCode,
            status: cart.status,
            itemCount,
            lineItemCount: cart.items.length,
            subtotal,
            totalDiscount: cart.totalDiscount || 0,
            finalTotal:
              typeof cart.finalTotal === 'number'
                ? cart.finalTotal
                : Math.max(0, subtotal - (cart.totalDiscount || 0)),
            branchId: cart.branchId,
            loyaltyEarnedOnCart:
              typeof cart.loyaltyPointsEarned === 'number' && cart.loyaltyPointsEarned > 0
                ? cart.loyaltyPointsEarned
                : null,
            loyaltyBalance: null,
            pendingOfflineFinish: !isOnline,
            signedOutAfterShopping: true,
            source: 'sign_out',
          });
          return;
        }
      }
    }

    logout();
  };

  const handleGoodbyeStartNewCart = async () => {
    setIsStartingNewCart(true);
    try {
      setGoodbyeData(null);
      if (!user) {
        setGuestSessionActive(true);
      }
      setActivePortal('shopper');
      setShopperTabRequest({ tab: 'scan', nonce: Date.now() });
      setNewCartNonce((prev) => prev + 1);
      navigateTo('/');
    } finally {
      setIsStartingNewCart(false);
    }
  };

  const handleGoodbyeViewRewards = () => {
    setGoodbyeData(null);
    if (!user) {
      setGuestSessionActive(true);
    }
    setActivePortal('shopper');
    setShopperTabRequest({ tab: 'rewards', nonce: Date.now() });
    navigateTo('/');
  };

  const handleGoodbyeSignOutOrIn = () => {
    if (user) {
      logout();
    }
    setGoodbyeData(null);
    setGuestSessionActive(false);
    setActivePortal('shopper');
    navigateTo('/login');
  };

  const handleGoodbyeBackToDashboard = () => {
    setGoodbyeData(null);
    if (!user) {
      setGuestSessionActive(true);
    }
    setActivePortal('shopper');
    navigateTo('/');
  };

  const isAdminRoute = currentPath.startsWith('/admin');
  const isAboutRoute = currentPath === '/about';
  const isShopperLoginRoute = currentPath === '/login';
  const isReceiptsRoute = currentPath === '/receipts';

  const resolvedThemePortal =
    isAdminRoute || user?.role === 'admin'
      ? 'admin'
      : isAboutRoute
      ? 'shopper'
      : activePortal;

  // Sync data attributes on <html> so themes.css variables & reduced-power selectors take effect everywhere
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.portal = resolvedThemePortal;
    root.dataset.offline = isOnline ? 'false' : 'true';
    root.dataset.powerSave = isPowerSave ? 'true' : 'false';
  }, [resolvedThemePortal, isOnline, isPowerSave]);

  // Portal-specific page titles
  useEffect(() => {
    if (isAboutRoute) {
      document.title = 'Smart Cart — About & Legal';
    } else if (isAdminRoute) {
      document.title =
        user?.role === 'admin' && !user.mustChangePassword
          ? 'Smart Cart — System Admin Dashboard'
          : 'Smart Cart — System Administration Sign-In';
    } else if (activePortal === 'staff' || currentPath.startsWith('/staff')) {
      document.title = 'Smart Cart — Staff & Till Portal';
    } else if (activePortal === 'management' || currentPath.startsWith('/store')) {
      document.title = 'Smart Cart — Store Management Portal';
    } else if (isShopperLoginRoute) {
      document.title = 'Smart Cart — Shopper Sign-In';
    } else if (isReceiptsRoute) {
      document.title = 'Smart Cart — Past Receipts';
    } else {
      document.title = 'Smart Cart';
    }
  }, [isAboutRoute, isAdminRoute, isShopperLoginRoute, isReceiptsRoute, activePortal, currentPath, user]);

  if (isLoading) {
    return (
      <div className="min-h-dvh app-shell-root flex items-center justify-center portal-shell-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Loading Smart Cart...</p>
        </div>
      </div>
    );
  }

  const showWelcome = shouldShowWelcomeScreen({
    isLoading,
    user,
    currentPath,
    welcomeDismissed,
    forceWelcomeOpen,
    guestSessionActive,
    hasActiveGoodbye: Boolean(goodbyeData),
  });

  const showReturningShopperLogin =
    !user &&
    welcomeDismissed &&
    !guestSessionActive &&
    !showWelcome &&
    !goodbyeData &&
    !isAdminRoute &&
    !isAboutRoute &&
    !isReceiptsRoute &&
    !isShopperLoginRoute &&
    activePortal === 'shopper';

  const showingShopperShell =
    !goodbyeData &&
    !showWelcome &&
    !showReturningShopperLogin &&
    !isAdminRoute &&
    !isAboutRoute &&
    !(isShopperLoginRoute && user?.role !== 'shopper') &&
    !(user?.role === 'admin' && user.mustChangePassword) &&
    activePortal === 'shopper';

  return (
    <div className="min-h-dvh app-shell-root portal-shell-bg text-slate-900 dark:text-slate-100 flex flex-col antialiased transition-colors">
      {/* Top Bar Header with 3-portal switcher, light/dark toggle, and store info */}
      <Header
        activePortal={isAdminRoute ? 'management' : isAboutRoute ? 'shopper' : activePortal}
        onNavigateHome={() => {
          setGoodbyeData(null);
          setForceWelcomeOpen(false);
          if (isAdminRoute || (activePortal === 'management' && user?.role === 'admin')) {
            navigateTo(user?.role === 'admin' && !user.mustChangePassword ? '/admin/dashboard' : '/admin/login');
          } else if (activePortal === 'staff') {
            navigateTo(user?.role === 'staff' ? '/staff' : '/staff/login');
          } else if (activePortal === 'management') {
            navigateTo(user?.role === 'owner' ? '/store' : '/store/login');
          } else {
            navigateTo('/');
            setActivePortal('shopper');
          }
        }}
        onSwitchPortal={(portal) => {
          setGoodbyeData(null);
          setForceWelcomeOpen(false);
          if (portal === 'shopper') navigateTo('/');
          else if (portal === 'staff') navigateTo('/staff/login');
          else if (portal === 'management') navigateTo('/store/login');
          setActivePortal(portal);
        }}
        onOpenStoreModal={() => setIsStoreModalOpen(true)}
        onOpenAuthModal={() => {
          if (activePortal === 'shopper' || isAboutRoute) {
            setForceWelcomeOpen(false);
            setGoodbyeData(null);
            navigateTo('/login');
          } else {
            setIsAuthModalOpen(true);
          }
        }}
        onLogoutRequest={handleHeaderLogout}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode((prev) => !prev)}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col">
        {goodbyeData ? (
          <GoodbyeScreen
            summary={goodbyeData}
            isSignedIn={Boolean(user)}
            onStartNewCart={handleGoodbyeStartNewCart}
            onViewRewards={handleGoodbyeViewRewards}
            onSignOutOrSignIn={handleGoodbyeSignOutOrIn}
            onBackToDashboard={handleGoodbyeBackToDashboard}
            isStartingNewCart={isStartingNewCart}
          />
        ) : showWelcome ? (
          <WelcomeScreen
            onGetStarted={() => handleDismissWelcomeToLogin('shopper', '/login')}
            onSelectOwnerPortal={() => handleDismissWelcomeToLogin('management', '/store/login')}
            onSelectStaffPortal={() => handleDismissWelcomeToLogin('staff', '/staff/login')}
          />
        ) : isAboutRoute ? (
          <AboutView
            onBackHome={() => {
              navigateTo('/');
              setActivePortal('shopper');
            }}
          />
        ) : isAdminRoute ? (
          user?.role === 'admin' && !user.mustChangePassword ? (
            <AdminView />
          ) : (
            <AdminLoginView
              onSuccess={() => {
                navigateTo('/admin/dashboard');
              }}
            />
          )
        ) : (
          <>
            {/* If admin is signed in but must change temporary password, enforce it immediately */}
            {user?.role === 'admin' && user.mustChangePassword ? (
              <AdminLoginView
                onSuccess={() => {
                  navigateTo('/admin/dashboard');
                }}
              />
            ) : (isShopperLoginRoute || showReturningShopperLogin) && user?.role !== 'shopper' ? (
              <PortalLoginView
                portal="shopper"
                onSwitchPortal={(portal) => {
                  if (portal === 'staff') navigateTo('/staff/login');
                  else if (portal === 'management') navigateTo('/store/login');
                  else navigateTo('/');
                  setActivePortal(portal);
                }}
                onContinueAsGuest={() => {
                  persistWelcomeDismissed();
                  setWelcomeDismissed(true);
                  setGuestSessionActive(true);
                  navigateTo('/');
                  setActivePortal('shopper');
                }}
                onOpenAdminLogin={() => navigateTo('/admin/login')}
                onOpenWelcome={() => setForceWelcomeOpen(true)}
              />
            ) : activePortal === 'shopper' ? (
              <ShopperView
                initialTab={isReceiptsRoute ? 'history' : 'scan'}
                requestedTabNonce={shopperTabRequest}
                newCartNonce={newCartNonce}
                onOpenStoreModal={() => setIsStoreModalOpen(true)}
                onRequestSignIn={() => navigateTo('/login')}
                onShowGoodbye={(summary) => setGoodbyeData(summary)}
                onOfflineFinishSynced={(summary) =>
                  setGoodbyeData((prev) => (prev ? { ...summary, signedOutAfterShopping: prev.signedOutAfterShopping, source: prev.source } : prev))
                }
                onShopperActivityChange={(info) => {
                  shopperActivityRef.current = info;
                }}
              />
            ) : activePortal === 'staff' ? (
              user?.role === 'staff' ? (
                <CashierView />
              ) : (
                <PortalLoginView
                  portal="staff"
                  onSwitchPortal={(portal) => {
                    if (portal === 'shopper') navigateTo('/login');
                    else if (portal === 'management') navigateTo('/store/login');
                    setActivePortal(portal);
                  }}
                  onContinueAsGuest={() => {
                    setGuestSessionActive(true);
                    navigateTo('/');
                    setActivePortal('shopper');
                  }}
                  onOpenAdminLogin={() => navigateTo('/admin/login')}
                  onOpenWelcome={() => setForceWelcomeOpen(true)}
                />
              )
            ) : activePortal === 'management' ? (
              user?.role === 'admin' ? (
                <AdminView />
              ) : user?.role === 'owner' ? (
                <OwnerView />
              ) : (
                <PortalLoginView
                  portal="management"
                  onSwitchPortal={(portal) => {
                    if (portal === 'shopper') navigateTo('/login');
                    else if (portal === 'staff') navigateTo('/staff/login');
                    setActivePortal(portal);
                  }}
                  onContinueAsGuest={() => {
                    setGuestSessionActive(true);
                    navigateTo('/');
                    setActivePortal('shopper');
                  }}
                  onOpenAdminLogin={() => navigateTo('/admin/login')}
                  onOpenWelcome={() => setForceWelcomeOpen(true)}
                />
              )
            ) : null}
          </>
        )}
      </main>

      {/* Discreet Copyright & Legal Footer on Every Page & Portal (no link to /admin) */}
      <LegalFooter
        hasFixedBottomBar={showingShopperShell}
        onNavigateAbout={() => navigateTo('/about')}
      />

      {/* Store and Branch Selector Modal */}
      <StoreModal
        isOpen={isStoreModalOpen}
        onClose={() => setIsStoreModalOpen(false)}
      />

      {/* Authentication Modal with portal tabs */}
      <AuthModal
        isOpen={isAuthModalOpen}
        portal={activePortal}
        onSwitchPortal={setActivePortal}
        onOpenAdminLogin={() => navigateTo('/admin/login')}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* Forced Password Change for Shopper / Staff / Owner signing in with a temporary password */}
      <ForcePasswordChangeModal />

      {/* Service Worker Update Prompt */}
      {waitingWorker && (
        <div
          className="fixed left-4 right-4 sm:left-auto sm:right-4 z-50 max-w-sm flex items-center justify-between gap-3 rounded-2xl bg-slate-900 dark:bg-emerald-950 text-white px-4 py-2.5 text-xs shadow-2xl border border-emerald-500/40"
          style={{
            bottom: showingShopperShell
              ? 'calc(5.75rem + env(safe-area-inset-bottom, 0px))'
              : 'calc(1rem + env(safe-area-inset-bottom, 0px))',
          }}
        >
          <span className="font-medium">{t.updateAvailable}</span>
          <button
            type="button"
            onClick={handleApplySwUpdate}
            className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold shrink-0 transition"
          >
            {t.refreshNow}
          </button>
        </div>
      )}

      {/* Real-Time Offline Mode Indicator Banner */}
      {!isOnline && (
        <div
          className="fixed left-4 z-40 flex items-center gap-2 rounded-xl bg-amber-500 text-white px-3.5 py-2 text-xs font-semibold shadow-lg shadow-amber-500/20 border border-amber-400"
          style={{
            bottom: showingShopperShell
              ? 'calc(5.75rem + env(safe-area-inset-bottom, 0px))'
              : 'calc(1rem + env(safe-area-inset-bottom, 0px))',
          }}
        >
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          <span>Offline Mode — Working from local branch cache</span>
        </div>
      )}

      {/* Multi-turn Gemini AI Assistant */}
      <SmartCartChat hasFixedBottomBar={showingShopperShell} />
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </LanguageProvider>
  );
}
