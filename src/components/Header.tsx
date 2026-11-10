import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/i18n';
import { PWAInstallButton } from './PWAInstallButton';
import { ShoppingCart, Store, LogOut, User as UserIcon, Globe, MapPin, Building2 } from 'lucide-react';
import { PortalType } from '../types';

interface HeaderProps {
  activePortal: PortalType;
  onSwitchPortal: (portal: PortalType) => void;
  onOpenStoreModal?: () => void;
  onOpenAuthModal?: () => void;
  onOpenSupportModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activePortal,
  onSwitchPortal,
  onOpenStoreModal,
  onOpenAuthModal,
  onOpenSupportModal,
}) => {
  const { user, branch, supermarket, logout } = useAuth();
  const { language, setLanguage, t } = useTranslation();

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'sw' : 'en');
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2 sm:gap-4">
        {/* Zone 1: Brand Wordmark & Active Role/Portal */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-xs shadow-emerald-600/20">
            <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm sm:text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
              Smart Cart
            </span>
            {user ? (
              <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 capitalize -mt-0.5 font-medium">
                {user.role === 'admin'
                  ? t.roleAdmin
                  : user.role === 'owner'
                  ? t.roleOwner
                  : user.role === 'staff'
                  ? t.roleStaff
                  : t.roleShopper}
              </span>
            ) : (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold -mt-0.5">
                {activePortal === 'shopper'
                  ? t.portalShopper.split(' ')[0]
                  : activePortal === 'staff'
                  ? t.portalStaff.split(' ')[0]
                  : t.portalManagement.split(' ')[0]}
              </span>
            )}
          </div>
        </div>

        {/* Zone 2: Three Portals Segmented Control & Store Selector */}
        <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto no-scrollbar py-1">
          {/* 3 Dedicated Portals Segmented Control */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 sm:p-1 rounded-xl border border-slate-200/80 dark:border-slate-700/80 shrink-0">
            <button
              type="button"
              onClick={() => onSwitchPortal('shopper')}
              className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-semibold transition active:scale-95 ${
                activePortal === 'shopper'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
              title={t.portalShopper}
            >
              <ShoppingCart className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden xs:inline">{t.portalShopper.split(' ')[0]}</span>
            </button>

            <button
              type="button"
              onClick={() => onSwitchPortal('staff')}
              className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-semibold transition active:scale-95 ${
                activePortal === 'staff'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
              title={t.portalStaff}
            >
              <Store className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden xs:inline">{t.portalStaff.split(' ')[0]}</span>
            </button>

            <button
              type="button"
              onClick={() => onSwitchPortal('management')}
              className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-semibold transition active:scale-95 ${
                activePortal === 'management'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
              title={t.portalManagement}
            >
              <Building2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden xs:inline">{t.portalManagement.split(' ')[0]}</span>
            </button>
          </div>

          {/* Store selector when on shopper portal */}
          {activePortal === 'shopper' && onOpenStoreModal && (
            <button
              onClick={onOpenStoreModal}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700 transition active:scale-95 shrink-0 max-w-[200px]"
              title={t.changeBranch}
            >
              <Store className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="truncate">
                {branch ? `${branch.name}` : t.selectBranch}
              </span>
            </button>
          )}

          {user?.role === 'staff' && branch && activePortal === 'staff' && (
            <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 shrink-0">
              <MapPin className="w-3.5 h-3.5 text-blue-600" />
              <span className="font-semibold">{branch.name}</span>
            </div>
          )}

          {user?.role === 'owner' && supermarket && activePortal === 'management' && (
            <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 shrink-0">
              <Store className="w-3.5 h-3.5 text-indigo-600" />
              <span className="font-semibold">{supermarket.name} Chain</span>
            </div>
          )}
        </div>

        {/* Zone 3: Primary Action Cluster */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* PWA Install Button */}
          <PWAInstallButton />

          {/* Bilingual Language Switcher Button */}
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold active:scale-95 transition"
            title="Switch Language / Badili Lugha"
          >
            <Globe className="w-3.5 h-3.5 text-emerald-600" />
            <span className="uppercase text-[11px] sm:text-xs">{language === 'en' ? 'SW' : 'EN'}</span>
          </button>

          {/* User Profile / Login / Logout */}
          {user ? (
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={logout}
                className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition active:scale-95"
                title={t.logout}
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t.logout}</span>
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuthModal}
              className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-emerald-700 transition active:scale-95"
            >
              <UserIcon className="w-3.5 h-3.5" />
              <span>{t.login}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
