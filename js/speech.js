// Microphone capture + bridge to the on-device speech worker.
// Audio is held in memory only for the length of one dictation and then dropped.

let worker = null, seq = 0;
const pending = new Map();
let onProgress = () => {};

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./stt-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'progress') return onProgress(m);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m);
  };
  worker.onerror = e => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Speech worker failed'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function call(msg, transfer = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id }, transfer);
  });
}

export function loadModel(progressCb) {
  if (progressCb) onProgress = progressCb;
  return call({ type: 'load' });
}

export const micSupported = () =>
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

let rec = null, chunks = [], stream = null, stopTimer = null;

export async function startRecording(onAutoStop) {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  chunks = [];
  rec = new MediaRecorder(stream);
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.start();
  stopTimer = setTimeout(() => onAutoStop && onAutoStop(), 28000); // one Whisper window
}

export const isRecording = () => !!rec && rec.state === 'recording';

/** Stop, convert to 16 kHz mono, transcribe on-device, return text. */
export async function stopAndTranscribe() {
  clearTimeout(stopTimer);
  const blob = await new Promise(resolve => {
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType }));
    rec.stop();
  });
  stream.getTracks().forEach(t => t.stop());
  rec = null; stream = null; chunks = [];

  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 16000 });
  let audio;
  try {
    const decoded = await ctx.decodeAudioData(buf);
    audio = decoded.getChannelData(0);
    if (decoded.sampleRate !== 16000) audio = resample(audio, decoded.sampleRate, 16000);
    audio = new Float32Array(audio); // detach from the AudioBuffer
  } finally { ctx.close(); }

  const res = await call({ type: 'transcribe', audio }, [audio.buffer]);
  return res.text;
}

function resample(data, from, to) {
  const n = Math.round(data.length * to / from), out = new Float32Array(n), r = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * r, i0 = Math.floor(x), i1 = Math.min(i0 + 1, data.length - 1);
    out[i] = data[i0] + (data[i1] - data[i0]) * (x - i0);
  }
  return out;
}
