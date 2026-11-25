// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React from 'react';

interface IllustrationProps {
  className?: string;
}

/**
 * Original SVG illustration: friendly smartphone scanning an everyday grocery carton
 * No external assets, no known brand logos or characters.
 */
export const ShopperHeroIllustration: React.FC<IllustrationProps> = ({ className = '' }) => (
  <svg
    width="176"
    height="132"
    viewBox="0 0 176 132"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`shrink-0 ${className}`}
    role="img"
    aria-label="Phone scanning grocery item barcode"
  >
    {/* Soft circular backdrop */}
    <circle cx="88" cy="68" r="56" className="fill-white/15 dark:fill-emerald-400/10" />
    <circle cx="140" cy="34" r="10" className="fill-teal-300/25" />
    <circle cx="32" cy="94" r="7" className="fill-emerald-300/25" />

    {/* Grocery carton on the right */}
    <g>
      <rect x="96" y="42" width="44" height="58" rx="8" className="fill-white dark:fill-slate-800" stroke="#0f766e" strokeWidth="2.2" />
      <path d="M96 54h44" stroke="#0d9488" strokeWidth="2" />
      {/* Leaf emblem on carton */}
      <path d="M113 48c3-4 9-4 11 0-3 4-9 4-11 0z" className="fill-emerald-500" />
      {/* Barcode stripes on carton */}
      <rect x="104" y="68" width="2.5" height="18" rx="1" className="fill-slate-800 dark:fill-slate-200" />
      <rect x="108.5" y="68" width="1.5" height="18" rx="0.7" className="fill-slate-800 dark:fill-slate-200" />
      <rect x="112" y="68" width="3" height="18" rx="1" className="fill-slate-800 dark:fill-slate-200" />
      <rect x="117" y="68" width="1.5" height="18" rx="0.7" className="fill-slate-800 dark:fill-slate-200" />
      <rect x="120.5" y="68" width="2.5" height="18" rx="1" className="fill-slate-800 dark:fill-slate-200" />
      <rect x="125" y="68" width="2" height="18" rx="1" className="fill-slate-800 dark:fill-slate-200" />
    </g>

    {/* Smartphone on the left */}
    <g>
      <rect x="34" y="22" width="48" height="86" rx="10" className="fill-slate-900 dark:fill-slate-950" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="2.2" />
      <rect x="39" y="32" width="38" height="64" rx="5" className="fill-emerald-50 dark:fill-slate-800" />
      {/* Speaker pill */}
      <rect x="52" y="26.5" width="12" height="2.4" rx="1.2" className="fill-slate-600" />
      {/* Viewfinder corners */}
      <path d="M46 47v-5h5M70 47v-5h-5M46 73v5h5M70 73v5h-5" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Mini barcode inside phone screen */}
      <rect x="50" y="53" width="2" height="13" className="fill-slate-700 dark:fill-slate-200" />
      <rect x="54" y="53" width="3" height="13" className="fill-slate-700 dark:fill-slate-200" />
      <rect x="59" y="53" width="1.5" height="13" className="fill-slate-700 dark:fill-slate-200" />
      <rect x="62.5" y="53" width="2.5" height="13" className="fill-slate-700 dark:fill-slate-200" />
      {/* Price badge */}
      <rect x="44" y="81" width="28" height="10" rx="4" className="fill-emerald-600" />
      <path d="M51 86h14" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
    </g>

    {/* Laser scan beam */}
    <path d="M77 60L104 75" stroke="#34d399" strokeWidth="2.5" strokeDasharray="3 3" strokeLinecap="round" />
    <circle cx="101" cy="74" r="3.5" className="fill-emerald-400" />
  </svg>
);

/**
 * Original SVG illustration: clean empty shopping cart / basket
 */
export const EmptyCartIllustration: React.FC<IllustrationProps> = ({ className = '' }) => (
  <svg
    width="128"
    height="96"
    viewBox="0 0 128 96"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`mx-auto ${className}`}
    role="img"
    aria-label="Empty shopping cart"
  >
    <ellipse cx="64" cy="82" rx="40" ry="6" className="fill-emerald-100/80 dark:fill-emerald-950/60" />
    <path
      d="M24 22h11l10 38h44l8-26H42"
      className="stroke-emerald-600 dark:stroke-emerald-400"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M46 47h46" className="stroke-teal-400/70" strokeWidth="2" strokeLinecap="round" />
    <circle cx="52" cy="70" r="5" className="fill-white dark:fill-slate-900 stroke-emerald-600 dark:stroke-emerald-400" strokeWidth="2.5" />
    <circle cx="84" cy="70" r="5" className="fill-white dark:fill-slate-900 stroke-emerald-600 dark:stroke-emerald-400" strokeWidth="2.5" />
    <circle cx="72" cy="24" r="10" className="fill-emerald-50 dark:fill-emerald-950/80 stroke-emerald-300 dark:stroke-emerald-700" strokeWidth="1.8" />
    <path d="M68 24h8M72 20v8" className="stroke-emerald-600 dark:stroke-emerald-400" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * Original SVG illustration: empty search results or past receipts
 */
export const EmptySearchIllustration: React.FC<IllustrationProps> = ({ className = '' }) => (
  <svg
    width="128"
    height="96"
    viewBox="0 0 128 96"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`mx-auto ${className}`}
    role="img"
    aria-label="No matching items or receipts"
  >
    <ellipse cx="64" cy="83" rx="38" ry="5.5" className="fill-slate-200/70 dark:fill-slate-800/70" />
    <rect x="34" y="16" width="46" height="58" rx="8" className="fill-slate-50 dark:fill-slate-800 stroke-slate-300 dark:stroke-slate-700" strokeWidth="2.2" />
    <path d="M44 30h26M44 40h20M44 50h14" className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="78" cy="54" r="14" className="fill-white dark:fill-slate-900 stroke-emerald-600 dark:stroke-emerald-400" strokeWidth="2.8" />
    <path d="M88 64l10 10" className="stroke-emerald-600 dark:stroke-emerald-400" strokeWidth="3.2" strokeLinecap="round" />
    <path d="M73 54h10" className="stroke-teal-500" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
