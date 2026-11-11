// IMcalc interface. Patient values live only in the `values` object below:
// never written to storage, never put in a URL, never sent anywhere.
import { VAR } from './variables.js';
import { SCORES, SCORE, CATEGORIES } from './scores.js';
import { requiredInputs, evaluate, rangeWarning, resolve } from './engine.js';
import { parseDictation } from './parser.js';
import * as speech from './speech.js';

// ---------- state
const PREF_KEY = 'imcalc.selectedTools'; // tool ids only; no patient data
let selected = loadSelection();
let values = {};                          // in memory only
let tab = selected.length ? 'values' : 'tools';
let dict = { text: '', chips: [], msg: '', progress: null, state: 'idle' };
let filter = '';

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
  view.replaceChildren(...(tab === 'tools' ? toolsView() : tab === 'values' ? valuesView() : resultsView()));
  updateBadges();
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
  const out = [h('h2', {}, 'Dictate or type'), dictationCard()];
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
    const row = h('div', { class: 'field' + (stillNeeded(v) ? ' need' : ''), 'data-var': v.id });
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
      h('div', { class: 'numwrap' }, input, h('span', { class: 'unit' }, v.unit)));
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
    return h('div', { class: 'field', 'data-var': v.id },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, v.label),
        h('div', { class: 'hint' }, [v.hint, usedBy(v)].filter(Boolean).join(' · '))),
      h('div', { class: 'yn', role: 'group', 'aria-label': v.label }, mk('No', false), mk('Yes', true)));
  }
  // choice
  const row = h('div', { class: 'field col' + (stillNeeded(v) ? ' need' : ''), 'data-var': v.id });
  row.append(
    h('div', { class: 'name' }, v.label),
    h('div', { class: 'hint' }, [v.hint, usedBy(v)].filter(Boolean).join(' · ')),
    h('div', { class: 'seg', role: 'group', 'aria-label': v.label }, v.options.map(([val, label]) => h('button', {
      type: 'button', 'aria-pressed': String(values[v.id] === val),
      onclick: e => {
        values[v.id] = val;
        for (const b of e.target.parentNode.children) b.setAttribute('aria-pressed', String(b === e.target));
        row.classList.remove('need');
        updateBadges();
      },
    }, label))));
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
  dict = { text: '', chips: [], msg: '', progress: null, state: dict.state === 'rec' ? 'rec' : 'idle' };
  go(selected.length ? 'values' : 'tools');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
    document.getElementById('status-line').textContent = 'On-device only. Nothing is saved or sent. Works offline.';
  }).catch(() => { /* still usable online */ });
}

render();
