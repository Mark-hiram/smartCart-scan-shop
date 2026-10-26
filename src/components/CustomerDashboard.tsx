import React from 'react';
import {
  Camera,
  Search,
  ShoppingCart,
  Wallet,
  FileText,
  History,
  Store,
  Sparkles,
  ArrowRight,
  TrendingDown,
  AlertTriangle,
  Plus,
  Minus,
  Trash2,
  CheckCircle,
  HelpCircle,
  Award,
  Gift,
  Star,
} from 'lucide-react';
import { Mail, User as UserIcon } from 'lucide-react';
import {
  Supermarket,
  ShoppingSession,
  CustomerLoyalty,
  User,
} from '../types.ts';

interface CustomerDashboardProps {
  currentUser?: User;
  supermarket: Supermarket;
  session: ShoppingSession | null;
  loyalty: CustomerLoyalty | null;
  onOpenAccount?: () => void;
  onOpenScanner: () => void;
  onOpenSearch: () => void;
  onOpenCart: () => void;
  onOpenBudget: () => void;
  onOpenSummary: () => void;
  onOpenHistory: () => void;
  onOpenLoyalty: () => void;
  onOpenStoreSelector: () => void;
  onQuickScanBarcode: (barcode: string) => void;
  onUpdateCartItemQty: (itemId: string, newQty: number) => void;
  onRemoveCartItem: (itemId: string) => void;
}

