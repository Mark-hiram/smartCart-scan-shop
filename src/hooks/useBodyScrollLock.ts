// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import { useEffect } from 'react';

let activeLockCount = 0;
let previousOverflow = '';
let previousPaddingRight = '';

function lockBodyScroll() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (activeLockCount === 0) {
    previousOverflow = document.body.style.overflow;
    previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }
  activeLockCount += 1;
}

function unlockBodyScroll() {
  if (typeof document === 'undefined') return;
  if (activeLockCount <= 0) {
    activeLockCount = 0;
    document.body.style.overflow = previousOverflow || '';
    document.body.style.paddingRight = previousPaddingRight || '';
    return;
  }
  activeLockCount -= 1;
  if (activeLockCount === 0) {
    document.body.style.overflow = previousOverflow || '';
    document.body.style.paddingRight = previousPaddingRight || '';
    previousOverflow = '';
    previousPaddingRight = '';
  }
}

/**
 * Reference-counted body scroll lock for modals and drawers.
 * Automatically restores body scroll when `isOpen` flips false or the component unmounts.
 */
export function useBodyScrollLock(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;
    lockBodyScroll();
    return () => {
      unlockBodyScroll();
    };
  }, [isOpen]);
}
