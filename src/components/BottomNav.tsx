import React from 'react';
import { useTranslation } from '../utils/i18n';
import { ScanLine, ShoppingBag, Tag, Clock, ListChecks } from 'lucide-react';

export type ShopperTab = 'scan' | 'cart' | 'lists' | 'price_check' | 'history';

interface BottomNavProps {
  activeTab: ShopperTab;
  onTabChange: (tab: ShopperTab) => void;
  cartItemCount: number;
  cartRunningTotal: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onTabChange,
  cartItemCount,
  cartRunningTotal,
}) => {
  const { t } = useTranslation();

  const tabs: { id: ShopperTab; label: string; icon: React.ReactNode; badge?: string | number }[] = [
    {
      id: 'scan',
      label: t.navScan,
      icon: <ScanLine className="w-5 h-5" />,
    },
    {
      id: 'cart',
      label: t.navCart,
      icon: <ShoppingBag className="w-5 h-5" />,
      badge: cartItemCount > 0 ? cartItemCount : undefined,
    },
    {
      id: 'lists',
      label: t.shoppingLists,
      icon: <ListChecks className="w-5 h-5" />,
    },
    {
      id: 'price_check',
      label: t.navPriceCheck,
      icon: <Tag className="w-5 h-5" />,
    },
    {
      id: 'history',
      label: t.navHistory,
      icon: <Clock className="w-5 h-5" />,
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800">
      <div className="max-w-md mx-auto grid grid-cols-5 items-center h-16 px-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors relative ${
                isActive
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <div className="relative">
                {tab.icon}
                {tab.badge !== undefined && (
                  <span className="absolute -top-1.5 -right-2.5 bg-emerald-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center tabular-nums">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] tracking-tight mt-1 truncate max-w-[58px]">
                {tab.label}
              </span>
              {tab.id === 'cart' && cartRunningTotal > 0 && (
                <span className="text-[8px] text-slate-500 dark:text-slate-400 -mt-0.5 tabular-nums">
                  KES {cartRunningTotal.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
