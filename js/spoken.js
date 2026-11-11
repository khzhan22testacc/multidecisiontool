// Spoken-number and command interpretation for guided voice entry.
// The recognizer is restricted to the words in GRAMMAR, so anything it hears
// is one of these words; this module turns them into a value or a command.

const UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

export const COMMANDS = {
  skip: 'skip', next: 'skip',
  back: 'back', previous: 'back',
  stop: 'stop', done: 'stop', finish: 'stop',
  clear: 'clear',
};
const ANSWERS = { yes: true, no: false };
const SEX = { male: 'M', female: 'F', man: 'M', woman: 'F' };

const NUMBER_WORDS = [...Object.keys(UNITS), ...Object.keys(TEENS), ...Object.keys(TENS), 'hundred', 'thousand', 'point', 'and'];

/** Vosk grammar: the only words the recognizer may output. */
export const GRAMMAR = JSON.stringify([
  ...NUMBER_WORDS, ...Object.keys(COMMANDS), ...Object.keys(ANSWERS), ...Object.keys(SEX), '[unk]',
]);

const isNumWord = w => w in UNITS || w in TEENS || w in TENS || w === 'hundred' || w === 'thousand';

/** Standard cardinal: "two hundred and ten" -> 210, "one thousand two hundred" -> 1200, "twelve hundred" -> 1200. */
function cardinal(words) {
  let total = 0, cur = 0;
  for (const w of words) {
    if (w in UNITS) cur += UNITS[w];
    else if (w in TEENS) cur += TEENS[w];
    else if (w in TENS) cur += TENS[w];
    else if (w === 'hundred') cur = (cur || 1) * 100;
    else if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0; }
  }
  return total + cur;
}

/**
 * Clinician style: digit groups said one after another.
 * "one twenty five" -> 125, "one oh five" -> 105, "one one five" -> 115, "twenty five" -> 25.
 */
function grouped(words) {
  let s = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w in TENS) {
      const n = words[i + 1];
      if (n in UNITS && UNITS[n] > 0 && n !== 'oh') { s += String(TENS[w] + UNITS[n]); i++; } else s += String(TENS[w]);
    } else if (w in TEENS) s += String(TEENS[w]);
    else if (w in UNITS) s += String(UNITS[w]);
  }
  return s === '' ? null : Number(s);
}

function integerPart(words) {
  const w = words.filter(x => x !== 'and');
  if (!w.length) return null;
  if (w.includes('hundred') || w.includes('thousand')) return cardinal(w);
  return grouped(w);
}

/** "one point eight" -> 1.8, "point nine" -> 0.9, "seven point two five" -> 7.25, "zero point twenty five" -> 0.25 */
export function parseSpokenNumber(text) {
  const words = text.toLowerCase().split(/\s+/).filter(w => isNumWord(w) || w === 'point' || w === 'and');
  if (!words.some(isNumWord)) return null;
  const p = words.indexOf('point');
  if (p === -1) return integerPart(words);
  const ip = p === 0 ? 0 : integerPart(words.slice(0, p));
  const dec = words.slice(p + 1).filter(x => x !== 'and');
  const ds = grouped(dec);
  if (ip === null) return null;
  if (ds === null) return ip;
  // keep leading zeros: "point oh five" -> .05
  let digits = '';
  for (let i = 0; i < dec.length; i++) {
    const w = dec[i];
    if (w in TENS) {
      const n = dec[i + 1];
      if (n in UNITS && UNITS[n] > 0 && n !== 'oh') { digits += String(TENS[w] + UNITS[n]); i++; } else digits += String(TENS[w]);
    } else if (w in TEENS) digits += String(TEENS[w]);
    else if (w in UNITS) digits += String(UNITS[w]);
  }
  return Number(`${ip}.${digits}`);
}

/**
 * Interpret one finished utterance for the current field.
 * @param {string} text recognizer output
 * @param {{kind:string, id?:string, options?:Array}} field
 * @returns {{cmd:string}|{value:any}|{none:true}}
 */
export function interpret(text, field) {
  const words = text.toLowerCase().replace(/\[unk\]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return { none: true };
  // A command anywhere wins, so "no, back" or "um skip" behave as expected.
  for (const w of words) if (w in COMMANDS) return { cmd: COMMANDS[w] };

  if (field.kind === 'bool') {
    for (let i = words.length - 1; i >= 0; i--) if (words[i] in ANSWERS) return { value: ANSWERS[words[i]] };
    return { none: true };
  }
  if (field.kind === 'choice') {
    if (field.id === 'sex') {
      for (let i = words.length - 1; i >= 0; i--) if (words[i] in SEX) return { value: SEX[words[i]] };
    }
    const n = parseSpokenNumber(words.join(' '));
    if (n !== null && Number.isInteger(n) && n >= 1 && n <= field.options.length) return { value: field.options[n - 1][0] };
    return { none: true };
  }
  // numeric
  const n = parseSpokenNumber(words.join(' '));
  return n === null ? { none: true } : { value: n };
}
