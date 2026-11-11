// Service worker: makes the app work with no connection.
// It only ever serves and caches this app's own files. It never sees patient
// values (those live in page memory and are not part of any request).
const CACHE = 'imcalc-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/engine.js', 'js/scores.js', 'js/variables.js', 'js/parser.js', 'js/speech.js', 'js/stt-worker.js',
  'js/spoken.js', 'js/voice.js', 'js/vosk-worker.js', 'js/mic-worklet.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(e.request);
    // Voice engine and model files are large, so they are cached the first time they are used.
    if (res.ok && res.status === 200) cache.put(e.request, res.clone());
    return res;
  })());
});
