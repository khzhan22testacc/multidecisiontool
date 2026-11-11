// Speech-to-text worker. Runs Whisper entirely on the device through
// transformers.js + ONNX Runtime WebAssembly. Audio never leaves this thread.

// Hard stop on any network request that is not to this app's own origin.
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

const BASE = new URL('../', self.location.href);          // app root
const MODEL_ID = 'Xenova/whisper-tiny.en';
let transcriber = null;

async function load() {
  const { pipeline, env } = await import(new URL('vendor/transformers.min.js', BASE).href);
  env.allowRemoteModels = false;                 // never contact a model hub
  env.allowLocalModels = true;
  env.localModelPath = new URL('models/', BASE).pathname;
  env.useBrowserCache = false;                   // the service worker caches these files
  env.useWasmCache = false;
  env.backends.onnx.wasm.wasmPaths = new URL('vendor/', BASE).href;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: p => {
      if (p.status === 'progress' && p.total) {
        self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
      }
    },
  });
}

self.onmessage = async e => {
  const { type, id } = e.data;
  try {
    if (type === 'load') {
      if (!transcriber) await load();
      self.postMessage({ type: 'ready', id });
    } else if (type === 'transcribe') {
      if (!transcriber) await load();
      const out = await transcriber(e.data.audio, { chunk_length_s: 30 });
      self.postMessage({ type: 'result', id, text: (out.text || '').trim() });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err && err.message || err) });
  }
};
