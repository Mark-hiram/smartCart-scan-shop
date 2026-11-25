// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React from 'react';
import { useTranslation } from '../utils/i18n';
import { getCopyrightNoticeText } from '../config/legal';

interface CopyrightSymbolSvgProps {
  className?: string;
}

export const CopyrightSymbolSvg: React.FC<CopyrightSymbolSvgProps> = ({
  className = 'w-5 h-5 shrink-0',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
    className={className}
  >
    <circle
      cx="10"
      cy="10"
      r="8.25"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M12.75 7.45a3.75 3.75 0 1 0 0 5.1"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
    />
  </svg>
);

interface CopyrightBadgeProps {
  className?: string;
}

export const CopyrightBadge: React.FC<CopyrightBadgeProps> = ({ className = '' }) => {
  const { language, t } = useTranslation();
  const noticeText = getCopyrightNoticeText(language);

  return (
    <div
      aria-label={`${t.copyrightBadgeAria} ${noticeText}`}
      className={`inline-flex flex-wrap items-center justify-center gap-1.5 text-[11px] leading-snug text-current text-center max-w-full ${className}`}
    >
      <CopyrightSymbolSvg className="w-5 h-5 shrink-0" />
      <span className="font-medium break-words">{noticeText}</span>
    </div>
  );
};
