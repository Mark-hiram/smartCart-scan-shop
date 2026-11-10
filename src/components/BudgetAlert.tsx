import React, { useState } from 'react';
import { useTranslation } from '../utils/i18n';
import {
  AlertTriangle,
  CheckCircle2,
  Sliders,
  DollarSign,
  TrendingUp,
  X,
  Check,
  ShieldAlert,
  Wallet,
  ArrowUpRight,
} from 'lucide-react';

export interface BudgetAlertProps {
  cartTotal: number;
  budgetLimit?: number | null;
  onUpdateBudget: (newLimit: number | null) => Promise<void> | void;
  currency?: string;
  className?: string;
  showDetailsOnlyWhenSet?: boolean;
}

export const BudgetAlert: React.FC<BudgetAlertProps> = ({
  cartTotal,
  budgetLimit,
  onUpdateBudget,
  currency = 'KES',
  className = '',
}) => {
  const { t } = useTranslation();

  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(budgetLimit ? String(budgetLimit) : '');
  const [isSaving, setIsSaving] = useState(false);

  // Quick preset options in KES
  const presets = [500, 1000, 2000, 3500, 5000, 10000];

  const limit = budgetLimit || 0;
  const hasLimit = limit > 0;
  const ratio = hasLimit ? cartTotal / limit : 0;
  const percentage = Math.round(ratio * 100);

  // Warning states
  const isApproaching = hasLimit && ratio >= 0.85 && ratio < 1.0;
  const isExceeded = hasLimit && ratio >= 1.0;
  const isCaution = hasLimit && ratio >= 0.7 && ratio < 0.85;

  const remaining = Math.max(0, limit - cartTotal);
  const overAmount = Math.max(0, cartTotal - limit);

  // Handle saving new budget limit
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
      await onUpdateBudget(finalLimit);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectPreset = (val: number) => {
    setInputValue(String(val));
    handleSave(val);
  };

  const handleClearBudget = () => {
    setInputValue('');
    handleSave(null);
  };

  return (
    <div
      className={`rounded-3xl border transition-all duration-300 overflow-hidden shadow-xs ${
        isExceeded
          ? 'bg-rose-50/90 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 ring-2 ring-rose-500/20'
          : isApproaching
          ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 ring-2 ring-amber-500/20'
          : isCaution
          ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/60'
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
      } ${className}`}
    >
      {/* Top Banner Warning (Visible when approached or exceeded) */}
      {isExceeded && (
        <div className="px-4 py-2.5 bg-rose-600 text-white flex items-center justify-between gap-2 text-xs font-bold animate-pulse">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{t.budgetWarningExceeded}</span>
          </div>
          <span className="font-mono text-[11px] bg-rose-700 px-2 py-0.5 rounded-full tabular-nums">
            +{currency} {overAmount.toLocaleString()} {t.budgetExceededBy}
          </span>
        </div>
      )}

      {isApproaching && (
        <div className="px-4 py-2.5 bg-amber-500 text-slate-950 flex items-center justify-between gap-2 text-xs font-bold animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{t.budgetWarningApproaching}</span>
          </div>
          <span className="font-mono text-[11px] bg-amber-600 text-white px-2 py-0.5 rounded-full tabular-nums">
            {currency} {remaining.toLocaleString()} {t.budgetRemaining}
          </span>
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Main Header / Status Row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-colors ${
                isExceeded
                  ? 'bg-rose-100 dark:bg-rose-900/60 text-rose-600 dark:text-rose-300'
                  : isApproaching
                  ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              <Wallet className="w-4 h-4" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  {t.dailyBudgetCap}
                </span>

                {/* Status indicator badge */}
                {hasLimit && (
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                      isExceeded
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/80 dark:text-rose-200'
                        : isApproaching
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/80 dark:text-amber-200'
                        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
                    }`}
                  >
                    {isExceeded
                      ? t.budgetExceededAlert
                      : isApproaching
                      ? t.budgetApproachingWarning
                      : t.budgetSafe}
                  </span>
                )}
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {hasLimit
                  ? `${currency} ${limit.toLocaleString()} max per shopping day`
                  : 'Track your spending in real time as you scan'}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              setIsEditing(!isEditing);
              setInputValue(hasLimit ? String(limit) : '');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 ${
              isEditing
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
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
                  {isExceeded ? 'Exceeded By' : t.budgetRemaining}
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
                    ? `+${currency} ${overAmount.toLocaleString()}`
                    : `${currency} ${remaining.toLocaleString()}`}
                </span>
              </div>
            </div>

            {/* Gauge Progress Track with threshold marks */}
            <div className="relative">
              <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden relative shadow-inner">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    isExceeded
                      ? 'bg-gradient-to-r from-amber-500 to-rose-600 shadow-sm shadow-rose-500/50'
                      : isApproaching
                      ? 'bg-gradient-to-r from-emerald-500 to-amber-500 shadow-sm shadow-amber-500/50'
                      : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(3, percentage))}%` }}
                />
              </div>

              {/* 85% Warning Marker line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-slate-400/50 dark:bg-slate-500/50 z-10 pointer-events-none"
                style={{ left: '85%' }}
                title="85% Warning threshold"
              />
            </div>

            {/* Scale breakdown */}
            <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
              <span>0%</span>
              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                85% Threshold
              </span>
              <span className="font-bold tabular-nums">
                {percentage}% {t.spentPercentage}
              </span>
            </div>
          </div>
        )}

        {/* Interactive Configuration Form */}
        {isEditing && (
          <div className="pt-3 border-t border-slate-200/70 dark:border-slate-800/80 space-y-3 animate-in fade-in">
            <div>
              <label className="text-xs font-bold text-slate-900 dark:text-white block mb-1.5">
                Set Custom Daily Spending Limit ({currency})
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-2.5 text-xs font-mono font-bold text-slate-400">
                    {currency}
                  </span>
                  <input
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
                  onClick={() => handleSave()}
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
