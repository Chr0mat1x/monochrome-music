/* MONOCHROME service worker — app-shell caching so the phone can install and
 * reopen the UI offline. Audio (/api) and cross-origin API calls always go to
 * the network; this only caches the shell and hashed build assets. */
const CACHE = 'monochrome-v6'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

/**
 * Only build output is worth caching: Vite emits content-hashed files under
 * /assets/, so a stale entry can never shadow a newer build. Anything else —
 * dev-server modules (/src/…, /@vite/…, /node_modules/…) and any un-hashed
 * path — must go straight to the network, because caching it would pin an old
 * module in place and leave the app serving stale code.
 */
const CACHEABLE = /^\/(assets\/|icon-|favicon-|apple-touch-icon|manifest\.webmanifest$)/

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Only our own origin; never cache the audio server or third-party APIs.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Navigations: network first, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/index.html', copy))
          return res
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    )
    return
  }

  if (!CACHEABLE.test(url.pathname)) return

  // Hashed assets: cache, then serve stale while revalidating.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy))
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
