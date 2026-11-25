// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React from 'react';
import { X, Award, Sparkles, Store, ReceiptText, Gift, ShieldAlert } from 'lucide-react';
import { LoyaltyPointsSummary } from '../types';
import { useTranslation } from '../utils/i18n';

interface LoyaltyPointsModalProps {
  isOpen: boolean;
  onClose: () => void;
  summary: LoyaltyPointsSummary | null;
  activeSupermarketId?: string;
  onOpenRewards?: () => void;
}

export const LoyaltyPointsModal: React.FC<LoyaltyPointsModalProps> = ({
  isOpen,
  onClose,
  summary,
  activeSupermarketId,
  onOpenRewards,
}) => {
  const { t, language } = useTranslation();

  if (!isOpen) return null;

  const totalPoints = summary?.totalPoints ?? 0;
  const lifetimePoints = summary?.lifetimePoints ?? totalPoints;
  const tier = summary?.tier ?? 'Bronze';
  const nextTier = summary?.nextTier ?? 'Silver';
  const pointsToNextTier = summary?.pointsToNextTier ?? 500;
  const earnRateKes = summary?.earnRateKes ?? 25;
  const bonusPts = summary?.bonusPointsPerVerifiedCart ?? 5;

  const tierLabel =
    tier === 'Gold'
      ? t.loyaltyTierGold
      : tier === 'Silver'
      ? t.loyaltyTierSilver
      : t.loyaltyTierBronze;

  const nextTierLabel =
    nextTier === 'Gold' ? t.loyaltyTierGold : nextTier === 'Silver' ? t.loyaltyTierSilver : null;

  const tierTarget = tier === 'Bronze' ? 500 : 1500;
  const tierFloor = tier === 'Bronze' ? 0 : tier === 'Silver' ? 500 : 1500;
  const progressPercent =
    tier === 'Gold'
      ? 100
      : Math.min(100, Math.max(0, Math.round(((lifetimePoints - tierFloor) / Math.max(1, tierTarget - tierFloor)) * 100)));

  const ledgerEntries = summary?.ledger ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Award className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {t.loyaltyPointsTitle}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                1 pt / KES {earnRateKes} + {bonusPts} {t.rewardsBonusRule}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t.cancel}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-white transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {summary?.isFrozen && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2 font-semibold">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{t.loyaltyFrozenNotice}</span>
            </div>
          )}

          {/* Points Summary Card */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-md space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[11px] uppercase tracking-wider font-bold text-emerald-100">
                  {t.loyaltyTotalBalance}
                </span>
                <p className="text-3xl font-black font-mono tabular-nums mt-0.5">
                  {totalPoints.toLocaleString()}{' '}
                  <span className="text-sm font-bold text-emerald-100">{t.loyaltyPointsUnit}</span>
                </p>
                <p className="text-[11px] text-emerald-100 mt-0.5 tabular-nums">
                  {t.loyaltyLifetimeLabel}: {lifetimePoints.toLocaleString()} {t.loyaltyPointsUnit}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white/15 border border-white/25 text-xs font-bold shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>{tierLabel}</span>
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="w-full h-2 rounded-full bg-black/20 overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-300 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-[11px] text-emerald-50">
                {tier === 'Gold' || !nextTierLabel
                  ? t.loyaltyMaxTierHint
                  : `${pointsToNextTier.toLocaleString()} ${t.loyaltyNextTierHint} ${nextTierLabel}`}
              </p>
            </div>

            {onOpenRewards && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenRewards();
                }}
                className="w-full py-2.5 rounded-xl bg-white text-emerald-800 hover:bg-emerald-50 font-bold text-xs flex items-center justify-center gap-1.5 transition"
              >
                <Gift className="w-4 h-4" />
                <span>{t.loyaltyBrowseRewardsBtn}</span>
              </button>
            )}
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 px-1">
            {t.loyaltyEarnRateNote} ({t.rewardsMinCartRule}: KES {(summary?.minCartValueKes ?? 100).toLocaleString()} · {t.rewardsDailyCapRule}: {(summary?.dailyCapPoints ?? 500).toLocaleString()} {t.loyaltyPointsUnit}).
          </p>

          {/* Points by Supermarket */}
          {summary && summary.bySupermarket.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5 text-emerald-600" />
                <span>{t.loyaltyByStoreTitle}</span>
              </h4>
              <div className="space-y-2">
                {summary.bySupermarket.map((store) => (
                  <div
                    key={store.supermarketId}
                    className={`p-3 rounded-2xl border flex items-center justify-between gap-2 ${
                      store.supermarketId === activeSupermarketId
                        ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/70 dark:bg-emerald-950/30'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {store.supermarketName}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {store.completedCheckouts} {t.loyaltyCheckoutsCount}
                      </p>
                    </div>
                    <span className="text-xs font-black font-mono tabular-nums text-emerald-700 dark:text-emerald-400 shrink-0">
                      {store.points.toLocaleString()} {t.loyaltyPointsUnit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Points Ledger */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <ReceiptText className="w-3.5 h-3.5 text-amber-600" />
              <span>{t.loyaltyLedgerTitle}</span>
            </h4>

            {ledgerEntries.length > 0 ? (
              <div className="space-y-2">
                {ledgerEntries.slice(0, 15).map((entry) => {
                  const isPositive = entry.amount >= 0;
                  return (
                    <div
                      key={entry.id}
                      className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {entry.reason}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          {new Date(entry.createdAt).toLocaleDateString(
                            language === 'sw' ? 'sw-KE' : 'en-KE',
                            { month: 'short', day: 'numeric' }
                          )}{' '}
                          · Bal: {entry.balanceAfter.toLocaleString()}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-1 rounded-lg text-xs font-black font-mono tabular-nums shrink-0 ${
                          isPositive
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {isPositive ? `+${entry.amount}` : entry.amount}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
                {t.loyaltyNoHistoryYet}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
