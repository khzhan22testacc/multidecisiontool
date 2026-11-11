// IMcalc interface. Patient values live only in the `values` object below:
// never written to storage, never put in a URL, never sent anywhere.
import { VAR } from './variables.js';
import { SCORES, SCORE, CATEGORIES } from './scores.js';
import { requiredInputs, evaluate, rangeWarning, resolve } from './engine.js';
import { parseDictation } from './parser.js';
import * as speech from './speech.js';
import * as voice from './voice.js';
import { interpret } from './spoken.js';

// ---------- state
const PREF_KEY = 'imcalc.selectedTools'; // tool ids only; no patient data
let selected = loadSelection();
let values = {};                          // in memory only
let tab = selected.length ? 'values' : 'tools';
let dict = { text: '', chips: [], msg: '', progress: null, state: 'idle' };
let filter = '';
// Guided voice entry. queue holds variable ids; idx is the field being asked.
let guided = { on: false, loading: false, queue: [], idx: 0, single: false, partial: '', last: null, msg: '' };
let showSentence = false;

function loadSelection() {
  try {
    const ids = JSON.parse(localStorage.getItem(PREF_KEY) || '[]');
    return ids.filter(id => SCORE[id]);
  } catch { return []; }
}
function saveSelection() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(selected)); } catch { /* private mode */ }
}

// ---------- tiny DOM helper (no innerHTML anywhere)
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const view = document.getElementById('view');

// ---------- derived
const isEmpty = id => values[id] === undefined || values[id] === null || values[id] === '';
const stillNeeded = v => !v.optional && v.kind !== 'bool' && isEmpty(v.id) && v.def === undefined;
function missingCount() {
  return requiredInputs(selected).reduce((n, g) => n + g.vars.filter(stillNeeded).length, 0);
}
function results() { return selected.map(id => evaluate(id, values)); }

function updateBadges() {
  const res = results();
  const m = missingCount();
  document.getElementById('badge-tools').textContent = selected.length ? `(${selected.length})` : '';
  document.getElementById('badge-values').textContent = selected.length ? (m ? `(${m} left)` : '(done)') : '';
  document.getElementById('badge-results').textContent =
    selected.length ? `(${res.filter(r => r.result).length}/${res.length})` : '';
  for (const b of document.querySelectorAll('.tab')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
  }
}

function go(t) { tab = t; render(); view.focus({ preventScroll: true }); window.scrollTo(0, 0); }

function render() {
  if (tab !== 'values' && guided.on) { voice.stop(); guided = { ...guided, on: false, queue: [], idx: 0, last: null }; }
  view.replaceChildren(...(tab === 'tools' ? toolsView() : tab === 'values' ? valuesView() : resultsView()));
  updateBadges();
  const cur = guided.on && document.querySelector('.field.cur');
  if (cur) {
    const r = cur.getBoundingClientRect(), panel = document.querySelector('.voice.live');
    const top = panel ? panel.getBoundingClientRect().bottom + 8 : 80;
    if (r.top < top || r.bottom > window.innerHeight - 90) {
      window.scrollBy({ top: r.top - top - 8, behavior: 'smooth' });
    }
  }
}

