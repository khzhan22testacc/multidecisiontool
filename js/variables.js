// Canonical variable registry.
// Variables are owned here (label, unit, plausible range, spoken synonyms).
// Scores only reference variable ids and never define inputs themselves,
// so a value entered once feeds every score that needs it.
//
// kind: 'num' | 'bool' | 'choice'
// min/max: plausibility limits for SI units; values outside are flagged, not blocked.
// syn: spoken/typed names recognised by the dictation parser (lower case).

export const GROUPS = [
  { id: 'demo', label: 'Patient' },
  { id: 'vitals', label: 'Vitals' },
  { id: 'labs', label: 'Labs' },
  { id: 'hx', label: 'History' },
  { id: 'exam', label: 'Presentation and exam' },
];

const num = (id, label, unit, group, min, max, syn, extra = {}) =>
  ({ id, kind: 'num', label, unit, group, min, max, syn, ...extra });
const bool = (id, label, group, hint = '') => ({ id, kind: 'bool', label, group, hint });
const choice = (id, label, group, options, hint = '') =>
  ({ id, kind: 'choice', label, group, options, hint });

export const VARIABLES = [
  // ---- Patient
  num('age', 'Age', 'years', 'demo', 18, 110, ['age', 'aged']),
  choice('sex', 'Sex', 'demo', [['M', 'Male'], ['F', 'Female']]),
  num('weight', 'Weight', 'kg', 'demo', 30, 250, ['weight', 'wt']),

  // ---- Vitals
  num('sbp', 'Systolic BP', 'mmHg', 'vitals', 50, 260, ['systolic blood pressure', 'systolic bp', 'systolic', 'sbp']),
  num('dbp', 'Diastolic BP', 'mmHg', 'vitals', 20, 160, ['diastolic blood pressure', 'diastolic bp', 'diastolic', 'dbp']),
  num('hr', 'Heart rate', '/min', 'vitals', 20, 250, ['heart rate', 'pulse rate', 'pulse', 'hr']),
  num('rr', 'Respiratory rate', '/min', 'vitals', 4, 70, ['respiratory rate', 'resp rate', 'respirations', 'rr']),
  num('spo2', 'SpO2 (room air)', '%', 'vitals', 50, 100, ['oxygen saturation', 'o2 saturation', 'o2 sat', 'saturation', 'spo2', 'sats', 'sat']),

  // ---- Labs (SI units)
  num('na', 'Sodium', 'mmol/L', 'labs', 100, 180, ['sodium', 'na']),
  num('cl', 'Chloride', 'mmol/L', 'labs', 60, 140, ['chloride', 'cl']),
  num('hco3', 'Bicarbonate', 'mmol/L', 'labs', 2, 50, ['bicarbonate', 'bicarb', 'hco3', 'total co2', 'co2']),
  num('urea', 'Urea', 'mmol/L', 'labs', 0.5, 80, ['urea']),
  num('cr', 'Creatinine', 'µmol/L', 'labs', 20, 2000, ['creatinine', 'creat', 'cr']),
  num('glucose', 'Glucose', 'mmol/L', 'labs', 1, 80, ['blood glucose', 'glucose', 'blood sugar', 'sugar', 'glu']),
  num('albumin', 'Albumin', 'g/L', 'labs', 8, 60, ['albumin', 'alb']),
  num('calcium', 'Calcium (total)', 'mmol/L', 'labs', 1, 5, ['total calcium', 'calcium', 'ca']),
  num('bili', 'Bilirubin (total)', 'µmol/L', 'labs', 1, 900, ['total bilirubin', 'bilirubin', 'bili', 't bili', 'tbili']),
  num('inr', 'INR', '', 'labs', 0.8, 12, ['inr']),
  num('alt', 'ALT', 'U/L', 'labs', 1, 20000, ['alt', 'alanine aminotransferase', 'alanine transaminase']),
  num('ast', 'AST', 'U/L', 'labs', 1, 20000, ['ast', 'aspartate aminotransferase', 'aspartate transaminase']),
  num('alp', 'ALP', 'U/L', 'labs', 5, 5000, ['alkaline phosphatase', 'alk phos', 'alkphos', 'alp']),
  num('altUln', 'ALT upper limit of normal', 'U/L', 'labs', 20, 80, [], { def: 40, hint: 'Lab-specific. Default 40.' }),
  num('alpUln', 'ALP upper limit of normal', 'U/L', 'labs', 80, 200, [], { def: 120, hint: 'Lab-specific. Default 120.' }),
  num('plt', 'Platelets', '×10⁹/L', 'labs', 1, 1500, ['platelet count', 'platelets', 'platelet', 'plt']),
  num('hb', 'Hemoglobin', 'g/L', 'labs', 20, 230, ['hemoglobin', 'haemoglobin', 'hgb', 'hb']),
  num('tc', 'Total cholesterol', 'mmol/L', 'labs', 1.5, 15, ['total cholesterol', 'cholesterol', 'tc']),
  num('hdl', 'HDL cholesterol', 'mmol/L', 'labs', 0.2, 4, ['hdl cholesterol', 'hdl']),
  num('measOsm', 'Measured osmolality', 'mOsm/kg', 'labs', 200, 450, ['measured osmolality', 'serum osmolality', 'osmolality', 'osm']),

  // ---- History
  bool('diabetes', 'Diabetes', 'hx'),
  bool('smoker', 'Current smoker', 'hx'),
  bool('bpTreated', 'On antihypertensive treatment', 'hx'),
  bool('famHxCvd', 'Premature CVD in first-degree relative', 'hx', 'Men <55 y, women <65 y'),
  bool('htn', 'Hypertension', 'hx', 'History of hypertension or on treatment'),
  bool('chf', 'Heart failure', 'hx', 'Clinical HF or reduced LV function'),
  bool('strokeTia', 'Prior stroke, TIA or systemic embolism', 'hx'),
  bool('vascDz', 'Vascular disease', 'hx', 'Prior MI, peripheral arterial disease or aortic plaque'),
  bool('hbRenal', 'Abnormal renal function', 'hx', 'Dialysis, transplant or creatinine >200 µmol/L'),
  bool('hbLiver', 'Abnormal liver function', 'hx', 'Cirrhosis, or bilirubin >2× ULN with AST/ALT/ALP >3× ULN'),
  bool('hbBleed', 'Prior major bleed or bleeding predisposition', 'hx', 'Includes anemia or bleeding diathesis'),
  bool('labileInr', 'Labile INR', 'hx', 'Time in therapeutic range <60%. Only if on warfarin'),
  bool('hbDrugs', 'Antiplatelet or NSAID use', 'hx'),
  bool('hbAlcohol', 'Alcohol ≥8 drinks per week', 'hx'),
  bool('priorVte', 'Prior DVT or PE', 'hx'),
  bool('cancer', 'Active cancer', 'hx', 'Treatment within 6 months or palliative'),
  bool('immobSurgPe', 'Immobilization ≥3 days or surgery in past 4 weeks', 'hx'),
  bool('surgTrauma4w', 'Surgery or trauma requiring hospitalization in past 4 weeks', 'hx'),
  bool('estrogen', 'Estrogen use', 'hx', 'Oral contraceptive or hormone replacement'),
  bool('dvtParalysis', 'Paralysis, paresis or recent cast of leg', 'hx'),
  bool('dvtBedridden', 'Bedridden ≥3 days or major surgery in past 12 weeks', 'hx'),
  bool('priorDvt', 'Previously documented DVT', 'hx'),
  bool('hepaticDz', 'Known liver disease', 'hx', 'History of, or clinical/lab evidence of, chronic or acute liver disease'),
  bool('dialysis', 'Dialysis at least twice in the past week', 'hx', 'Or 24 h of CVVHD'),

  // ---- Presentation and exam
  bool('ams', 'New confusion or altered mental status', 'exam', 'GCS <15 or new disorientation'),
  bool('hemoptysis', 'Hemoptysis', 'exam'),
  bool('dvtSigns', 'Clinical signs of DVT', 'exam', 'Leg swelling with pain on deep vein palpation'),
  bool('peLikely', 'PE is the most likely diagnosis, or equally likely', 'exam'),
  bool('legSwelling', 'Unilateral leg swelling', 'exam'),
  bool('dvtTender', 'Tenderness along the deep venous system', 'exam'),
  bool('dvtEntireLeg', 'Entire leg swollen', 'exam'),
  bool('dvtCalf3cm', 'Calf swelling >3 cm vs other leg', 'exam', 'Measured 10 cm below tibial tuberosity'),
  bool('dvtPitting', 'Pitting edema confined to symptomatic leg', 'exam'),
  bool('dvtCollateral', 'Collateral superficial veins (non-varicose)', 'exam'),
  bool('dvtAltDx', 'Alternative diagnosis at least as likely as DVT', 'exam'),
  bool('melena', 'Melena', 'exam'),
  bool('syncope', 'Syncope at presentation', 'exam'),
  choice('ascites', 'Ascites', 'exam', [['none', 'None'], ['slight', 'Slight'], ['moderate', 'Moderate or worse']]),
  choice('enceph', 'Hepatic encephalopathy', 'exam', [['none', 'None'], ['g12', 'Grade 1–2'], ['g34', 'Grade 3–4']]),
  choice('heartHistory', 'HEART: history', 'exam',
    [['0', 'Slightly suspicious'], ['1', 'Moderately suspicious'], ['2', 'Highly suspicious']]),
  choice('heartEcg', 'HEART: ECG', 'exam',
    [['0', 'Normal'], ['1', 'Non-specific repolarization change'], ['2', 'Significant ST deviation']],
    'Score 1 also for LBBB, LVH or paced rhythm'),
  choice('heartRf', 'HEART: risk factors', 'exam',
    [['0', 'None'], ['1', '1–2'], ['2', '≥3 or known atherosclerosis']],
    'HTN, hyperlipidemia, diabetes, obesity (BMI >30), smoking, family history'),
  choice('heartTrop', 'HEART: troponin', 'exam',
    [['0', '≤ normal limit'], ['1', '1–3× normal limit'], ['2', '>3× normal limit']]),
];

export const VAR = Object.fromEntries(VARIABLES.map(v => [v.id, v]));
