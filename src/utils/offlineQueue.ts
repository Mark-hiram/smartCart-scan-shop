// Copyright (c) 2026 SmartCart Owner. All rights reserved.

import { Cart, EnrichedProduct } from '../types';

export type OfflineQueueActionType =
  | 'scan_add'
  | 'update_qty'
  | 'set_budget'
  | 'clear_cart'
  | 'lock_cart'
  | 'finish_cart';

export interface OfflineQueueOperation {
  id: string;
  seq: number;
  branchId: string;
  callerId: string;
  action: OfflineQueueActionType;
  barcode?: string;
  productName?: string;
  itemId?: string;
  quantity?: number;
  budgetLimit?: number | null;
  createdAt: string;
}

export type NewOfflineQueueOperation = Omit<OfflineQueueOperation, 'id' | 'seq' | 'createdAt'>;

interface CartSnapshotRecord {
  key: string;
  branchId: string;
  callerId: string;
  cart: Cart;
  updatedAt: string;
}

interface ProductCacheRecord {
  branchId: string;
  products: EnrichedProduct[];
  updatedAt: string;
}

const DB_NAME = 'smartcart_offline_db';
const DB_VERSION = 1;
const STORE_QUEUE = 'scan_queue';
const STORE_CARTS = 'cart_snapshots';
const STORE_PRODUCTS = 'product_cache';

const FALLBACK_QUEUE_KEY = 'smartcart_idb_fallback_queue';
const FALLBACK_CARTS_KEY = 'smartcart_idb_fallback_carts';
const FALLBACK_PRODUCTS_KEY = 'smartcart_idb_fallback_products';

let seqCounter = 0;

