import React, { useState, useMemo } from 'react';
import { X, Search, Check, AlertCircle, ShoppingBag, Tag, Barcode } from 'lucide-react';
import { validateBarcode } from '../utils/barcode';
import { EnrichedProduct } from '../types';
import { useTranslation } from '../utils/i18n';

interface ManualBarcodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: EnrichedProduct[];
  onSelectProduct: (barcode: string) => void;
  isPriceCheckMode?: boolean;
}

export const ManualBarcodeModal: React.FC<ManualBarcodeModalProps> = ({
  isOpen,
  onClose,
  products,
  onSelectProduct,
  isPriceCheckMode = false,
}) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [customBarcode, setCustomBarcode] = useState('');

  // Validate custom typed barcode
  const validation = useMemo(() => {
    if (!customBarcode.trim()) return null;
    return validateBarcode(customBarcode.trim());
  }, [customBarcode]);

  // Filter products by search term (name, barcode, category)
  const filteredProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return products.slice(0, 12);
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.nameSwahili && p.nameSwahili.toLowerCase().includes(q)) ||
        p.barcode.includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.aisleShelf.toLowerCase().includes(q)
    );
  }, [products, searchTerm]);

  if (!isOpen) return null;

  const handleSubmitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (validation && validation.isValid) {
      onSelectProduct(customBarcode.trim());
      setCustomBarcode('');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Barcode className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {t.typeBarcodeManually}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          {/* Section 1: Type exact barcode with live check-digit validator */}
          <form onSubmit={handleSubmitCustom} className="space-y-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {t.barcodeNumber} (EAN-13, EAN-8, UPC-A, Code 128)
            </label>
            <div className="relative">
              <input
                type="text"
                value={customBarcode}
                onChange={(e) => setCustomBarcode(e.target.value)}
                placeholder="e.g. 6161101234566"
                className="w-full h-11 px-3 py-2 pr-24 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono text-sm focus:outline-emerald-500"
                autoFocus
              />
              <button
                type="submit"
                disabled={!validation || !validation.isValid}
                className="absolute right-1.5 top-1.5 h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold transition flex items-center gap-1"
              >
                {isPriceCheckMode ? <Tag className="w-3.5 h-3.5" /> : <ShoppingBag className="w-3.5 h-3.5" />}
                <span>{isPriceCheckMode ? t.lookupPrice : t.addToCart}</span>
              </button>
            </div>

            {/* Live check-digit indicator */}
            {validation && (
              <div
                className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg ${
                  validation.isValid
                    ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40'
                    : 'text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40'
                }`}
              >
                {validation.isValid ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Valid {validation.format} Barcode</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{validation.error}</span>
                  </>
                )}
              </div>
            )}
          </form>

          {/* Section 2: Search catalogue by product name / category */}
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
              <span>{t.searchPlaceholder}</span>
              <span className="text-[11px] text-slate-400 font-normal">
                {filteredProducts.length} items
              </span>
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Type milk, flour, bread, rice, soap..."
                className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:outline-emerald-500"
              />
            </div>

            {/* List of matched items */}
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1 mt-2">
              {filteredProducts.map((p) => (
                <div
                  key={p.id}
                  onClick={() => {
                    onSelectProduct(p.barcode);
                    onClose();
                  }}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-emerald-500 bg-white dark:bg-slate-800/80 cursor-pointer transition active:scale-98"
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {p.name}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                      <span className="font-mono tabular-nums">{p.barcode}</span>
                      <span>·</span>
                      <span>{p.aisleShelf}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      KES {p.effectivePrice}
                    </p>
                    {p.activePromotion && (
                      <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        {p.activePromotion.name}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
