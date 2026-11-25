// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useEffect, useState } from 'react';
import { X, Download, Share2, Copy, Check, Image as ImageIcon, Palette } from 'lucide-react';
import { Cart } from '../types';
import { useTranslation } from '../utils/i18n';
import {
  generateCartSummaryCardImage,
  GeneratedCartSummaryCard,
  SummaryCardTheme,
} from '../utils/cartSummaryImage';

interface CartSummaryCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  cart: Cart | null;
  storeName?: string;
  branchName?: string;
  branchLocation?: string;
}

export const CartSummaryCardModal: React.FC<CartSummaryCardModalProps> = ({
  isOpen,
  onClose,
  cart,
  storeName,
  branchName,
  branchLocation,
}) => {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<SummaryCardTheme>('emerald');
  const [cardAsset, setCardAsset] = useState<GeneratedCartSummaryCard | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !cart) return;

    let cancelled = false;
    setIsGenerating(true);
    setErrorMsg(null);
    setNoticeMsg(null);

    generateCartSummaryCardImage({
      cart,
      storeName,
      branchName,
      branchLocation,
      theme,
    })
      .then((asset) => {
        if (!cancelled) {
          setCardAsset(asset);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err?.message || 'Could not render summary card image.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsGenerating(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, cart, storeName, branchName, branchLocation, theme]);

  if (!isOpen || !cart) return null;

  const handleDownload = () => {
    if (!cardAsset) return;
    const link = document.createElement('a');
    link.href = cardAsset.dataUrl;
    link.download = cardAsset.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyText = async () => {
    if (!cardAsset) return;
    try {
      await navigator.clipboard.writeText(cardAsset.summaryText);
      setNoticeMsg(t.summaryCardCopied);
      setTimeout(() => setNoticeMsg(null), 2500);
    } catch {
      setErrorMsg('Clipboard permission unavailable.');
    }
  };

  const handleShare = async () => {
    if (!cardAsset) return;
    setErrorMsg(null);

    const file = new File([cardAsset.blob], cardAsset.fileName, { type: 'image/png' });
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
    };

    if (typeof nav.share === 'function') {
      try {
        const canShareFiles =
          typeof nav.canShare === 'function' && nav.canShare({ files: [file] });

        if (canShareFiles) {
          await nav.share({
            title: `Smart Cart Summary (${cart.shortCode})`,
            text: cardAsset.summaryText,
            files: [file],
          });
        } else {
          await nav.share({
            title: `Smart Cart Summary (${cart.shortCode})`,
            text: cardAsset.summaryText,
          });
        }
        setNoticeMsg(t.summaryCardShared);
        setTimeout(() => setNoticeMsg(null), 2500);
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    // Fallback: copy summary text and download image directly
    await handleCopyText();
    handleDownload();
  };

  const themeOptions: { id: SummaryCardTheme; label: string; dot: string }[] = [
    { id: 'emerald', label: t.summaryCardThemeEmerald, dot: 'bg-emerald-500' },
    { id: 'midnight', label: t.summaryCardThemeMidnight, dot: 'bg-slate-800' },
    { id: 'crisp', label: t.summaryCardThemeCrisp, dot: 'bg-slate-200 border border-slate-400' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                {t.summaryCardTitle}
              </h3>
              <p className="text-[11px] font-mono text-slate-400">{cart.shortCode}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto space-y-3.5">
          {/* Style Switcher */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-emerald-600" />
              <span>Card Style</span>
            </span>
            <div className="flex items-center gap-1.5">
              {themeOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTheme(opt.id)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 border transition ${
                    theme === opt.id
                      ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full ${opt.dot}`} />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Generated Card Image Preview */}
          <div className="rounded-2xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2 flex items-center justify-center min-h-[280px]">
            {isGenerating ? (
              <div className="flex flex-col items-center gap-2 py-12">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-slate-500">Generating summary card...</p>
              </div>
            ) : cardAsset ? (
              <img
                src={cardAsset.dataUrl}
                alt={`Smart Cart summary card for ${cart.shortCode}`}
                referrerPolicy="no-referrer"
                className="w-full max-h-[420px] object-contain rounded-xl shadow-md"
              />
            ) : (
              <p className="text-xs text-slate-400">Preview unavailable</p>
            )}
          </div>

          {errorMsg && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400 text-center">{errorMsg}</p>
          )}
          {noticeMsg && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold text-center flex items-center justify-center gap-1">
              <Check className="w-3.5 h-3.5" />
              <span>{noticeMsg}</span>
            </p>
          )}

          {/* Share & Download Controls */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={handleShare}
              disabled={!cardAsset || isGenerating}
              className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition active:scale-95"
            >
              <Share2 className="w-4 h-4" />
              <span>{t.summaryCardShareBtn}</span>
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!cardAsset || isGenerating}
              className="py-2.5 px-3 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 disabled:opacity-45 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition active:scale-95"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span>{t.summaryCardDownloadBtn}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopyText}
            disabled={!cardAsset || isGenerating}
            className="w-full py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-45 flex items-center justify-center gap-1.5 transition"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>{t.summaryCardCopyBtn}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
