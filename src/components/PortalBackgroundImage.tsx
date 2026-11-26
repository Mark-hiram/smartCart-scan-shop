// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useEffect, useMemo, useState } from 'react';
import {
  pickRandomPortalPhoto,
  VisualPortal,
  PortalPhotoVariant,
} from '../config/backgrounds';
import { useTranslation } from '../utils/i18n';

export type { VisualPortal };

const SCRIM_BY_PORTAL: Record<VisualPortal, string> = {
  shopper:
    'bg-gradient-to-br from-emerald-950/75 via-teal-950/60 to-slate-950/78 dark:from-emerald-950/86 dark:via-slate-950/82 dark:to-teal-950/88',
  staff:
    'bg-gradient-to-br from-slate-950/82 via-blue-950/72 to-slate-950/84',
  management:
    'bg-gradient-to-br from-slate-950/82 via-blue-950/72 to-slate-950/84',
  admin:
    'bg-gradient-to-br from-slate-950/86 via-indigo-950/78 to-slate-950/90',
};

/**
 * Conditionally preloads a single responsive WebP sign-in backdrop ONLY if real user photos exist
 * in src/assets/images/photos/. Never issues network requests for nonexistent assets.
 */
export function usePreloadPortalSignInImage(portal: VisualPortal): void {
  useEffect(() => {
    const selector = 'link[data-smartcart-portal-preload="true"]';
    document.querySelectorAll(selector).forEach((el) => el.remove());

    const picked = pickRandomPortalPhoto(portal, 'backdrop');
    if (!picked) return;

    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.type = 'image/webp';
    link.setAttribute('imagesrcset', `${picked.mobileUrl} 800w, ${picked.desktopUrl} 1600w`);
    link.setAttribute('imagesizes', '100vw');
    link.setAttribute('data-smartcart-portal-preload', 'true');
    document.head.appendChild(link);

    return () => {
      link.remove();
    };
  }, [portal]);
}

interface PortalBackgroundImageProps {
  portal: VisualPortal;
  variant: PortalPhotoVariant;
  priority?: boolean;
  sizes?: string;
}

/**
 * Renders a user-supplied responsive WebP photo (selected once per mount) from
 * src/assets/images/photos/ with WCAG AA gradient scrim, or falls back cleanly to
 * the plain portal gradient when no photo files exist yet.
 */
export const PortalBackgroundImage: React.FC<PortalBackgroundImageProps> = ({
  portal,
  variant,
  priority = false,
  sizes = variant === 'banner' ? '(max-width: 768px) 100vw, 1280px' : '100vw',
}) => {
  const { language } = useTranslation();
  const [hasError, setHasError] = useState(false);

  // Pick once per portal/variant mount with zero rotation timer or animation
  const selectedPhoto = useMemo(() => pickRandomPortalPhoto(portal, variant), [portal, variant]);

  useEffect(() => {
    setHasError(false);
  }, [portal, variant, selectedPhoto?.id]);

  const showPhoto = Boolean(selectedPhoto && !hasError);
  const altText = selectedPhoto ? (language === 'sw' ? selectedPhoto.altSw : selectedPhoto.altEn) : '';

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
      style={{
        backgroundImage:
          variant === 'banner' ? 'var(--portal-banner-gradient)' : 'var(--portal-bg-gradient)',
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
      }}
    >
      {showPhoto && selectedPhoto && (
        <>
          <picture>
            <source
              type="image/webp"
              srcSet={`${selectedPhoto.mobileUrl} 800w, ${selectedPhoto.desktopUrl} 1600w`}
              sizes={sizes}
            />
            <img
              src={selectedPhoto.mobileUrl}
              alt={altText}
              width={selectedPhoto.width}
              height={selectedPhoto.height}
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
              fetchPriority={priority ? 'high' : 'auto'}
              referrerPolicy="no-referrer"
              onError={() => setHasError(true)}
              style={{ objectPosition: selectedPhoto.objectPosition }}
              className="w-full h-full object-cover"
            />
          </picture>
          <div className={`absolute inset-0 ${selectedPhoto.scrimClass || SCRIM_BY_PORTAL[portal]}`} />
        </>
      )}
    </div>
  );
};
