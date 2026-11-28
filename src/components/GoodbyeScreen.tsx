// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React from 'react';
import {
  ShoppingBag,
  Award,
  LogOut,
  LogIn,
  ArrowLeft,
  WifiOff,
  CheckCircle2,
  ReceiptText,
} from 'lucide-react';
import { GoodbyeSummaryData } from '../types';
import { useTranslation } from '../utils/i18n';
import { SmartCartMark } from './SmartCartLogo';
import { PortalBackgroundImage, usePreloadPortalSignInImage } from './PortalBackgroundImage';
import { CopyrightBadge } from './CopyrightBadge';

interface GoodbyeScreenProps {
  summary: GoodbyeSummaryData;
  isSignedIn: boolean;
  onStartNewCart: () => Promise<void> | void;
  onViewRewards: () => void;
  onSignOutOrSignIn: () => void;
  onBackToDashboard: () => void;
  isStartingNewCart?: boolean;
}

export const GoodbyeScreen: React.FC<GoodbyeScreenProps> = ({
  summary,
  isSignedIn,
  onStartNewCart,
  onViewRewards,
  onSignOutOrSignIn,
  onBackToDashboard,
  isStartingNewCart = false,
}) => {
  const { t } = useTranslation();

  usePreloadPortalSignInImage('shopper');

  const hasEarnedPoints =
    typeof summary.loyaltyEarnedOnCart === 'number' && summary.loyaltyEarnedOnCart > 0;
  const hasRealBalance =
    typeof summary.loyaltyBalance === 'number' &&
    (summary.loyaltyBalance > 0 || hasEarnedPoints);

  return (
    <section
      aria-labelledby="goodbye-heading"
      className="relative flex-1 min-h-[calc(100dvh-3.5rem)] flex flex-col justify-between px-4 py-6 sm:py-10 safe-x safe-bottom text-white"
    >
      {/* Same Real-Photo Backdrop + Dark Overlay used on Welcome Screen */}
      <PortalBackgroundImage portal="shopper" variant="backdrop" priority />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-950/85 via-emerald-950/80 to-slate-950/90"
      />

      <div className="relative z-10 w-full max-w-xl mx-auto my-auto welcome-fade-in">
        <div className="rounded-3xl border border-white/15 bg-slate-900/76 backdrop-blur-md p-6 sm:p-8 shadow-2xl space-y-5">
          {/* Smart Cart Logo & Warm Goodbye Message */}
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="inline-flex items-center gap-3">
              <SmartCartMark className="w-11 h-11 sm:w-12 sm:h-12 shrink-0 drop-shadow-md" />
              <span className="text-xl sm:text-2xl font-black tracking-tight text-white">
                {t.appName}
              </span>
            </div>

            <div className="inline-flex items-center gap-1.5 text-emerald-300 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.goodbyeHeadline}</span>
            </div>

            <h1
              id="goodbye-heading"
              className="text-xl sm:text-2xl font-extrabold tracking-tight text-white leading-snug max-w-md"
            >
              {t.goodbyeMessage}
            </h1>
          </div>

          {/* Offline Pending Finish Notice */}
          {summary.pendingOfflineFinish && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-2xl border border-amber-400/50 bg-amber-500/20 px-4 py-3 text-xs font-semibold text-amber-100 flex items-center gap-2.5"
            >
              <WifiOff className="w-4 h-4 text-amber-300 shrink-0" aria-hidden="true" />
              <span>{t.goodbyeOfflineNotice}</span>
            </div>
          )}

          {/* Server-Fetched Cart Summary Card */}
          <div className="rounded-2xl border border-white/15 bg-slate-950/65 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2 min-w-0">
                <ReceiptText className="w-4 h-4 text-emerald-300 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  {summary.branchName && (
                    <p className="text-xs font-bold text-white truncate">
                      {summary.branchName}
                    </p>
                  )}
                  <p className="text-[11px] text-slate-300">
                    {t.goodbyeItemsLabel}: <strong className="text-white tabular-nums">{summary.itemCount}</strong>
                  </p>
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="block text-[10px] uppercase tracking-wider text-slate-300 font-semibold">
                  {t.goodbyeFinalTotalLabel}
                </span>
                <span className="text-lg sm:text-xl font-black font-mono tabular-nums text-emerald-300">
                  KES {summary.finalTotal.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Cart Code & Cashier Instruction */}
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-950/45 px-4 py-3 text-center space-y-1.5">
              <span className="block text-[10px] uppercase tracking-widest text-emerald-200 font-bold">
                {t.goodbyeCartCodeLabel}
              </span>
              <p className="text-2xl sm:text-3xl font-black font-mono tracking-widest text-white select-all">
                {summary.shortCode}
              </p>
              <p className="text-[11px] sm:text-xs text-slate-200 leading-relaxed max-w-sm mx-auto">
                {t.goodbyeCashierInstruction}
              </p>
            </div>

            {/* Loyalty Summary — strictly real values from server, zero invented numbers */}
            {(hasEarnedPoints || hasRealBalance) && (
              <div className="rounded-xl border border-amber-300/30 bg-amber-500/12 px-4 py-3 flex items-start gap-3">
                <span className="w-8 h-8 rounded-lg bg-amber-400/20 text-amber-300 flex items-center justify-center shrink-0 mt-0.5">
                  <Award className="w-4 h-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 text-xs space-y-0.5">
                  {hasEarnedPoints && (
                    <p className="font-bold text-white tabular-nums">
                      {t.goodbyeEarnedPrefix} {summary.loyaltyEarnedOnCart!.toLocaleString()}{' '}
                      {t.loyaltyPointsUnit}
                    </p>
                  )}
                  {hasRealBalance && summary.loyaltyBalance !== null && (
                    <p className="text-amber-100 font-semibold tabular-nums">
                      {hasEarnedPoints ? t.goodbyeNewBalanceLabel : t.goodbyePointsBalanceLabel}:{' '}
                      {summary.loyaltyBalance.toLocaleString()} {t.loyaltyPointsUnit}
                    </p>
                  )}
                  {!hasEarnedPoints && (
                    <p className="text-[11px] text-slate-300">
                      {t.goodbyePointsPendingTill}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Primary & Secondary Action Buttons */}
          <div className="space-y-2.5">
            <button
              type="button"
              disabled={isStartingNewCart}
              onClick={onStartNewCart}
              className="w-full min-h-[46px] px-4 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 active:scale-98 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-emerald-950/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            >
              <ShoppingBag className="w-4 h-4" aria-hidden="true" />
              <span>{t.goodbyeStartNewCart}</span>
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onViewRewards}
                className="min-h-[44px] px-4 py-2.5 rounded-xl border border-white/20 bg-white/10 hover:bg-white/18 text-white font-semibold text-xs flex items-center justify-center gap-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              >
                <Award className="w-4 h-4 text-amber-300" aria-hidden="true" />
                <span>{t.goodbyeViewRewards}</span>
              </button>

              <button
                type="button"
                onClick={onSignOutOrSignIn}
                className="min-h-[44px] px-4 py-2.5 rounded-xl border border-white/20 bg-white/10 hover:bg-white/18 text-white font-semibold text-xs flex items-center justify-center gap-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              >
                {isSignedIn ? (
                  <>
                    <LogOut className="w-4 h-4 text-rose-300" aria-hidden="true" />
                    <span>{t.goodbyeSignOut}</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4 text-emerald-300" aria-hidden="true" />
                    <span>{t.goodbyeSignIn}</span>
                  </>
                )}
              </button>
            </div>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={onBackToDashboard}
                className="inline-flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold text-slate-200 hover:text-white hover:bg-white/10 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t.goodbyeBackDashboard}</span>
              </button>
            </div>
          </div>

          {/* Copyright Badge */}
          <div className="pt-3 border-t border-white/12 flex justify-center text-slate-200">
            <CopyrightBadge />
          </div>
        </div>
      </div>
    </section>
  );
};
