// Service worker minimal : l'interface de l'application reste disponible hors connexion.
// Les requêtes vers l'API (/v1/…) ne sont JAMAIS mises en cache : un solde ou une confirmation périmés seraient dangereux.
const SHELL = 'ma-banque-v1';
const FILES = ['/mobile', '/assistant.css', '/assistant.js', '/sdk.js', '/icon.svg', '/manifest.webmanifest'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES))));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/v1/')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
