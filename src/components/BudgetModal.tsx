import React, { useState } from 'react';
import { Wallet, Check, X, AlertTriangle, TrendingUp } from 'lucide-react';

interface BudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBudget: number;
  currentTotal: number;
  onSaveBudget: (budget: number) => void;
}

export const BudgetModal: React.FC<BudgetModalProps> = ({
  isOpen,
  onClose,
  currentBudget,
  currentTotal,
  onSaveBudget,
}) => {
  const [budgetInput, setBudgetInput] = useState(currentBudget.toString());

  if (!isOpen) return null;

  const presets = [1000, 2000, 3000, 5000, 10000];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(budgetInput);
    if (!isNaN(val) && val > 0) {
      onSaveBudget(val);
      onClose();
    }
  };

  const parsed = parseFloat(budgetInput) || 0;
  const remaining = parsed - currentTotal;
  const isOver = currentTotal > parsed;
  const percentUsed = parsed > 0 ? Math.min(100, Math.round((currentTotal / parsed) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-amber-400 text-emerald-950 flex items-center justify-center font-bold">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-slate-900">Shopping Budget</h3>
              <p className="text-[11px] text-slate-500">Track spending in real-time</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Target Spending Limit (KSh)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-sm">
                KSh
              </span>
              <input
                type="number"
                min="100"
                step="50"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                className="w-full pl-14 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-lg font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                autoFocus
              />
            </div>
          </div>

          {/* Preset Buttons */}
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">
              Quick Budget Presets:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setBudgetInput(amt.toString())}
                  className={`text-xs px-2.5 py-1 rounded-lg font-mono font-semibold transition ${
                    parsed === amt
                      ? 'bg-emerald-800 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  KSh {amt.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          {/* Budget Status Simulation Preview */}
          <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 text-xs space-y-2">
            <div className="flex justify-between text-slate-600">
              <span>Current Cart Total:</span>
              <span className="font-bold font-mono">KSh {currentTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Remaining Allowance:</span>
              <span
                className={`font-bold font-mono ${
                  remaining >= 0 ? 'text-emerald-700' : 'text-rose-600'
                }`}
              >
                KSh {remaining.toLocaleString()}
              </span>
            </div>

            {/* Progress bar */}
            <div className="space-y-1 pt-1">
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Budget Consumed</span>
                <span className="font-bold">{percentUsed}%</span>
              </div>
              <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    isOver ? 'bg-rose-500' : percentUsed > 80 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, (currentTotal / (parsed || 1)) * 100)}%` }}
                />
              </div>
            </div>

            {isOver && (
              <div className="p-2 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-[11px] font-semibold flex items-center gap-1.5 mt-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Your estimated total has exceeded your shopping budget.</span>
              </div>
            )}
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-xs rounded-xl shadow-md transition"
          >
            Save Shopping Budget
          </button>
        </form>
      </div>
    </div>
  );
};
