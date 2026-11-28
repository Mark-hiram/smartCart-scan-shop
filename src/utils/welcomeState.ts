// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import { User } from '../types';

export const WELCOME_DISMISSED_KEY = 'smartcart_welcome_seen';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getSafeLocalStorage(explicitStorage?: StorageLike | null): StorageLike | null {
  if (explicitStorage !== undefined) return explicitStorage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore storage access failures (e.g., private browsing / disabled storage)
  }
  return null;
}

/**
 * Reads whether the visitor previously tapped "Get started".
 * Never throws or blocks if localStorage is unavailable.
 */
export function readWelcomeDismissed(storage?: StorageLike | null): boolean {
  try {
    const store = getSafeLocalStorage(storage);
    if (!store) return false;
    return store.getItem(WELCOME_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Remembers that the visitor dismissed the welcome screen.
 * Safe no-op if localStorage throws or is unavailable.
 */
export function persistWelcomeDismissed(storage?: StorageLike | null): boolean {
  try {
    const store = getSafeLocalStorage(storage);
    if (!store) return false;
    store.setItem(WELCOME_DISMISSED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export interface WelcomeVisibilityInput {
  isLoading: boolean;
  user: User | null;
  currentPath: string;
  welcomeDismissed: boolean;
  forceWelcomeOpen?: boolean;
  guestSessionActive?: boolean;
  hasActiveGoodbye?: boolean;
}

/**
 * Determines whether the WelcomeScreen should be displayed:
 * - Never shown while auth is loading.
 * - Never shown to signed-in users (they go straight to their dashboard).
 * - Never shown on /admin* or /about or when an active GoodbyeScreen is displayed.
 * - Shown when explicitly reopened via "About Smart Cart" on sign-in pages.
 * - Otherwise shown on first signed-out visit (/ or /login) until dismissed.
 */
export function shouldShowWelcomeScreen({
  isLoading,
  user,
  currentPath,
  welcomeDismissed,
  forceWelcomeOpen = false,
  guestSessionActive = false,
  hasActiveGoodbye = false,
}: WelcomeVisibilityInput): boolean {
  if (isLoading) return false;
  if (user) return false;
  if (hasActiveGoodbye) return false;
  if (currentPath.startsWith('/admin') || currentPath === '/about') return false;
  if (forceWelcomeOpen) return true;
  if (guestSessionActive) return false;
  if (welcomeDismissed) return false;

  // Show welcome first on root / or /login when signed out & not yet dismissed
  return currentPath === '/' || currentPath === '/login' || currentPath === '';
}