function hasIndexedDB(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

function openOfflineDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new Error('IndexedDB is not supported'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const queueStore = db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
        queueStore.createIndex('by_branch', 'branchId', { unique: false });
        queueStore.createIndex('by_caller', 'callerId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CARTS)) {
        db.createObjectStore(STORE_CARTS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        db.createObjectStore(STORE_PRODUCTS, { keyPath: 'branchId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

function readFallbackJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeFallbackJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

export function isNetworkOfflineError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  if (err instanceof TypeError) {
    return true;
  }
  if (err && typeof err === 'object' && 'name' in err) {
    const name = String((err as { name?: unknown }).name || '');
    if (name === 'AbortError' || name === 'TypeError') return true;
  }
  const msg =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message || '').toLowerCase()
      : String(err || '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('load failed') ||
    msg.includes('offline')
  );
}

export async function enqueueOfflineOperation(
  op: NewOfflineQueueOperation
): Promise<OfflineQueueOperation> {
  seqCounter += 1;
  const entry: OfflineQueueOperation = {
    ...op,
    id: `q_${Date.now()}_${seqCounter}_${Math.random().toString(36).slice(2, 7)}`,
    seq: Date.now() * 1000 + (seqCounter % 1000),
    createdAt: new Date().toISOString(),
  };

  try {
    const db = await openOfflineDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, 'readwrite');
      tx.objectStore(STORE_QUEUE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    const list = readFallbackJson<OfflineQueueOperation[]>(FALLBACK_QUEUE_KEY, []);
    list.push(entry);
    writeFallbackJson(FALLBACK_QUEUE_KEY, list);
  }

  return entry;
}

export async function getOfflineQueue(
  branchId: string,
  callerId: string
): Promise<OfflineQueueOperation[]> {
  try {
    const db = await openOfflineDB();
    const rows = await new Promise<OfflineQueueOperation[]>((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, 'readonly');
      const req = tx.objectStore(STORE_QUEUE).getAll();
      req.onsuccess = () => resolve((req.result || []) as OfflineQueueOperation[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows
      .filter((item) => item.branchId === branchId && item.callerId === callerId)
      .sort((a, b) => a.seq - b.seq);
  } catch {
    const list = readFallbackJson<OfflineQueueOperation[]>(FALLBACK_QUEUE_KEY, []);
    return list
      .filter((item) => item.branchId === branchId && item.callerId === callerId)
      .sort((a, b) => a.seq - b.seq);
  }
}

export async function removeOfflineQueueItem(id: string): Promise<void> {
  try {
    const db = await openOfflineDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, 'readwrite');
      tx.objectStore(STORE_QUEUE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    const list = readFallbackJson<OfflineQueueOperation[]>(FALLBACK_QUEUE_KEY, []);
    writeFallbackJson(
      FALLBACK_QUEUE_KEY,
      list.filter((item) => item.id !== id)
    );
  }
}

export async function clearOfflineQueueForBranch(
  branchId: string,
  callerId: string
): Promise<void> {
  const existing = await getOfflineQueue(branchId, callerId);
  await Promise.all(existing.map((op) => removeOfflineQueueItem(op.id)));
}

export async function saveOfflineCartSnapshot(
  branchId: string,
  callerId: string,
  cart: Cart
): Promise<void> {
  const key = `${callerId}::${branchId}`;
  const record: CartSnapshotRecord = {
    key,
    branchId,
    callerId,
    cart,
    updatedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(`offline_cart_${branchId}`, JSON.stringify(cart));
  } catch {
    // Ignore localStorage quota failures; IndexedDB is primary
  }

  try {
    const db = await openOfflineDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CARTS, 'readwrite');
      tx.objectStore(STORE_CARTS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    const map = readFallbackJson<Record<string, CartSnapshotRecord>>(FALLBACK_CARTS_KEY, {});
    map[key] = record;
    writeFallbackJson(FALLBACK_CARTS_KEY, map);
  }
}

export async function loadOfflineCartSnapshot(
  branchId: string,
  callerId: string
): Promise<Cart | null> {
  const key = `${callerId}::${branchId}`;
  try {
    const db = await openOfflineDB();
    const record = await new Promise<CartSnapshotRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_CARTS, 'readonly');
      const req = tx.objectStore(STORE_CARTS).get(key);
      req.onsuccess = () => resolve(req.result as CartSnapshotRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (record?.cart) return record.cart;
  } catch {
    const map = readFallbackJson<Record<string, CartSnapshotRecord>>(FALLBACK_CARTS_KEY, {});
    if (map[key]?.cart) return map[key].cart;
  }

  try {
    const legacyRaw = localStorage.getItem(`offline_cart_${branchId}`);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as Cart;
      if (parsed && parsed.branchId === branchId) return parsed;
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}

export async function saveOfflineBranchProducts(
  branchId: string,
  products: EnrichedProduct[]
): Promise<void> {
  const record: ProductCacheRecord = {
    branchId,
    products,
    updatedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(`offline_products_${branchId}`, JSON.stringify(products));
  } catch {
    // Ignore localStorage quota failures; IndexedDB is primary
  }

  try {
    const db = await openOfflineDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
      tx.objectStore(STORE_PRODUCTS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    const map = readFallbackJson<Record<string, ProductCacheRecord>>(FALLBACK_PRODUCTS_KEY, {});
    map[branchId] = record;
    writeFallbackJson(FALLBACK_PRODUCTS_KEY, map);
  }
}

export async function loadOfflineBranchProducts(
  branchId: string
): Promise<EnrichedProduct[] | null> {
  try {
    const db = await openOfflineDB();
    const record = await new Promise<ProductCacheRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readonly');
      const req = tx.objectStore(STORE_PRODUCTS).get(branchId);
      req.onsuccess = () => resolve(req.result as ProductCacheRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (record?.products) return record.products;
  } catch {
    const map = readFallbackJson<Record<string, ProductCacheRecord>>(FALLBACK_PRODUCTS_KEY, {});
    if (map[branchId]?.products) return map[branchId].products;
  }

  try {
    const legacyRaw = localStorage.getItem(`offline_products_${branchId}`);
    if (legacyRaw) return JSON.parse(legacyRaw) as EnrichedProduct[];
  } catch {
    // Ignore parse errors
  }

  return null;
}