// ---------- 1. tools
function toolsView() {
  const q = filter.trim().toLowerCase();
  const out = [
    h('input', {
      class: 'search', type: 'search', placeholder: 'Search tools', 'aria-label': 'Search tools',
      autocomplete: 'off', value: filter,
      oninput: e => { filter = e.target.value; renderToolList(); },
    }),
    h('div', { id: 'tool-list' }, toolList(q)),
    h('button', { class: 'btn wide', type: 'button', id: 'to-values', disabled: !selected.length, onclick: () => go('values') },
      selected.length ? `Enter values for ${selected.length} ${selected.length === 1 ? 'tool' : 'tools'}` : 'Select at least one tool'),
    h('div', { class: 'foot' },
      h('p', {}, 'Privacy: values you enter stay in this screen\'s memory and are erased when you tap New patient or close the app. ' +
        'Speech is transcribed on this phone. The only thing remembered between sessions is which tools you ticked.'),
      h('p', {}, 'Decision support for trained clinicians. Units are SI (Canadian). Confirm inputs and apply clinical judgment.')),
  ];
  return out;
}
function toolList(q) {
  const blocks = [];
  for (const c of CATEGORIES) {
    const list = SCORES.filter(s => s.cat === c.id && (!q || (s.name + ' ' + s.about).toLowerCase().includes(q)));
    if (!list.length) continue;
    blocks.push(h('h2', {}, c.label));
    blocks.push(h('div', { class: 'card' }, list.map(s => {
      const on = selected.includes(s.id);
      return h('button', { class: 'row', type: 'button', 'aria-pressed': String(on), onclick: () => toggleTool(s.id) },
        h('span', { class: 'check', 'aria-hidden': 'true' }, '✓'),
        h('span', { class: 'grow' }, h('span', { class: 'name' }, s.name), h('br'), h('span', { class: 'hint' }, s.about)));
    })));
  }
  if (!blocks.length) blocks.push(h('p', { class: 'empty' }, 'No tools match that search.'));
  return blocks;
}
function renderToolList() {
  document.getElementById('tool-list').replaceChildren(...toolList(filter.trim().toLowerCase()));
}
function toggleTool(id) {
  selected = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id];
  // keep the display order stable (registry order)
  selected = SCORES.map(s => s.id).filter(x => selected.includes(x));
  saveSelection();
  renderToolList();
  const b = document.getElementById('to-values');
  b.disabled = !selected.length;
  b.textContent = selected.length ? `Enter values for ${selected.length} ${selected.length === 1 ? 'tool' : 'tools'}` : 'Select at least one tool';
  updateBadges();
}

// ---------- 2. values
function valuesView() {
  if (!selected.length) return [h('p', { class: 'empty' }, 'Pick the tools you need first.'),
    h('button', { class: 'btn wide', type: 'button', onclick: () => go('tools') }, 'Choose tools')];
  const groups = requiredInputs(selected);
  const out = [h('h2', {}, 'Voice entry'), voiceCard()];
  if (showSentence) out.push(dictationCard());
  for (const g of groups) {
    out.push(h('h2', {}, g.label));
    out.push(h('div', { class: 'card' }, g.vars.map(field)));
  }
  out.push(h('button', { class: 'btn wide', type: 'button', onclick: () => go('results') }, 'See results'));
  return out;
}

function usedBy(v) {
  const extra = v.optional ? 'Optional. ' : '';
  return extra + (v.usedBy.length > 1 ? `Used by ${v.usedBy.length} tools` : v.usedBy[0]);
}

function field(v) {
  if (v.kind === 'num') {
    const warn = h('div', { class: 'warn', role: 'status' }, rangeWarning(v.id, values[v.id]));
    const row = h('div', { class: 'field' + (stillNeeded(v) ? ' need' : '') + curClass(v.id), 'data-var': v.id });
    const input = h('input', {
      type: 'text', inputmode: 'decimal', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
      id: 'in-' + v.id, 'aria-label': `${v.label}${v.unit ? ', ' + v.unit : ''}`,
      placeholder: v.def !== undefined ? String(v.def) : '',
      value: isEmpty(v.id) ? '' : String(values[v.id]),
      oninput: e => {
        const x = parseFloat(e.target.value.replace(',', '.'));
        values[v.id] = Number.isFinite(x) ? x : undefined;
        warn.textContent = rangeWarning(v.id, values[v.id]);
        row.classList.toggle('need', stillNeeded(v));
        updateBadges();
      },
    });
    row.append(
      h('div', { class: 'grow' }, h('div', { class: 'name' }, v.label),
        h('div', { class: 'hint' }, [v.hint, usedBy(v)].filter(Boolean).join(' · ')), warn),
      h('div', { class: 'numwrap' }, input, h('span', { class: 'unit' }, v.unit)), micButton(v));
    return row;
  }
  if (v.kind === 'bool') {
    const cur = resolve(values, v.id) === true;
    const mk = (label, val) => h('button', {
      type: 'button', 'aria-pressed': String(cur === val),
      onclick: e => {
        values[v.id] = val;
        for (const b of e.target.parentNode.children) b.setAttribute('aria-pressed', String(b === e.target));
        updateBadges();
      },
    }, label);
    return h('div', { class: 'field' + curClass(v.id), 'data-var': v.id },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, v.label),
        h('div', { class: 'hint' }, [v.hint, usedBy(v)].filter(Boolean).join(' · '))),
      h('div', { class: 'yn', role: 'group', 'aria-label': v.label }, mk('No', false), mk('Yes', true)), micButton(v));
  }
  // choice
  const row = h('div', { class: 'field col' + (stillNeeded(v) ? ' need' : '') + curClass(v.id), 'data-var': v.id });
  row.append(
    h('div', { class: 'choice-head' }, h('div', { class: 'name' }, v.label), micButton(v)),
    h('div', { class: 'hint' }, [v.hint, usedBy(v)].filter(Boolean).join(' · ')),
    h('div', { class: 'seg', role: 'group', 'aria-label': v.label }, v.options.map(([val, label], i) => h('button', {
      type: 'button', 'aria-pressed': String(values[v.id] === val),
      onclick: e => {
        values[v.id] = val;
        for (const b of e.target.parentNode.children) b.setAttribute('aria-pressed', String(b === e.target));
        row.classList.remove('need');
        updateBadges();
      },
    }, guided.on && guided.queue[guided.idx] === v.id ? `${i + 1}. ${label}` : label))));
  return row;
}

