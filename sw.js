const CACHE_NAME = 'bhavi-crm-v4';
const APP_SHELL = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

// Install — cache only external libs (NOT index.html)
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

// Fetch — always network for index.html, cache-first for CDN libs
self.addEventListener('fetch', function(e) {
  // Skip Supabase API calls — always network
  if (e.request.url.includes('supabase.co')) {
    return;
  }

  const url = new URL(e.request.url);
  const isIndexHtml = url.pathname === '/' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');

  // index.html — always fetch fresh, never cache
  if (isIndexHtml) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .catch(function() {
          return caches.match('./index.html');
        })
    );
    return;
  }

  // CDN resources — cache first, fallback network
  if (e.request.url.includes('cdnjs.cloudflare.com') || e.request.url.includes('fonts.')) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        return cached || fetch(e.request).then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else — network first
  e.respondWith(
    fetch(e.request)
      .catch(function() {
        return caches.match(e.request);
      })
  );
});
