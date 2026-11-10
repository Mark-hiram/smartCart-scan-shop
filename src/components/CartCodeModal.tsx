import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { X, CheckCircle2, AlertTriangle, ShoppingCart, RefreshCw } from 'lucide-react';
import { Cart } from '../types';
import { useTranslation } from '../utils/i18n';

interface CartCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  cart: Cart | null;
  onRefreshCart: () => Promise<void>;
}

export const CartCodeModal: React.FC<CartCodeModalProps> = ({
  isOpen,
  onClose,
  cart,
  onRefreshCart,
}) => {
  const { t } = useTranslation();
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    if (cart && cart.shortCode) {
      QRCode.toDataURL(cart.shortCode, {
        width: 260,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch((err) => console.error('Error generating QR:', err));
    }
  }, [cart]);

  // Periodic polling every 3 seconds to see if cashier verified the cart
  useEffect(() => {
    if (!isOpen || !cart) return;
    const interval = setInterval(() => {
      onRefreshCart();
    }, 3000);

    return () => clearInterval(interval);
  }, [isOpen, cart?.id]);

  if (!isOpen || !cart) return null;

  const isVerified = cart.status === 'verified' || cart.status === 'completed';
  const isFlagged = cart.status === 'flagged';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {t.cashierCodeTitle}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 flex flex-col items-center text-center space-y-4">
          {/* Verification Status Banner */}
          {isVerified ? (
            <div className="w-full p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center gap-2.5 text-left">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
              <div>
                <p className="text-xs font-bold text-emerald-900 dark:text-emerald-300">
                  {t.cartVerifiedSuccess}
                </p>
                <p className="text-[10px] text-emerald-700 dark:text-emerald-400">
                  Cashier checked your items. Proceed to pay at the register.
                </p>
              </div>
            </div>
          ) : isFlagged ? (
            <div className="w-full p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center gap-2.5 text-left">
              <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0" />
              <div>
                <p className="text-xs font-bold text-rose-900 dark:text-rose-300">
                  {t.flaggedWarning}
                </p>
                <p className="text-[10px] text-rose-700 dark:text-rose-400">
                  {cart.mismatchNotes || 'Mismatch reported by cashier.'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {t.showToCashier}
            </p>
          )}

          {/* Large Alphanumeric Short Code */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 w-full">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">
              Cart Code
            </span>
            <div className="text-3xl font-black font-mono tracking-widest text-emerald-600 dark:text-emerald-400 mt-0.5 select-all">
              {cart.shortCode}
            </div>
          </div>

          {/* QR Code Canvas */}
          {qrDataUrl && (
            <div className="p-3 bg-white rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800">
              <img
                src={qrDataUrl}
                alt={`QR code for ${cart.shortCode}`}
                className="w-48 h-48 mx-auto"
              />
            </div>
          )}

          {/* Cart Summary */}
          <div className="w-full flex items-center justify-between text-xs py-2 border-t border-b border-slate-100 dark:border-slate-800">
            <span className="text-slate-500">
              {cart.items.length} {t.itemsCount}
            </span>
            <span className="font-bold text-slate-900 dark:text-white tabular-nums">
              KES {cart.finalTotal.toLocaleString()}
            </span>
          </div>

          {/* Critical Notice: NO PAYMENT IN APP */}
          <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-[11px] text-amber-800 dark:text-amber-300 text-center leading-relaxed">
            <strong>Notice:</strong> {t.checkoutNotice}
          </div>

          {/* Manual Refresh / Done */}
          <div className="w-full flex gap-2 pt-1">
            <button
              onClick={async () => {
                setIsChecking(true);
                await onRefreshCart();
                setIsChecking(false);
              }}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition flex items-center justify-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              <span>Check Verification</span>
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 text-white text-xs font-semibold transition"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