// ---------- dictation
function dictationCard() {
  const ta = h('textarea', {
    id: 'dict-text', rows: '2', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
    'aria-label': 'Dictated or typed values', placeholder: 'e.g. sodium 125, ALP 130, BP 110 over 70',
    oninput: e => { dict.text = e.target.value; },
  });
  ta.value = dict.text;
  const micLabel = dict.state === 'rec' ? 'Stop' : dict.state === 'busy' ? '…' : 'Speak';
  const card = h('div', { class: 'card pad' },
    h('div', { class: 'dict' },
      h('button', {
        id: 'mic', type: 'button', class: 'mic' + (dict.state === 'rec' ? ' rec' : dict.state === 'busy' ? ' busy' : ''),
        disabled: dict.state === 'busy', 'aria-label': dict.state === 'rec' ? 'Stop recording' : 'Start voice entry', onclick: onMic,
      }, micLabel),
      ta),
    dict.progress != null ? h('div', { class: 'bar' }, (() => { const i = h('i'); i.style.width = dict.progress + '%'; return i; })()) : null,
    h('div', { class: 'dict-actions' },
      h('span', { class: 'msg', role: 'status', id: 'dict-msg' }, dict.msg || 'Speech is processed on this phone.'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => applyDictation() }, 'Apply')),
    dict.chips.length ? h('div', { class: 'chips' }, dict.chips.map(c =>
      h('span', { class: 'chip' + (c.extra ? ' extra' : '') }, c.text))) : null);
  card.classList.add('sentence');
  return card;
}

function fmtValue(id, val) {
  const v = VAR[id];
  if (v.kind === 'choice') return `${v.label}: ${(v.options.find(o => o[0] === val) || [0, val])[1]}`;
  return `${v.label} ${val}${v.unit ? ' ' + v.unit : ''}`;
}

function applyDictation() {
  const { found } = parseDictation(dict.text);
  const needed = new Set(requiredInputs(selected).flatMap(g => g.vars.map(v => v.id)));
  for (const f of found) values[f.id] = f.value;
  dict.chips = found.map(f => ({ text: fmtValue(f.id, f.value), extra: !needed.has(f.id) }));
  dict.msg = found.length
    ? `Recorded ${found.length} ${found.length === 1 ? 'value' : 'values'}. Check them below.`
    : (dict.text.trim() ? 'No values recognised. Try "sodium 125" style phrases.' : 'Nothing to apply yet.');
  render();
}

async function onMic() {
  if (dict.state === 'rec') {
    dict.state = 'busy'; dict.msg = 'Transcribing on this phone…'; render();
    try {
      const text = await speech.stopAndTranscribe();
      dict.text = (dict.text.trim() ? dict.text.trim() + ', ' : '') + text;
      dict.state = 'idle'; dict.progress = null;
      applyDictation();
    } catch (err) {
      dict.state = 'idle'; dict.progress = null; dict.msg = voiceError(err); render();
    }
    return;
  }
  if (!speech.micSupported()) { dict.msg = 'This browser cannot record audio. Type the values instead.'; render(); return; }
  try {
    await speech.startRecording(() => { if (dict.state === 'rec') onMic(); });
    dict.state = 'rec'; dict.msg = 'Listening. Tap Stop when done.'; render();
    // Warm the speech model while the user talks.
    speech.loadModel(p => {
      const pct = Math.round(100 * p.loaded / p.total);
      if (p.file && /onnx$/.test(p.file) && pct !== dict.progress) {
        dict.progress = pct;
        const bar = document.querySelector('.bar i');
        if (bar) bar.style.width = pct + '%';
      }
    }).catch(() => { /* reported when transcription is attempted */ });
  } catch (err) {
    dict.state = 'idle';
    dict.msg = err && err.name === 'NotAllowedError'
      ? 'Microphone permission was declined. Allow it in site settings, or type the values.'
      : voiceError(err);
    render();
  }
}

