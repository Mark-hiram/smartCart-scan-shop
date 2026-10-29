import React from 'react';
import {
  ShoppingCart,
  Store,
  Shield,
  User as UserIcon,
  ChevronDown,
  Check,
  LogOut,
  UserCheck,
  LogIn,
  KeyRound,
  ArrowRight,
} from 'lucide-react';
import { Supermarket, User } from '../types.ts';
import { PWAInstallButton } from './PWAInstallButton.tsx';

interface NavbarProps {
  currentUser: User;
  currentSupermarket: Supermarket | null;
  itemCount: number;
  estimatedTotal: number;
  onOpenSupermarketSelector: () => void;
  onOpenCart: () => void;
  onSwitchUser?: (user: User) => void;
  onOpenAccount?: () => void;
  onSignOut: () => void;
  availableUsers?: User[];
  currentView: 'customer' | 'admin' | 'system';
  onNavigateView: (view: 'customer' | 'admin' | 'system') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  currentSupermarket,
  itemCount,
  estimatedTotal,
  onOpenSupermarketSelector,
  onOpenCart,
  onOpenAccount,
  onSignOut,
  currentView,
  onNavigateView,
}) => {
  const [showUserDropdown, setShowUserDropdown] = React.useState(false);

  return (
    <header className="sticky top-0 z-40 bg-emerald-900 text-white shadow-md border-b border-emerald-800">
      {/* Top Banner: Connected Supermarket status */}
      <div className="bg-emerald-950/80 px-3 py-1.5 border-b border-emerald-800/60 text-xs">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          {currentUser.role === 'SUPERMARKET_ADMIN' ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-emerald-200 truncate">Store Admin at:</span>
              <span className="font-bold text-amber-300 truncate">
                {currentSupermarket ? currentSupermarket.name : 'Store'}
              </span>
              <span className="text-[10px] bg-emerald-800 px-1.5 py-0.5 rounded text-emerald-200 font-mono">
                {currentSupermarket?.supermarket_code || 'NONE'}
              </span>
              <span className="text-[9px] bg-amber-400/20 text-amber-300 border border-amber-400/30 px-1.5 py-0.2 rounded font-bold">
                Store Tenant Active
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="text-emerald-200 truncate">Shopping at:</span>
              <button
                onClick={onOpenSupermarketSelector}
                className="font-bold text-amber-300 hover:text-amber-200 underline decoration-amber-400/60 flex items-center gap-1 truncate"
                title="Click to switch supermarket"
              >
                <span className="truncate">{currentSupermarket ? currentSupermarket.name : 'Select Supermarket'}</span>
                <span className="text-[10px] bg-emerald-800 px-1.5 py-0.5 rounded text-emerald-200 font-mono">
                  {currentSupermarket?.supermarket_code || 'NONE'}
                </span>
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0">
            {currentUser.role !== 'SUPERMARKET_ADMIN' && (
              <button
                onClick={onOpenSupermarketSelector}
                className="text-[11px] bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 px-2 py-0.5 rounded border border-amber-400/40 font-medium transition"
              >
                Change Store
              </button>
            )}
            {currentUser.role === 'SUPERMARKET_ADMIN' && (
              <span className="text-[11px] text-emerald-300/80 italic font-mono hidden sm:inline">
                Store Portal
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Header Bar */}
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-2.5 flex items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (currentUser.role === 'SUPERMARKET_ADMIN') {
                onNavigateView('admin');
              } else {
                onNavigateView('customer');
              }
            }}
            className="flex items-center gap-2 text-left group"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 text-emerald-950 flex items-center justify-center font-black shadow-lg shadow-amber-500/20 group-hover:scale-105 transition">
              <ShoppingCart className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-black tracking-tight leading-none text-white font-['Plus_Jakarta_Sans']">
                  SMART<span className="text-amber-400">CART</span>
                </span>
                <span className="text-[9px] font-bold bg-amber-400 text-emerald-950 px-1 py-0.2 rounded leading-tight tracking-wider uppercase">
                  KE
                </span>
              </div>
              <p className="text-[10px] text-emerald-200/80 font-medium tracking-tight">
                Scan &amp; Shop Supermarket System
              </p>
            </div>
          </button>
        </div>

        {/* Center Navigation tabs (Only visible to authenticated Store / System Admins) */}
        {(currentUser.role === 'SUPERMARKET_ADMIN' || currentUser.role === 'SYSTEM_ADMIN') && (
          <nav className="hidden md:flex items-center gap-1 bg-emerald-950/60 p-1 rounded-lg border border-emerald-800/60 text-xs">
            <button
              onClick={() => onNavigateView('customer')}
              className={`px-3 py-1.5 rounded-md font-semibold transition ${
                currentView === 'customer'
                  ? 'bg-amber-400 text-emerald-950 shadow-sm'
                  : 'text-emerald-200 hover:text-white'
              }`}
            >
              Customer App
            </button>

            <button
              onClick={() => onNavigateView('admin')}
              className={`px-3 py-1.5 rounded-md font-semibold transition flex items-center gap-1.5 ${
                currentView === 'admin'
                  ? 'bg-amber-400 text-emerald-950 shadow-sm'
                  : 'text-emerald-200 hover:text-white'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              Store Admin
            </button>

            {currentUser.role === 'SYSTEM_ADMIN' && (
              <button
                onClick={() => onNavigateView('system')}
                className={`px-3 py-1.5 rounded-md font-semibold transition flex items-center gap-1.5 ${
                  currentView === 'system'
                    ? 'bg-amber-400 text-emerald-950 shadow-sm'
                    : 'text-emerald-200 hover:text-white'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                System Admin
              </button>
            )}
          </nav>
        )}

        {/* Right side controls: PWA Install, Cart Trigger & Account Switcher */}
        <div className="flex items-center gap-2">
          {/* PWA Mobile App Install Trigger */}
          <PWAInstallButton variant="navbar" />

          {/* Quick Cart summary button */}
          <button
            onClick={onOpenCart}
            className="flex items-center gap-2 bg-emerald-800/90 hover:bg-emerald-700/90 text-white px-3 py-1.5 rounded-xl border border-emerald-700 transition shadow-sm active:scale-95"
            title="Open Shopping Cart"
          >
            <div className="relative">
              <ShoppingCart className="w-4 h-4 text-amber-300" />
              {itemCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-amber-400 text-emerald-950 font-black text-[10px] w-4 h-4 rounded-full flex items-center justify-center leading-none shadow">
                  {itemCount}
                </span>
              )}
            </div>
            <div className="text-left hidden sm:block">
              <div className="text-[10px] text-emerald-300 leading-none">Total</div>
              <div className="text-xs font-bold font-mono text-amber-300 leading-none mt-0.5">
                KSh {estimatedTotal.toLocaleString()}
              </div>
            </div>
          </button>

          {/* User Account Button & Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowUserDropdown(!showUserDropdown)}
              className="flex items-center gap-1.5 bg-emerald-950/70 hover:bg-emerald-950 text-white px-2.5 py-1.5 rounded-xl border border-emerald-800 text-xs font-medium transition"
              title="Account and session settings"
            >
              <UserIcon className="w-3.5 h-3.5 text-emerald-300" />
              <span className="max-w-[100px] truncate hidden sm:inline">{currentUser.name}</span>
              <ChevronDown className="w-3.5 h-3.5 text-emerald-400" />
            </button>

            {showUserDropdown && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-2xl border border-slate-200 text-slate-800 p-2.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-2.5 py-2 bg-slate-50 rounded-xl border border-slate-100 mb-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Signed In As
                  </p>
                  <p className="text-xs font-extrabold text-slate-900 mt-0.5">{currentUser.name}</p>
                  <p className="text-[11px] text-slate-500 font-mono truncate">{currentUser.email}</p>
                  <div className="mt-1">
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 inline-block">
                      {currentUser.role === 'CUSTOMER' && 'Shopper Account'}
                      {currentUser.role === 'SUPERMARKET_ADMIN' && 'Store Administrator'}
                      {currentUser.role === 'SYSTEM_ADMIN' && 'System SuperAdmin'}
                    </span>
                  </div>
                </div>

                {/* Profile & Account actions */}
                <div className="space-y-1">
                  <button
                    onClick={() => {
                      setShowUserDropdown(false);
                      onOpenAccount?.();
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-xl text-xs font-bold text-slate-800 hover:bg-emerald-50 hover:text-emerald-900 flex items-center justify-between transition"
                  >
                    <span className="flex items-center gap-2">
                      <UserCheck className="w-3.5 h-3.5 text-emerald-700" />
                      My Profile &amp; Account
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  </button>

                  <button
                    onClick={() => {
                      setShowUserDropdown(false);
                      onOpenAccount?.();
                    }}
                    className="w-full text-left px-2.5 py-2 rounded-xl text-xs font-bold text-slate-800 hover:bg-emerald-50 hover:text-emerald-900 flex items-center justify-between transition"
                  >
                    <span className="flex items-center gap-2">
                      <LogIn className="w-3.5 h-3.5 text-emerald-700" />
                      Sign In / Register New Account
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </div>

                {/* Navigation portals */}
                <div className="border-t border-slate-100 pt-1.5 mt-1.5 space-y-1">
                  <button
                    onClick={() => {
                      onNavigateView('customer');
                      setShowUserDropdown(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 text-xs rounded-xl transition flex items-center justify-between ${
                      currentView === 'customer'
                        ? 'bg-amber-100 font-extrabold text-amber-950'
                        : 'text-slate-700 hover:bg-slate-100 font-medium'
                    }`}
                  >
                    <span>Customer Scanner</span>
                    {currentView === 'customer' && <Check className="w-3.5 h-3.5 text-amber-800" />}
                  </button>

                  {(currentUser.role === 'SUPERMARKET_ADMIN' || currentUser.role === 'SYSTEM_ADMIN') && (
                    <button
                      onClick={() => {
                        onNavigateView('admin');
                        setShowUserDropdown(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 text-xs rounded-xl transition flex items-center justify-between ${
                        currentView === 'admin'
                          ? 'bg-amber-100 font-extrabold text-amber-950'
                          : 'text-slate-700 hover:bg-slate-100 font-medium'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Store className="w-3.5 h-3.5" />
                        Store Admin
                      </span>
                      {currentView === 'admin' && <Check className="w-3.5 h-3.5 text-amber-800" />}
                    </button>
                  )}

                  {currentUser.role === 'SYSTEM_ADMIN' && (
                    <button
                      onClick={() => {
                        onNavigateView('system');
                        setShowUserDropdown(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 text-xs rounded-xl transition flex items-center justify-between ${
                        currentView === 'system'
                          ? 'bg-amber-100 font-extrabold text-amber-950'
                          : 'text-slate-700 hover:bg-slate-100 font-medium'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5" />
                        System Admin
                      </span>
                      {currentView === 'system' && <Check className="w-3.5 h-3.5 text-amber-800" />}
                    </button>
                  )}
                </div>

                {/* Sign Out */}
                <div className="border-t border-slate-100 pt-1.5 mt-1.5">
                  <button
                    onClick={() => {
                      setShowUserDropdown(false);
                      onSignOut();
                    }}
                    className="w-full text-left px-2.5 py-2 text-xs text-rose-700 hover:bg-rose-50 rounded-xl flex items-center justify-between font-bold transition"
                  >
                    <span>Sign Out</span>
                    <LogOut className="w-3.5 h-3.5 text-rose-600" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Direct Log Out Button for Everyone */}
          <button
            onClick={onSignOut}
            className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white px-2.5 py-1.5 rounded-xl border border-rose-500 text-xs font-bold transition shadow-sm active:scale-95"
            title="Log Out / Exit session"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Log Out</span>
          </button>
        </div>
      </div>
    </header>
  );
};
