// Dictation parser: turns free text such as "sodium 125, ALP 130, BP 110 over 70"
// into canonical variable values. Deterministic on purpose: a rule-based parser
// cannot invent a number that was not said.
import { VARIABLES, VAR } from './variables.js';

const SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// Spoken forms a speech model commonly produces for lab names.
const EXTRA_SYNONYMS = {
  bili: ['billy rubin', 'bili rubin', 'billirubin'],
  cr: ['creatinin', 'creatine'],
  hb: ['hemoglobin level'],
  k: [],
};

/** Convert spelled-out numbers to digits ("one hundred and twenty five" -> "125"). */
function wordsToDigits(text) {
  const tok = text.split(/\s+/);
  const out = [];
  let i = 0;
  const isNum = w => w in SMALL || w in TENS;
  while (i < tok.length) {
    const w = tok[i].replace(/[,.;]$/, '');
    if (!isNum(w)) { out.push(tok[i]); i++; continue; }
    let val, j = i;
    if (w in TENS) {
      val = TENS[w]; j++;
      const n = (tok[j] || '').replace(/[,.;]$/, '');
      if (n in SMALL && SMALL[n] > 0 && SMALL[n] < 10) { val += SMALL[n]; j++; }
    } else { val = SMALL[w]; j++; }
    if ((tok[j] || '').replace(/[,.;]$/, '') === 'hundred') {
      val *= 100; j++;
      if (tok[j] === 'and') j++;
      const a = (tok[j] || '').replace(/[,.;]$/, '');
      if (a in TENS) {
        val += TENS[a]; j++;
        const b = (tok[j] || '').replace(/[,.;]$/, '');
        if (b in SMALL && SMALL[b] > 0 && SMALL[b] < 10) { val += SMALL[b]; j++; }
      } else if (a in SMALL) { val += SMALL[a]; j++; } else if (tok[j - 1] === 'and') j--;
    }
    out.push(String(val));
    i = j;
  }
  return out.join(' ');
}

export function normalize(raw) {
  let t = ' ' + raw.toLowerCase() + ' ';
  t = t.replace(/[₂]/g, '2').replace(/[–—]/g, '-');
  // "a.l.p." / "a l p" / "a-l-p" -> "alp"
  t = t.replace(/\b(?:[a-z][.\s-]){1,5}[a-z]\b\.?/g, m => {
    const letters = m.match(/[a-z]/g);
    return m.split(/[.\s-]+/).filter(Boolean).every(x => x.length === 1) ? letters.join('') + ' ' : m;
  });
  t = t.replace(/(\d),(\d{3})\b/g, '$1$2');
  t = wordsToDigits(t);
  t = t.replace(/(\d+)\s+point\s+(\d+)/g, '$1.$2');   // "4 point 1" -> "4.1"
  t = t.replace(/\bpoint\s+(\d+)/g, '0.$1');          // "point 9" -> "0.9"
  return t.replace(/\s+/g, ' ');
}

const SYN = [];
for (const v of VARIABLES) {
  if (v.kind !== 'num') continue;
  for (const s of [...(v.syn || []), ...(EXTRA_SYNONYMS[v.id] || [])]) SYN.push([s, v.id]);
}
SYN.sort((a, b) => b[0].length - a[0].length);
const SYN_TO_ID = new Map(SYN);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUM = '(\\d+(?:\\.\\d+)?)';
const VALUE_RE = new RegExp(
  `\\b(${SYN.map(s => esc(s[0])).join('|')})\\b(?:\\s+(?:is|was|of|at|level|equals?|to|around|about))*\\s*[:=]?\\s*${NUM}`, 'g');

/**
 * @returns {{found: {id:string, value:number|string, label:string}[], text:string}}
 */
export function parseDictation(raw) {
  const found = new Map();
  let t = normalize(raw);

  // Blood pressure as a pair.
  t = t.replace(/\b(?:bp|blood pressure|pressure)\b[^0-9]{0,12}(\d{2,3})\s*(?:\/|over|on)\s*(\d{2,3})/g, (m, s, d) => {
    found.set('sbp', +s); found.set('dbp', +d); return ' ';
  });
  // "67 year old"
  t = t.replace(/(\d{1,3})\s*-?\s*(?:years?|yrs?|yo|y\/o)\b(?:\s*-?\s*old)?/g, (m, a) => { found.set('age', +a); return ' '; });
  // Sex
  if (/\b(female|woman|lady)\b/.test(t)) found.set('sex', 'F');
  else if (/\b(male|man|gentleman)\b/.test(t)) found.set('sex', 'M');

  for (const m of t.matchAll(VALUE_RE)) found.set(SYN_TO_ID.get(m[1]), +m[2]);

  return {
    text: t.trim(),
    found: [...found].map(([id, value]) => ({ id, value, label: VAR[id].label })),
  };
}
