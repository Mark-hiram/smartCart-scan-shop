// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import {
  BudgetAlertLevel,
  CartBudgetSummary,
  EnrichedProduct,
  ShoppingListItem,
} from '../types';

export function computeBudgetSummary(
  cartTotal: number,
  budgetLimit?: number | null
): CartBudgetSummary {
  const spent = Math.max(0, Math.round((Number(cartTotal) || 0) * 100) / 100);
  const limit =
    typeof budgetLimit === 'number' && Number.isFinite(budgetLimit) && budgetLimit > 0
      ? Math.round(budgetLimit * 100) / 100
      : null;

  if (!limit) {
    return {
      limit: null,
      spent,
      remaining: null,
      overBy: 0,
      percent: null,
      level: 'none',
    };
  }

  const ratio = spent / limit;
  const percent = Math.round(ratio * 100);
  let level: BudgetAlertLevel = 'normal';
  if (ratio > 1.0) {
    level = 'over';
  } else if (ratio >= 0.8) {
    level = 'near';
  }

  return {
    limit,
    spent,
    remaining: Math.max(0, Math.round((limit - spent) * 100) / 100),
    overBy: Math.max(0, Math.round((spent - limit) * 100) / 100),
    percent,
    level,
  };
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function doesProductMatchListItem(
  item: Pick<ShoppingListItem, 'barcode' | 'productName'>,
  product: { barcode?: string; name: string }
): boolean {
  if (item.barcode && product.barcode && item.barcode.trim() === product.barcode.trim()) {
    return true;
  }

  const itemNorm = normalizeToken(item.productName || '');
  const prodNorm = normalizeToken(product.name || '');
  if (!itemNorm || !prodNorm) return false;
  if (itemNorm === prodNorm) return true;

  const itemWords = itemNorm.split(' ').filter((w) => w.length >= 2);
  const prodWords = prodNorm.split(' ').filter((w) => w.length >= 2);
  if (itemWords.length === 0 || prodWords.length === 0) return false;

  const prodWordSet = new Set(prodWords);
  // Match if every meaningful word typed by the shopper appears as a whole word in the scanned product name
  return itemWords.every((w) => prodWordSet.has(w));
}

export function formatAisleDisplayLabel(rawAisle?: string | null): string {
  const trimmed = (rawAisle || '').trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') return '';
  if (/^\d+[a-zA-Z]?$/.test(trimmed)) {
    return `Aisle ${trimmed}`;
  }
  return trimmed;
}

export function resolveListItemGroup(
  item: ShoppingListItem,
  products: EnrichedProduct[] = [],
  otherLabel = 'Other'
): string {
  const matchedProd =
    (item.barcode ? products.find((p) => p.barcode === item.barcode) : undefined) ||
    products.find((p) => doesProductMatchListItem(item, p));

  const effectiveAisle = formatAisleDisplayLabel(item.aisle || matchedProd?.aisle);
  if (effectiveAisle) {
    return effectiveAisle;
  }

  const effectiveCategory = (item.category || matchedProd?.category || '').trim();
  if (effectiveCategory) {
    return effectiveCategory;
  }

  return otherLabel;
}

function getGroupSortTuple(groupName: string, otherLabel = 'Other'): [number, number, string] {
  const normalized = groupName.trim();
  if (
    !normalized ||
    normalized.toLowerCase() === otherLabel.toLowerCase() ||
    normalized.toLowerCase() === 'other'
  ) {
    return [2, Number.MAX_SAFE_INTEGER, normalized.toLowerCase()];
  }

  const aisleNumMatch = normalized.match(/^(?:aisle\s*)?(\d+)/i);
  if (aisleNumMatch) {
    return [0, parseInt(aisleNumMatch[1], 10), normalized.toLowerCase()];
  }

  return [1, 0, normalized.toLowerCase()];
}

export interface ShoppingListAisleGroup {
  groupLabel: string;
  items: ShoppingListItem[];
}

export function groupAndOrderShoppingListItems(
  items: ShoppingListItem[],
  products: EnrichedProduct[] = [],
  otherLabel = 'Other'
): ShoppingListAisleGroup[] {
  const buckets = new Map<string, ShoppingListItem[]>();
  const displayKeyByLower = new Map<string, string>();

  for (const item of items) {
    const rawGroup = resolveListItemGroup(item, products, otherLabel);
    const lowerKey = rawGroup.toLowerCase();
    const canonicalGroup = displayKeyByLower.get(lowerKey) || rawGroup;
    if (!displayKeyByLower.has(lowerKey)) {
      displayKeyByLower.set(lowerKey, canonicalGroup);
    }
    const existing = buckets.get(canonicalGroup) || [];
    existing.push(item);
    buckets.set(canonicalGroup, existing);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => {
      const ta = getGroupSortTuple(a, otherLabel);
      const tb = getGroupSortTuple(b, otherLabel);
      if (ta[0] !== tb[0]) return ta[0] - tb[0];
      if (ta[1] !== tb[1]) return ta[1] - tb[1];
      return ta[2].localeCompare(tb[2]);
    })
    .map(([groupLabel, groupItems]) => ({
      groupLabel,
      items: groupItems,
    }));
}
