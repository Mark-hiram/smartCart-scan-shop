// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import {
  AdminAnalyticsPayload,
  AnalyticsKpiMetric,
  AnalyticsRange,
  Cart,
} from '../types';
import { DatabaseSchema } from './db';

export const VALID_ANALYTICS_RANGES: readonly AnalyticsRange[] = [
  'today',
  '7d',
  '30d',
  '90d',
  'year',
] as const;

const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 120;

const analyticsCache = new Map<
  string,
  { expiresAt: number; payload: AdminAnalyticsPayload }
>();

export function clearAnalyticsCache(): void {
  analyticsCache.clear();
}

export function normalizeAnalyticsRange(raw?: unknown): AnalyticsRange | null {
  if (raw === undefined || raw === null || raw === '') return '30d';
  if (typeof raw !== 'string') return null;
  const clean = raw.trim().toLowerCase();
  if (
    clean === 'today' ||
    clean === '7d' ||
    clean === '30d' ||
    clean === '90d' ||
    clean === 'year'
  ) {
    return clean;
  }
  return null;
}

interface TimeWindow {
  currentStart: number;
  currentEnd: number;
  prevStart: number;
  prevEnd: number;
}

function getTimeWindow(range: AnalyticsRange, nowMs: number): TimeWindow {
  const now = new Date(nowMs);
  const DAY_MS = 24 * 60 * 60 * 1000;

  if (range === 'today') {
    const startToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    ).getTime();
    const startYesterday = startToday - DAY_MS;
    return {
      currentStart: startToday,
      currentEnd: nowMs,
      prevStart: startYesterday,
      prevEnd: startToday - 1,
    };
  }

  if (range === 'year') {
    const startYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0).getTime();
    const prevYearStart = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0, 0).getTime();
    return {
      currentStart: startYear,
      currentEnd: nowMs,
      prevStart: prevYearStart,
      prevEnd: startYear - 1,
    };
  }

  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const currentStart = nowMs - days * DAY_MS;
  return {
    currentStart,
    currentEnd: nowMs,
    prevStart: currentStart - days * DAY_MS,
    prevEnd: currentStart - 1,
  };
}

interface BucketSpec {
  key: string;
  label: string;
}

function formatDayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatShortDate(ts: number): string {
  const d = new Date(ts);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function formatMonthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function buildActivityBuckets(
  range: AnalyticsRange,
  startMs: number,
  endMs: number
): {
  buckets: BucketSpec[];
  keyForTimestamp: (ts: number) => string;
} {
  const buckets: BucketSpec[] = [];

  if (range === 'today') {
    const endHour = new Date(endMs).getHours();
    for (let h = 0; h <= endHour; h++) {
      const key = String(h).padStart(2, '0');
      buckets.push({ key, label: `${key}:00` });
    }
    return {
      buckets,
      keyForTimestamp: (ts: number) => String(new Date(ts).getHours()).padStart(2, '0'),
    };
  }

  if (range === 'year') {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const startYear = new Date(startMs).getFullYear();
    const endMonth = new Date(endMs).getMonth();
    for (let m = 0; m <= endMonth; m++) {
      const key = `${startYear}-${String(m + 1).padStart(2, '0')}`;
      buckets.push({ key, label: months[m] });
    }
    return {
      buckets,
      keyForTimestamp: (ts: number) => formatMonthKey(ts),
    };
  }

  if (range === '90d') {
    // Weekly buckets (start of each 7-day block across the 90-day window)
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const totalWeeks = Math.ceil((endMs - startMs) / WEEK_MS) || 1;
    for (let w = 0; w < totalWeeks; w++) {
      const wTs = startMs + w * WEEK_MS;
      buckets.push({ key: String(w), label: formatShortDate(wTs) });
    }
    return {
      buckets,
      keyForTimestamp: (ts: number) => {
        const idx = Math.max(0, Math.min(totalWeeks - 1, Math.floor((ts - startMs) / WEEK_MS)));
        return String(idx);
      },
    };
  }

  // '7d' or '30d': daily buckets
  const DAY_MS = 24 * 60 * 60 * 1000;
  const startDay = new Date(startMs);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(endMs);
  endDay.setHours(0, 0, 0, 0);
  const seen = new Set<string>();
  for (let t = startDay.getTime(); t <= endDay.getTime(); t += DAY_MS) {
    const key = formatDayKey(t);
    if (!seen.has(key)) {
      seen.add(key);
      buckets.push({ key, label: formatShortDate(t) });
    }
  }
  return {
    buckets,
    keyForTimestamp: (ts: number) => formatDayKey(ts),
  };
}

function buildDailyBuckets(startMs: number, endMs: number): BucketSpec[] {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const startDay = new Date(startMs);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(endMs);
  endDay.setHours(0, 0, 0, 0);
  const out: BucketSpec[] = [];
  const seen = new Set<string>();
  for (let t = startDay.getTime(); t <= endDay.getTime(); t += DAY_MS) {
    const key = formatDayKey(t);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ key, label: formatShortDate(t) });
    }
  }
  return out;
}

