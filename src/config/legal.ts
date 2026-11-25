// Copyright (c) 2026 SmartCart Owner. All rights reserved.

const readViteEnv = (key: string): string => {
  try {
    const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> })?.env;
    const raw = metaEnv?.[key];
    return typeof raw === 'string' ? raw.trim() : '';
  } catch {
    return '';
  }
};

// Single source of truth for owner name and privacy contact email.
// Override via VITE_COPYRIGHT_OWNER or VITE_CONTACT_EMAIL.
export const DEFAULT_COPYRIGHT_OWNER = 'SmartCart Owner';
export const DEFAULT_CONTACT_EMAIL = 'support@smartcart.example';

export const LEGAL_CONFIG = {
  appName: 'Smart Cart',
  ownerName: readViteEnv('VITE_COPYRIGHT_OWNER') || DEFAULT_COPYRIGHT_OWNER,
  contactEmail: readViteEnv('VITE_CONTACT_EMAIL') || DEFAULT_CONTACT_EMAIL,
};

export function getCurrentCopyrightYear(): number {
  return new Date().getFullYear();
}

export function getCopyrightNoticeText(language: 'en' | 'sw'): string {
  const year = getCurrentCopyrightYear();
  if (language === 'sw') {
    return `${year} ${LEGAL_CONFIG.ownerName}. Haki zote zimehifadhiwa.`;
  }
  return `${year} ${LEGAL_CONFIG.ownerName}. All rights reserved.`;
}

export function getCopyrightLine(language: 'en' | 'sw'): string {
  return `© ${getCopyrightNoticeText(language)}`;
}
