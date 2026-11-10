import React from 'react';
import { X, ShoppingBag, MapPin, Tag, AlertTriangle, CheckCircle } from 'lucide-react';
import { Product, Promotion } from '../types';
import { useTranslation } from '../utils/i18n';

interface PriceCheckModalProps {
  product: Product | null;
  effectivePrice: number;
  stock: number;
  isLowStock: boolean;
  promotion: Promotion | null;
  onClose: () => void;
  onAddToCart: (barcode: string) => void;
}

export const PriceCheckModal: React.FC<PriceCheckModalProps> = ({
  product,
  effectivePrice,
  stock,
  isLowStock,
  promotion,
  onClose,
  onAddToCart,
}) => {
  const { t } = useTranslation();
  if (!product) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="p-4 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
              {t.priceCheckMode}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              {product.category}
            </span>
            <h4 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5 leading-snug">
              {product.name}
            </h4>
            <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
              <span className="font-mono tabular-nums">{product.barcode}</span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3 text-slate-400" />
                {product.aisleShelf}
              </span>
            </div>
          </div>

          {/* Price display with promo */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500">{t.branchPrice}</p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">
                  KES {effectivePrice}
                </span>
                {effectivePrice !== product.basePrice && (
                  <span className="text-xs text-slate-400 line-through tabular-nums">
                    KES {product.basePrice}
                  </span>
                )}
              </div>
            </div>

            {promotion && (
              <div className="text-right">
                <span className="inline-block px-2.5 py-1 rounded-md bg-amber-500 text-white text-[11px] font-bold">
                  {promotion.type === 'percent_off'
                    ? `${promotion.discountPercent}% OFF`
                    : promotion.type === 'bundle'
                    ? `Bundle Deal`
                    : 'Special Sale'}
                </span>
                <p className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-1 max-w-[120px] truncate">
                  {promotion.name}
                </p>
              </div>
            )}
          </div>

          {/* Stock status */}
          <div className="flex items-center justify-between text-xs px-1">
            <span className="text-slate-500">{t.stockLevel}:</span>
            <span
              className={`font-semibold flex items-center gap-1 ${
                stock <= 0
                  ? 'text-rose-600'
                  : isLowStock
                  ? 'text-amber-600'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {isLowStock && <AlertTriangle className="w-3.5 h-3.5" />}
              {stock > 0 ? `${stock} available in branch` : t.outOfStock}
            </span>
          </div>

          <div className="text-[11px] text-slate-400 text-center italic">
            {t.lockedPriceNotice}
          </div>

          {/* Action buttons */}
          <div className="pt-2 flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition"
            >
              Scan Another
            </button>
            <button
              onClick={() => {
                onAddToCart(product.barcode);
                onClose();
              }}
              disabled={stock <= 0}
              className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 transition active:scale-95"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>{t.addToCart}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
