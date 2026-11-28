// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useState } from 'react';
import {
  ScanLine,
  Calculator,
  Award,
  ArrowRight,
  Building2,
  Store,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useTranslation } from '../utils/i18n';
import { SmartCartMark } from './SmartCartLogo';
import { PortalBackgroundImage, usePreloadPortalSignInImage } from './PortalBackgroundImage';
import { CopyrightBadge } from './CopyrightBadge';

interface WelcomeScreenProps {
  onGetStarted: () => void;
  onSelectOwnerPortal: () => void;
  onSelectStaffPortal: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onGetStarted,
  onSelectOwnerPortal,
  onSelectStaffPortal,
}) => {
  const { t } = useTranslation();
  const [showWorkplaceChoices, setShowWorkplaceChoices] = useState(false);

  usePreloadPortalSignInImage('shopper');

  const highlights = [
    {
      icon: ScanLine,
      label: t.welcomeHighlightScan,
    },
    {
      icon: Calculator,
      label: t.welcomeHighlightTotal,
    },
    {
      icon: Award,
      label: t.welcomeHighlightLoyalty,
    },
  ];

  return (
    <section
      aria-labelledby="welcome-heading"
      className="relative flex-1 min-h-[calc(100dvh-3.5rem)] flex flex-col justify-between px-4 py-6 sm:py-10 safe-x safe-bottom text-white"
    >
      {/* Existing Real-Photo Backdrop + Dark Overlay for Readable Contrast */}
      <PortalBackgroundImage portal="shopper" variant="backdrop" priority />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-950/85 via-emerald-950/80 to-slate-950/90"
      />

      <div className="relative z-10 w-full max-w-xl mx-auto my-auto welcome-fade-in">
        <div className="rounded-3xl border border-white/15 bg-slate-900/72 backdrop-blur-md p-6 sm:p-8 shadow-2xl space-y-6">
          {/* Logo & Brand Name */}
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="inline-flex items-center gap-3">
              <SmartCartMark className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 drop-shadow-md" />
              <span className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                {t.appName}
              </span>
            </div>

            <div className="space-y-2 pt-1">
              <h1
                id="welcome-heading"
                className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight"
              >
                {t.welcomeHeadline}
              </h1>
              <p className="text-sm sm:text-base text-slate-200 max-w-md mx-auto leading-relaxed">
                {t.welcomeSubtitle}
              </p>
            </div>
          </div>

          {/* 3 Short Highlights */}
          <ul
            aria-label={t.welcomeHeadline}
            className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3"
          >
            {highlights.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="flex sm:flex-col items-center sm:text-center gap-3 sm:gap-2 rounded-2xl border border-white/15 bg-white/8 px-3.5 py-3"
              >
                <span className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/35 text-emerald-300 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="text-xs sm:text-[13px] font-semibold text-white leading-snug">
                  {label}
                </span>
              </li>
            ))}
          </ul>

          {/* Primary CTA & Supermarket / Staff Choice */}
          <div className="space-y-3 pt-1">
            <button
              type="button"
              onClick={onGetStarted}
              className="w-full min-h-[48px] px-5 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-98 text-slate-950 font-extrabold text-sm sm:text-base shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            >
              <span>{t.welcomeGetStarted}</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>

            <div className="text-center">
              <button
                type="button"
                aria-expanded={showWorkplaceChoices}
                aria-controls="welcome-workplace-choices"
                onClick={() => setShowWorkplaceChoices((prev) => !prev)}
                className="inline-flex items-center gap-1.5 py-1.5 px-2 text-xs sm:text-[13px] font-semibold text-emerald-200 hover:text-white underline underline-offset-4 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 rounded-lg"
              >
                <span>{t.welcomeStoreOrStaffLink}</span>
                {showWorkplaceChoices ? (
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
            </div>

            {showWorkplaceChoices && (
              <div
                id="welcome-workplace-choices"
                className="rounded-2xl border border-white/15 bg-slate-950/65 p-3.5 space-y-2.5"
              >
                <p className="text-[11px] font-semibold text-slate-300 text-center">
                  {t.welcomeStoreOrStaffPrompt}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={onSelectOwnerPortal}
                    className="flex items-center gap-2.5 p-3 rounded-xl border border-white/15 bg-white/8 hover:bg-white/15 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                  >
                    <span className="w-8 h-8 rounded-lg bg-indigo-500/25 border border-indigo-300/35 text-indigo-200 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-white truncate">
                        {t.welcomeOwnerChoice}
                      </span>
                      <span className="block text-[10px] text-slate-300 truncate">
                        {t.welcomeOwnerDesc}
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={onSelectStaffPortal}
                    className="flex items-center gap-2.5 p-3 rounded-xl border border-white/15 bg-white/8 hover:bg-white/15 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                  >
                    <span className="w-8 h-8 rounded-lg bg-sky-500/25 border border-sky-300/35 text-sky-200 flex items-center justify-center shrink-0">
                      <Store className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-white truncate">
                        {t.welcomeStaffChoice}
                      </span>
                      <span className="block text-[10px] text-slate-300 truncate">
                        {t.welcomeStaffDesc}
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Discreet No-Payment Note & Copyright Badge (never any admin link) */}
          <div className="pt-3 border-t border-white/12 flex flex-col items-center gap-1.5 text-slate-200">
            <p className="text-[11px] text-slate-300 text-center">
              {t.noPaymentFooterNote}
            </p>
            <CopyrightBadge />
          </div>
        </div>
      </div>
    </section>
  );
};
