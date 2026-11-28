// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Download,
  RefreshCw,
  ShieldAlert,
  BarChart3,
} from 'lucide-react';
import {
  AdminAnalyticsPayload,
  AnalyticsKpiMetric,
  AnalyticsRange,
} from '../types';
import { useTranslation } from '../utils/i18n';
import {
  useCountUp,
  useInViewOnce,
  usePrefersReducedMotion,
} from '../hooks/useAnalyticsMotion';

interface AdminAnalyticsSectionProps {
  token: string | null;
  range?: AnalyticsRange;
  onRangeChange?: (range: AnalyticsRange) => void;
  onAnalyticsLoaded?: (payload: AdminAnalyticsPayload) => void;
  onFilterChange?: (supermarketId: string, branchId: string) => void;
  onExportCsv?: (supermarketId: string, branchId: string) => void;
  isExportingCsv?: boolean;
  hideExportButton?: boolean;
}

// Consistent semantic colors shared across all charts
const COLORS = {
  signups: '#0ea5e9',       // Sky
  cartsStarted: '#6366f1',  // Indigo
  cartsFinished: '#10b981', // Emerald
  inProgress: '#0ea5e9',    // Sky
  active: '#10b981',        // Emerald
  pending: '#f59e0b',       // Amber
  suspended: '#ef4444',     // Rose/Crimson
  products: '#6366f1',      // Indigo
  scanSuccess: '#10b981',   // Emerald
  scanFailure: '#ef4444',   // Crimson
  loyaltyIssued: '#10b981', // Emerald
  loyaltyRedeemed: '#f59e0b', // Amber
  rewards: '#8b5cf6',       // Violet
  supportOpen: '#f59e0b',   // Amber
  supportClosed: '#10b981', // Emerald
  secFailure: '#f59e0b',    // Amber
  secLockout: '#ef4444',    // Crimson
  avgCartValue: '#0ea5e9',  // Sky
};

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: '12px',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  backgroundColor: 'rgba(15, 23, 42, 0.96)',
  color: '#f8fafc',
  fontSize: '12px',
  padding: '8px 12px',
  boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.4)',
};

const TOOLTIP_ITEM_STYLE: React.CSSProperties = {
  color: '#f8fafc',
  padding: '1px 0',
};

const TOOLTIP_LABEL_STYLE: React.CSSProperties = {
  color: '#cbd5e1',
  fontWeight: 700,
  marginBottom: '4px',
};

interface KpiCardProps {
  title: string;
  metric: AnalyticsKpiMetric;
  color: string;
  unitSuffix?: string;
  prefix?: string;
  subtext?: string;
  vsPrevLabel: string;
  reducedMotion: boolean;
}

