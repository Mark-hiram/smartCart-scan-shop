// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React from 'react';
import { useTranslation } from '../utils/i18n';
import fullLogoUrl from '../assets/logo/smartcart-full.svg';
import monoDarkLogoUrl from '../assets/logo/smartcart-mono-dark.svg';

interface SmartCartMarkProps {
  className?: string;
  decorative?: boolean;
}

/**
 * Inline brand mark SVG for crisp first paint in headers and compact footers.
 */
export const SmartCartMark: React.FC<SmartCartMarkProps> = ({
  className = 'w-8 h-8',
  decorative = false,
}) => {
  const { t } = useTranslation();

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="32"
      height="32"
      viewBox="0 0 64 64"
      fill="none"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : t.logoAlt}
      className={className}
    >
      <defs>
        <linearGradient id="scHdrMarkBg" x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#059669" />
          <stop offset="100%" stopColor="#0F766E" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#scHdrMarkBg)" />
      <path
        d="M13 18H19.5L23.5 39.5H45.5L50 24.5H21.5"
        stroke="#FFFFFF"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="27" y="27.5" width="2.8" height="8.5" rx="1.2" fill="#D1FAE5" />
      <rect x="32.2" y="27.5" width="4.4" height="8.5" rx="1.2" fill="#FFFFFF" />
      <rect x="39" y="27.5" width="2.6" height="8.5" rx="1.2" fill="#D1FAE5" />
      <path d="M23.5 31.8H44.5" stroke="#FBBF24" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="26.5" cy="46.5" r="3.4" fill="#FFFFFF" />
      <circle cx="42.5" cy="46.5" r="3.4" fill="#FFFFFF" />
    </svg>
  );
};

interface SmartCartHeaderLogoProps {
  subtitle?: string;
  subtitleClassName?: string;
}

/**
 * Responsive header logo: inline mark only on narrow phones (<640px),
 * full mark + wordmark lockup on wider screens.
 */
export const SmartCartHeaderLogo: React.FC<SmartCartHeaderLogoProps> = ({
  subtitle,
  subtitleClassName = 'text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 font-medium',
}) => {
  const { t } = useTranslation();

  return (
    <span className="inline-flex items-center gap-2 sm:gap-2.5 shrink-0">
      <SmartCartMark
        className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 drop-shadow-xs"
        decorative
      />
      <span className="hidden sm:flex flex-col text-left leading-tight">
        <span
          aria-label={t.logoAlt}
          className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap"
        >
          Smart <span className="text-emerald-600 dark:text-emerald-400">Cart</span>
        </span>
        {subtitle && <span className={subtitleClassName}>{subtitle}</span>}
      </span>
    </span>
  );
};

/**
 * Centred large sign-in logo lazy-loaded above portal sign-in forms.
 * Fixed h-14 container guarantees zero cumulative layout shift while loading.
 */
export const SmartCartSignInLogo: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="flex justify-center items-center h-14 mb-2 select-none">
      <img
        src={fullLogoUrl}
        alt={t.logoAlt}
        width={224}
        height={56}
        loading="lazy"
        decoding="async"
        className="h-12 sm:h-14 w-auto block dark:hidden"
      />
      <img
        src={monoDarkLogoUrl}
        alt={t.logoAlt}
        width={224}
        height={56}
        loading="lazy"
        decoding="async"
        className="h-12 sm:h-14 w-auto hidden dark:block"
      />
    </div>
  );
};
