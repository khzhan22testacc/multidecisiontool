// Run with: node tests/run.mjs
import assert from 'node:assert/strict';
import { evaluate, requiredInputs } from '../js/engine.js';
import { parseDictation } from '../js/parser.js';
import { SCORES } from '../js/scores.js';
import { VAR } from '../js/variables.js';
import { parseSpokenNumber, interpret, GRAMMAR } from '../js/spoken.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const val = (id, v) => evaluate(id, v).result;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, expected ${b}±${tol}`);

t('every score references known variables', () => {
  for (const s of SCORES) for (const id of [...s.needs, ...(s.optional || [])]) assert.ok(VAR[id], `${s.id}: ${id}`);
});

t('shared variables are asked once', () => {
  const g = requiredInputs(['curb65', 'qsofa', 'gbs', 'frs']);
  const ids = g.flatMap(x => x.vars.map(v => v.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(g.flatMap(x => x.vars).find(v => v.id === 'sbp').usedBy.length, 4);
});

t('missing values are reported, not guessed', () => {
  const r = evaluate('curb65', { age: 70 });
  assert.ok(!r.result);
  assert.deepEqual(r.missing, ['Urea', 'Respiratory rate', 'Systolic BP', 'Diastolic BP']);
});

// Framingham: worked example from D'Agostino 2008 (Circulation 117:743):
// woman 61 y, TC 180 mg/dL, HDL 47 mg/dL, untreated SBP 124, smoker, no diabetes -> 10.48%
t('Framingham woman worked example', () => {
  const r = val('frs', { age: 61, sex: 'F', tc: 180 / 38.67, hdl: 47 / 38.67, sbp: 124, bpTreated: false, smoker: true, diabetes: false });
  near(parseFloat(r.lines[0][1]), 10.5, 0.15);
  assert.equal(r.tier, 'mod');
});
// man 53 y, TC 161, HDL 55, treated SBP 125, non-smoker, diabetes -> 15.62%
t('Framingham man worked example', () => {
  const r = val('frs', { age: 53, sex: 'M', tc: 161 / 38.67, hdl: 55 / 38.67, sbp: 125, bpTreated: true, smoker: false, diabetes: true });
  near(parseFloat(r.lines[0][1]), 15.6, 0.15);
});
t('Framingham family history doubles risk, and caps display at >30%', () => {
  const w = { age: 61, sex: 'F', tc: 180 / 38.67, hdl: 47 / 38.67, sbp: 124, bpTreated: false, smoker: true, diabetes: false };
  const r = val('frs', { ...w, famHxCvd: true });
  near(parseFloat(r.value), 21.0, 0.2); assert.equal(r.tier, 'high');
  const m = { age: 53, sex: 'M', tc: 161 / 38.67, hdl: 55 / 38.67, sbp: 125, bpTreated: true, smoker: false, diabetes: true, famHxCvd: true };
  assert.equal(val('frs', m).value, '>30%');
});

t('CURB-65', () => {
  assert.equal(val('curb65', { ams: true, urea: 8, rr: 32, sbp: 85, dbp: 50, age: 70 }).value, '5 points');
  assert.equal(val('curb65', { ams: false, urea: 7, rr: 29, sbp: 90, dbp: 61, age: 64 }).value, '0 points');
  assert.equal(val('curb65', { urea: 5, rr: 20, sbp: 120, dbp: 60, age: 40 }).value, '1 point'); // DBP ≤60
});

t('qSOFA', () => assert.equal(val('qsofa', { rr: 22, ams: false, sbp: 100 }).value, '2 points'));

t('CHA2DS2-VASc and CHADS-65', () => {
  const r = val('chads', { age: 76, sex: 'F', htn: true, diabetes: true, strokeTia: true });
  assert.equal(r.value, '7 points');
  assert.equal(r.lines[0][1], '5 points');
  const young = val('chads', { age: 50, sex: 'M', vascDz: true });
  assert.equal(young.value, '1 point');
  assert.match(young.lines[1][1], /Antiplatelet/);
  assert.match(val('chads', { age: 66, sex: 'M' }).lines[1][1], /anticoagulation/);
});

t('HAS-BLED', () => {
  assert.equal(val('hasbled', { sbp: 170, age: 70, hbDrugs: true }).value, '3 points');
  assert.equal(val('hasbled', { sbp: 160, age: 65 }).value, '0 points');
});

t('Wells PE / PERC / Wells DVT', () => {
  assert.equal(val('wellspe', { dvtSigns: true, peLikely: true, hr: 101, hemoptysis: true }).value, '8.5 points');
  assert.equal(val('wellspe', { hr: 100 }).value, '0 points');
  assert.equal(val('perc', { age: 49, hr: 99, spo2: 95 }).value, 'Negative');
  assert.equal(val('perc', { age: 50, hr: 100, spo2: 94 }).value, 'Positive (3)');
  assert.equal(val('wellsdvt', { cancer: true, dvtEntireLeg: true, dvtAltDx: true }).value, '0 points');
});

t('HEART', () => {
  assert.equal(val('heart', { heartHistory: '2', heartEcg: '1', age: 66, heartRf: '1', heartTrop: '0' }).value, '6 points');
});

t('Glasgow-Blatchford', () => {
  // urea 12 (4) + Hb 95 male (6) + SBP 95 (2) + HR 110 (1) + melena (1) = 14
  assert.equal(val('gbs', { urea: 12, hb: 95, sex: 'M', sbp: 95, hr: 110, melena: true }).value, '14 points');
  assert.equal(val('gbs', { urea: 6.4, hb: 130, sex: 'M', sbp: 110, hr: 99 }).value, '0 points');
  assert.equal(val('gbs', { urea: 6.4, hb: 119, sex: 'F', sbp: 120, hr: 80 }).value, '1 point');
});

t('MELD family', () => {
  // All values at their floors -> 6
  let r = val('meld', { bili: 10, inr: 1.0, cr: 70, na: 140, albumin: 40, sex: 'M' });
  assert.deepEqual(r.lines.map(l => l[1]), ['6', '6', '6']);
  // bili 4 mg/dL, INR 2.0, Cr 2.0 mg/dL, Na 130, albumin 2.5 g/dL, male
  // MELD(i) = 10*(0.957*ln2 + 0.378*ln4 + 1.12*ln2 + 0.643) = 26.07 -> 26.1
  // MELD-Na = 26.1 + 1.32*7 - 0.033*26.1*7 = 29.3 -> 29
  // MELD 3.0 = 4.56*ln4 + 0.82*7 - 0.24*7*ln4 + 9.09*ln2 + 11.14*ln2 + 1.85*1 - 1.83*1*ln2 + 6 = 30.5 -> 30 or 31
  r = val('meld', { bili: 4 * 17.1, inr: 2.0, cr: 2 * 88.4, na: 130, albumin: 25, sex: 'M' });
  assert.equal(r.lines[0][1], '29');
  assert.equal(r.lines[2][1], '26');
  const m3 = 4.56 * Math.log(4) + 0.82 * 7 - 0.24 * 7 * Math.log(4) + 9.09 * Math.log(2) + 11.14 * Math.log(2) + 1.85 - 1.83 * Math.log(2) + 6;
  assert.equal(r.lines[1][1], String(Math.round(m3)));
  // dialysis sets creatinine to the cap
  r = val('meld', { bili: 17.1, inr: 1, cr: 80, na: 137, albumin: 35, sex: 'M', dialysis: true });
  assert.equal(r.lines[2][1], String(Math.round(10 * (0.957 * Math.log(4) + 0.643))));
});

t('Child-Pugh', () => {
  assert.equal(val('childpugh', { bili: 20, albumin: 40, inr: 1.1, ascites: 'none', enceph: 'none' }).value, 'Class A (5)');
  assert.equal(val('childpugh', { bili: 60, albumin: 25, inr: 2.5, ascites: 'moderate', enceph: 'g34' }).value, 'Class C (15)');
  assert.equal(val('childpugh', { bili: 40, albumin: 30, inr: 1.8, ascites: 'none', enceph: 'none' }).value, 'Class B (8)');
});

t('FIB-4 and R factor', () => {
  near(+val('fib4', { age: 50, ast: 80, alt: 64, plt: 150 }).value, 3.33, 0.01);
  assert.equal(val('fib4', { age: 70, ast: 30, alt: 25, plt: 250 }).tier, 'low'); // 1.68 < 2.0 at ≥65
  const r = val('rfactor', { alt: 400, alp: 130 });
  near(+r.value, (400 / 40) / (130 / 120), 0.06);
  assert.match(r.summary, /Hepatocellular/);
});

t('CKD-EPI 2021 and Cockcroft-Gault', () => {
  // NKF reference: 50-year-old, Cr 1.0 mg/dL -> male 92, female 69
  assert.equal(val('ckdepi', { cr: 88.4, age: 50, sex: 'M' }).value, '92');
  assert.equal(val('ckdepi', { cr: 88.4, age: 50, sex: 'F' }).value, '69');
  // (140-60)*72/(72*1.0) = 80; female x0.85 = 68
  assert.equal(val('cg', { age: 60, weight: 72, cr: 88.4, sex: 'M' }).value, '80');
  assert.equal(val('cg', { age: 60, weight: 72, cr: 88.4, sex: 'F' }).value, '68');
});

t('electrolytes', () => {
  let r = val('ag', { na: 140, cl: 100, hco3: 10, albumin: 20 });
  assert.equal(r.lines[0][1], '30 mmol/L');
  assert.equal(r.lines[1][1], '35 mmol/L');
  assert.equal(val('ag', { na: 140, cl: 104, hco3: 24 }).value, '12');
  assert.equal(val('corrca', { calcium: 2.0, albumin: 20 }).value, '2.4');
  r = val('corrna', { na: 125, glucose: 33.3 }); // 600 mg/dL -> +12 (Hillier), +8 (Katz)
  near(parseFloat(r.lines[0][1]), 136.9, 0.15); near(parseFloat(r.lines[1][1]), 132.9, 0.15);
  r = val('osm', { na: 140, glucose: 5, urea: 5, measOsm: 320 });
  assert.equal(r.value, '290'); assert.equal(r.lines[1][1], '30 mOsm/kg');
});

// ---- dictation parser
const p = s => Object.fromEntries(parseDictation(s).found.map(f => [f.id, f.value]));
t('parser: the two examples from the brief', () => {
  assert.deepEqual(p('ALP 130'), { alp: 130 });
  assert.deepEqual(p('sodium 125'), { na: 125 });
});
t('parser: typical Whisper output', () => {
  assert.deepEqual(p('Sodium 125, ALP 130, creatinine is 210. Urea 9.4, INR 1.8.'),
    { na: 125, alp: 130, cr: 210, urea: 9.4, inr: 1.8 });
  assert.deepEqual(p('A.L.T. 400, A L P 130, H-D-L of 1.1 and total cholesterol 5.2'),
    { alt: 400, alp: 130, hdl: 1.1, tc: 5.2 });
  assert.deepEqual(p('BP 110 over 70, heart rate 104, resp rate 24, sats 93'),
    { sbp: 110, dbp: 70, hr: 104, rr: 24, spo2: 93 });
  assert.deepEqual(p('67-year-old female, blood pressure 95/60'), { age: 67, sex: 'F', sbp: 95, dbp: 60 });
  assert.deepEqual(p('72 year old man'), { age: 72, sex: 'M' });
});
t('parser: spoken numbers', () => {
  assert.deepEqual(p('sodium one hundred and twenty five'), { na: 125 });
  assert.deepEqual(p('albumin twenty eight, INR one point eight, bili forty'), { albumin: 28, inr: 1.8, bili: 40 });
  assert.deepEqual(p('platelets 1,200'), { plt: 1200 });
});
t('parser: ignores text without a value', () => {
  assert.deepEqual(p('patient has a history of sodium problems'), {});
  assert.deepEqual(p('alternative plan in 3 days'), {});
});
t('parser: later value replaces earlier', () => assert.deepEqual(p('sodium 125, sorry sodium 135'), { na: 135 }));

// ---- guided voice entry (spoken numbers and commands)
t('spoken numbers: clinician styles', () => {
  const cases = {
    'one twenty five': 125, 'one hundred twenty five': 125, 'one hundred and twenty five': 125,
    'one thirty': 130, 'one oh five': 105, 'one one five': 115, 'two ten': 210, 'ninety eight': 98,
    'four': 4, 'zero': 0, 'twelve hundred': 1200, 'one thousand two hundred': 1200, 'fifteen hundred': 1500,
    'one point eight': 1.8, 'point nine': 0.9, 'zero point nine': 0.9, 'seven point two five': 7.25,
    'seven point twenty five': 7.25, 'two point oh five': 2.05, 'one forty': 140, 'thirty eight point five': 38.5,
    'four hundred': 400, 'twenty': 20,
  };
  for (const [k, v] of Object.entries(cases)) assert.equal(parseSpokenNumber(k), v, k);
  assert.equal(parseSpokenNumber('skip'), null);
  assert.equal(parseSpokenNumber(''), null);
});
t('guided interpret: commands, yes/no, choices, sex', () => {
  const num = { kind: 'num', id: 'na' };
  assert.deepEqual(interpret('one twenty five', num), { value: 125 });
  assert.deepEqual(interpret('[unk] one twenty five', num), { value: 125 });
  assert.deepEqual(interpret('skip', num), { cmd: 'skip' });
  assert.deepEqual(interpret('next', num), { cmd: 'skip' });
  assert.deepEqual(interpret('no back', num), { cmd: 'back' });
  assert.deepEqual(interpret('stop', num), { cmd: 'stop' });
  assert.deepEqual(interpret('[unk]', num), { none: true });
  assert.deepEqual(interpret('yes', num), { none: true });
  const yn = { kind: 'bool', id: 'diabetes' };
  assert.deepEqual(interpret('yes', yn), { value: true });
  assert.deepEqual(interpret('no', yn), { value: false });
  assert.deepEqual(interpret('one', yn), { none: true });
  const asc = VAR.ascites;
  assert.deepEqual(interpret('two', asc), { value: 'slight' });
  assert.deepEqual(interpret('four', asc), { none: true });
  assert.deepEqual(interpret('female', VAR.sex), { value: 'F' });
  assert.deepEqual(interpret('one', VAR.sex), { value: 'M' });
});
t('grammar holds every command and number word', () => {
  const g = JSON.parse(GRAMMAR);
  for (const w of ['one', 'twenty', 'hundred', 'point', 'oh', 'skip', 'back', 'stop', 'yes', 'no', 'male', 'female', '[unk]']) assert.ok(g.includes(w), w);
});

console.log(`\n${n} test groups passed`);
