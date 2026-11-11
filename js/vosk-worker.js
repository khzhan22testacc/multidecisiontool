// Wrapper for the Vosk recognizer worker: blocks every request that is not to
// this app's own origin, then loads the engine. Audio never leaves the phone.
import '../vendor/vosk/vosk.worker.js';

const ORIGIN = self.location.origin;
const realFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : (input.url || String(input)), self.location.href);
  if (url.origin !== ORIGIN) return Promise.reject(new Error('Blocked off-device request: ' + url.origin));
  return realFetch(input, init);
};
self.WebSocket = undefined;
self.XMLHttpRequest = undefined;
self.EventSource = undefined;
