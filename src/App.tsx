/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './utils/i18n';
import { Header } from './components/Header';
import { StoreModal } from './components/StoreModal';
import { AuthModal } from './components/AuthModal';
import { ShopperView } from './views/ShopperView';
import { CashierView } from './views/CashierView';
import { OwnerView } from './views/OwnerView';
import { AdminView } from './views/AdminView';
import { AdminLoginView } from './components/AdminLoginView';
import { PortalLoginView } from './components/PortalLoginView';
import { PortalType } from './types';

function AppContent() {
  const { user, isLoading } = useAuth();
  const [activePortal, setActivePortal] = useState<PortalType>('shopper');
  const [isStoreModalOpen, setIsStoreModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState<string>(() => window.location.pathname);

  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  // Sync route path on popstate
  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  // Monitor network connectivity status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Register Service Worker for PWA (browser-safe, no process.env)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => console.log('Service Worker registered with scope:', reg.scope))
        .catch((err) => console.warn('Service Worker registration failed:', err));
    }
  }, []);

  // Automatically align portal when user logs in or role changes
  useEffect(() => {
    if (user) {
      if (user.role === 'staff') {
        setActivePortal('staff');
      } else if (user.role === 'owner' || user.role === 'admin') {
        setActivePortal('management');
      } else if (user.role === 'shopper') {
        setActivePortal('shopper');
      }
    }
  }, [user]);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-semibold text-slate-500">Loading Smart Cart...</p>
        </div>
      </div>
    );
  }

  const isAdminRoute = currentPath.startsWith('/admin');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col antialiased">
      {/* Top Bar Header with 3-portal switcher and store info */}
      <Header
        activePortal={isAdminRoute ? 'management' : activePortal}
        onSwitchPortal={(portal) => {
          if (isAdminRoute) {
            navigateTo('/');
          }
          setActivePortal(portal);
        }}
        onOpenStoreModal={() => setIsStoreModalOpen(true)}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1">
        {/* Case 1: Admin route /admin/login or /admin/setup */}
        {isAdminRoute ? (
          user?.role === 'admin' && !user.mustChangePassword ? (
            <AdminView />
          ) : (
            <AdminLoginView
              onSuccess={() => {
                navigateTo('/admin/login');
              }}
            />
          )
        ) : (
          /* Case 2: Three Portals From The Start */
          <>
            {/* If admin is signed in but must change temporary password, enforce it immediately */}
            {user?.role === 'admin' && user.mustChangePassword ? (
              <AdminLoginView />
            ) : activePortal === 'shopper' ? (
              <ShopperView onOpenStoreModal={() => setIsStoreModalOpen(true)} />
            ) : activePortal === 'staff' ? (
              user?.role === 'staff' ? (
                <CashierView />
              ) : (
                <PortalLoginView
                  portal="staff"
                  onSwitchPortal={setActivePortal}
                  onContinueAsGuest={() => setActivePortal('shopper')}
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
                  onSwitchPortal={setActivePortal}
                  onContinueAsGuest={() => setActivePortal('shopper')}
                />
              )
            ) : null}
          </>
        )}
      </main>

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
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* Real-Time Offline Mode Indicator Banner */}
      {!isOnline && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-500 text-white px-3.5 py-2 text-xs font-semibold shadow-lg shadow-amber-500/20 border border-amber-400">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          <span>Offline Mode — Working from local branch cache</span>
        </div>
      )}
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
