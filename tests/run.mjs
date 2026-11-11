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

// ---- new tools (v3)
const crForEgfr = (target, age, sex) => { // invert CKD-EPI numerically
  const f = sex === 'F', k = f ? 0.7 : 0.9, a = f ? -0.241 : -0.302;
  const e = cr => { const s = cr / 88.4 / k; return 142 * Math.pow(Math.min(s, 1), a) * Math.pow(Math.max(s, 1), -1.2) * Math.pow(0.9938, age) * (f ? 1.012 : 1); };
  let lo = 20, hi = 2000;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; e(m) > target ? lo = m : hi = m; }
  return (lo + hi) / 2;
};
const lineVal = (r, label) => parseFloat(r.lines.find(l => l[0].startsWith(label))[1]);

t('KFRE 4-variable matches published example (55 M, eGFR 35, ACR 300 mg/g -> 3.8% / 13.9%)', () => {
  // exact eGFR is needed, so check the equation on its own as well as through creatinine
  const r = val('kfre4', { age: 55, sex: 'M', cr: crForEgfr(35, 55, 'M'), acr: 300 / 8.84 });
  near(lineVal(r, '2-year'), 3.8, 0.15); near(lineVal(r, '5-year'), 13.9, 0.2);
});
t('KFRE 8-variable reduces to centred terms at the cohort means', () => {
  const base = { age: 55, sex: 'M', cr: crForEgfr(35, 55, 'M'), acr: 300 / 8.84 };
  const r = val('kfre8', { ...base, albumin: 39.97, phos: 3.916 / 3.097, hco3: 25.57, calcium: 9.355 / 4.008 });
  const lp = -0.1992 * (5.5 - 7.036) + 0.1602 * (1 - 0.5642) - 0.4919 * (35 / 5 - 7.222) + 0.3364 * (Math.log(300) - 5.137);
  near(lineVal(r, '2-year'), 100 * (1 - Math.pow(0.9780, Math.exp(lp))), 0.1);
  near(lineVal(r, '5-year'), 100 * (1 - Math.pow(0.9301, Math.exp(lp))), 0.1);
  // lower albumin raises risk
  assert.ok(lineVal(val('kfre8', { ...base, albumin: 30, phos: 1.26, hco3: 25.57, calcium: 2.33 }), '5-year') > lineVal(r, '5-year'));
});
t('CKD staging', () => {
  const r = val('ckdstage', { cr: crForEgfr(40, 70, 'M'), age: 70, sex: 'M', acr: 40 });
  assert.equal(r.value, 'G3b A3'); assert.match(r.summary, /Very high/);
  assert.equal(val('ckdstage', { cr: 70, age: 40, sex: 'F', acr: 1 }).summary.startsWith('Low risk'), true);
});
t('FENa, FEurea, urea:Cr, urine anion gap', () => {
  near(parseFloat(val('fena', { una: 20, cr: 200, na: 140, ucr: 10 }).value), 0.29, 0.01);
  near(parseFloat(val('feurea', { uurea: 200, cr: 200, urea: 20, ucr: 10 }).value), 20, 0.05);
  const u = val('ureacr', { urea: 20, cr: 100 });
  assert.equal(u.value, '50'); assert.equal(lineVal(u, 'Urea (mmol/L)'), 200);
  assert.equal(val('uag', { una: 40, uk: 30, ucl: 90 }).value, '-20');
});
t('AIN calculator matches the published worked examples', () => {
  // Cr 4.0 mg/dL, BUN 40, SG 1.010, protein <2+ -> high; Cr 1.5, BUN 30, SG 1.020, protein 2+ -> low
  const a = val('ain', { cr: 4 * 88.4, urea: 40 / 2.8, usg: 1.010, uprotHigh: false, ainPrev: 23 });
  assert.equal(a.value, '56%'); assert.equal(a.tier, 'high');
  const b = val('ain', { cr: 1.5 * 88.4, urea: 30 / 2.8, usg: 1.020, uprotHigh: true, ainPrev: 23 });
  assert.equal(b.value, '7%'); assert.equal(b.tier, 'low');
});
t('ATN-ISI and SHARF II', () => {
  const a = val('atnisi', { age: 70, sex: 'M', oliguria: true, atnHypotension: true, mechVent: true, ams: true, bili: 15 });
  assert.equal(a.value, '76%');
  const b = val('atnisi', { age: 40, sex: 'F', nephrotoxic: true, bili: 15 }); // 0.128 - 0.109 - 0.154 + 0.21 = 0.075
  assert.equal(b.value, '8%');
  const s2 = val('sharf', { age: 65, albumin: 28, ptPct: '3', mechVent: true, bili: 17.1, sepsis: true, sharfHypotension: true });
  assert.equal(s2.value, '86');
});
t('Mehran', () => {
  const r = val('mehran', { mehHypotension: true, diabetes: true, contrast: 250, cr: 1.8 * 88.4, age: 60, sex: 'M' });
  assert.equal(r.lines[0][1], '14 points'); // creatinine version, published example
  const e = val('mehran', { chfSevere: true, diabetes: true, contrast: 200, cr: crForEgfr(42, 72, 'M'), age: 72, sex: 'M' });
  assert.equal(e.value, '12 points'); // 5 + 3 + 2 (contrast) + 2 (eGFR 40-60)
});
t('McMahon', () => {
  const r = val('mcmahon', { age: 75, sex: 'F', rhabdoOtherCause: true, ck: 50000, hco3: 18, cr: 2.0 * 88.4, calcium: 2.0, phos: 1.13 });
  assert.equal(r.value, '12 points'); assert.equal(r.tier, 'high');
  assert.equal(val('mcmahon', { age: 30, sex: 'M', ck: 20000, hco3: 24, cr: 80, calcium: 2.3, phos: 1.0 }).value, '0 points');
});
t('acid-base: delta gap, Winters, compensation', () => {
  const d = val('deltagap', { na: 140, cl: 100, hco3: 10 });
  assert.equal(d.value, '1.29'); assert.match(d.summary, /pure anion gap/); assert.equal(lineVal(d, 'Corrected'), 28);
  assert.equal(val('winters', { hco3: 12 }).value, '26');
  assert.match(val('winters', { hco3: 12, pco2: 35 }).summary, /respiratory acidosis/);
  let r = val('abg', { ph: 7.25, pco2: 26, hco3: 12 });
  assert.equal(r.value, 'Metabolic acidosis'); assert.match(r.summary, /appropriate/);
  r = val('abg', { ph: 7.30, pco2: 60, hco3: 26 });
  assert.equal(r.value, 'Respiratory acidosis'); assert.match(r.summary, /acute/);
  r = val('abg', { ph: 7.36, pco2: 60, hco3: 33 });
  assert.match(r.value, /Mixed|No primary/);
  r = val('abg', { ph: 7.50, pco2: 48, hco3: 36 });
  assert.equal(r.value, 'Metabolic alkalosis'); assert.match(r.summary, /appropriate/);
  r = val('abg', { ph: 7.50, pco2: 28, hco3: 22 });
  assert.equal(r.value, 'Respiratory alkalosis');
  r = val('abg', { ph: 7.10, pco2: 55, hco3: 16 });
  assert.match(r.value, /Mixed metabolic and respiratory acidosis/);
});
t('P/F, MAP, fluids, sodium', () => {
  assert.equal(val('pf', { pao2: 80, fio2: 40 }).value, '200'); assert.match(val('pf', { pao2: 80, fio2: 40 }).summary, /moderate/);
  assert.equal(val('map', { sbp: 120, dbp: 60 }).value, '80');
  assert.equal(val('fwd', { na: 160, weight: 70, age: 40, sex: 'M' }).value, '6');
  assert.equal(val('fwd', { na: 160, weight: 70, age: 70, sex: 'F' }).value, '4.5');
  const n = val('nadef', { na: 120, weight: 70, age: 40, sex: 'F' });
  assert.equal(n.value, '280'); assert.equal(lineVal(n, '3% saline'), 10.9);
  assert.equal(val('nadef', { na: 120, weight: 70, age: 40, sex: 'F', naTarget: 125 }).value, '175');
  assert.equal(val('maint', { weight: 70 }).value, '110');
  assert.equal(val('maint', { weight: 15 }).value, '50');
});
t('IBW and adjusted body weight', () => {
  assert.equal(val('ibw', { height: 180, sex: 'M' }).value, '75');
  assert.equal(val('ibw', { height: 165, sex: 'F' }).value, '56.9');
  assert.equal(val('adjbw', { height: 180, sex: 'M', weight: 120 }).value, '93');
});
t('GCA probability score', () => {
  const r = val('gcaps', { age: 72, sex: 'F', gcaOnset: '3', crp: 40, gcaHeadache: true, gcaConst: '1', gcaIschaemic: true, gcaTa: '1', gcaExtra: '0' });
  assert.equal(r.value, '17 points'); assert.equal(r.tier, 'high');
  const low = val('gcaps', { age: 55, sex: 'M', gcaOnset: '0', crp: 3, gcaConst: '0', gcaTa: '0', gcaExtra: '0', gcaAltDx: true });
  assert.equal(low.value, '-1 point'); assert.equal(low.tier, 'low');
});

console.log(`\n${n} test groups passed`);
