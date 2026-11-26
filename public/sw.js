// Smart Cart Service Worker — Offline & Flaky-Network Caching for Critical Assets, Images, and Fonts
const CACHE_VERSION = 'v8';
const STATIC_CACHE = `smartcart-static-${CACHE_VERSION}`;
const FONTS_CACHE = `smartcart-fonts-${CACHE_VERSION}`;
const IMAGES_CACHE = `smartcart-images-${CACHE_VERSION}`;
const CATALOG_CACHE = `smartcart-catalog-${CACHE_VERSION}`;

const ACTIVE_CACHES = new Set([
  STATIC_CACHE,
  FONTS_CACHE,
  IMAGES_CACHE,
  CATALOG_CACHE,
]);

const MAX_FONT_ENTRIES = 30;
const MAX_IMAGE_ENTRIES = 100;
const MAX_CATALOG_ENTRIES = 40;

// Critical shell assets & PWA icons pre-cached during install
const CORE_ASSETS = [
  '/',
  '/about',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/favicon.ico',
  '/icon.svg',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/images/rewards/smartcart-tshirt.svg',
  '/images/rewards/smartcart-hoodie.svg',
  '/images/rewards/smartcart-cap.svg',
];

const PUBLIC_CATALOG_PREFIXES = [
  '/api/shopper/branch-products/',
  '/api/supermarkets',
  '/api/branches',
  '/api/products',
];

function fetchWithTimeout(request, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
      const excess = keys.length - maxEntries;
      await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
    }
  } catch {
    // Ignore storage trim errors
  }
}

function isCacheableResponse(response) {
  return Boolean(response && (response.ok || response.type === 'opaque'));
}

function isFontRequest(request, url) {
  if (request.destination === 'font') return true;
  if (
    url.origin === 'https://fonts.googleapis.com' ||
    url.origin === 'https://fonts.gstatic.com'
  ) {
    return true;
  }
  return /\.(?:woff2?|ttf|otf|eot)(?:\?.*)?$/i.test(url.pathname);
}

function isImageRequest(request, url) {
  if (request.destination === 'image') return true;
  return /\.(?:png|jpe?g|webp|gif|svg|ico|avif)(?:\?.*)?$/i.test(url.pathname);
}

function isPublicCatalogApi(url) {
  return PUBLIC_CATALOG_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isCriticalStaticAsset(request, url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === '/sw.js') return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'manifest' ||
    request.destination === 'worker'
  ) {
    return true;
  }
  return (
    url.pathname.startsWith('/assets/') ||
    /\.(?:js|mjs|css|json)(?:\?.*)?$/i.test(url.pathname)
  );
}

// Install: Pre-cache critical shell assets and icons resiliently
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      await Promise.allSettled(
        CORE_ASSETS.map(async (assetUrl) => {
          const response = await fetch(assetUrl, { cache: 'reload' });
          if (response.ok) {
            await cache.put(assetUrl, response);
          }
        })
      );
    })
  );
});

// Activate: Remove outdated cache versions and take control immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (!ACTIVE_CACHES.has(key)) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        })
      )
    )
  );
  self.clients.claim();
});

// Optional message handler to trigger immediate activation
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch routing for offline & flaky networks
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle HTTP/HTTPS GET requests; never cache service worker itself
  if (!url.protocol.startsWith('http') || request.method !== 'GET' || url.pathname === '/sw.js') {
    return;
  }

  // 1. Navigation / HTML requests: Network-First (with timeout) -> Cached Shell -> Offline Page
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetchWithTimeout(request, 4500)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request);
          if (cachedPage) return cachedPage;

          const cachedRoot = await caches.match('/');
          if (cachedRoot) return cachedRoot;

          const cachedIndex = await caches.match('/index.html');
          if (cachedIndex) return cachedIndex;

          const offlinePage = await caches.match('/offline.html');
          if (offlinePage) return offlinePage;

          return new Response('You are offline. Please check your connection and try again.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        })
    );
    return;
  }

  // 2. Fonts (Google Fonts CSS + WOFF2/TTF files): Cache-First with background refresh
  if (isFontRequest(request, url)) {
    event.respondWith(
      caches.open(FONTS_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetchWithTimeout(request, 5000)
          .then((networkResponse) => {
            if (isCacheableResponse(networkResponse)) {
              cache.put(request, networkResponse.clone()).then(() => trimCache(FONTS_CACHE, MAX_FONT_ENTRIES));
            }
            return networkResponse;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkPromise);
          return cached;
        }

        const fresh = await networkPromise;
        return fresh || new Response('', { status: 504, statusText: 'Font unavailable offline' });
      })
    );
    return;
  }

  // 3. Images (Icons, brand logos, product thumbnails): Cache-First with background refresh & SVG fallback
  if (isImageRequest(request, url)) {
    event.respondWith(
      caches.open(IMAGES_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetchWithTimeout(request, 5000)
          .then((networkResponse) => {
            if (isCacheableResponse(networkResponse)) {
              cache.put(request, networkResponse.clone()).then(() => trimCache(IMAGES_CACHE, MAX_IMAGE_ENTRIES));
            }
            return networkResponse;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkPromise);
          return cached;
        }

        const fresh = await networkPromise;
        if (fresh) return fresh;

        const fallbackIcon = await caches.match('/icon.svg');
        return fallbackIcon || new Response('', { status: 504, statusText: 'Image unavailable offline' });
      })
    );
    return;
  }

  // 4. Public Branch & Product Catalog APIs: Network-First (4s timeout) -> Cached Catalog Fallback
  // Authenticated user endpoints (cart, loyalty, lists, auth, admin, owner, cashier) bypass SW cache.
  if (url.pathname.startsWith('/api/')) {
    if (!isPublicCatalogApi(url)) {
      return;
    }

    event.respondWith(
      fetchWithTimeout(request, 4000)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches
              .open(CATALOG_CACHE)
              .then((cache) => cache.put(request, copy).then(() => trimCache(CATALOG_CACHE, MAX_CATALOG_ENTRIES)));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;

          return new Response(
            JSON.stringify({ error: 'offline', offline: true, message: 'Working offline' }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
            }
          );
        })
    );
    return;
  }

  // 5. Critical JS/CSS/Manifest/Static Assets: Stale-While-Revalidate
  if (isCriticalStaticAsset(request, url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetchWithTimeout(request, 4500)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkPromise);
          return cached;
        }

        const fresh = await networkPromise;
        return fresh || new Response('', { status: 504, statusText: 'Asset unavailable offline' });
      })
    );
  }
});
