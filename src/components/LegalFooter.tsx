// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React from 'react';
import { useTranslation } from '../utils/i18n';
import { CopyrightBadge } from './CopyrightBadge';
import { SmartCartMark } from './SmartCartLogo';

interface LegalFooterProps {
  onNavigateAbout: () => void;
  hasFixedBottomBar?: boolean;
}

export const LegalFooter: React.FC<LegalFooterProps> = ({
  onNavigateAbout,
  hasFixedBottomBar = false,
}) => {
  const { t } = useTranslation();

  return (
    <footer
      aria-label={t.legalNoticeTitle}
      className={`w-full safe-x border-t border-slate-200/80 dark:border-slate-800/80 bg-white/85 dark:bg-slate-900/85 backdrop-blur-sm text-slate-600 dark:text-slate-400 transition-colors ${
        hasFixedBottomBar
          ? 'pb-[calc(7rem+env(safe-area-inset-bottom,0px))] md:pb-[calc(6rem+env(safe-area-inset-bottom,0px))]'
          : 'pb-[calc(1rem+env(safe-area-inset-bottom,0px))]'
      } pt-3.5 px-4`}
    >
      <div className="max-w-7xl mx-auto flex flex-col items-center justify-center gap-1.5 text-[11px] leading-relaxed text-center">
        <div className="flex flex-wrap items-center justify-center gap-2 text-slate-700 dark:text-slate-300">
          <SmartCartMark className="w-4 h-4 shrink-0" decorative />
          <CopyrightBadge />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 shrink-0">
          <span className="text-slate-500 dark:text-slate-400">{t.noPaymentFooterNote}</span>
          <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
            ·
          </span>
          <a
            href="/about"
            onClick={(e) => {
              e.preventDefault();
              onNavigateAbout();
            }}
            className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded px-1"
          >
            {t.aboutLegal}
          </a>
        </div>
      </div>
    </footer>
  );
};
