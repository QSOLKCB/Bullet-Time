// Increment this revision whenever any cached runtime file changes.
const REVISION = 'v1.2.0-3';
// Scope-specific prefix: never touches caches of other games on the same origin.
const PREFIX = `bullet-time:${self.registration.scope}:`;
const CACHE = PREFIX + REVISION;
const FILES = ['./','./index.html','./style.css','./icon.svg','./manifest.webmanifest','./src/app.js','./src/math.js','./src/clock.js','./src/lead.js','./src/frame-gate.js','./src/world.js','./src/game.js','./src/renderer.js','./src/audio.js','./src/music.js','./src/controller.js','./src/navigation.js','./src/skins.js'];
const SKIN_FILES = ['./assets/skins/weapon-factory.svg','./assets/skins/weapon-ivory.svg','./assets/skins/weapon-ember.svg','./assets/skins/weapon-chrome.svg','./assets/skins/weapon-jade.svg','./assets/skins/weapon-tiger.svg','./assets/skins/enemy-syndicate.svg','./assets/skins/enemy-chrome.svg','./assets/skins/enemy-nightshift.svg','./assets/skins/enemy-masquerade.svg'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.concat(SKIN_FILES)))); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url), scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    if (event.request.mode === 'navigate' && (url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html')) return (await cache.match(new URL('./index.html', scope).href)) || fetch(event.request);
    return (await cache.match(event.request, {ignoreSearch:true})) || fetch(event.request);
  }));
});
