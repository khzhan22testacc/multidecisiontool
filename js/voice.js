// Guided voice entry engine: Vosk (Kaldi) running on the phone, restricted to
// number words and a few commands. Streams partial text while you speak and
// emits a final phrase after a short pause.
import { GRAMMAR } from './spoken.js';

const BASE = new URL('../', import.meta.url);
const MODEL_URL = new URL('models/vosk-model-small-en-us-0.15.tar.gz', BASE).href;
let clientPromise = null;

function loadClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const { VoskClient } = await import(new URL('vendor/vosk/vosk.wasm.js', BASE).href);
    const client = new VoskClient({
      modelUrl: MODEL_URL,
      workerUrl: new URL('js/vosk-worker.js', BASE).href,
      wasmUrl: new URL('vendor/vosk/vosk.wasm', BASE).href,
      logLevel: -1,
    });
    try {
      await new Promise((resolve, reject) => {
        client.on('load', m => (m.result ? resolve() : reject(new Error('Voice model failed to load'))));
        client.on('error', m => reject(new Error(m.error || 'Voice engine error')));
        client.worker.addEventListener('error', e => reject(new Error(e.message || 'Voice engine failed to start')));
      });
    } catch (e) {
      try { client.worker.terminate(); } catch { /* ignore */ }
      throw e;
    }
    return client;
  })();
  clientPromise.catch(() => { clientPromise = null; });
  return clientPromise;
}

export const supported = () =>
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.AudioWorkletNode);

/** Download (first time) and start the voice engine without opening the mic. */
export const warmUp = () => loadClient();

let session = null;

/**
 * Open the mic and start recognising.
 * @param {{onPartial:(t:string)=>void, onFinal:(t:string)=>void, onError:(e:Error)=>void}} cb
 */
export async function start(cb) {
  if (session) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  let client;
  try { client = await loadClient(); } catch (e) { stream.getTracks().forEach(t => t.stop()); throw e; }
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(new URL('./mic-worklet.js', import.meta.url).href);
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'mic-capture');
  const rec = new client.KaldiRecognizer(ctx.sampleRate, GRAMMAR);
  rec.on('partialresult', m => { const t = m && m.result && m.result.partial; if (t !== undefined) cb.onPartial(t); });
  rec.on('result', m => { const t = m && m.result && m.result.text; if (t) cb.onFinal(t); });
  rec.on('error', m => cb.onError(new Error((m && m.error) || 'Recognition error')));
  node.port.onmessage = e => { if (session) rec.acceptWaveformFloat(e.data, ctx.sampleRate); };
  src.connect(node);
  session = { stream, ctx, node, src, rec };
}

export const active = () => !!session;

export function stop() {
  if (!session) return;
  const { stream, ctx, node, src, rec } = session;
  session = null;
  try { src.disconnect(); node.disconnect(); } catch { /* already gone */ }
  stream.getTracks().forEach(t => t.stop());
  ctx.close();
  try { rec.remove(); } catch { /* worker gone */ }
}