const AnimatedKpiCard: React.FC<KpiCardProps> = ({
  title,
  metric,
  color,
  unitSuffix = '',
  prefix = '',
  subtext,
  vsPrevLabel,
  reducedMotion,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const inView = useInViewOnce(cardRef, reducedMotion);
  const animatedNumber = useCountUp(metric.value, inView, reducedMotion, 650);

  const sparkData = useMemo(
    () =>
      (metric.sparkline && metric.sparkline.length > 0
        ? metric.sparkline
        : [0]
      ).map((v, idx) => ({ idx, val: v })),
    [metric.sparkline]
  );

  const hasPositiveDelta = metric.changePct !== null ? metric.changePct > 0 : metric.value > 0;
  const hasNegativeDelta = metric.changePct !== null && metric.changePct < 0;

  const deltaColor = hasPositiveDelta
    ? 'text-emerald-700 dark:text-emerald-400'
    : hasNegativeDelta
    ? 'text-rose-700 dark:text-rose-400'
    : 'text-slate-500 dark:text-slate-400';

  const deltaLabel =
    metric.changePct === null
      ? metric.value > 0
        ? 'New'
        : '0%'
      : `${metric.changePct > 0 ? '+' : ''}${metric.changePct}%`;

  const gradId = useMemo(
    () => `kpi-spark-${title.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`,
    [title]
  );

  return (
    <div
      ref={cardRef}
      className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-2 min-w-0 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400 leading-snug">
          {title}
        </span>
        <span
          className={`inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums shrink-0 ${deltaColor}`}
          title={`${deltaLabel} ${vsPrevLabel}`}
        >
          {hasPositiveDelta ? (
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
          ) : hasNegativeDelta ? (
            <ArrowDownRight className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <Minus className="w-3 h-3" aria-hidden="true" />
          )}
          <span>{deltaLabel}</span>
        </span>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums tracking-tight truncate">
            {prefix}
            {animatedNumber.toLocaleString()}
            {unitSuffix ? (
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 ml-1">
                {unitSuffix}
              </span>
            ) : null}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate tabular-nums">
            {subtext || `${vsPrevLabel}: ${prefix}${metric.previous.toLocaleString()}`}
          </p>
        </div>

        <div className="w-20 h-9 shrink-0" aria-hidden="true">
          {inView && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="val"
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#${gradId})`}
                  dot={false}
                  isAnimationActive={!reducedMotion}
                  animationDuration={550}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
};

interface ChartCardProps {
  title: string;
  subtitle?: string;
  heightClass?: string;
  isEmpty?: boolean;
  emptyLabel: string;
  reducedMotion: boolean;
  className?: string;
  headerRight?: React.ReactNode;
  children: (inView: boolean) => React.ReactNode;
}

const ChartCard: React.FC<ChartCardProps> = ({
  title,
  subtitle,
  heightClass = 'h-64',
  isEmpty = false,
  emptyLabel,
  reducedMotion,
  className = '',
  headerRight,
  children,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const inView = useInViewOnce(cardRef, reducedMotion);

  return (
    <section
      ref={cardRef}
      className={`p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 min-w-0 transition-opacity ${
        reducedMotion
          ? 'opacity-100'
          : inView
          ? 'opacity-100 duration-300'
          : 'opacity-0'
      } ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
          )}
        </div>
        {headerRight}
      </div>

      {isEmpty ? (
        <div
          className={`${heightClass} flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center px-4`}
        >
          <BarChart3 className="w-6 h-6 text-slate-400 dark:text-slate-500 mb-1.5" aria-hidden="true" />
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{emptyLabel}</p>
        </div>
      ) : (
        <div className={`${heightClass} w-full min-w-0`}>
          {inView ? children(inView) : null}
        </div>
      )}
    </section>
  );
};

export const AdminAnalyticsSection: React.FC<AdminAnalyticsSectionProps> = ({
  token,
  range: controlledRange,
  onRangeChange,
  onAnalyticsLoaded,
  onFilterChange,
  onExportCsv,
  isExportingCsv: controlledExportingCsv,
  hideExportButton = false,
}) => {
  const { t } = useTranslation();
  const reducedMotion = usePrefersReducedMotion();

  const [uncontrolledRange, setUncontrolledRange] = useState<AnalyticsRange>('30d');
  const range = controlledRange ?? uncontrolledRange;
  const setRange = (next: AnalyticsRange) => {
    if (onRangeChange) {
      onRangeChange(next);
    } else {
      setUncontrolledRange(next);
    }
  };
  const [supermarketId, setSupermarketId] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('');
  const [analytics, setAnalytics] = useState<AdminAnalyticsPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isExportingCsv, setIsExportingCsv] = useState<boolean>(false);
  const [activityChartMode, setActivityChartMode] = useState<'area' | 'line'>('area');

  const buildQueryString = (r: AnalyticsRange, smId: string, brId: string) => {
    const params = new URLSearchParams();
    params.set('range', r);
    if (smId) params.set('supermarketId', smId);
    if (brId) params.set('branchId', brId);
    return params.toString();
  };

  const fetchAnalytics = async (
    targetRange: AnalyticsRange,
    targetSmId: string,
    targetBrId: string,
    isManualRefresh = false
  ) => {
    if (!token) return;
    if (isManualRefresh) setIsRefreshing(true);
    else if (!analytics) setIsLoading(true);
    setErrorMsg(null);

    try {
      const qs = buildQueryString(targetRange, targetSmId, targetBrId);
      const res = await fetch(`/api/admin/analytics?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.error || 'Could not load platform analytics.');
      } else {
        setAnalytics(data);
        onAnalyticsLoaded?.(data);
      }
    } catch {
      setErrorMsg('Network error loading platform analytics.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAnalytics(range, supermarketId, branchId);
    onFilterChange?.(supermarketId, branchId);
  }, [token, range, supermarketId, branchId]);

  const handleExportCsv = async () => {
    if (onExportCsv) {
      onExportCsv(supermarketId, branchId);
      return;
    }
    if (!token || isExportingCsv) return;
    setIsExportingCsv(true);
    try {
      const qs = buildQueryString(range, supermarketId, branchId);
      const res = await fetch(`/api/admin/analytics/csv?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smartcart_admin_analytics_${range}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // keep UI quiet on aborted download
    } finally {
      setIsExportingCsv(false);
    }
  };

  const availableBranches = useMemo(() => {
    const all = analytics?.filterOptions.branches || [];
    if (!supermarketId) return all;
    return all.filter((b) => b.supermarketId === supermarketId);
  }, [analytics, supermarketId]);

  const heatmapRef = useRef<HTMLDivElement>(null);
  const heatmapInView = useInViewOnce(heatmapRef, reducedMotion);

  const heatmapMax = useMemo(() => {
    if (!analytics) return 0;
    let max = 0;
    for (const row of analytics.activityHeatmap) {
      for (const cell of row.hours) {
        if (cell.count > max) max = cell.count;
      }
    }
    return max;
  }, [analytics]);

  const rangeOptions: Array<{ id: AnalyticsRange; label: string }> = [
    { id: 'today', label: t.analyticsRangeToday },
    { id: '7d', label: t.analyticsRange7d },
    { id: '30d', label: t.analyticsRange30d },
    { id: '90d', label: t.analyticsRange90d },
    { id: 'year', label: t.analyticsRangeYear },
  ];

  if (isLoading && !analytics) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="h-28 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-72 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse motion-reduce:animate-none" />
          <div className="h-72 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse motion-reduce:animate-none" />
        </div>
      </div>
    );
  }

  if (errorMsg && !analytics) {
    return (
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 text-center space-y-3">
        <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">{errorMsg}</p>
        <button
          type="button"
          onClick={() => fetchAnalytics(range, supermarketId, branchId, true)}
          className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!analytics) return null;

  const hasActivityTimeSeries = analytics.activityOverTime.some(
    (d) => d.signups > 0 || d.cartsStarted > 0 || d.cartsFinished > 0
  );
  const hasSupermarketStatusData = analytics.supermarketStatusSeries.some((s) => s.count > 0);
  const hasCartCompletionData = analytics.cartCompletionSeries.some((s) => s.count > 0);
  const hasTopSupermarkets = analytics.topSupermarketsByCarts.length > 0;
  const hasTopProducts = analytics.mostScannedProducts.length > 0;
  const hasScanEvents =
    analytics.scanOutcomes.successes > 0 || analytics.scanOutcomes.failures > 0;
  const hasLoyaltySeries = analytics.loyaltyOverTime.some(
    (l) => l.issued > 0 || l.redeemed > 0
  );
  const hasRewardItems = analytics.rewardsRedeemedByItem.length > 0;
  const hasSupportData =
    analytics.supportSummary.passwordResetRequests.total > 0 ||
    analytics.supportSummary.supportTickets.total > 0;
  const hasSecuritySeries = analytics.securitySummary.perDay.some(
    (d) => d.failures > 0 || d.lockouts > 0
  );

  const supportChartData = [
    {
      name: 'Password Resets',
      open: analytics.supportSummary.passwordResetRequests.open,
      closed: analytics.supportSummary.passwordResetRequests.closed,
    },
    {
      name: 'Support Tickets',
      open: analytics.supportSummary.supportTickets.open,
      closed: analytics.supportSummary.supportTickets.closed,
    },
  ];

  const getHeatmapCellColor = (count: number) => {
    if (count === 0 || heatmapMax === 0) {
      return 'bg-slate-100 dark:bg-slate-800/80 text-slate-400 dark:text-slate-500';
    }
    const ratio = count / heatmapMax;
    if (ratio >= 0.75) return 'bg-emerald-600 text-white';
    if (ratio >= 0.45) return 'bg-emerald-500 text-white';
    if (ratio >= 0.2) return 'bg-emerald-300 dark:bg-emerald-700 text-slate-900 dark:text-white';
    return 'bg-emerald-100 dark:bg-emerald-900/70 text-emerald-900 dark:text-emerald-200';
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls Bar */}
      <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {t.analyticsTitle}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-3xl">
              {t.analyticsSubtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => fetchAnalytics(range, supermarketId, branchId, true)}
              disabled={isRefreshing}
              className="min-h-10 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 transition whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshing && !reducedMotion ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Refresh</span>
            </button>
            {!hideExportButton && (
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={controlledExportingCsv ?? isExportingCsv}
                className="min-h-10 px-4 py-2 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t.analyticsExportCsv}</span>
              </button>
            )}
          </div>
        </div>

        {/* Date Range + Supermarket / Branch Filters */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div
            role="tablist"
            aria-label="Analytics view range"
            className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-fit max-w-full"
          >
            {rangeOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={range === opt.id}
                onClick={() => setRange(opt.id)}
                className={`min-h-10 px-3.5 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                  range === opt.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <select
              aria-label="Filter by supermarket"
              value={supermarketId}
              onChange={(e) => {
                setSupermarketId(e.target.value);
                setBranchId('');
              }}
              className="min-h-10 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-100"
            >
              <option value="">{t.analyticsAllSupermarkets}</option>
              {analytics.filterOptions.supermarkets.map((sm) => (
                <option key={sm.id} value={sm.id}>
                  {sm.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="min-h-10 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-100"
            >
              <option value="">{t.analyticsAllBranches}</option>
              {availableBranches.map((br) => (
                <option key={br.id} value={br.id}>
                  {br.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Top Row KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        <AnimatedKpiCard
          title={t.analyticsKpiActiveShoppers}
          metric={analytics.kpis.activeShoppers}
          color={COLORS.active}
          vsPrevLabel={t.analyticsVsPrev}
          reducedMotion={reducedMotion}
        />
        <AnimatedKpiCard
          title={t.analyticsKpiNewSignups}
          metric={analytics.kpis.newSignups}
          color={COLORS.signups}
          vsPrevLabel={t.analyticsVsPrev}
          reducedMotion={reducedMotion}
        />
        <AnimatedKpiCard
          title={t.analyticsKpiCartsStarted}
          metric={analytics.kpis.cartsStarted}
          color={COLORS.cartsStarted}
          subtext={`${analytics.kpis.cartsFinished.value.toLocaleString()} finished`}
          vsPrevLabel={t.analyticsVsPrev}
          reducedMotion={reducedMotion}
        />
        <AnimatedKpiCard
          title={t.analyticsKpiItemsScanned}
          metric={analytics.kpis.itemsScanned}
          color={COLORS.products}
          vsPrevLabel={t.analyticsVsPrev}
          reducedMotion={reducedMotion}
        />
        <AnimatedKpiCard
          title={t.analyticsKpiAvgCartValue}
          metric={analytics.kpis.averageCartValueKes}
          color={COLORS.avgCartValue}
          prefix="KES "
          subtext="Shopper cart total"
          vsPrevLabel={t.analyticsVsPrev}
          reducedMotion={reducedMotion}
        />
        <AnimatedKpiCard
          title={t.analyticsKpiLoyaltyIssued}
          metric={analytics.kpis.loyaltyPointsIssued}
          color={COLORS.loyaltyIssued}
          unitSuffix="pts"
          subtext={`${analytics.kpis.loyaltyPointsRedeemed.value.toLocaleString()} pts redeemed`}
          vsPrevLabel={t.analyticsVsPrev}
          reducedMotion={reducedMotion}
        />
      </div>

      {/* Primary Time-Series: Sign-Ups & Carts Over Time */}
      <ChartCard
        title="Shopper Sign-Ups & Carts Over Time"
        subtitle="New shopper accounts, carts started, and carts finished (Y-axis: count)"
        heightClass="h-72"
        isEmpty={!hasActivityTimeSeries}
        emptyLabel={t.analyticsNoDataYet}
        reducedMotion={reducedMotion}
        headerRight={
          <div
            role="group"
            aria-label="Chart style"
            className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800"
          >
            {(['area', 'line'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setActivityChartMode(mode)}
                className={`min-h-8 px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition whitespace-nowrap motion-reduce:transition-none ${
                  activityChartMode === mode
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        }
      >
        {() => (
          <ResponsiveContainer width="100%" height="100%">
            {activityChartMode === 'area' ? (
              <AreaChart
                data={analytics.activityOverTime}
                margin={{ top: 10, right: 16, left: 0, bottom: 8 }}
              >
                <defs>
                  <linearGradient id="gradSignups" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.signups} stopOpacity={0.28} />
                    <stop offset="95%" stopColor={COLORS.signups} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gradCartsFinished" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.cartsFinished} stopOpacity={0.28} />
                    <stop offset="95%" stopColor={COLORS.cartsFinished} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  width={38}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Area
                  type="monotone"
                  dataKey="signups"
                  name="New Sign-Ups (accounts)"
                  stroke={COLORS.signups}
                  strokeWidth={2}
                  fill="url(#gradSignups)"
                  isAnimationActive={!reducedMotion}
                  animationDuration={reducedMotion ? 0 : 700}
                />
                <Area
                  type="monotone"
                  dataKey="cartsStarted"
                  name="Carts Started (carts)"
                  stroke={COLORS.cartsStarted}
                  strokeWidth={2}
                  fillOpacity={0}
                  isAnimationActive={!reducedMotion}
                  animationDuration={reducedMotion ? 0 : 750}
                />
                <Area
                  type="monotone"
                  dataKey="cartsFinished"
                  name="Carts Finished (carts)"
                  stroke={COLORS.cartsFinished}
                  strokeWidth={2}
                  fill="url(#gradCartsFinished)"
                  isAnimationActive={!reducedMotion}
                  animationDuration={reducedMotion ? 0 : 800}
                />
              </AreaChart>
            ) : (
              <LineChart
                data={analytics.activityOverTime}
                margin={{ top: 10, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  width={38}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line
                  type="monotone"
                  dataKey="signups"
                  name="New Sign-Ups (accounts)"
                  stroke={COLORS.signups}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={!reducedMotion}
                  animationDuration={reducedMotion ? 0 : 700}
                />
                <Line
                  type="monotone"
                  dataKey="cartsStarted"
                  name="Carts Started (carts)"
                  stroke={COLORS.cartsStarted}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={!reducedMotion}
                  animationDuration={reducedMotion ? 0 : 750}
                />
                <Line
                  type="monotone"
                  dataKey="cartsFinished"
                  name="Carts Finished (carts)"
                  stroke={COLORS.cartsFinished}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={!reducedMotion}
                  animationDuration={reducedMotion ? 0 : 800}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Donut Charts Row: Carts Started vs Finished & Supermarket Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Carts Started vs Finished"
          subtitle={`Total started in period: ${analytics.kpis.cartsStarted.value.toLocaleString()} carts`}
          heightClass="h-64"
          isEmpty={!hasCartCompletionData}
          emptyLabel={t.analyticsNoDataYet}
          reducedMotion={reducedMotion}
        >
          {() => {
            const palette = [COLORS.cartsFinished, COLORS.inProgress];
            return (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.cartCompletionSeries}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={84}
                    paddingAngle={3}
                    isAnimationActive={!reducedMotion}
                    animationDuration={700}
                  >
                    {analytics.cartCompletionSeries.map((entry, idx) => (
                      <Cell key={entry.key} fill={palette[idx % palette.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(val: any) => [`${Number(val).toLocaleString()} carts`, '']}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            );
          }}
        </ChartCard>

        <ChartCard
          title="Supermarkets & Branches by Status"
          subtitle={`Supermarkets: ${analytics.organizationCounts.supermarkets.total} total · Branches: ${analytics.organizationCounts.branches.active} active, ${analytics.organizationCounts.branches.inactive} inactive`}
          heightClass="h-64"
          isEmpty={!hasSupermarketStatusData}
          emptyLabel={t.analyticsNoDataYet}
          reducedMotion={reducedMotion}
        >
          {() => {
            const statusPalette: Record<string, string> = {
              active: COLORS.active,
              pending: COLORS.pending,
              suspended: COLORS.suspended,
            };
            return (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.supermarketStatusSeries}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={84}
                    paddingAngle={3}
                    isAnimationActive={!reducedMotion}
                    animationDuration={700}
                  >
                    {analytics.supermarketStatusSeries.map((entry) => (
                      <Cell
                        key={entry.status}
                        fill={statusPalette[entry.status] || COLORS.active}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(val: any) => [`${Number(val).toLocaleString()} chains`, '']}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            );
          }}
        </ChartCard>
      </div>

      {/* Bar Charts Row: Top Supermarkets by Carts & Most Scanned Products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Top Supermarkets by Carts"
          subtitle="Started vs finished carts per supermarket (X-axis: carts)"
          heightClass="h-72"
          isEmpty={!hasTopSupermarkets}
          emptyLabel={t.analyticsNoDataYet}
          reducedMotion={reducedMotion}
        >
          {() => (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics.topSupermarketsByCarts}
                layout="vertical"
                margin={{ top: 6, right: 20, left: 10, bottom: 6 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="supermarketName"
                  width={115}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar
                  dataKey="cartsStarted"
                  name="Carts Started (carts)"
                  fill={COLORS.cartsStarted}
                  radius={[0, 4, 4, 0]}
                  isAnimationActive={!reducedMotion}
                  animationDuration={650}
                />
                <Bar
                  dataKey="cartsFinished"
                  name="Carts Finished (carts)"
                  fill={COLORS.cartsFinished}
                  radius={[0, 4, 4, 0]}
                  isAnimationActive={!reducedMotion}
                  animationDuration={750}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Most Scanned Products (By Name)"
          subtitle="Top scanned items across shopper carts (X-axis: units scanned)"
          heightClass="h-72"
          isEmpty={!hasTopProducts}
          emptyLabel={t.analyticsNoDataYet}
          reducedMotion={reducedMotion}
        >
          {() => (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics.mostScannedProducts}
                layout="vertical"
                margin={{ top: 6, right: 20, left: 10, bottom: 6 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="productName"
                  width={130}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  formatter={(val: any) => [`${Number(val).toLocaleString()} units`, 'Units Scanned']}
                />
                <Bar
                  dataKey="unitsScanned"
                  name="Units Scanned (items)"
                  fill={COLORS.products}
                  radius={[0, 4, 4, 0]}
                  isAnimationActive={!reducedMotion}
                  animationDuration={700}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Heatmap: Busiest Hour by Weekday */}
      <section
        ref={heatmapRef}
        className={`p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 transition-opacity ${
          reducedMotion ? 'opacity-100' : heatmapInView ? 'opacity-100 duration-300' : 'opacity-0'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Busiest Hour by Weekday (Heatmap)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Cart starts by day of week and hour of day (unit: carts per hour slot)
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span>Less</span>
            <span className="w-3.5 h-3.5 rounded-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700" />
            <span className="w-3.5 h-3.5 rounded-xs bg-emerald-100 dark:bg-emerald-900/70" />
            <span className="w-3.5 h-3.5 rounded-xs bg-emerald-300 dark:bg-emerald-700" />
            <span className="w-3.5 h-3.5 rounded-xs bg-emerald-500" />
            <span className="w-3.5 h-3.5 rounded-xs bg-emerald-600" />
            <span>More</span>
          </div>
        </div>

        {heatmapMax === 0 ? (
          <div className="h-44 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center px-4">
            <BarChart3 className="w-6 h-6 text-slate-400 dark:text-slate-500 mb-1.5" aria-hidden="true" />
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t.analyticsNoDataYet}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto pb-1">
            <div className="min-w-[640px] space-y-1.5">
              {/* Hour header */}
              <div className="grid grid-cols-[54px_repeat(24,minmax(0,1fr))] gap-1 items-center">
                <div className="text-[10px] font-semibold text-slate-400">Day / Hr</div>
                {Array.from({ length: 24 }).map((_, h) => (
                  <div
                    key={h}
                    className="text-center text-[10px] font-mono text-slate-400 tabular-nums"
                  >
                    {h % 2 === 0 ? String(h).padStart(2, '0') : ''}
                  </div>
                ))}
              </div>

              {analytics.activityHeatmap.map((row) => (
                <div
                  key={row.dayIndex}
                  className="grid grid-cols-[54px_repeat(24,minmax(0,1fr))] gap-1 items-center"
                >
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {row.shortDay}
                  </div>
                  {row.hours.map((cell) => (
                    <div
                      key={cell.hour}
                      title={`${row.dayName} · ${String(cell.hour).padStart(2, '0')}:00 — ${cell.count} cart(s)`}
                      className={`h-6 rounded-sm flex items-center justify-center text-[10px] font-mono tabular-nums transition-colors ${getHeatmapCellColor(
                        cell.count
                      )}`}
                    >
                      {cell.count > 0 ? cell.count : ''}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Barcode Scan Outcomes & Loyalty Points Issued vs Redeemed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Barcode Scan Outcomes (Success vs Failure)"
          subtitle={`${analytics.scanOutcomes.successes.toLocaleString()} succeeded · ${analytics.scanOutcomes.failures.toLocaleString()} failed · ${analytics.kpis.scanSuccessRatePct.value}% success rate`}
          heightClass="h-64"
          isEmpty={!hasScanEvents}
          emptyLabel={t.analyticsNoDataYet}
          reducedMotion={reducedMotion}
        >
          {() => (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics.scanOutcomes.overTime}
                margin={{ top: 10, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar
                  dataKey="successes"
                  name="Valid Scans (scans)"
                  fill={COLORS.scanSuccess}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={!reducedMotion}
                  animationDuration={650}
                />
                <Bar
                  dataKey="failures"
                  name="Failed Lookups (scans)"
                  fill={COLORS.scanFailure}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={!reducedMotion}
                  animationDuration={750}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Loyalty Points Issued vs Redeemed"
          subtitle={`Issued: ${analytics.kpis.loyaltyPointsIssued.value.toLocaleString()} pts · Redeemed: ${analytics.kpis.loyaltyPointsRedeemed.value.toLocaleString()} pts`}
          heightClass="h-64"
          isEmpty={!hasLoyaltySeries}
          emptyLabel={t.analyticsNoDataYet}
          reducedMotion={reducedMotion}
        >
          {() => (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics.loyaltyOverTime}
                margin={{ top: 10, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  width={42}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar
                  dataKey="issued"
                  name="Issued (pts)"
                  fill={COLORS.loyaltyIssued}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={!reducedMotion}
                  animationDuration={650}
                />
                <Bar
                  dataKey="redeemed"
                  name="Redeemed (pts)"
                  fill={COLORS.loyaltyRedeemed}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={!reducedMotion}
                  animationDuration={750}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Rewards Redeemed by Item & Support / Password Resets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Rewards Redeemed by Item"
          subtitle="Merchandise rewards claimed with loyalty points (X-axis: orders)"
          heightClass="h-64"
          isEmpty={!hasRewardItems}
          emptyLabel={t.analyticsNoDataYet}
          reducedMotion={reducedMotion}
        >
          {() => (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics.rewardsRedeemedByItem}
                layout="vertical"
                margin={{ top: 6, right: 20, left: 10, bottom: 6 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="rewardName"
                  width={130}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  formatter={(val: any, _name: any, item: any) => [
                    `${Number(val).toLocaleString()} orders (${Number(
                      item?.payload?.pointsRedeemed || 0
                    ).toLocaleString()} pts)`,
                    'Redeemed',
                  ]}
                />
                <Bar
                  dataKey="redemptionsCount"
                  name="Redemptions (orders)"
                  fill={COLORS.rewards}
                  radius={[0, 4, 4, 0]}
                  isAnimationActive={!reducedMotion}
                  animationDuration={700}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Password-Reset Requests & Support Tickets"
          subtitle="Open vs closed volume across support channels (Y-axis: tickets)"
          heightClass="h-64"
          isEmpty={!hasSupportData}
          emptyLabel={t.analyticsNoDataYet}
          reducedMotion={reducedMotion}
        >
          {() => (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={supportChartData}
                margin={{ top: 10, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar
                  dataKey="open"
                  name="Open (tickets)"
                  fill={COLORS.supportOpen}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={!reducedMotion}
                  animationDuration={650}
                />
                <Bar
                  dataKey="closed"
                  name="Closed (tickets)"
                  fill={COLORS.supportClosed}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={!reducedMotion}
                  animationDuration={750}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Security Panel: Sign-In Failures & Lockouts Per Day */}
      <ChartCard
        title={t.analyticsSecurityPanelTitle}
        subtitle="Daily aggregated sign-in failures and temporary account lockouts across portals (Y-axis: events/day)"
        heightClass="h-64"
        isEmpty={!hasSecuritySeries}
        emptyLabel={t.analyticsNoDataYet}
        reducedMotion={reducedMotion}
        headerRight={
          <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums">
            <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
              <ShieldAlert className="w-4 h-4 text-amber-500" aria-hidden="true" />
              <span>
                Failures:{' '}
                <strong className="text-slate-900 dark:text-white">
                  {analytics.securitySummary.totalFailures.toLocaleString()}
                </strong>
              </span>
            </div>
            <div className="text-slate-700 dark:text-slate-300">
              Lockouts:{' '}
              <strong className="text-rose-600 dark:text-rose-400">
                {analytics.securitySummary.totalLockouts.toLocaleString()}
              </strong>
            </div>
            <div className="text-slate-700 dark:text-slate-300">
              Active Locks:{' '}
              <strong className="text-slate-900 dark:text-white">
                {analytics.securitySummary.currentlyLockedAccounts.toLocaleString()}
              </strong>
            </div>
          </div>
        }
      >
        {() => (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={analytics.securitySummary.perDay}
              margin={{ top: 10, right: 16, left: 0, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar
                dataKey="failures"
                name="Sign-In Failures (events)"
                fill={COLORS.secFailure}
                radius={[4, 4, 0, 0]}
                isAnimationActive={!reducedMotion}
                animationDuration={650}
              />
              <Bar
                dataKey="lockouts"
                name="Account Lockouts (events)"
                fill={COLORS.secLockout}
                radius={[4, 4, 0, 0]}
                isAnimationActive={!reducedMotion}
                animationDuration={750}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
};