function computeChangePct(current: number, previous: number): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function buildKpi(
  value: number,
  previous: number,
  sparkline: number[]
): AnalyticsKpiMetric {
  return {
    value,
    previous,
    changePct: computeChangePct(value, previous),
    sparkline,
  };
}

function isCartFinished(cart: Cart): boolean {
  return (
    cart.status === 'locked' ||
    cart.status === 'verified' ||
    cart.status === 'completed'
  );
}

function isSupportTicketClosed(status: string): boolean {
  return status === 'completed' || status === 'resolved' || status === 'rejected';
}

export function getAdminAnalytics(
  data: DatabaseSchema,
  options: {
    range?: AnalyticsRange;
    supermarketId?: string | null;
    branchId?: string | null;
    nowMs?: number;
  } = {}
): AdminAnalyticsPayload {
  const range: AnalyticsRange = options.range || '30d';
  const branchId = options.branchId ? options.branchId.trim() : null;
  let supermarketId = options.supermarketId ? options.supermarketId.trim() : null;

  // If a branch filter is chosen, derive its supermarket cleanly
  if (branchId && !supermarketId) {
    const matchedBranch = data.branches.find((b) => b.id === branchId);
    if (matchedBranch) {
      supermarketId = matchedBranch.supermarketId;
    }
  }

  const cacheKey = `${range}|${supermarketId || 'all'}|${branchId || 'all'}`;
  const nowMs = options.nowMs ?? Date.now();
  const cachedEntry = analyticsCache.get(cacheKey);
  if (cachedEntry && cachedEntry.expiresAt > nowMs && options.nowMs === undefined) {
    return cachedEntry.payload;
  }

  const { currentStart, currentEnd, prevStart, prevEnd } = getTimeWindow(range, nowMs);

  const { buckets, keyForTimestamp } = buildActivityBuckets(range, currentStart, currentEnd);
  const bucketIndexByKey = new Map<string, number>();
  buckets.forEach((b, idx) => bucketIndexByKey.set(b.key, idx));

  const activitySeries = buckets.map((b) => ({
    bucketKey: b.key,
    label: b.label,
    signups: 0,
    cartsStarted: 0,
    cartsFinished: 0,
    itemsScanned: 0,
    cartValueSum: 0,
    cartsWithValueCount: 0,
    avgCartValueKes: 0,
  }));

  const scanSeries = buckets.map((b) => ({
    bucketKey: b.key,
    label: b.label,
    successes: 0,
    failures: 0,
  }));

  const loyaltySeries = buckets.map((b) => ({
    bucketKey: b.key,
    label: b.label,
    issued: 0,
    redeemed: 0,
  }));

  const activeShoppersSpark = new Array<Set<string>>(buckets.length)
    .fill(null as any)
    .map(() => new Set<string>());

  // Branch filter set
  const scopedBranches = data.branches.filter((b) => {
    if (branchId && b.id !== branchId) return false;
    if (supermarketId && b.supermarketId !== supermarketId) return false;
    return true;
  });
  const scopedBranchIdSet = new Set(scopedBranches.map((b) => b.id));

  const scopedSupermarkets = data.supermarkets.filter((s) => {
    if (supermarketId && s.id !== supermarketId) return false;
    return true;
  });

  const supermarketNameById = new Map<string, string>();
  for (const s of data.supermarkets) {
    supermarketNameById.set(s.id, s.name);
  }

  const matchesScope = (itemSmId?: string | null, itemBrId?: string | null): boolean => {
    if (branchId) return itemBrId === branchId;
    if (supermarketId) {
      if (itemSmId) return itemSmId === supermarketId;
      if (itemBrId) return scopedBranchIdSet.has(itemBrId);
      return false;
    }
    return true;
  };

  // 1. Organization counts
  const smCounts = {
    total: scopedSupermarkets.length,
    active: 0,
    pending: 0,
    suspended: 0,
    rejected: 0,
  };
  for (const sm of scopedSupermarkets) {
    if (sm.status === 'active') smCounts.active += 1;
    else if (sm.status === 'pending') smCounts.pending += 1;
    else if (sm.status === 'suspended') smCounts.suspended += 1;
    else if (sm.status === 'rejected') smCounts.rejected += 1;
  }

  const branchCounts = {
    total: scopedBranches.length,
    active: 0,
    inactive: 0,
  };
  for (const br of scopedBranches) {
    if (br.isActive) branchCounts.active += 1;
    else branchCounts.inactive += 1;
  }

  // 2. Shopper sign-ups
  let currentSignups = 0;
  let prevSignups = 0;
  for (const u of data.users) {
    if (u.role !== 'shopper') continue;
    const ts = Date.parse(u.createdAt);
    if (!Number.isFinite(ts)) continue;
    if (ts >= currentStart && ts <= currentEnd) {
      currentSignups += 1;
      const bIdx = bucketIndexByKey.get(keyForTimestamp(ts));
      if (bIdx !== undefined) {
        activitySeries[bIdx].signups += 1;
      }
    } else if (ts >= prevStart && ts <= prevEnd) {
      prevSignups += 1;
    }
  }

  // 3. Carts, Top Supermarkets, Busiest Hours/Days, Heatmap, Most Scanned Products
  const activeShopperIdsCurrent = new Set<string>();
  const activeShopperIdsPrev = new Set<string>();

  let currentCartsStarted = 0;
  let prevCartsStarted = 0;
  let currentCartsFinished = 0;
  let prevCartsFinished = 0;
  let currentCartsInProgress = 0;

  let currentItemsScanned = 0;
  let prevItemsScanned = 0;

  let currentCartValueSum = 0;
  let currentCartsWithItems = 0;
  let prevCartValueSum = 0;
  let prevCartsWithItems = 0;

  const hourCounts = new Array<number>(24).fill(0);
  const dayCounts = new Array<number>(7).fill(0);
  const heatmapMatrix: number[][] = Array.from({ length: 7 }, () =>
    new Array<number>(24).fill(0)
  );

  const smCartStats = new Map<
    string,
    {
      supermarketName: string;
      cartsStarted: number;
      cartsFinished: number;
      itemsScanned: number;
      totalCartValueKes: number;
      cartsWithItems: number;
    }
  >();

  const productScanAgg = new Map<
    string,
    { productName: string; unitsScanned: number; cartAppearances: number }
  >();

  for (const c of data.carts) {
    if (!matchesScope(c.supermarketId, c.branchId)) continue;
    const ts = Date.parse(c.createdAt);
    if (!Number.isFinite(ts)) continue;

    const finished = isCartFinished(c);
    const itemsInCart = Array.isArray(c.items)
      ? c.items.reduce((sum, it) => sum + (it.quantity || 0), 0)
      : 0;
    const cartVal = typeof c.finalTotal === 'number' && c.finalTotal > 0 ? c.finalTotal : 0;

    if (ts >= currentStart && ts <= currentEnd) {
      currentCartsStarted += 1;
      if (finished) currentCartsFinished += 1;
      else currentCartsInProgress += 1;

      currentItemsScanned += itemsInCart;
      if (itemsInCart > 0 || cartVal > 0) {
        currentCartValueSum += cartVal;
        currentCartsWithItems += 1;
      }
      if (c.shopperId) {
        activeShopperIdsCurrent.add(c.shopperId);
      }

      const d = new Date(ts);
      const hr = d.getHours();
      const dow = d.getDay();
      hourCounts[hr] += 1;
      dayCounts[dow] += 1;
      heatmapMatrix[dow][hr] += 1;

      const bIdx = bucketIndexByKey.get(keyForTimestamp(ts));
      if (bIdx !== undefined) {
        const b = activitySeries[bIdx];
        b.cartsStarted += 1;
        if (finished) b.cartsFinished += 1;
        b.itemsScanned += itemsInCart;
        if (itemsInCart > 0 || cartVal > 0) {
          b.cartValueSum += cartVal;
          b.cartsWithValueCount += 1;
        }
        if (c.shopperId) {
          activeShoppersSpark[bIdx].add(c.shopperId);
        }
      }

      // Supermarket ranking
      const smName = supermarketNameById.get(c.supermarketId) || 'Unknown Store';
      const existingSm = smCartStats.get(c.supermarketId) || {
        supermarketName: smName,
        cartsStarted: 0,
        cartsFinished: 0,
        itemsScanned: 0,
        totalCartValueKes: 0,
        cartsWithItems: 0,
      };
      existingSm.cartsStarted += 1;
      if (finished) existingSm.cartsFinished += 1;
      existingSm.itemsScanned += itemsInCart;
      if (itemsInCart > 0 || cartVal > 0) {
        existingSm.totalCartValueKes += cartVal;
        existingSm.cartsWithItems += 1;
      }
      smCartStats.set(c.supermarketId, existingSm);

      // Most scanned products by name only (no barcodes, SKUs, or shopper data)
      const seenNamesInCart = new Set<string>();
      for (const item of c.items || []) {
        const cleanName = (item.name || '').trim();
        if (!cleanName) continue;
        const entry = productScanAgg.get(cleanName) || {
          productName: cleanName,
          unitsScanned: 0,
          cartAppearances: 0,
        };
        entry.unitsScanned += item.quantity || 1;
        if (!seenNamesInCart.has(cleanName)) {
          entry.cartAppearances += 1;
          seenNamesInCart.add(cleanName);
        }
        productScanAgg.set(cleanName, entry);
      }
    } else if (ts >= prevStart && ts <= prevEnd) {
      prevCartsStarted += 1;
      if (finished) prevCartsFinished += 1;
      prevItemsScanned += itemsInCart;
      if (itemsInCart > 0 || cartVal > 0) {
        prevCartValueSum += cartVal;
        prevCartsWithItems += 1;
      }
      if (c.shopperId) {
        activeShopperIdsPrev.add(c.shopperId);
      }
    }
  }

  for (const b of activitySeries) {
    b.avgCartValueKes =
      b.cartsWithValueCount > 0 ? Math.round(b.cartValueSum / b.cartsWithValueCount) : 0;
  }

  const currentAvgCartValue =
    currentCartsWithItems > 0 ? Math.round(currentCartValueSum / currentCartsWithItems) : 0;
  const prevAvgCartValue =
    prevCartsWithItems > 0 ? Math.round(prevCartValueSum / prevCartsWithItems) : 0;

  // 4. Barcode scan successes vs failures
  let currentScanSuccess = 0;
  let currentScanFailure = 0;
  let prevScanSuccess = 0;
  let prevScanFailure = 0;

  for (const ev of data.scanEvents || []) {
    if (!matchesScope(ev.supermarketId, ev.branchId)) continue;
    const ts = Date.parse(ev.createdAt);
    if (!Number.isFinite(ts)) continue;
    if (ts >= currentStart && ts <= currentEnd) {
      if (ev.success) currentScanSuccess += 1;
      else currentScanFailure += 1;
      const bIdx = bucketIndexByKey.get(keyForTimestamp(ts));
      if (bIdx !== undefined) {
        if (ev.success) scanSeries[bIdx].successes += 1;
        else scanSeries[bIdx].failures += 1;
      }
    } else if (ts >= prevStart && ts <= prevEnd) {
      if (ev.success) prevScanSuccess += 1;
      else prevScanFailure += 1;
    }
  }

  const totalScansCurrent = currentScanSuccess + currentScanFailure;
  const totalScansPrev = prevScanSuccess + prevScanFailure;
  const scanSuccessRateCurrent =
    totalScansCurrent > 0
      ? Math.round((currentScanSuccess / totalScansCurrent) * 1000) / 10
      : 0;
  const scanSuccessRatePrev =
    totalScansPrev > 0
      ? Math.round((prevScanSuccess / totalScansPrev) * 1000) / 10
      : 0;

  // 5. Loyalty Points Issued vs Redeemed & Rewards Redeemed by Item
  let currentPointsIssued = 0;
  let prevPointsIssued = 0;
  let currentPointsRedeemed = 0;
  let prevPointsRedeemed = 0;

  for (const entry of data.loyaltyLedger || []) {
    if (!matchesScope(entry.supermarketId, entry.branchId)) continue;
    const ts = Date.parse(entry.createdAt);
    if (!Number.isFinite(ts)) continue;

    let issuedDelta = 0;
    let redeemedDelta = 0;
    if (entry.type === 'earn') issuedDelta = entry.amount;
    else if (entry.type === 'reversal') issuedDelta = entry.amount; // negative value reduces net issued
    else if (entry.type === 'redemption_reserve') redeemedDelta = Math.abs(entry.amount);
    else if (entry.type === 'redemption_refund') redeemedDelta = -Math.abs(entry.amount);

    if (ts >= currentStart && ts <= currentEnd) {
      currentPointsIssued += issuedDelta;
      currentPointsRedeemed += redeemedDelta;
      const bIdx = bucketIndexByKey.get(keyForTimestamp(ts));
      if (bIdx !== undefined) {
        loyaltySeries[bIdx].issued += issuedDelta;
        loyaltySeries[bIdx].redeemed += redeemedDelta;
      }
    } else if (ts >= prevStart && ts <= prevEnd) {
      prevPointsIssued += issuedDelta;
      prevPointsRedeemed += redeemedDelta;
    }
  }

  currentPointsIssued = Math.max(0, currentPointsIssued);
  currentPointsRedeemed = Math.max(0, currentPointsRedeemed);
  prevPointsIssued = Math.max(0, prevPointsIssued);
  prevPointsRedeemed = Math.max(0, prevPointsRedeemed);

  const rewardAgg = new Map<
    string,
    { rewardName: string; redemptionsCount: number; pointsRedeemed: number }
  >();
  for (const ord of data.rewardRedemptions || []) {
    if (ord.status === 'cancelled') continue;
    if (branchId && ord.branchId !== branchId) continue;
    if (supermarketId && !branchId) {
      const targetSmName = supermarketNameById.get(supermarketId);
      const matchesBranch = ord.branchId ? scopedBranchIdSet.has(ord.branchId) : false;
      const matchesSmName = targetSmName ? ord.supermarketName === targetSmName : false;
      if (!matchesBranch && !matchesSmName) continue;
    }

    const ts = Date.parse(ord.createdAt);
    if (!Number.isFinite(ts) || ts < currentStart || ts > currentEnd) continue;

    const cleanRewardName = (ord.rewardName || 'Reward Item').trim();
    const cur = rewardAgg.get(cleanRewardName) || {
      rewardName: cleanRewardName,
      redemptionsCount: 0,
      pointsRedeemed: 0,
    };
    cur.redemptionsCount += 1;
    cur.pointsRedeemed += ord.pointsCost || 0;
    rewardAgg.set(cleanRewardName, cur);
  }

  // 6. Password-reset requests & Support tickets (open vs closed)
  const passwordResetRequests = { total: 0, open: 0, closed: 0 };
  const supportTicketsSummary = { total: 0, open: 0, closed: 0 };

  for (const ticket of data.supportTickets || []) {
    const ts = Date.parse(ticket.createdAt);
    if (!Number.isFinite(ts) || ts < currentStart || ts > currentEnd) continue;

    const closed = isSupportTicketClosed(ticket.status);
    if (ticket.category === 'password_reset') {
      passwordResetRequests.total += 1;
      if (closed) passwordResetRequests.closed += 1;
      else passwordResetRequests.open += 1;
    } else {
      supportTicketsSummary.total += 1;
      if (closed) supportTicketsSummary.closed += 1;
      else supportTicketsSummary.open += 1;
    }
  }

  // 7. Security: Sign-in failures and lockouts per day
  const dailySecurityBuckets = buildDailyBuckets(currentStart, currentEnd);
  const secDayIndex = new Map<string, number>();
  dailySecurityBuckets.forEach((b, idx) => secDayIndex.set(b.key, idx));
  const secPerDay = dailySecurityBuckets.map((b) => ({
    date: b.key,
    label: b.label,
    failures: 0,
    lockouts: 0,
  }));

  const portalMap = new Map<string, { failures: number; lockouts: number }>([
    ['shopper', { failures: 0, lockouts: 0 }],
    ['staff', { failures: 0, lockouts: 0 }],
    ['management', { failures: 0, lockouts: 0 }],
    ['admin', { failures: 0, lockouts: 0 }],
  ]);

  let currentFailures = 0;
  let currentLockouts = 0;
  let prevSecurityTotal = 0;

  for (const sev of data.securityEvents || []) {
    const ts = Date.parse(sev.createdAt);
    if (!Number.isFinite(ts)) continue;
    if (ts >= currentStart && ts <= currentEnd) {
      if (sev.type === 'login_failure') currentFailures += 1;
      else if (sev.type === 'lockout') currentLockouts += 1;

      const dIdx = secDayIndex.get(formatDayKey(ts));
      if (dIdx !== undefined) {
        if (sev.type === 'login_failure') secPerDay[dIdx].failures += 1;
        else if (sev.type === 'lockout') secPerDay[dIdx].lockouts += 1;
      }

      const pKey = portalMap.has(sev.portal) ? sev.portal : 'shopper';
      const pEntry = portalMap.get(pKey)!;
      if (sev.type === 'login_failure') pEntry.failures += 1;
      else if (sev.type === 'lockout') pEntry.lockouts += 1;
    } else if (ts >= prevStart && ts <= prevEnd) {
      prevSecurityTotal += 1;
    }
  }

  const currentlyLockedAccounts = data.users.filter(
    (u) => typeof u.lockedUntil === 'number' && u.lockedUntil > nowMs
  ).length;

  // Build day & hour series cleanly (Monday-Sunday ordering for heatmap clarity, matching standard calendar weeks)
  const FULL_DAY_NAMES = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

  const busiestHours = hourCounts.map((count, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    cartsCount: count,
  }));

  const busiestDays = WEEK_ORDER.map((dow) => ({
    dayIndex: dow,
    dayName: FULL_DAY_NAMES[dow],
    shortDay: SHORT_DAY_NAMES[dow],
    cartsCount: dayCounts[dow],
  }));

  const activityHeatmap = WEEK_ORDER.map((dow) => ({
    dayIndex: dow,
    dayName: FULL_DAY_NAMES[dow],
    shortDay: SHORT_DAY_NAMES[dow],
    hours: heatmapMatrix[dow].map((count, hour) => ({ hour, count })),
  }));

  const topSupermarketsByCarts = Array.from(smCartStats.values())
    .map((entry) => ({
      supermarketName: entry.supermarketName,
      cartsStarted: entry.cartsStarted,
      cartsFinished: entry.cartsFinished,
      itemsScanned: entry.itemsScanned,
      avgCartValueKes:
        entry.cartsWithItems > 0
          ? Math.round(entry.totalCartValueKes / entry.cartsWithItems)
          : 0,
      totalCartValueKes: Math.round(entry.totalCartValueKes),
    }))
    .sort((a, b) => b.cartsStarted - a.cartsStarted || b.itemsScanned - a.itemsScanned)
    .slice(0, 8);

  const mostScannedProducts = Array.from(productScanAgg.values())
    .sort((a, b) => b.unitsScanned - a.unitsScanned)
    .slice(0, 10);

  const rewardsRedeemedByItem = Array.from(rewardAgg.values())
    .sort((a, b) => b.redemptionsCount - a.redemptionsCount || b.pointsRedeemed - a.pointsRedeemed)
    .slice(0, 10);

  // Build security sparkline aligned to activity buckets (collapse per-day or bucket directly)
  const secSparkline = new Array<number>(buckets.length).fill(0);
  for (const sev of data.securityEvents || []) {
    const ts = Date.parse(sev.createdAt);
    if (Number.isFinite(ts) && ts >= currentStart && ts <= currentEnd) {
      const bIdx = bucketIndexByKey.get(keyForTimestamp(ts));
      if (bIdx !== undefined) secSparkline[bIdx] += 1;
    }
  }

  const payload: AdminAnalyticsPayload = {
    meta: {
      range,
      supermarketId,
      branchId,
      startIso: new Date(currentStart).toISOString(),
      endIso: new Date(currentEnd).toISOString(),
    },
    filterOptions: {
      supermarkets: data.supermarkets.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
      })),
      branches: data.branches.map((b) => ({
        id: b.id,
        supermarketId: b.supermarketId,
        name: b.name,
        isActive: b.isActive,
      })),
    },
    kpis: {
      activeShoppers: buildKpi(
        activeShopperIdsCurrent.size,
        activeShopperIdsPrev.size,
        activeShoppersSpark.map((s) => s.size)
      ),
      newSignups: buildKpi(
        currentSignups,
        prevSignups,
        activitySeries.map((b) => b.signups)
      ),
      cartsStarted: buildKpi(
        currentCartsStarted,
        prevCartsStarted,
        activitySeries.map((b) => b.cartsStarted)
      ),
      cartsFinished: buildKpi(
        currentCartsFinished,
        prevCartsFinished,
        activitySeries.map((b) => b.cartsFinished)
      ),
      itemsScanned: buildKpi(
        currentItemsScanned,
        prevItemsScanned,
        activitySeries.map((b) => b.itemsScanned)
      ),
      averageCartValueKes: buildKpi(
        currentAvgCartValue,
        prevAvgCartValue,
        activitySeries.map((b) => b.avgCartValueKes)
      ),
      loyaltyPointsIssued: buildKpi(
        currentPointsIssued,
        prevPointsIssued,
        loyaltySeries.map((b) => Math.max(0, b.issued))
      ),
      loyaltyPointsRedeemed: buildKpi(
        currentPointsRedeemed,
        prevPointsRedeemed,
        loyaltySeries.map((b) => Math.max(0, b.redeemed))
      ),
      scanSuccessRatePct: {
        ...buildKpi(
          scanSuccessRateCurrent,
          scanSuccessRatePrev,
          scanSeries.map((b) => {
            const t = b.successes + b.failures;
            return t > 0 ? Math.round((b.successes / t) * 100) : 0;
          })
        ),
        successes: currentScanSuccess,
        failures: currentScanFailure,
      },
      securityEventsCount: {
        ...buildKpi(
          currentFailures + currentLockouts,
          prevSecurityTotal,
          secSparkline
        ),
        failures: currentFailures,
        lockouts: currentLockouts,
      },
    },
    organizationCounts: {
      supermarkets: smCounts,
      branches: branchCounts,
    },
    supermarketStatusSeries: [
      { status: 'active', label: 'Active', count: smCounts.active },
      { status: 'pending', label: 'Pending', count: smCounts.pending },
      { status: 'suspended', label: 'Suspended', count: smCounts.suspended },
    ],
    cartCompletionSeries: [
      { key: 'finished', label: 'Finished', count: currentCartsFinished },
      { key: 'in_progress', label: 'In Progress / Open', count: currentCartsInProgress },
    ],
    activityOverTime: activitySeries.map((b) => ({
      bucketKey: b.bucketKey,
      label: b.label,
      signups: b.signups,
      cartsStarted: b.cartsStarted,
      cartsFinished: b.cartsFinished,
      itemsScanned: b.itemsScanned,
      avgCartValueKes: b.avgCartValueKes,
    })),
    topSupermarketsByCarts,
    busiestHours,
    busiestDays,
    activityHeatmap,
    mostScannedProducts,
    scanOutcomes: {
      successes: currentScanSuccess,
      failures: currentScanFailure,
      overTime: scanSeries,
    },
    loyaltyOverTime: loyaltySeries.map((b) => ({
      bucketKey: b.bucketKey,
      label: b.label,
      issued: Math.max(0, b.issued),
      redeemed: Math.max(0, b.redeemed),
    })),
    rewardsRedeemedByItem,
    supportSummary: {
      passwordResetRequests,
      supportTickets: supportTicketsSummary,
    },
    securitySummary: {
      totalFailures: currentFailures,
      totalLockouts: currentLockouts,
      currentlyLockedAccounts,
      byPortal: Array.from(portalMap.entries()).map(([portal, stats]) => ({
        portal,
        failures: stats.failures,
        lockouts: stats.lockouts,
      })),
      perDay: secPerDay,
    },
  };

  if (options.nowMs === undefined) {
    if (analyticsCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = analyticsCache.keys().next().value;
      if (oldestKey) analyticsCache.delete(oldestKey);
    }
    analyticsCache.set(cacheKey, {
      expiresAt: nowMs + CACHE_TTL_MS,
      payload,
    });
  }

  return payload;
}

