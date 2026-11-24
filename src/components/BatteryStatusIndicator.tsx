import React, { useState, useEffect } from 'react';
import { BatteryCharging, BatteryFull, BatteryMedium, BatteryLow, BatteryWarning } from 'lucide-react';
import { useTranslation } from '../utils/i18n';

interface BatteryManager extends EventTarget {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
}

function formatDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export const BatteryStatusIndicator: React.FC = () => {
  const { t } = useTranslation();
  const [supported, setSupported] = useState<boolean>(true);
  const [level, setLevel] = useState<number | null>(null);
  const [charging, setCharging] = useState<boolean>(false);
  const [dischargingTime, setDischargingTime] = useState<number>(Infinity);

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    if (typeof nav.getBattery !== 'function') {
      setSupported(false);
      return;
    }

    let batteryRef: BatteryManager | null = null;
    let cancelled = false;

    const syncState = (bm: BatteryManager) => {
      if (cancelled) return;
      setLevel(bm.level);
      setCharging(bm.charging);
      setDischargingTime(bm.dischargingTime);
    };

    const handleUpdate = () => {
      if (batteryRef) syncState(batteryRef);
    };

    nav
      .getBattery()
      .then((bm) => {
        if (cancelled) return;
        batteryRef = bm;
        syncState(bm);
        bm.addEventListener('levelchange', handleUpdate);
        bm.addEventListener('chargingchange', handleUpdate);
        bm.addEventListener('dischargingtimechange', handleUpdate);
      })
      .catch(() => {
        if (!cancelled) setSupported(false);
      });

    return () => {
      cancelled = true;
      if (batteryRef) {
        batteryRef.removeEventListener('levelchange', handleUpdate);
        batteryRef.removeEventListener('chargingchange', handleUpdate);
        batteryRef.removeEventListener('dischargingtimechange', handleUpdate);
      }
    };
  }, []);

  if (!supported) {
    return (
      <div className="max-w-md mx-auto px-3 py-1 flex items-center justify-center gap-1.5 text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800/80">
        <BatteryMedium className="w-3.5 h-3.5 text-slate-400" />
        <span>{t.batteryUnavailable}</span>
      </div>
    );
  }

  if (level === null) {
    return null;
  }

  const percent = Math.round(level * 100);
  const isCritical = !charging && percent <= 15;
  const isLow = !charging && percent <= 25;
  const remainingStr = !charging ? formatDuration(dischargingTime) : null;

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
          <Icon className="w-3.5 h-3.5 shrink-0" />
          <span className="tabular-nums">
            {t.batteryRemaining}: {percent}%
          </span>
          {charging && (
            <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
              · {t.batteryCharging}
            </span>
          )}
          {remainingStr && (
            <span className="text-slate-400 font-normal tabular-nums">
              · ~{remainingStr}
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
            className="w-12 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden shrink-0"
            aria-hidden="true"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${barColor}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
