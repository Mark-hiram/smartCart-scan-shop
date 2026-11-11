// Smart Cart Service Worker for Robust Offline Mode & Asset Caching
const CACHE_VERSION = 'smartcart-v2';
const STATIC_CACHE = `smartcart-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `smartcart-dynamic-${CACHE_VERSION}`;
const API_CACHE = `smartcart-api-${CACHE_VERSION}`;

// Core UI assets to pre-cache on install
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icon.svg',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
];

// Pre-cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(CORE_ASSETS);
    })
  );
  self.skipWaiting();
});

// Clean up previous version caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== STATIC_CACHE && key !== DYNAMIC_CACHE && key !== API_CACHE) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Ignore non-HTTP/HTTPS and non-GET requests
  if (!url.protocol.startsWith('http') || request.method !== 'GET') {
    return;
  }

  // 1. HTML Page Navigation requests: Network First -> Cache -> Fallback to /offline.html
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request);
          if (cachedPage) return cachedPage;

          const cachedRoot = await caches.match('/');
          if (cachedRoot) return cachedRoot;

          const offlineFallback = await caches.match('/offline.html');
          if (offlineFallback) return offlineFallback;

          return new Response('You are currently offline. Please reconnect to internet.', {
            headers: { 'Content-Type': 'text/plain' },
          });
        })
    );
    return;
  }

  // 2. Product Catalogue & Store lookups: Network First, fallback to cached API response
  if (
    url.pathname.startsWith('/api/shopper') ||
    url.pathname.startsWith('/api/branches') ||
    url.pathname.startsWith('/api/supermarkets') ||
    url.pathname.startsWith('/api/products')
  ) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedApiResponse = await caches.match(request);
          if (cachedApiResponse) return cachedApiResponse;

          return new Response(JSON.stringify({ error: 'offline', offline: true, message: 'Working offline' }), {
            headers: { 'Content-Type': 'application/json' },
          });
        })
    );
    return;
  }

  // 3. Static assets (JS, CSS, fonts, icons, images): Cache First -> Network Fallback
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh in background to revalidate (Stale-While-Revalidate)
        fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, networkResponse));
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, responseToCache));
          return networkResponse;
        })
        .catch(() => {
          // If asset is an image, could return placeholder, otherwise match root
          if (request.destination === 'image') {
            return caches.match('/icon.svg');
          }
        });
    })
  );
});