function sanitizeCsvCell(raw: string | number): string {
  const str = String(raw ?? '');
  const trimmed = str.trimStart();
  const safe =
    trimmed.startsWith('=') ||
    trimmed.startsWith('+') ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('@') ||
    trimmed.startsWith('\t') ||
    trimmed.startsWith('\r')
      ? `'${str}`
      : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildAnalyticsCsv(payload: AdminAnalyticsPayload): string {
  const rows: string[] = ['section,metric,period_or_category,value,unit'];
  const pushRow = (
    section: string,
    metric: string,
    category: string,
    value: string | number,
    unit: string
  ) => {
    rows.push(
      [
        sanitizeCsvCell(section),
        sanitizeCsvCell(metric),
        sanitizeCsvCell(category),
        sanitizeCsvCell(value),
        sanitizeCsvCell(unit),
      ].join(',')
    );
  };

  // KPIs
  pushRow('KPIs', 'Active Shoppers', payload.meta.range, payload.kpis.activeShoppers.value, 'shoppers');
  pushRow('KPIs', 'New Sign-Ups', payload.meta.range, payload.kpis.newSignups.value, 'accounts');
  pushRow('KPIs', 'Carts Started', payload.meta.range, payload.kpis.cartsStarted.value, 'carts');
  pushRow('KPIs', 'Carts Finished', payload.meta.range, payload.kpis.cartsFinished.value, 'carts');
  pushRow('KPIs', 'Items Scanned', payload.meta.range, payload.kpis.itemsScanned.value, 'items');
  pushRow('KPIs', 'Average Cart Value', payload.meta.range, payload.kpis.averageCartValueKes.value, 'KES (cart value)');
  pushRow('KPIs', 'Loyalty Points Issued', payload.meta.range, payload.kpis.loyaltyPointsIssued.value, 'points');
  pushRow('KPIs', 'Loyalty Points Redeemed', payload.meta.range, payload.kpis.loyaltyPointsRedeemed.value, 'points');
  pushRow('KPIs', 'Barcode Scan Successes', payload.meta.range, payload.scanOutcomes.successes, 'scans');
  pushRow('KPIs', 'Barcode Scan Failures', payload.meta.range, payload.scanOutcomes.failures, 'scans');

  // Supermarkets & Branches
  pushRow('Organizations', 'Supermarkets Active', 'all', payload.organizationCounts.supermarkets.active, 'chains');
  pushRow('Organizations', 'Supermarkets Pending', 'all', payload.organizationCounts.supermarkets.pending, 'chains');
  pushRow('Organizations', 'Supermarkets Suspended', 'all', payload.organizationCounts.supermarkets.suspended, 'chains');
  pushRow('Organizations', 'Branches Active', 'all', payload.organizationCounts.branches.active, 'branches');
  pushRow('Organizations', 'Branches Inactive', 'all', payload.organizationCounts.branches.inactive, 'branches');

  // Activity Over Time
  for (const pt of payload.activityOverTime) {
    pushRow('Activity Timeline', 'New Sign-Ups', pt.label, pt.signups, 'accounts');
    pushRow('Activity Timeline', 'Carts Started', pt.label, pt.cartsStarted, 'carts');
    pushRow('Activity Timeline', 'Carts Finished', pt.label, pt.cartsFinished, 'carts');
    pushRow('Activity Timeline', 'Items Scanned', pt.label, pt.itemsScanned, 'items');
    pushRow('Activity Timeline', 'Average Cart Value', pt.label, pt.avgCartValueKes, 'KES (cart value)');
  }

  // Top Supermarkets
  for (const sm of payload.topSupermarketsByCarts) {
    pushRow('Top Supermarkets', 'Carts Started', sm.supermarketName, sm.cartsStarted, 'carts');
    pushRow('Top Supermarkets', 'Carts Finished', sm.supermarketName, sm.cartsFinished, 'carts');
    pushRow('Top Supermarkets', 'Average Cart Value', sm.supermarketName, sm.avgCartValueKes, 'KES (cart value)');
  }

  // Most Scanned Products (by name only)
  for (const prod of payload.mostScannedProducts) {
    pushRow('Most Scanned Products', 'Units Scanned', prod.productName, prod.unitsScanned, 'items');
  }

  // Rewards Redeemed by Item
  for (const rew of payload.rewardsRedeemedByItem) {
    pushRow('Rewards Redeemed', rew.rewardName, 'redemptions', rew.redemptionsCount, 'orders');
    pushRow('Rewards Redeemed', rew.rewardName, 'points_used', rew.pointsRedeemed, 'points');
  }

  // Support & Password Resets
  pushRow('Support', 'Password Reset Requests Open', payload.meta.range, payload.supportSummary.passwordResetRequests.open, 'requests');
  pushRow('Support', 'Password Reset Requests Closed', payload.meta.range, payload.supportSummary.passwordResetRequests.closed, 'requests');
  pushRow('Support', 'Support Tickets Open', payload.meta.range, payload.supportSummary.supportTickets.open, 'tickets');
  pushRow('Support', 'Support Tickets Closed', payload.meta.range, payload.supportSummary.supportTickets.closed, 'tickets');

  // Security per Day
  for (const sec of payload.securitySummary.perDay) {
    if (sec.failures > 0 || sec.lockouts > 0) {
      pushRow('Security', 'Sign-In Failures', sec.date, sec.failures, 'events');
      pushRow('Security', 'Account Lockouts', sec.date, sec.lockouts, 'events');
    }
  }

  return rows.join('\n');
}
