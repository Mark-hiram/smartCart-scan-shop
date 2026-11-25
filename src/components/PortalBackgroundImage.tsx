// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import React, { useEffect, useState } from 'react';
import { PortalType } from '../types';

export type VisualPortal = PortalType | 'admin';

interface PortalImageSpec {
  mobileUrl: string;
  desktopUrl: string;
  width: number;
  height: number;
  placeholderBg: string;
  scrimClass: string;
  alt: string;
}

const PORTAL_IMAGE_SPECS: Record<VisualPortal, { backdrop: PortalImageSpec; banner: PortalImageSpec }> = {
  shopper: {
    backdrop: {
      mobileUrl: '/images/portals/shopper-bg-800.webp',
      desktopUrl: '/images/portals/shopper-bg-1600.webp',
      width: 800,
      height: 450,
      placeholderBg: '#064e3b',
      scrimClass:
        'bg-gradient-to-br from-emerald-950/75 via-teal-950/60 to-slate-950/75 dark:from-emerald-950/85 dark:via-slate-950/80 dark:to-teal-950/85',
      alt: 'Fresh produce and grocery basket in a bright market',
    },
    banner: {
      mobileUrl: '/images/portals/shopper-banner-800.webp',
      desktopUrl: '/images/portals/shopper-banner-1600.webp',
      width: 800,
      height: 260,
      placeholderBg: '#064e3b',
      scrimClass:
        'bg-gradient-to-r from-emerald-950/88 via-teal-900/80 to-emerald-950/84',
      alt: 'Fresh market produce banner',
    },
  },
  staff: {
    backdrop: {
      mobileUrl: '/images/portals/supermarket-bg-800.webp',
      desktopUrl: '/images/portals/supermarket-bg-1600.webp',
      width: 800,
      height: 450,
      placeholderBg: '#0f172a',
      scrimClass:
        'bg-gradient-to-br from-slate-950/80 via-blue-950/70 to-slate-950/82',
      alt: 'Clean modern supermarket aisle and stocked shelves',
    },
    banner: {
      mobileUrl: '/images/portals/supermarket-banner-800.webp',
      desktopUrl: '/images/portals/supermarket-banner-1600.webp',
      width: 800,
      height: 260,
      placeholderBg: '#0f172a',
      scrimClass:
        'bg-gradient-to-r from-slate-950/90 via-blue-950/82 to-slate-950/86',
      alt: 'Supermarket aisle shelves banner',
    },
  },
  management: {
    backdrop: {
      mobileUrl: '/images/portals/supermarket-bg-800.webp',
      desktopUrl: '/images/portals/supermarket-bg-1600.webp',
      width: 800,
      height: 450,
      placeholderBg: '#0f172a',
      scrimClass:
        'bg-gradient-to-br from-slate-950/80 via-blue-950/70 to-slate-950/82',
      alt: 'Clean modern supermarket aisle and stocked shelves',
    },
    banner: {
      mobileUrl: '/images/portals/supermarket-banner-800.webp',
      desktopUrl: '/images/portals/supermarket-banner-1600.webp',
      width: 800,
      height: 260,
      placeholderBg: '#0f172a',
      scrimClass:
        'bg-gradient-to-r from-slate-950/90 via-blue-950/82 to-slate-950/86',
      alt: 'Supermarket aisle shelves banner',
    },
  },
  admin: {
    backdrop: {
      mobileUrl: '/images/portals/admin-bg-800.webp',
      desktopUrl: '/images/portals/admin-bg-1600.webp',
      width: 800,
      height: 450,
      placeholderBg: '#090d1a',
      scrimClass:
        'bg-gradient-to-br from-slate-950/84 via-indigo-950/75 to-slate-950/88',
      alt: 'Dark abstract enterprise architecture surface',
    },
    banner: {
      mobileUrl: '/images/portals/admin-banner-800.webp',
      desktopUrl: '/images/portals/admin-banner-1600.webp',
      width: 800,
      height: 260,
      placeholderBg: '#090d1a',
      scrimClass:
        'bg-gradient-to-r from-slate-950/92 via-indigo-950/84 to-slate-950/90',
      alt: 'Dark technology administration banner',
    },
  },
};

/**
 * Dynamically preloads ONLY the first sign-in image of the active portal using responsive WebP srcset,
 * ensuring phones download only the 800w asset (<80 KB).
 */
export function usePreloadPortalSignInImage(portal: VisualPortal): void {
  useEffect(() => {
    const spec = PORTAL_IMAGE_SPECS[portal].backdrop;
    const selector = 'link[data-smartcart-portal-preload="true"]';
    document.querySelectorAll(selector).forEach((el) => el.remove());

    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.type = 'image/webp';
    link.setAttribute('imagesrcset', `${spec.mobileUrl} 800w, ${spec.desktopUrl} 1600w`);
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
  variant: 'backdrop' | 'banner';
  priority?: boolean;
  sizes?: string;
}

/**
 * Responsive WebP portal image layer with solid portal-color placeholder,
 * WCAG AA gradient scrim overlay, no animations, and automatic gradient fallback on error.
 */
export const PortalBackgroundImage: React.FC<PortalBackgroundImageProps> = ({
  portal,
  variant,
  priority = false,
  sizes = variant === 'banner' ? '(max-width: 768px) 100vw, 1280px' : '100vw',
}) => {
  const spec = PORTAL_IMAGE_SPECS[portal][variant];
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [portal, variant]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
      style={{
        backgroundColor: spec.placeholderBg,
        backgroundImage:
          variant === 'banner'
            ? 'var(--portal-pattern), var(--portal-banner-gradient)'
            : 'var(--portal-pattern), var(--portal-bg-gradient)',
        backgroundRepeat: 'repeat, no-repeat',
        backgroundSize: 'auto, cover',
      }}
    >
      {!hasError && (
        <picture>
          <source
            type="image/webp"
            srcSet={`${spec.mobileUrl} 800w, ${spec.desktopUrl} 1600w`}
            sizes={sizes}
          />
          <img
            src={spec.mobileUrl}
            alt={spec.alt}
            width={spec.width}
            height={spec.height}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : 'auto'}
            referrerPolicy="no-referrer"
            onError={() => setHasError(true)}
            className="w-full h-full object-cover object-center"
          />
        </picture>
      )}
      <div className={`absolute inset-0 ${spec.scrimClass}`} />
    </div>
  );
};
