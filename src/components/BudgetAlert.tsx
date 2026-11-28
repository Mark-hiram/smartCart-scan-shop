// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useState, useEffect } from 'react';
import { useTranslation } from '../utils/i18n';
import { computeBudgetSummary } from '../utils/shoppingHelpers';
import {
  AlertTriangle,
  CheckCircle2,
  Sliders,
  ShieldAlert,
  Wallet,
} from 'lucide-react';

export interface BudgetAlertProps {
  cartTotal: number;
  budgetLimit?: number | null;
  defaultBudget?: number | null;
  onUpdateBudget: (newLimit: number | null, saveAsDefault?: boolean) => Promise<void> | void;
  currency?: string;
  className?: string;
  showDetailsOnlyWhenSet?: boolean;
}

export const BudgetAlert: React.FC<BudgetAlertProps> = ({
  cartTotal,
  budgetLimit,
  defaultBudget = null,
  onUpdateBudget,
  currency = 'KES',
  className = '',
}) => {
  const { t } = useTranslation();

  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(budgetLimit ? String(budgetLimit) : '');
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setInputValue(budgetLimit ? String(budgetLimit) : '');
    }
  }, [budgetLimit, isEditing]);

  // Quick preset options in KES
  const presets = [500, 1000, 2000, 3500, 5000, 10000];

  const summary = computeBudgetSummary(cartTotal, budgetLimit);
  const limit = summary.limit || 0;
  const hasLimit = limit > 0;
  const percentage = summary.percent ?? 0;

  const isApproaching = summary.level === 'near';
  const isExceeded = summary.level === 'over';

  const remaining = summary.remaining ?? 0;
  const overAmount = summary.overBy;

  const handleSave = async (customVal?: number | null) => {
    setIsSaving(true);
    try {
      let finalLimit: number | null = null;
      if (customVal !== undefined) {
        finalLimit = customVal;
      } else if (inputValue.trim()) {
        const parsed = parseFloat(inputValue);
        finalLimit = isNaN(parsed) || parsed <= 0 ? null : parsed;
      }
      await onUpdateBudget(finalLimit, saveAsDefault);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectPreset = (val: number) => {
    setInputValue(String(val));
    void handleSave(val);
  };

  const handleClearBudget = () => {
    setInputValue('');
    void handleSave(null);
  };

  return (
    <div
      className={`rounded-3xl border transition-all duration-300 overflow-hidden shadow-xs ${
        isExceeded
          ? 'bg-rose-50/90 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 ring-2 ring-rose-500/20'
          : isApproaching
          ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 ring-2 ring-amber-500/20'
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
      } ${className}`}
    >
      {/* Top Banner Warning (80% Near budget / >100% Over budget — non-blocking) */}
      {isExceeded && (
        <div
          role="status"
          aria-live="polite"
          className="px-4 py-2.5 bg-rose-600 text-white flex flex-wrap items-center justify-between gap-2 text-xs font-bold"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              {t.overBudgetByPrefix} {currency} {overAmount.toLocaleString()}
            </span>
          </div>
          <span className="font-mono text-[11px] bg-rose-700 px-2 py-0.5 rounded-full tabular-nums">
            +{currency} {overAmount.toLocaleString()} {t.budgetExceededBy}
          </span>
        </div>
      )}

      {isApproaching && (
        <div
          role="status"
          aria-live="polite"
          className="px-4 py-2.5 bg-amber-500 text-slate-950 flex flex-wrap items-center justify-between gap-2 text-xs font-bold animate-in fade-in motion-reduce:animate-none"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{t.nearBudgetLabel} · {t.budgetWarningApproaching}</span>
          </div>
          <span className="font-mono text-[11px] bg-amber-700 text-white px-2 py-0.5 rounded-full tabular-nums">
            {currency} {remaining.toLocaleString()} {t.budgetRemaining}
          </span>
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Main Header / Status Row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-colors ${
                isExceeded
                  ? 'bg-rose-100 dark:bg-rose-900/60 text-rose-600 dark:text-rose-300'
                  : isApproaching
                  ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {isExceeded ? (
                <ShieldAlert className="w-4 h-4" aria-hidden="true" />
              ) : isApproaching ? (
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Wallet className="w-4 h-4" aria-hidden="true" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  {t.dailyBudgetCap}
                </span>

                {/* Non-color status indicator badge */}
                {hasLimit && (
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                      isExceeded
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/80 dark:text-rose-200'
                        : isApproaching
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/80 dark:text-amber-200'
                        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
                    }`}
                  >
                    {isExceeded ? (
                      <>
                        <ShieldAlert className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>
                          {t.overBudgetByPrefix} {currency} {overAmount.toLocaleString()}
                        </span>
                      </>
                    ) : isApproaching ? (
                      <>
                        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>{t.nearBudgetLabel}</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>{t.budgetSafe}</span>
                      </>
                    )}
                  </span>
                )}
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {hasLimit
                  ? `${currency} ${limit.toLocaleString()} cap${
                      defaultBudget && defaultBudget > 0
                        ? ` · ${t.defaultBudgetSavedBadge}: ${currency} ${defaultBudget.toLocaleString()}`
                        : ''
                    }`
                  : defaultBudget && defaultBudget > 0
                  ? `${t.defaultBudgetSavedBadge}: ${currency} ${defaultBudget.toLocaleString()}`
                  : 'Set an optional budget cap in KES while you shop'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsEditing(!isEditing);
              setInputValue(hasLimit ? String(limit) : defaultBudget ? String(defaultBudget) : '');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shrink-0 transition active:scale-95 ${
              isEditing
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{hasLimit ? 'Adjust' : t.setBudget}</span>
          </button>
        </div>

        {/* Real-time Visual Progress Gauge */}
        {hasLimit && (
          <div className="space-y-2 pt-1">
            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  {t.currentCartTotal}
                </span>
                <span className="text-xl font-black text-slate-900 dark:text-white tabular-nums">
                  {currency} {cartTotal.toLocaleString()}
                </span>
              </div>

              <div className="text-right">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  {isExceeded ? t.overBudgetByPrefix : t.budgetRemaining}
                </span>
                <span
                  className={`text-sm font-bold font-mono tabular-nums ${
                    isExceeded
                      ? 'text-rose-600 dark:text-rose-400'
                      : isApproaching
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {isExceeded
                    ? `${currency} ${overAmount.toLocaleString()}`
                    : `${currency} ${remaining.toLocaleString()}`}
                </span>
              </div>
            </div>

            {/* Gauge Progress Track with 80% threshold mark */}
            <div className="relative">
              <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden relative shadow-inner">
                <div
                  className={`h-full transition-all duration-500 motion-reduce:transition-none rounded-full ${
                    isExceeded
                      ? 'bg-gradient-to-r from-amber-500 to-rose-600 shadow-sm shadow-rose-500/50'
                      : isApproaching
                      ? 'bg-gradient-to-r from-emerald-500 to-amber-500 shadow-sm shadow-amber-500/50'
                      : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(percentage > 0 ? 3 : 0, percentage))}%` }}
                />
              </div>

              {/* 80% Warning Marker line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-slate-400/60 dark:bg-slate-500/60 z-10 pointer-events-none"
                style={{ left: '80%' }}
                title="80% Near budget threshold"
              />
            </div>

            {/* Scale breakdown */}
            <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
              <span>0%</span>
              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                80% {t.nearBudgetLabel}
              </span>
              <span className="font-bold tabular-nums">
                {percentage}% {t.spentPercentage}
              </span>
            </div>
          </div>
        )}

        {/* Interactive Configuration Form */}
        {isEditing && (
          <div className="pt-3 border-t border-slate-200/70 dark:border-slate-800/80 space-y-3 animate-in fade-in motion-reduce:animate-none">
            <div>
              <label
                htmlFor="cart-budget-limit-input"
                className="text-xs font-bold text-slate-900 dark:text-white block mb-1.5"
              >
                {t.setBudget} ({currency})
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-2.5 text-xs font-mono font-bold text-slate-400">
                    {currency}
                  </span>
                  <input
                    id="cart-budget-limit-input"
                    type="number"
                    min="1"
                    step="50"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="e.g. 2500"
                    className="w-full h-10 pl-12 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-emerald-500"
                    autoFocus
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs transition active:scale-95 shadow-sm"
                >
                  {t.save}
                </button>

                {hasLimit && (
                  <button
                    type="button"
                    onClick={handleClearBudget}
                    className="h-10 px-3 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold transition"
                    title={t.removeBudget}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={saveAsDefault}
                onChange={(e) => setSaveAsDefault(e.target.checked)}
                className="rounded text-emerald-600"
              />
              <span>{t.saveAsDefaultBudget}</span>
            </label>

            {/* Quick Presets Buttons */}
            <div>
              <span className="text-[11px] font-semibold text-slate-400 block mb-1.5">
                {t.quickPresets}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => {
                  const isSelected = limit === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleSelectPreset(p)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold transition active:scale-95 ${
                        isSelected
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {currency} {p.toLocaleString()}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