function voiceError(err) {
  const m = String(err && err.message || err);
  if (/models?\/|Could not locate|404|local_files_only|not found/i.test(m)) {
    return 'Voice model is not installed with this copy of the app (see README). Typing still works.';
  }
  return 'Voice entry failed: ' + m + '. Typing still works.';
}


// ---------- guided voice entry
const curClass = id => (guided.on && guided.queue[guided.idx] === id ? ' cur' : '');

function pendingIds() {
  const ids = [];
  for (const g of requiredInputs(selected)) {
    for (const v of g.vars) {
      if (v.kind === 'num' && isEmpty(v.id) && v.def === undefined) ids.push(v.id);
      else if (v.kind !== 'num' && isEmpty(v.id)) ids.push(v.id);
    }
  }
  return ids;
}

const ICON_MIC = 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z';
function micIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path'); path.setAttribute('d', ICON_MIC);
  svg.append(path);
  return svg;
}
function micButton(v) {
  const on = guided.on && guided.queue[guided.idx] === v.id;
  return h('button', {
    type: 'button', class: 'fmic' + (on ? ' on' : ''), 'aria-label': `Say ${v.label}`,
    onclick: () => startGuided(v.id),
  }, micIcon());
}

function promptFor(v) {
  if (v.kind === 'bool') return 'Say "yes" or "no"';
  if (v.id === 'sex') return 'Say "male" or "female"';
  if (v.kind === 'choice') return 'Say the number: ' + v.options.map((o, i) => `${i + 1} ${o[1]}`).join(' · ');
  return 'Say the number' + (v.unit ? ` in ${v.unit}` : '');
}

function fmtCaptured(v, val) {
  if (v.kind === 'bool') return `${v.label}: ${val ? 'Yes' : 'No'}`;
  return fmtValue(v.id, val);
}

