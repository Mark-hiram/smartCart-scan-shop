import { BarcodeFormat } from '../types/index';

/**
 * Validates check digit for EAN-13 barcode.
 * 13 digits: 12 data digits + 1 check digit.
 * Odd positions (1st, 3rd...) weight 1, even positions (2nd, 4th...) weight 3.
 */
export function validateEAN13(code: string): { isValid: boolean; error?: string } {
  if (!/^\d{13}$/.test(code)) {
    return { isValid: false, error: 'EAN-13 must be exactly 13 numeric digits' };
  }

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(code[i], 10);
    sum += i % 2 === 0 ? digit * 1 : digit * 3;
  }

  const remainder = sum % 10;
  const expectedCheckDigit = remainder === 0 ? 0 : 10 - remainder;
  const actualCheckDigit = parseInt(code[12], 10);

  if (expectedCheckDigit !== actualCheckDigit) {
    return {
      isValid: false,
      error: `Invalid EAN-13 check digit. Expected ${expectedCheckDigit}, found ${actualCheckDigit}`,
    };
  }

  return { isValid: true };
}

/**
 * Validates check digit for EAN-8 barcode.
 * 8 digits: 7 data digits + 1 check digit.
 * Odd positions (1st, 3rd, 5th, 7th) weight 3, even positions weight 1.
 */
export function validateEAN8(code: string): { isValid: boolean; error?: string } {
  if (!/^\d{8}$/.test(code)) {
    return { isValid: false, error: 'EAN-8 must be exactly 8 numeric digits' };
  }

  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const digit = parseInt(code[i], 10);
    sum += i % 2 === 0 ? digit * 3 : digit * 1;
  }

  const remainder = sum % 10;
  const expectedCheckDigit = remainder === 0 ? 0 : 10 - remainder;
  const actualCheckDigit = parseInt(code[7], 10);

  if (expectedCheckDigit !== actualCheckDigit) {
    return {
      isValid: false,
      error: `Invalid EAN-8 check digit. Expected ${expectedCheckDigit}, found ${actualCheckDigit}`,
    };
  }

  return { isValid: true };
}

/**
 * Validates check digit for UPC-A barcode.
 * 12 digits: 11 data digits + 1 check digit.
 * Odd positions (1st, 3rd...) weight 3, even positions weight 1.
 */
export function validateUPCA(code: string): { isValid: boolean; error?: string } {
  if (!/^\d{12}$/.test(code)) {
    return { isValid: false, error: 'UPC-A must be exactly 12 numeric digits' };
  }

  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const digit = parseInt(code[i], 10);
    sum += i % 2 === 0 ? digit * 3 : digit * 1;
  }

  const remainder = sum % 10;
  const expectedCheckDigit = remainder === 0 ? 0 : 10 - remainder;
  const actualCheckDigit = parseInt(code[11], 10);

  if (expectedCheckDigit !== actualCheckDigit) {
    return {
      isValid: false,
      error: `Invalid UPC-A check digit. Expected ${expectedCheckDigit}, found ${actualCheckDigit}`,
    };
  }

  return { isValid: true };
}

/**
 * Validates UPC-E barcode (zero-suppressed format: 6, 7 or 8 digits).
 */
export function validateUPCE(code: string): { isValid: boolean; error?: string } {
  const clean = code.trim();
  if (!/^\d{6,8}$/.test(clean)) {
    return { isValid: false, error: 'UPC-E must be 6 to 8 numeric digits' };
  }
  return { isValid: true };
}

/**
 * Validates Code 128 barcode (alphanumeric, high density).
 */
export function validateCode128(code: string): { isValid: boolean; error?: string } {
  const clean = code.trim();
  if (clean.length < 2 || clean.length > 80) {
    return { isValid: false, error: 'Code 128 must be between 2 and 80 characters' };
  }
  // printable ASCII characters
  if (!/^[\x20-\x7E]+$/.test(clean)) {
    return { isValid: false, error: 'Code 128 contains invalid characters' };
  }
  return { isValid: true };
}

/**
 * General barcode validator: detects format and validates check digits.
 */
export function validateBarcode(barcode: string): {
  isValid: boolean;
  format: BarcodeFormat | 'UNKNOWN';
  error?: string;
} {
  const clean = (barcode || '').trim();
  if (!clean) {
    return { isValid: false, format: 'UNKNOWN', error: 'Barcode cannot be empty' };
  }

  // 13 digits -> EAN-13
  if (/^\d{13}$/.test(clean)) {
    const res = validateEAN13(clean);
    return { isValid: res.isValid, format: 'EAN_13', error: res.error };
  }

  // 12 digits -> UPC-A
  if (/^\d{12}$/.test(clean)) {
    const res = validateUPCA(clean);
    return { isValid: res.isValid, format: 'UPC_A', error: res.error };
  }

  // 8 digits -> EAN-8
  if (/^\d{8}$/.test(clean)) {
    const res = validateEAN8(clean);
    return { isValid: res.isValid, format: 'EAN_8', error: res.error };
  }

  // 6 or 7 digits -> UPC-E
  if (/^\d{6,7}$/.test(clean)) {
    const res = validateUPCE(clean);
    return { isValid: res.isValid, format: 'UPC_E', error: res.error };
  }

  // Alphanumeric with letters/hyphens -> Code 128
  if (/^[A-Za-z0-9\-_.]+$/.test(clean)) {
    const res = validateCode128(clean);
    return { isValid: res.isValid, format: 'CODE_128', error: res.error };
  }

  return {
    isValid: false,
    format: 'UNKNOWN',
    error: 'Unrecognized barcode format. Must be EAN-13, EAN-8, UPC-A, UPC-E, or Code 128',
  };
}

/**
 * Calculates check digit for a 12-digit number to make a valid EAN-13
 */
export function calculateEAN13CheckDigit(twelveDigits: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(twelveDigits[i], 10);
    sum += i % 2 === 0 ? digit * 1 : digit * 3;
  }
  const remainder = sum % 10;
  return remainder === 0 ? 0 : 10 - remainder;
}

/**
 * Calculates check digit for an 11-digit number to make a valid UPC-A
 */
export function calculateUPCACheckDigit(elevenDigits: string): number {
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const digit = parseInt(elevenDigits[i], 10);
    sum += i % 2 === 0 ? digit * 3 : digit * 1;
  }
  const remainder = sum % 10;
  return remainder === 0 ? 0 : 10 - remainder;
}

/**
 * Calculates check digit for a 7-digit number to make a valid EAN-8
 */
export function calculateEAN8CheckDigit(sevenDigits: string): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const digit = parseInt(sevenDigits[i], 10);
    sum += i % 2 === 0 ? digit * 3 : digit * 1;
  }
  const remainder = sum % 10;
  return remainder === 0 ? 0 : 10 - remainder;
}
