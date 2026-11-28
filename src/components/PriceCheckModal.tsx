// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useState, useEffect } from 'react';
import {
  X,
  ShoppingBag,
  MapPin,
  Tag,
  ListPlus,
  GitCompareArrows,
  Building2,
  CheckCircle2,
  WifiOff,
} from 'lucide-react';
import {
  PriceCheckBranchCompareItem,
  PriceCheckProductInfo,
  Promotion,
} from '../types';
import { useTranslation } from '../utils/i18n';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface PriceCheckModalProps {
  product: PriceCheckProductInfo | null;
  branchPrice: number;
  finalPrice: number;
  promotion: Promotion | null;
  compareBranches: PriceCheckBranchCompareItem[];
  isOffline?: boolean;
  onClose: () => void;
  onAddToCart: (barcode: string) => void;
  onAddToList: (product: PriceCheckProductInfo, finalPrice: number) => void;
}

export const PriceCheckModal: React.FC<PriceCheckModalProps> = ({
  product,
  branchPrice,
  finalPrice,
  promotion,
  compareBranches,
  isOffline = false,
  onClose,
  onAddToCart,
  onAddToList,
}) => {
  const { t } = useTranslation();
  const [showCompare, setShowCompare] = useState(false);

  useBodyScrollLock(Boolean(product));

  useEffect(() => {
    setShowCompare(false);
  }, [product?.barcode]);

  if (!product) return null;

  const hasPromoDiscount = finalPrice < branchPrice;
  const lowestBranchPrice =
    compareBranches.length > 0
      ? Math.min(...compareBranches.map((b) => b.finalPrice))
      : finalPrice;

  const formatPromotionBadge = (promo: Promotion): string => {
    if (promo.type === 'percent_off' && promo.discountPercent) {
      return `${promo.discountPercent}% OFF`;
    }
    if (promo.type === 'bundle' && promo.bundleQuantity && promo.bundlePrice) {
      return `${promo.bundleQuantity} for KES ${promo.bundlePrice.toLocaleString()}`;
    }
    if (promo.type === 'fixed_price' && promo.fixedPrice) {
      return `Sale KES ${promo.fixedPrice.toLocaleString()}`;
    }
    return 'Special Offer';
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="price-check-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in motion-reduce:animate-none"
    >
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[90dvh] flex flex-col">
        {/* Header */}
        <div className="p-4 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <h3
              id="price-check-modal-title"
              className="text-sm font-bold text-amber-900 dark:text-amber-200"
            >
              {t.priceCheckMode}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.closeLabel}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto overscroll-y-contain flex-1 min-h-0">
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              {product.category || t.otherAisleGroup}
            </span>
            <h4 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5 leading-snug">
              {product.name}
            </h4>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500">
              <span className="font-mono tabular-nums">{product.barcode}</span>
              {(product.aisleShelf || product.aisle || product.category) && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-400" aria-hidden="true" />
                    {product.aisleShelf || product.aisle || product.category || t.otherAisleGroup}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Price display with active promotion & final price (never exposes stock or cost) */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  {t.finalPriceLabel}
                </p>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-2xl font-black text-emerald-700 dark:text-emerald-400 tabular-nums">
                    KES {finalPrice.toLocaleString()}
                  </span>
                  {(hasPromoDiscount || branchPrice !== product.basePrice) && (
                    <span className="text-xs text-slate-400 line-through tabular-nums">
                      KES {(hasPromoDiscount ? branchPrice : product.basePrice).toLocaleString()}
                    </span>
                  )}
                </div>
                {hasPromoDiscount && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                    {t.branchPrice}: KES {branchPrice.toLocaleString()}
                  </p>
                )}
              </div>

              {promotion && (
                <div className="text-right shrink-0">
                  <span className="inline-block px-2.5 py-1 rounded-md bg-amber-500 text-white text-[11px] font-bold">
                    {formatPromotionBadge(promotion)}
                  </span>
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold mt-1 max-w-[140px] truncate">
                    {promotion.name}
                  </p>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-200/70 dark:border-slate-700/70 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                {t.lockedPriceNotice}
              </span>

              <button
                type="button"
                onClick={() => setShowCompare((prev) => !prev)}
                aria-expanded={showCompare}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 border transition ${
                  showCompare
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-emerald-400'
                }`}
              >
                <GitCompareArrows className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t.compareBranchesBtn}</span>
              </button>
            </div>
          </div>

          {/* Compare Across Same Supermarket Active Branches */}
          {showCompare && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h5 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                  <span>{t.compareBranchesTitle}</span>
                </h5>
              </div>

              {isOffline ? (
                <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5 py-1">
                  <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{t.compareOfflineNote}</span>
                </p>
              ) : compareBranches.length <= 1 ? (
                <div className="space-y-2">
                  {compareBranches.map((b) => (
                    <div
                      key={b.branchId}
                      className="p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 dark:text-white truncate">
                          {b.branchName}
                        </p>
                        <p className="text-[10px] text-slate-500">{b.city}</p>
                      </div>
                      <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                        KES {b.finalPrice.toLocaleString()}
                      </span>
                    </div>
                  ))}
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t.compareSingleBranchNote}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                  {compareBranches.map((b) => {
                    const isLowest = b.finalPrice === lowestBranchPrice;
                    return (
                      <div
                        key={b.branchId}
                        className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                          b.isCurrentBranch
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
                            : 'bg-slate-50/60 dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-slate-900 dark:text-white truncate">
                              {b.branchName}
                            </span>
                            {b.isCurrentBranch && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[10px] font-semibold">
                                {t.compareCurrentBranchBadge}
                              </span>
                            )}
                            {isLowest && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200 text-[10px] font-bold">
                                <CheckCircle2 className="w-2.5 h-2.5" aria-hidden="true" />
                                {t.compareLowestBadge}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 truncate">
                            {b.city}
                            {b.activePromotion ? ` · ${b.activePromotion.name}` : ''}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums block">
                            KES {b.finalPrice.toLocaleString()}
                          </span>
                          {b.finalPrice < b.branchPrice && (
                            <span className="text-[10px] text-slate-400 line-through font-mono tabular-nums">
                              KES {b.branchPrice.toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Action buttons: Add to cart, Add to list, Close */}
          <div className="pt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                onAddToCart(product.barcode);
                onClose();
              }}
              className="min-h-[42px] py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 transition active:scale-95"
            >
              <ShoppingBag className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.addToCart}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onAddToList(product, finalPrice);
                onClose();
              }}
              className="min-h-[42px] py-2.5 px-3 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 font-semibold text-xs flex items-center justify-center gap-1.5 transition"
            >
              <ListPlus className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.addToListBtn}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              {t.closeLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