export const CustomerDashboard: React.FC<CustomerDashboardProps> = ({
  currentUser,
  supermarket,
  session,
  loyalty,
  onOpenAccount,
  onOpenScanner,
  onOpenSearch,
  onOpenCart,
  onOpenBudget,
  onOpenSummary,
  onOpenHistory,
  onOpenLoyalty,
  onOpenStoreSelector,
  onQuickScanBarcode,
  onUpdateCartItemQty,
  onRemoveCartItem,
}) => {
  const user = currentUser || {
    id: 'usr_guest',
    name: 'Shopper',
    email: 'guest@smartcart.co.ke',
    role: 'CUSTOMER' as const,
  };
  const userName = user.name || 'Shopper';
  const userEmail = user.email || 'guest@smartcart.co.ke';
  const userInitial = userName.charAt(0).toUpperCase() || 'S';

  const itemCount = session?.items.reduce((sum, item) => sum + item.quantity, 0) || 0;
  const estimatedTotal = session?.estimated_total || 0;
  const budget = session?.budget || 2000;
  const remainingBudget = budget - estimatedTotal;
  const isBudgetExceeded = estimatedTotal > budget;
  const budgetPercent = Math.min(100, Math.round((estimatedTotal / budget) * 100));

  const totalPoints = loyalty?.total_points || 0;
  const pointsValue = loyalty?.points_value_ksh || totalPoints;
  const tier = loyalty?.tier || 'Bronze';
  const cartPotentialPoints = Math.floor(estimatedTotal / 100);


  return (
    <div className="max-w-md mx-auto px-3.5 py-4 sm:py-6 space-y-4">
      {/* Customer Account & Email Linked Badge Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-2xs flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-800 to-emerald-950 text-amber-300 flex items-center justify-center font-black text-sm shadow-sm shrink-0">
            {userInitial}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black text-slate-900 truncate">{userName}</span>
              <span className="text-[9px] font-bold bg-amber-100 text-amber-950 border border-amber-300 px-1.5 py-0.2 rounded-full shrink-0">
                {loyalty?.tier || 'Bronze'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-medium truncate flex items-center gap-1 mt-0.5">
              <Mail className="w-3 h-3 text-emerald-600 shrink-0" />
              <span className="truncate font-mono">{userEmail}</span>
            </p>
          </div>
        </div>

        <button
          onClick={() => onOpenAccount?.()}
          className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-amber-400 hover:text-emerald-950 border border-slate-200 text-xs font-bold text-slate-700 transition shrink-0 flex items-center gap-1 active:scale-95"
          title="Customer account linked to email"
        >
          <span>My Account</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Supermarket Header Card */}
      <div className="bg-gradient-to-br from-emerald-900 via-emerald-800 to-emerald-950 text-white p-5 rounded-3xl shadow-xl border border-emerald-700/50 relative overflow-hidden">
        {/* Subtle decorative background ring */}
        <div className="absolute -right-8 -bottom-8 w-40 h-40 rounded-full bg-emerald-600/10 pointer-events-none" />

        <div className="relative z-10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-widest uppercase bg-amber-400 text-emerald-950 px-2.5 py-0.5 rounded-full">
              CONNECTED STORE
            </span>
            <button
              onClick={onOpenStoreSelector}
              className="text-[11px] text-amber-300 hover:text-amber-200 underline font-semibold flex items-center gap-1"
            >
              Switch Store
            </button>
          </div>

          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight">{supermarket.name}</h1>
            <p className="text-xs text-emerald-200/90 flex items-center gap-1 mt-0.5">
              <span>Code: <strong className="font-mono text-amber-300">{supermarket.supermarket_code}</strong></span>
              <span>•</span>
              <span className="truncate">{supermarket.location}</span>
            </p>
          </div>

          <p className="text-[11px] text-emerald-200/75 italic">
            &ldquo;Your shopping, your way. Real-time prices from this supermarket.&rdquo;
          </p>
        </div>
      </div>

      {/* PROMINENT ACTION BUTTON: SCAN PRODUCT (Section 15, 27, 28) */}
      <button
        onClick={onOpenScanner}
        className="w-full py-5 px-6 bg-gradient-to-r from-emerald-700 to-emerald-800 hover:from-emerald-800 hover:to-emerald-900 text-white rounded-3xl shadow-xl shadow-emerald-900/25 border-2 border-emerald-600 flex items-center justify-between group transition-all duration-150 active:scale-[0.98]"
      >
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-400 text-emerald-950 flex items-center justify-center font-black shadow-lg group-hover:scale-110 transition duration-150">
            <Camera className="w-7 h-7 stroke-[2.5]" />
          </div>
          <div className="text-left">
            <span className="text-[10px] uppercase font-bold tracking-wider text-amber-300 block">
              CAMERA SCANNER
            </span>
            <span className="text-lg font-black tracking-tight leading-none text-white block">
              SCAN PRODUCT
            </span>
            <span className="text-[11px] text-emerald-200/90 font-medium mt-0.5 block">
              Point camera or enter barcode
            </span>
          </div>
        </div>

        <div className="w-10 h-10 rounded-full bg-emerald-950/40 group-hover:bg-amber-400 group-hover:text-emerald-950 flex items-center justify-center text-emerald-200 transition">
          <ArrowRight className="w-5 h-5" />
        </div>
      </button>

      {/* Search Input Trigger */}
      <div
        onClick={onOpenSearch}
        className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs hover:border-emerald-500 cursor-pointer transition flex items-center justify-between gap-3 group"
      >
        <div className="flex items-center gap-2.5 text-slate-400 group-hover:text-emerald-800 transition">
          <Search className="w-4 h-4" />
          <span className="text-xs font-medium text-slate-500">
            Search products in {supermarket.name}...
          </span>
        </div>
        <span className="text-[10px] bg-slate-100 group-hover:bg-emerald-100 text-slate-600 group-hover:text-emerald-800 px-2 py-0.5 rounded-md font-semibold">
          Catalog
        </span>
      </div>

      {/* Live Total & Budget Summary Card (Sections 7, 8, 28) */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-4">
        {/* Shopping Summary Headline */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-900 flex items-center justify-center font-bold">
              <ShoppingCart className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-900">
                Live Shopping Total
              </h2>
              <span className="text-[10px] text-slate-400">Calculated by {supermarket.name} database</span>
            </div>
          </div>

          <button
            onClick={onOpenCart}
            className="text-xs font-extrabold text-emerald-800 hover:text-emerald-900 flex items-center gap-1"
          >
            <span>View Cart ({itemCount})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Totals Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Cart Items
            </span>
            <div className="text-xl font-mono font-black text-slate-900 mt-0.5">
              {itemCount} <span className="text-xs font-normal text-slate-500">items</span>
            </div>
            {session && session.discount > 0 && (
              <span className="text-[10px] text-emerald-700 font-semibold mt-0.5 block">
                Saved KSh {session.discount.toLocaleString()}
              </span>
            )}
          </div>

          <div className="bg-emerald-50/70 p-3 rounded-2xl border border-emerald-200/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block">
              Estimated Total
            </span>
            <div className="text-xl font-mono font-black text-emerald-900 mt-0.5">
              KSh {estimatedTotal.toLocaleString()}
            </div>
            <span className="text-[10px] text-emerald-700 font-medium block">
              Pay at checkout
            </span>
          </div>
        </div>

        {/* Shopping Budget Progress Tracker (Section 8) */}
        <div className="pt-2 border-t border-slate-100 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-slate-600 font-medium">My Budget:</span>
              <button
                onClick={onOpenBudget}
                className="font-mono font-bold text-slate-900 hover:text-emerald-700 underline"
              >
                KSh {budget.toLocaleString()}
              </button>
            </div>

            <div className="text-right">
              <span className="text-[11px] text-slate-500 mr-1">Remaining:</span>
              <span
                className={`font-mono font-bold ${
                  remainingBudget >= 0 ? 'text-emerald-700' : 'text-rose-600'
                }`}
              >
                KSh {remainingBudget.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Visual Progress Bar */}
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isBudgetExceeded
                  ? 'bg-rose-500'
                  : budgetPercent > 80
                  ? 'bg-amber-500'
                  : 'bg-emerald-600'
              }`}
              style={{ width: `${Math.min(100, (estimatedTotal / (budget || 1)) * 100)}%` }}
            />
          </div>

          {isBudgetExceeded && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-[11px] text-rose-800 font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Your estimated total has exceeded your shopping budget.</span>
            </div>
          )}
        </div>
      </div>

      {/* LOYALTY POINTS TRACKING CARD (Earned from completed shopping sessions) */}
      <div className="bg-gradient-to-br from-amber-500/10 via-white to-amber-500/15 border border-amber-300/80 rounded-3xl p-4 shadow-sm relative overflow-hidden">
        {/* Subtle decorative glow */}
        <div className="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-amber-400/20 pointer-events-none" />

        <div className="relative z-10 space-y-3">
          {/* Card Top Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-amber-400 text-emerald-950 flex items-center justify-center font-black shadow-xs">
                <Award className="w-4 h-4 stroke-[2.5]" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-950">
                  SmartPoints Loyalty
                </span>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 border border-amber-300 font-sans">
                  {tier} Member
                </span>
              </div>
            </div>

            <button
              onClick={onOpenLoyalty}
              className="text-[11px] font-extrabold text-amber-900 hover:text-emerald-800 flex items-center gap-1 group transition"
            >
              <span>Rewards &amp; Tier</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
            </button>
          </div>

          {/* Points Balance & Current Session Earning */}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <div className="bg-white/90 p-2.5 rounded-2xl border border-amber-200/70 shadow-2xs">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">
                Total Points Earned
              </span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-xl font-black font-mono text-emerald-950">
                  {totalPoints.toLocaleString()}
                </span>
                <span className="text-[10px] font-bold text-amber-600">PTS</span>
              </div>
              <span className="text-[10px] text-emerald-700 font-medium block">
                = KSh {pointsValue.toLocaleString()} credit
              </span>
            </div>

            <div className="bg-white/90 p-2.5 rounded-2xl border border-amber-200/70 shadow-2xs">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block">
                This Cart Will Earn
              </span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-xl font-black font-mono text-amber-900">
                  +{cartPotentialPoints}
                </span>
                <span className="text-[10px] font-bold text-amber-600">PTS</span>
              </div>
              <span className="text-[10px] text-slate-500 font-medium block">
                {cartPotentialPoints > 0
                  ? 'Calculated from total'
                  : 'Add items (KSh 100 = 1 pt)'}
              </span>
            </div>
          </div>

          {/* Tier Progress Bar */}
          {loyalty?.next_tier_name && (
            <div className="space-y-1 pt-1 border-t border-amber-200/60">
              <div className="flex justify-between items-center text-[10px] text-amber-950 font-semibold">
                <span>Next Tier: <strong>{loyalty.next_tier_name}</strong></span>
                <span>{loyalty.points_to_next_tier} pts needed</span>
              </div>
              <div className="w-full bg-amber-200/70 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-amber-600 h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, loyalty.tier_progress_percent)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Action Navigation Grid (Section 15 + Loyalty) */}
      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={onOpenSummary}
          className="p-2.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-2xl flex flex-col items-center justify-center text-center transition shadow-2xs group"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center group-hover:scale-105 transition mb-1">
            <FileText className="w-4 h-4" />
          </div>
          <span className="text-[11px] font-extrabold text-slate-800 leading-tight">
            Receipt
          </span>
          <span className="text-[8px] text-slate-400 mt-0.5">Summary</span>
        </button>

        <button
          onClick={onOpenBudget}
          className="p-2.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-2xl flex flex-col items-center justify-center text-center transition shadow-2xs group"
        >
          <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-800 flex items-center justify-center group-hover:scale-105 transition mb-1">
            <Wallet className="w-4 h-4" />
          </div>
          <span className="text-[11px] font-extrabold text-slate-800 leading-tight">
            Budget
          </span>
          <span className="text-[8px] text-slate-400 mt-0.5">KSh {budget}</span>
        </button>

        <button
          onClick={onOpenLoyalty}
          className="p-2.5 bg-white hover:bg-amber-50/50 border border-amber-200/90 rounded-2xl flex flex-col items-center justify-center text-center transition shadow-2xs group"
        >
          <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center group-hover:scale-105 transition mb-1 relative">
            <Award className="w-4 h-4" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-500 animate-ping" />
          </div>
          <span className="text-[11px] font-extrabold text-amber-950 leading-tight">
            Loyalty
          </span>
          <span className="text-[8px] text-amber-800 font-bold mt-0.5">{totalPoints} pts</span>
        </button>

        <button
          onClick={onOpenHistory}
          className="p-2.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-2xl flex flex-col items-center justify-center text-center transition shadow-2xs group"
        >
          <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center group-hover:scale-105 transition mb-1">
            <History className="w-4 h-4" />
          </div>
          <span className="text-[11px] font-extrabold text-slate-800 leading-tight">
            History
          </span>
          <span className="text-[8px] text-slate-400 mt-0.5">Visits</span>
        </button>
      </div>

      {/* Mandatory Customer Disclaimer (Section 26) */}
      <div className="p-3 bg-slate-100 rounded-2xl border border-slate-200 text-[10px] text-slate-500 leading-relaxed italic text-center">
        &ldquo;SmartCart provides an estimated shopping total based on the supermarket&apos;s current product database. Final prices may differ because of promotions, weighing, price changes, unavailable stock, or checkout adjustments.&rdquo;
      </div>
    </div>
  );
};
