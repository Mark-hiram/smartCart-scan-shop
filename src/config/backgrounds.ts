// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import { PortalType } from '../types';

export type VisualPortal = PortalType | 'admin';
export type PortalPhotoVariant = 'backdrop' | 'banner';

export interface PortalPhotoOption {
  id: string;
  mobileUrl: string;
  desktopUrl: string;
  width: number;
  height: number;
  objectPosition: string;
  scrimClass: string;
  placeholderBg: string;
  altEn: string;
  altSw: string;
}

// Vite eagerly collects ONLY real user-supplied WebP photos placed in src/assets/images/photos/
const USER_PHOTO_MODULES: Record<string, string> =
  typeof (import.meta as { glob?: unknown }).glob === 'function'
    ? import.meta.glob<string>('/src/assets/images/photos/*.webp', {
        eager: true,
        import: 'default',
      })
    : {};

const USER_PHOTOS_BY_FILENAME: Record<string, string> = Object.fromEntries(
  Object.entries(USER_PHOTO_MODULES).map(([fullPath, resolvedUrl]) => {
    const fileName = fullPath.split('/').pop() || fullPath;
    return [fileName.toLowerCase(), resolvedUrl];
  })
);

interface ExpectedSlotDefinition {
  prefix: string;
  expectedMobile: string;
  expectedDesktop: string;
  width: number;
  height: number;
  objectPosition: string;
  scrimClass: string;
  placeholderBg: string;
  altEn: string;
  altSw: string;
}

const PORTAL_SLOT_SPECS: Record<VisualPortal, Record<PortalPhotoVariant, ExpectedSlotDefinition>> = {
  shopper: {
    backdrop: {
      prefix: 'shopper-bg',
      expectedMobile: 'shopper-bg-800.webp',
      expectedDesktop: 'shopper-bg-1600.webp',
      width: 800,
      height: 450,
      objectPosition: 'center center',
      scrimClass:
        'bg-gradient-to-br from-emerald-950/78 via-teal-950/65 to-slate-950/80 dark:from-emerald-950/86 dark:via-slate-950/82 dark:to-teal-950/88',
      placeholderBg: '#064e3b',
      altEn: 'Fresh supermarket produce and grocery shopping atmosphere',
      altSw: 'Matunda mapya, mboga na mazingira mazuri ya duka kuu',
    },
    banner: {
      prefix: 'shopper-banner',
      expectedMobile: 'shopper-banner-800.webp',
      expectedDesktop: 'shopper-banner-1600.webp',
      width: 800,
      height: 260,
      objectPosition: 'center center',
      scrimClass: 'bg-gradient-to-r from-emerald-950/88 via-teal-900/80 to-emerald-950/86',
      placeholderBg: '#064e3b',
      altEn: 'Smart Cart supermarket shopper banner',
      altSw: 'Bango la mteja wa Smart Cart dukani',
    },
  },
  staff: {
    backdrop: {
      prefix: 'supermarket-bg',
      expectedMobile: 'supermarket-bg-800.webp',
      expectedDesktop: 'supermarket-bg-1600.webp',
      width: 800,
      height: 450,
      objectPosition: 'center center',
      scrimClass: 'bg-gradient-to-br from-slate-950/82 via-blue-950/72 to-slate-950/84',
      placeholderBg: '#0f172a',
      altEn: 'Supermarket aisle and stocked shelves backdrop',
      altSw: 'Mstari wa rafu za bidhaa katika duka kuu',
    },
    banner: {
      prefix: 'supermarket-banner',
      expectedMobile: 'supermarket-banner-800.webp',
      expectedDesktop: 'supermarket-banner-1600.webp',
      width: 800,
      height: 260,
      objectPosition: 'center 42%',
      scrimClass: 'bg-gradient-to-r from-slate-950/90 via-blue-950/84 to-slate-950/88',
      placeholderBg: '#0f172a',
      altEn: 'Supermarket staff checkout banner',
      altSw: 'Bango la wafanyakazi wa duka kuu',
    },
  },
  management: {
    backdrop: {
      prefix: 'supermarket-bg',
      expectedMobile: 'supermarket-bg-800.webp',
      expectedDesktop: 'supermarket-bg-1600.webp',
      width: 800,
      height: 450,
      objectPosition: 'center center',
      scrimClass: 'bg-gradient-to-br from-slate-950/82 via-blue-950/72 to-slate-950/84',
      placeholderBg: '#0f172a',
      altEn: 'Supermarket shelves and retail management backdrop',
      altSw: 'Mazingira ya usimamizi wa duka kuu',
    },
    banner: {
      prefix: 'supermarket-banner',
      expectedMobile: 'supermarket-banner-800.webp',
      expectedDesktop: 'supermarket-banner-1600.webp',
      width: 800,
      height: 260,
      objectPosition: 'center 42%',
      scrimClass: 'bg-gradient-to-r from-slate-950/90 via-blue-950/84 to-slate-950/88',
      placeholderBg: '#0f172a',
      altEn: 'Supermarket management banner',
      altSw: 'Bango la usimamizi wa duka kuu',
    },
  },
  admin: {
    backdrop: {
      prefix: 'admin-bg',
      expectedMobile: 'admin-bg-800.webp',
      expectedDesktop: 'admin-bg-1600.webp',
      width: 800,
      height: 450,
      objectPosition: 'center center',
      scrimClass: 'bg-gradient-to-br from-slate-950/86 via-indigo-950/78 to-slate-950/90',
      placeholderBg: '#090d1a',
      altEn: 'Modern technology office workspace backdrop',
      altSw: 'Mazingira ya ofisi ya teknolojia ya usimamizi mkuu',
    },
    banner: {
      prefix: 'admin-banner',
      expectedMobile: 'admin-banner-800.webp',
      expectedDesktop: 'admin-banner-1600.webp',
      width: 800,
      height: 260,
      objectPosition: 'center center',
      scrimClass: 'bg-gradient-to-r from-slate-950/92 via-indigo-950/86 to-slate-950/90',
      placeholderBg: '#090d1a',
      altEn: 'Platform administration banner',
      altSw: 'Bango la usimamizi wa mfumo mzima',
    },
  },
};