function voiceCard() {
  if (!guided.on) {
    const n = selected.length ? pendingIds().length : 0;
    return h('div', { class: 'card pad voice' },
      h('button', { class: 'btn wide-in', type: 'button', id: 'g-start', disabled: guided.loading, onclick: () => startGuided() },
        micIcon(), guided.loading ? ' Loading voice engine…' : ' Start voice entry'),
      h('p', { class: 'vhint', role: 'status', id: 'g-msg' }, guided.msg ||
        (n ? `Asks for the ${n} ${n === 1 ? 'value' : 'values'} still blank, one at a time. Say a number, or "skip", "back", "stop". You can also type in any field.`
          : 'All values are filled. Tap the mic beside a field to redo one, or type over it.')),
      h('button', { class: 'linkbtn', type: 'button', onclick: () => { showSentence = !showSentence; render(); } },
        showSentence ? 'Hide sentence dictation' : 'Or dictate a full sentence instead'));
  }
  const v = VAR[guided.queue[guided.idx]];
  const last = guided.last;
  return h('div', { class: 'card pad voice live' },
    h('div', { class: 'vtop' },
      h('span', { class: 'rec-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'step' }, guided.single ? 'Listening' : `Listening · ${guided.idx + 1} of ${guided.queue.length}`)),
    h('div', { class: 'vfield' }, v.label, v.unit && v.kind === 'num' ? h('small', {}, v.unit) : null),
    h('p', { class: 'vprompt' }, promptFor(v)),
    h('p', { class: 'vpartial', id: 'g-partial', 'aria-live': 'polite' }, guided.partial || '…'),
    last ? h('p', { class: 'vlast ' + last.kind, role: 'status' }, last.text) : null,
    h('div', { class: 'vbtns' },
      h('button', { class: 'btn ghost', type: 'button', disabled: guided.idx === 0, onclick: () => handleCommand('back') }, 'Back'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => handleCommand('skip') }, guided.single ? 'Cancel' : 'Skip'),
      h('button', { class: 'btn', type: 'button', onclick: () => handleCommand('stop') }, 'Stop')));
}

async function startGuided(fieldId) {
  if (guided.loading) return;
  if (guided.on) {
    // Already listening: jump to the tapped field.
    if (fieldId) {
      let i = guided.queue.indexOf(fieldId);
      if (i === -1) { guided.queue.splice(guided.idx + 1, 0, fieldId); i = guided.idx + 1; }
      guided.idx = i; guided.partial = ''; guided.last = null;
      render();
    }
    return;
  }
  const queue = fieldId ? [fieldId] : pendingIds();
  if (!queue.length) { guided.msg = 'Nothing left to fill. Tap the mic beside a field to redo one.'; render(); return; }
  if (!voice.supported()) { guided.msg = 'This browser cannot capture audio. Type the values instead.'; render(); return; }
  guided.loading = true; guided.msg = 'Loading voice engine (about 43 MB the first time, then offline)…'; render();
  try {
    await voice.start({
      onPartial: t => {
        guided.partial = t.replace(/\[unk\]/g, '').trim();
        const el = document.getElementById('g-partial');
        if (el) el.textContent = guided.partial || '…';
      },
      onFinal: onUtterance,
      onError: e => { stopGuided(voiceErrorText(e)); },
    });
    guided = { on: true, loading: false, queue, idx: 0, single: !!fieldId, partial: '', last: null, msg: '' };
  } catch (e) {
    guided.loading = false;
    guided.msg = e && e.name === 'NotAllowedError'
      ? 'Microphone permission was declined. Allow it in the app\'s site settings, or type the values.'
      : voiceErrorText(e);
  }
  render();
}

function voiceErrorText(e) {
  const m = String(e && e.message || e);
  if (/404|HTTP error|Failed to fetch|NetworkError/i.test(m)) {
    return 'The voice model is not available. Open the app once online after it is deployed (see README). Typing still works.';
  }
  return 'Voice entry stopped: ' + m + '. Typing still works.';
}

function stopGuided(msg = '') {
  if (held) { clearTimeout(held.timer); held = null; }
  voice.stop();
  guided = { on: false, loading: false, queue: [], idx: 0, single: false, partial: '', last: null, msg };
  render();
}

function filled(id) {
  const v = VAR[id];
  return !isEmpty(id) || (v.kind === 'num' && v.def !== undefined);
}

function advance() {
  guided.idx++;
  // Skip anything filled in by hand while the list was running.
  while (!guided.single && guided.idx < guided.queue.length && filled(guided.queue[guided.idx])) guided.idx++;
  guided.partial = '';
  if (guided.idx >= guided.queue.length) {
    const left = pendingIds().length;
    stopGuided(guided.single ? '' : (left ? `Finished the list. ${left} still blank (skipped).` : 'All done. Check the values, then see results.'));
    return false;
  }
  return true;
}

function handleCommand(cmd) {
  if (!guided.on) return;
  const id = guided.queue[guided.idx];
  if (cmd === 'stop') { stopGuided(); return; }
  if (cmd === 'skip') { guided.last = null; if (guided.single) { stopGuided(); return; } if (!advance()) return; }
  if (cmd === 'back') { guided.idx = Math.max(0, guided.idx - 1); guided.partial = ''; guided.last = null; }
  if (cmd === 'clear') { values[id] = undefined; guided.last = { kind: 'info', text: `${VAR[id].label} cleared` }; }
  render();
}

// The recognizer ends a phrase after a short pause, so "one ... twenty five"
// can arrive as two phrases. Number phrases are held briefly and joined.
const JOIN_MS = 700;
let held = null; // { text, timer }

function onUtterance(text) {
  if (!guided.on) return;
  const v = VAR[guided.queue[guided.idx]];
  const r = interpret(text, v);
  if (r.cmd) {
    if (held) {
      clearTimeout(held.timer);
      const t = held.text; held = null;
      if (r.cmd === 'back' || r.cmd === 'clear') { handleCommand(r.cmd); return; }
      commitUtterance(t);               // value first; it moves on by itself
      if (r.cmd === 'stop' && guided.on) handleCommand('stop');
      return;
    }
    handleCommand(r.cmd);
    return;
  }
  if (v.kind === 'num' && !r.none) {
    held = held ? { text: held.text + ' ' + text, timer: (clearTimeout(held.timer), 0) } : { text, timer: 0 };
    held.timer = setTimeout(() => { const t = held.text; held = null; commitUtterance(t); }, JOIN_MS);
    const el = document.getElementById('g-partial');
    if (el) el.textContent = held.text.replace(/\[unk\]/g, '').trim();
    return;
  }
  commitUtterance(text);
}

function commitUtterance(text) {
  if (!guided.on) return;
  const id = guided.queue[guided.idx], v = VAR[id];
  const r = interpret(text, v);
  if (r.cmd) { handleCommand(r.cmd); return; }
  if (r.none) {
    const heard = text.replace(/\[unk\]/g, '').trim();
    guided.partial = '';
    guided.last = { kind: 'bad', text: heard ? `Heard "${heard}". Try again.` : 'Didn\'t catch that. Try again.' };
    render();
    return;
  }
  values[id] = r.value;
  try { navigator.vibrate && navigator.vibrate(25); } catch { /* not supported */ }
  const warn = rangeWarning(id, r.value);
  if (warn) {
    // Keep the value but stay here so it can be repeated or confirmed with "skip".
    guided.partial = '';
    guided.last = { kind: 'warn', text: `${fmtCaptured(v, r.value)}. ${warn} Say it again, or "next" to keep it.` };
    render();
    return;
  }
  guided.last = { kind: 'ok', text: `✓ ${fmtCaptured(v, r.value)}` };
  if (guided.single) { stopGuided(`✓ ${fmtCaptured(v, r.value)}`); return; }
  advance() && render();
}

document.addEventListener('visibilitychange', () => { if (document.hidden && guided.on) stopGuided(); });

// ---------- 3. results
const TIER_LABEL = { low: 'Low', mod: 'Moderate', high: 'High', info: 'Info' };

function resultsView() {
  if (!selected.length) return [h('p', { class: 'empty' }, 'No tools selected.'),
    h('button', { class: 'btn wide', type: 'button', onclick: () => go('tools') }, 'Choose tools')];
  const res = results();
  const done = res.filter(r => r.result), waiting = res.filter(r => !r.result);
  const out = [];
  if (done.length) out.push(h('h2', {}, 'Results'), ...done.map(resultCard));
  if (waiting.length) {
    out.push(h('h2', {}, 'Waiting for values'));
    out.push(...waiting.map(r => h('div', { class: 'card res' },
      h('div', { class: 'res-head' }, h('h3', {}, r.score.name)),
      h('p', { class: 'res-missing' }, 'Needs: ' + r.missing.join(', ')))));
    out.push(h('button', { class: 'btn wide', type: 'button', onclick: () => go('values') }, 'Enter missing values'));
  }
  return out;
}

function resultCard({ score, result: r }) {
  const rows = [];
  for (const [label, p] of r.parts || []) {
    rows.push(h('tr', { class: p === 0 ? 'zero' : '' }, h('td', {}, label), h('td', {}, (p > 0 ? '+' : '') + p)));
  }
  for (const [label, text] of r.lines || []) rows.push(h('tr', {}, h('td', {}, label), h('td', { class: 'wrap' }, text)));
  return h('article', { class: 'card res' },
    h('div', { class: 'res-head' }, h('h3', {}, score.name),
      r.tier !== 'info' ? h('span', { class: `tag tier-${r.tier}` }, TIER_LABEL[r.tier]) : null),
    h('div', { class: 'res-val' }, r.value, r.unit ? h('small', {}, r.unit) : null),
    h('p', { class: `res-sum tier-${r.tier}` }, r.summary),
    rows.length ? h('table', {}, h('tbody', {}, rows)) : null,
    h('p', { class: 'note' }, r.note || ''));
}

// ---------- chrome
for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => go(b.dataset.tab));

const np = document.getElementById('new-patient');
let npArmed = null;
np.addEventListener('click', () => {
  if (!npArmed) {
    np.textContent = 'Tap again to clear';
    npArmed = setTimeout(() => { npArmed = null; np.textContent = 'New patient'; }, 3000);
    return;
  }
  clearTimeout(npArmed); npArmed = null; np.textContent = 'New patient';
  values = {};
  if (guided.on) voice.stop();
  guided = { on: false, loading: false, queue: [], idx: 0, single: false, partial: '', last: null, msg: '' };
  dict = { text: '', chips: [], msg: '', progress: null, state: dict.state === 'rec' ? 'rec' : 'idle' };
  go(selected.length ? 'values' : 'tools');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
    document.getElementById('status-line').textContent = 'On-device only. Nothing is saved or sent. Works offline.';
  }).catch(() => { /* still usable online */ });
}

const setHdr = () => document.documentElement.style.setProperty('--hdr', document.querySelector('.top').offsetHeight + 'px');
setHdr(); window.addEventListener('resize', setHdr);
render();
