// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React from 'react';
import { useTranslation } from '../utils/i18n';
import { ScanLine, ShoppingBag, Tag, ReceiptText, ListChecks, Gift } from 'lucide-react';

export type ShopperTab = 'scan' | 'cart' | 'lists' | 'price_check' | 'rewards' | 'history';

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
      icon: <ScanLine className="w-4 h-4 sm:w-5 sm:h-5" />,
    },
    {
      id: 'cart',
      label: t.navCart,
      icon: <ShoppingBag className="w-4 h-4 sm:w-5 sm:h-5" />,
      badge: cartItemCount > 0 ? cartItemCount : undefined,
    },
    {
      id: 'lists',
      label: t.shoppingLists,
      icon: <ListChecks className="w-4 h-4 sm:w-5 sm:h-5" />,
    },
    {
      id: 'price_check',
      label: t.navPriceCheck,
      icon: <Tag className="w-4 h-4 sm:w-5 sm:h-5" />,
    },
    {
      id: 'rewards',
      label: t.navRewards,
      icon: <Gift className="w-4 h-4 sm:w-5 sm:h-5" />,
    },
    {
      id: 'history',
      label: t.navReceipts,
      icon: <ReceiptText className="w-4 h-4 sm:w-5 sm:h-5" />,
    },
  ];

  return (
    <nav>
      <div className="max-w-lg mx-auto grid grid-cols-6 items-center h-16 px-0.5">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center h-full min-h-[44px] px-0.5 transition-colors relative ${
                isActive
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <div className="relative">
                {tab.icon}
                {tab.badge !== undefined && (
                  <span className="absolute -top-1.5 -right-2 bg-emerald-600 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center tabular-nums">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] tracking-tight mt-1 truncate max-w-[54px]">
                {tab.label}
              </span>
              {tab.id === 'cart' && cartRunningTotal > 0 && (
                <span className="text-[8px] text-slate-500 dark:text-slate-400 -mt-0.5 tabular-nums truncate max-w-[54px]">
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