export function getPortalPhotoOptions(
  portal: VisualPortal,
  variant: PortalPhotoVariant
): PortalPhotoOption[] {
  const spec = PORTAL_SLOT_SPECS[portal][variant];
  const entries = Object.entries(USER_PHOTOS_BY_FILENAME);
  if (entries.length === 0) return [];

  // Group files matching this prefix into mobile (800w) / desktop (1600w) or single pairs
  const matching = entries.filter(([name]) => name.startsWith(spec.prefix));
  if (matching.length === 0) return [];

  const groups = new Map<string, { mobile?: string; desktop?: string }>();
  for (const [fileName, url] of matching) {
    const cleanId = fileName
      .replace(/-(800|1600)\.webp$/i, '')
      .replace(/\.webp$/i, '');
    const slot = groups.get(cleanId) || {};
    if (fileName.endsWith('-800.webp')) {
      slot.mobile = url;
    } else if (fileName.endsWith('-1600.webp')) {
      slot.desktop = url;
    } else {
      if (!slot.mobile) slot.mobile = url;
      if (!slot.desktop) slot.desktop = url;
    }
    groups.set(cleanId, slot);
  }

  return Array.from(groups.entries()).map(([id, urls]) => ({
    id,
    mobileUrl: urls.mobile || urls.desktop!,
    desktopUrl: urls.desktop || urls.mobile!,
    width: spec.width,
    height: spec.height,
    objectPosition: spec.objectPosition,
    scrimClass: spec.scrimClass,
    placeholderBg: spec.placeholderBg,
    altEn: spec.altEn,
    altSw: spec.altSw,
  }));
}

export function pickRandomPortalPhoto(
  portal: VisualPortal,
  variant: PortalPhotoVariant
): PortalPhotoOption | null {
  const options = getPortalPhotoOptions(portal, variant);
  if (options.length === 0) return null;
  const idx = Math.floor(Math.random() * options.length);
  return options[idx];
}

export function getMissingPhotoFilenames(): string[] {
  const expected = new Set<string>();
  (Object.keys(PORTAL_SLOT_SPECS) as VisualPortal[]).forEach((portal) => {
    (['backdrop', 'banner'] as PortalPhotoVariant[]).forEach((variant) => {
      const spec = PORTAL_SLOT_SPECS[portal][variant];
      expected.add(spec.expectedMobile);
      expected.add(spec.expectedDesktop);
    });
  });

  return Array.from(expected).filter(
    (name) => !USER_PHOTOS_BY_FILENAME[name.toLowerCase()]
  );
}
