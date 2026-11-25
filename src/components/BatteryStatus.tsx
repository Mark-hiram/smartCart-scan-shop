// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useState, useEffect } from 'react';
import { BatteryCharging, BatteryFull, BatteryMedium, BatteryLow, BatteryWarning, Zap } from 'lucide-react';
import { useTranslation } from '../utils/i18n';

interface BatteryManager extends EventTarget {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
}

export interface BatteryStatusState {
  supported: boolean;
  loading: boolean;
  level: number | null;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}

function formatDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes <= 0) return '<1m';
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function useBatteryStatus(): BatteryStatusState {
  const [state, setState] = useState<BatteryStatusState>({
    supported: true,
    loading: true,
    level: null,
    charging: false,
    chargingTime: Infinity,
    dischargingTime: Infinity,
  });

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    if (typeof nav.getBattery !== 'function') {
      setState((prev) => ({ ...prev, supported: false, loading: false }));
      return;
    }

    let batteryRef: BatteryManager | null = null;
    let cancelled = false;

    const syncState = (bm: BatteryManager) => {
      if (cancelled) return;
      setState({
        supported: true,
        loading: false,
        level: bm.level,
        charging: bm.charging,
        chargingTime: bm.chargingTime,
        dischargingTime: bm.dischargingTime,
      });
    };

    const handleUpdate = () => {
      if (batteryRef) syncState(batteryRef);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && batteryRef) {
        syncState(batteryRef);
      }
    };

    nav
      .getBattery()
      .then((bm) => {
        if (cancelled) return;
        batteryRef = bm;
        syncState(bm);
        bm.addEventListener('levelchange', handleUpdate);
        bm.addEventListener('chargingchange', handleUpdate);
        bm.addEventListener('chargingtimechange', handleUpdate);
        bm.addEventListener('dischargingtimechange', handleUpdate);
        document.addEventListener('visibilitychange', handleVisibilityChange);
      })
      .catch(() => {
        if (!cancelled) {
          setState((prev) => ({ ...prev, supported: false, loading: false }));
        }
      });

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (batteryRef) {
        batteryRef.removeEventListener('levelchange', handleUpdate);
        batteryRef.removeEventListener('chargingchange', handleUpdate);
        batteryRef.removeEventListener('chargingtimechange', handleUpdate);
        batteryRef.removeEventListener('dischargingtimechange', handleUpdate);
      }
    };
  }, []);

  return state;
}

export const BatteryStatus: React.FC = () => {
  const { t } = useTranslation();
  const { supported, loading, level, charging, chargingTime, dischargingTime } = useBatteryStatus();

  if (!supported) {
    return (
      <div className="max-w-md mx-auto px-3 py-1 flex items-center justify-center gap-1.5 text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800/80">
        <BatteryMedium className="w-3.5 h-3.5 text-slate-400" />
        <span>{t.batteryUnavailable}</span>
      </div>
    );
  }

  if (loading || level === null) {
    return null;
  }

  const percent = Math.min(100, Math.max(0, Math.round(level * 100)));
  const isCritical = !charging && percent <= 15;
  const isLow = !charging && percent <= 25;
  const timeStr = charging ? formatDuration(chargingTime) : formatDuration(dischargingTime);

  const barColor = charging
    ? 'bg-emerald-500'
    : isCritical
    ? 'bg-rose-500'
    : isLow
    ? 'bg-amber-500'
    : 'bg-emerald-500';

  const textColor = charging
    ? 'text-emerald-600 dark:text-emerald-400'
    : isCritical
    ? 'text-rose-600 dark:text-rose-400'
    : isLow
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-slate-600 dark:text-slate-300';

  const Icon = charging
    ? BatteryCharging
    : isCritical
    ? BatteryWarning
    : isLow
    ? BatteryLow
    : percent > 60
    ? BatteryFull
    : BatteryMedium;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`border-b border-slate-100 dark:border-slate-800/80 transition-colors ${
        isCritical
          ? 'bg-rose-50/90 dark:bg-rose-950/30'
          : isLow
          ? 'bg-amber-50/80 dark:bg-amber-950/20'
          : ''
      }`}
    >
      <div className="max-w-md mx-auto px-3 py-1 flex items-center justify-between gap-2 text-[10px]">
        <div className={`flex items-center gap-1.5 font-semibold ${textColor}`}>
          <Icon className={`w-3.5 h-3.5 shrink-0 ${charging ? 'animate-pulse' : ''}`} />
          <span className="tabular-nums">
            {t.batteryRemaining}: {percent}%
          </span>
          {charging && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
              <span>·</span>
              <Zap className="w-3 h-3 fill-emerald-500 text-emerald-500 animate-pulse" aria-hidden="true" />
              <span>{t.batteryCharging}</span>
            </span>
          )}
          {timeStr && (
            <span className="text-slate-400 font-normal tabular-nums">
              · ~{timeStr}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 min-w-0">
          {isLow && (
            <span className="text-[9px] font-semibold text-amber-700 dark:text-amber-300 truncate">
              {t.batteryLowWarning}
            </span>
          )}
          <div
            role="progressbar"
            aria-label={t.batteryStatusLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="w-12 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden shrink-0"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${barColor} ${charging ? 'animate-pulse' : ''}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BatteryStatus;
