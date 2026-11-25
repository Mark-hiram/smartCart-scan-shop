// Copyright (c) 2026 SmartCart Owner. All rights reserved.

// Safe wrapper around the Web Vibration API for tactile shopper feedback.

export function isHapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function triggerVibration(pattern: number | number[]): boolean {
  if (!isHapticsSupported()) {
    return false;
  }

  try {
    return Boolean(navigator.vibrate(pattern));
  } catch {
    // Ignore errors when vibration is blocked by browser policy or device settings
    return false;
  }
}

// Crisp two-pulse confirmation when a barcode scan adds/updates a cart item
export function triggerScanSuccessHaptic(): boolean {
  return triggerVibration([60, 40, 80]);
}

// Single tactile tap when a price-check barcode lookup succeeds
export function triggerPriceCheckHaptic(): boolean {
  return triggerVibration(65);
}
